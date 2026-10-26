// Exams & marks (Phase 18, PDF §9).
// Teachers create exams for their classes and enter marks; parents
// see a report-card view (per-exam % and grade + overall) only AFTER
// the school publishes the results. Publishing announces the result
// to the class's parents through the notice pipeline.
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

export function gradeFor(pct) {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B+";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 40) return "D";
  return "F";
}
const pctOf = (obtained, max) => (max > 0 ? Math.round((obtained / max) * 1000) / 10 : 0);

async function canActOnClass(req, schoolId, classroomId) {
  if (req.membership.role !== "TEACHER") return true;
  const ids = await teacherClassIds(schoolId, req.membership.id);
  return ids.includes(classroomId);
}

async function examOr404(req, res, schoolId, examId) {
  const exam = await prisma.exam.findFirst({
    where: { id: examId, schoolId },
    include: { classroom: true, subject: true },
  });
  if (!exam) {
    res.status(404).json({ error: "NOT_FOUND" });
    return null;
  }
  return exam;
}

router.post("/schools/:schoolId/exams", requireAuth, requireSchool(STAFF), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const missing = requireFields(req.body, ["name", "classroomId", "subjectId", "examDate", "maxMarks"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  const classroom = await prisma.classroom.findFirst({ where: { id: req.body.classroomId, schoolId } });
  if (!classroom) return res.status(404).json({ error: "CLASS_NOT_FOUND" });
  if (!(await canActOnClass(req, schoolId, classroom.id))) return res.status(403).json({ error: "CLASS_NOT_ASSIGNED" });
  const subject = await prisma.subject.findFirst({ where: { id: req.body.subjectId, schoolId } });
  if (!subject) return res.status(400).json({ error: "SUBJECT_NOT_FOUND" });
  const maxMarks = Number(req.body.maxMarks);
  if (!maxMarks || maxMarks <= 0) return res.status(400).json({ error: "INVALID_MAX_MARKS" });
  const exam = await prisma.exam.create({
    data: {
      schoolId, name: req.body.name, classroomId: classroom.id, subjectId: subject.id,
      examDate: new Date(`${String(req.body.examDate).slice(0, 10)}T00:00:00.000Z`),
      maxMarks, createdByMembershipId: req.membership.id,
    },
    include: { classroom: true, subject: true },
  });
  return res.status(201).json({ exam });
}));

router.get("/schools/:schoolId/exams", requireAuth, requireSchool(STAFF), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const where = { schoolId };
  if (req.query.classroomId) where.classroomId = req.query.classroomId;
  if (req.membership.role === "TEACHER") {
    const ids = await teacherClassIds(schoolId, req.membership.id);
    where.classroomId = req.query.classroomId && ids.includes(req.query.classroomId) ? req.query.classroomId : { in: ids };
  }
  const exams = await prisma.exam.findMany({
    where,
    include: { classroom: true, subject: true },
    orderBy: [{ examDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const counts = await prisma.examMark.groupBy({
    by: ["examId"],
    where: { schoolId, examId: { in: exams.map((e) => e.id) } },
    _count: { _all: true },
  });
  const countOf = Object.fromEntries(counts.map((c) => [c.examId, c._count._all]));
  return res.json({ exams: exams.map((e) => ({ ...e, marksEntered: countOf[e.id] || 0 })) });
}));

router.get("/schools/:schoolId/exams/:examId/marks", requireAuth, requireSchool(STAFF), asyncRoute(async (req, res) => {
  const { schoolId, examId } = req.params;
  const exam = await examOr404(req, res, schoolId, examId);
  if (!exam) return;
  if (!(await canActOnClass(req, schoolId, exam.classroomId))) return res.status(403).json({ error: "CLASS_NOT_ASSIGNED" });
  const students = await prisma.student.findMany({
    where: { schoolId, classroomId: exam.classroomId, status: "ACTIVE" },
    orderBy: [{ rollNo: "asc" }, { fullName: "asc" }],
  });
  const marks = await prisma.examMark.findMany({ where: { schoolId, examId } });
  const markOf = Object.fromEntries(marks.map((m) => [m.studentId, m]));
  return res.json({
    exam,
    students: students.map((s) => ({
      id: s.id, fullName: s.fullName, admissionNo: s.admissionNo, rollNo: s.rollNo,
      marksObtained: markOf[s.id]?.marksObtained ?? null,
      remark: markOf[s.id]?.remark ?? null,
    })),
  });
}));

router.put("/schools/:schoolId/exams/:examId/marks", requireAuth, requireSchool(STAFF), asyncRoute(async (req, res) => {
  const { schoolId, examId } = req.params;
  const exam = await examOr404(req, res, schoolId, examId);
  if (!exam) return;
  if (!(await canActOnClass(req, schoolId, exam.classroomId))) return res.status(403).json({ error: "CLASS_NOT_ASSIGNED" });
  const entries = req.body?.marks;
  if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: "MARKS_REQUIRED" });
  const students = await prisma.student.findMany({
    where: { schoolId, classroomId: exam.classroomId, status: "ACTIVE" },
    select: { id: true },
  });
  const validIds = new Set(students.map((s) => s.id));
  for (const e of entries) {
    if (!validIds.has(e.studentId)) return res.status(400).json({ error: "STUDENT_NOT_IN_CLASS", studentId: e.studentId });
    const v = Number(e.marksObtained);
    if (isNaN(v) || v < 0 || v > exam.maxMarks) {
      return res.status(400).json({ error: "MARKS_OUT_OF_RANGE", studentId: e.studentId, maxMarks: exam.maxMarks });
    }
  }
  await prisma.$transaction(async (tx) => {
    for (const e of entries) {
      await tx.examMark.upsert({
        where: { examId_studentId: { examId, studentId: e.studentId } },
        create: { schoolId, examId, studentId: e.studentId, marksObtained: Number(e.marksObtained), remark: e.remark, enteredByMembershipId: req.membership.id },
        update: { marksObtained: Number(e.marksObtained), remark: e.remark, enteredByMembershipId: req.membership.id },
      });
    }
  });
  return res.json({ saved: entries.length });
}));

router.patch("/schools/:schoolId/exams/:examId/publish", requireAuth, requireSchool(STAFF), asyncRoute(async (req, res) => {
  const { schoolId, examId } = req.params;
  const exam = await examOr404(req, res, schoolId, examId);
  if (!exam) return;
  if (!(await canActOnClass(req, schoolId, exam.classroomId))) return res.status(403).json({ error: "CLASS_NOT_ASSIGNED" });
  const published = !!req.body?.published;
  const updated = await prisma.exam.update({ where: { id: examId }, data: { resultsPublished: published } });
  if (published && !exam.resultsPublished) {
    try {
      const notice = await prisma.notice.create({
        data: {
          schoolId, senderMembershipId: req.membership.id, type: "ANNOUNCEMENT",
          audienceType: "ASSIGNED_CLASS",
          title: `📊 Results published: ${exam.name}`,
          body: `Results for ${exam.name} (${exam.subject.name}, Class ${exam.classroom.name}${exam.classroom.section ? "-" + exam.classroom.section : ""}) are now available in the Exams section of the app.`,
        },
      });
      await prisma.noticeTarget.create({ data: { schoolId, noticeId: notice.id, classroomId: exam.classroomId } });
      await sendNoticeCore(schoolId, { ...notice, targets: [{ classroomId: exam.classroomId }] });
      if (process.env.VERCEL) await processOutboxOnce().catch(() => {});
    } catch (e) {
      console.error("[exam-publish-announce] failed:", e?.message || e);
    }
  }
  return res.json({ exam: updated });
}));

router.delete("/schools/:schoolId/exams/:examId", requireAuth, requireSchool(STAFF), asyncRoute(async (req, res) => {
  const { schoolId, examId } = req.params;
  const exam = await examOr404(req, res, schoolId, examId);
  if (!exam) return;
  if (req.membership.role === "TEACHER" && exam.createdByMembershipId !== req.membership.id) {
    return res.status(403).json({ error: "NOT_YOUR_EXAM" });
  }
  await prisma.exam.delete({ where: { id: examId } });
  return res.json({ deleted: true });
}));

// Report card: one student, all exams (staff: all; parent: published only, own child)
router.get("/schools/:schoolId/exams/report", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const studentId = req.query.studentId;
  if (!studentId) return res.status(400).json({ error: "STUDENT_REQUIRED" });
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId },
    include: { classroom: true },
  });
  if (!student) return res.status(404).json({ error: "NOT_FOUND" });
  if (req.membership.role === "PARENT") {
    const guardians = await prisma.guardian.findMany({ where: { schoolId, userId: req.user.id }, select: { id: true } });
    const link = guardians.length
      ? await prisma.studentGuardian.findFirst({ where: { schoolId, studentId, guardianId: { in: guardians.map((g) => g.id) } } })
      : null;
    if (!link) return res.status(404).json({ error: "NOT_FOUND" });
  }
  const examWhere = { schoolId, classroomId: student.classroomId };
  if (req.membership.role === "PARENT") examWhere.resultsPublished = true;
  const exams = await prisma.exam.findMany({
    where: examWhere,
    include: { subject: true },
    orderBy: [{ examDate: "asc" }],
  });
  const marks = await prisma.examMark.findMany({ where: { schoolId, studentId, examId: { in: exams.map((e) => e.id) } } });
  const markOf = Object.fromEntries(marks.map((m) => [m.examId, m]));
  const rows = exams
    .filter((e) => markOf[e.id])
    .map((e) => {
      const obtained = markOf[e.id].marksObtained;
      const pct = pctOf(obtained, e.maxMarks);
      return {
        examId: e.id, examName: e.name, subjectName: e.subject.name, examDate: e.examDate,
        maxMarks: e.maxMarks, marksObtained: obtained, percentage: pct, grade: gradeFor(pct),
        remark: markOf[e.id].remark,
      };
    });
  const totalMax = rows.reduce((a, r) => a + r.maxMarks, 0);
  const totalObtained = rows.reduce((a, r) => a + r.marksObtained, 0);
  const overallPct = pctOf(totalObtained, totalMax);
  return res.json({
    student: { id: student.id, fullName: student.fullName, admissionNo: student.admissionNo, className: `${student.classroom?.name || ""}${student.classroom?.section ? "-" + student.classroom.section : ""}` },
    rows,
    overall: rows.length ? { totalMax, totalObtained, percentage: overallPct, grade: gradeFor(overallPct) } : null,
  });
}));

export default router;
