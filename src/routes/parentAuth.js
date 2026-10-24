// Parent mobile-OTP login (Phase 9). Mounted under /auth.
// Flow: POST /auth/parent-otp/request { phone } -> generic 202.
//       POST /auth/parent-otp/verify  { phone, code } -> session tokens.
// On first verify the parent's login account + PARENT memberships are
// created automatically from their Guardian records — the school never
// creates parent IDs by hand.
import { Router } from "express";
import { prisma } from "../db.js";
import { randomToken, hashToken, hashPassword } from "../utils/security.js";
import { config } from "../config.js";
import { signAccessToken } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requestOtp, verifyOtp } from "../services/otp.js";

const router = Router();

const otpLimiter = rateLimit({
  name: "parent-otp",
  limit: Number(process.env.RATE_LIMIT_OTP_PER_MIN || 10),
  windowMs: 60_000,
  keyFn: (req) => `${req.ip}:${String(req.body?.phone || "")}`,
});

async function ensureParentAccount(guardians) {
  // One account per phone: reuse the account any guardian row already
  // points at, else the placeholder-email account for this phone,
  // else create it.
  const phone = guardians[0].phone;
  const linked = guardians.find((g) => g.userId);
  let user = linked ? await prisma.user.findUnique({ where: { id: linked.userId } }) : null;
  if (!user) {
    const email = `parent.${guardians[0].phone.replace(/\D/g, "").slice(-10)}@otp.smartschool.app`;
    user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          phone,
          fullName: guardians[0].fullName,
          passwordHash: await hashPassword(randomToken() + randomToken()),
        },
      });
    }
  }
  for (const g of guardians) {
    if (g.userId !== user.id) {
      await prisma.guardian.update({ where: { id: g.id }, data: { userId: user.id } });
    }
    await prisma.schoolMembership.upsert({
      where: { schoolId_userId: { schoolId: g.schoolId, userId: user.id } },
      create: { schoolId: g.schoolId, userId: user.id, role: "PARENT", status: "ACTIVE" },
      update: { role: "PARENT", status: "ACTIVE" },
    });
  }
  return user;
}

router.post(
  "/parent-otp/request",
  otpLimiter,
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["phone"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const r = await requestOtp(req.body.phone);
    if (r.error === "INVALID_PHONE") return res.status(400).json({ error: r.error });
    if (r.error) return res.status(429).json({ error: r.error });
    // Generic 202: same response whether or not the number is
    // whitelisted. `demoCode` is present ONLY with OTP_PROVIDER=demo.
    return res.status(202).json({ ok: true, ...(r.code ? { demoCode: r.code } : {}) });
  })
);

router.post(
  "/parent-otp/verify",
  otpLimiter,
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["phone", "code"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const r = await verifyOtp(req.body.phone, req.body.code);
    if (!r.ok) return res.status(401).json({ error: r.error });
    const user = await ensureParentAccount(r.guardians);
    if (!user.isActive) return res.status(401).json({ error: "ACCOUNT_INACTIVE" });
    const refreshToken = randomToken();
    await prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        userAgent: req.headers["user-agent"]?.slice(0, 255),
        ipAddress: req.ip,
        expiresAt: new Date(Date.now() + config.refreshTokenTtlDays * 86400_000),
      },
    });
    const memberships = await prisma.schoolMembership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      select: { schoolId: true, role: true },
    });
    return res.json({
      accessToken: signAccessToken(user),
      refreshToken,
      user: { id: user.id, email: user.email, phone: user.phone, fullName: user.fullName, isPlatformAdmin: user.isPlatformAdmin },
      memberships,
    });
  })
);

export default router;
