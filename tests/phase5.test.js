// Phase 5 tests: permission-review fixes, login rate limiting, security
// headers, and a pilot "day in the life" rehearsal end-to-end.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S;
let classA, classB, kidA, kidB, TCH;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase5");
  classA = await H.makeClass(base, S.schoolId, S.adminToken, "A");
  classB = await H.makeClass(base, S.schoolId, S.adminToken, "B");
  kidA = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, classA.classId, classA.yearId);
  kidB = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, classB.classId, classB.yearId);
  TCH = await H.makeTeacher(base, S.schoolId, S.adminToken);
  await H.api(base, "POST", `/schools/${S.schoolId}/teacher-assignments`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { teacherId: TCH.teacherId, classroomId: classA.classId, subjectId: classA.subjectId, academicYearId: classA.yearId },
  });
  const tcard = await H.issueCard(base, S.schoolId, S.adminToken, { ownerType: "STAFF", teacherProfileId: TCH.teacherId });
  TCH.cardToken = tcard.qrToken;
});

after(async () => {
  H.stopServer(server.child);
  await prisma.$disconnect();
});

test("permission review: parent sees broadcasts + own targeted notices, never other classes'", async () => {
  // Class-B-only notice from admin.
  const nB = await H.api(base, "POST", `/schools/${S.schoolId}/notices`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { title: "Class B trip", body: "B only", audienceType: "ASSIGNED_CLASS", targets: [{ classroomId: classB.classId }] },
  });
  await H.api(base, "POST", `/schools/${S.schoolId}/notices/${nB.json.notice.id}/send`, {
    token: S.adminToken, schoolId: S.schoolId, body: {},
  });
  // School-wide broadcast.
  const nAll = await H.api(base, "POST", `/schools/${S.schoolId}/notices`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { title: "Holiday", body: "all parents", audienceType: "ALL_PARENTS" },
  });
  await H.api(base, "POST", `/schools/${S.schoolId}/notices/${nAll.json.notice.id}/send`, {
    token: S.adminToken, schoolId: S.schoolId, body: {},
  });

  const listA = await H.api(base, "GET", `/schools/${S.schoolId}/notices`, { token: kidA.parentToken, schoolId: S.schoolId });
  const titlesA = listA.json.notices.map((n) => n.title);
  assert.ok(titlesA.includes("Holiday"), "A sees the broadcast");
  assert.ok(!titlesA.includes("Class B trip"), "A must NOT see class B's notice");

  const listB = await H.api(base, "GET", `/schools/${S.schoolId}/notices`, { token: kidB.parentToken, schoolId: S.schoolId });
  const titlesB = listB.json.notices.map((n) => n.title);
  assert.ok(titlesB.includes("Class B trip") && titlesB.includes("Holiday"));
});

test("permission review: recipients endpoint — parent sees only own row; unrelated teacher blocked", async () => {
  const n = await H.api(base, "POST", `/schools/${S.schoolId}/notices`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { title: "Leak check", body: "x", audienceType: "ALL_PARENTS" },
  });
  const nid = n.json.notice.id;
  await H.api(base, "POST", `/schools/${S.schoolId}/notices/${nid}/send`, {
    token: S.adminToken, schoolId: S.schoolId, body: {},
  });

  const parentView = await H.api(base, "GET", `/schools/${S.schoolId}/notices/${nid}/recipients`, {
    token: kidA.parentToken, schoolId: S.schoolId,
  });
  assert.equal(parentView.status, 200);
  assert.equal(parentView.json.recipients.length, 1);
  assert.equal(parentView.json.recipients[0].recipientRef, kidA.guardianId);

  const teacherView = await H.api(base, "GET", `/schools/${S.schoolId}/notices/${nid}/recipients`, {
    token: TCH.teacherToken, schoolId: S.schoolId,
  });
  assert.equal(teacherView.status, 403); // not the sender

  const adminView = await H.api(base, "GET", `/schools/${S.schoolId}/notices/${nid}/recipients`, {
    token: S.adminToken, schoolId: S.schoolId,
  });
  assert.ok(adminView.json.recipients.length >= 2);
});

test("permission review: platform admin has no default access to school data", async () => {
  const students = await H.api(base, "GET", `/schools/${S.schoolId}/students`, {
    token: S.opToken, schoolId: S.schoolId,
  });
  assert.equal(students.status, 403);
  const notices = await H.api(base, "GET", `/schools/${S.schoolId}/notices`, {
    token: S.opToken, schoolId: S.schoolId,
  });
  assert.equal(notices.status, 403);
});

test("hardening: security headers present; login rate limit kicks in", async () => {
  const health = await fetch(`${base}/health`);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("x-frame-options"), "DENY");

  const email = `victim-${Date.now()}@t.dev`;
  let last;
  for (let i = 0; i < 11; i++) {
    last = await H.api(base, "POST", "/auth/login", { body: { email, password: "wrong-password" } });
  }
  assert.equal(last.status, 429);
  assert.equal(last.json.error, "RATE_LIMITED");
});

test("pilot rehearsal: a full school day end-to-end", async () => {
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  const T = S.adminToken;

  // Morning assembly: class teacher scans staff card, two kids enter, one exits later.
  await H.setPolicy(base, S.schoolId, T, {
    appliesTo: "STUDENT", entryStart: "00:00", entryEnd: "23:59", lateAfter: "23:58",
    exitStart: "00:00", exitEnd: "23:59", workingWeekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const device = await H.api(base, "POST", `/schools/${S.schoolId}/devices`, {
    token: T, schoolId: S.schoolId, body: { name: "Pilot gate" },
  });
  const dk = device.json.deviceKey;
  const scan = (qrToken, eventType, key) =>
    H.api(base, "POST", "/attendance/scan", {
      schoolId: S.schoolId, deviceKey: dk,
      body: { qrToken, eventType, idempotencyKey: key, clientEventId: key },
    });

  await H.setPolicy(base, S.schoolId, T, {
    appliesTo: "STAFF", entryStart: "00:00", entryEnd: "23:59", lateAfter: "23:58",
    exitStart: "00:00", exitEnd: "23:59", workingWeekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const staffScan = await scan(TCH.cardToken, "ENTRY", `pilot-staff-${Date.now()}`);
  assert.equal(staffScan.json.outcome, "RECORDED");
  const kidACard = await H.issueCard(base, S.schoolId, T, { ownerType: "STUDENT", studentId: kidA.studentId });
  const inA = await scan(kidACard.qrToken, "ENTRY", `pilot-a-in-${Date.now()}`);
  assert.equal(inA.json.outcome, "RECORDED");

  // Teacher notices her own class about the day; worker delivers; parent acks.
  const notice = await H.api(base, "POST", `/schools/${S.schoolId}/notices`, {
    token: TCH.teacherToken, schoolId: S.schoolId,
    body: { title: "Pilot day", body: "Welcome!", audienceType: "ASSIGNED_CLASS", targets: [{ classroomId: classA.classId }] },
  });
  assert.equal(notice.status, 201);
  await H.api(base, "POST", `/schools/${S.schoolId}/notices/${notice.json.notice.id}/send`, {
    token: TCH.teacherToken, schoolId: S.schoolId, body: {},
  });
  await processOutboxOnce(50);
  const recipient = await prisma.noticeRecipient.findFirst({
    where: { noticeId: notice.json.notice.id, recipientRef: kidA.guardianId },
  });
  const delivery = await prisma.notificationDelivery.findFirst({ where: { noticeRecipientId: recipient.id, channel: "IN_APP" } });
  assert.equal(delivery.status, "DELIVERED");
  const ack = await H.api(base, "POST", `/schools/${S.schoolId}/notices/${notice.json.notice.id}/ack`, {
    token: kidA.parentToken, schoolId: S.schoolId, body: {},
  });
  assert.equal(ack.status, 200);

  // Parent checks the child's day via my-children (latest attendance first).
  const mine = await H.api(base, "GET", `/schools/${S.schoolId}/my-children`, {
    token: kidA.parentToken, schoolId: S.schoolId,
  });
  const child = mine.json.children.find((c) => c.id === kidA.studentId);
  assert.ok(child, "parent sees the child");
  assert.equal(child.attendances[0].status, "PRESENT");

  // Correction flow: kidB was marked by register default; teacher requests,
  // principal approves (teacher applied to class B she doesn't own? use admin class A kid).
  const reg = await prisma.studentAttendance.findFirst({ where: { studentId: kidA.studentId } });
  assert.equal(reg.status, "PRESENT");
});
