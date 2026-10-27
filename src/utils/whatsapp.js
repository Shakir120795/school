// WhatsApp provider adapter seam (Phase 29 WS9).
//
// A thin, provider-switchable seam for sending a free-form WhatsApp text
// message. It is NOT wired into the notice pipeline yet — the live
// notice flow keeps using src/services/providers/whatsapp.js (approved
// TEMPLATE messages via the outbox worker). This seam exists so a future
// workstream can send free-form texts (e.g. inside the 24h customer
// service window) without touching call sites.
//
// Configuration (env):
//   WHATSAPP_PROVIDER        unset or "none" (default) → not configured;
//                            "meta" → Meta WhatsApp Cloud API.
//   WHATSAPP_PHONE_NUMBER_ID Meta "phone number ID" of the sender number
//                            (required when WHATSAPP_PROVIDER=meta).
//   WHATSAPP_TOKEN           Bearer access token for the Cloud API
//                            (required when WHATSAPP_PROVIDER=meta).
//
// Behaviour: when not configured, sendWhatsApp returns
// { sent: false, reason: "WHATSAPP_NOT_CONFIGURED" } and performs NO
// network call. There are no fake/log-only "sent" results anywhere in
// this module: sent:true is returned only after Meta accepts the send.

/** Normalise a phone to international digits: strip non-digits and
 *  prefix 91 (India) when a bare 10-digit number is given. */
export function toWhatsAppDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function whatsAppSeamConfigured() {
  return (
    process.env.WHATSAPP_PROVIDER === "meta" &&
    !!process.env.WHATSAPP_PHONE_NUMBER_ID &&
    !!process.env.WHATSAPP_TOKEN
  );
}

/**
 * Send a free-form WhatsApp text message via the configured provider.
 * Returns { sent: true, provider: "meta", providerMessageId } on a real
 * accepted send, or { sent: false, reason } otherwise. Never throws for
 * "not configured"; provider/API errors also come back as sent:false
 * with the reason, so callers can fall back cleanly.
 */
export async function sendWhatsApp({ phone, text } = {}) {
  const provider = process.env.WHATSAPP_PROVIDER || "none";
  if (provider === "none" || provider === "") {
    return { sent: false, reason: "WHATSAPP_NOT_CONFIGURED" };
  }
  if (provider !== "meta") {
    return { sent: false, reason: `WHATSAPP_PROVIDER_UNSUPPORTED:${provider}` };
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneNumberId || !token) {
    return { sent: false, reason: "WHATSAPP_NOT_CONFIGURED" };
  }
  const to = toWhatsAppDigits(phone);
  if (!to) return { sent: false, reason: "NO_PHONE" };
  if (!text) return { sent: false, reason: "NO_TEXT" };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: String(text) },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `WhatsApp API HTTP ${res.status}`;
    return { sent: false, reason: `WHATSAPP_API_ERROR:${json?.error?.code || res.status}:${msg}` };
  }
  const id = json?.messages?.[0]?.id;
  if (!id) return { sent: false, reason: "WHATSAPP_NO_MESSAGE_ID" };
  return { sent: true, provider: "meta", providerMessageId: id };
}
