// Phase 9: parent mobile-OTP login against the guardian-phone whitelist.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET = "test-secret";
const H = await import("./harness.js");
const { prisma } = await import("../src/db.js");

let server, base, S, clsA, kidA, kidB, otherSchoolKid;
const PHONE = "9810012345";

before(async () => {
  H.assertTestDb();
  server = await H.startServer({ OTP_PROVIDER: "test", OTP_TEST_FILE: "/tmp/otp-test-codes.json" });
  base = server.base;
  S = await H.bootstrapSchool(base, "phase9");
  clsA = await H.makeClass(base, S.schoolId, S.adminToken);
  async function guardianWithKids(phone, kidCount) {
    const g = await H.api(base, "POST", `/schools/${S.schoolId}/guardians`, {
      token: S.adminToken, schoolId: S.schoolId, body: { fullName: `Guardian ${phone}`, phone },
    });
    const guardianId = g.json.guardian.id;
    const ids = [];
    for (let i = 0; i < kidCount; i++) {
      const adm = `P9-${phone}-${i}`;
      const stu = await H.api(base, "POST", `/schools/${S.schoolId}/students`, {
        token: S.adminToken, schoolId: S.schoolId,
        body: { admissionNo: adm, fullName: `Kid ${adm}`, classroomId: clsA.classId, academicYearId: clsA.yearId },
      });
      await H.api(base, "POST", `/schools/${S.schoolId}/students/${stu.json.student.id}/guardians`, {
        token: S.adminToken, schoolId: S.schoolId, body: { guardianId, isPrimary: true },
      });
      ids.push(stu.json.student.id);
    }
    return ids;
  }
  const mine = await guardianWithKids(PHONE, 2);
  kidA = { studentId: mine[0] };
  kidB = { studentId: mine[1] };
  const other = await guardianWithKids("9000000001", 1);
  otherSchoolKid = { studentId: other[0] };
});

after(async () => {
  H.stopServer(server.child);
  await prisma.$disconnect();
});

async function requestAndGetCode(phone) {
  const r = await H.api(base, "POST", "/auth/parent-otp/request", { body: { phone } });
  assert.equal(r.status, 202);
  const saved = JSON.parse(readFileSync("/tmp/otp-test-codes.json", "utf8"));
  assert.equal(saved.phone, phone.replace(/\D/g, "").slice(-10));
  return saved.code;
}

test("OTP login: whitelisted parent logs in and sees ONLY their own children", async () => {
  const code = await requestAndGetCode(PHONE);
  const bad = await H.api(base, "POST", "/auth/parent-otp/verify", { body: { phone: PHONE, code: "000000" } });
  assert.equal(bad.status, 401);
  const ok = await H.api(base, "POST", "/auth/parent-otp/verify", { body: { phone: PHONE, code } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(ok.json.accessToken);
  assert.ok(ok.json.memberships.some((m) => m.schoolId === S.schoolId && m.role === "PARENT"));

  const mine = await H.api(base, "GET", `/schools/${S.schoolId}/my-children`, { token: ok.json.accessToken, schoolId: S.schoolId });
  assert.equal(mine.status, 200);
  const ids = mine.json.children.map((c) => c.id).sort();
  assert.deepEqual(ids, [kidA.studentId, kidB.studentId].sort(), "siblings visible, other child NOT");
});

test("OTP login: non-whitelisted number gets generic 202 but cannot verify", async () => {
  const r = await H.api(base, "POST", "/auth/parent-otp/request", { body: { phone: "9555555555" } });
  assert.equal(r.status, 202); // no enumeration
  const v = await H.api(base, "POST", "/auth/parent-otp/verify", { body: { phone: "9555555555", code: "123456" } });
  assert.equal(v.status, 401);
});

test("OTP login: code is single-use", async () => {
  const code = await requestAndGetCode("9000000001");
  const first = await H.api(base, "POST", "/auth/parent-otp/verify", { body: { phone: "9000000001", code } });
  assert.equal(first.status, 200);
  const again = await H.api(base, "POST", "/auth/parent-otp/verify", { body: { phone: "9000000001", code } });
  assert.equal(again.status, 401);
});
