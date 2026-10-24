# Phase 2 Report — Backend Foundation & Core APIs

**Date:** 25 Oct 2026
**Scope delivered:** authentication/authorization, school/people management,
student + staff attendance engine, notice targeting with permission checks,
durable outbox + notification worker, automated tests. Nothing from Phase 3
(no Vue UI) or Phase 4 (no real WhatsApp/push providers, no mobile) was built.

## What was built

### Auth (`src/routes/auth.js`, `src/middleware/auth.js`)
- Email + password login (scrypt hashing, Node crypto — no native deps).
- Short-lived JWT access tokens (default 15 min) + rotating refresh tokens;
  only the refresh token **hash** is stored (`AuthSession`, new Phase 2
  migration). Reuse of a rotated refresh token is rejected. Logout revokes.
- Tenant rule enforced in middleware: `X-School-Id` is trusted only after a
  matching ACTIVE `SchoolMembership` is found; role lists per route.
- Platform admin can create schools + their first admin, but has **no**
  default access to school data routes (blueprint §3).

### Management (`src/routes/schools.js`)
- Schools, academic years, classrooms, subjects; users + memberships.
- Students, guardians, guardian↔student links (cross-school links fail at
  the DB composite FK and surface as 409).
- Teacher profiles + class/subject assignments + class-incharge;
  teachers list only their assigned classes' students; parents list only
  their own children and only **visible** teacher profiles (approved fields).
- Parent self-service: `my-children` (with recent attendance) and
  per-channel communication consent (`my-consents`).
- Gate devices: device key shown once, hash stored. QR cards: issue /
  revoke / replace; QR token shown once, hash stored.

### Attendance (`src/services/attendance.js`, `src/routes/attendance.js`)
- Device-authenticated scan endpoint (`X-School-Id` + `X-Device-Key`).
- Per-card advisory lock serializes concurrent scans; idempotency keys and a
  duplicate window (default 120s) collapse retries/double-taps to one event.
- School-timezone policy evaluation: entry window, late boundary, exit
  window/early exit, working weekdays; out-of-window and missing-entry are
  review **flags**, not accusations. Students and staff use separate tables
  and separate policies. EXIT without ENTRY creates a flagged daily record.
- Attendance row + outbox event are written in **one transaction**.
- Corrections: request → principal/admin decision; self-approval is blocked
  in the API **and** by the Phase 1 DB CHECK; approvals apply the change and
  write an `AttendanceAudit` row with before/after.

### Notices + worker (`src/routes/notices.js`, `src/services/notices.js`, `src/services/outbox.js`, `src/worker.js`)
- Permission matrix: teachers only ASSIGNED_CLASS / SELECTED_STUDENTS within
  their assignments; broadcasts (ALL_PARENTS / ALL_TEACHERS / both /
  SELECTED_GUARDIANS / INDIVIDUAL_STAFF) are principal/admin only.
- Audience **preview** (recipient counts) before saving; send snapshots
  recipients, is one-time (second send → 409), and writes the outbox event
  in the same transaction. Parent acknowledgement endpoint included.
- Worker claims outbox rows with `FOR UPDATE SKIP LOCKED`, delivers through
  a provider-adapter interface, records per-recipient deliveries with
  provider message ids and distinct statuses, honors guardian opt-outs,
  backs off exponentially, and dead-letters after max attempts.
- **Provider honesty:** the Phase 2 adapter is `log` — it records provider
  acceptance locally and sends nothing externally. Real WhatsApp Cloud /
  push adapters are Phase 4. A `fail` adapter exists to prove outage
  behavior in tests.

### Schema changes in Phase 2
- `AuthSession` (refresh token hashes) — migration `phase2_auth_session`.
- `Notice.audienceMeta` (staff membership ids for INDIVIDUAL_STAFF) —
  migration `phase2_notice_audience_meta`.

## Tests — actual results

Command (dedicated test DB, migrations applied, server spawned as a real
HTTP process; test files run sequentially):

```
DATABASE_URL=postgresql://…/school_saas_test npm test
→ tests 10 · pass 10 · fail 0
```

1. ✅ Auth: bad login 401; login ok; refresh rotates; reused refresh 401
2. ✅ Cross-tenant: school A admin reading school B → 403; A's device key scanning into B → 401
3. ✅ Cross-school guardian link via API → 409 (DB composite FK)
4. ✅ Teacher directory: parent sees visible teacher only; unassigned teacher sees 0 students
5. ✅ Time boundaries: late (lateAfter in past) → LATE; on-time → PRESENT; out-of-window → OUT_OF_WINDOW flag; staff card writes StaffAttendance only
6. ✅ Concurrency: 10 parallel scans, same idempotency key → exactly 1 RECORDED + 9 DUPLICATE + 1 event row; heuristic duplicate also collapses; EXIT records; exit time set
7. ✅ Revoked card scan → 422 INVALID
8. ✅ Corrections: teacher request → admin approval applies change + audit row; self-approval → 403
9. ✅ Notices: teacher preview count correct; teacher broadcast → 403; teacher unassigned class → 403; principal broadcast recipient count = active guardians; re-send → 409; worker delivers (PROVIDER_ACCEPTED), opted-out guardian → FAILED/OPTED_OUT, notice ends SENT
10. ✅ Provider outage (`fail` adapter): notice row and deliveries survive, outbox retries with backoff and dead-letters, error recorded

Also verified: `prisma format --check` ✅, `prisma validate` ✅,
`prisma migrate status` ✅ (main dev DB), worker process boots and shuts
down cleanly on SIGTERM.

Environment: same VM as Phase 1 (Linux, Node 24, PostgreSQL 16, Prisma
6.19.3) — not Windows; the API has no Windows-specific code paths.

## Known limits / Phase 3-4 notes

1. No rate limiting / account lockout yet — add before any public exposure.
2. Scan endpoint trusts the device timestamp (server time used when the
   device sends none); device clock sync is a deployment concern.
3. Attendance outbox events are retained and marked processed; guardian
   scan-alerts ride the real providers in Phase 4.
4. `register-platform-admin` is a bootstrap endpoint: open only until the
   first platform admin exists, then platform-admin-token only.
5. Scheduled notices are stored as SCHEDULED; the scheduler that flips them
   to send at `scheduledAt` lands with the Phase 3/4 worker hardening.

**Phase 3 must not start until the owner approves this Phase 2.**
