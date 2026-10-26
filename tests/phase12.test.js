// Phase 12: pickup persons, one-time approvals, release desk + alerts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, kid, kid2, uncle;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase12");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  kid2 = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  // Parent adds a standing authorised person for their own child.
  const r = await H.api(base, "POST", `/schools/${S.schoolId}/students/${kid.studentId}/pickup-persons`, {
    token: kid.parentToken, schoolId: S.schoolId,
    body: { fullName: "Ramesh Uncle", relationship: "Uncle", phone: "9811100000" },
  });
  assert.equal(r.status, 201);
  uncle = r.json.person;
});

after(async () => { H.stopServer(server.child); await prisma.$disconnect(); });

async function deliver() {
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  await processOutboxOnce(50);
}

test("parent isolation: another parent cannot see or approve for this child", async () => {
  const list = await H.api(base, "GET", `/schools/${S.schoolId}/students/${kid.studentId}/pickup-persons`, { token: kid2.parentToken, schoolId: S.schoolId });
  assert.equal(list.status, 404);
  const approve = await H.api(base, "POST", `/schools/${S.schoolId}/students/${kid.studentId}/pickup-approvals`, {
    token: kid2.parentToken, schoolId: S.schoolId, body: { pickupPersonId: uncle.id },
  });
  assert.equal(approve.status, 404);
});

test("one-time approval shows on the gate desk; release consumes it and alerts the parent", async () => {
  const ap = await H.api(base, "POST", `/schools/${S.schoolId}/students/${kid.studentId}/pickup-approvals`, {
    token: kid.parentToken, schoolId: S.schoolId, body: { pickupPersonId: uncle.id },
  });
  assert.equal(ap.status, 201);
  const today = await H.api(base, "GET", `/schools/${S.schoolId}/pickup/today`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(today.status, 200);
  assert.equal(today.json.approvals.length, 1);
  assert.equal(today.json.approvals[0].person.fullName, "Ramesh Uncle");

  const rel = await H.api(base, "POST", `/schools/${S.schoolId}/students/${kid.studentId}/release`, {
    token: S.adminToken, schoolId: S.schoolId, body: { approvalId: ap.json.approval.id },
  });
  assert.equal(rel.status, 201);
  assert.equal(rel.json.log.personName, "Ramesh Uncle");

  const today2 = await H.api(base, "GET", `/schools/${S.schoolId}/pickup/today`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(today2.json.approvals.length, 0, "approval consumed");
  assert.equal(today2.json.logs.length, 1);

  await deliver();
  const box = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.ok(box.json.notifications.some((n) => n.notice.title.includes("collected from school")), "parent got release alert");
});

test("standing person release works without an approval; rejection logs and alerts", async () => {
  const rel = await H.api(base, "POST", `/schools/${S.schoolId}/students/${kid.studentId}/release`, {
    token: S.adminToken, schoolId: S.schoolId, body: { pickupPersonId: uncle.id },
  });
  assert.equal(rel.status, 201);
  const rej = await H.api(base, "POST", `/schools/${S.schoolId}/students/${kid.studentId}/release`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { personName: "Unknown Man", outcome: "REJECTED", reason: "Not authorised" },
  });
  assert.equal(rej.status, 201);
  await deliver();
  const box = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.ok(box.json.notifications.some((n) => n.notice.title.includes("Pickup attempt rejected")), "parent got rejection alert");
  const logs = await H.api(base, "GET", `/schools/${S.schoolId}/students/${kid.studentId}/pickup-logs`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(logs.json.logs.length, 3);
});

test("deactivated person cannot collect", async () => {
  await H.api(base, "PATCH", `/schools/${S.schoolId}/pickup-persons/${uncle.id}`, { token: kid.parentToken, schoolId: S.schoolId, body: { isActive: false } });
  const rel = await H.api(base, "POST", `/schools/${S.schoolId}/students/${kid.studentId}/release`, {
    token: S.adminToken, schoolId: S.schoolId, body: { pickupPersonId: uncle.id },
  });
  assert.equal(rel.status, 400);
  assert.equal(rel.json.error, "PERSON_NOT_ACTIVE");
});
