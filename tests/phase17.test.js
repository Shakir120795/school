// Phase 17: timetable slots, teacher my-periods, parent grid, calendar merge.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, cls2, kid, kidOther, teacher;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase17");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  cls2 = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  kidOther = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls2.classId, cls2.yearId);
  teacher = await H.makeTeacher(base, S.schoolId, S.adminToken);
  await H.api(base, "POST", `/schools/${S.schoolId}/teacher-assignments`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { teacherId: teacher.teacherId, classroomId: cls.classId, subjectId: cls.subjectId, academicYearId: cls.yearId },
  });
  // Mon P1 Maths with the teacher, Mon P2 Lunch label — upsert semantics
  const s1 = await H.api(base, "POST", `/schools/${S.schoolId}/timetable/slots`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, weekday: 1, periodNo: 1, startTime: "09:00", endTime: "09:45", subjectId: cls.subjectId, teacherProfileId: teacher.teacherId },
  });
  assert.equal(s1.status, 201);
  await H.api(base, "POST", `/schools/${S.schoolId}/timetable/slots`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, weekday: 1, periodNo: 2, startTime: "09:45", endTime: "10:15", label: "Assembly" },
  });
  // holiday + event in Nov 2026 for the calendar merge
  await H.api(base, "POST", `/schools/${S.schoolId}/holidays`, { token: S.adminToken, schoolId: S.schoolId, body: { localDate: "2026-11-14", name: "Children's Day" } });
  await H.api(base, "POST", `/schools/${S.schoolId}/calendar/events`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { title: "Annual Sports Day", eventDate: "2026-11-20", type: "SPORTS" },
  });
});

after(async () => { H.stopServer(server.child); await prisma.$disconnect(); });

test("upsert replaces the same cell instead of duplicating", async () => {
  const upd = await H.api(base, "POST", `/schools/${S.schoolId}/timetable/slots`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { classroomId: cls.classId, weekday: 1, periodNo: 1, startTime: "09:05", endTime: "09:50", subjectId: cls.subjectId, teacherProfileId: teacher.teacherId },
  });
  assert.equal(upd.status, 201);
  const grid = await H.api(base, "GET", `/schools/${S.schoolId}/timetable?classroomId=${cls.classId}`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(grid.json.slots.length, 2);
  assert.equal(grid.json.slots[0].startTime, "09:05");
  assert.equal(grid.json.slots[0].display, grid.json.slots[0].subjectName);
  assert.equal(grid.json.slots[1].display, "Assembly");
});

test("teacher sees the class grid and their own periods; parent sees only their child's class", async () => {
  const grid = await H.api(base, "GET", `/schools/${S.schoolId}/timetable?classroomId=${cls.classId}`, { token: teacher.teacherToken, schoolId: S.schoolId });
  assert.equal(grid.status, 200);
  const foreign = await H.api(base, "GET", `/schools/${S.schoolId}/timetable?classroomId=${cls2.classId}`, { token: teacher.teacherToken, schoolId: S.schoolId });
  assert.equal(foreign.status, 403);
  const mine = await H.api(base, "GET", `/schools/${S.schoolId}/timetable/mine`, { token: teacher.teacherToken, schoolId: S.schoolId });
  assert.equal(mine.json.slots.length, 1);
  assert.equal(mine.json.slots[0].className.startsWith("5"), true);
  const parent = await H.api(base, "GET", `/schools/${S.schoolId}/timetable`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(parent.json.classes.length, 1);
  assert.equal(parent.json.classes[0].slots.length, 2);
  const parent2 = await H.api(base, "GET", `/schools/${S.schoolId}/timetable`, { token: kidOther.parentToken, schoolId: S.schoolId });
  assert.equal(parent2.json.classes[0].slots.length, 0, "other class has no slots and no leak of class 5 slots");
});

test("calendar merges events and holidays for the month, sorted", async () => {
  const cal = await H.api(base, "GET", `/schools/${S.schoolId}/calendar?month=2026-11`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(cal.json.items.length, 2);
  assert.equal(cal.json.items[0].kind, "HOLIDAY");
  assert.equal(cal.json.items[1].type, "SPORTS");
  const empty = await H.api(base, "GET", `/schools/${S.schoolId}/calendar?month=2026-12`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(empty.json.items.length, 0);
});
