// Firebase Cloud Messaging (HTTP v1) adapter using a service-account JSON
// file. Configure via env:
//   FCM_SERVICE_ACCOUNT_PATH=/path/to/service-account.json  (never commit it)
// The OAuth access token is obtained with a signed JWT (RS256) — no SDK.
import fs from "node:fs";
import crypto from "node:crypto";

let cached = { token: null, exp: 0 };

export function fcmConfigured() {
  return !!process.env.FCM_SERVICE_ACCOUNT_PATH;
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

async function accessToken(sa) {
  if (cached.token && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  )}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw Object.assign(new Error("FCM OAuth failed"), { code: "FCM_AUTH" });
  cached = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return cached.token;
}

/** Send to one device token. Returns { providerMessageId }. */
export async function sendPush({ token, title, body, data = {} }) {
  const sa = JSON.parse(fs.readFileSync(process.env.FCM_SERVICE_ACCOUNT_PATH, "utf8"));
  const access = await accessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(json?.error?.message || `FCM HTTP ${res.status}`), { code: "FCM_SEND" });
  }
  return { provider: "fcm", providerMessageId: json.name };
}
