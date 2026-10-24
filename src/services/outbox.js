// Durable outbox worker core (blueprint §8 — custom code, NO n8n).
// Claims rows with SELECT ... FOR UPDATE SKIP LOCKED so multiple workers can
// run safely. Exponential backoff; after maxAttempts -> DEAD_LETTER for
// manual review. Provider calls happen OUTSIDE the business transaction.
//
// Providers (Phase 4):
//  - NOTIFICATION_PROVIDER=log      dev adapter: records acceptance, sends nothing
//  - NOTIFICATION_PROVIDER=fail     simulated outage (tests)
//  - NOTIFICATION_PROVIDER=whatsapp real WhatsApp Cloud API template sends
//    (requires WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN)
// Push (FCM) is a best-effort second channel, attempted only when
// FCM_SERVICE_ACCOUNT_PATH is configured and the recipient has tokens.
import { prisma } from "../db.js";
import { config } from "../config.js";
import { sendNoticeCore } from "./notices.js";
import { whatsappConfigured, sendWhatsAppTemplate } from "./providers/whatsapp.js";
import { fcmConfigured, sendPush } from "./providers/fcm.js";

const WORKER_ID = `worker-${process.pid}`;
const BACKOFF_BASE_MS = Number(process.env.WORKER_BACKOFF_BASE_MS || 1000);

/** Resolve how to reach a notice recipient: { phone, userId } */
async function resolveContact(schoolId, recipient) {
  if (recipient.recipientType === "GUARDIAN") {
    const g = await prisma.guardian.findFirst({
      where: { id: recipient.recipientRef, schoolId },
      select: { phone: true, userId: true },
    });
    return { phone: g?.phone || null, userId: g?.userId || null };
  }
  const m = await prisma.schoolMembership.findFirst({
    where: { id: recipient.recipientRef, schoolId },
    include: { user: { select: { phone: true, id: true } } },
  });
  return { phone: m?.user?.phone || null, userId: m?.user?.id || null };
}

async function guardianOptedOut(schoolId, recipient, channel) {
  if (recipient.recipientType !== "GUARDIAN") return false;
  const consent = await prisma.communicationConsent.findUnique({
    where: { schoolId_guardianId_channel: { schoolId, guardianId: recipient.recipientRef, channel } },
  });
  return !!(consent && !consent.optedIn);
}

async function recordDelivery(data) {
  return prisma.notificationDelivery.upsert({
    where: {
      schoolId_channel_idempotencyKey: {
        schoolId: data.schoolId,
        channel: data.channel,
        idempotencyKey: data.idempotencyKey,
      },
    },
    create: data,
    update: {},
  });
}

async function deliverPushIfPossible(outbox, recipient, contact, notice) {
  if (!fcmConfigured() || !contact.userId) return;
  const tokens = await prisma.pushDeviceToken.findMany({
    where: { userId: contact.userId, isActive: true },
  });
  for (const t of tokens) {
    const idempotencyKey = `${outbox.id}:${recipient.id}:PUSH:${t.id}`;
    const delivery = await recordDelivery({
      schoolId: outbox.schoolId,
      outboxId: outbox.id,
      noticeRecipientId: recipient.id,
      channel: "PUSH",
      status: "QUEUED",
      idempotencyKey,
    });
    try {
      const sent = await sendPush({
        token: t.token,
        title: notice.title,
        body: notice.body,
        data: { noticeId: notice.id },
      });
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "PROVIDER_ACCEPTED", provider: sent.provider, providerMessageId: sent.providerMessageId, attemptCount: { increment: 1 }, sentAt: new Date() },
      });
    } catch (e) {
      // Push is best-effort: record the failure, never fail the whole send.
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", attemptCount: { increment: 1 }, errorCode: e.code || "FCM_ERROR", errorMessage: String(e.message || e).slice(0, 500) },
      });
    }
  }
}

async function deliverToRecipient(outbox, recipient, notice) {
  const channel = "WHATSAPP";
  if (await guardianOptedOut(outbox.schoolId, recipient, channel)) {
    await recordDelivery({
      schoolId: outbox.schoolId,
      outboxId: outbox.id,
      noticeRecipientId: recipient.id,
      channel,
      status: "FAILED",
      idempotencyKey: `${outbox.id}:${recipient.id}:${channel}`,
      errorCode: "OPTED_OUT",
      errorMessage: "Guardian opted out of this channel",
    });
    await prisma.noticeRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED" } });
    return;
  }

  const contact = await resolveContact(outbox.schoolId, recipient);
  const idempotencyKey = `${outbox.id}:${recipient.id}:${channel}`;
  const delivery = await recordDelivery({
    schoolId: outbox.schoolId,
    outboxId: outbox.id,
    noticeRecipientId: recipient.id,
    channel,
    status: "QUEUED",
    idempotencyKey,
  });

  try {
    let sent;
    if (config.notificationProvider === "whatsapp") {
      if (!whatsappConfigured()) {
        throw Object.assign(new Error("WhatsApp provider selected but WHATSAPP_* env is incomplete"), { code: "PROVIDER_NOT_CONFIGURED" });
      }
      sent = await sendWhatsAppTemplate({ to: contact.phone, title: notice.title, body: notice.body });
    } else if (config.notificationProvider === "fail") {
      throw Object.assign(new Error("provider unavailable (simulated)"), { code: "PROVIDER_DOWN" });
    } else {
      sent = {
        provider: "whatsapp-log",
        providerMessageId: `log-${Date.now()}-${recipient.recipientRef.slice(-6)}`,
      };
    }
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
    if (e.code === "NO_PHONE") {
      // Permanent failure: retrying will never create a phone number.
      await prisma.noticeRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED" } });
      return;
    }
    throw e; // retryable: outbox backoff / dead-letter handling
  }

  await deliverPushIfPossible(outbox, recipient, contact, notice);
}

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

async function processEvent(outbox) {
  if (outbox.eventType === "notice.send") {
    const notice = await prisma.notice.findUnique({ where: { id: outbox.aggregateId } });
    const recipients = await prisma.noticeRecipient.findMany({
      where: { schoolId: outbox.schoolId, noticeId: outbox.aggregateId, status: "QUEUED" },
    });
    for (const r of recipients) await deliverToRecipient(outbox, r, notice);
    await prisma.notice.updateMany({
      where: { id: outbox.aggregateId, status: "SENDING" },
      data: { status: "SENT" },
    });
    return;
  }
  // attendance.*.scan events: the attendance row is already durable; guardian
  // scan alerts can ride the same adapters in a later iteration — the event
  // is retained and marked processed (no external send in this phase).
  if (outbox.eventType.startsWith("attendance.")) return;
  throw new Error(`Unknown outbox eventType: ${outbox.eventType}`);
}

/** Flip due SCHEDULED notices into sends (recipient snapshot + outbox). */
export async function processScheduledNotices(now = new Date()) {
  const due = await prisma.notice.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    include: { targets: true },
    take: 20,
  });
  let sent = 0;
  for (const notice of due) {
    try {
      await sendNoticeCore(notice.schoolId, notice);
      sent++;
    } catch (e) {
      console.error(`[worker] scheduled notice ${notice.id} failed:`, e.message);
    }
  }
  return sent;
}

/** One worker pass. Returns counts for logging/tests. */
export async function processOutboxOnce(limit = 10) {
  const scheduledSent = await processScheduledNotices();
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
  return { claimed: batch.length, processed, failed, scheduledSent };
}
