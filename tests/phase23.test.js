// Phase 23: console drill-in (members list grouped by role) +
// FULL operator member management: add / edit / remove / reset
// password for any member of any school, operator-only throughout.
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

let crudMembershipId, crudEmail;
test("operator ADDS a teacher directly; the new login works", async () => {
  crudEmail = `crud-${Date.now()}@test.dev`;
  const r = await H.api(base, "POST", `/platform/schools/${S.schoolId}/members`, {
    token: S.opToken,
    body: { email: crudEmail, fullName: "Crud Teacher", password: "CrudPass1!", role: "TEACHER" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  crudMembershipId = r.json.membership.id;
  const login = await H.api(base, "POST", "/auth/login", { body: { email: crudEmail, password: "CrudPass1!" } });
  assert.equal(login.status, 200);
  const dup = await H.api(base, "POST", `/platform/schools/${S.schoolId}/members`, {
    token: S.opToken,
    body: { email: crudEmail, fullName: "Crud Teacher", password: "CrudPass1!", role: "TEACHER" },
  });
  assert.equal(dup.status, 400);
  assert.equal(dup.json.error, "ALREADY_A_MEMBER");
});

test("operator EDITS a member: name + login email change; new email logs in", async () => {
  const newEmail = `crud-renamed-${Date.now()}@test.dev`;
  const r = await H.api(base, "PATCH", `/platform/schools/${S.schoolId}/members/${crudMembershipId}`, {
    token: S.opToken, body: { fullName: "Renamed Teacher", email: newEmail, phone: "9812345678" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.member.fullName, "Renamed Teacher");
  assert.equal(r.json.member.email, newEmail);
  assert.equal(r.json.member.phone, "9812345678");
  const list = await H.api(base, "GET", `/platform/schools/${S.schoolId}/members`, { token: S.opToken });
  const inList = list.json.members.TEACHER.find((m) => m.membershipId === crudMembershipId);
  assert.equal(inList.fullName, "Renamed Teacher");
  const login = await H.api(base, "POST", "/auth/login", { body: { email: newEmail, password: "CrudPass1!" } });
  assert.equal(login.status, 200);
  crudEmail = newEmail;
});

test("operator REMOVES a member with a reason: login fails, removal is recorded", async () => {
  const noReason = await H.api(base, "DELETE", `/platform/schools/${S.schoolId}/members/${crudMembershipId}`, { token: S.opToken });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.error, "REMOVAL_REASON_REQUIRED");
  const r = await H.api(base, "DELETE", `/platform/schools/${S.schoolId}/members/${crudMembershipId}`, {
    token: S.opToken, body: { reason: "DUPLICATE" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.removed, true);
  assert.equal(r.json.reason, "DUPLICATE");
  assert.equal(r.json.userDeactivated, true, "user had no other school — must be deactivated");
  const login = await H.api(base, "POST", "/auth/login", { body: { email: crudEmail, password: "CrudPass1!" } });
  assert.equal(login.status, 401);
  const list = await H.api(base, "GET", `/platform/schools/${S.schoolId}/members`, { token: S.opToken });
  assert.ok(!list.json.members.TEACHER.some((m) => m.membershipId === crudMembershipId), "gone from the active list");
  const rec = list.json.removed.find((m) => m.membershipId === crudMembershipId);
  assert.ok(rec, "present in the removed list");
  assert.equal(rec.reason, "DUPLICATE");
  assert.ok(rec.removedBy, "remover is recorded");
  assert.ok(rec.removedAt, "removal time is recorded");
});

test("non-operator is denied on add / edit / remove too", async () => {
  const add = await H.api(base, "POST", `/platform/schools/${S.schoolId}/members`, {
    token: S.adminToken, body: { email: "sneak@test.dev", fullName: "Sneak", password: "SneakPass1!", role: "TEACHER" },
  });
  assert.equal(add.status, 403);
  const edit = await H.api(base, "PATCH", `/platform/schools/${S.schoolId}/members/${teacherMembershipId}`, {
    token: S.adminToken, body: { fullName: "Hijacked" },
  });
  assert.equal(edit.status, 403);
  const del = await H.api(base, "DELETE", `/platform/schools/${S.schoolId}/members/${teacherMembershipId}`, { token: S.adminToken });
  assert.equal(del.status, 403);
});

let schoolTeacherMid, schoolTeacherEmail;
test("SCHOOL ADMIN edits a teacher inside their own school", async () => {
  schoolTeacherEmail = `steam-${Date.now()}@test.dev`;
  const created = await H.api(base, "POST", `/schools/${S.schoolId}/users`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { email: schoolTeacherEmail, fullName: "School Teacher", password: "SteamPass1!", role: "TEACHER" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  schoolTeacherMid = created.json.membership.id;
  const r = await H.api(base, "PATCH", `/schools/${S.schoolId}/users/${schoolTeacherMid}`, {
    token: S.adminToken, schoolId: S.schoolId, body: { fullName: "Edited By Admin", phone: "9812345678" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.membership.user.fullName, "Edited By Admin");
  assert.equal(r.json.membership.user.phone, "9812345678");
});

test("SCHOOL ADMIN removes a teacher WITH a reason: login fails, record kept", async () => {
  const noReason = await H.api(base, "DELETE", `/schools/${S.schoolId}/users/${schoolTeacherMid}`, {
    token: S.adminToken, schoolId: S.schoolId,
  });
  assert.equal(noReason.status, 400);
  const r = await H.api(base, "DELETE", `/schools/${S.schoolId}/users/${schoolTeacherMid}`, {
    token: S.adminToken, schoolId: S.schoolId, body: { reason: "RESIGNED", note: "Joined another school" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.removed, true);
  const login = await H.api(base, "POST", "/auth/login", { body: { email: schoolTeacherEmail, password: "SteamPass1!" } });
  assert.equal(login.status, 401);
  const removed = await H.api(base, "GET", `/schools/${S.schoolId}/users/removed`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(removed.status, 200);
  const rec = removed.json.removed.find((m) => m.membershipId === schoolTeacherMid);
  assert.ok(rec, "school admin can see the removal record");
  assert.equal(rec.reason, "RESIGNED");
  assert.equal(rec.note, "Joined another school");
});

test("a school admin CANNOT touch another school's members", async () => {
  const S2 = await H.bootstrapSchool(base, "phase23-x");
  const edit = await H.api(base, "PATCH", `/schools/${S.schoolId}/users/${teacherMembershipId}`, {
    token: S2.adminToken, schoolId: S.schoolId, body: { fullName: "Hijacked" },
  });
  assert.ok([403, 404].includes(edit.status), `expected 403/404, got ${edit.status}`);
  const del = await H.api(base, "DELETE", `/schools/${S.schoolId}/users/${teacherMembershipId}`, {
    token: S2.adminToken, schoolId: S.schoolId, body: { reason: "OTHER", note: "cross-school attempt" },
  });
  assert.ok([403, 404].includes(del.status), `expected 403/404, got ${del.status}`);
  const list = await H.api(base, "GET", `/platform/schools/${S.schoolId}/members`, { token: S.opToken });
  const t = list.json.members.TEACHER.find((m) => m.membershipId === teacherMembershipId);
  assert.equal(t.fullName, "Teacher One", "teacher untouched by the cross-school attempt");
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
