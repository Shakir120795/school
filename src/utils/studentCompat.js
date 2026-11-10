// Live-DB compatibility shim (Phase 31 fix, 2 Nov 2026).
// The Phase 27 family columns (Student.fatherName / motherName /
// address) exist in the Prisma schema but their live Supabase SQL
// (docs/PENDING-LIVE-SQL.sql) is still pending, so ANY query that
// selects those columns 500s on the live DB — that one gap was
// breaking the students list, parent my-children, and the console
// Members view. Until the SQL runs, reads simply omit the family
// fields (the UI already renders them as "—" when null). The probe
// result is cached per server process; new processes re-probe, so
// the fields light up on their own once the SQL has run.
import { prisma } from "../db.js";

let cached = null;
export function familyFieldsReady() {
  if (!cached) {
    cached = prisma
      .$queryRaw`SELECT "fatherName", "motherName", "address" FROM "Student" LIMIT 1`
      .then(() => true)
      .catch(() => false);
  }
  return cached;
}

// Select fragment for the family fields — spread into a Student
// select only when the live columns exist.
export async function familySelect() {
  return (await familyFieldsReady())
    ? { fatherName: true, motherName: true, address: true }
    : {};
}

// Phase 48: bloodGroup bhi naya column hai — family fields wala
// hi probe pattern, taaki column live hone se pehle ke reads na
// giren.
let bgCached = null;
export function bloodGroupReady() {
  if (!bgCached) {
    bgCached = prisma
      .$queryRaw`SELECT "bloodGroup" FROM "Student" LIMIT 1`
      .then(() => true)
      .catch(() => false);
  }
  return bgCached;
}
export async function bloodGroupSelect() {
  return (await bloodGroupReady()) ? { bloodGroup: true } : {};
}

// Every Student scalar EXCEPT the family fields (+ family fields
// when ready) — for list reads that previously used a bare include
// and therefore selected the whole model.
export async function studentScalars() {
  const base = {
    id: true, schoolId: true, academicYearId: true, classroomId: true,
    admissionNo: true, rollNo: true, photoUrl: true, fullName: true,
    dateOfBirth: true, gender: true, status: true,
    createdAt: true, updatedAt: true,
  };
  Object.assign(base, await familySelect(), await bloodGroupSelect());
  return base;
}
