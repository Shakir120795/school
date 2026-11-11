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
//   "menu"      — the browser has not offered its prompt (it only
//                 does so after its own engagement checks, which
//                 can take visits): the UI still shows the install
//                 banner/button, opening browser-menu steps.
//   "installed" — already running as an installed app (or the
//                 user just installed): show nothing.
//   "hidden"    — the user declined the browser prompt just now:
//                 stop offering for this session.
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
  // Native (Capacitor) apps ARE the installed app — never offer install.
  if (window.Capacitor) { installState.value = "installed"; return; }
  if (isStandalone()) { installState.value = "installed"; return; }
  installState.value = isIos() ? "ios" : "menu";
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

// Phase 56: teeno apps ke liye alag-alag PWA. Site ek hi hai, par
// manifest teen hain — Parent / Staff / Owner — aur page (ya andar
// logged-in role) ke hisab se <link rel="manifest"> badal jata hai,
// taaki Install / Add to Home Screen se wahi app bane jis ke liye
// user aaya hai. iOS ka home-screen naam apple-mobile-web-app-title
// se aata hai, wo bhi saath badlo.
const PWA_APPS = {
  parent: { manifest: "/manifest-parent.webmanifest", title: "Smart School Parent" },
  staff: { manifest: "/manifest-staff.webmanifest", title: "Smart School Staff" },
  owner: { manifest: "/manifest-owner.webmanifest", title: "Smart School Owner" },
};
let pwaKind = null;
export function syncPwaManifest(kind) {
  const app = PWA_APPS[kind];
  if (!app || kind === pwaKind) return;
  pwaKind = kind;
  document.querySelector('link[rel="manifest"]')?.setAttribute("href", app.manifest);
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", app.title);
}
function roleKind() {
  try {
    const book = JSON.parse(localStorage.getItem("ss_accounts_v3") || "{}");
    const pin = sessionStorage.getItem("ss_active_account_v3");
    const last = localStorage.getItem("ss_last_account_v3");
    const acc = book[pin] || book[last] || book[Object.keys(book)[0]];
    if (!acc) return null;
    const m = (acc.memberships || []).find((x) => x.schoolId === acc.schoolId) || (acc.memberships || [])[0];
    if (!m) return "owner"; // membership nahi = platform operator
    return m.role === "PARENT" ? "parent" : "staff";
  } catch { return null; }
}
export function syncPwaForRoute(path) {
  if (path.startsWith("/login/parent")) return syncPwaManifest("parent");
  if (path.startsWith("/login/admin")) return syncPwaManifest("owner");
  if (path.startsWith("/login")) return syncPwaManifest("staff");
  const kind = roleKind();
  if (kind) syncPwaManifest(kind);
}
