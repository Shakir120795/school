// Attendance scan engine — students and staff run through the same pipeline
// but write to SEPARATE tables with their own policy scope (blueprint §5).
//
// Guarantees:
//  - Scan events are immutable originals; daily rows are derived, corrections
//    never rewrite events.
//  - Idempotency: a client-supplied idempotencyKey resolves to exactly one
//    event row (DB unique per school). Concurrent retries collapse onto it.
//  - Heuristic duplicate: same person + same event type within
//    DUPLICATE_SCAN_WINDOW_SEC returns {duplicate:true} and writes nothing.
//  - Attendance row + outbox event are written in ONE transaction, so a
//    notification outage can never lose an attendance record.
import { prisma } from "../db.js";
import { config } from "../config.js";
import { hashToken } from "../utils/security.js";
import { localParts, evaluateScan, dateOnly } from "../utils/time.js";

const TABLES = {
  STUDENT: {
    scan: "studentScanEvent",
    day: "studentAttendance",
    personField: "studentId",
    entryField: "entryAt",
    exitField: "exitAt",
    policyScope: "STUDENT",
  },
  STAFF: {
    scan: "staffScanEvent",
    day: "staffAttendance",
    personField: "teacherProfileId",
    entryField: "checkInAt",
    exitField: "checkOutAt",
    policyScope: "STAFF",
  },
};

export async function resolveCard(schoolId, qrToken) {
  const card = await prisma.cardCredential.findUnique({ where: { tokenHash: hashToken(qrToken) } });
  if (!card || card.schoolId !== schoolId) return { error: "CARD_NOT_FOUND" };
  if (card.status !== "ACTIVE") return { error: "CARD_NOT_ACTIVE", status: card.status };
  return { card };
}

async function activePolicy(schoolId, scope) {
  return prisma.attendancePolicy.findFirst({
    where: { schoolId, appliesTo: scope, isActive: true },
  });
}

/**
 * Process one scan.
 * input: { schoolId, deviceId, qrToken, eventType: 'ENTRY'|'EXIT', source, idempotencyKey, scannedAt? }
 * scannedAt is accepted ONLY from the device timestamp; servers should rely on
 * device clock sync. (Tests set policy windows relative to real time instead
 * of forging timestamps.)
 */
export async function processScan(input) {
  const { schoolId, eventType } = input;
  const scannedAt = input.scannedAt ? new Date(input.scannedAt) : new Date();

  const { card, error } = await resolveCard(schoolId, input.qrToken);
  if (error) return { outcome: "INVALID", reason: error };

  const kind = card.ownerType; // STUDENT | STAFF
  const t = TABLES[kind];
  const personId = kind === "STUDENT" ? card.studentId : card.teacherProfileId;

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  const parts = localParts(scannedAt, school.timezone);
  const policy = await activePolicy(schoolId, t.policyScope);
  const evaluation = evaluateScan(policy, eventType, parts);

  const flags = [];
  if (!evaluation.isWorkingDay) flags.push("NON_WORKING_DAY");
  if (eventType === "ENTRY" && policy && !evaluation.withinEntryWindow) flags.push("OUT_OF_WINDOW");
  if (eventType === "EXIT" && policy && !evaluation.withinExitWindow) flags.push("OUT_OF_WINDOW");
  const reviewFlag = flags.length ? flags.join(",") : null;

  const localDate = dateOnly(parts.dateStr);

  const result = await prisma.$transaction(async (tx) => {
    // Serialize scans per card: concurrent retries for the same card queue
    // here instead of racing the unique constraints.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${card.id}))`;

    // Idempotency-key replay (checked under the lock): write nothing.
    if (input.idempotencyKey) {
      const existing = await tx[t.scan].findUnique({
        where: { schoolId_idempotencyKey: { schoolId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) return { outcome: "DUPLICATE", duplicate: true, eventId: existing.id, kind };
    }

    // Heuristic duplicate window (e.g. double-tap at the gate).
    const windowStart = new Date(scannedAt.getTime() - config.duplicateScanWindowSec * 1000);
    const recent = await tx[t.scan].findFirst({
      where: {
        schoolId,
        [t.personField]: personId,
        eventType,
        scannedAt: { gte: windowStart, lte: scannedAt },
      },
      orderBy: { scannedAt: "desc" },
    });
    if (recent) return { outcome: "DUPLICATE", duplicate: true, eventId: recent.id, kind };

    let event;
    try {
      event = await tx[t.scan].create({
        data: {
          schoolId,
          [t.personField]: personId,
          cardCredentialId: card.id,
          deviceId: input.deviceId || null,
          eventType,
          source: input.source || "QR",
          scannedAt,
          idempotencyKey: input.idempotencyKey || `${card.id}:${scannedAt.toISOString()}:${eventType}`,
          reviewFlag,
        },
      });
    } catch (e) {
      // Concurrent request with the same idempotency key won the race.
      if (e.code === "P2002") return { outcome: "DUPLICATE", duplicate: true, kind };
      throw e;
    }

    const existingDay = await tx[t.day].findUnique({
      where:
        kind === "STUDENT"
          ? { schoolId_studentId_localDate: { schoolId, studentId: personId, localDate } }
          : { schoolId_teacherProfileId_localDate: { schoolId, teacherProfileId: personId, localDate } },
    });

    let day = existingDay;
    if (eventType === "ENTRY") {
      const data = {
        status: evaluation.isLate ? "LATE" : "PRESENT",
        isLate: evaluation.isLate,
        [t.entryField]: existingDay?.[t.entryField] || scannedAt,
        reviewFlag: existingDay?.reviewFlag || reviewFlag,
      };
      day = existingDay
        ? await tx[t.day].update({ where: { id: existingDay.id }, data })
        : await tx[t.day].create({
            data: { schoolId, [t.personField]: personId, localDate, ...data },
          });
    } else if (eventType === "EXIT") {
      if (existingDay) {
        day = await tx[t.day].update({
          where: { id: existingDay.id },
          data: {
            [t.exitField]: scannedAt,
            ...(kind === "STUDENT" ? { isEarlyExit: evaluation.isEarlyExit } : {}),
            reviewFlag: existingDay.reviewFlag || reviewFlag,
          },
        });
      } else {
        day = await tx[t.day].create({
          data: {
            schoolId,
            [t.personField]: personId,
            localDate,
            status: "PRESENT",
            [t.exitField]: scannedAt,
            ...(kind === "STUDENT" ? { isEarlyExit: evaluation.isEarlyExit } : {}),
            reviewFlag: reviewFlag ? `${reviewFlag},MISSING_ENTRY` : "MISSING_ENTRY",
          },
        });
      }
    }

    // Same-transaction outbox event for the notification worker. Delivery is a
    // separate outcome; attendance above is already durable.
    await tx.notificationOutbox.create({
      data: {
        schoolId,
        eventType: kind === "STUDENT" ? "attendance.student.scan" : "attendance.staff.scan",
        aggregateType: kind === "STUDENT" ? "StudentAttendance" : "StaffAttendance",
        aggregateId: day.id,
        payload: { scanEventId: event.id, eventType, personId, localDate: parts.dateStr },
        idempotencyKey: `scan:${event.id}`,
      },
    });

    return { outcome: "RECORDED", eventId: event.id, dayId: day.id, evaluation, reviewFlag, kind };
  });

  return { ...result, personId, localDate: parts.dateStr };
}
