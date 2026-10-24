// Phase 6 tests: school profile (admin-filled) + in-app notifications as
// the primary channel (WhatsApp optional).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, cls, kid;

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase6");
  cls = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
});

after(async () => {
  H.stopServer(server.child);
  await prisma.$disconnect();
});

test("school profile: admin fills logo/contact, members can read it, bad logo URL rejected", async () => {
  const patch = await H.api(base, "PATCH", `/schools/${S.schoolId}`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { logoUrl: "https://example.com/logo.png", address: "12 MG Road, Agra", phone: "9999999999", email: "office@school.example" },
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.school.logoUrl, "https://example.com/logo.png");
  assert.equal(patch.json.school.address, "12 MG Road, Agra");

  const read = await H.api(base, "GET", `/schools/${S.schoolId}`, { token: kid.parentToken, schoolId: S.schoolId });
  assert.equal(read.json.school.phone, "9999999999");

  const bad = await H.api(base, "PATCH", `/schools/${S.schoolId}`, {
    token: S.adminToken, schoolId: S.schoolId, body: { logoUrl: "not-a-url" },
  });
  assert.equal(bad.status, 400);

  const parentPatch = await H.api(base, "PATCH", `/schools/${S.schoolId}`, {
    token: kid.parentToken, schoolId: S.schoolId, body: { phone: "111" },
  });
  assert.equal(parentPatch.status, 403);
});

test("in-app inbox: notice arrives without WhatsApp, unread count and mark-read work", async () => {
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  const notice = await H.api(base, "POST", `/schools/${S.schoolId}/notices`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { title: "In-app hello", body: "no whatsapp needed", audienceType: "ALL_PARENTS" },
  });
  const nid = notice.json.notice.id;
  await H.api(base, "POST", `/schools/${S.schoolId}/notices/${nid}/send`, {
    token: S.adminToken, schoolId: S.schoolId, body: {},
  });
  await processOutboxOnce(50);

  // The delivery record is the IN_APP channel, delivered.
  const recipient = await prisma.noticeRecipient.findFirst({ where: { noticeId: nid, recipientRef: kid.guardianId } });
  const delivery = await prisma.notificationDelivery.findFirst({ where: { noticeRecipientId: recipient.id, channel: "IN_APP" } });
  assert.equal(delivery.status, "DELIVERED");
  assert.ok(delivery.deliveredAt);

  const inbox = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, {
    token: kid.parentToken, schoolId: S.schoolId,
  });
  assert.equal(inbox.status, 200);
  const item = inbox.json.notifications.find((n) => n.notice.id === nid);
  assert.ok(item, "notice is in the parent inbox");
  assert.equal(item.read, false);
  assert.ok(inbox.json.unread >= 1);

  const read = await H.api(base, "POST", `/schools/${S.schoolId}/my-notifications/${item.recipientId}/read`, {
    token: kid.parentToken, schoolId: S.schoolId, body: {},
  });
  assert.equal(read.status, 200);
  const inbox2 = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, {
    token: kid.parentToken, schoolId: S.schoolId,
  });
  const item2 = inbox2.json.notifications.find((n) => n.notice.id === nid);
  assert.equal(item2.read, true);
  assert.equal(item2.status, "ACKNOWLEDGED");
});

test("in-app inbox: a user cannot read someone else's notification", async () => {
  const other = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, cls.classId, cls.yearId);
  const inboxOther = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, {
    token: other.parentToken, schoolId: S.schoolId,
  });
  // Other parent received the same ALL_PARENTS broadcast — but with THEIR
  // OWN recipient row; marking kid's row read must 404 for them.
  const kidInbox = await H.api(base, "GET", `/schools/${S.schoolId}/my-notifications`, {
    token: kid.parentToken, schoolId: S.schoolId,
  });
  const kidRow = kidInbox.json.notifications[0];
  const forge = await H.api(base, "POST", `/schools/${S.schoolId}/my-notifications/${kidRow.recipientId}/read`, {
    token: other.parentToken, schoolId: S.schoolId, body: {},
  });
  assert.equal(forge.status, 404);
  assert.ok(inboxOther.json.notifications.every((n) => n.recipientId !== kidRow.recipientId));
});
