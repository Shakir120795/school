// WhatsApp Business Platform (Cloud API) adapter.
// Sends an approved TEMPLATE message (required for notifications outside the
// 24h customer-service window). Configure via env — never hard-code tokens:
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN,
//   WHATSAPP_NOTICE_TEMPLATE (default "school_notice", must exist in Meta
//   with 2 body parameters: {{1}} title, {{2}} body),
//   WHATSAPP_TEMPLATE_LANG (default "en"),
//   WHATSAPP_API_BASE (default https://graph.facebook.com/v21.0 — overridable
//   for Meta sandbox / tests).
export function whatsappConfigured() {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

export async function sendWhatsAppTemplate({ to, title, body }) {
  const base = process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.WHATSAPP_NOTICE_TEMPLATE || "school_notice";
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || "en";
  const digits = String(to || "").replace(/\D/g, "");
  if (!digits) throw Object.assign(new Error("recipient has no phone number"), { code: "NO_PHONE" });

  const res = await fetch(`${base}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: digits,
      type: "template",
      template: {
        name: template,
        language: { code: lang },
        components: [
          { type: "body", parameters: [{ type: "text", text: String(title || "School notice") }, { type: "text", text: String(body || "") }] },
        ],
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `WhatsApp API HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { code: `WA_${json?.error?.code || res.status}` });
  }
  const id = json?.messages?.[0]?.id;
  if (!id) throw Object.assign(new Error("WhatsApp API returned no message id"), { code: "WA_NO_ID" });
  return { provider: "whatsapp-cloud", providerMessageId: id };
}
