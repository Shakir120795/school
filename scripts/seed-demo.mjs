// Demo seed for LOCAL development only — creates one demo school with demo
// logins (passwords below are public demo values, never use in production).
// Usage:  node scripts/seed-demo.mjs            (API must be running)
//         API_BASE=http://localhost:4000 node scripts/seed-demo.mjs
// Assumes a fresh database; if the demo school already exists it exits.
const BASE = process.env.API_BASE || "http://localhost:4000";

async function api(path, { method = "GET", token, schoolId, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (schoolId) headers["x-school-id"] = schoolId;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const P = {
  operator: "DemoOp123!",
  admin: "DemoAdmin123!",
  principal: "DemoPrincipal123!",
  teacher: "DemoTeach123!",
  parent: "DemoParent123!",
};

await api("/auth/register-platform-admin", {
  method: "POST",
  body: { email: "operator@demo.school", password: P.operator, fullName: "Demo Operator" },
}).catch((e) => {
  if (!String(e).includes("PLATFORM_ADMIN_ALREADY_EXISTS")) throw e;
});
const op = await api("/auth/login", { method: "POST", body: { email: "operator@demo.school", password: P.operator } });

const { school } = await api("/schools", {
  method: "POST",
  token: op.accessToken,
  body: {
    name: "Demo Public School",
    slug: "demo-public",
    adminEmail: "admin@demo.school",
    adminPassword: P.admin,
    adminName: "Demo Admin",
  },
});
const sid = school.id;
const admin = await api("/auth/login", { method: "POST", body: { email: "admin@demo.school", password: P.admin } });
const A = admin.accessToken;

const year = (await api(`/schools/${sid}/academic-years`, { method: "POST", token: A, schoolId: sid, body: { name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" } })).academicYear;
const cls = (await api(`/schools/${sid}/classrooms`, { method: "POST", token: A, schoolId: sid, body: { academicYearId: year.id, name: "5", section: "A" } })).classroom;
const math = (await api(`/schools/${sid}/subjects`, { method: "POST", token: A, schoolId: sid, body: { name: "Mathematics", code: "MATH" } })).subject;
await api(`/schools/${sid}/subjects`, { method: "POST", token: A, schoolId: sid, body: { name: "English", code: "ENG" } });

await api(`/schools/${sid}/users`, { method: "POST", token: A, schoolId: sid, body: { email: "principal@demo.school", password: P.principal, fullName: "Demo Principal", role: "PRINCIPAL" } });

const teacherUser = await api(`/schools/${sid}/users`, { method: "POST", token: A, schoolId: sid, body: { email: "teacher@demo.school", password: P.teacher, fullName: "Anita Sharma", role: "TEACHER" } });
const memberships = (await api(`/schools/${sid}/users`, { token: A, schoolId: sid })).memberships;
const tMembership = memberships.find((m) => m.userId === teacherUser.userId);
const teacher = (await api(`/schools/${sid}/teachers`, { method: "POST", token: A, schoolId: sid, body: { membershipId: tMembership.id, displayName: "Anita Sharma", approvedContactChannel: "School office: 011-4000-000" } })).teacher;
await api(`/schools/${sid}/teacher-assignments`, { method: "POST", token: A, schoolId: sid, body: { teacherId: teacher.id, classroomId: cls.id, subjectId: math.id, academicYearId: year.id } });
await api(`/schools/${sid}/class-incharge`, { method: "POST", token: A, schoolId: sid, body: { teacherId: teacher.id, classroomId: cls.id, academicYearId: year.id, effectiveFrom: "2026-04-01" } });

const parentUser = await api(`/schools/${sid}/users`, { method: "POST", token: A, schoolId: sid, body: { email: "parent@demo.school", password: P.parent, fullName: "Rahul Verma", role: "PARENT" } });
const guardian = (await api(`/schools/${sid}/guardians`, { method: "POST", token: A, schoolId: sid, body: { fullName: "Rahul Verma", phone: "9810000000", userId: parentUser.userId } })).guardian;

const kids = [];
for (const [adm, name] of [["D001", "Aarav Verma"], ["D002", "Diya Verma"], ["D003", "Kabir Singh"]]) {
  const s = (await api(`/schools/${sid}/students`, { method: "POST", token: A, schoolId: sid, body: { admissionNo: adm, fullName: name, classroomId: cls.id, academicYearId: year.id } })).student;
  kids.push(s);
}
await api(`/schools/${sid}/students/${kids[0].id}/guardians`, { method: "POST", token: A, schoolId: sid, body: { guardianId: guardian.id, isPrimary: true } });
await api(`/schools/${sid}/students/${kids[1].id}/guardians`, { method: "POST", token: A, schoolId: sid, body: { guardianId: guardian.id } });

await api(`/schools/${sid}/attendance-policies`, { method: "POST", token: A, schoolId: sid, body: { appliesTo: "STUDENT", entryStart: "07:30", entryEnd: "08:15", lateAfter: "08:15", exitStart: "13:30", exitEnd: "14:30", workingWeekdays: [1, 2, 3, 4, 5, 6] } });
await api(`/schools/${sid}/attendance-policies`, { method: "POST", token: A, schoolId: sid, body: { appliesTo: "STAFF", entryStart: "07:00", entryEnd: "08:30", lateAfter: "08:30", exitStart: "14:00", exitEnd: "15:30", workingWeekdays: [1, 2, 3, 4, 5, 6] } });

const device = await api(`/schools/${sid}/devices`, { method: "POST", token: A, schoolId: sid, body: { name: "Main gate tablet" } });
const card = await api(`/schools/${sid}/cards`, { method: "POST", token: A, schoolId: sid, body: { ownerType: "STUDENT", studentId: kids[0].id } });

console.log(`
DEMO READY — school: Demo Public School (id ${sid})
  Platform operator : operator@demo.school / ${P.operator}
  School admin      : admin@demo.school / ${P.admin}
  Principal         : principal@demo.school / ${P.principal}
  Teacher (5-A, Maths, class incharge): teacher@demo.school / ${P.teacher}
  Parent (2 children linked)          : parent@demo.school / ${P.parent}
  Gate device key   : ${device.deviceKey}
  Sample student QR token (Aarav Verma): ${card.qrToken}
`);
