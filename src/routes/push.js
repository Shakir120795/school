// Mobile push token registration (Phase 4). Any school member can register
// their device's FCM token; tokens are per-user, token string is unique.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";

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
