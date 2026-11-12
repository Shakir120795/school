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

// Phase 57 (audit H1): refresh par apna limiter — pehle sirf
// global 600/min tha, token-guessing ki koi alag hadd nahi thi.
const refreshLimiter = rateLimit({
  name: "refresh",
  limit: Number(process.env.RATE_LIMIT_REFRESH_PER_MIN || 30),
  windowMs: 60_000,
  keyFn: (req) => `${req.ip}`,
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
    // Phase 58 (audit M6): email hamesha lowercase — creation bhi
    // lowercase store karta hai, warna bade-aksar wala account
    // chhote-aksar se login hi nahi kar pata tha / duplicate banta tha.
    const email = String(req.body.email || "").trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || !(await verifyPassword(req.body.password, user.passwordHash || ""))) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    }
    // Session row + memberships are independent once the password
    // checks out — run them together instead of two sequential
    // round-trips (Phase 23 perf: every serial query costs a full
    // pooler round-trip at login).
    const [refreshToken, memberships] = await Promise.all([
      issueSession(req, user),
      prisma.schoolMembership.findMany({
        where: { userId: user.id, status: "ACTIVE" },
        // Phase 53 fix: id bhi bhejo — client ko apni membership
        // id chahiye (teacher apna profile pehchanne ke liye);
        // bina id ke Dashboard ka My classes card aur Homework
        // ke subject-scope dono chup-chaap fail ho rahe the.
        select: { id: true, schoolId: true, role: true },
      }),
    ]);
    return res.json({
      accessToken: signAccessToken(user),
      refreshToken,
      user: publicUser(user),
      memberships,
    });
  })
);

// Public client config: which parent login the app should show.
// PARENT_AUTH_MODE=otp re-enables the mobile-OTP parent login
// (Phase 9 flow); anything else = school-issued ID + password.
router.get("/config", (req, res) => {
  return res.json({ parentAuthMode: process.env.PARENT_AUTH_MODE === "otp" ? "otp" : "password" });
});

router.post(
  "/refresh",
  refreshLimiter,
  asyncRoute(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: "REFRESH_TOKEN_REQUIRED" });
    const session = await prisma.authSession.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
      return res.status(401).json({ error: "INVALID_REFRESH_TOKEN" });
    }
    // Phase 48d: ROTATE hui session ka purana token 60 second ke
    // andar chalega (grace) — hard refresh par parallel calls /
    // dusra tab ek hi token se refresh kare to dusri call 401
    // kha kar account ko dead maan leti thi aur app dusre account
    // par switch ho jata tha. Logout ya member-remove se revoke
    // hui session par rotatedAt null hota hai — wo turant dead
    // rehti hai, grace sirf rotation ko milta hai.
    const GRACE_MS = 60_000;
    if (session.revokedAt) {
      const inGrace = session.rotatedAt && Date.now() - new Date(session.rotatedAt).getTime() < GRACE_MS;
      if (!inGrace) return res.status(401).json({ error: "INVALID_REFRESH_TOKEN" });
      // Phase 57 (audit H1): grace EK hi baar milegi. Pehle wahi
      // purana token 60s ke andar baar-baar replay karke unlimited
      // 30-din wale sessions bante the. Ab rotatedAt ko atomic
      // tareeke se consume karte hain — jo request ye update
      // jeet-ti hai sirf wahi aage badhti hai, baaki ko 401.
      const consumed = await prisma.authSession.updateMany({
        where: { id: session.id, rotatedAt: session.rotatedAt },
        data: { rotatedAt: null },
      });
      if (consumed.count !== 1) return res.status(401).json({ error: "INVALID_REFRESH_TOKEN" });
      const graceRefresh = await issueSession(req, session.user);
      return res.json({ accessToken: signAccessToken(session.user), refreshToken: graceRefresh });
    }
    // Rotate: revoke the used session and issue a fresh pair.
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), rotatedAt: new Date() } });
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
      select: { id: true, schoolId: true, role: true, status: true },
    });
    return res.json({ user: publicUser(user), memberships });
  })
);

export default router;
