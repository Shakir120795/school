# Phase 1 Report — Database Foundation

**Date:** 25 Oct 2026
**Scope delivered:** finalized Prisma schema, initial migration, local
PostgreSQL setup (Docker + Windows 11 instructions/scripts). Nothing from
Phase 2 (no APIs, auth, UI, or worker code) was built.

## Validation environment

Validation was executed on the development VM (Linux, Node v24.22.1,
Prisma 6.19.3, PostgreSQL 16.15) — **not** on a Windows 11 machine.
The same commands are scripted for Windows 11 in `docs/WINDOWS11-SETUP.md`
and `scripts/setup-windows.ps1`; results there should be identical, but they
have not been run on Windows yet. This distinction is stated plainly so the
Phase 1 approval is based on real results only.

Note: on this VM, Prisma engine binaries had to be fetched with `curl` and
placed manually because the egress proxy reset the Node postinstall download
(ECONNRESET on binaries.prisma.sh). That is a VM network quirk, not a repo or
schema issue; a normal `npm install` on Windows is unaffected.

## Checks actually run — results

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Schema formatting | `npx prisma format` | ✅ Formatted successfully |
| 2 | Schema validation | `npx prisma validate` | ✅ "The schema is valid" (after fixing 4 initial errors: 3 missing back-relations, 1 composite one-to-one unique — all fixed in schema) |
| 3 | Client generation | `npx prisma generate` | ✅ Prisma Client v6.19.3 generated |
| 4 | Initial migration | `npx prisma migrate dev --name init` | ✅ Created + applied; 29 tables |
| 5 | Custom constraints re-apply | `npx prisma migrate reset --force` after appending custom SQL to the migration | ✅ Edited migration re-applies cleanly from an empty database; `migrate status` = up to date |
| 6 | Tenant isolation proof | `psql -f prisma/tenant-isolation-test.sql` | ✅ 5/5 PASS (below) |

### Tenant-isolation test detail (actual output)

1. ✅ PASS — cross-school `StudentGuardian` link rejected (FK violation)
2. ✅ PASS — same-school guardian link inserted
3. ✅ PASS — duplicate daily attendance (school+student+date) rejected (unique violation)
4. ✅ PASS — duplicate scan idempotency key in the same school rejected (unique violation)
5. ✅ PASS — card credential with two owners rejected (CHECK/FK)

## Schema highlights

- **Tenant safety:** `schoolId` on every tenant row; composite FKs
  `(schoolId, parentId)` on student↔guardian, teacher assignments,
  class-incharge, notices/targets/recipients, attendance and card ownership,
  so cross-school rows cannot be linked even by a buggy API.
- **Roles:** global `User` + `SchoolMembership` (role per school:
  SCHOOL_ADMIN, PRINCIPAL, TEACHER, PARENT, STAFF). Platform admin is a flag
  on User with no implicit school-data access.
- **Cards:** `CardCredential.tokenHash` only — the QR holds an opaque random
  token (Phase 2 generates it); revocation/replacement via status + timestamps.
  NFC fields are deliberately absent; NFC is a later optional pilot.
- **Attendance:** machine scan events are separate immutable tables for
  students and staff; daily records are unique per (school, person, local
  date); corrections go through `AttendanceCorrectionRequest` +
  `AttendanceAudit` (no self-approval, DB-checked).
- **Notices:** `Notice` + `NoticeTarget` (audience definition) +
  `NoticeRecipient` (resolved snapshot, unique per notice+recipient).
- **Notifications (no n8n):** `NotificationOutbox` (durable, idempotency-key
  unique, claim/retry fields for the Phase 2 Node worker) +
  `NotificationDelivery` (per-channel attempts, provider message id, distinct
  QUEUED/ACCEPTED/SENT/DELIVERED/READ/FAILED/ACK states).
- **Config:** `AttendancePolicy` (windows per student/staff, school-local
  times) + `Holiday`; school timezone on `School` (default `Asia/Kolkata`).

## Environment variables (Phase 1)

Only `DATABASE_URL` (Prisma) and the `POSTGRES_*` values used by
docker-compose. See `.env.example` — local dev defaults only, no real secrets
in the repo. `.env` is git-ignored.

## Known limits / decisions for the owner

1. Windows 11 execution is **pending** — run `scripts\setup-windows.ps1`
   there (or approve proceeding on VM validation alone).
2. `AttendancePolicy` assumes one active policy per (school, student/staff).
   Multiple shifts per school would need a Phase 2 schema amendment.
3. Teacher = staff for attendance in this schema (`TeacherProfile` covers
   teaching staff). A separate non-teaching staff profile can be added in
   Phase 2 if a school needs office-staff attendance without a teacher profile.
4. No seed data yet — seeding belongs with Phase 2's first APIs.

**Phase 2 must not start until the owner approves this Phase 1.**
