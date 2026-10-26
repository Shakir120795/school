// Phase 19: CSV import (partial success + row errors) and CSV exports.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-secret";
process.env.NOTIFICATION_PROVIDER = "log";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S;
const CSV = [
  "fullName,admissionNo,className,section,rollNo,gender,dob,guardianName,guardianPhone,guardianRelation",
  "Riya Sharma,ADM101,5,A,12,F,2015-04-11,Neha Sharma,9811100011,mother",
  '"Mehta, Arjun",ADM102,5,A,3,M,2015-09-02,Raj Mehta,9811100022,father',
  "Dup Row,ADM101,5,A,4,M,,X Y,9811100033,father",
  ",ADM103,5,A,5,M,,No Name,9811100044,mother",
].join("\n");

before(async () => {
  H.assertTestDb();
  server = await H.startServer({});
  base = server.base;
  S = await H.bootstrapSchool(base, "phase19");
});

after(async () => { H.stopServer(server.child); await prisma.$disconnect(); });

async function rawGet(path, token) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}`, "x-school-id": S.schoolId } });
  return { status: res.status, type: res.headers.get("content-type") || "", text: await res.text() };
}

test("import: 2 created, quoted comma name parsed, duplicate + missing-name rows reported", async () => {
  const r = await H.api(base, "POST", `/schools/${S.schoolId}/import/students`, {
    token: S.adminToken, schoolId: S.schoolId, body: { csv: CSV },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.totalRows, 4);
  assert.equal(r.json.import.created, 2);
  assert.equal(r.json.import.guardiansLinked, 2);
  assert.deepEqual(r.json.import.createdClasses, ["5-A"]);
  const errs = r.json.import.errors.map((e) => e.error).sort();
  assert.deepEqual(errs, ["DUPLICATE_IN_FILE", "MISSING_NAME_OR_ADMISSION_NO"]);
  // re-import: existing admission numbers are reported, not duplicated
  const again = await H.api(base, "POST", `/schools/${S.schoolId}/import/students`, {
    token: S.adminToken, schoolId: S.schoolId, body: { csv: CSV },
  });
  assert.equal(again.json.import.created, 0);
  assert.ok(again.json.import.errors.filter((e) => e.error === "ALREADY_EXISTS").length >= 2);
  // guardian link actually exists for the imported student
  const link = await prisma.studentGuardian.findFirst({
    where: { schoolId: S.schoolId },
    include: { student: true, guardian: true },
  });
  assert.ok(link && link.guardian.phone === "9811100011");
});

test("exports return CSV with headers and imported rows; attendance + fees exports work", async () => {
  const students = await rawGet(`/schools/${S.schoolId}/exports/students.csv`, S.adminToken);
  assert.equal(students.status, 200);
  assert.ok(students.type.includes("text/csv"));
  assert.ok(students.text.startsWith("admissionNo,fullName"));
  assert.ok(students.text.includes('"Mehta, Arjun"'), "quoted name round-trips");
  assert.ok(students.text.includes("9811100011"));
  const att = await rawGet(`/schools/${S.schoolId}/exports/attendance.csv?from=2026-10-01&to=2026-10-31`, S.adminToken);
  assert.equal(att.status, 200);
  assert.ok(att.text.startsWith("date,admissionNo"));
  const fees = await rawGet(`/schools/${S.schoolId}/exports/fees.csv`, S.adminToken);
  assert.equal(fees.status, 200);
  assert.ok(fees.text.startsWith("invoiceNo,admissionNo"));
});
