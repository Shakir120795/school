// Bulk import + report exports (Phase 19, PDF §16/§21).
// Students import from CSV with per-row results (good rows import,
// bad rows are reported, never silently dropped). Missing classes
// are created under the school's current academic year and reported.
// Exports are plain CSV downloads.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireSchool } from "../middleware/auth.js";
import { asyncRoute } from "../utils/http.js";
import { parseCsv, toCsv } from "../utils/csv.js";
import { hashPassword } from "../utils/security.js";

const router = Router();
const MANAGERS = ["SCHOOL_ADMIN", "PRINCIPAL"];
const MAX_ROWS = 1000;

function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(csv);
}

function pick(row, names) {
  const lower = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase().replace(/[\s_]/g, "")] = row[k];
  for (const n of names) {
    const v = lower[n.toLowerCase().replace(/[\s_]/g, "")];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

router.post("/schools/:schoolId/import/students", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const csvText = req.body?.csv;
  if (!csvText || typeof csvText !== "string") return res.status(400).json({ error: "CSV_REQUIRED" });
  const rows = parseCsv(csvText);
  if (!rows.length) return res.status(400).json({ error: "CSV_EMPTY_OR_HEADER_ONLY" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ error: "TOO_MANY_ROWS", max: MAX_ROWS });

  let year = await prisma.academicYear.findFirst({ where: { schoolId, isCurrent: true } })
    || await prisma.academicYear.findFirst({ where: { schoolId }, orderBy: { createdAt: "desc" } });
  if (!year) {
    // A brand-new school importing its first students gets a current
    // session automatically (Apr–Mar, the usual Indian school year).
    const now = new Date();
    const startYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    year = await prisma.academicYear.create({
      data: {
        schoolId, name: `${startYear}-${String(startYear + 1).slice(2)}`, isCurrent: true,
        startsOn: new Date(`${startYear}-04-01T00:00:00.000Z`),
        endsOn: new Date(`${startYear + 1}-03-31T00:00:00.000Z`),
      },
    });
  }

  const classCache = new Map();
  const createdClasses = [];
  async function resolveClass(className, section) {
    if (!className) return null;
    const key = `${className}|${section || ""}`;
    if (classCache.has(key)) return classCache.get(key);
    let cls = await prisma.classroom.findFirst({ where: { schoolId, name: className, section: section || null } });
    if (!cls) {
      cls = await prisma.classroom.create({ data: { schoolId, academicYearId: year.id, name: className, section: section || null } });
      createdClasses.push(`${className}${section ? "-" + section : ""}`);
    }
    classCache.set(key, cls);
    return cls;
  }

  const result = { created: 0, guardiansLinked: 0, createdClasses, errors: [] };
  const seenInFile = new Set();
  let rowNo = 1; // header is row 1
  for (const raw of rows) {
    rowNo++;
    const fullName = pick(raw, ["fullName", "name", "studentName"]);
    const admissionNo = pick(raw, ["admissionNo", "admission", "admNo"]);
    if (!fullName || !admissionNo) {
      result.errors.push({ row: rowNo, admissionNo: admissionNo || null, error: "MISSING_NAME_OR_ADMISSION_NO" });
      continue;
    }
    if (seenInFile.has(admissionNo)) {
      result.errors.push({ row: rowNo, admissionNo, error: "DUPLICATE_IN_FILE" });
      continue;
    }
    seenInFile.add(admissionNo);
    const existing = await prisma.student.findFirst({ where: { schoolId, admissionNo }, select: { id: true } });
    if (existing) {
      result.errors.push({ row: rowNo, admissionNo, error: "ALREADY_EXISTS" });
      continue;
    }
    try {
      const cls = await resolveClass(pick(raw, ["className", "class"]), pick(raw, ["section"]));
      const dobRaw = pick(raw, ["dob", "dateOfBirth"]);
      const student = await prisma.student.create({
        data: {
          schoolId, admissionNo, fullName,
          classroomId: cls?.id || null,
          academicYearId: year.id,
          rollNo: pick(raw, ["rollNo", "roll"]),
          gender: pick(raw, ["gender"]),
          fatherName: pick(raw, ["fatherName", "father"]),
          motherName: pick(raw, ["motherName", "mother"]),
          address: pick(raw, ["address"]),
          dateOfBirth: dobRaw && /^\d{4}-\d{2}-\d{2}/.test(dobRaw) ? new Date(`${dobRaw.slice(0, 10)}T00:00:00.000Z`) : null,
        },
      });
      result.created++;
      const phone = (pick(raw, ["guardianPhone", "parentPhone", "phone", "mobile"]) || "").replace(/\D/g, "").slice(-10);
      if (phone.length === 10) {
        let guardian = await prisma.guardian.findFirst({ where: { schoolId, phone } });
        if (!guardian) {
          guardian = await prisma.guardian.create({
            data: {
              schoolId, phone,
              fullName: pick(raw, ["guardianName", "parentName"]) || "Guardian",
              relationship: pick(raw, ["guardianRelation", "relation", "relationship"]),
            },
          });
        }
        const already = await prisma.studentGuardian.findFirst({ where: { schoolId, studentId: student.id, guardianId: guardian.id } });
        if (!already) {
          const anyPrimary = await prisma.studentGuardian.findFirst({ where: { schoolId, studentId: student.id, isPrimary: true } });
          await prisma.studentGuardian.create({
            data: { schoolId, studentId: student.id, guardianId: guardian.id, isPrimary: !anyPrimary },
          });
          result.guardiansLinked++;
        }
      }
    } catch (e) {
      result.errors.push({ row: rowNo, admissionNo, error: "CREATE_FAILED" });
      console.error("[import-students] row failed:", e?.message || e);
    }
  }
  return res.status(201).json({ import: result, totalRows: rows.length });
}));

// Teachers import (Phase 29 WS7) — same conventions as the student
// import above: CSV text in { csv }, per-row results, bad rows are
// reported and never fatal. Each good row mirrors the Team page's
// add-member flow exactly: reuse-or-create the User by email
// (password hashed), then a TEACHER SchoolMembership in this school.
// A row whose email already has a membership in THIS school (or is
// repeated inside the file) is a per-row error. Password is optional
// per row; when blank the new login gets the default below, which the
// Team page states in its import hint text.
const TEACHER_DEFAULT_PASSWORD = "Welcome@123";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/schools/:schoolId/teachers/import", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const csvText = req.body?.csv;
  if (!csvText || typeof csvText !== "string") return res.status(400).json({ error: "CSV_REQUIRED" });
  const rows = parseCsv(csvText);
  if (!rows.length) return res.status(400).json({ error: "CSV_EMPTY_OR_HEADER_ONLY" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ error: "TOO_MANY_ROWS", max: MAX_ROWS });

  const results = [];
  const seenInFile = new Set();
  let created = 0;
  let rowNo = 1; // header is row 1
  for (const raw of rows) {
    rowNo++;
    const name = pick(raw, ["name", "fullName", "teacherName"]);
    const emailRaw = pick(raw, ["email", "loginId"]);
    const email = emailRaw ? emailRaw.trim() : "";
    const fail = (error) => results.push({ row: rowNo, name: name || null, email: email || null, ok: false, error });
    if (!name) { fail("MISSING_NAME"); continue; }
    if (!email) { fail("MISSING_EMAIL"); continue; }
    if (!EMAIL_RE.test(email)) { fail("INVALID_EMAIL"); continue; }
    const key = email.toLowerCase();
    if (seenInFile.has(key)) { fail("DUPLICATE_IN_FILE"); continue; }
    seenInFile.add(key);
    try {
      let user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
      if (user) {
        const existing = await prisma.schoolMembership.findFirst({
          where: { schoolId, userId: user.id },
          select: { id: true },
        });
        if (existing) { fail("ALREADY_A_MEMBER"); continue; }
      } else {
        user = await prisma.user.create({
          data: {
            email,
            phone: pick(raw, ["phone", "mobile"]) || undefined,
            fullName: name,
            passwordHash: await hashPassword(pick(raw, ["password"]) || TEACHER_DEFAULT_PASSWORD),
          },
        });
      }
      await prisma.schoolMembership.create({ data: { schoolId, userId: user.id, role: "TEACHER" } });
      created++;
      results.push({ row: rowNo, name, email, ok: true });
    } catch (e) {
      fail("CREATE_FAILED");
      console.error("[import-teachers] row failed:", e?.message || e);
    }
  }
  return res.status(201).json({ created, failed: results.length - created, results, totalRows: rows.length });
}));

router.get("/schools/:schoolId/exports/students.csv", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const students = await prisma.student.findMany({
    where: { schoolId, status: "ACTIVE" },
    include: { classroom: true, guardianLinks: { include: { guardian: true } } },
    orderBy: [{ classroom: { name: "asc" } }, { rollNo: "asc" }, { fullName: "asc" }],
  });
  const csv = toCsv(
    ["admissionNo", "fullName", "className", "section", "rollNo", "gender", "dob", "guardianName", "guardianPhone"],
    students.map((s) => {
      const primary = s.guardianLinks.find((l) => l.isPrimary) || s.guardianLinks[0];
      return [
        s.admissionNo, s.fullName, s.classroom?.name || "", s.classroom?.section || "", s.rollNo || "",
        s.gender || "", s.dateOfBirth ? s.dateOfBirth.toISOString().slice(0, 10) : "",
        primary?.guardian.fullName || "", primary?.guardian.phone || "",
      ];
    })
  );
  return sendCsv(res, "students.csv", csv);
}));

router.get("/schools/:schoolId/exports/attendance.csv", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : today;
  const rows = await prisma.studentAttendance.findMany({
    where: { schoolId, localDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
    include: { student: { include: { classroom: true } } },
    orderBy: [{ localDate: "asc" }, { student: { fullName: "asc" } }],
    take: 20000,
  });
  const csv = toCsv(
    ["date", "admissionNo", "student", "class", "status", "entryAt", "exitAt"],
    rows.map((r) => [
      r.localDate.toISOString().slice(0, 10), r.student.admissionNo, r.student.fullName,
      `${r.student.classroom?.name || ""}${r.student.classroom?.section ? "-" + r.student.classroom.section : ""}`,
      r.status, r.entryAt ? r.entryAt.toISOString() : "", r.exitAt ? r.exitAt.toISOString() : "",
    ])
  );
  return sendCsv(res, `attendance-${from}-to-${to}.csv`, csv);
}));

router.get("/schools/:schoolId/exports/fees.csv", requireAuth, requireSchool(MANAGERS), asyncRoute(async (req, res) => {
  const schoolId = req.params.schoolId;
  const invoices = await prisma.feeInvoice.findMany({
    where: { schoolId },
    include: { student: { include: { classroom: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 20000,
  });
  const csv = toCsv(
    ["invoiceNo", "admissionNo", "student", "class", "period", "totalRupees", "paidRupees", "balanceRupees", "status", "dueDate"],
    invoices.map((i) => [
      i.invoiceNo, i.student.admissionNo, i.student.fullName,
      `${i.student.classroom?.name || ""}${i.student.classroom?.section ? "-" + i.student.classroom.section : ""}`,
      i.periodLabel, i.totalPaise / 100, i.paidPaise / 100, (i.totalPaise - i.paidPaise) / 100,
      i.status, i.dueDate ? i.dueDate.toISOString().slice(0, 10) : "",
    ])
  );
  return sendCsv(res, "fees.csv", csv);
}));

export default router;
