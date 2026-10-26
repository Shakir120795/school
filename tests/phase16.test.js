// Phase 16: fees — setup, generate (idempotent), payments, receipts, parent view.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, kid, kid2, tuition, transport, inv1;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase16");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  kid2 = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  const h1 = await H.api(base, "POST", `/schools/${S.schoolId}/fee-heads`, { token: S.adminToken, schoolId: S.schoolId, body: { name: "Tuition" } });
  const h2 = await H.api(base, "POST", `/schools/${S.schoolId}/fee-heads`, { token: S.adminToken, schoolId: S.schoolId, body: { name: "Transport" } });
  tuition = h1.json.head; transport = h2.json.head;
  await H.api(base, "POST", `/schools/${S.schoolId}/fee-structures`, { token: S.adminToken, schoolId: S.schoolId, body: { classroomId: cls.classId, feeHeadId: tuition.id, amountRupees: 1500, frequency: "MONTHLY" } });
  await H.api(base, "POST", `/schools/${S.schoolId}/fee-structures`, { token: S.adminToken, schoolId: S.schoolId, body: { classroomId: cls.classId, feeHeadId: transport.id, amountRupees: 500, frequency: "MONTHLY" } });
});

after(async () => { H.stopServer(server.child); await prisma.$disconnect(); });

async function deliver() {
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  await processOutboxOnce(50);
}

test("generate creates one ₹2,000 invoice per student; regenerating is a no-op", async () => {
  const gen = await H.api(base, "POST", `/schools/${S.schoolId}/fees/generate`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, periodLabel: "2026-11", dueDate: "2026-11-10", frequency: "MONTHLY" },
  });
  assert.equal(gen.status, 201);
  assert.equal(gen.json.created, 2);
  assert.equal(gen.json.totalPaise, 200000);
  const again = await H.api(base, "POST", `/schools/${S.schoolId}/fees/generate`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, periodLabel: "2026-11", dueDate: "2026-11-10", frequency: "MONTHLY" },
  });
  assert.equal(again.json.created, 0);
  assert.equal(again.json.skipped, 2);
  const list = await H.api(base, "GET", `/schools/${S.schoolId}/fees/invoices`, { token: S.adminToken, schoolId: S.schoolId });
  inv1 = list.json.invoices.find((i) => i.studentId === kid.studentId);
  assert.equal(inv1.balancePaise, 200000);
});

test("partial then full payment: statuses, receipt numbers, overpay blocked, parent alerted", async () => {
  const over = await H.api(base, "POST", `/schools/${S.schoolId}/fees/invoices/${inv1.id}/payments`, {
    token: S.adminToken, schoolId: S.schoolId, body: { amountRupees: 2500, method: "CASH" },
  });
  assert.equal(over.status, 400);
  assert.equal(over.json.error, "OVERPAYMENT");
  const p1 = await H.api(base, "POST", `/schools/${S.schoolId}/fees/invoices/${inv1.id}/payments`, {
    token: S.adminToken, schoolId: S.schoolId, body: { amountRupees: 1200, method: "UPI", reference: "txn-1" },
  });
  assert.equal(p1.status, 201);
  assert.match(p1.json.payment.receiptNo, /^RCP-\d{4}-0001$/);
  assert.equal(p1.json.invoice.status, "PARTIAL");
  assert.equal(p1.json.balancePaise, 80000);
  const p2 = await H.api(base, "POST", `/schools/${S.schoolId}/fees/invoices/${inv1.id}/payments`, {
    token: S.adminToken, schoolId: S.schoolId, body: { amountRupees: 800, method: "CASH" },
  });
  assert.equal(p2.json.invoice.status, "PAID");
  assert.match(p2.json.payment.receiptNo, /^RCP-\d{4}-0002$/);
  await deliver();
  const box = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.ok(box.json.notifications.some((n) => n.notice.title.includes("Fee payment received")), "parent got payment alert");
});

test("parent sees own invoices with payment history; summary math is exact", async () => {
  const mine = await H.api(base, "GET", `/schools/${S.schoolId}/fees/my-invoices`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(mine.json.invoices.length, 1);
  assert.equal(mine.json.invoices[0].balancePaise, 0);
  assert.equal(mine.json.invoices[0].payments.length, 2);
  const other = await H.api(base, "GET", `/schools/${S.schoolId}/fees/my-invoices`, { token: kid2.parentToken, schoolId: S.schoolId });
  assert.equal(other.json.invoices.length, 1, "second parent sees only their own child's invoice");
  assert.equal(other.json.invoices[0].studentId, kid2.studentId);
  const sum = await H.api(base, "GET", `/schools/${S.schoolId}/fees/summary`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(sum.json.billedPaise, 400000);
  assert.equal(sum.json.collectedPaise, 200000);
  assert.equal(sum.json.pendingPaise, 200000);
});

test("waive closes an invoice and blocks further payments", async () => {
  const list = await H.api(base, "GET", `/schools/${S.schoolId}/fees/invoices`, { token: S.adminToken, schoolId: S.schoolId });
  const inv2 = list.json.invoices.find((i) => i.studentId === kid2.studentId);
  const w = await H.api(base, "PATCH", `/schools/${S.schoolId}/fees/invoices/${inv2.id}/waive`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(w.json.invoice.status, "WAIVED");
  const pay = await H.api(base, "POST", `/schools/${S.schoolId}/fees/invoices/${inv2.id}/payments`, {
    token: S.adminToken, schoolId: S.schoolId, body: { amountRupees: 100 },
  });
  assert.equal(pay.status, 409);
});
