// Durable outbox worker core (blueprint §8 — custom code, NO n8n).
// Claims rows with SELECT ... FOR UPDATE SKIP LOCKED so multiple workers can
// run safely. Exponential backoff; after maxAttempts -> DEAD_LETTER for
// manual review. Provider calls happen OUTSIDE the business transaction.
import { prisma } from "../db.js";
import { config } from "../config.js";

const WORKER_ID = `worker-${process.pid}`;

// Provider adapters. "log" is the dev adapter: it records provider acceptance
// without contacting any external service. Real WhatsApp/push adapters land in
// Phase 4 behind this same interface. "fail" exists to prove outage behavior.
export const providers = {
  log: async ({ channel, recipientRef }) => ({
    provider: `${channel.toLowerCase()}-log`,
    providerMessageId: `log-${Date.now()}-${recipientRef.slice(-6)}`,
  }),
  fail: async () => {
    throw Object.assign(new Error("provider unavailable (simulated)"), { code: "PROVIDER_DOWN" });
  },
};

function adapter() {
  return providers[config.notificationProvider] || providers.log;
}

const BACKOFF_BASE_MS = Number(process.env.WORKER_BACKOFF_BASE_MS || 1000);

async function claimBatch(limit = 10) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id FROM "NotificationOutbox"
      WHERE status IN ('PENDING','FAILED') AND "nextAttemptAt" <= now()
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}`;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await tx.notificationOutbox.updateMany({
      where: { id: { in: ids } },
      data: { status: "PROCESSING", lockedAt: new Date(), lockedBy: WORKER_ID },
    });
    return tx.notificationOutbox.findMany({ where: { id: { in: ids } } });
  });
}

async function deliverToRecipient(outbox, recipient) {
  const channel = "WHATSAPP"; // default channel in Phase 2; preferences expand in Phase 4
  // Respect guardian opt-out for this channel.
  if (recipient.recipientType === "GUARDIAN") {
    const consent = await prisma.communicationConsent.findUnique({
      where: {
        schoolId_guardianId_channel: {
          schoolId: outbox.schoolId,
          guardianId: recipient.recipientRef,
          channel,
        },
      },
    });
    if (consent && !consent.optedIn) {
      await prisma.notificationDelivery.create({
        data: {
          schoolId: outbox.schoolId,
          outboxId: outbox.id,
          noticeRecipientId: recipient.id,
          channel,
          status: "FAILED",
          idempotencyKey: `${outbox.id}:${recipient.id}:${channel}`,
          errorCode: "OPTED_OUT",
          errorMessage: "Guardian opted out of this channel",
        },
      });
      await prisma.noticeRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED" } });
      return;
    }
  }

  const idempotencyKey = `${outbox.id}:${recipient.id}:${channel}`;
  const delivery = await prisma.notificationDelivery.upsert({
    where: { schoolId_channel_idempotencyKey: { schoolId: outbox.schoolId, channel, idempotencyKey } },
    create: {
      schoolId: outbox.schoolId,
      outboxId: outbox.id,
      noticeRecipientId: recipient.id,
      channel,
      status: "QUEUED",
      idempotencyKey,
    },
    update: {},
  });
  try {
    const sent = await adapter()({ channel, recipientRef: recipient.recipientRef, noticeId: outbox.aggregateId });
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "PROVIDER_ACCEPTED",
        provider: sent.provider,
        providerMessageId: sent.providerMessageId,
        attemptCount: { increment: 1 },
        sentAt: new Date(),
      },
    });
    // Do not overwrite an acknowledgement that arrived first.
    await prisma.noticeRecipient.updateMany({
      where: { id: recipient.id, status: "QUEUED" },
      data: { status: "PROVIDER_ACCEPTED" },
    });
  } catch (e) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "FAILED",
        attemptCount: { increment: 1 },
        errorCode: e.code || "PROVIDER_ERROR",
        errorMessage: String(e.message || e).slice(0, 500),
      },
    });
    throw e; // outbox row goes to backoff / dead-letter handling
  }
}

async function processEvent(outbox) {
  if (outbox.eventType === "notice.send") {
    const recipients = await prisma.noticeRecipient.findMany({
      where: { schoolId: outbox.schoolId, noticeId: outbox.aggregateId, status: "QUEUED" },
    });
    for (const r of recipients) await deliverToRecipient(outbox, r);
    await prisma.notice.updateMany({
      where: { id: outbox.aggregateId, status: "SENDING" },
      data: { status: "SENT" },
    });
    return;
  }
  // attendance.*.scan events: the attendance row is already durable; in
  // Phase 2 there is no external send (guardian scan alerts ride the
  // Phase 4 providers). The event is retained and marked processed.
  if (outbox.eventType.startsWith("attendance.")) return;
  throw new Error(`Unknown outbox eventType: ${outbox.eventType}`);
}

/** One worker pass. Returns counts for logging/tests. */
export async function processOutboxOnce(limit = 10) {
  const batch = await claimBatch(limit);
  let processed = 0;
  let failed = 0;
  for (const outbox of batch) {
    try {
      await processEvent(outbox);
      await prisma.notificationOutbox.update({
        where: { id: outbox.id },
        data: { status: "PROCESSED", lockedAt: null, lockedBy: null, lastError: null },
      });
      processed++;
    } catch (e) {
      const attempts = outbox.attempts + 1;
      const dead = attempts >= (outbox.maxAttempts || config.workerMaxAttempts);
      await prisma.notificationOutbox.update({
        where: { id: outbox.id },
        data: {
          status: dead ? "DEAD_LETTER" : "FAILED",
          attempts,
          nextAttemptAt: new Date(Date.now() + BACKOFF_BASE_MS * 2 ** attempts),
          lockedAt: null,
          lockedBy: null,
          lastError: String(e.message || e).slice(0, 500),
        },
      });
      failed++;
    }
  }
  return { claimed: batch.length, processed, failed };
}
