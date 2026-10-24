// API client: attaches the access token + active school, transparently
// refreshes an expired access token once, and retries the request.
const BASE = import.meta.env.VITE_API_BASE || "";

let accessToken = localStorage.getItem("ss_access") || null;
let refreshToken = localStorage.getItem("ss_refresh") || null;
let schoolId = localStorage.getItem("ss_school") || null;

export const session = {
  get accessToken() { return accessToken; },
  get schoolId() { return schoolId; },
  setTokens(access, refresh) {
    accessToken = access; refreshToken = refresh;
    if (access) localStorage.setItem("ss_access", access); else localStorage.removeItem("ss_access");
    if (refresh) localStorage.setItem("ss_refresh", refresh); else localStorage.removeItem("ss_refresh");
  },
  setSchool(id) {
    schoolId = id;
    if (id) localStorage.setItem("ss_school", id); else localStorage.removeItem("ss_school");
  },
  clear() {
    this.setTokens(null, null);
    this.setSchool(null);
    localStorage.removeItem("ss_user");
    localStorage.removeItem("ss_memberships");
  },
};

async function raw(path, { method = "GET", body, school = true, deviceKey } = {}) {
  const headers = { "content-type": "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (school && schoolId) headers["x-school-id"] = schoolId;
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
  if (!refreshToken) return false;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const json = await res.json();
  session.setTokens(json.accessToken, json.refreshToken);
  return true;
}

export async function api(path, opts = {}) {
  let r = await raw(path, opts);
  if (r.status === 401 && refreshToken && !path.startsWith("/auth/")) {
    if (await tryRefresh()) r = await raw(path, opts);
  }
  return r;
}

export async function login(email, password) {
  const r = await raw("/auth/login", { method: "POST", body: { email, password }, school: false });
  if (r.status === 200) {
    session.setTokens(r.json.accessToken, r.json.refreshToken);
    localStorage.setItem("ss_user", JSON.stringify(r.json.user));
    localStorage.setItem("ss_memberships", JSON.stringify(r.json.memberships || []));
    if (r.json.memberships?.length && !schoolId) session.setSchool(r.json.memberships[0].schoolId);
  }
  return r;
}

export async function loginWithOtp(phone, code) {
  const r = await raw("/auth/parent-otp/verify", { method: "POST", body: { phone, code }, school: false });
  if (r.status === 200) {
    session.setTokens(r.json.accessToken, r.json.refreshToken);
    localStorage.setItem("ss_user", JSON.stringify(r.json.user));
    localStorage.setItem("ss_memberships", JSON.stringify(r.json.memberships || []));
    if (r.json.memberships?.length) session.setSchool(r.json.memberships[0].schoolId);
  }
  return r;
}

export function currentUser() {
  try { return JSON.parse(localStorage.getItem("ss_user") || "null"); } catch { return null; }
}
export function myMemberships() {
  try { return JSON.parse(localStorage.getItem("ss_memberships") || "[]"); } catch { return []; }
}
export function myRole() {
  const m = myMemberships().find((x) => x.schoolId === schoolId);
  return m?.role || (currentUser()?.isPlatformAdmin ? "PLATFORM_ADMIN" : null);
}
