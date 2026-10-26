// Phase 13: teacher roll-call.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, cls2, kidA, kidB, teacher, otherTeacher;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase13");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  cls2 = await H.makeClass(base, S.schoolId, S.adminToken);
  kidA = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  // second student in same class, with own guardian
  const st = await H.api(base, "POST", `/schools/${S.schoolId}/students`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { fullName: "Second Kid", admissionNo: "ADM-P13-B", classroomId: cls.classId, academicYearId: cls.yearId },
  });
  kidB = { studentId: st.json.student.id };
  const gd = await H.api(base, "POST", `/schools/${S.schoolId}/guardians`, {
    token: S.adminToken, schoolId: S.schoolId, body: { fullName: "Parent B", phone: "9812345678" },
  });
  await H.api(base, "POST", `/schools/${S.schoolId}/students/${kidB.studentId}/guardians`, {
    token: S.adminToken, schoolId: S.schoolId, body: { guardianId: gd.json.guardian.id, isPrimary: true },
  });
  teacher = await H.makeTeacher(base, S.schoolId, S.adminToken);
  otherTeacher = await H.makeTeacher(base, S.schoolId, S.adminToken);
  // assign teacher to cls only (subject assignment is enough for access)
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

test("teacher sees only assigned classes; other teacher is blocked from this class", async () => {
  const list = await H.api(base, "GET", `/schools/${S.schoolId}/rollcall/classes`, { token: teacher.teacherToken, schoolId: S.schoolId });
  assert.equal(list.json.classes.length, 1);
  assert.equal(list.json.classes[0].id, cls.classId);
  const roster = await H.api(base, "GET", `/schools/${S.schoolId}/rollcall/roster?classroomId=${cls.classId}`, { token: otherTeacher.teacherToken, schoolId: S.schoolId });
  assert.equal(roster.status, 403);
});

test("roll-call saves marks, audits the marker, and alerts only the newly-absent parent", async () => {
  const save = await H.api(base, "POST", `/schools/${S.schoolId}/rollcall`, {
    token: teacher.teacherToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, marks: [
      { studentId: kidA.studentId, status: "PRESENT" },
      { studentId: kidB.studentId, status: "ABSENT" },
    ] },
  });
  assert.equal(save.status, 200);
  assert.equal(save.json.saved, 2);
  assert.equal(save.json.absentAlerts, 1);

  const roster = await H.api(base, "GET", `/schools/${S.schoolId}/rollcall/roster?classroomId=${cls.classId}`, { token: teacher.teacherToken, schoolId: S.schoolId });
  const rowB = roster.json.roster.find((r) => r.student.id === kidB.studentId);
  assert.equal(rowB.attendance.status, "ABSENT");
  assert.equal(rowB.attendance.markedByMembershipId, teacher.membershipId);
  assert.ok(rowB.attendance.markedAt);

  await deliver();
  const boxA = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, { token: kidA.parentToken, schoolId: S.schoolId });
  assert.equal(boxA.json.notifications.filter((n) => n.notice.title.includes("marked absent")).length, 0, "present child parent not alerted");
});

test("re-marking an already-absent child does not re-alert; register shows the marks", async () => {
  const save = await H.api(base, "POST", `/schools/${S.schoolId}/rollcall`, {
    token: teacher.teacherToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, marks: [{ studentId: kidB.studentId, status: "ABSENT" }] },
  });
  assert.equal(save.json.absentAlerts, 0);
  const today = new Date().toISOString().slice(0, 10);
  const reg = await H.api(base, "GET", `/schools/${S.schoolId}/attendance/students?date=${today}`, { token: S.adminToken, schoolId: S.schoolId });
  const mine = reg.json.attendance || [];
  assert.equal(mine.filter((r) => r.status === "PRESENT").length, 1);
  assert.equal(mine.filter((r) => r.status === "ABSENT").length, 1);
});
