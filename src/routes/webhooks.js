// WhatsApp Cloud API webhook.
// GET  — Meta verification challenge (hub.verify_token must match env).
// POST — delivery status updates. When WHATSAPP_APP_SECRET is set, the
//        X-Hub-Signature-256 HMAC is verified. Updates are idempotent and
//        monotonic: a status never moves backwards (read < delivered is
//        ignored), and replays return 200 without changes.
import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { asyncRoute } from "../utils/http.js";

const router = Router();

const RANK = { QUEUED: 0, PROVIDER_ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4, ACKNOWLEDGED: 5, FAILED: 3, DEAD_LETTER: 3 };
const STATUS_FIELD = { sent: "sentAt", delivered: "deliveredAt", read: "readAt" };

router.get("/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: "VERIFY_TOKEN_MISMATCH" });
});

// Raw body is required for the HMAC — app.js mounts this router with
// express.raw for this path before the JSON parser (see app.js).
router.post(
  "/whatsapp",
  asyncRoute(async (req, res) => {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (secret) {
      const given = req.headers["x-hub-signature-256"] || "";
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
      const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
      const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      if (!ok) return res.status(403).json({ error: "INVALID_SIGNATURE" });
    }
    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8") || "{}") : req.body;
    const entries = payload?.entry || [];
    let updated = 0;
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        for (const st of change.value?.statuses || []) {
          const delivery = await prisma.notificationDelivery.findFirst({
            where: { providerMessageId: st.id },
          });
          if (!delivery) continue;
          const next = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" }[st.status];
          if (!next) continue;
          if (next !== "FAILED" && (RANK[delivery.status] ?? 0) >= (RANK[next] ?? 0)) continue; // replay / out of order
          const data = { status: next };
          const field = STATUS_FIELD[st.status];
          if (field && st.timestamp) data[field] = new Date(Number(st.timestamp) * 1000);
          if (next === "FAILED") {
            data.errorCode = String(st.errors?.[0]?.code || "WA_FAILED");
            data.errorMessage = String(st.errors?.[0]?.title || "WhatsApp delivery failed").slice(0, 500);
          }
          await prisma.notificationDelivery.update({ where: { id: delivery.id }, data });
          if (delivery.noticeRecipientId) {
            await prisma.noticeRecipient.updateMany({
              where: { id: delivery.noticeRecipientId, status: { notIn: ["ACKNOWLEDGED"] } },
              data: { status: next },
            });
          }
          updated++;
        }
      }
    }
    return res.status(200).json({ ok: true, updated });
  })
);

export default router;
