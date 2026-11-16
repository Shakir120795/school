// Passwords: Node scrypt (no native dependency). Tokens: opaque random +
// SHA-256 hash at rest — the same pattern as card credentials and refresh tokens.
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  if (!stored?.startsWith("scrypt:")) return false;
  const [, saltHex, keyHex] = stored.split(":");
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// NFC cards (Phase 74): a card's factory UID is the credential. It is stored
// only as the hash of a namespaced token — the same at-rest pattern as QR
// tokens — so the raw UID never sits in the database and an unknown UID
// resolves to nothing. UID format: 4–10 bytes hex (8–20 chars).
export function normalizeNfcUid(raw) {
  const uid = String(raw || "").toUpperCase().replace(/[^0-9A-F]/g, "");
  return /^[0-9A-F]{8,20}$/.test(uid) ? uid : null;
}

export function nfcToken(uid) {
  return `nfc:${uid}`;
}
