// Leave applications (Phase 15, PDF §14).
// Parent applies for their own child → class teacher / admin /
// principal approves or rejects → on approval the range is written as
// ON_LEAVE in the daily attendance rows (days the child actually
// attended are never overwritten) and the parent is alerted in-app.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { teacherClassIds } from "../services/teacherClasses.js";
import { alertGuardians } from "../services/guardianAlerts.js";

const router = Router();
const STAFF = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"];
const ALL = [...STAFF, "PARENT"];
const MAX_DAYS = 60;

function dateOf(str) {
  return new Date(`${String(str).slice(0, 10)}T00:00:00.000Z`);
}
function eachDate(from, to) {
  const out = [];
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) out.push(new Date(d));
  return out;
}

async function myGuardianLinks(req, schoolId) {
  const guardians = await prisma.guardian.findMany({ where: { schoolId, userId: req.user.id }, select: { id: true } });
  if (!guardians.length) return { guardianIds: [], studentIds: [] };
  const links = await prisma.studentGuardian.findMany({
    where: { schoolId, guardianId: { in: guardians.map((g) => g.id) } },
    select: { studentId: true, guardianId: true },
  });
  return { guardianIds: guardians.map((g) => g.id), studentIds: links.map((l) => l.studentId), links };
}

async function staffScopeStudentIds(req, schoolId) {
  // null = all students (managers); array = teacher's class students
  if (req.membership.role !== "TEACHER") return null;
  const classIds = await teacherClassIds(schoolId, req.membership.id);
  const students = await prisma.student.findMany({ where: { schoolId, classroomId: { in: classIds } }, select: { id: true } });
  return students.map((s) => s.id);
}

router.post(
  "/schools/:schoolId/leave-applications",
  requireAuth,
  requireSchool(["PARENT"]),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const missing = requireFields(req.body, ["studentId", "fromDate", "toDate", "reason"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const { links } = await myGuardianLinks(req, schoolId);
    const link = links.find((l) => l.studentId === req.body.studentId);
    if (!link) return res.status(404).json({ error: "NOT_FOUND" });
    const from = dateOf(req.body.fromDate);
    const to = dateOf(req.body.toDate);
    if (isNaN(from) || isNaN(to) || to < from) return res.status(400).json({ error: "INVALID_DATE_RANGE" });
    const days = eachDate(from, to);
    if (days.length > MAX_DAYS) return res.status(400).json({ error: "RANGE_TOO_LONG", maxDays: MAX_DAYS });
    const app = await prisma.leaveApplication.create({
      data: {
        schoolId,
        studentId: req.body.studentId,
        guardianId: link.guardianId,
        fromDate: from,
        toDate: to,
        category: req.body.category,
        reason: req.body.reason,
      },
      include: { student: { select: { fullName: true, admissionNo: true } } },
    });
    return res.status(201).json({ application: app });
  })
);

router.get(
  "/schools/:schoolId/leave-applications",
  requireAuth,
  requireSchool(ALL),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    let where = { schoolId };
    if (req.query.status) where.status = req.query.status;
    if (req.membership.role === "PARENT") {
      const { studentIds } = await myGuardianLinks(req, schoolId);
      where.studentId = { in: studentIds };
    } else {
      const scoped = await staffScopeStudentIds(req, schoolId);
      if (scoped) where.studentId = { in: scoped };
    }
    const applications = await prisma.leaveApplication.findMany({
      where,
      include: {
        student: { select: { id: true, fullName: true, admissionNo: true, classroom: { select: { name: true, section: true } } } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
    });
    return res.json({ applications });
  })
);

router.patch(
  "/schools/:schoolId/leave-applications/:id/decision",
  requireAuth,
  requireSchool(STAFF),
  asyncRoute(async (req, res) => {
    const { schoolId, id } = req.params;
    const { decision, note } = req.body || {};
    if (!["APPROVED", "REJECTED"].includes(decision)) return res.status(400).json({ error: "INVALID_DECISION" });
    const app = await prisma.leaveApplication.findFirst({ where: { id, schoolId }, include: { student: true } });
    if (!app) return res.status(404).json({ error: "NOT_FOUND" });
    const scoped = await staffScopeStudentIds(req, schoolId);
    if (scoped && !scoped.includes(app.studentId)) return res.status(403).json({ error: "NOT_YOUR_CLASS" });
    if (app.status !== "PENDING") return res.status(409).json({ error: "ALREADY_DECIDED", status: app.status });

    let appliedDays = 0;
    let skippedDays = 0;
    if (decision === "APPROVED") {
      const days = eachDate(app.fromDate, app.toDate);
      const existing = await prisma.studentAttendance.findMany({
        where: { schoolId, studentId: app.studentId, localDate: { in: days } },
      });
      const byDate = Object.fromEntries(existing.map((r) => [r.localDate.toISOString().slice(0, 10), r]));
      await prisma.$transaction(async (tx) => {
        for (const d of days) {
          const key = d.toISOString().slice(0, 10);
          const row = byDate[key];
          if (!row) {
            await tx.studentAttendance.create({ data: { schoolId, studentId: app.studentId, localDate: d, status: "ON_LEAVE" } });
            appliedDays++;
          } else if (row.status === "ON_LEAVE") {
            appliedDays++;
          } else {
            skippedDays++; // the child actually has a real mark that day — never overwrite
          }
        }
      });
    }
    const updated = await prisma.leaveApplication.update({
      where: { id },
      data: { status: decision, decidedByMembershipId: req.membership.id, decisionNote: note },
    });
    const range = `${app.fromDate.toISOString().slice(0, 10)} → ${app.toDate.toISOString().slice(0, 10)}`;
    await alertGuardians(
      schoolId, app.studentId,
      decision === "APPROVED" ? `✅ Leave approved for ${app.student.fullName}` : `❌ Leave not approved for ${app.student.fullName}`,
      decision === "APPROVED"
        ? `Leave for ${app.student.fullName} (${range}) has been approved by ${req.user.fullName}. Those days are marked ON LEAVE in attendance.`
        : `The leave application for ${app.student.fullName} (${range}) was not approved by ${req.user.fullName}.${note ? ` Note: ${note}` : ""}`
    );
    return res.json({ application: updated, appliedDays, skippedDays });
  })
);

router.patch(
  "/schools/:schoolId/leave-applications/:id/cancel",
  requireAuth,
  requireSchool(["PARENT"]),
  asyncRoute(async (req, res) => {
    const { schoolId, id } = req.params;
    const app = await prisma.leaveApplication.findFirst({ where: { id, schoolId } });
    if (!app) return res.status(404).json({ error: "NOT_FOUND" });
    const { studentIds } = await myGuardianLinks(req, schoolId);
    if (!studentIds.includes(app.studentId)) return res.status(404).json({ error: "NOT_FOUND" });
    if (app.status !== "PENDING") return res.status(409).json({ error: "ALREADY_DECIDED", status: app.status });
    const updated = await prisma.leaveApplication.update({ where: { id }, data: { status: "CANCELLED" } });
    return res.json({ application: updated });
  })
);

export default router;
