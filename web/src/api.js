// API client with MULTI-ACCOUNT sessions (Phase 30).
//
// Every signed-in account is kept in a localStorage account book
// (ss_accounts_v2), so admin, school, teacher and parent accounts can
// all stay signed in on the same browser at the same time. Each TAB
// pins its own active account (sessionStorage ss_active_account_v2):
// opening the login links in different tabs and signing in with a
// different ID per tab keeps every tab on its own account — logging
// in somewhere never kicks another tab's account out. A fresh tab
// falls back to the most recently used account.
const BASE = import.meta.env.VITE_API_BASE || "";

const ACCOUNTS_KEY = "ss_accounts_v2";
const LAST_KEY = "ss_last_account_v2";
const TAB_KEY = "ss_active_account_v2";

function loadAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}") || {}; } catch { return {}; }
}
function saveAccounts() {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

let accounts = loadAccounts();
let pending = null; // tokens seen before the user object is known

// One-time migration from the pre-multi-account single session.
if (!Object.keys(accounts).length && localStorage.getItem("ss_access")) {
  try {
    const user = JSON.parse(localStorage.getItem("ss_user") || "null");
    const memberships = JSON.parse(localStorage.getItem("ss_memberships") || "[]");
    const id = user?.id || user?.email || "legacy";
    accounts[id] = {
      user: user || { id, fullName: "Account" },
      memberships,
      accessToken: localStorage.getItem("ss_access"),
      refreshToken: localStorage.getItem("ss_refresh"),
      schoolId: localStorage.getItem("ss_school") || memberships[0]?.schoolId || null,
    };
    saveAccounts();
    localStorage.setItem(LAST_KEY, id);
  } catch { /* broken legacy state: start clean */ }
  localStorage.removeItem("ss_access");
  localStorage.removeItem("ss_refresh");
  localStorage.removeItem("ss_school");
  localStorage.removeItem("ss_user");
  localStorage.removeItem("ss_memberships");
}

function tabPin() {
  return sessionStorage.getItem(TAB_KEY); // null = unset, "" = explicitly none
}
let activeId = (() => {
  const pin = tabPin();
  if (pin !== null) return pin || null;
  const last = localStorage.getItem(LAST_KEY);
  if (last && accounts[last]) { sessionStorage.setItem(TAB_KEY, last); return last; }
  const first = Object.keys(accounts)[0] || null;
  if (first) sessionStorage.setItem(TAB_KEY, first);
  return first;
})();

function active() {
  accounts = loadAccounts(); // another tab may have refreshed/added
  return (activeId && accounts[activeId]) || null;
}
function persistActive(patch) {
  const acc = active();
  if (acc) { Object.assign(acc, patch); saveAccounts(); return; }
  pending = { ...(pending || {}), ...patch };
}

export const session = {
  get accessToken() { return active()?.accessToken || pending?.accessToken || null; },
  get refreshToken() { return active()?.refreshToken || pending?.refreshToken || null; },
  get schoolId() { return active()?.schoolId || pending?.schoolId || null; },
  get user() { return active()?.user || null; },
  get memberships() { return active()?.memberships || []; },
  get membership() { return this.memberships.find((m) => m.schoolId === this.schoolId) || null; },
  get activeAccountId() { return activeId; },
  setTokens(access, refresh) {
    if (active()) persistActive({ accessToken: access, refreshToken: refresh });
    else pending = { ...(pending || {}), accessToken: access, refreshToken: refresh };
  },
  setSchool(id) { persistActive({ schoolId: id }); },
  // Save a freshly authenticated account and pin THIS tab to it.
  // Other accounts stay signed in untouched.
  establish(json) {
    const user = json.user;
    if (!user?.id) return;
    const prev = accounts[user.id];
    const memberships = json.memberships || [];
    const schoolId = prev?.schoolId && memberships.some((m) => m.schoolId === prev.schoolId)
      ? prev.schoolId
      : memberships[0]?.schoolId || null;
    accounts[user.id] = {
      user,
      memberships,
      accessToken: json.accessToken,
      refreshToken: json.refreshToken,
      schoolId,
    };
    saveAccounts();
    activeId = user.id;
    pending = null;
    sessionStorage.setItem(TAB_KEY, user.id);
    localStorage.setItem(LAST_KEY, user.id);
  },
  accountsList() {
    accounts = loadAccounts();
    return Object.values(accounts).map((a) => ({
      id: a.user?.id,
      user: a.user,
      memberships: a.memberships || [],
      schoolId: a.schoolId,
      role: a.user?.isPlatformAdmin
        ? "PLATFORM_ADMIN"
        : (a.memberships || []).find((m) => m.schoolId === a.schoolId)?.role || (a.memberships || [])[0]?.role || "",
    }));
  },
  activate(id) {
    accounts = loadAccounts();
    if (!accounts[id]) return false;
    activeId = id;
    sessionStorage.setItem(TAB_KEY, id);
    localStorage.setItem(LAST_KEY, id);
    return true;
  },
  snapshot() {
    return JSON.stringify({ accounts: loadAccounts(), activeId, last: localStorage.getItem(LAST_KEY), pin: tabPin() });
  },
  restore(snap) {
    try {
      const s = JSON.parse(snap);
      accounts = s.accounts || {};
      saveAccounts();
      activeId = s.activeId || null;
      pending = null;
      if (s.pin === null || s.pin === undefined) sessionStorage.removeItem(TAB_KEY);
      else sessionStorage.setItem(TAB_KEY, s.pin);
      if (s.last) localStorage.setItem(LAST_KEY, s.last); else localStorage.removeItem(LAST_KEY);
    } catch { /* ignore */ }
  },
  // Log out THIS tab's account only; other accounts stay signed in.
  clear() {
    accounts = loadAccounts();
    if (activeId && accounts[activeId]) { delete accounts[activeId]; saveAccounts(); }
    if (localStorage.getItem(LAST_KEY) === activeId) localStorage.removeItem(LAST_KEY);
    activeId = null;
    pending = null;
    sessionStorage.setItem(TAB_KEY, ""); // this tab stays logged out
  },
};

async function raw(path, { method = "GET", body, school = true, deviceKey } = {}) {
  const headers = { "content-type": "application/json" };
  const token = session.accessToken;
  if (token) headers.authorization = `Bearer ${token}`;
  if (school && session.schoolId) headers["x-school-id"] = session.schoolId;
  if (deviceKey) headers["x-device-key"] = deviceKey;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function tryRefresh() {
  const rt = session.refreshToken;
  if (!rt) return false;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: rt }),
  });
  if (!res.ok) return false;
  const json = await res.json();
  session.setTokens(json.accessToken, json.refreshToken);
  return true;
}

export async function api(path, opts = {}) {
  let r = await raw(path, opts);
  if (r.status === 401 && session.refreshToken && !path.startsWith("/auth/")) {
    if (await tryRefresh()) r = await raw(path, opts);
  }
  return r;
}

export async function login(email, password) {
  const r = await raw("/auth/login", { method: "POST", body: { email, password }, school: false });
  if (r.status === 200) session.establish(r.json);
  return r;
}

export async function loginWithOtp(phone, code) {
  const r = await raw("/auth/parent-otp/verify", { method: "POST", body: { phone, code }, school: false });
  if (r.status === 200) session.establish(r.json);
  return r;
}

// Revoke one specific earlier session server-side. Kept for callers
// that explicitly end another session (multi-account sign-in does
// NOT revoke other accounts any more).
export async function revokeSession(access, refresh) {
  if (!access) return;
  await fetch(`${BASE}/auth/logout`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
    body: JSON.stringify({ refreshToken: refresh }),
  }).catch(() => {});
}

export function currentUser() {
  return session.user;
}
export function myMemberships() {
  return session.memberships;
}
export function myRole() {
  const m = session.memberships.find((x) => x.schoolId === session.schoolId);
  return m?.role || (currentUser()?.isPlatformAdmin ? "PLATFORM_ADMIN" : null);
}
