// App flavors — ONE codebase, FOUR roop:
//   "web"    — the public website (default; sab logins, koi lock nahi)
//   "parent" — Parent app (Play Store): sirf parent login + parent app
//   "staff"  — School & Teacher app: sirf school + teacher logins
//   "owner"  — Owner app: sirf owner (admin) login + console
//
// Do tareeke se flavor tay hota hai:
//  1. Build-time (Phase 42): VITE_APP_FLAVOR — bundled APK builds.
//  2. Runtime (Phase 43, auto-update apps): app ab live website hi
//     kholti hai (Capacitor server.url), taaki website ka har update
//     bina naya APK banaye app me aa jaye. App apna flavor pehle
//     khulne par URL ke ?appFlavor=parent|staff|owner se pehchanti
//     hai aur use device par yaad rakh leti hai (ss_app_flavor).
//     Ye sirf asli native app (Capacitor) me chalta hai — browser
//     me koi ?appFlavor= link khul bhi jaye to website par koi
//     lock NAHI lagta.
const BUILD_FLAVOR = import.meta.env.VITE_APP_FLAVOR || "web";
const RUNTIME_FLAVORS = ["parent", "staff", "owner"];
const STORE_KEY = "ss_app_flavor";

function detectRuntimeFlavor() {
  try {
    const cap = window.Capacitor;
    const native = !!cap && (typeof cap.isNativePlatform !== "function" || cap.isNativePlatform());
    if (!native) return null;
    const fromUrl = new URLSearchParams(window.location.search).get("appFlavor");
    if (fromUrl && RUNTIME_FLAVORS.includes(fromUrl)) {
      try { window.localStorage.setItem(STORE_KEY, fromUrl); } catch { /* ignore */ }
      return fromUrl;
    }
    const saved = window.localStorage.getItem(STORE_KEY);
    if (saved && RUNTIME_FLAVORS.includes(saved)) return saved;
  } catch { /* ignore — flavor na mile to build flavor hi sahi */ }
  return null;
}

export const FLAVOR = detectRuntimeFlavor() || BUILD_FLAVOR;
export const IS_NATIVE_FLAVOR = FLAVOR !== "web";

// Har flavor ka home login — app yahi se shuru hoti hai.
export const FLAVOR_HOME_LOGIN = {
  web: "/login",
  parent: "/login/parent",
  staff: "/login",
  owner: "/login/admin",
};

// Is flavor me kaun se login pages allowed hain (variant names).
// "chooser" = plain /login page.
const ALLOWED = {
  web: ["chooser", "parent", "teacher", "school", "admin"],
  parent: ["parent"],
  staff: ["chooser", "teacher", "school"],
  owner: ["admin"],
};
export function flavorAllowsLogin(variant) {
  return (ALLOWED[FLAVOR] || ALLOWED.web).includes(variant || "chooser");
}
export function flavorHomeLogin() {
  return FLAVOR_HOME_LOGIN[FLAVOR] || "/login";
}
