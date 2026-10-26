// Homework (Phase 14, PDF §10).
// Teachers assign homework to their classes; creating it announces the
// homework to the class's parents through the notice pipeline (type
// HOMEWORK). Parents see homework per child and toggle "done";
// teachers see exactly which students have completed it.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { teacherClassIds } from "../services/teacherClasses.js";
import { sendNoticeCore } from "../services/notices.js";
import { processOutboxOnce } from "../services/outbox.js";

const router = Router();
const STAFF = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"];
const ALL = [...STAFF, "PARENT"];

async function canActOnClass(req, schoolId, classroomId) {
  if (req.membership.role !== "TEACHER") return true;
  const ids = await teacherClassIds(schoolId, req.membership.id);
  return ids.includes(classroomId);
}

async function myChildrenClassIds(req, schoolId) {
  const guardians = await prisma.guardian.findMany({ where: { schoolId, userId: req.user.id }, select: { id: true } });
  if (!guardians.length) return { guardianIds: [], childClass: new Map(), children: [] };
  const links = await prisma.studentGuardian.findMany({
    where: { schoolId, guardianId: { in: guardians.map((g) => g.id) } },
    include: { student: { select: { id: true, classroomId: true, fullName: true } } },
  });
  const childClass = new Map();
  const children = [];
  for (const l of links) {
    childClass.set(l.student.id, l.student.classroomId);
    children.push({ id: l.student.id, fullName: l.student.fullName, classroomId: l.student.classroomId });
  }
  return { guardianIds: guardians.map((g) => g.id), childClass, children };
}

router.post(
  "/schools/:schoolId/homework",
  requireAuth,
  requireSchool(STAFF),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    const missing = requireFields(req.body, ["classroomId", "title", "dueDate"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const classroom = await prisma.classroom.findFirst({ where: { id: req.body.classroomId, schoolId } });
    if (!classroom) return res.status(404).json({ error: "CLASS_NOT_FOUND" });
    if (!(await canActOnClass(req, schoolId, classroom.id))) return res.status(403).json({ error: "CLASS_NOT_ASSIGNED" });
    if (req.body.subjectId) {
      const subject = await prisma.subject.findFirst({ where: { id: req.body.subjectId, schoolId } });
      if (!subject) return res.status(400).json({ error: "SUBJECT_NOT_FOUND" });
    }
    const hw = await prisma.homework.create({
      data: {
        schoolId,
        classroomId: classroom.id,
        subjectId: req.body.subjectId,
        title: req.body.title,
        description: req.body.description,
        dueDate: new Date(`${String(req.body.dueDate).slice(0, 10)}T00:00:00.000Z`),
        attachmentUrl: req.body.attachmentUrl,
        createdByMembershipId: req.membership.id,
      },
      include: { classroom: true, subject: true },
    });
    // Announce to the class's parents via the notice pipeline.
    try {
      const notice = await prisma.notice.create({
        data: {
          schoolId,
          senderMembershipId: req.membership.id,
          type: "HOMEWORK",
          audienceType: "ASSIGNED_CLASS",
          title: `📚 Homework: ${hw.title}`,
          body: `${hw.title}${hw.subject ? ` (${hw.subject.name})` : ""} for Class ${classroom.name}${classroom.section ? "-" + classroom.section : ""}. Due: ${String(req.body.dueDate).slice(0, 10)}.${hw.description ? " " + hw.description : ""}`,
        },
      });
      await prisma.noticeTarget.create({ data: { schoolId, noticeId: notice.id, classroomId: classroom.id } });
      await sendNoticeCore(schoolId, { ...notice, targets: [{ classroomId: classroom.id }] });
      if (process.env.VERCEL) await processOutboxOnce().catch(() => {});
    } catch (e) {
      console.error("[homework-announce] failed:", e?.message || e);
    }
    return res.status(201).json({ homework: hw });
  })
);

router.get(
  "/schools/:schoolId/homework",
  requireAuth,
  requireSchool(ALL),
  asyncRoute(async (req, res) => {
    const schoolId = req.params.schoolId;
    if (req.membership.role === "PARENT") {
      const { childClass, children } = await myChildrenClassIds(req, schoolId);
      const classIds = [...new Set(children.map((c) => c.classroomId).filter(Boolean))];
      if (!classIds.length) return res.json({ homework: [], children: [] });
      const homework = await prisma.homework.findMany({
        where: { schoolId, classroomId: { in: classIds } },
        include: { classroom: true, subject: true },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 100,
      });
      const completions = await prisma.homeworkCompletion.findMany({
        where: { schoolId, studentId: { in: children.map((c) => c.id) }, homeworkId: { in: homework.map((h) => h.id) } },
      });
      const doneSet = new Set(completions.map((c) => `${c.homeworkId}:${c.studentId}`));
      return res.json({
        children,
        homework: homework.map((h) => ({
          ...h,
          forChildren: children
            .filter((c) => c.classroomId === h.classroomId)
            .map((c) => ({ studentId: c.id, fullName: c.fullName, done: doneSet.has(`${h.id}:${c.id}`) })),
        })),
      });
    }
    // Staff view
    let where = { schoolId };
    if (req.query.classroomId) where.classroomId = req.query.classroomId;
    if (req.membership.role === "TEACHER") {
      const ids = await teacherClassIds(schoolId, req.membership.id);
      where.classroomId = req.query.classroomId && ids.includes(req.query.classroomId)
        ? req.query.classroomId
        : { in: ids };
    }
    const homework = await prisma.homework.findMany({
      where,
      include: { classroom: true, subject: true },
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    const counts = await prisma.homeworkCompletion.groupBy({
      by: ["homeworkId"],
      where: { schoolId, homeworkId: { in: homework.map((h) => h.id) } },
      _count: { _all: true },
    });
    const countOf = Object.fromEntries(counts.map((c) => [c.homeworkId, c._count._all]));
    const classSizes = {};
    for (const h of homework) {
      if (classSizes[h.classroomId] === undefined) {
        classSizes[h.classroomId] = await prisma.student.count({ where: { schoolId, classroomId: h.classroomId, status: "ACTIVE" } });
      }
    }
    return res.json({
      homework: homework.map((h) => ({ ...h, completedCount: countOf[h.id] || 0, classSize: classSizes[h.classroomId] })),
    });
  })
);

router.get(
  "/schools/:schoolId/homework/:homeworkId/completions",
  requireAuth,
  requireSchool(STAFF),
  asyncRoute(async (req, res) => {
    const { schoolId, homeworkId } = req.params;
    const hw = await prisma.homework.findFirst({ where: { id: homeworkId, schoolId } });
    if (!hw) return res.status(404).json({ error: "NOT_FOUND" });
    if (!(await canActOnClass(req, schoolId, hw.classroomId))) return res.status(403).json({ error: "CLASS_NOT_ASSIGNED" });
    const students = await prisma.student.findMany({
      where: { schoolId, classroomId: hw.classroomId, status: "ACTIVE" },
      orderBy: [{ rollNo: "asc" }, { fullName: "asc" }],
    });
    const completions = await prisma.homeworkCompletion.findMany({ where: { schoolId, homeworkId } });
    const doneOf = Object.fromEntries(completions.map((c) => [c.studentId, c]));
    return res.json({
      homework: hw,
      students: students.map((s) => ({ id: s.id, fullName: s.fullName, admissionNo: s.admissionNo, done: !!doneOf[s.id], doneAt: doneOf[s.id]?.createdAt || null })),
    });
  })
);

router.post(
  "/schools/:schoolId/homework/:homeworkId/complete",
  requireAuth,
  requireSchool(["PARENT"]),
  asyncRoute(async (req, res) => {
    const { schoolId, homeworkId } = req.params;
    const { studentId } = req.body || {};
    if (!studentId) return res.status(400).json({ error: "STUDENT_REQUIRED" });
    const hw = await prisma.homework.findFirst({ where: { id: homeworkId, schoolId } });
    if (!hw) return res.status(404).json({ error: "NOT_FOUND" });
    const { guardianIds, childClass } = await myChildrenClassIds(req, schoolId);
    if (!childClass.has(studentId) || childClass.get(studentId) !== hw.classroomId) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    const existing = await prisma.homeworkCompletion.findUnique({
      where: { homeworkId_studentId: { homeworkId, studentId } },
    });
    if (existing) {
      await prisma.homeworkCompletion.delete({ where: { id: existing.id } });
      return res.json({ done: false });
    }
    await prisma.homeworkCompletion.create({
      data: { schoolId, homeworkId, studentId, guardianId: guardianIds[0] || null, markedByUserId: req.user.id },
    });
    return res.json({ done: true });
  })
);

router.delete(
  "/schools/:schoolId/homework/:homeworkId",
  requireAuth,
  requireSchool(STAFF),
  asyncRoute(async (req, res) => {
    const { schoolId, homeworkId } = req.params;
    const hw = await prisma.homework.findFirst({ where: { id: homeworkId, schoolId } });
    if (!hw) return res.status(404).json({ error: "NOT_FOUND" });
    if (req.membership.role === "TEACHER" && hw.createdByMembershipId !== req.membership.id) {
      return res.status(403).json({ error: "NOT_YOUR_HOMEWORK" });
    }
    await prisma.homework.delete({ where: { id: homeworkId } });
    return res.json({ deleted: true });
  })
);

export default router;
