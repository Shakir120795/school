// Minimal .env loader (no dependency) + central config.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(root, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  accessTokenTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC || 15 * 60),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  // Notification provider adapter: "log" (dev stub, records acceptance, sends
  // nothing externally) or "fail" (always errors — used to prove outages do
  // not lose attendance/notice rows and retries/dead-letter work).
  notificationProvider: process.env.NOTIFICATION_PROVIDER || "log",
  workerPollMs: Number(process.env.WORKER_POLL_MS || 2000),
  workerMaxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS || 5),
  duplicateScanWindowSec: Number(process.env.DUPLICATE_SCAN_WINDOW_SEC || 120),
};

if (!config.databaseUrl) {
  console.error("DATABASE_URL is required (see .env.example)");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && config.jwtSecret === "dev-only-change-me") {
  console.error("JWT_SECRET must be set in production");
  process.exit(1);
}
