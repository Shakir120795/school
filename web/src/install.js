// PWA install helper (Phase 41).
//
// The app has been installable since the PWA phase (manifest +
// icons + service worker), but the only hint was a line of small
// text — real users never found it. This module captures the
// browser's install prompt and exposes a small reactive state the
// UI uses to show a proper "Install App" button/banner:
//
//   "available" — Chromium fired beforeinstallprompt: the button
//                 shows the browser's own install dialog.
//   "ios"       — iPhone/iPad Safari has no install prompt; the
//                 UI shows Share → "Add to Home Screen" steps.
//   "installed" — already running as an installed app (or the
//                 user just installed): show nothing.
//   "hidden"    — nothing to offer right now (desktop browser
//                 without a prompt, or already dismissed logic
//                 handled by the UI): show nothing.
import { ref } from "vue";

export const installState = ref("hidden");
let deferredPrompt = null;

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIos() {
  const ua = window.navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
}

export function initInstall() {
  if (isStandalone()) { installState.value = "installed"; return; }
  if (isIos()) installState.value = "ios";
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installState.value = "available";
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installState.value = "installed";
  });
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  if (choice?.outcome === "accepted") { installState.value = "installed"; return true; }
  installState.value = "hidden";
  return false;
}
