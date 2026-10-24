-- Phase 1 tenant-isolation proof (run against a DISPOSABLE migrated database):
--   psql "$DATABASE_URL" -f prisma/tenant-isolation-test.sql
-- Expected: every check prints PASS. Test rows are inserted with fixed ids
-- prefixed 'test1_' / 'test2_' — do not run on production data.

\echo '--- setup: two schools, one student in A, one guardian in B ---'
INSERT INTO "School" (id, slug, name, "createdAt", "updatedAt") VALUES
  ('test_school_a', 'test-a', 'Test School A', now(), now()),
  ('test_school_b', 'test-b', 'Test School B', now(), now());
INSERT INTO "AcademicYear" (id, "schoolId", name, "startsOn", "endsOn", "createdAt", "updatedAt") VALUES
  ('test_year_a', 'test_school_a', '2026-27', '2026-04-01', '2027-03-31', now(), now()),
  ('test_year_b', 'test_school_b', '2026-27', '2026-04-01', '2027-03-31', now(), now());
INSERT INTO "Student" (id, "schoolId", "academicYearId", "admissionNo", "fullName", "createdAt", "updatedAt")
  VALUES ('test_student_a', 'test_school_a', 'test_year_a', 'A001', 'Student A', now(), now());
INSERT INTO "Guardian" (id, "schoolId", "fullName", "createdAt", "updatedAt")
  VALUES ('test_guardian_b', 'test_school_b', 'Guardian B', now(), now());
INSERT INTO "Guardian" (id, "schoolId", "fullName", "createdAt", "updatedAt")
  VALUES ('test_guardian_a', 'test_school_a', 'Guardian A', now(), now());

\echo '--- check 1: cross-school guardian link must FAIL ---'
DO $$
BEGIN
  BEGIN
    INSERT INTO "StudentGuardian" (id, "schoolId", "studentId", "guardianId", "createdAt")
      VALUES ('test_link_x', 'test_school_a', 'test_student_a', 'test_guardian_b', now());
    RAISE NOTICE 'FAIL: cross-school StudentGuardian link was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-school StudentGuardian link rejected (FK violation)';
  END;
END $$;

\echo '--- check 2: same-school guardian link must SUCCEED ---'
INSERT INTO "StudentGuardian" (id, "schoolId", "studentId", "guardianId", "createdAt")
  VALUES ('test_link_ok', 'test_school_a', 'test_student_a', 'test_guardian_a', now());
\echo 'PASS: same-school link inserted'

\echo '--- check 3: duplicate daily attendance (same school+student+date) must FAIL ---'
INSERT INTO "StudentAttendance" (id, "schoolId", "studentId", "localDate", status, "createdAt", "updatedAt")
  VALUES ('test_att_1', 'test_school_a', 'test_student_a', '2026-10-25', 'PRESENT', now(), now());
DO $$
BEGIN
  BEGIN
    INSERT INTO "StudentAttendance" (id, "schoolId", "studentId", "localDate", status, "createdAt", "updatedAt")
      VALUES ('test_att_2', 'test_school_a', 'test_student_a', '2026-10-25', 'LATE', now(), now());
    RAISE NOTICE 'FAIL: duplicate daily attendance was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate daily attendance rejected (unique violation)';
  END;
END $$;

\echo '--- check 4: duplicate scan idempotency key in same school must FAIL ---'
INSERT INTO "StudentScanEvent" (id, "schoolId", "studentId", "eventType", "scannedAt", "idempotencyKey", "createdAt")
  VALUES ('test_scan_1', 'test_school_a', 'test_student_a', 'ENTRY', now(), 'scan-key-1', now());
DO $$
BEGIN
  BEGIN
    INSERT INTO "StudentScanEvent" (id, "schoolId", "studentId", "eventType", "scannedAt", "idempotencyKey", "createdAt")
      VALUES ('test_scan_2', 'test_school_a', 'test_student_a', 'ENTRY', now(), 'scan-key-1', now());
    RAISE NOTICE 'FAIL: duplicate scan idempotency key was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate scan rejected (unique violation)';
  END;
END $$;

\echo '--- check 5: card credential with both owners set must FAIL ---'
DO $$
BEGIN
  BEGIN
    INSERT INTO "CardCredential" (id, "schoolId", "ownerType", "studentId", "teacherProfileId", "tokenHash", "createdAt", "updatedAt")
      VALUES ('test_card_x', 'test_school_a', 'STUDENT', 'test_student_a', 'some-teacher', 'hash-x', now(), now());
    RAISE NOTICE 'FAIL: card with two owners was accepted';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN
    RAISE NOTICE 'PASS: card with two owners rejected';
  END;
END $$;

\echo '--- cleanup test rows ---'
DELETE FROM "StudentScanEvent" WHERE id LIKE 'test_%';
DELETE FROM "StudentAttendance" WHERE id LIKE 'test_%';
DELETE FROM "StudentGuardian" WHERE id LIKE 'test_%';
DELETE FROM "Student" WHERE id LIKE 'test_%';
DELETE FROM "Guardian" WHERE id LIKE 'test_%';
DELETE FROM "AcademicYear" WHERE id LIKE 'test_%';
DELETE FROM "School" WHERE id LIKE 'test_%';
\echo '--- done ---'
