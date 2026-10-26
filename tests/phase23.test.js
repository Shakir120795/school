// Phase 23: console drill-in (members list grouped by role +
// operator reset of ANY member's password, not only the admin).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, teacherMembershipId, teacherEmail;

before(async () => {
  H.assertTestDb();
  server = await H.startServer();
  base = server.base;
  S = await H.bootstrapSchool(base, "phase23");
  const cls = await H.makeClass(base, S.schoolId, S.adminToken);
  await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  const t = await H.makeTeacher(base, S.schoolId, S.adminToken);
  teacherMembershipId = t.membershipId;
  const users = await H.api(base, "GET", `/schools/${S.schoolId}/users`, { token: S.adminToken, schoolId: S.schoolId });
  teacherEmail = users.json.memberships.find((m) => m.id === teacherMembershipId).user.email;
});

after(async () => { H.stopServer(server.child); await prisma.$disconnect(); });

test("operator lists members grouped by role; parent carries childrenCount", async () => {
  const r = await H.api(base, "GET", `/platform/schools/${S.schoolId}/members`, { token: S.opToken });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.school.id, S.schoolId);
  assert.equal(r.json.school.students, 1);
  assert.equal(r.json.school.classes, 1);
  const { members } = r.json;
  assert.equal(members.SCHOOL_ADMIN.length, 1);
  assert.equal(members.SCHOOL_ADMIN[0].role, "SCHOOL_ADMIN");
  assert.ok(members.SCHOOL_ADMIN[0].email.endsWith("@test.dev"));
  const teacher = members.TEACHER.find((m) => m.membershipId === teacherMembershipId);
  assert.ok(teacher, "teacher is listed in the TEACHER group");
  assert.equal(teacher.email, teacherEmail);
  assert.equal(members.PARENT.length, 1);
  assert.equal(members.PARENT[0].childrenCount, 1, "parent login is linked to exactly one child");
  assert.equal(r.json.total, 3);
});

test("non-operator is denied on both drill-in endpoints", async () => {
  const list = await H.api(base, "GET", `/platform/schools/${S.schoolId}/members`, { token: S.adminToken });
  assert.equal(list.status, 403);
  const reset = await H.api(base, "POST", `/platform/schools/${S.schoolId}/members/${teacherMembershipId}/reset-password`, {
    token: S.adminToken, body: { newPassword: "SneakyPass1!" },
  });
  assert.equal(reset.status, 403);
  const anon = await H.api(base, "GET", `/platform/schools/${S.schoolId}/members`);
  assert.equal(anon.status, 401);
});

test("operator resets a TEACHER's password (old 401, new 200)", async () => {
  const short = await H.api(base, "POST", `/platform/schools/${S.schoolId}/members/${teacherMembershipId}/reset-password`, {
    token: S.opToken, body: { newPassword: "short" },
  });
  assert.equal(short.status, 400);
  assert.equal(short.json.error, "PASSWORD_TOO_SHORT");
  const r = await H.api(base, "POST", `/platform/schools/${S.schoolId}/members/${teacherMembershipId}/reset-password`, {
    token: S.opToken, body: { newPassword: "OpReset123!" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.reset, true);
  assert.equal(r.json.role, "TEACHER");
  const oldLogin = await H.api(base, "POST", "/auth/login", { body: { email: teacherEmail, password: "Teach123!" } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await H.api(base, "POST", "/auth/login", { body: { email: teacherEmail, password: "OpReset123!" } });
  assert.equal(newLogin.status, 200);
});

test("reset for a membership of another school is 404, not a cross-tenant write", async () => {
  const S2 = await H.bootstrapSchool(base, "phase23-other");
  const r = await H.api(base, "POST", `/platform/schools/${S2.schoolId}/members/${teacherMembershipId}/reset-password`, {
    token: S.opToken, body: { newPassword: "CrossTenant1!" },
  });
  assert.equal(r.status, 404);
  const login = await H.api(base, "POST", "/auth/login", { body: { email: teacherEmail, password: "OpReset123!" } });
  assert.equal(login.status, 200, "teacher password unchanged by the cross-tenant attempt");
});
