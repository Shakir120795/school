// Teacher class roll-call (Phase 13, PDF §7).
// The teacher marks their own class PRESENT / LATE / ABSENT / ON_LEAVE
// for a day. Roll-call writes the same daily attendance rows the gate
// scan engine uses — gate entry/exit times are never overwritten, a
// later gate ENTRY scan still wins for arrival truth, and marking a
// gate-entered child ABSENT raises a review flag instead of hiding the
// conflict. New ABSENT marks alert the child's guardians in-app.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute } from "../utils/http.js";
import { localParts } from "../utils/time.js";
import { alertGuardians } from "../services/guardianAlerts.js";

const router = Router();
const ROLES = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"];
const MARKABLE = ["PRESENT", "LATE", "ABSENT", "ON_LEAVE"];

async function teacherClassIds(req, schoolId) {
  const profile = await prisma.teacherProfile.findFirst({
    where: { schoolId, membershipId: req.membership.id },
    include: { classAssignments: true, inchargeAssignments: true },
  });
  if (!profile) return [];
  const ids = new Set();
  for (const a of profile.classAssignments) ids.add(a.classroomId);
  for (const i of profile.inchargeAssignments) {
    if (!i.effectiveTo || i.effectiveTo > new Date()) ids.add(i.classroomId);
  }
  return [...ids];
}

async function assertClassAccess(req, res, schoolId, classroomId) {
  if (req.membership.role === "TEACHER") {
    const ids = await teacherClassIds(req, schoolId);
    if (!ids.includes(classroomId)) {
      res.status(403).json({ error: "CLASS_NOT_ASSIGNED" });
      return false;
    }
  }
  const classroom = await prisma.classroom.findFirst({ where: { id: classroomId, schoolId } });
  if (!classroom) {
    res.status(404).json({ error: "CLASS_NOT_FOUND" });
    return false;
  }
  return true;
}

router.get(
  "/schools/:schoolId/rollcall/classes",
  requireAuth,
  requireSchool(ROLES),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    let where = { schoolId };
    if (req.membership.role === "TEACHER") {
      const ids = await teacherClassIds(req, schoolId);
      where = { schoolId, id: { in: ids } };
    }
    const classes = await prisma.classroom.findMany({ where, orderBy: [{ name: "asc" }, { section: "asc" }] });
    return res.json({ classes });
  })
);

router.get(
  "/schools/:schoolId/rollcall/roster",
  requireAuth,
  requireSchool(ROLES),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const classroomId = req.query.classroomId;
    if (!classroomId) return res.status(400).json({ error: "CLASSROOM_REQUIRED" });
    if (!(await assertClassAccess(req, res, schoolId, classroomId))) return;
    const date = req.query.date || localParts(new Date(), req.school.timezone).dateStr;
    const students = await prisma.student.findMany({
      where: { schoolId, classroomId, status: "ACTIVE" },
      orderBy: [{ rollNo: "asc" }, { fullName: "asc" }],
    });
    const rows = await prisma.studentAttendance.findMany({
      where: { schoolId, localDate: new Date(`${date}T00:00:00.000Z`), studentId: { in: students.map((s) => s.id) } },
    });
    const byStudent = Object.fromEntries(rows.map((r) => [r.studentId, r]));
    return res.json({
      date,
      classroomId,
      roster: students.map((s) => ({
        student: { id: s.id, fullName: s.fullName, admissionNo: s.admissionNo, rollNo: s.rollNo, photoUrl: s.photoUrl },
        attendance: byStudent[s.id]
          ? {
              status: byStudent[s.id].status,
              entryAt: byStudent[s.id].entryAt,
              exitAt: byStudent[s.id].exitAt,
              markedByMembershipId: byStudent[s.id].markedByMembershipId,
              markedAt: byStudent[s.id].markedAt,
              reviewFlag: byStudent[s.id].reviewFlag,
            }
          : null,
      })),
    });
  })
);

router.post(
  "/schools/:schoolId/rollcall",
  requireAuth,
  requireSchool(ROLES),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const { classroomId, marks } = req.body || {};
    if (!classroomId || !Array.isArray(marks) || !marks.length) {
      return res.status(400).json({ error: "CLASSROOM_AND_MARKS_REQUIRED" });
    }
    if (!(await assertClassAccess(req, res, schoolId, classroomId))) return;
    const date = req.body.date || localParts(new Date(), req.school.timezone).dateStr;
    const localDate = new Date(`${date}T00:00:00.000Z`);

    const students = await prisma.student.findMany({
      where: { schoolId, classroomId, status: "ACTIVE" },
      select: { id: true, fullName: true },
    });
    const validIds = new Set(students.map((s) => s.id));
    const nameOf = Object.fromEntries(students.map((s) => [s.id, s.fullName]));
    const clean = [];
    for (const m of marks) {
      if (!validIds.has(m.studentId)) return res.status(400).json({ error: "STUDENT_NOT_IN_CLASS", studentId: m.studentId });
      if (!MARKABLE.includes(m.status)) return res.status(400).json({ error: "INVALID_STATUS", status: m.status });
      clean.push(m);
    }

    const existing = await prisma.studentAttendance.findMany({
      where: { schoolId, localDate, studentId: { in: clean.map((m) => m.studentId) } },
    });
    const byStudent = Object.fromEntries(existing.map((r) => [r.studentId, r]));

    const conflicts = [];
    const newlyAbsent = [];
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const m of clean) {
        const row = byStudent[m.studentId];
        const conflict = row?.entryAt && m.status === "ABSENT";
        if (conflict) conflicts.push({ studentId: m.studentId, name: nameOf[m.studentId] });
        if (row) {
          await tx.studentAttendance.update({
            where: { id: row.id },
            data: {
              status: m.status,
              isLate: m.status === "LATE",
              markedByMembershipId: req.membership.id,
              markedAt: now,
              reviewFlag: conflict ? "ROLLCALL_ABSENT_WITH_GATE_ENTRY" : row.reviewFlag,
            },
          });
          if (m.status === "ABSENT" && row.status !== "ABSENT") newlyAbsent.push(m.studentId);
        } else {
          await tx.studentAttendance.create({
            data: {
              schoolId, studentId: m.studentId, localDate,
              status: m.status, isLate: m.status === "LATE",
              markedByMembershipId: req.membership.id, markedAt: now,
            },
          });
          if (m.status === "ABSENT") newlyAbsent.push(m.studentId);
        }
      }
    });

    // Absent alerts (best-effort, after the marks are saved).
    for (const studentId of newlyAbsent) {
      await alertGuardians(
        schoolId, studentId,
        `🔴 ${nameOf[studentId]} marked absent today`,
        `${nameOf[studentId]} was marked ABSENT in today's class roll-call (${date}). If this is unexpected, please contact the school.`
      );
    }
    return res.json({ saved: clean.length, date, conflicts, absentAlerts: newlyAbsent.length });
  })
);

export default router;
