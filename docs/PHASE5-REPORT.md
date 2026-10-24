# Phase 5 Report — Pilot Preparation & Production Hardening

**Date:** 25 Oct 2026
**Scope delivered:** permission review (with two real privacy fixes),
login rate limiting + security headers, backup/restore tooling with a
verified restore, a load check with real numbers, a pilot day-in-the-life
rehearsal test, and the pilot runbook / support & card SOP. The build is
ready for a one-school pilot once the owner supplies provider credentials
and a school. Multi-school onboarding stays gated on pilot sign-off.

## Permission review — findings & fixes

1. **Parent notice visibility (fixed).** Parents could list every sent
   notice in the school, including other classes' targeted notices. Now a
   parent's list contains only parent broadcasts and notices where they
   are an actual recipient.
2. **Recipient list leak (fixed).** Any notice reader role could fetch a
   notice's full recipient list with delivery detail. Now: parents see
   only their own recipient row; teachers only for notices they sent;
   admins/principals keep the full operational view.
3. **Platform admin boundary (verified).** A platform admin has no
   default access to school pupil data (students/notices return 403) —
   covered by a regression test.

## Hardening added

- **Login rate limiting:** 10 attempts/min per IP+email → 429 with
  `Retry-After`; generic API budget 600/min per IP (env-tunable). Verified
  by test (11th bad login is 429, earlier ones 401).
- **Security headers:** `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` on all
  responses (verified by test).
- The limiter is in-memory (single instance). The runbook notes the move
  to Redis counters for multi-instance production.

## Backup / restore — actually run

```
./scripts/backup.sh          → 124K pg_dump (custom format)
./scripts/restore-verify.sh  → restored into a throwaway DB; row counts
  matched on all 9 key tables (School 4, Memberships 22, Students 12,
  Guardians 12, StudentAttendance 5, StaffAttendance 1, Notices 5,
  Outbox 12, Deliveries 13) → RESTORE VERIFIED
```

Both scripts strip Prisma's `?schema=` parameter (pg tools reject it) —
found and fixed during this phase.

## Load check — actually run (`scripts/load-check.mjs`)

40 students × 5 scan rounds (200 scans, 20 concurrent) + 50 dashboard
reads against a fresh load database:

- Scans: **0 HTTP errors**; outcomes 80 RECORDED + 120 DUPLICATE (later
  rounds fall inside the 120-second duplicate window — the duplicate rule
  working as designed, not failures). Latency p50 **249 ms**, p95 454 ms.
- Reads: **0 errors**; p50 110 ms, p95 141 ms.

Numbers are from this small shared VM; a school gate does one scan at a
time per device, so this is comfortable headroom for the pilot. Re-run on
the production host before onboarding more schools.

## Tests — actual results

```
npm test → tests 20 · pass 20 · fail 0
(Phase 2: 10 · Phase 4: 5 · Phase 5: 5 — no regressions)
```

New Phase 5 tests (`tests/phase5.test.js`): parent notice visibility,
recipient scoping, platform-admin 403s, security headers + login rate
limit, and a **pilot rehearsal**: staff scan, student entry, teacher class
notice → worker delivery → parent ack, parent sees the child PRESENT, and
the register agrees.

## What remains before a real pilot (owner-side)

- A real school + its data, a gate device, and printed cards
  (runbook §1 walks it end-to-end).
- Meta WhatsApp credentials + approved template for live messaging;
  Firebase project for push (Phase 4 honesty notes still apply: only
  mock-verified so far).
- A production host: HTTPS, env checklist and backup schedule are in
  `docs/PILOT-RUNBOOK.md` §5–§6.
- APK build on a machine with Android Studio (Phase 4 note).

**This completes the blueprint's five phases.** Anything beyond —
second school, NFC pilot, billing/plans — should start as a new,
separately approved scope.
