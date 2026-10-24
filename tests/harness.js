// Test harness: spawns the real API server as a child process against a
// dedicated *_test database. Refuses to run against a non-test database.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function assertTestDb() {
  const url = process.env.DATABASE_URL || "";
  if (!url.includes("_test")) {
    throw new Error(`Refusing to run tests: DATABASE_URL must point to a *_test database, got: ${url.replace(/:[^:@/]+@/, ":***@")}`);
  }
}

export async function startServer(extraEnv = {}) {
  assertTestDb();
  const port = 4200 + Math.floor(Math.random() * 700);
  const child = spawn("node", ["src/server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), JWT_SECRET: "test-secret", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return { child, base };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error("server did not start");
}

export function stopServer(child) {
  child.kill("SIGKILL");
}

export async function api(base, method, pathName, { token, schoolId, deviceKey, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (schoolId) headers["x-school-id"] = schoolId;
  if (deviceKey) headers["x-device-key"] = deviceKey;
  const res = await fetch(`${base}${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

let seq = 0;
export function uniq(prefix) {
  return `${prefix}-${Date.now()}-${++seq}`;
}

/** Current HH:MM in Asia/Kolkata, optionally shifted by minutes. */
export function kolkataTime(shiftMin = 0) {
  const now = new Date(Date.now() + shiftMin * 60000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hh = parts.find((p) => p.type === "hour").value.replace("24", "00");
  const mm = parts.find((p) => p.type === "minute").value;
  return `${hh}:${mm}`;
}

/** Bootstraps platform admin + one school with admin login. Returns context. */
let sharedOp = null;
export async function bootstrapSchool(base, label) {
  if (!sharedOp) {
    // Fixed test-only operator identity: test files run as separate processes
    // against the same test DB, so a later process logs in instead of registering.
    const opEmail = "operator@test.dev";
    const reg = await api(base, "POST", "/auth/register-platform-admin", {
      body: { email: opEmail, password: "OpPass123!", fullName: "Operator" },
    });
    if (reg.status !== 201 && reg.json.error !== "PLATFORM_ADMIN_ALREADY_EXISTS")
      throw new Error("operator bootstrap failed: " + JSON.stringify(reg.json));
    const opLogin = await api(base, "POST", "/auth/login", { body: { email: opEmail, password: "OpPass123!" } });
    sharedOp = { email: opEmail, token: opLogin.json.accessToken };
  }
  const opToken = sharedOp.token;
  const slug = uniq(label);
  const created = await api(base, "POST", "/schools", {
    token: opToken,
    body: {
      name: `School ${label}`,
      slug,
      adminEmail: `${slug}@test.dev`,
      adminPassword: "Admin123!",
      adminName: "School Admin",
    },
  });
  const schoolId = created.json.school.id;
  const adminLogin = await api(base, "POST", "/auth/login", {
    body: { email: `${slug}@test.dev`, password: "Admin123!" },
  });
  return { schoolId, adminToken: adminLogin.json.accessToken, opToken };
}

/** Creates year+class+subject under a school. */
export async function makeClass(base, schoolId, adminToken) {
  const year = await api(base, "POST", `/schools/${schoolId}/academic-years`, {
    token: adminToken, schoolId, body: { name: `Y-${uniq("")}`, startsOn: "2026-04-01", endsOn: "2027-03-31" },
  });
  const cls = await api(base, "POST", `/schools/${schoolId}/classrooms`, {
    token: adminToken, schoolId, body: { academicYearId: year.json.academicYear.id, name: "5", section: "A" },
  });
  const subj = await api(base, "POST", `/schools/${schoolId}/subjects`, {
    token: adminToken, schoolId, body: { name: "Maths", code: `MATH-${uniq("").slice(-4)}` },
  });
  return { yearId: year.json.academicYear.id, classId: cls.json.classroom.id, subjectId: subj.json.subject.id };
}

export async function makeStudentWithGuardian(base, schoolId, adminToken, classId, yearId) {
  const adm = uniq("ADM");
  const stu = await api(base, "POST", `/schools/${schoolId}/students`, {
    token: adminToken, schoolId,
    body: { admissionNo: adm, fullName: `Student ${adm}`, classroomId: classId, academicYearId: yearId },
  });
  const studentId = stu.json.student.id;
  // parent user + guardian profile linked to that user
  const parentEmail = `${uniq("parent")}@test.dev`;
  const parent = await api(base, "POST", `/schools/${schoolId}/users`, {
    token: adminToken, schoolId,
    body: { email: parentEmail, password: "Parent123!", fullName: "Parent One", role: "PARENT" },
  });
  const guardian = await api(base, "POST", `/schools/${schoolId}/guardians`, {
    token: adminToken, schoolId,
    body: { fullName: "Parent One", phone: "9999999999", userId: parent.json.userId },
  });
  const guardianId = guardian.json.guardian.id;
  await api(base, "POST", `/schools/${schoolId}/students/${studentId}/guardians`, {
    token: adminToken, schoolId, body: { guardianId, isPrimary: true },
  });
  const parentLogin = await api(base, "POST", "/auth/login", { body: { email: parentEmail, password: "Parent123!" } });
  return { studentId, guardianId, parentToken: parentLogin.json.accessToken, parentUserId: parent.json.userId };
}

export async function makeTeacher(base, schoolId, adminToken, { visible = true } = {}) {
  const email = `${uniq("teacher")}@test.dev`;
  const user = await api(base, "POST", `/schools/${schoolId}/users`, {
    token: adminToken, schoolId,
    body: { email, password: "Teach123!", fullName: "Teacher One", role: "TEACHER" },
  });
  const memberships = await api(base, "GET", `/schools/${schoolId}/users`, { token: adminToken, schoolId });
  const membership = memberships.json.memberships.find((m) => m.userId === user.json.userId);
  const profile = await api(base, "POST", `/schools/${schoolId}/teachers`, {
    token: adminToken, schoolId,
    body: { membershipId: membership.id, displayName: "Teacher One", isVisibleToParents: visible },
  });
  const login = await api(base, "POST", "/auth/login", { body: { email, password: "Teach123!" } });
  return {
    teacherId: profile.json.teacher.id,
    membershipId: membership.id,
    teacherToken: login.json.accessToken,
    teacherUserId: user.json.userId,
  };
}

export async function issueCard(base, schoolId, adminToken, body) {
  const r = await api(base, "POST", `/schools/${schoolId}/cards`, { token: adminToken, schoolId, body });
  return r.json; // {card, qrToken}
}

export async function makeDevice(base, schoolId, adminToken) {
  const r = await api(base, "POST", `/schools/${schoolId}/devices`, {
    token: adminToken, schoolId, body: { name: "Gate" },
  });
  return r.json.deviceKey;
}

export async function setPolicy(base, schoolId, adminToken, policy) {
  return api(base, "POST", `/schools/${schoolId}/attendance-policies`, { token: adminToken, schoolId, body: policy });
}

export function scan(base, schoolId, deviceKey, qrToken, eventType, idempotencyKey) {
  return api(base, "POST", "/attendance/scan", {
    schoolId, deviceKey, body: { qrToken, eventType, idempotencyKey },
  });
}
