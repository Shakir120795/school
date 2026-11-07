// API client with a SINGLE session (Phase 40).
//
// One browser = exactly one signed-in account. (Phase 30's
// multi-account book and sidebar switcher were removed on shakir's
// instruction: "kisi bhi login me kisi dusre ka switch nhi krna h" —
// no switching into another account anywhere.) Signing in REPLACES
// any previous session on this device, the login pages show no
// sign-in form while someone is signed in, and to use another
// account you must log out first. All tabs share the one session
// (localStorage ss_session_v3).
const BASE = import.meta.env.VITE_API_BASE || "";

const SESSION_KEY = "ss_session_v3";

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function saveSession() {
  if (current) localStorage.setItem(SESSION_KEY, JSON.stringify(current));
  else localStorage.removeItem(SESSION_KEY);
}

let current = loadSession();
let pending = null; // tokens seen before the user object is known

// One-time migration: pre-Phase-40 devices hold a multi-account
// book (ss_accounts_v2) and per-tab pins. Keep ONLY the most
// recently used account so nobody is logged out by the upgrade —
// the rest are dropped, because switching between them is gone.
// (Also clears the pre-Phase-30 legacy single-session keys.)
if (!current) {
  try {
    const book = JSON.parse(localStorage.getItem("ss_accounts_v2") || "{}") || {};
    const last = localStorage.getItem("ss_last_account_v2");
    const acc = (last && book[last]) || Object.values(book)[0] || null;
    if (acc?.accessToken) {
      current = {
        user: acc.user || null,
        memberships: acc.memberships || [],
        accessToken: acc.accessToken,
        refreshToken: acc.refreshToken || null,
        schoolId: acc.schoolId || null,
      };
      saveSession();
    }
  } catch { /* broken old state: start clean */ }
}
localStorage.removeItem("ss_accounts_v2");
localStorage.removeItem("ss_last_account_v2");
localStorage.removeItem("ss_access");
localStorage.removeItem("ss_refresh");
localStorage.removeItem("ss_school");
localStorage.removeItem("ss_user");
localStorage.removeItem("ss_memberships");
try { sessionStorage.removeItem("ss_active_account_v2"); } catch { /* ignore */ }

function persistActive(patch) {
  if (current) { Object.assign(current, patch); saveSession(); return; }
  pending = { ...(pending || {}), ...patch };
}

export const session = {
  get accessToken() { return current?.accessToken || pending?.accessToken || null; },
  get refreshToken() { return current?.refreshToken || pending?.refreshToken || null; },
  get schoolId() { return current?.schoolId || pending?.schoolId || null; },
  get user() { return current?.user || null; },
  get memberships() { return current?.memberships || []; },
  get membership() { return this.memberships.find((m) => m.schoolId === this.schoolId) || null; },
  setTokens(access, refresh) { persistActive({ accessToken: access, refreshToken: refresh }); },
  setSchool(id) { persistActive({ schoolId: id }); },
  // Save a freshly authenticated account. Single-login rule: this
  // REPLACES whatever session this device held before — the old
  // account is not kept anywhere and cannot be switched back to.
  establish(json) {
    const user = json.user;
    if (!user?.id) return;
    const memberships = json.memberships || [];
    const schoolId = current?.user?.id === user.id && current.schoolId
      && memberships.some((m) => m.schoolId === current.schoolId)
      ? current.schoolId
      : memberships[0]?.schoolId || null;
    current = {
      user,
      memberships,
      accessToken: json.accessToken,
      refreshToken: json.refreshToken,
      schoolId,
    };
    pending = null;
    saveSession();
  },
  // Log out: the device's only session is removed entirely.
  clear() {
    current = null;
    pending = null;
    saveSession();
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
  if (!rt) return "dead";
  let res;
  try {
    res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    });
  } catch { return "unknown"; } // network trouble — never punish the account
  if (res.status === 401 || res.status === 403) return "dead";
  if (!res.ok) return "unknown";
  const json = await res.json();
  session.setTokens(json.accessToken, json.refreshToken);
  return "ok";
}

let deadHandled = false;
function handleDeadSession() {
  if (deadHandled) return;
  deadHandled = true;
  session.clear();
  location.href = "/login";
}

// Phase 35 + 40: called once when the app shell loads. If this
// device's session is dead server-side (revoked, e.g. the member
// was removed, or every membership is inactive), drop it right
// away and go to the login page — a removed ID must never linger
// looking signed in.
export async function pruneDeadActiveAccount() {
  if (!session.accessToken || !session.user) return;
  const r = await raw("/auth/me", { school: false }).catch(() => null);
  if (!r) return;
  if (r.status === 401) {
    if ((await tryRefresh()) === "dead") handleDeadSession();
    return;
  }
  if (r.status !== 200) return;
  const u = r.json.user;
  const ms = r.json.memberships || [];
  if (!u?.isPlatformAdmin && !ms.some((m) => m.status === "ACTIVE")) handleDeadSession();
}

export async function api(path, opts = {}) {
  let r = await raw(path, opts);
  if (r.status === 401 && session.refreshToken && !path.startsWith("/auth/")) {
    const st = await tryRefresh();
    if (st === "ok") r = await raw(path, opts);
    else if (st === "dead") handleDeadSession();
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
