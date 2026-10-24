// Phase 4 tests: real WhatsApp adapter against a local MOCK of the Meta
// Graph API (no real Meta credentials exist in this environment), webhook
// signature + status handling, push-token registration, scheduled sends.
// Real-device / real-provider verification remains an owner-side step and
// is called out in docs/PHASE4-REPORT.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";

process.env.JWT_SECRET = "test-secret";
process.env.WHATSAPP_APP_SECRET = "test-wa-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";

const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let mock, mockPort, mockHits;
let server, base, S, kid, noticeId, wamid;

before(async () => {
  H.assertTestDb();
  mockHits = [];
  mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      mockHits.push({ url: req.url, body: JSON.parse(body || "{}") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ messages: [{ id: `wamid.MOCK${mockHits.length}` }] }));
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  mockPort = mock.address().port;

  process.env.NOTIFICATION_PROVIDER = "whatsapp";
  process.env.WHATSAPP_API_BASE = `http://127.0.0.1:${mockPort}`;
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-wa-token";

  server = await H.startServer({
    WHATSAPP_APP_SECRET: "test-wa-secret",
    WHATSAPP_VERIFY_TOKEN: "test-verify-token",
  });
  base = server.base;
  S = await H.bootstrapSchool(base, "phase4");
  const { classId, yearId } = await H.makeClass(base, S.schoolId, S.adminToken);
  kid = await H.makeStudentWithGuardian(base, S.schoolId, S.adminToken, classId, yearId);
});

after(async () => {
  H.stopServer(server.child);
  mock.close();
  await prisma.$disconnect();
});

test("whatsapp adapter: worker sends template via (mock) Meta API and records wamid", async () => {
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  const notice = await H.api(base, "POST", `/schools/${S.schoolId}/notices`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { title: "Sports day", body: "Tomorrow 9am", audienceType: "ALL_PARENTS", type: "ANNOUNCEMENT" },
  });
  noticeId = notice.json.notice.id;
  const sent = await H.api(base, "POST", `/schools/${S.schoolId}/notices/${noticeId}/send`, {
    token: S.adminToken, schoolId: S.schoolId, body: {},
  });
  assert.equal(sent.status, 200);
  const pass = await processOutboxOnce(50);
  assert.ok(pass.processed >= 1);

  const hit = mockHits.find((h) => h.url.includes("/1234567890/messages"));
  assert.ok(hit, "mock Meta API was called");
  assert.equal(hit.body.messaging_product, "whatsapp");
  assert.equal(hit.body.to, "9999999999");
  assert.equal(hit.body.template.name, "school_notice");
  assert.equal(hit.body.template.components[0].parameters[0].text, "Sports day");

  const recipient = await prisma.noticeRecipient.findFirst({ where: { noticeId, recipientRef: kid.guardianId } });
  const delivery = await prisma.notificationDelivery.findFirst({ where: { noticeRecipientId: recipient.id, channel: "WHATSAPP" } });
  assert.equal(delivery.status, "PROVIDER_ACCEPTED");
  assert.equal(delivery.provider, "whatsapp-cloud");
  assert.ok(delivery.providerMessageId.startsWith("wamid.MOCK"));
  wamid = delivery.providerMessageId;
});

test("webhook: verification challenge, signed status updates, replay-safe, bad signature 403", async () => {
  const ok = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=CH42`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "CH42");
  const bad = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CH42`);
  assert.equal(bad.status, 403);

  const payload = JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id: wamid, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }],
  });
  const sig = "sha256=" + crypto.createHmac("sha256", "test-wa-secret").update(payload).digest("hex");
  const post = () =>
    fetch(`${base}/webhooks/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sig },
      body: payload,
    });
  const r1 = await post();
  assert.equal(r1.status, 200);
  const delivery = await prisma.notificationDelivery.findFirst({ where: { providerMessageId: wamid } });
  assert.equal(delivery.status, "DELIVERED");
  assert.ok(delivery.deliveredAt);
  const recipient = await prisma.noticeRecipient.findUnique({ where: { id: delivery.noticeRecipientId } });
  assert.equal(recipient.status, "DELIVERED");

  // Replay: still 200, no regression, no crash.
  const r2 = await post();
  assert.equal(r2.status, 200);
  const again = await prisma.notificationDelivery.findFirst({ where: { providerMessageId: wamid } });
  assert.equal(again.status, "DELIVERED");

  // Out-of-order older status must not move it backwards.
  const older = JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id: wamid, status: "sent", timestamp: "1" }] } }] }],
  });
  const sig2 = "sha256=" + crypto.createHmac("sha256", "test-wa-secret").update(older).digest("hex");
  await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig2 }, body: older });
  const still = await prisma.notificationDelivery.findFirst({ where: { providerMessageId: wamid } });
  assert.equal(still.status, "DELIVERED");

  const badSig = await fetch(`${base}/webhooks/whatsapp`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
    body: payload,
  });
  assert.equal(badSig.status, 403);
});

test("push tokens: register, list mine, deactivate", async () => {
  const reg = await H.api(base, "POST", `/schools/${S.schoolId}/push-tokens`, {
    token: kid.parentToken, schoolId: S.schoolId, body: { token: "fcm-token-abc", platform: "android" },
  });
  assert.equal(reg.status, 201);
  const mine = await H.api(base, "GET", `/schools/${S.schoolId}/push-tokens/mine`, {
    token: kid.parentToken, schoolId: S.schoolId,
  });
  assert.equal(mine.json.tokens.length, 1);
  const del = await H.api(base, "DELETE", `/schools/${S.schoolId}/push-tokens`, {
    token: kid.parentToken, schoolId: S.schoolId, body: { token: "fcm-token-abc" },
  });
  assert.equal(del.status, 200);
  const afterDel = await H.api(base, "GET", `/schools/${S.schoolId}/push-tokens/mine`, {
    token: kid.parentToken, schoolId: S.schoolId,
  });
  assert.equal(afterDel.json.tokens.length, 0);
});

test("scheduled notice: worker flips a due SCHEDULED notice to SENT", async () => {
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  const notice = await H.api(base, "POST", `/schools/${S.schoolId}/notices`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: {
      title: "Scheduled hello", body: "sent by worker", audienceType: "ALL_PARENTS",
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  assert.equal(notice.json.notice.status, "SCHEDULED");
  await processOutboxOnce(50);
  const row = await prisma.notice.findUnique({ where: { id: notice.json.notice.id } });
  assert.equal(row.status, "SENT");
  const recipients = await prisma.noticeRecipient.count({ where: { noticeId: row.id } });
  assert.ok(recipients >= 1);
});

test("whatsapp selected but not configured: outbox fails visibly (not silently 'sent')", async () => {
  const { processOutboxOnce } = await import("../src/services/outbox.js");
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  const notice = await H.api(base, "POST", `/schools/${S.schoolId}/notices`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { title: "Will fail", body: "no config", audienceType: "ALL_PARENTS" },
  });
  const nid = notice.json.notice.id;
  await H.api(base, "POST", `/schools/${S.schoolId}/notices/${nid}/send`, {
    token: S.adminToken, schoolId: S.schoolId, body: {},
  });
  await processOutboxOnce(50);
  const outbox = await prisma.notificationOutbox.findFirst({ where: { aggregateId: nid, eventType: "notice.send" } });
  assert.ok(["FAILED", "DEAD_LETTER"].includes(outbox.status));
  assert.match(outbox.lastError || "", /WHATSAPP|configured/i);
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
});
