import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool, ADMIN_ROLES } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { hashToken, normalizeNfcUid, nfcToken } from "../utils/security.js";
import { processScan, resolveCard } from "../services/attendance.js";
import { teacherClassIds } from "../services/teacherClasses.js";
import { alertGuardiansForScan } from "../services/scanAlerts.js";
import { localParts, dateOnly } from "../utils/time.js";
import { recordTablesReady } from "../utils/studentCompat.js";

const router = Router();
const STAFF_READ = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"];

// --- Gate scan: device-authenticated, no user session ------------------------
// Headers: X-School-Id, X-Device-Key. Body: { qrToken, eventType, source?, idempotencyKey }
router.post(
  "/attendance/scan",
  asyncRoute(async (req, res) => {
    const schoolId = req.headers["x-school-id"];
    const deviceKey = req.headers["x-device-key"];
    if (!schoolId || !deviceKey) return res.status(400).json({ error: "SCHOOL_AND_DEVICE_HEADERS_REQUIRED" });
    const device = await prisma.device.findUnique({ where: { deviceKeyHash: hashToken(deviceKey) } });
    if (!device || device.schoolId !== schoolId || device.status !== "ACTIVE") {
      return res.status(401).json({ error: "INVALID_DEVICE" });
    }
    const missing = requireFields(req.body, ["qrToken", "eventType"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    if (!["ENTRY", "EXIT"].includes(req.body.eventType))
      return res.status(400).json({ error: "INVALID_EVENT_TYPE" });
    await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    const result = await processScan({
      schoolId,
      deviceId: device.id,
      qrToken: req.body.qrToken,
      eventType: req.body.eventType,
      source: req.body.source || "QR",
      idempotencyKey: req.body.idempotencyKey,
    });
    if (result.outcome === "RECORDED" && result.kind === "STUDENT") {
      // Fire-and-await the parent gate alert; it never fails the scan.
      await alertGuardiansForScan({
        schoolId, studentId: result.personId, eventType: req.body.eventType, scannedAt: new Date(),
      });
    }
    const httpStatus = result.outcome === "INVALID" ? 422 : 200;
    return res.status(httpStatus).json(result);
  })
);

// --- NFC reader scan (Phase 74): device-authenticated, no user session -------
// For standalone WiFi NFC readers at the gate. Same device credentials as the
// QR scanner (Settings → Devices), accepted as headers (X-School-Id /
// X-Device-Key) or, for readers that cannot set headers, as body/query
// fields (schoolId + deviceKey). Body: { uid, eventType?, idempotencyKey? }.
// Without eventType the direction is auto: the day's first tap is ENTRY, the
// next is EXIT. The card UID is looked up by hash — unknown or revoked cards
// record nothing and return 422.
async function handleNfcScan(req, res) {
  const q = { ...(req.query || {}), ...(req.body || {}) };
  const schoolId = req.headers["x-school-id"] || q.schoolId || q.school;
  const deviceKey = req.headers["x-device-key"] || q.deviceKey || q.key;
  if (!schoolId || !deviceKey) return res.status(400).json({ error: "SCHOOL_AND_DEVICE_HEADERS_REQUIRED" });
  const device = await prisma.device.findUnique({ where: { deviceKeyHash: hashToken(deviceKey) } });
  if (!device || device.schoolId !== schoolId || device.status !== "ACTIVE") {
    return res.status(401).json({ error: "INVALID_DEVICE" });
  }
  const uid = normalizeNfcUid(q.uid || q.cardUid || q.card_id || q.cardNo);
  if (!uid) return res.status(400).json({ error: "INVALID_NFC_UID" });
  const token = nfcToken(uid);
  const { card, error } = await resolveCard(schoolId, token);
  if (error) return res.status(422).json({ outcome: "INVALID", reason: error });

  const kind = card.ownerType;
  const personId = kind === "STUDENT" ? card.studentId : card.teacherProfileId;
  let eventType = String(q.eventType || "").toUpperCase();
  if (!["ENTRY", "EXIT"].includes(eventType)) {
    // Auto direction from today's record (school timezone).
    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
    const parts = localParts(new Date(), school?.timezone || "Asia/Kolkata");
    const localDate = dateOnly(parts.dateStr);
    const day =
      kind === "STUDENT"
        ? await prisma.studentAttendance.findUnique({ where: { schoolId_studentId_localDate: { schoolId, studentId: personId, localDate } } })
        : await prisma.staffAttendance.findUnique({ where: { schoolId_teacherProfileId_localDate: { schoolId, teacherProfileId: personId, localDate } } });
    const entered = kind === "STUDENT" ? day?.entryAt : day?.checkInAt;
    eventType = entered ? "EXIT" : "ENTRY";
  }

  await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  const result = await processScan({
    schoolId,
    deviceId: device.id,
    qrToken: token,
    eventType,
    source: "NFC",
    idempotencyKey: q.idempotencyKey,
  });
  if (result.outcome === "RECORDED" && result.kind === "STUDENT") {
    await alertGuardiansForScan({ schoolId, studentId: result.personId, eventType, scannedAt: new Date() });
  }
  // A name for readers with a display; a failure here never fails the scan.
  let personName = null;
  try {
    if (kind === "STUDENT") {
      const s = await prisma.student.findFirst({ where: { id: personId, schoolId }, select: { fullName: true } });
      personName = s?.fullName || null;
    } else {
      const t = await prisma.teacherProfile.findFirst({ where: { id: personId, schoolId }, select: { displayName: true } });
      personName = t?.displayName || null;
    }
  } catch { /* display only */ }
  const httpStatus = result.outcome === "INVALID" ? 422 : 200;
  return res.status(httpStatus).json({ ...result, eventType, personName });
}
router.post("/attendance/nfc-scan", asyncRoute(handleNfcScan));
router.get("/attendance/nfc-scan", asyncRoute(handleNfcScan));

// --- Policies ------------------------------------------------------------------
router.post(
  "/schools/:schoolId/attendance-policies",
  requireAuth,
  requireSchool(ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["appliesTo", "entryStart", "entryEnd", "lateAfter", "workingWeekdays"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const policy = await prisma.$transaction(async (tx) => {
      // One active policy per scope: retire the previous active one first.
      await tx.attendancePolicy.updateMany({
        where: { schoolId: req.params.schoolId, appliesTo: req.body.appliesTo, isActive: true },
        data: { isActive: false },
      });
      return tx.attendancePolicy.create({
        data: {
          schoolId: req.params.schoolId,
          appliesTo: req.body.appliesTo,
          entryStart: req.body.entryStart,
          entryEnd: req.body.entryEnd,
          lateAfter: req.body.lateAfter,
          exitStart: req.body.exitStart,
          exitEnd: req.body.exitEnd,
          workingWeekdays: req.body.workingWeekdays,
          graceMinutes: req.body.graceMinutes || 0,
        },
      });
    });
    return res.status(201).json({ policy });
  })
);

router.get(
  "/schools/:schoolId/attendance-policies",
  requireAuth,
  requireSchool(STAFF_READ),
  asyncRoute(async (req, res) => {
    const policies = await prisma.attendancePolicy.findMany({ where: { schoolId: req.params.schoolId } });
    return res.json({ policies });
  })
);

router.get(
  "/schools/:schoolId/holidays",
  requireAuth,
  requireSchool(STAFF_READ),
  asyncRoute(async (req, res) => {
    const holidays = await prisma.holiday.findMany({
      where: { schoolId: req.params.schoolId },
      orderBy: { localDate: "asc" },
    });
    return res.json({
      holidays: holidays.map((h) => ({ id: h.id, name: h.name, localDate: h.localDate.toISOString().slice(0, 10) })),
    });
  })
);

router.delete(
  "/schools/:schoolId/holidays/:holidayId",
  requireAuth,
  requireSchool(ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    await prisma.holiday.deleteMany({ where: { id: req.params.holidayId, schoolId: req.params.schoolId } });
    return res.json({ ok: true });
  })
);

router.post(
  "/schools/:schoolId/holidays",
  requireAuth,
  requireSchool(ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["localDate", "name"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const holiday = await prisma.holiday.create({
      data: {
        schoolId: req.params.schoolId,
        localDate: new Date(`${req.body.localDate}T00:00:00.000Z`),
        name: req.body.name,
      },
    });
    return res.status(201).json({ holiday });
  })
);

// --- On campus now (Phase 11) ---------------------------------------------------
router.get(
  "/schools/:schoolId/attendance/on-campus",
  requireAuth,
  requireSchool(STAFF_READ),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const today = localParts(new Date(), req.school.timezone).dateStr;
    const rows = await prisma.studentAttendance.findMany({
      where: { schoolId, localDate: new Date(`${today}T00:00:00.000Z`), entryAt: { not: null } },
      include: { student: { select: { id: true, fullName: true, admissionNo: true, classroom: { select: { name: true, section: true } } } } },
      orderBy: { entryAt: "desc" },
    });
    const totalStudents = await prisma.student.count({ where: { schoolId, status: "ACTIVE" } });
    const list = rows.map((r) => ({
      studentId: r.student.id, name: r.student.fullName, admissionNo: r.student.admissionNo,
      className: r.student.classroom ? `${r.student.classroom.name}${r.student.classroom.section ? "-" + r.student.classroom.section : ""}` : "",
      entryAt: r.entryAt, exitAt: r.exitAt, onCampus: !r.exitAt, status: r.status,
    }));
    return res.json({
      date: today,
      totals: {
        expected: totalStudents,
        arrived: rows.length,
        onCampus: list.filter((x) => x.onCampus).length,
        departed: list.filter((x) => !x.onCampus).length,
        notArrived: totalStudents - rows.length,
      },
      students: list,
    });
  })
);

// --- Student attendance history (Phase 75) --------------------------------------
// One student's record over a range — monthwise totals + every day — up to a
// full year back. Staff stay in their scope (a teacher only her own classes);
// a parent sees only a guardian-linked child.
router.get(
  "/schools/:schoolId/students/:studentId/attendance-history",
  requireAuth,
  requireSchool([...STAFF_READ, "PARENT"]),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const student = await prisma.student.findFirst({
      where: { id: req.params.studentId, schoolId },
      select: { id: true, fullName: true, admissionNo: true, classroomId: true, classroom: { select: { name: true, section: true } } },
    });
    if (!student) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    const role = req.membership.role;
    if (role === "PARENT") {
      const link = await prisma.studentGuardian.findFirst({
        where: { schoolId, studentId: student.id, guardian: { userId: req.user.id } },
        select: { id: true },
      });
      if (!link) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    } else if (role === "TEACHER") {
      const ids = await teacherClassIds(schoolId, req.membership.id);
      if (!student.classroomId || !ids.includes(student.classroomId))
        return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    }
    // Range: default = the last 12 months to today (school timezone); a wider
    // custom range is clamped to 366 days.
    const tz = req.school.timezone || "Asia/Kolkata";
    const today = localParts(new Date(), tz).dateStr;
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
    let to = isDate(req.query.to) ? req.query.to : today;
    if (to > today) to = today;
    let from = isDate(req.query.from) ? req.query.from : null;
    const toD = dateOnly(to);
    if (!from) {
      const d = new Date(toD);
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      from = d.toISOString().slice(0, 10);
    }
    if (from > to) [from, to] = [to, from];
    let fromD = dateOnly(from);
    if ((dateOnly(to) - fromD) / 86400000 > 366) {
      fromD = new Date(dateOnly(to).getTime() - 366 * 86400000);
      from = fromD.toISOString().slice(0, 10);
    }
    const rows = await prisma.studentAttendance.findMany({
      where: { schoolId, studentId: student.id, localDate: { gte: fromD, lte: dateOnly(to) } },
      orderBy: { localDate: "desc" },
      select: { localDate: true, status: true, entryAt: true, exitAt: true, isLate: true, isEarlyExit: true },
    });
    const blank = () => ({ marked: 0, present: 0, late: 0, absent: 0, onLeave: 0, halfDay: 0 });
    const tally = (acc, st) => {
      acc.marked++;
      if (st === "PRESENT") acc.present++;
      else if (st === "LATE") acc.late++;
      else if (st === "ABSENT") acc.absent++;
      else if (st === "ON_LEAVE") acc.onLeave++;
      else if (st === "HALF_DAY") acc.halfDay++;
    };
    // Late counts as attended; a half day counts as half.
    const pct = (a) => (a.marked ? Math.round(((a.present + a.late + 0.5 * a.halfDay) / a.marked) * 1000) / 10 : null);
    const summary = blank();
    const byMonth = new Map();
    for (const r of rows) {
      tally(summary, r.status);
      const key = r.localDate.toISOString().slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, { month: key, ...blank() });
      tally(byMonth.get(key), r.status);
    }
    const months = [...byMonth.values()]
      .sort((a, b) => (a.month < b.month ? 1 : -1))
      .map((m) => ({ ...m, percentage: pct(m) }));
    return res.json({
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNo: student.admissionNo,
        classLabel: student.classroom ? `${student.classroom.name}${student.classroom.section ? "-" + student.classroom.section : ""}` : "",
      },
      from,
      to,
      summary: { ...summary, percentage: pct(summary) },
      months,
      days: rows.map((r) => ({
        localDate: r.localDate.toISOString().slice(0, 10),
        status: r.status,
        entryAt: r.entryAt,
        exitAt: r.exitAt,
        isLate: r.isLate,
        isEarlyExit: r.isEarlyExit,
      })),
    });
  })
);

// --- Daily registers --------------------------------------------------------------
router.get(
  "/schools/:schoolId/attendance/students",
  requireAuth,
  requireSchool(STAFF_READ),
  asyncRoute(async (req, res) => {
    const where = { schoolId: req.params.schoolId };
    if (req.query.date) where.localDate = new Date(`${req.query.date}T00:00:00.000Z`);
    if (req.query.classroomId) where.student = { classroomId: req.query.classroomId };
    if (req.query.studentId) where.studentId = req.query.studentId;
    const rows = await prisma.studentAttendance.findMany({
      where,
      include: { student: { select: { id: true, fullName: true, admissionNo: true, classroomId: true } } },
      orderBy: { localDate: "desc" },
      take: 500,
    });
    // Phase 36: for a single day the register is a ROSTER, not just
    // the marked rows — every active student appears, unmarked ones
    // with status NOT_MARKED, so the page never looks empty/broken
    // on a fresh day. Marked rows of since-removed students stay.
    if (req.query.date && !req.query.studentId) {
      const students = await prisma.student.findMany({
        where: {
          schoolId: req.params.schoolId, status: "ACTIVE",
          ...(req.query.classroomId ? { classroomId: req.query.classroomId } : {}),
        },
        select: { id: true, fullName: true, admissionNo: true, classroomId: true },
        orderBy: { fullName: "asc" },
      });
      const byStudent = new Map(rows.map((r) => [r.studentId, r]));
      const merged = students.map((st) => byStudent.get(st.id) || {
        id: null, studentId: st.id,
        localDate: new Date(`${req.query.date}T00:00:00.000Z`),
        status: "NOT_MARKED", entryAt: null, exitAt: null,
        isLate: false, reviewFlag: null, student: st,
      });
      const rosterIds = new Set(students.map((st) => st.id));
      for (const r of rows) if (!rosterIds.has(r.studentId)) merged.push(r);
      merged.sort((a, b) =>
        (a.status === "NOT_MARKED") - (b.status === "NOT_MARKED") ||
        (a.student?.fullName || "").localeCompare(b.student?.fullName || ""));
      return res.json({ attendance: merged });
    }
    return res.json({ attendance: rows });
  })
);

router.get(
  "/schools/:schoolId/attendance/staff",
  requireAuth,
  requireSchool(STAFF_READ),
  asyncRoute(async (req, res) => {
    const where = { schoolId: req.params.schoolId };
    if (req.query.date) where.localDate = new Date(`${req.query.date}T00:00:00.000Z`);
    const rows = await prisma.staffAttendance.findMany({
      where,
      include: { teacherProfile: { select: { id: true, displayName: true } } },
      orderBy: { localDate: "desc" },
      take: 500,
    });
    return res.json({ attendance: rows });
  })
);

// --- Correction workflow --------------------------------------------------------------
// Request -> admin/principal decides. No self-approval (middleware-level rule
// here AND a DB CHECK from the Phase 1 migration).
//
// Phase 57 (audit H2): correction me SIRF ye fields badal sakte
// hain. Pehle proposedChanges jaisa-aaya waisa decide par Prisma
// update me chala jata tha — schoolId/studentId tak badalna
// mumkin tha (attendance row dusri school me move ho sakti thi).
// Whitelist propose par bhi hai aur decide par bhi, taaki is fix
// se pehle ke pending requests bhi safe rahen.
const CORRECTION_FIELDS = ["status", "localDate", "entryAt", "exitAt", "checkInAt", "checkOutAt", "isLate", "isEarlyExit"];
const CORRECTION_STATUSES = ["PRESENT", "LATE", "ABSENT", "ON_LEAVE", "HALF_DAY"];
function cleanChanges(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!CORRECTION_FIELDS.includes(k)) return null;
    out[k] = v;
  }
  if (out.status !== undefined && !CORRECTION_STATUSES.includes(out.status)) return null;
  if (!Object.keys(out).length) return null;
  return out;
}
function pruneForModel(changes, entityType) {
  const out = { ...changes };
  if (entityType === "StaffAttendance") { delete out.entryAt; delete out.exitAt; delete out.isEarlyExit; }
  else { delete out.checkInAt; delete out.checkOutAt; }
  return out;
}
router.post(
  "/schools/:schoolId/attendance/corrections",
  requireAuth,
  requireSchool(STAFF_READ),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["entityType", "entityId", "reason", "proposedChanges"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const changes = cleanChanges(req.body.proposedChanges);
    if (!changes) return res.status(400).json({ error: "INVALID_CHANGES" });
    const model = req.body.entityType === "StaffAttendance" ? prisma.staffAttendance
      : req.body.entityType === "StudentAttendance" ? prisma.studentAttendance : null;
    if (!model) return res.status(400).json({ error: "INVALID_ENTITY_TYPE" });
    const entity = await model.findUnique({ where: { id: String(req.body.entityId) }, select: { schoolId: true } });
    if (!entity || entity.schoolId !== req.params.schoolId) return res.status(404).json({ error: "ENTITY_NOT_FOUND" });
    const request = await prisma.attendanceCorrectionRequest.create({
      data: {
        schoolId: req.params.schoolId,
        entityType: req.body.entityType,
        entityId: req.body.entityId,
        requestedByUserId: req.user.id,
        reason: req.body.reason,
        proposedChanges: pruneForModel(changes, req.body.entityType),
      },
    });
    return res.status(201).json({ request });
  })
);

// Phase 59 (UX): pending/decided correction requests ki LIST —
// pehle sirf POST tha, isiliye web par Approve/Reject ka koi
// screen hi nahi ban paya aur admin ek dead-end par atak jata tha.
// Admin ko school ke saare, teacher ko sirf apne requests.
router.get(
  "/schools/:schoolId/attendance/corrections",
  requireAuth,
  requireSchool(STAFF_READ),
  asyncRoute(async (req, res) => {
    const isAdmin = ["SCHOOL_ADMIN", "PRINCIPAL"].includes(req.membership.role);
    const requests = await prisma.attendanceCorrectionRequest.findMany({
      where: { schoolId: req.params.schoolId, ...(isAdmin ? {} : { requestedByUserId: req.user.id }) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const sIds = [...new Set(requests.filter((r) => r.entityType === "StudentAttendance").map((r) => r.entityId))];
    const tIds = [...new Set(requests.filter((r) => r.entityType === "StaffAttendance").map((r) => r.entityId))];
    const [sRows, tRows, users] = await Promise.all([
      sIds.length ? prisma.studentAttendance.findMany({ where: { id: { in: sIds } }, include: { student: { select: { fullName: true } } } }) : [],
      tIds.length ? prisma.staffAttendance.findMany({ where: { id: { in: tIds } }, include: { teacherProfile: { select: { displayName: true } } } }) : [],
      requests.length ? prisma.user.findMany({ where: { id: { in: [...new Set(requests.map((r) => r.requestedByUserId))] } }, select: { id: true, fullName: true } }) : [],
    ]);
    const sMap = new Map(sRows.map((r) => [r.id, r]));
    const tMap = new Map(tRows.map((r) => [r.id, r]));
    const uMap = new Map(users.map((u) => [u.id, u.fullName]));
    const out = requests.map((r) => {
      const row = r.entityType === "StudentAttendance" ? sMap.get(r.entityId) : tMap.get(r.entityId);
      return {
        ...r,
        personName: row ? (r.entityType === "StudentAttendance" ? row.student?.fullName : row.teacherProfile?.displayName) || null : null,
        currentStatus: row?.status || null,
        localDate: row?.localDate || null,
        requestedByName: uMap.get(r.requestedByUserId) || null,
      };
    });
    return res.json({ corrections: out });
  })
);

router.post(
  "/schools/:schoolId/attendance/corrections/:requestId/decide",
  requireAuth,
  requireSchool(ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const { decision, note } = req.body || {};
    if (!["APPROVED", "REJECTED"].includes(decision))
      return res.status(400).json({ error: "INVALID_DECISION" });
    const request = await prisma.attendanceCorrectionRequest.findFirst({
      where: { id: req.params.requestId, schoolId: req.params.schoolId },
    });
    if (!request) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    if (request.status !== "PENDING") return res.status(409).json({ error: "ALREADY_DECIDED" });
    if (request.requestedByUserId === req.user.id)
      return res.status(403).json({ error: "SELF_APPROVAL_FORBIDDEN" });

    const updated = await prisma.$transaction(async (tx) => {
      const decided = await tx.attendanceCorrectionRequest.update({
        where: { id: request.id },
        data: { status: decision, decidedByUserId: req.user.id, decidedAt: new Date(), decisionNote: note },
      });
      if (decision === "APPROVED") {
        const model = request.entityType === "StaffAttendance" ? tx.staffAttendance : tx.studentAttendance;
        const before = await model.findUnique({ where: { id: request.entityId } });
        if (before && before.schoolId === req.params.schoolId) {
          const changes = pruneForModel(cleanChanges(request.proposedChanges) || {}, request.entityType);
          if (changes.localDate) changes.localDate = new Date(`${changes.localDate}T00:00:00.000Z`);
          if (changes.entryAt) changes.entryAt = new Date(changes.entryAt);
          if (changes.exitAt) changes.exitAt = new Date(changes.exitAt);
          if (changes.checkInAt) changes.checkInAt = new Date(changes.checkInAt);
          if (changes.checkOutAt) changes.checkOutAt = new Date(changes.checkOutAt);
          const after = await model.update({ where: { id: request.entityId }, data: changes });
          await tx.attendanceAudit.create({
            data: {
              schoolId: req.params.schoolId,
              entityType: request.entityType,
              entityId: request.entityId,
              actorUserId: req.user.id,
              action: "CORRECT",
              reason: request.reason,
              before,
              after,
            },
          });
        }
      }
      return decided;
    });
    return res.json({ request: updated });
  })
);

router.get(
  "/schools/:schoolId/attendance/audit",
  requireAuth,
  requireSchool(ADMIN_ROLES),
  asyncRoute(async (req, res) => {
    const rows = await prisma.attendanceAudit.findMany({
      where: { schoolId: req.params.schoolId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return res.json({ audit: rows });
  })
);


// --- Student full record (Phase 76) ---------------------------------------------
// Shakir's rule: previous years = ONE line each (attendance %, exam
// average, achievement count — no detail); the current year = full
// detail (attendance, exam average + class rank, homework done /
// missed, PTM attended, functions attended, achievements list).
// Scope mirrors attendance-history: a parent sees only a
// guardian-linked child (404 otherwise); a teacher only her own
// classes. Achievement / EventAttendance tables arrive via
// apply-db-updates — until then the record serves without them
// (tablesReady=false), never a 500.
async function scopedStudent(req) {
  const schoolId = req.params.schoolId;
  const student = await prisma.student.findFirst({
    where: { id: req.params.studentId, schoolId },
    select: { id: true, fullName: true, admissionNo: true, classroomId: true, classroom: { select: { name: true, section: true } } },
  });
  if (!student) return null;
  const role = req.membership.role;
  if (role === "PARENT") {
    const link = await prisma.studentGuardian.findFirst({
      where: { schoolId, studentId: student.id, guardian: { userId: req.user.id } },
      select: { id: true },
    });
    if (!link) return null;
  } else if (role === "TEACHER") {
    const ids = await teacherClassIds(schoolId, req.membership.id);
    if (!student.classroomId || !ids.includes(student.classroomId)) return null;
  }
  return student;
}

router.get(
  "/schools/:schoolId/students/:studentId/record",
  requireAuth,
  requireSchool([...STAFF_READ, "PARENT"]),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const student = await scopedStudent(req);
    if (!student) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    const role = req.membership.role;
    const tz = req.school.timezone || "Asia/Kolkata";
    const today = localParts(new Date(), tz).dateStr;
    const dstr = (d) => d.toISOString().slice(0, 10);

    const years = await prisma.academicYear.findMany({ where: { schoolId }, orderBy: { startsOn: "desc" } });
    const cur =
      years.find((y) => y.isCurrent) ||
      years.find((y) => dstr(y.startsOn) <= today && today <= dstr(y.endsOn)) ||
      years[0] ||
      null;

    const blank = () => ({ marked: 0, present: 0, late: 0, absent: 0, onLeave: 0, halfDay: 0 });
    const pctOf = (a) => (a.marked ? Math.round(((a.present + a.late + 0.5 * a.halfDay) / a.marked) * 1000) / 10 : null);
    async function attSummary(fromD, toD) {
      const rows = await prisma.studentAttendance.findMany({
        where: { schoolId, studentId: student.id, localDate: { gte: fromD, lte: toD } },
        select: { status: true },
      });
      const a = blank();
      for (const r of rows) {
        a.marked++;
        if (r.status === "PRESENT") a.present++;
        else if (r.status === "LATE") a.late++;
        else if (r.status === "ABSENT") a.absent++;
        else if (r.status === "ON_LEAVE") a.onLeave++;
        else if (r.status === "HALF_DAY") a.halfDay++;
      }
      return { ...a, percentage: pctOf(a) };
    }
    async function examAvg(fromD, toD) {
      const marks = await prisma.examMark.findMany({
        where: {
          schoolId,
          studentId: student.id,
          exam: { examDate: { gte: fromD, lte: toD }, ...(role === "PARENT" ? { resultsPublished: true } : {}) },
        },
        select: { marksObtained: true, exam: { select: { maxMarks: true } } },
      });
      const pcts = marks.filter((m) => m.exam.maxMarks > 0).map((m) => (m.marksObtained / m.exam.maxMarks) * 100);
      return {
        count: pcts.length,
        averagePct: pcts.length ? Math.round((pcts.reduce((x, y) => x + y, 0) / pcts.length) * 10) / 10 : null,
      };
    }

    const tablesReady = await recordTablesReady();
    let allAchievements = [];
    let eventMarks = [];
    if (tablesReady) {
      allAchievements = await prisma.achievement.findMany({
        where: { schoolId, studentId: student.id },
        orderBy: { awardedOn: "desc" },
        select: { id: true, title: true, note: true, awardedOn: true },
      });
      eventMarks = await prisma.eventAttendance.findMany({
        where: { schoolId, studentId: student.id },
        select: { eventId: true, present: true },
      });
    }
    const achIn = (from, to) => allAchievements.filter((a) => dstr(a.awardedOn) >= from && dstr(a.awardedOn) <= to);

    let currentYear = null;
    if (cur) {
      const from = dstr(cur.startsOn);
      const to = dstr(cur.endsOn);
      const fromD = dateOnly(from);
      const toD = dateOnly(to);
      const attendance = await attSummary(fromD, toD);
      const exams = await examAvg(fromD, toD);

      // Class rank: classmates' average % over the same exams window.
      let rank = null;
      let classSize = 0;
      if (student.classroomId) {
        const classMarks = await prisma.examMark.findMany({
          where: {
            schoolId,
            exam: { classroomId: student.classroomId, examDate: { gte: fromD, lte: toD }, ...(role === "PARENT" ? { resultsPublished: true } : {}) },
          },
          select: { studentId: true, marksObtained: true, exam: { select: { maxMarks: true } } },
        });
        const byStudent = new Map();
        for (const m of classMarks) {
          if (!m.exam.maxMarks) continue;
          const arr = byStudent.get(m.studentId) || [];
          arr.push((m.marksObtained / m.exam.maxMarks) * 100);
          byStudent.set(m.studentId, arr);
        }
        const avgs = [...byStudent.values()].map((arr) => arr.reduce((x, y) => x + y, 0) / arr.length);
        classSize = avgs.length;
        if (exams.averagePct != null) rank = avgs.filter((a) => a > exams.averagePct).length + 1;
      }

      // Homework: class homework (untargeted) + homework targeted at
      // this student, due within the year and already due by today.
      const targetRows = await prisma.homeworkTarget.findMany({
        where: { schoolId, studentId: student.id },
        select: { homeworkId: true },
      });
      const orClauses = [{ id: { in: targetRows.map((t) => t.homeworkId) } }];
      if (student.classroomId) orClauses.push({ classroomId: student.classroomId, targets: { none: {} } });
      const assigned = await prisma.homework.findMany({
        where: { schoolId, dueDate: { gte: fromD, lte: dateOnly(today) }, OR: orClauses },
        select: { id: true },
      });
      const doneRows = assigned.length
        ? await prisma.homeworkCompletion.findMany({
            where: { schoolId, studentId: student.id, homeworkId: { in: assigned.map((h) => h.id) } },
            select: { homeworkId: true },
          })
        : [];
      const homework = { assigned: assigned.length, done: doneRows.length, missed: assigned.length - doneRows.length };

      // PTM: bookings on slots inside the year; a past slot counts attended.
      const bookings = await prisma.ptmBooking.findMany({
        where: { schoolId, studentId: student.id, status: "BOOKED" },
        select: { id: true, slot: { select: { date: true } } },
      });
      let ptmAttended = 0;
      let ptmUpcoming = 0;
      for (const b of bookings) {
        const d = dstr(b.slot.date);
        if (d < from || d > to) continue;
        if (d < today) ptmAttended++;
        else ptmUpcoming++;
      }

      // Functions: school events (not exams/PTM) inside the year.
      const events = await prisma.calendarEvent.findMany({
        where: { schoolId, eventDate: { gte: fromD, lte: toD }, type: { in: ["EVENT", "SPORTS", "CULTURAL"] } },
        orderBy: { eventDate: "desc" },
        select: { id: true, title: true, type: true, eventDate: true },
      });
      const markByEvent = new Map(eventMarks.map((m) => [m.eventId, m.present]));
      const fnItems = events.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        date: dstr(e.eventDate),
        past: dstr(e.eventDate) < today,
        attended: markByEvent.get(e.id) === true,
      }));
      const fnPast = fnItems.filter((f) => f.past);
      const functions = { total: fnPast.length, attended: fnPast.filter((f) => f.attended).length, items: fnItems };

      currentYear = {
        name: cur.name,
        attendance,
        exams: { ...exams, rank, classSize },
        homework,
        ptm: { attended: ptmAttended, upcoming: ptmUpcoming },
        functions,
        achievements: achIn(from, to).map((a) => ({ id: a.id, title: a.title, note: a.note, awardedOn: dstr(a.awardedOn) })),
      };
    }

    const previousYears = [];
    for (const y of years) {
      if (cur && y.id === cur.id) continue;
      const from = dstr(y.startsOn);
      const to = dstr(y.endsOn);
      const att = await attSummary(dateOnly(from), dateOnly(to));
      const ex = await examAvg(dateOnly(from), dateOnly(to));
      const achCount = achIn(from, to).length;
      if (!att.marked && !ex.count && !achCount) continue;
      previousYears.push({ name: y.name, attendancePct: att.percentage, examAvgPct: ex.averagePct, achievements: achCount });
    }

    return res.json({
      student: {
        id: student.id,
        fullName: student.fullName,
        admissionNo: student.admissionNo,
        classLabel: student.classroom ? `${student.classroom.name}${student.classroom.section ? "-" + student.classroom.section : ""}` : "",
      },
      tablesReady,
      currentYear,
      previousYears,
    });
  })
);

router.post(
  "/schools/:schoolId/students/:studentId/achievements",
  requireAuth,
  requireSchool([...STAFF_READ]),
  asyncRoute(async (req, res) => {
    if (!(await recordTablesReady())) return res.status(503).json({ error: "RECORD_TABLES_NOT_READY" });
    const student = await scopedStudent(req);
    if (!student) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    const title = String(req.body?.title || "").trim().slice(0, 120);
    if (!title) return res.status(400).json({ error: "TITLE_REQUIRED" });
    const note = String(req.body?.note || "").trim().slice(0, 300) || null;
    const tz = req.school.timezone || "Asia/Kolkata";
    const today = localParts(new Date(), tz).dateStr;
    let awardedOn = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.awardedOn || "") ? req.body.awardedOn : today;
    if (awardedOn > today) awardedOn = today;
    const created = await prisma.achievement.create({
      data: {
        schoolId: req.params.schoolId,
        studentId: student.id,
        title,
        note,
        awardedOn: dateOnly(awardedOn),
        createdByMembershipId: req.membership.id,
      },
      select: { id: true, title: true, note: true, awardedOn: true },
    });
    return res.status(201).json({ achievement: { ...created, awardedOn: created.awardedOn.toISOString().slice(0, 10) } });
  })
);

router.delete(
  "/schools/:schoolId/students/:studentId/achievements/:achievementId",
  requireAuth,
  requireSchool([...STAFF_READ]),
  asyncRoute(async (req, res) => {
    if (!(await recordTablesReady())) return res.status(503).json({ error: "RECORD_TABLES_NOT_READY" });
    const student = await scopedStudent(req);
    if (!student) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    const row = await prisma.achievement.findFirst({
      where: { id: req.params.achievementId, schoolId: req.params.schoolId, studentId: student.id },
      select: { id: true },
    });
    if (!row) return res.status(404).json({ error: "ACHIEVEMENT_NOT_FOUND" });
    await prisma.achievement.delete({ where: { id: row.id } });
    return res.json({ ok: true });
  })
);

router.post(
  "/schools/:schoolId/students/:studentId/event-attendance",
  requireAuth,
  requireSchool([...STAFF_READ]),
  asyncRoute(async (req, res) => {
    if (!(await recordTablesReady())) return res.status(503).json({ error: "RECORD_TABLES_NOT_READY" });
    const student = await scopedStudent(req);
    if (!student) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
    const eventId = String(req.body?.eventId || "");
    const present = req.body?.present === true;
    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, schoolId: req.params.schoolId },
      select: { id: true },
    });
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    await prisma.eventAttendance.upsert({
      where: { eventId_studentId: { eventId: event.id, studentId: student.id } },
      create: { schoolId: req.params.schoolId, eventId: event.id, studentId: student.id, present, markedByMembershipId: req.membership.id },
      update: { present, markedByMembershipId: req.membership.id },
    });
    return res.json({ ok: true, present });
  })
);

export default router;
