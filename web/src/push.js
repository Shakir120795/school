// Native push registration (Capacitor). No-ops in a regular browser.
// When the app runs inside the Android/iOS shell: request permission,
// register with FCM/APNs, and send the device token to the API so the
// worker can deliver PUSH copies of notices.
//
// Browser Web Push (Phase 29 WS9) lives at the bottom of this file:
// VAPID-based PushManager subscriptions registered with the API and
// delivered by the web-push helper on the server. It is opt-in only —
// nothing here ever prompts on page load; the user taps "Enable
// notifications" (Notifications view) first.
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api, session } from "./api.js";

export async function initPush() {
  if (!Capacitor.isNativePlatform() || !session.accessToken || !session.schoolId) return;
  try {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;
    await PushNotifications.register();
    PushNotifications.addListener("registration", async ({ value }) => {
      await api(`/schools/${session.schoolId}/push-tokens`, {
        method: "POST",
        body: { token: value, platform: Capacitor.getPlatform() },
      });
    });
  } catch (e) {
    console.warn("push registration failed", e);
  }
}

// ---------------------------------------------------------------------
// Browser Web Push (VAPID). The service worker itself is registered by
// main.js; here we only manage the PushManager subscription.

export function webPushSupported() {
  return (
    !Capacitor.isNativePlatform() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Server push config: { configured, publicKey }. Never throws. */
export async function fetchPushConfig() {
  try {
    const r = await api("/push/config", { school: false });
    if (r.status === 200) return r.json;
  } catch {
    /* offline etc. — treat as unconfigured */
  }
  return { configured: false, publicKey: null };
}

/** Current state for the UI: "unsupported" | "off" | "on" | "denied". */
export async function webPushState() {
  if (!webPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub && Notification.permission === "granted") return "on";
  } catch {
    /* fall through */
  }
  return "off";
}

/**
 * Ask permission, subscribe with the server VAPID key and POST the
 * subscription to the API. Call ONLY from a user gesture (button tap).
 * Returns { ok: true } or { ok: false, reason }.
 */
export async function enableWebPush() {
  if (!webPushSupported()) return { ok: false, reason: "unsupported" };
  if (!session.accessToken || !session.schoolId) return { ok: false, reason: "not-logged-in" };
  const cfg = await fetchPushConfig();
  if (!cfg.configured || !cfg.publicKey) return { ok: false, reason: "not-configured" };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission };
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
    });
  }
  const r = await api(`/schools/${session.schoolId}/push-subscriptions`, {
    method: "POST",
    body: { subscription: sub.toJSON() },
  });
  if (r.status !== 201) return { ok: false, reason: `server-${r.status}` };
  return { ok: true };
}

/** Unsubscribe this browser and deactivate the server-side row. */
export async function disableWebPush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      if (session.schoolId) {
        await api(`/schools/${session.schoolId}/push-subscriptions`, {
          method: "DELETE",
          body: { endpoint: sub.endpoint },
        }).catch(() => {});
      }
      await sub.unsubscribe();
    }
  } catch {
    /* best-effort */
  }
  return { ok: true };
}
