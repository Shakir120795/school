// Phase 18: exams, marks entry, publish gate, parent report card.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, kid, teacher, otherTeacher, examId;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase18");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  teacher = await H.makeTeacher(base, S.schoolId, S.adminToken);
  otherTeacher = await H.makeTeacher(base, S.schoolId, S.adminToken);
  await H.api(base, "POST", `/schools/${S.schoolId}/teacher-assignments`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { teacherId: teacher.teacherId, classroomId: cls.classId, subjectId: cls.subjectId, academicYearId: cls.yearId },
  });
  const ex = await H.api(base, "POST", `/schools/${S.schoolId}/exams`, {
    token: teacher.teacherToken, schoolId: S.schoolId,
    body: { name: "Unit Test 1", classroomId: cls.classId, subjectId: cls.subjectId, examDate: "2026-10-20", maxMarks: 50 },
  });
  assert.equal(ex.status, 201);
  examId = ex.json.exam.id;
});

after(async () => { H.stopServer(server.child); await prisma.$disconnect(); });

test("unassigned teacher cannot create or enter marks; over-max marks rejected", async () => {
  const create = await H.api(base, "POST", `/schools/${S.schoolId}/exams`, {
    token: otherTeacher.teacherToken, schoolId: S.schoolId,
    body: { name: "X", classroomId: cls.classId, subjectId: cls.subjectId, examDate: "2026-10-21", maxMarks: 10 },
  });
  assert.equal(create.status, 403);
  const over = await H.api(base, "PUT", `/schools/${S.schoolId}/exams/${examId}/marks`, {
    token: teacher.teacherToken, schoolId: S.schoolId,
    body: { marks: [{ studentId: kid.studentId, marksObtained: 55 }] },
  });
  assert.equal(over.status, 400);
  assert.equal(over.json.error, "MARKS_OUT_OF_RANGE");
  const ok = await H.api(base, "PUT", `/schools/${S.schoolId}/exams/${examId}/marks`, {
    token: teacher.teacherToken, schoolId: S.schoolId,
    body: { marks: [{ studentId: kid.studentId, marksObtained: 46 }] },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.saved, 1);
});

test("parent sees nothing before publish; after publish the report card shows 92% and grade A+", async () => {
  const beforePub = await H.api(base, "GET", `/schools/${S.schoolId}/exams/report?studentId=${kid.studentId}`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(beforePub.json.rows.length, 0);
  const pub = await H.api(base, "PATCH", `/schools/${S.schoolId}/exams/${examId}/publish`, {
    token: teacher.teacherToken, schoolId: S.schoolId, body: { published: true },
  });
  assert.equal(pub.status, 200);
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  await processOutboxOnce();
  const afterPub = await H.api(base, "GET", `/schools/${S.schoolId}/exams/report?studentId=${kid.studentId}`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(afterPub.json.rows.length, 1);
  assert.equal(afterPub.json.rows[0].percentage, 92);
  assert.equal(afterPub.json.rows[0].grade, "A+");
  assert.equal(afterPub.json.overall.grade, "A+");
  const inbox = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.ok(inbox.json.notifications.some((n) => (n.notice?.title || "").includes("Results published")), "publish announces to class parents");
  const unpub = await H.api(base, "PATCH", `/schools/${S.schoolId}/exams/${examId}/publish`, {
    token: S.adminToken, schoolId: S.schoolId, body: { published: false },
  });
  assert.equal(unpub.status, 200);
  const hidden = await H.api(base, "GET", `/schools/${S.schoolId}/exams/report?studentId=${kid.studentId}`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(hidden.json.rows.length, 0);
});
