// Seed TEST schools with realistic mock data into the LIVE database so
// the owner can test the app at real-school scale (tabs / search /
// pagination with 50 students + 50 parents per school). Demo Public
// School is NOT touched. Re-runnable: a school whose slug already
// exists is skipped whole, never duplicated.
//
// Usage:  node scripts/seed-test-schools.mjs
//         API_BASE=https://smart-school-tawny.vercel.app node scripts/seed-test-schools.mjs
//         OP_EMAIL=... OP_PASSWORD=... node scripts/seed-test-schools.mjs
//
// What each school gets:
//   - 1 school-admin login, 5 teacher logins (+ teacher profiles)
//   - Classes 1–5 × sections A+B (10 classrooms, this school's own),
//     each with a class teacher rotated across the 5 teachers
//     (class-incharge + a subject assignment, so roll-call works)
//   - 5 students per class-section = 50 students, admission nos
//     1001–1050, each linked to a guardian who has a parent login
//
// Login patterns (uniform demo passwords — TEST data only):
//   School admin : admin@<slug>.demo          / Admin@123
//   Teachers     : t1@<slug>.demo … t5@…      / Teach@123
//   Parents      : p<admissionNo>@<slug>.demo / Parent@123   (e.g. p1001@sunrise-public.demo)
//   Slugs        : sunrise-public, green-valley, little-angels
const BASE = process.env.API_BASE || "https://smart-school-tawny.vercel.app";
const OP_EMAIL = process.env.OP_EMAIL || "operator@demo.school";
const OP_PASSWORD = process.env.OP_PASSWORD || "DemoOp123!";

const PW = { admin: "Admin@123", teacher: "Teach@123", parent: "Parent@123" };
const YEAR = { name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" };
const SUBJECTS = [
  { name: "Mathematics", code: "MATH" },
  { name: "English", code: "ENG" },
  { name: "Hindi", code: "HIN" },
  { name: "EVS", code: "EVS" },
  { name: "Computer", code: "COMP" },
];

const SCHOOLS = [
  {
    slug: "sunrise-public", name: "Sunrise Public School",
    teachers: ["Priya Nair", "Rohit Malhotra", "Sneha Kulkarni", "Arvind Rao", "Kavita Menon"],
  },
  {
    slug: "green-valley", name: "Green Valley School",
    teachers: ["Anjali Bose", "Vikram Sethi", "Meena Iyer", "Suresh Raina", "Divya Pillai"],
  },
  {
    slug: "little-angels", name: "Little Angels School",
    teachers: ["Farah Sheikh", "Nitin Kapoor", "Reema Das", "Alok Pandey", "Shreya Nambiar"],
  },
];

const GIRLS = ["Aaradhya", "Anaya", "Diya", "Ira", "Kiara", "Meera", "Myra", "Navya", "Pari", "Riya", "Sara", "Shanaya", "Tara", "Vanya", "Zara", "Aisha", "Anika", "Ishita", "Kavya", "Prisha"];
const BOYS = ["Aarav", "Advait", "Arjun", "Ayaan", "Dev", "Dhruv", "Ishaan", "Kabir", "Kian", "Krish", "Lakshay", "Neil", "Reyansh", "Rohan", "Rudra", "Samar", "Tejas", "Veer", "Vihaan", "Vivaan", "Yash", "Aditya", "Kartik", "Shaurya", "Aryan"];
const LAST = ["Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Mehta", "Shah", "Khan", "Iqbal", "Yadav", "Mishra", "Tiwari", "Chauhan", "Rathore", "Agarwal", "Bansal", "Kapoor", "Malhotra", "Saxena"];
const FATHERS = ["Rajesh", "Sandeep", "Amit", "Vikram", "Rohit", "Anil", "Sunil", "Manoj", "Deepak", "Rakesh", "Sanjay", "Ajay", "Vinod", "Prakash", "Naresh", "Kamal", "Ashok", "Ramesh", "Dinesh", "Harish"];

// Deterministic, unique-per-school student for sequence i (0-based):
// 45 distinct first names; when a first name repeats (i vs i+45) the
// surname differs, so all 50 full names in a school are unique.
const FIRST_ALL = [...BOYS.map((n) => ({ n, g: "M" })), ...GIRLS.map((n) => ({ n, g: "F" }))];
function studentInfo(i, schoolIdx) {
  const f = FIRST_ALL[i % FIRST_ALL.length];
  const last = LAST[(Math.floor(i / FIRST_ALL.length) * 7 + (i % 5) * 3 + schoolIdx * 3) % LAST.length];
  return { fullName: `${f.n} ${last}`, gender: f.g };
}
function guardianName(i, schoolIdx, studentFullName) {
  const last = studentFullName.split(" ").slice(-1)[0];
  return `${FATHERS[(i * 7 + schoolIdx * 5) % FATHERS.length]} ${last}`;
}

async function api(path, { method = "GET", token, schoolId, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (schoolId) headers["x-school-id"] = schoolId;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}
async function inChunks(items, size, fn) {
  for (let k = 0; k < items.length; k += size) await Promise.all(items.slice(k, k + size).map(fn));
}

const op = await api("/auth/login", { method: "POST", body: { email: OP_EMAIL, password: OP_PASSWORD } });
const existing = (await api("/platform/schools", { token: op.accessToken })).schools;
const existingSlugs = new Set(existing.map((s) => s.slug));

for (const [schoolIdx, cfg] of SCHOOLS.entries()) {
  if (existingSlugs.has(cfg.slug)) {
    console.log(`SKIP ${cfg.slug} — already exists`);
    continue;
  }
  console.log(`\nSeeding ${cfg.name} (${cfg.slug})…`);
  const { school } = await api("/schools", {
    method: "POST", token: op.accessToken,
    body: { name: cfg.name, slug: cfg.slug, adminEmail: `admin@${cfg.slug}.demo`, adminPassword: PW.admin, adminName: `${cfg.name} Admin` },
  });
  const sid = school.id;
  const admin = await api("/auth/login", { method: "POST", body: { email: `admin@${cfg.slug}.demo`, password: PW.admin } });
  const A = admin.accessToken;
  const asAdmin = (path, opts = {}) => api(path, { token: A, schoolId: sid, ...opts });

  const year = (await asAdmin(`/schools/${sid}/academic-years`, { method: "POST", body: YEAR })).academicYear;
  const subjects = [];
  for (const s of SUBJECTS) subjects.push((await asAdmin(`/schools/${sid}/subjects`, { method: "POST", body: s })).subject);
  // Same gate policies as the demo school, so the school is fully usable.
  await asAdmin(`/schools/${sid}/attendance-policies`, { method: "POST", body: { appliesTo: "STUDENT", entryStart: "07:30", entryEnd: "08:15", lateAfter: "08:15", exitStart: "13:30", exitEnd: "14:30", workingWeekdays: [1, 2, 3, 4, 5, 6] } });
  await asAdmin(`/schools/${sid}/attendance-policies`, { method: "POST", body: { appliesTo: "STAFF", entryStart: "07:00", entryEnd: "08:30", lateAfter: "08:30", exitStart: "14:00", exitEnd: "15:30", workingWeekdays: [1, 2, 3, 4, 5, 6] } });

  // 5 teachers: login + teacher profile.
  const teacherProfiles = [];
  for (const [ti, fullName] of cfg.teachers.entries()) {
    const u = await asAdmin(`/schools/${sid}/users`, {
      method: "POST",
      body: { email: `t${ti + 1}@${cfg.slug}.demo`, password: PW.teacher, fullName, role: "TEACHER", phone: String(9820000000 + schoolIdx * 10000 + ti) },
    });
    const memberships = (await asAdmin(`/schools/${sid}/users`)).memberships;
    const m = memberships.find((x) => x.userId === u.userId);
    const profile = (await asAdmin(`/schools/${sid}/teachers`, { method: "POST", body: { membershipId: m.id, displayName: fullName } })).teacher;
    teacherProfiles.push(profile);
  }
  console.log(`  teachers: ${teacherProfiles.length}`);

  // Classes 1–5 × A/B = 10 classrooms; class teacher rotates t1..t5.
  const classrooms = [];
  for (let grade = 1; grade <= 5; grade++) {
    for (const section of ["A", "B"]) {
      const idx = (grade - 1) * 2 + (section === "B" ? 1 : 0);
      const room = (await asAdmin(`/schools/${sid}/classrooms`, {
        method: "POST",
        body: { academicYearId: year.id, name: String(grade), section, gradeLevel: grade },
      })).classroom;
      const teacher = teacherProfiles[idx % teacherProfiles.length];
      await asAdmin(`/schools/${sid}/class-incharge`, {
        method: "POST",
        body: { teacherId: teacher.id, classroomId: room.id, academicYearId: year.id, effectiveFrom: YEAR.startsOn },
      });
      await asAdmin(`/schools/${sid}/teacher-assignments`, {
        method: "POST",
        body: { teacherId: teacher.id, classroomId: room.id, subjectId: subjects[idx % subjects.length].id, academicYearId: year.id },
      });
      classrooms.push(room);
    }
  }
  console.log(`  classrooms: ${classrooms.length} (1A…5B, class teachers rotating t1–t5)`);

  // 5 students per class-section = 50, admission nos 1001–1050; each
  // student gets a guardian WITH a parent login, linked as primary.
  let seq = 0;
  const jobs = [];
  for (const room of classrooms) {
    for (let roll = 1; roll <= 5; roll++) jobs.push({ room, roll, i: seq++ });
  }
  await inChunks(jobs, 5, async ({ room, roll, i }) => {
    const admissionNo = String(1001 + i);
    const { fullName, gender } = studentInfo(i, schoolIdx);
    const student = (await asAdmin(`/schools/${sid}/students`, {
      method: "POST",
      body: { admissionNo, fullName, classroomId: room.id, academicYearId: year.id, rollNo: String(roll), gender },
    })).student;
    const gName = guardianName(i, schoolIdx, fullName);
    const phone = String(9810000000 + schoolIdx * 100000 + i);
    const parentUser = await asAdmin(`/schools/${sid}/users`, {
      method: "POST",
      body: { email: `p${admissionNo}@${cfg.slug}.demo`, password: PW.parent, fullName: gName, role: "PARENT", phone },
    });
    const guardian = (await asAdmin(`/schools/${sid}/guardians`, {
      method: "POST",
      body: { fullName: gName, phone, userId: parentUser.userId, relationship: "Father" },
    })).guardian;
    await asAdmin(`/schools/${sid}/students/${student.id}/guardians`, {
      method: "POST",
      body: { guardianId: guardian.id, isPrimary: true, relation: "Father" },
    });
  });
  console.log(`  students + parents: ${jobs.length}`);
}

// ---- Verify against the live API ------------------------------------
console.log("\nVERIFY — GET /platform/schools:");
const all = (await api("/platform/schools", { token: op.accessToken })).schools;
for (const s of all) {
  console.log(`  ${s.slug}: students=${s.students} teachers=${s.teachers} classes=${s.classes} parents=${s.parents} (admin ${s.adminEmail})`);
}
for (const cfg of SCHOOLS) {
  const s = all.find((x) => x.slug === cfg.slug);
  if (!s) throw new Error(`verify: ${cfg.slug} missing`);
  if (existingSlugs.has(cfg.slug)) continue;
  const want = { students: 50, teachers: 5, classes: 10, parents: 50 };
  for (const [k, v] of Object.entries(want)) {
    if (s[k] !== v) throw new Error(`verify: ${cfg.slug} ${k}=${s[k]}, expected ${v}`);
  }
}

// Spot-check: a sunrise teacher login sees exactly their classes' students.
const sunrise = all.find((x) => x.slug === "sunrise-public");
const t1 = await api("/auth/login", { method: "POST", body: { email: "t1@sunrise-public.demo", password: PW.teacher } });
const tStudents = (await api(`/schools/${sunrise.id}/students`, { token: t1.accessToken, schoolId: sunrise.id })).students;
console.log(`\nSPOT-CHECK teacher t1@sunrise-public.demo: login OK, sees ${tStudents.length} students (expect 10 = own 2 classes × 5)`);
if (tStudents.length !== 10) throw new Error("teacher spot-check failed");

// Spot-check: a sunrise parent login sees their own child.
const p1 = await api("/auth/login", { method: "POST", body: { email: "p1001@sunrise-public.demo", password: PW.parent } });
const children = (await api(`/schools/${sunrise.id}/my-children`, { token: p1.accessToken, schoolId: sunrise.id })).children;
console.log(`SPOT-CHECK parent p1001@sunrise-public.demo: login OK, children: ${children.map((c) => `${c.fullName} (${c.classroom ? c.classroom.name + "-" + (c.classroom.section || "") : "?"})`).join(", ") || "NONE"}`);
if (children.length !== 1) throw new Error("parent spot-check failed");

console.log("\nDONE — test schools seeded. Logins: admin@<slug>.demo / Admin@123 · t1..t5@<slug>.demo / Teach@123 · p<admissionNo>@<slug>.demo / Parent@123");
