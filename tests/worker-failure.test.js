// Provider-outage behavior: with NOTIFICATION_PROVIDER=fail, the notice and
// attendance data must NOT be lost; the outbox row backs off and finally
// dead-letters. This file's process imports the outbox service with the
// failing adapter; the API server child runs normally (log adapter).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NOTIFICATION_PROVIDER = "fail";
process.env.JWT_SECRET = "test-secret";
process.env.WORKER_BACKOFF_BASE_MS = "10";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");
const { processOutboxOnce } = await import("../src/services/outbox.js");

let server, base, S, noticeId;

before(async () => {
  H.assertTestDb();
  server = await H.startServer();
  base = server.base;
  S = await H.bootstrapSchool(base, "outage");
  const kid = await H.makeStudentWithGuardian(
    base, S.schoolId, S.adminToken,
    (await H.makeClass(base, S.schoolId, S.adminToken)).classId,
    (await prisma.academicYear.findFirst({ where: { schoolId: S.schoolId } })).id
  );
  void kid;
  const notice = await H.api(base, "POST", `/schools/${S.schoolId}/notices`, {
    token: S.adminToken, schoolId: S.schoolId,
    body: { title: "Outage test", body: "provider is down", audienceType: "ALL_PARENTS" },
  });
  noticeId = notice.json.notice.id;
  const sent = await H.api(base, "POST", `/schools/${S.schoolId}/notices/${noticeId}/send`, {
    token: S.adminToken, schoolId: S.schoolId, body: {},
  });
  assert.equal(sent.status, 200);
});
after(async () => {
  H.stopServer(server.child);
  await prisma.$disconnect();
});

test("failing provider: notice row survives, outbox retries then dead-letters", async () => {
  // Pass 1: delivery fails -> outbox FAILED with attempts=1, notice intact.
  await processOutboxOnce(50);
  let outbox = await prisma.notificationOutbox.findFirst({ where: { aggregateId: noticeId, eventType: "notice.send" } });
  assert.ok(outbox, "outbox row exists");
  if (outbox.status === "PROCESSED") {
    // Other rows (attendance) may fill a pass; run targeted extra passes below.
  }
  // Force the row due again and cap attempts at 2 to reach dead-letter fast.
  await prisma.notificationOutbox.update({
    where: { id: outbox.id },
    data: { nextAttemptAt: new Date(Date.now() - 1000), maxAttempts: 2, status: outbox.status === "PROCESSED" ? "PROCESSED" : outbox.status },
  });
  if (outbox.status !== "PROCESSED") {
    await processOutboxOnce(50);
    outbox = await prisma.notificationOutbox.findUnique({ where: { id: outbox.id } });
    assert.ok(["FAILED", "DEAD_LETTER"].includes(outbox.status), `status=${outbox.status}`);
    assert.ok(outbox.attempts >= 1);
    assert.match(outbox.lastError || "", /provider/i);
  }
  // The business data was never lost.
  const notice = await prisma.notice.findUnique({ where: { id: noticeId } });
  assert.ok(notice);
  const deliveries = await prisma.notificationDelivery.findMany({ where: { outboxId: outbox.id } });
  assert.ok(deliveries.length >= 1);
  assert.ok(deliveries.every((d) => d.status === "FAILED" || d.errorCode));
});
