// Mobile push token registration (Phase 4). Any school member can register
// their device's FCM token; tokens are per-user, token string is unique.
//
// Web Push (Phase 29 WS9): browsers subscribe via PushManager and POST the
// subscription here. There is no PushSubscription model (schema frozen),
// so subscriptions are stored as PushDeviceToken rows with
// platform = "webpush" and the token column holding the full
// subscription JSON ({ endpoint, keys }) — see src/utils/pushSend.js.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { WEBPUSH_PLATFORM, webPushConfigured } from "../utils/pushSend.js";

const router = Router();
const ANY_MEMBER = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT", "STAFF"];

router.post(
  "/schools/:schoolId/push-tokens",
  requireAuth,
  requireSchool(ANY_MEMBER),
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["token", "platform"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const row = await prisma.pushDeviceToken.upsert({
      where: { token: req.body.token },
      create: {
        userId: req.user.id,
        schoolId: req.params.schoolId,
        platform: req.body.platform,
        token: req.body.token,
      },
      update: { userId: req.user.id, schoolId: req.params.schoolId, isActive: true, lastSeenAt: new Date() },
    });
    return res.status(201).json({ pushToken: { id: row.id, platform: row.platform, isActive: row.isActive } });
  })
);

router.delete(
  "/schools/:schoolId/push-tokens",
  requireAuth,
  requireSchool(ANY_MEMBER),
  asyncRoute(async (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "TOKEN_REQUIRED" });
    await prisma.pushDeviceToken.updateMany({
      where: { token, userId: req.user.id },
      data: { isActive: false },
    });
    return res.json({ ok: true });
  })
);

// Public web-push config for the frontend: the VAPID public key is not a
// secret, so this needs no auth. configured=false (and publicKey=null)
// whenever the VAPID_* env vars are absent on the server.
router.get("/push/config", (req, res) => {
  const configured = webPushConfigured();
  return res.json({
    publicKey: configured ? process.env.VAPID_PUBLIC_KEY : null,
    configured,
  });
});

function validSubscription(body) {
  const sub = body?.subscription || body;
  if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://")) return null;
  if (!sub.keys?.p256dh || !sub.keys?.auth) return null;
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

router.post(
  "/schools/:schoolId/push-subscriptions",
  requireAuth,
  requireSchool(ANY_MEMBER),
  asyncRoute(async (req, res) => {
    const sub = validSubscription(req.body);
    if (!sub) return res.status(400).json({ error: "INVALID_SUBSCRIPTION" });
    const stored = JSON.stringify(sub);
    // Upsert by endpoint: the token column holds the JSON, so find this
    // user's existing row for the same endpoint first.
    const existing = await prisma.pushDeviceToken.findFirst({
      where: { userId: req.user.id, platform: WEBPUSH_PLATFORM, token: { contains: sub.endpoint } },
    });
    const row = existing
      ? await prisma.pushDeviceToken.update({
          where: { id: existing.id },
          data: { token: stored, schoolId: req.params.schoolId, isActive: true, lastSeenAt: new Date() },
        })
      : await prisma.pushDeviceToken.create({
          data: {
            userId: req.user.id,
            schoolId: req.params.schoolId,
            platform: WEBPUSH_PLATFORM,
            token: stored,
          },
        });
    return res.status(201).json({ subscription: { id: row.id, platform: row.platform, isActive: row.isActive } });
  })
);

router.delete(
  "/schools/:schoolId/push-subscriptions",
  requireAuth,
  requireSchool(ANY_MEMBER),
  asyncRoute(async (req, res) => {
    const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
    if (!endpoint) return res.status(400).json({ error: "ENDPOINT_REQUIRED" });
    await prisma.pushDeviceToken.updateMany({
      where: { userId: req.user.id, platform: WEBPUSH_PLATFORM, token: { contains: endpoint } },
      data: { isActive: false },
    });
    return res.json({ ok: true });
  })
);

router.get(
  "/schools/:schoolId/push-tokens/mine",
  requireAuth,
  requireSchool(ANY_MEMBER),
  asyncRoute(async (req, res) => {
    const tokens = await prisma.pushDeviceToken.findMany({
      where: { userId: req.user.id, isActive: true },
      select: { id: true, platform: true, schoolId: true, lastSeenAt: true },
    });
    return res.json({ tokens });
  })
);

export default router;
