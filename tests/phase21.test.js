// Phase 21: platform console (list/suspend/delete/reset) + team
// password reset + demo OTP 123456.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, kid, teacherMembershipId, teacherEmail, adminEmail;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({ OTP_PROVIDER: "demo" });
  base = server.base;
  S = await H.bootstrapSchool(base, "phase21");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  const t = await H.makeTeacher(base, S.schoolId, S.adminToken);
  const users = await H.api(base, "GET", `/schools/${S.schoolId}/users`, { token: S.adminToken, schoolId: S.schoolId });
  const tm = users.json.memberships.find((m) => m.id === t.membershipId);
  teacherMembershipId = t.membershipId;
  teacherEmail = tm.user.email;
});

after(async () => { H.stopServer(server.child); await prisma.$disconnect(); });

test("console list is operator-only and shows counts + admin email", async () => {
  const denied = await H.api(base, "GET", "/platform/schools", { token: S.adminToken });
  assert.equal(denied.status, 403);
  const list = await H.api(base, "GET", "/platform/schools", { token: S.opToken });
  assert.equal(list.status, 200);
  const mine = list.json.schools.find((s) => s.id === S.schoolId);
  assert.ok(mine, "bootstrapped school is listed");
  assert.equal(mine.students, 1);
  assert.equal(mine.teachers, 1);
  assert.ok(mine.adminEmail && mine.adminEmail.endsWith("@test.dev"));
  adminEmail = mine.adminEmail;
});

test("suspend freezes member access; reactivate restores it", async () => {
  const sus = await H.api(base, "PATCH", `/platform/schools/${S.schoolId}/status`, { token: S.opToken, body: { status: "SUSPENDED" } });
  assert.equal(sus.status, 200);
  const blocked = await H.api(base, "GET", `/schools/${S.schoolId}`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error, "SCHOOL_SUSPENDED");
  const back = await H.api(base, "PATCH", `/platform/schools/${S.schoolId}/status`, { token: S.opToken, body: { status: "ACTIVE" } });
  assert.equal(back.status, 200);
  const ok = await H.api(base, "GET", `/schools/${S.schoolId}`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(ok.status, 200);
});

test("operator resets the school admin password; school admin resets a teacher password", async () => {
  const r = await H.api(base, "POST", `/platform/schools/${S.schoolId}/reset-admin-password`, { token: S.opToken, body: { newPassword: "NewAdmin99!" } });
  assert.equal(r.status, 200);
  const oldLogin = await H.api(base, "POST", "/auth/login", { body: { email: adminEmail, password: "Admin123!" } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await H.api(base, "POST", "/auth/login", { body: { email: adminEmail, password: "NewAdmin99!" } });
  assert.equal(newLogin.status, 200);
  const adminToken = newLogin.json.accessToken;
  const tr = await H.api(base, "POST", `/schools/${S.schoolId}/users/${teacherMembershipId}/reset-password`, {
    token: adminToken, schoolId: S.schoolId, body: { newPassword: "NewTeach99!" },
  });
  assert.equal(tr.status, 200);
  const tOld = await H.api(base, "POST", "/auth/login", { body: { email: teacherEmail, password: "Teach123!" } });
  assert.equal(tOld.status, 401);
  const tNew = await H.api(base, "POST", "/auth/login", { body: { email: teacherEmail, password: "NewTeach99!" } });
  assert.equal(tNew.status, 200);
});

test("delete purges a whole school and its data", async () => {
  const S2 = await H.bootstrapSchool(base, "phase21-del");
  const c2 = await H.makeClass(base, S2.schoolId, S2.adminToken);
  await H.makeStudentWithGuardian(base, S2.schoolId, S2.adminToken, c2.classId, c2.yearId);
  const del = await H.api(base, "DELETE", `/platform/schools/${S2.schoolId}`, { token: S.opToken });
  assert.equal(del.status, 200);
  const students = await prisma.student.count({ where: { schoolId: S2.schoolId } });
  assert.equal(students, 0);
  const gone = await prisma.school.findUnique({ where: { id: S2.schoolId } });
  assert.equal(gone, null);
  const list = await H.api(base, "GET", "/platform/schools", { token: S.opToken });
  assert.ok(!list.json.schools.some((s) => s.id === S2.schoolId));
});

test("demo OTP: whitelisted parent logs in with fixed code 123456", async () => {
  const req = await H.api(base, "POST", "/auth/parent-otp/request", { body: { phone: "9999999999" } });
  assert.equal(req.status, 202);
  assert.equal(req.json.demoCode, "123456");
  const bad = await H.api(base, "POST", "/auth/parent-otp/verify", { body: { phone: "9999999999", code: "000000" } });
  assert.notEqual(bad.status, 200);
  const ok = await H.api(base, "POST", "/auth/parent-otp/verify", { body: { phone: "9999999999", code: "123456" } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.accessToken);
});
