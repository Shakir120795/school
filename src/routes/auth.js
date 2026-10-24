import { Router } from "express";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { hashPassword, verifyPassword, randomToken, hashToken } from "../utils/security.js";
import { signAccessToken, requireAuth } from "../middleware/auth.js";
import { asyncRoute, requireFields } from "../utils/http.js";
import { rateLimit } from "../middleware/rateLimit.js";

// Brute-force guard: 10 login attempts per minute per IP+email.
const loginLimiter = rateLimit({
  name: "login",
  limit: Number(process.env.RATE_LIMIT_LOGIN_PER_MIN || 10),
  windowMs: 60_000,
  keyFn: (req) => `${req.ip}:${String(req.body?.email || "").toLowerCase()}`,
});

const router = Router();

async function issueSession(req, user) {
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86400_000);
  await prisma.authSession.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: req.headers["user-agent"]?.slice(0, 255),
      ipAddress: req.ip,
      expiresAt,
    },
  });
  return refreshToken;
}

function publicUser(u) {
  return { id: u.id, email: u.email, phone: u.phone, fullName: u.fullName, isPlatformAdmin: u.isPlatformAdmin };
}

// First platform admin bootstrap + regular user creation happen through
// POST /schools and school-admin user management; this register endpoint is
// for the platform operator only and disabled once an admin exists unless
// called by a platform admin (enforced below).
router.post(
  "/register-platform-admin",
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["email", "password", "fullName"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const existingAdmins = await prisma.user.count({ where: { isPlatformAdmin: true } });
    if (existingAdmins > 0) {
      const header = req.headers.authorization || "";
      let allowed = false;
      if (header.startsWith("Bearer ")) {
        try {
          const { default: jwt } = await import("jsonwebtoken");
          const p = jwt.verify(header.slice(7), config.jwtSecret);
          allowed = !!p.padmin;
        } catch { /* not allowed */ }
      }
      if (!allowed) return res.status(403).json({ error: "PLATFORM_ADMIN_ALREADY_EXISTS" });
    }
    const user = await prisma.user.create({
      data: {
        email: req.body.email,
        phone: req.body.phone,
        fullName: req.body.fullName,
        isPlatformAdmin: true,
        passwordHash: await hashPassword(req.body.password),
      },
    });
    return res.status(201).json({ user: publicUser(user) });
  })
);

router.post(
  "/login",
  loginLimiter,
  asyncRoute(async (req, res) => {
    const missing = requireFields(req.body, ["email", "password"]);
    if (missing) return res.status(400).json({ error: "MISSING_FIELDS", missing });
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (!user || !user.isActive || !(await verifyPassword(req.body.password, user.passwordHash || ""))) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    }
    const refreshToken = await issueSession(req, user);
    const memberships = await prisma.schoolMembership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      select: { schoolId: true, role: true },
    });
    return res.json({
      accessToken: signAccessToken(user),
      refreshToken,
      user: publicUser(user),
      memberships,
    });
  })
);

router.post(
  "/refresh",
  asyncRoute(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: "REFRESH_TOKEN_REQUIRED" });
    const session = await prisma.authSession.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      return res.status(401).json({ error: "INVALID_REFRESH_TOKEN" });
    }
    // Rotate: revoke the used session and issue a fresh pair.
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const newRefresh = await issueSession(req, session.user);
    return res.json({ accessToken: signAccessToken(session.user), refreshToken: newRefresh });
  })
);

router.post(
  "/logout",
  requireAuth,
  asyncRoute(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
      await prisma.authSession.updateMany({
        where: { userId: req.user.id, refreshTokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      // No token supplied: revoke all sessions for this user.
      await prisma.authSession.updateMany({
        where: { userId: req.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return res.json({ ok: true });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
    const memberships = await prisma.schoolMembership.findMany({
      where: { userId: user.id },
      select: { schoolId: true, role: true, status: true },
    });
    return res.json({ user: publicUser(user), memberships });
  })
);

export default router;
