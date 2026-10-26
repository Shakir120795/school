// Fees (Phase 16, PDF §13) — ledger only; online gateway comes later.
// Money is integer paise end-to-end; the API accepts rupees at the edge.
// Invoice generation is idempotent per (student, generationKey).
// Payments produce school-sequential receipt numbers and drive the
// invoice status (UNPAID → PARTIAL → PAID). Parents see only their
// own children's invoices and payment history (the receipt data).
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { alertGuardians } from "../services/guardianAlerts.js";
import { sendNoticeCore } from "../services/notices.js";
import { processOutboxOnce } from "../services/outbox.js";

const router = Router();
const OFFICE = ["SCHOOL_ADMIN", "PRINCIPAL", "STAFF"]; // fee desk
const MANAGERS = ["SCHOOL_ADMIN", "PRINCIPAL"];
const ALL = [...OFFICE, "PARENT"];
const METHODS = ["CASH", "UPI", "BANK", "CHEQUE"];
const toPaise = (rupees) => Math.round(Number(rupees) * 100);

async function withPayments(invoice) {
  const payments = await prisma.feePayment.findMany({
    where: { invoiceId: invoice.id },
    orderBy: { createdAt: "asc" },
  });
  const items = await prisma.feeInvoiceItem.findMany({ where: { invoiceId: invoice.id } });
  const paidPaise = payments.reduce((a, p) => a + p.amountPaise, 0);
  return { ...invoice, items, payments, paidPaise, balancePaise: invoice.totalPaise - paidPaise };
}

async function myStudentIds(req, schoolId) {
  const guardians = await prisma.guardian.findMany({ where: { schoolId, userId: req.user.id }, select: { id: true } });
  if (!guardians.length) return [];
  const links = await prisma.studentGuardian.findMany({
    where: { schoolId, guardianId: { in: guardians.map((g) => g.id) } },
    select: { studentId: true },
  });
  return links.map((l) => l.studentId);
}

// --- Fee heads & structures (setup, managers) ---------------------------------
router.get("/schools/:schoolId/fee-heads", requireAuth, requireSchool(OFFICE), asyncRoute(async (req, res) => {
  const heads = await prisma.feeHead.findMany({ where: { schoolId: req.params.schoolId }, orderBy: { name: "asc" } });
  return res.json({ heads });
}));

router.post("/schools/:schoolId/fee-heads", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["name"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  const head = await prisma.feeHead.create({ data: { schoolId: req.params.schoolId, name: req.body.name } }).catch(() => null);
  if (!head) return res.status(409).json({ error: "HEAD_EXISTS" });
  return res.status(201).json({ head });
}));

router.get("/schools/:schoolId/fee-structures", requireAuth, requireSchool(OFFICE), asyncRoute(async (req, res) => {
  const structures = await prisma.feeStructure.findMany({
    where: { schoolId: req.params.schoolId },
    include: { classroom: true, feeHead: true },
    orderBy: [{ classroomId: "asc" }, { feeHeadId: "asc" }],
  });
  return res.json({ structures });
}));

router.post("/schools/:schoolId/fee-structures", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const missing = requireFields(req.body, ["classroomId", "feeHeadId", "amountRupees"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  const classroom = await prisma.classroom.findFirst({ where: { id: req.body.classroomId, schoolId } });
  if (!classroom) return res.status(404).json({ error: "CLASS_NOT_FOUND" });
  const head = await prisma.feeHead.findFirst({ where: { id: req.body.feeHeadId, schoolId } });
  if (!head) return res.status(404).json({ error: "HEAD_NOT_FOUND" });
  const amountPaise = toPaise(req.body.amountRupees);
  if (!amountPaise || amountPaise < 0) return res.status(400).json({ error: "INVALID_AMOUNT" });
  const structure = await prisma.feeStructure.upsert({
    where: {
      schoolId_classroomId_feeHeadId_frequency: {
        schoolId, classroomId: classroom.id, feeHeadId: head.id, frequency: req.body.frequency || "MONTHLY",
      },
    },
    create: { schoolId, classroomId: classroom.id, feeHeadId: head.id, amountPaise, frequency: req.body.frequency || "MONTHLY" },
    update: { amountPaise },
    include: { classroom: true, feeHead: true },
  });
  return res.status(201).json({ structure });
}));

// --- Invoice generation ---------------------------------------------------------
router.post("/schools/:schoolId/fees/generate", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const missing = requireFields(req.body, ["classroomId", "periodLabel", "dueDate"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  const frequency = req.body.frequency || "MONTHLY";
  const classroom = await prisma.classroom.findFirst({ where: { id: req.body.classroomId, schoolId } });
  if (!classroom) return res.status(404).json({ error: "CLASS_NOT_FOUND" });
  const structures = await prisma.feeStructure.findMany({
    where: { schoolId, classroomId: classroom.id, frequency },
    include: { feeHead: true },
  });
  if (!structures.length) return res.status(400).json({ error: "NO_STRUCTURE_FOR_CLASS_FREQUENCY" });
  const totalPaise = structures.reduce((a, s) => a + s.amountPaise, 0);
  const generationKey = `${classroom.id}|${req.body.periodLabel}|${frequency}`;
  const students = await prisma.student.findMany({ where: { schoolId, classroomId: classroom.id, status: "ACTIVE" } });
  const existing = await prisma.feeInvoice.findMany({
    where: { schoolId, generationKey },
    select: { studentId: true },
  });
  const have = new Set(existing.map((i) => i.studentId));
  let created = 0;
  for (const st of students) {
    if (have.has(st.id)) continue;
    await prisma.feeInvoice.create({
      data: {
        schoolId, studentId: st.id, classroomId: classroom.id,
        periodLabel: req.body.periodLabel,
        title: `Fees — ${req.body.periodLabel}`,
        totalPaise,
        dueDate: new Date(`${String(req.body.dueDate).slice(0, 10)}T00:00:00.000Z`),
        generationKey,
        createdByMembershipId: req.membership.id,
        feeInvoiceItems: { create: structures.map((s) => ({ feeHeadId: s.feeHeadId, label: s.feeHead.name, amountPaise: s.amountPaise })) },
      },
    });
    created++;
  }
  return res.status(201).json({ created, skipped: students.length - created, totalPaise, generationKey });
}));

// --- Invoices -------------------------------------------------------------------
router.get("/schools/:schoolId/fees/invoices", requireAuth, requireSchool(OFFICE), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const where = { schoolId };
  if (req.query.classroomId) where.classroomId = req.query.classroomId;
  if (req.query.status) where.status = req.query.status;
  if (req.query.studentId) where.studentId = req.query.studentId;
  const invoices = await prisma.feeInvoice.findMany({
    where,
    include: { student: { select: { id: true, fullName: true, admissionNo: true, classroom: { select: { name: true, section: true } } } } },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  const paidRows = await prisma.feePayment.groupBy({
    by: ["invoiceId"],
    where: { schoolId, invoiceId: { in: invoices.map((i) => i.id) } },
    _sum: { amountPaise: true },
  });
  const paidOf = Object.fromEntries(paidRows.map((r) => [r.invoiceId, r._sum.amountPaise || 0]));
  return res.json({
    invoices: invoices.map((i) => ({ ...i, paidPaise: paidOf[i.id] || 0, balancePaise: i.totalPaise - (paidOf[i.id] || 0) })),
  });
}));

router.get("/schools/:schoolId/fees/my-invoices", requireAuth, requireSchool(["PARENT"]), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const studentIds = await myStudentIds(req, schoolId);
  if (!studentIds.length) return res.json({ invoices: [] });
  const invoices = await prisma.feeInvoice.findMany({
    where: { schoolId, studentId: { in: studentIds } },
    include: { student: { select: { id: true, fullName: true, admissionNo: true } } },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });
  const out = [];
  for (const inv of invoices) out.push(await withPayments(inv));
  return res.json({ invoices: out });
}));

router.get("/schools/:schoolId/fees/invoices/:invoiceId", requireAuth, requireSchool(ALL), asyncRoute(async (req, res) => {
  const { schoolId, invoiceId } = req.params;
  const invoice = await prisma.feeInvoice.findFirst({
    where: { id: invoiceId, schoolId },
    include: { student: { select: { id: true, fullName: true, admissionNo: true } } },
  });
  if (!invoice) return res.status(404).json({ error: "NOT_FOUND" });
  if (req.membership.role === "PARENT") {
    const ids = await myStudentIds(req, schoolId);
    if (!ids.includes(invoice.studentId)) return res.status(404).json({ error: "NOT_FOUND" });
  }
  return res.json({ invoice: await withPayments(invoice) });
}));

// --- Payments ---------------------------------------------------------------------
router.post("/schools/:schoolId/fees/invoices/:invoiceId/payments", requireAuth, requireSchool(OFFICE), asyncRoute(async (req, res) => {
  const { schoolId, invoiceId } = req.params;
  const missing = requireFields(req.body, ["amountRupees"]);
  if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
  const method = req.body.method || "CASH";
  if (!METHODS.includes(method)) return res.status(400).json({ error: "INVALID_METHOD" });
  const amountPaise = toPaise(req.body.amountRupees);
  if (!amountPaise || amountPaise <= 0) return res.status(400).json({ error: "INVALID_AMOUNT" });
  const invoice = await prisma.feeInvoice.findFirst({ where: { id: invoiceId, schoolId }, include: { student: true } });
  if (!invoice) return res.status(404).json({ error: "NOT_FOUND" });
  if (invoice.status === "WAIVED") return res.status(409).json({ error: "INVOICE_WAIVED" });

  const result = await prisma.$transaction(async (tx) => {
    const paid = await tx.feePayment.aggregate({ where: { invoiceId }, _sum: { amountPaise: true } });
    const paidPaise = paid._sum.amountPaise || 0;
    const balance = invoice.totalPaise - paidPaise;
    if (amountPaise > balance) return { error: "OVERPAYMENT", balancePaise: balance };
    const count = await tx.feePayment.count({ where: { schoolId } });
    const receiptNo = `RCP-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
    const payment = await tx.feePayment.create({
      data: {
        schoolId, invoiceId, studentId: invoice.studentId, amountPaise, method,
        reference: req.body.reference, receiptNo, receivedByMembershipId: req.membership.id,
      },
    });
    const newPaid = paidPaise + amountPaise;
    const status = newPaid >= invoice.totalPaise ? "PAID" : "PARTIAL";
    const updated = await tx.feeInvoice.update({ where: { id: invoiceId }, data: { status } });
    return { payment, invoice: updated, paidPaise: newPaid, balancePaise: invoice.totalPaise - newPaid };
  });
  if (result.error) return res.status(400).json(result);
  await alertGuardians(
    schoolId, invoice.studentId,
    `💳 Fee payment received — ${invoice.periodLabel}`,
    `Payment of ₹${(amountPaise / 100).toLocaleString("en-IN")} received for ${invoice.student.fullName} (${invoice.periodLabel}) via ${method}. Receipt no: ${result.payment.receiptNo}. Balance remaining: ₹${(result.balancePaise / 100).toLocaleString("en-IN")}.`
  );
  return res.status(201).json(result);
}));

router.patch("/schools/:schoolId/fees/invoices/:invoiceId/waive", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const { schoolId, invoiceId } = req.params;
  const invoice = await prisma.feeInvoice.findFirst({ where: { id: invoiceId, schoolId } });
  if (!invoice) return res.status(404).json({ error: "NOT_FOUND" });
  const updated = await prisma.feeInvoice.update({ where: { id: invoiceId }, data: { status: "WAIVED" } });
  return res.json({ invoice: updated });
}));

// --- Defaulter reminders (Phase 29 WS7) -------------------------------------------
// Defaulters = guardians having at least one student invoice with a
// balance > 0 (status UNPAID/PARTIAL; balance = totalPaise − Σ payments,
// the same semantics as the invoice list above). One entry per guardian,
// aggregating every child's dues so a reminder is ONE notification per
// guardian, never one per invoice.
const inr = (paise) => "₹" + ((paise || 0) / 100).toLocaleString("en-IN");

async function computeDefaulters(schoolId) {
  const invoices = await prisma.feeInvoice.findMany({
    where: { schoolId, status: { in: ["UNPAID", "PARTIAL"] } },
    include: { student: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!invoices.length) return { byGuardian: new Map(), studentsWithDues: 0, totalDuePaise: 0 };
  const paidRows = await prisma.feePayment.groupBy({
    by: ["invoiceId"],
    where: { schoolId, invoiceId: { in: invoices.map((i) => i.id) } },
    _sum: { amountPaise: true },
  });
  const paidOf = Object.fromEntries(paidRows.map((r) => [r.invoiceId, r._sum.amountPaise || 0]));
  const dueByStudent = new Map(); // studentId -> { name, duePaise }
  for (const inv of invoices) {
    const balance = inv.totalPaise - (paidOf[inv.id] || 0);
    if (balance <= 0) continue;
    const cur = dueByStudent.get(inv.studentId) || { studentId: inv.studentId, name: inv.student.fullName, duePaise: 0 };
    cur.duePaise += balance;
    dueByStudent.set(inv.studentId, cur);
  }
  if (!dueByStudent.size) return { byGuardian: new Map(), studentsWithDues: 0, totalDuePaise: 0 };
  const links = await prisma.studentGuardian.findMany({
    where: { schoolId, studentId: { in: [...dueByStudent.keys()] } },
    select: { studentId: true, guardianId: true },
  });
  const byGuardian = new Map(); // guardianId -> { totalDuePaise, children: [{name, duePaise}] }
  for (const link of links) {
    const due = dueByStudent.get(link.studentId);
    if (!due) continue;
    const cur = byGuardian.get(link.guardianId) || { totalDuePaise: 0, children: [] };
    if (!cur.children.some((c) => c.studentId === due.studentId)) cur.children.push(due);
    cur.totalDuePaise += due.duePaise;
    byGuardian.set(link.guardianId, cur);
  }
  // All three numbers describe the same defaulter set: the students
  // counted are exactly those whose dues a guardian will be reminded
  // about (a student with dues but NO guardian link cannot be reminded
  // and is excluded from every count).
  let totalDuePaise = 0;
  const remindedStudents = new Set();
  for (const g of byGuardian.values()) {
    totalDuePaise += g.totalDuePaise;
    for (const c of g.children) remindedStudents.add(c.studentId);
  }
  return { byGuardian, studentsWithDues: remindedStudents.size, totalDuePaise };
}

router.get("/schools/:schoolId/fees/defaulters-preview", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const { byGuardian, studentsWithDues, totalDuePaise } = await computeDefaulters(req.params.schoolId);
  return res.json({ guardians: byGuardian.size, studentsWithDues, totalDuePaise });
}));

router.post("/schools/:schoolId/fees/remind-defaulters", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const { byGuardian, totalDuePaise } = await computeDefaulters(schoolId);
  let reminded = 0;
  for (const [guardianId, g] of byGuardian) {
    const names = g.children.map((c) => c.name).join(", ");
    const title = `Fees reminder — ${inr(g.totalDuePaise)} total due for ${names}`;
    const body =
      `Dear parent, fees of ${inr(g.totalDuePaise)} are pending for ${names}. ` +
      g.children.map((c) => `${c.name}: ${inr(c.duePaise)}`).join("; ") +
      `. Please pay at the school office at the earliest. Thank you.`;
    // Same pipeline as every other notice: Notice row + target, then
    // sendNoticeCore snapshots the recipient and writes the outbox event.
    const notice = await prisma.notice.create({
      data: {
        schoolId,
        senderMembershipId: req.membership.id,
        type: "ANNOUNCEMENT",
        audienceType: "SELECTED_GUARDIANS",
        title,
        body,
      },
    });
    await prisma.noticeTarget.create({ data: { schoolId, noticeId: notice.id, guardianId } });
    const sent = await sendNoticeCore(schoolId, { ...notice, targets: [{ guardianId }] });
    if (sent?.recipientCount) reminded++;
  }
  if (reminded && process.env.VERCEL) await processOutboxOnce().catch(() => {});
  return res.status(201).json({ reminded, totalDuePaise });
}));

// --- Summary -----------------------------------------------------------------------
router.get("/schools/:schoolId/fees/summary", requireAuth, requireSchool(OFFICE), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const invoices = await prisma.feeInvoice.findMany({ where: { schoolId } });
  const payments = await prisma.feePayment.aggregate({ where: { schoolId }, _sum: { amountPaise: true } });
  const today = new Date().toISOString().slice(0, 10);
  const billedPaise = invoices.filter((i) => i.status !== "WAIVED").reduce((a, i) => a + i.totalPaise, 0);
  const collectedPaise = payments._sum.amountPaise || 0;
  const overdue = invoices.filter((i) => ["UNPAID", "PARTIAL"].includes(i.status) && i.dueDate.toISOString().slice(0, 10) < today).length;
  const byStatus = {};
  for (const i of invoices) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
  return res.json({
    billedPaise, collectedPaise, pendingPaise: billedPaise - collectedPaise,
    invoiceCount: invoices.length, overdueCount: overdue, byStatus,
  });
}));

export default router;
