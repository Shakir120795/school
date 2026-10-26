import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool, ADMIN_ROLES } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { hashToken } from "../utils/security.js";
import { processScan } from "../services/attendance.js";
import { alertGuardiansForScan } from "../services/scanAlerts.js";
import { localParts } from "../utils/time.js";

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
router.post(
  "/schools/:schoolId/attendance/corrections",
  requireAuth,
  requireSchool(STAFF_READ),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["entityType", "entityId", "reason", "proposedChanges"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const request = await prisma.attendanceCorrectionRequest.create({
      data: {
        schoolId: req.params.schoolId,
        entityType: req.body.entityType,
        entityId: req.body.entityId,
        requestedByUserId: req.user.id,
        reason: req.body.reason,
        proposedChanges: req.body.proposedChanges,
      },
    });
    return res.status(201).json({ request });
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
          const changes = { ...request.proposedChanges };
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

export default router;
