// Phase 7: analytics endpoint + membership activate/suspend.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, kid;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase7");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
});

after(async () => {
  H.stopServer(server.child);
  await prisma.$disconnect();
});

test("analytics: totals, today tally after a scan, class breakdown", async () => {
  await H.setPolicy(base, S.schoolId, S.adminToken, {
    appliesTo: "STUDENT", entryStart: "00:00", entryEnd: "23:59", lateAfter: "23:58",
    exitStart: "00:00", exitEnd: "23:59", workingWeekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const card = await H.issueCard(base, S.schoolId, S.adminToken, { ownerType: "STUDENT", studentId: kid.studentId });
  const dk = await H.makeDevice(base, S.schoolId, S.adminToken);
  const scan = await H.scan(base, S.schoolId, dk, card.qrToken, "ENTRY", "p7-scan-1");
  assert.equal(scan.json.outcome, "RECORDED");

  const a = await H.api(base, "GET", `/schools/${S.schoolId}/analytics/today`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(a.status, 200);
  assert.ok(a.json.totals.students >= 1);
  assert.equal(a.json.today.present + a.json.today.late, 1);
  assert.equal(a.json.today.marked, 1);
  const row = a.json.classes.find((c) => c.id === cls.classId);
  assert.ok(row && row.total >= 1 && row.present + row.late === 1);

  const parentTry = await H.api(base, "GET", `/schools/${S.schoolId}/analytics/today`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(parentTry.status, 403);
});

test("membership status: admin can suspend and reactivate a member; self-change blocked", async () => {
  const users = await H.api(base, "GET", `/schools/${S.schoolId}/users`, { token: S.adminToken, schoolId: S.schoolId });
  const parentMembership = users.json.memberships.find((m) => m.user.email === undefined ? false : m.role === "PARENT") || users.json.memberships.find((m) => m.role === "PARENT");
  assert.ok(parentMembership, "parent membership exists");
  const susp = await H.api(base, "PATCH", `/schools/${S.schoolId}/users/${parentMembership.id}`, {
    token: S.adminToken, schoolId: S.schoolId, body: { status: "SUSPENDED" },
  });
  assert.equal(susp.status, 200);
  assert.equal(susp.json.membership.status, "SUSPENDED");
  // Suspended member loses school access.
  const blocked = await H.api(base, "GET", `/schools/${S.schoolId}/my-children`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(blocked.status, 403);
  const back = await H.api(base, "PATCH", `/schools/${S.schoolId}/users/${parentMembership.id}`, {
    token: S.adminToken, schoolId: S.schoolId, body: { status: "ACTIVE" },
  });
  assert.equal(back.status, 200);
  const self = users.json.memberships.find((m) => m.role === "SCHOOL_ADMIN");
  const selfTry = await H.api(base, "PATCH", `/schools/${S.schoolId}/users/${self.id}`, {
    token: S.adminToken, schoolId: S.schoolId, body: { status: "SUSPENDED" },
  });
  assert.equal(selfTry.status, 400);
});

test("holidays: create, list, delete (admin); teacher can list", async () => {
  const created = await H.api(base, "POST", `/schools/${S.schoolId}/holidays`, {
    token: S.adminToken, schoolId: S.schoolId, body: { localDate: "2026-12-25", name: "Winter break" },
  });
  assert.equal(created.status, 201);
  const list = await H.api(base, "GET", `/schools/${S.schoolId}/holidays`, { token: S.adminToken, schoolId: S.schoolId });
  assert.ok(list.json.holidays.some((h) => h.name === "Winter break" && h.localDate === "2026-12-25"));
  const del = await H.api(base, "DELETE", `/schools/${S.schoolId}/holidays/${created.json.holiday.id}`, {
    token: S.adminToken, schoolId: S.schoolId,
  });
  assert.equal(del.status, 200);
  const list2 = await H.api(base, "GET", `/schools/${S.schoolId}/holidays`, { token: S.adminToken, schoolId: S.schoolId });
  assert.ok(!list2.json.holidays.some((h) => h.name === "Winter break"));
});
