// Phase 15: leave applications — apply, approve (ON_LEAVE), reject, cancel.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, cls2, kid, kid2, teacher, otherTeacher, app1, app2;
const D1 = "2026-11-02"; // future dates so nothing collides with today's rows
const D2 = "2026-11-03";

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase15");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  cls2 = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  kid2 = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls2.classId, cls2.yearId);
  teacher = await H.makeTeacher(base, S.schoolId, S.adminToken);
  otherTeacher = await H.makeTeacher(base, S.schoolId, S.adminToken);
  await H.api(base, "POST", `/schools/${S.schoolId}/teacher-assignments`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { teacherId: teacher.teacherId, classroomId: cls.classId, subjectId: cls.subjectId, academicYearId: cls.yearId },
  });
  // Pre-mark D2 as PRESENT via roll-call (admin): approval must NOT overwrite it.
  await H.api(base, "POST", `/schools/${S.schoolId}/rollcall`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, date: D2, marks: [{ studentId: kid.studentId, status: "PRESENT" }] },
  });
});

after(async () => { H.stopServer(server.child); await prisma.$disconnect(); });

async function deliver() {
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  await processOutboxOnce(50);
}

test("parent applies for own child only; invalid range rejected", async () => {
  const cross = await H.api(base, "POST", `/schools/${S.schoolId}/leave-applications`, {
    token: kid.parentToken, schoolId: S.schoolId,
    body: { studentId: kid2.studentId, fromDate: D1, toDate: D1, reason: "x" },
  });
  assert.equal(cross.status, 404);
  const bad = await H.api(base, "POST", `/schools/${S.schoolId}/leave-applications`, {
    token: kid.parentToken, schoolId: S.schoolId,
    body: { studentId: kid.studentId, fromDate: D2, toDate: D1, reason: "x" },
  });
  assert.equal(bad.status, 400);
  const ok = await H.api(base, "POST", `/schools/${S.schoolId}/leave-applications`, {
    token: kid.parentToken, schoolId: S.schoolId,
    body: { studentId: kid.studentId, fromDate: D1, toDate: D2, category: "SICK", reason: "Fever" },
  });
  assert.equal(ok.status, 201);
  app1 = ok.json.application;
});

test("other class teacher cannot decide; class teacher approves → ON_LEAVE applied, PRESENT day untouched, parent alerted", async () => {
  const foreign = await H.api(base, "PATCH", `/schools/${S.schoolId}/leave-applications/${app1.id}/decision`, {
    token: otherTeacher.teacherToken, schoolId: S.schoolId, body: { decision: "APPROVED" },
  });
  assert.equal(foreign.status, 403);
  const mine = await H.api(base, "GET", `/schools/${S.schoolId}/leave-applications`, { token: teacher.teacherToken, schoolId: S.schoolId });
  assert.equal(mine.json.applications.length, 1);
  const ok = await H.api(base, "PATCH", `/schools/${S.schoolId}/leave-applications/${app1.id}/decision`, {
    token: teacher.teacherToken, schoolId: S.schoolId, body: { decision: "APPROVED", note: "Get well soon" },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.appliedDays, 1, "only the unmarked day becomes ON_LEAVE");
  assert.equal(ok.json.skippedDays, 1, "the PRESENT day is not overwritten");
  const rows = await prisma.studentAttendance.findMany({ where: { schoolId: S.schoolId, studentId: kid.studentId }, orderBy: { localDate: "asc" } });
  const byDate = Object.fromEntries(rows.map((r) => [r.localDate.toISOString().slice(0, 10), r.status]));
  assert.equal(byDate[D1], "ON_LEAVE");
  assert.equal(byDate[D2], "PRESENT");
  const again = await H.api(base, "PATCH", `/schools/${S.schoolId}/leave-applications/${app1.id}/decision`, {
    token: teacher.teacherToken, schoolId: S.schoolId, body: { decision: "REJECTED" },
  });
  assert.equal(again.status, 409);
  await deliver();
  const box = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.ok(box.json.notifications.some((n) => n.notice.title.includes("Leave approved")), "parent alerted");
});

test("parent can cancel a pending application; decided ones are locked", async () => {
  const ok = await H.api(base, "POST", `/schools/${S.schoolId}/leave-applications`, {
    token: kid.parentToken, schoolId: S.schoolId,
    body: { studentId: kid.studentId, fromDate: "2026-11-10", toDate: "2026-11-10", reason: "Family function" },
  });
  app2 = ok.json.application;
  const cancel = await H.api(base, "PATCH", `/schools/${S.schoolId}/leave-applications/${app2.id}/cancel`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(cancel.json.application.status, "CANCELLED");
  const decide = await H.api(base, "PATCH", `/schools/${S.schoolId}/leave-applications/${app2.id}/decision`, {
    token: S.adminToken, schoolId: S.schoolId, body: { decision: "APPROVED" },
  });
  assert.equal(decide.status, 409);
});
