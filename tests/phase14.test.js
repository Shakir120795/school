// Phase 14: homework assign → parent sees → marks done → teacher tracks.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, cls2, kid, kidOtherClass, teacher, otherTeacher, hw;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase14");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  cls2 = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  kidOtherClass = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls2.classId, cls2.yearId);
  teacher = await H.makeTeacher(base, S.schoolId, S.adminToken);
  otherTeacher = await H.makeTeacher(base, S.schoolId, S.adminToken);
  await H.api(base, "POST", `/schools/${S.schoolId}/teacher-assignments`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { teacherId: teacher.teacherId, classroomId: cls.classId, subjectId: cls.subjectId, academicYearId: cls.yearId },
  });
});

after(async () => { H.stopServer(server.child); await prisma.$disconnect(); });

async function deliver() {
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  await processOutboxOnce(50);
}

test("teacher assigns homework to own class; unassigned teacher gets 403", async () => {
  const bad = await H.api(base, "POST", `/schools/${S.schoolId}/homework`, {
    token: otherTeacher.teacherToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, title: "Nope", dueDate: "2026-10-30" },
  });
  assert.equal(bad.status, 403);
  const ok = await H.api(base, "POST", `/schools/${S.schoolId}/homework`, {
    token: teacher.teacherToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, title: "Maths ch 4", description: "Ex 1-10", dueDate: "2026-10-30", subjectId: cls.subjectId },
  });
  assert.equal(ok.status, 201);
  hw = ok.json.homework;
});

test("parent of the class sees it and gets the HOMEWORK notice; other class parent sees nothing", async () => {
  const mine = await H.api(base, "GET", `/schools/${S.schoolId}/homework`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(mine.json.homework.length, 1);
  assert.equal(mine.json.homework[0].forChildren[0].done, false);
  const other = await H.api(base, "GET", `/schools/${S.schoolId}/homework`, { token: kidOtherClass.parentToken, schoolId: S.schoolId });
  assert.equal(other.json.homework.length, 0);
  await deliver();
  const box = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.ok(box.json.notifications.some((n) => n.notice.type === "HOMEWORK"), "homework notice delivered");
});

test("parent marks done (toggle), teacher sees the completion", async () => {
  const done = await H.api(base, "POST", `/schools/${S.schoolId}/homework/${hw.id}/complete`, {
    token: kid.parentToken, schoolId: S.schoolId, body: { studentId: kid.studentId },
  });
  assert.deepEqual(done.json, { done: true });
  const detail = await H.api(base, "GET", `/schools/${S.schoolId}/homework/${hw.id}/completions`, { token: teacher.teacherToken, schoolId: S.schoolId });
  const row = detail.json.students.find((s) => s.id === kid.studentId);
  assert.equal(row.done, true);
  // another parent cannot mark this child
  const cross = await H.api(base, "POST", `/schools/${S.schoolId}/homework/${hw.id}/complete`, {
    token: kidOtherClass.parentToken, schoolId: S.schoolId, body: { studentId: kid.studentId },
  });
  assert.equal(cross.status, 404);
  // toggle off
  const off = await H.api(base, "POST", `/schools/${S.schoolId}/homework/${hw.id}/complete`, {
    token: kid.parentToken, schoolId: S.schoolId, body: { studentId: kid.studentId },
  });
  assert.deepEqual(off.json, { done: false });
  const staffList = await H.api(base, "GET", `/schools/${S.schoolId}/homework`, { token: teacher.teacherToken, schoolId: S.schoolId });
  assert.equal(staffList.json.homework[0].completedCount, 0);
});
