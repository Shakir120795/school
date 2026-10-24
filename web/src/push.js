// Native push registration (Capacitor). No-ops in a regular browser.
// When the app runs inside the Android/iOS shell: request permission,
// register with FCM/APNs, and send the device token to the API so the
// worker can deliver PUSH copies of notices.
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
