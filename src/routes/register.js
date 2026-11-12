// Register (Phase 66) — shakir ki "register book": class-wise har
// bacche ki (a) fees ki haalat — asal FeeInvoice ledger se derived
// (kul + Tuition + Exam alag-alag) aur (b) school kit — ID card,
// tie, belt, cap, bag mila ya nahi. Fees yahan sirf DIKHAYI jati
// hai; paisa Fees page se hi bharta hai (ek hi ledger, do jagah
// entry nahi). Kit ke columns Prisma schema me NAHI hain — raw
// SQL (studentCompat.kitReady probe), taaki live columns aane se
// pehle koi purana Student read na gire.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute } from "../utils/http.js";
import { teacherClassIds } from "../services/teacherClasses.js";
import { kitReady, KIT_FIELDS } from "../utils/studentCompat.js";
import { classLabel } from "../utils/parentChildren.js";

const router = Router();
const VIEW = ["SCHOOL_ADMIN", "PRINCIPAL", "STAFF", "TEACHER"];

const bucketStatus = (billed, paid) =>
  billed <= 0 ? "NONE" : paid >= billed ? "PAID" : paid > 0 ? "PARTIAL" : "DUE";

// Diye gaye students ke liye fees rollup: overall + tuition +
// exam. Payment invoice par lagta hai, isliye kisi head ka paid
// usi invoice ke paid share ke hisaab se banta hai.
export async function feeRollups(schoolId, studentIds) {
  const out = new Map();
  if (!studentIds.length) return out;
  const invoices = await prisma.feeInvoice.findMany({
    where: { schoolId, studentId: { in: studentIds }, status: { not: "WAIVED" } },
    select: {
      id: true, studentId: true, totalPaise: true,
      feeInvoiceItems: { select: { label: true, amountPaise: true } },
    },
  });
  if (invoices.length) {
    const paidRows = await prisma.feePayment.groupBy({
      by: ["invoiceId"],
      where: { schoolId, invoiceId: { in: invoices.map((i) => i.id) } },
      _sum: { amountPaise: true },
    });
    const paidOf = Object.fromEntries(paidRows.map((r) => [r.invoiceId, r._sum.amountPaise || 0]));
    for (const inv of invoices) {
      const paid = Math.min(paidOf[inv.id] || 0, inv.totalPaise);
      const share = inv.totalPaise > 0 ? paid / inv.totalPaise : 0;
      let r = out.get(inv.studentId);
      if (!r) {
        r = { billed: 0, paid: 0, tuition: { billed: 0, paid: 0 }, exam: { billed: 0, paid: 0 } };
        out.set(inv.studentId, r);
      }
      r.billed += inv.totalPaise; r.paid += paid;
      for (const it of inv.feeInvoiceItems) {
        const b = /exam/i.test(it.label) ? r.exam : /tuition/i.test(it.label) ? r.tuition : null;
        if (b) { b.billed += it.amountPaise; b.paid += Math.round(it.amountPaise * share); }
      }
    }
  }
  for (const [id, r] of out) {
    out.set(id, {
      status: bucketStatus(r.billed, r.paid),
      balancePaise: r.billed - r.paid,
      tuitionStatus: bucketStatus(r.tuition.billed, r.tuition.paid),
      examStatus: bucketStatus(r.exam.billed, r.exam.paid),
    });
  }
  return out;
}

const NO_FEES = { status: "NONE", balancePaise: 0, tuitionStatus: "NONE", examStatus: "NONE" };
const NO_KIT = { idCard: false, tie: false, belt: false, cap: false, bag: false };

// Kit ki haalat raw SQL se; columns live na hon to null.
export async function kitMap(studentIds) {
  if (!studentIds.length || !(await kitReady())) return null;
  const ph = studentIds.map((_, i) => `$${i + 1}`).join(",");
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "idCardIssued", "tieIssued", "beltIssued", "capIssued", "bagIssued" FROM "Student" WHERE "id" IN (${ph})`,
    ...studentIds
  );
  const m = new Map();
  for (const r of rows) {
    m.set(r.id, {
      idCard: !!r.idCardIssued, tie: !!r.tieIssued, belt: !!r.beltIssued,
      cap: !!r.capIssued, bag: !!r.bagIssued,
    });
  }
  return m;
}

// --- Office + teacher: poora register -----------------------------------------
router.get("/schools/:schoolId/register", requireAuth, requireSchool(VIEW), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const where = { schoolId, status: "ACTIVE" };
  if (req.membership.role === "TEACHER") {
    const ids = await teacherClassIds(schoolId, req.membership.id);
    where.classroomId = req.query.classroomId && ids.includes(req.query.classroomId)
      ? req.query.classroomId : { in: ids };
  } else if (req.query.classroomId) {
    where.classroomId = req.query.classroomId;
  }
  const students = await prisma.student.findMany({
    where,
    select: {
      id: true, fullName: true, admissionNo: true, classroomId: true,
      classroom: { select: { name: true, section: true } },
    },
    orderBy: [{ fullName: "asc" }],
    take: 1000,
  });
  const ids = students.map((s) => s.id);
  const [fees, kit] = await Promise.all([feeRollups(schoolId, ids), kitMap(ids)]);
  return res.json({
    kitReady: kit !== null,
    students: students.map((s) => ({
      id: s.id, fullName: s.fullName, admissionNo: s.admissionNo,
      classroomId: s.classroomId, classLabel: classLabel(s.classroom),
      fees: fees.get(s.id) || NO_FEES,
      kit: kit ? kit.get(s.id) || NO_KIT : null,
    })),
  });
}));

// --- Kit tick lagana / hatana ---------------------------------------------------
router.patch("/schools/:schoolId/register/:studentId/kit", requireAuth, requireSchool(VIEW), asyncRoute(async (req, res) => {
  if (!(await kitReady())) return res.status(503).json({ error: "KIT_NOT_READY" });
  const field = KIT_FIELDS.find((f) => f.key === String(req.body?.field || ""));
  if (!field || typeof req.body?.value !== "boolean") {
    return res.status(400).json({ error: "BAD_KIT_FIELD" });
  }
  const schoolId = req.params.schoolId;
  const student = await prisma.student.findFirst({
    where: { schoolId, id: req.params.studentId },
    select: { id: true, classroomId: true },
  });
  if (!student) return res.status(404).json({ error: "STUDENT_NOT_FOUND" });
  if (req.membership.role === "TEACHER") {
    const ids = await teacherClassIds(schoolId, req.membership.id);
    if (!student.classroomId || !ids.includes(student.classroomId)) {
      return res.status(403).json({ error: "NOT_YOUR_CLASS" });
    }
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "Student" SET "${field.column}" = $1, "updatedAt" = NOW() WHERE "id" = $2 AND "schoolId" = $3`,
    req.body.value, student.id, schoolId
  );
  return res.json({ ok: true, field: field.key, value: req.body.value });
}));

// --- Parent: sirf apne bacche ---------------------------------------------------
router.get("/schools/:schoolId/register/my", requireAuth, requireSchool(["PARENT"]), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const guardians = await prisma.guardian.findMany({
    where: { schoolId, userId: req.user.id }, select: { id: true },
  });
  const links = guardians.length
    ? await prisma.studentGuardian.findMany({
        where: { schoolId, guardianId: { in: guardians.map((g) => g.id) } },
        select: { studentId: true },
      })
    : [];
  const ids = links.map((l) => l.studentId);
  if (!ids.length) return res.json({ kitReady: await kitReady(), children: [] });
  const students = await prisma.student.findMany({
    where: { schoolId, id: { in: ids } },
    select: { id: true, fullName: true, classroom: { select: { name: true, section: true } } },
  });
  const [fees, kit] = await Promise.all([feeRollups(schoolId, ids), kitMap(ids)]);
  return res.json({
    kitReady: kit !== null,
    children: students.map((s) => ({
      id: s.id, fullName: s.fullName, classLabel: classLabel(s.classroom),
      fees: fees.get(s.id) || NO_FEES,
      kit: kit ? kit.get(s.id) || NO_KIT : null,
    })),
  });
}));

export default router;
