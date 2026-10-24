// Load check: seeds a throwaway school, then fires concurrent gate scans
// and dashboard reads at the API and reports latency + outcome counts.
// Usage (API DB should be a load-test DB):
//   DATABASE_URL=... RATE_LIMIT_API_PER_MIN=100000 PORT=4300 node src/server.js &
//   API_BASE=http://localhost:4300 node scripts/load-check.mjs
const BASE = process.env.API_BASE || "http://localhost:4300";
const STUDENTS = Number(process.env.LOAD_STUDENTS || 40);
const ROUNDS = Number(process.env.LOAD_ROUNDS || 5); // ENTRY/EXIT alternating
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 20);

async function api(path, { method = "GET", token, schoolId, deviceKey, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (schoolId) headers["x-school-id"] = schoolId;
  if (deviceKey) headers["x-device-key"] = deviceKey;
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ms = performance.now() - t0;
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ms };
}

function stats(times) {
  const s = [...times].sort((a, b) => a - b);
  const pick = (q) => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
  return { n: s.length, p50: pick(0.5), p95: pick(0.95), max: Math.round(s[s.length - 1]) };
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) out.push(await fn(items[i++]));
    })
  );
  return out;
}

// --- seed ---
const suffix = Date.now();
await api("/auth/register-platform-admin", { method: "POST", body: { email: `load-op-${suffix}@t.dev`, password: "LoadOp123!", fullName: "Load Op" } })
  .catch(() => {});
const op = await api("/auth/login", { method: "POST", body: { email: `load-op-${suffix}@t.dev`, password: "LoadOp123!" } });
if (!op.json.accessToken) {
  // A platform admin already exists in this DB; load-op login works only on a
  // fresh DB — say so instead of failing mysteriously.
  console.error("Could not log in as load operator. Run against a fresh/load DB (see docs/PHASE5-REPORT.md).");
  process.exit(1);
}
const school = (await api("/schools", {
  method: "POST", token: op.json.accessToken,
  body: { name: "Load School", slug: `load-${suffix}`, adminEmail: `load-admin-${suffix}@t.dev`, adminPassword: "LoadAdmin123!", adminName: "Load Admin" },
})).json.school;
const admin = await api("/auth/login", { method: "POST", body: { email: `load-admin-${suffix}@t.dev`, password: "LoadAdmin123!" } });
const A = admin.json.accessToken;
const year = (await api(`/schools/${school.id}/academic-years`, { method: "POST", token: A, schoolId: school.id, body: { name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" } })).json.academicYear;
const cls = (await api(`/schools/${school.id}/classrooms`, { method: "POST", token: A, schoolId: school.id, body: { academicYearId: year.id, name: "6", section: "A" } })).json.classroom;
await api(`/schools/${school.id}/attendance-policies`, { method: "POST", token: A, schoolId: school.id, body: { appliesTo: "STUDENT", entryStart: "00:00", entryEnd: "23:59", lateAfter: "23:59", exitStart: "00:00", exitEnd: "23:59", workingWeekdays: [1, 2, 3, 4, 5, 6, 7] } });
const deviceKey = (await api(`/schools/${school.id}/devices`, { method: "POST", token: A, schoolId: school.id, body: { name: "Load gate" } })).json.deviceKey;

const cards = [];
for (let i = 0; i < STUDENTS; i++) {
  const stu = (await api(`/schools/${school.id}/students`, { method: "POST", token: A, schoolId: school.id, body: { admissionNo: `L${i}`, fullName: `Load Student ${i}`, classroomId: cls.id, academicYearId: year.id } })).json.student;
  const card = (await api(`/schools/${school.id}/cards`, { method: "POST", token: A, schoolId: school.id, body: { ownerType: "STUDENT", studentId: stu.id } })).json;
  cards.push(card.qrToken);
}
console.log(`seeded ${STUDENTS} students; running ${STUDENTS * ROUNDS} scans + reads…`);

// --- scans ---
const scanJobs = [];
for (let r = 0; r < ROUNDS; r++) {
  for (let i = 0; i < STUDENTS; i++) {
    scanJobs.push({ token: cards[i], type: r % 2 === 0 ? "ENTRY" : "EXIT", key: `load-${suffix}-${r}-${i}` });
  }
}
const scanResults = await pool(scanJobs, CONCURRENCY, (j) =>
  api("/attendance/scan", { method: "POST", schoolId: school.id, deviceKey, body: { qrToken: j.token, eventType: j.type, idempotencyKey: j.key } })
);
const scanTimes = scanResults.map((r) => r.ms);
const outcomes = {};
let scanErrors = 0;
for (const r of scanResults) {
  if (r.status !== 200) scanErrors++;
  outcomes[r.json.outcome || `HTTP${r.status}`] = (outcomes[r.json.outcome || `HTTP${r.status}`] || 0) + 1;
}

// --- reads ---
const readJobs = Array.from({ length: 50 }, (_, i) => i);
const readResults = await pool(readJobs, CONCURRENCY, (i) =>
  api(i % 2 ? `/schools/${school.id}/attendance/students` : `/schools/${school.id}/students`, { token: A, schoolId: school.id })
);
const readTimes = readResults.map((r) => r.ms);
const readErrors = readResults.filter((r) => r.status !== 200).length;

console.log(JSON.stringify({
  scans: { total: scanResults.length, errors: scanErrors, outcomes, latencyMs: stats(scanTimes) },
  reads: { total: readResults.length, errors: readErrors, latencyMs: stats(readTimes) },
}, null, 2));
if (scanErrors || readErrors) process.exit(1);
