// AuthN (JWT access token) + tenant AuthZ.
// Tenant rule: the school scope comes from the X-School-Id header, but it is
// ONLY trusted after a SchoolMembership row for (user, school) is found —
// never from the header alone (blueprint §10).
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db.js";

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, padmin: !!user.isPlatformAdmin }, config.jwtSecret, {
    expiresIn: config.accessTokenTtlSec,
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, isPlatformAdmin: !!payload.padmin };
    return next();
  } catch {
    return res.status(401).json({ error: "INVALID_OR_EXPIRED_TOKEN" });
  }
}

/** Loads req.school + req.membership; optionally enforces role membership. */
export function requireSchool(roles = []) {
  return async (req, res, next) => {
    const schoolId = req.headers["x-school-id"] || req.params.schoolId;
    if (!schoolId) return res.status(400).json({ error: "SCHOOL_CONTEXT_REQUIRED" });
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) return res.status(404).json({ error: "SCHOOL_NOT_FOUND" });
    // A suspended school is frozen for everyone except the platform
    // operator (Phase 21) — its members cannot use the app until the
    // operator reactivates it.
    if (school.status !== "ACTIVE" && !req.user.isPlatformAdmin) {
      return res.status(403).json({ error: "SCHOOL_SUSPENDED" });
    }
    if (req.user.isPlatformAdmin && roles.length === 0) {
      req.school = school;
      req.membership = null;
      return next();
    }
    const membership = await prisma.schoolMembership.findUnique({
      where: { schoolId_userId: { schoolId, userId: req.user.id } },
    });
    if (!membership || membership.status !== "ACTIVE") {
      return res.status(403).json({ error: "NOT_A_MEMBER_OF_THIS_SCHOOL" });
    }
    if (roles.length && !roles.includes(membership.role)) {
      return res.status(403).json({ error: "INSUFFICIENT_ROLE", required: roles, actual: membership.role });
    }
    req.school = school;
    req.membership = membership;
    return next();
  };
}

const ADMIN_ROLES = ["SCHOOL_ADMIN", "PRINCIPAL"];
export { ADMIN_ROLES };
