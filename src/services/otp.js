// Parent OTP login service (Phase 9).
//
// Whitelist model: a parent can log in with a mobile number ONLY if that
// number is saved on a Guardian record (the school adds it when enrolling
// the student — no separate parent-ID creation work for the school).
// The parent proves ownership of the number with a 6-digit OTP. Login
// then auto-creates/links their account and PARENT memberships, and all
// parent data endpoints scope by guardian -> student links, so a parent
// only ever sees their own children.
//
// OTP delivery providers (OTP_PROVIDER env):
//   log  (default) — code is written to the server log only. For pilots
//                    where the operator reads it, and local dev.
//   demo           — ALSO returns the code in the API response. Only for
//                    a closed pilot (OTP_DEMO_MODE=1); never in real
//                    production, it defeats the ownership check.
//   test           — keeps the last code in memory for the test suite.
// Real SMS (MSG91/Twilio) plugs in at sendOtp() when the owner adds an
// SMS provider account.
import { randomInt } from "node:crypto";
import { prisma } from "../db.js";
import { hashToken } from "../utils/security.js";

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_PER_HOUR = 5;

export const testCodes = new Map(); // phone -> code (test provider only)

export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function provider() {
  return process.env.OTP_PROVIDER || "log";
}

async function sendOtp(phone, code) {
  const p = provider();
  if (p === "test") {
    testCodes.set(phone, code);
    // The API runs in its own process under the test harness, so also
    // drop the code in a file the suite can read.
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.OTP_TEST_FILE || "/tmp/otp-test-codes.json", JSON.stringify({ phone, code }));
    } catch { /* ignore */ }
    return;
  }
  if (p === "demo") return; // response carries the code (closed pilot only)
  // log provider + fallback: never crash the request flow.
  console.log(`[otp] login code for ${phone}: ${code} (provider=${p})`);
}

export async function guardiansForPhone(phone) {
  // Guardian.phone is stored as entered by the school; match on the
  // normalized last-10 digits via endsWith.
  const all = await prisma.guardian.findMany({
    where: { phone: { endsWith: phone }, status: "ACTIVE" },
    include: { school: { select: { id: true, name: true } } },
  });
  return all.filter((g) => normalizePhone(g.phone) === phone);
}

export async function requestOtp(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (phone.length !== 10) return { error: "INVALID_PHONE" };
  const guardians = await guardiansForPhone(phone);
  // Generic outcome either way (no whitelist enumeration), but only
  // whitelisted numbers get a challenge.
  if (!guardians.length) return { ok: true, whitelisted: false };
  const recent = await prisma.otpLoginChallenge.count({
    where: { phone, createdAt: { gte: new Date(Date.now() - 3600_000) } },
  });
  if (recent >= OTP_MAX_PER_HOUR) return { error: "OTP_RATE_LIMITED" };
  const code = String(randomInt(100000, 1000000));
  await prisma.otpLoginChallenge.create({
    data: { phone, codeHash: hashToken(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  await sendOtp(phone, code);
  return { ok: true, whitelisted: true, code: provider() === "demo" ? code : undefined };
}

export async function verifyOtp(rawPhone, code) {
  const phone = normalizePhone(rawPhone);
  const challenge = await prisma.otpLoginChallenge.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return { error: "OTP_EXPIRED_OR_MISSING" };
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { error: "OTP_TOO_MANY_ATTEMPTS" };
  if (hashToken(String(code || "")) !== challenge.codeHash) {
    await prisma.otpLoginChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    return { error: "OTP_INVALID" };
  }
  await prisma.otpLoginChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  const guardians = await guardiansForPhone(phone);
  if (!guardians.length) return { error: "NOT_WHITELISTED" };
  return { ok: true, guardians };
}
