// Notification worker process: `npm run worker`
// Polls the PostgreSQL outbox and delivers via the configured provider
// adapter. Safe to run multiple instances (SKIP LOCKED claiming).
import { config } from "./config.js";
import { processOutboxOnce } from "./services/outbox.js";

console.log(`[worker] starting, provider=${config.notificationProvider}, poll=${config.workerPollMs}ms`);
let running = true;
process.on("SIGINT", () => (running = false));
process.on("SIGTERM", () => (running = false));

while (running) {
  try {
    const r = await processOutboxOnce();
    if (r.claimed) console.log(`[worker] claimed=${r.claimed} processed=${r.processed} failed=${r.failed}`);
  } catch (e) {
    console.error("[worker] pass failed:", e.message);
  }
  await new Promise((r) => setTimeout(r, config.workerPollMs));
}
console.log("[worker] stopped");
process.exit(0);
