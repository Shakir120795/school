// Phase 11: scan → parent gate alerts + on-campus view.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, kid, card, deviceKey;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase11");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  await H.setPolicy(base, S.schoolId, S.adminToken, {
    appliesTo: "STUDENT", entryStart: "00:00", entryEnd: "23:59", lateAfter: "23:58",
    exitStart: "00:00", exitEnd: "23:59", workingWeekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  card = await H.issueCard(base, S.schoolId, S.adminToken, { ownerType: "STUDENT", studentId: kid.studentId });
  deviceKey = await H.makeDevice(base, S.schoolId, S.adminToken);
});

after(async () => {
  H.stopServer(server.child);
  // NOTIFICATION_PROVIDER=log: run the outbox worker once in-process so
  // deliveries materialize, mirroring production's worker/Vercel pass.
  await prisma.$disconnect();
});

async function inbox() {
  // Deliver pending outbox events through the real worker logic.
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  await processOutboxOnce(50);
  return H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, { token: kid.parentToken, schoolId: S.schoolId });
}

test("entry scan alerts the parent in-app; duplicate scan does not re-alert", async () => {
  const scan = await H.scan(base, S.schoolId, deviceKey, card.qrToken, "ENTRY", "p11-entry-1");
  assert.equal(scan.json.outcome, "RECORDED");
  const box1 = await inbox();
  const alerts1 = box1.json.notifications.filter((n) => n.notice.title.includes("entered school"));
  assert.equal(alerts1.length, 1, "one entry alert");
  assert.equal(box1.json.unread >= 1, true);

  const dup = await H.scan(base, S.schoolId, deviceKey, card.qrToken, "ENTRY", "p11-entry-2");
  assert.equal(dup.json.outcome, "DUPLICATE");
  const box2 = await inbox();
  const alerts2 = box2.json.notifications.filter((n) => n.notice.title.includes("entered school"));
  assert.equal(alerts2.length, 1, "still one entry alert after duplicate");
});

test("on-campus view tracks entry then exit; exit scan sends the left-school alert", async () => {
  const oc1 = await H.api(base, "GET", `/schools/${S.schoolId}/attendance/on-campus`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(oc1.status, 200);
  assert.equal(oc1.json.totals.onCampus, 1);
  assert.equal(oc1.json.totals.departed, 0);

  const exit = await H.scan(base, S.schoolId, deviceKey, card.qrToken, "EXIT", "p11-exit-1");
  assert.equal(exit.json.outcome, "RECORDED");
  const oc2 = await H.api(base, "GET", `/schools/${S.schoolId}/attendance/on-campus`, { token: S.adminToken, schoolId: S.schoolId });
  assert.equal(oc2.json.totals.onCampus, 0);
  assert.equal(oc2.json.totals.departed, 1);

  const box = await inbox();
  const left = box.json.notifications.filter((n) => n.notice.title.includes("left school"));
  assert.equal(left.length, 1, "one exit alert");
});
