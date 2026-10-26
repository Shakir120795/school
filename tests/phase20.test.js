// Phase 20: support tickets (thread, status flow, isolation) + PTM booking.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, kid, kid2, ticketId, slotId;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase20");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  kid2 = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
});

after(async () => {
  // Drain this file's pending alert outbox rows so later test files
  // (shared test DB) never see Phase 20 notifications.
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  await processOutboxOnce(100).catch(() => {});
  H.stopServer(server.child);
  await prisma.$disconnect();
});

test("ticket: parent raises about own child; other parent gets 404; staff reply alerts and moves to IN_PROGRESS", async () => {
  const foreign = await H.api(base, "POST", `/schools/${S.schoolId}/tickets`, {
    token: kid2.parentToken, schoolId: S.schoolId,
    body: { subject: "x", body: "y", studentId: kid.studentId },
  });
  assert.equal(foreign.status, 404);
  const t = await H.api(base, "POST", `/schools/${S.schoolId}/tickets`, {
    token: kid.parentToken, schoolId: S.schoolId,
    body: { subject: "Bus route change", body: "Please shift our stop to Gate 2.", category: "TRANSPORT", studentId: kid.studentId },
  });
  assert.equal(t.status, 201);
  assert.equal(t.json.ticket.ticketNo, 1);
  ticketId = t.json.ticket.id;
  const read = await H.api(base, "GET", `/schools/${S.schoolId}/tickets/${ticketId}`, { token: kid2.parentToken, schoolId: S.schoolId });
  assert.equal(read.status, 404);
  const reply = await H.api(base, "POST", `/schools/${S.schoolId}/tickets/${ticketId}/messages`, {
    token: S.adminToken, schoolId: S.schoolId, body: { body: "Done from Monday." },
  });
  assert.equal(reply.status, 201);
  const thread = await H.api(base, "GET", `/schools/${S.schoolId}/tickets/${ticketId}`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(thread.json.ticket.status, "IN_PROGRESS");
  assert.equal(thread.json.messages.length, 2);
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  await processOutboxOnce();
  const inbox = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.ok(inbox.json.notifications.some((n) => (n.notice?.title || "").includes("Reply on your ticket #1")));
  const resolve = await H.api(base, "PATCH", `/schools/${S.schoolId}/tickets/${ticketId}/status`, {
    token: S.adminToken, schoolId: S.schoolId, body: { status: "RESOLVED" },
  });
  assert.equal(resolve.json.ticket.status, "RESOLVED");
  const parentResolve = await H.api(base, "PATCH", `/schools/${S.schoolId}/tickets/${ticketId}/status`, {
    token: kid.parentToken, schoolId: S.schoolId, body: { status: "OPEN" },
  });
  assert.equal(parentResolve.status, 403, "parents can only close their own tickets");
});

test("PTM: book a time, double-book blocked, cancel frees the slot, other child rebooks", async () => {
  const ptm = await H.api(base, "POST", `/schools/${S.schoolId}/ptm`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { title: "October PTM", date: "2026-11-05", startTime: "10:00", endTime: "11:00", slotMinutes: 15, classroomId: cls.classId },
  });
  assert.equal(ptm.status, 201);
  slotId = ptm.json.slot.id;
  const list = await H.api(base, "GET", `/schools/${S.schoolId}/ptm`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.deepEqual(list.json.slots.find((s) => s.id === slotId).times, ["10:00", "10:15", "10:30", "10:45"]);
  const book = await H.api(base, "POST", `/schools/${S.schoolId}/ptm/${slotId}/book`, {
    token: kid.parentToken, schoolId: S.schoolId, body: { studentId: kid.studentId, startTime: "10:15" },
  });
  assert.equal(book.status, 201);
  const clash = await H.api(base, "POST", `/schools/${S.schoolId}/ptm/${slotId}/book`, {
    token: kid2.parentToken, schoolId: S.schoolId, body: { studentId: kid2.studentId, startTime: "10:15" },
  });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.error, "TIME_TAKEN");
  const again = await H.api(base, "POST", `/schools/${S.schoolId}/ptm/${slotId}/book`, {
    token: kid.parentToken, schoolId: S.schoolId, body: { studentId: kid.studentId, startTime: "10:30" },
  });
  assert.equal(again.status, 409, "one booking per child per PTM");
  const cancel = await H.api(base, "DELETE", `/schools/${S.schoolId}/ptm/bookings/${book.json.booking.id}`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(cancel.status, 200);
  const rebook = await H.api(base, "POST", `/schools/${S.schoolId}/ptm/${slotId}/book`, {
    token: kid2.parentToken, schoolId: S.schoolId, body: { studentId: kid2.studentId, startTime: "10:15" },
  });
  assert.equal(rebook.status, 201, "cancelled time is bookable again");
});
