// App flavors (Phase 42): ONE codebase, FOUR builds —
//   "web"    — the public website (default; sab logins, koi lock nahi)
//   "parent" — Parent app (Play Store): sirf parent login + parent app
//   "staff"  — School & Teacher app: sirf school + teacher logins
//   "owner"  — Owner app: sirf owner (admin) login + console
// Flavor build time par VITE_APP_FLAVOR se banta hai; website build
// me ye set nahi hota, isliye website par kuch nahi badalta.
export const FLAVOR = import.meta.env.VITE_APP_FLAVOR || "web";
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
