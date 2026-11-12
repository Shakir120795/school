// API client with MULTI-ACCOUNT sessions but NO SWITCHING (Phase 41).
//
// Shakir's final rule (8 Nov 2026): "ek device pr sabhi id access
// ho ske, or har id login me koi bhi switch link na ho" — every ID
// can be signed in on one device (each browser TAB holds its own
// account, so parent/teacher/admin tabs can stay open together),
// but there is NO account switcher or "switch" link anywhere:
// no sidebar switcher (removed in Phase 40, stays removed), no
// one-tap jumping between accounts. The ONLY way into an account
// is typing its credentials on its login page. Signing in pins
// THIS tab to the new account; accounts open in other tabs are
// untouched. This supersedes Phase 40's single-session model,
// which in turn had superseded Phase 30's with-switcher model.
import { lang } from "./i18n.js";

const BASE = import.meta.env.VITE_API_BASE || "";

const ACCOUNTS_KEY = "ss_accounts_v3";
const LAST_KEY = "ss_last_account_v3";
const TAB_KEY = "ss_active_account_v3";

function loadAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}") || {}; } catch { return {}; }
}
function saveAccounts() {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

let accounts = loadAccounts();
let pending = null; // tokens seen before the user object is known

// One-time migrations into the v3 book, so an upgrade never logs
// anyone out: (a) Phase 40's single session (ss_session_v3),
// (b) any pre-Phase-40 multi-account book (ss_accounts_v2) still
// sitting on devices that never loaded the Phase 40 build.
if (!Object.keys(accounts).length) {
  try {
    const old = JSON.parse(localStorage.getItem("ss_accounts_v2") || "{}") || {};
    for (const [id, acc] of Object.entries(old)) if (acc?.accessToken) accounts[id] = acc;
  } catch { /* ignore */ }
  try {
    const s = JSON.parse(localStorage.getItem("ss_session_v3") || "null");
    if (s?.user?.id && s?.accessToken) {
      accounts[s.user.id] = {
        user: s.user,
        memberships: s.memberships || [],
        accessToken: s.accessToken,
        refreshToken: s.refreshToken || null,
        schoolId: s.schoolId || null,
      };
      localStorage.setItem(LAST_KEY, s.user.id);
    }
  } catch { /* ignore */ }
  if (Object.keys(accounts).length) saveAccounts();
}
localStorage.removeItem("ss_accounts_v2");
localStorage.removeItem("ss_last_account_v2");
localStorage.removeItem("ss_session_v3");
localStorage.removeItem("ss_access");
localStorage.removeItem("ss_refresh");
localStorage.removeItem("ss_school");
localStorage.removeItem("ss_user");
localStorage.removeItem("ss_memberships");
try { sessionStorage.removeItem("ss_active_account_v2"); } catch { /* ignore */ }

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
  setTokens(access, refresh) { persistActive({ accessToken: access, refreshToken: refresh }); },
  setSchool(id) { persistActive({ schoolId: id }); },
  // Save a freshly authenticated account and pin THIS tab to it.
  // Accounts open in other tabs stay signed in, untouched — and
  // there is deliberately NO function anywhere that switches this
  // tab to an already-saved account: a different account in this
  // tab always requires a fresh credential sign-in.
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
  // Phase 35 ki drop-and-fallback Phase 48d me HATA di: dead
  // session par dusra account adopt karna ek silent switch tha.
  // Ab handleDeadSession session.clear() karke login bhejta hai.
  // Log out THIS tab's account only; accounts open in other tabs
  // stay signed in.
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

// Phase 48d: refresh SINGLE-FLIGHT hai. Pehle hard refresh par
// shell + page ki saari parallel calls ek saath token refresh
// karti thi; server rotation pehla token turant revoke kar deta
// hai, to dusri call ko 401 milta aur account "dead" maan kar
// app dusre account par switch ho jata tha (shakir: hard refresh
// par admin console khul raha tha). Ab ek samay par ek hi
// refresh chalti hai, baaki usi ka result use karti hain.
let refreshInFlight = null;
function tryRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function doRefresh() {
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
  // Phase 48d: dead session par dusra account ADOPT nahi hoga —
  // wo bhi ek silent switch hi tha (Phase 41 ka rule: koi switch
  // nahi, kabhi nahi). Is tab ka dead account saaf karke seedha
  // login page par bhejo; dusre tabs ke accounts waise hi rahe.
  session.clear();
  location.href = "/login";
}

// Phase 35: called once when the app shell loads. If this tab's
// account is dead server-side (session revoked, or every
// membership removed/suspended), drop it right away instead of
// showing a zombie login that cannot actually do anything.
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
  // Phase 53 fix: server se aayi taaza memberships (ab membership
  // id ke saath) stored account me bhi bhar do — warna purane
  // saved login par naya field kabhi pahunchega hi nahi aur
  // teacher ki pehchan (My classes card, subject scope) fail
  // hoti rahegi.
  const fresh = ms.filter((m) => m.status === "ACTIVE").map((m) => ({ id: m.id, schoolId: m.schoolId, role: m.role }));
  // Phase 63: memberships ke saath schoolId ki bhi marammat —
  // stored schoolId agar taaza memberships me hai hi nahi
  // (stale book), to pehli ACTIVE membership ka school set kar
  // do, warna role null padkar poora nav/menu khali dikhta tha.
  // fresh khali ho (jaise platform admin/owner, jinki koi
  // membership nahi hoti) to schoolId ko haath mat lagao.
  const patch = {};
  if (fresh.length && JSON.stringify(fresh) !== JSON.stringify(session.memberships)) patch.memberships = fresh;
  if (fresh.length && !fresh.some((m) => m.schoolId === session.schoolId)) patch.schoolId = fresh[0].schoolId;
  if (Object.keys(patch).length) persistActive(patch);
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

// Phase 61 (audit UX): server ke raw error CODE (ADMISSION_NO_TAKEN
// jaise) user ko kabhi na dikhen — jahan code ka saaf matlab hai
// wahan aam bhasha, warna khali string (caller apna fallback de).
const FRIENDLY_ERRORS = {
  ADMISSION_NO_TAKEN: "That admission number is already used by another student — please try a different one.",
  INVALID_CREDENTIALS: "Wrong login ID or password.",
  STUDENT_NOT_IN_CLASS: "That student is not in this class.",
  NO_CLASS_TEACHER: "This class has no class teacher set yet — please send it to the School Office instead.",
  TIME_TAKEN: "That time is already booked — please pick another time.",
  ALREADY_BOOKED_FOR_THIS_CHILD: "This child already has a booking for this meeting.",
  PASSWORD_TOO_SHORT: "Password is too short — use at least 8 characters.",
  INVALID_ROLE: "That role is not allowed here.",
  RATE_LIMITED: "Too many tries — please wait a minute and try again.",
  MISSING_FIELDS: "Some required information is missing.",
  NOT_FOUND: "That record could not be found.",
  OTP_NOT_AVAILABLE: "Mobile OTP login is not available right now — please use your login ID and password.",
  STUDENT_REQUIRED: "Please choose your child first.",
  INVALID_CHANGES: "That change is not allowed.",
  INVALID_ENTITY_TYPE: "That record type cannot be corrected here.",
  ENTITY_NOT_FOUND: "That attendance record could not be found.",
  NOT_INCHARGE: "You are not the class incharge for this class.",
  CLASS_NOT_ASSIGNED: "This class is not assigned to you.",
  REMOVAL_REASON_REQUIRED: "Please choose a reason for removing this member.",
  OVERPAYMENT: "That amount is more than the balance due.",
};
export function friendlyError(code) {
  if (!code || typeof code !== "string") return "";
  return FRIENDLY_ERRORS[code] || "";
}

// Phase 61: tareekh har jagah ek jaise, padhne layak format me
// (2026-11-12 ki jagah "12 Nov 2026"; Hindi chuna ho to hi-IN).
export function fmtDate(d) {
  if (!d) return "—";
  const s = String(d);
  const dt = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(dt.getTime())) return s.slice(0, 10);
  return dt.toLocaleDateString(lang.value === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function currentUser() {
  return session.user;
}
export function myMemberships() {
  return session.memberships;
}
export function myRole() {
  const ms = session.memberships;
  // Phase 63: stored schoolId agar kisi membership se match na
  // kare (purana saved login / stale account book) to pehli
  // membership ka role lo — pehle role null ho jata tha aur
  // sidebar + ☰ menu PURE khali ho jate thay (sirf Language +
  // Logout dikhta tha). Ye account switch NAHI hai: sirf usi
  // user ki apni membership hai; schoolId ki asal marammat
  // pruneDeadActiveAccount shell load par kar deta hai.
  const m = ms.find((x) => x.schoolId === session.schoolId) || ms[0];
  return m?.role || (currentUser()?.isPlatformAdmin ? "PLATFORM_ADMIN" : null);
}
