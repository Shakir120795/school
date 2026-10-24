# Smart School Tracking, Attendance & Communication SaaS

Multi-tenant school operations platform per the approved blueprint
(`Smart_School_Tracking_Communication_SaaS_Blueprint.md` v1.0, 25 Oct 2026).

**Status: Phase 1 only — database foundation. No application/API/UI code yet.
Phase 2 starts only after owner approval of Phase 1.**

## What Phase 1 contains

- `prisma/schema.prisma` — tenant-safe schema: schools, users + per-school
  memberships/roles, guardians, students, classes, subjects, teacher
  assignments + class-incharge, QR card credentials (token **hash** only),
  scanner devices, student & staff scan events and daily attendance (separate
  tables), attendance audit + correction requests, notices + targets +
  recipients, PostgreSQL notification outbox + deliveries (custom worker,
  **no n8n**), communication consent, configurable attendance policies,
  holidays, and a general audit log.
- `prisma/migrations/` — initial migration, including hand-added constraints
  Prisma cannot express: exactly-one card owner, one current class incharge
  per classroom, one active attendance policy per scope, no self-approved
  corrections.
- `prisma/tenant-isolation-test.sql` — runnable proof that cross-school links
  are rejected by the database itself.
- `docker-compose.yml` — local PostgreSQL 16.
- `docs/WINDOWS11-SETUP.md`, `scripts/setup-windows.ps1` — Windows 11 setup.
- `docs/PHASE1-REPORT.md` — what was validated, where, and the actual results.

## Tenant isolation (summary)

Every tenant-owned row carries `schoolId`; key links use **composite foreign
keys** `(schoolId, parentId) -> (schoolId, id)`, so the database rejects
cross-school references. Uniqueness (admission number, daily attendance, scan
idempotency, notice recipients, outbox/delivery idempotency) is school-scoped.
Phase 2 APIs must still scope every query by the caller's school membership.

## Quick start (local)

See `docs/WINDOWS11-SETUP.md`. Short version:

```powershell
Copy-Item .env.example .env
docker compose up -d db
npm install
npx prisma validate
npx prisma generate
npx prisma migrate dev --name init
```

## Stack (blueprint §9)

Node.js + Express, PostgreSQL + Prisma, Vue 3 + Vite + Tailwind, Capacitor
(Android first), custom Node notification worker + PostgreSQL outbox.
NFC is an optional later enhancement; QR is the MVP card mechanism.
