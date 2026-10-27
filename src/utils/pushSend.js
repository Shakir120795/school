// Web Push delivery helper (Phase 29 WS9).
//
// Sends a browser Web Push notification to every web-push subscription a
// user has registered. Subscriptions live in the PushDeviceToken table
// (there is no dedicated PushSubscription model and the schema is frozen
// for this phase): platform = "webpush" and the token column stores the
// full subscription JSON ({ endpoint, keys: { p256dh, auth } }) — the
// endpoint alone is not enough to send, because the keys are required
// to encrypt the payload. The endpoint can be recovered by parsing the
// JSON. This helper parses the token column as JSON; rows whose token
// is not web-push JSON are skipped (the platform filter already keeps
// FCM token rows out).
//
// Configuration (env, all three required):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:…)
// When any is missing the helper is a strict no-op: it logs
// "push not configured" once per call and returns
// { sent: 0, skipped: true } — in-app notifications are unaffected.
import webpush from "web-push";
import { prisma } from "../db.js";

export const WEBPUSH_PLATFORM = "webpush";

let vapidReady = false;

export function webPushConfigured() {
  return !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

function ensureVapid() {
  if (vapidReady) return true;
  if (!webPushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  vapidReady = true;
  return true;
}

/** Parse a stored token-column value into a PushSubscription object. */
export function parseStoredSubscription(tokenValue) {
  try {
    const sub = JSON.parse(tokenValue);
    if (sub && typeof sub.endpoint === "string" && sub.keys?.p256dh && sub.keys?.auth) return sub;
  } catch {
    /* not a web-push row */
  }
  return null;
}

/**
 * Send one web-push notification to all of a user's subscriptions.
 * Best-effort: never throws. Subscriptions the push service reports as
 * gone (404/410) are deleted so dead endpoints stop accumulating.
 * Returns { sent, failed, removed, skipped? }.
 */
export async function sendWebPushToUser(userId, { title, body, url } = {}) {
  if (!ensureVapid()) {
    console.log("[push] push not configured (VAPID_* env missing) — web push skipped");
    return { sent: 0, failed: 0, removed: 0, skipped: true };
  }
  const rows = await prisma.pushDeviceToken.findMany({
    where: { userId, platform: WEBPUSH_PLATFORM, isActive: true },
  });
  const payload = JSON.stringify({
    title: title || "Smart School",
    body: body || "",
    url: url || "/notifications",
  });
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const row of rows) {
    const sub = parseStoredSubscription(row.token);
    if (!sub) {
      failed++;
      continue;
    }
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
      await prisma.pushDeviceToken
        .update({ where: { id: row.id }, data: { lastSeenAt: new Date() } })
        .catch(() => {});
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        // Subscription is gone for good — remove it.
        await prisma.pushDeviceToken.delete({ where: { id: row.id } }).catch(() => {});
        removed++;
      } else {
        failed++;
        console.warn(`[push] web push send failed for user ${userId}: ${e.statusCode || ""} ${e.message || e}`);
      }
    }
  }
  return { sent, failed, removed, skipped: false };
}
