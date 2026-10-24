# Phase 3 Report — Vue Web Application

**Date:** 25 Oct 2026
**Scope delivered:** Vue 3 + Vite + Tailwind web app in `web/`, role-specific
views for principal/admin, teacher and parent; student/staff directory and
assignment management; attendance dashboards + QR scanner; notice composer
with audience preview and delivery history; responsive mobile-first layout.
Phase 4 items (real WhatsApp/push providers, Capacitor packaging, NFC pilot)
were **not** built.

## What was built

- **Shell & auth:** login with token refresh (transparent 401 → refresh →
  retry), school switcher for multi-school users, role-aware navigation —
  desktop sidebar + mobile bottom nav, route guards by role.
- **Dashboard:** today's student present/late/absent, staff check-ins,
  review-flag warning, recent notices (school timezone date).
- **Students & Staff (`People`):** add students; issue QR ID cards — the QR
  image is rendered in-browser from the one-time token for printing onto the
  existing card; guardians add/link; teachers add (login + profile),
  class/subject assignments, class-incharge; staff QR cards.
- **Attendance:** date-wise student and staff registers with status badges,
  entry/exit times and review flags; correction request form (approval flow
  is API-side; self-approval remains impossible).
- **Gate Scanner:** device configuration (school id + one-time device key,
  stored only in that browser), ENTRY/EXIT toggle, camera scanning via
  html5-qrcode with manual token fallback, clear RECORDED / DUPLICATE /
  INVALID result panel.
- **Notices:** composer with role-limited audience options (teachers only
  see assigned-class / selected-students), **audience preview counts before
  sending**, save draft / send now, per-notice delivery history (recipient
  status + channel delivery state + provider id / error code), parent
  acknowledgement button.
- **Parent view:** linked children with recent attendance, school-approved
  teacher directory (subjects, classes, incharge, approved contact channel),
  WhatsApp consent toggle.
- **Settings:** school name/timezone, academic years, classrooms, subjects,
  attendance policies (student/staff windows), gate devices with one-time
  key display.
- **API change (Phase 3 enabler):** CORS allow-list middleware
  (`CORS_ORIGINS`, defaults to local Vite dev/preview origins).
- **Demo seed:** `scripts/seed-demo.mjs` creates a full demo school
  (operator/admin/principal/teacher/parent logins, class, students,
  policies, device, sample QR card) against a running API.

## Validation — actual results

| Check | Result |
|---|---|
| `npm install` (web) | ✅ completed |
| `npm run build` (Vite production build, all views compiled) | ✅ passed — 11 chunks, no errors |
| API + CORS from the web origin | ✅ exercised through the demo seed and Phase 2 test-suite endpoints the UI calls |
| Demo seed against running API | ✅ "DEMO READY" — all demo accounts, device key and sample card created |
| Preview server serves the app | ✅ `GET http://localhost:4173/` → 200 with the built bundle |
| Phase 2 API tests (regression surface for every endpoint the UI uses) | ✅ 10/10 (re-run after the Phase 3 CORS change) |

### What was NOT verified — stated plainly

**No visual/browser verification of the UI was possible in this
environment.** The hosted browser cannot reach the VM's localhost (it
rejected `localhost:4173` as an invalid request while public sites loaded
fine), and the VM has no local Chromium (the Playwright browser download
did not complete through the egress proxy). So the screens above are
build-verified and API-contract-verified, but **not** click-tested in a
real browser. First run on the owner's machine should be:

```powershell
# terminal 1 (repo root): API
docker compose up -d db; npm install; npx prisma migrate dev; npm start
# terminal 2: demo data (once)
node scripts/seed-demo.mjs
# terminal 3 (web/): UI
npm install; npm run dev   # http://localhost:5173 (proxies API calls)
```

Demo logins are printed by the seed script (also listed in its header
comments pattern): admin@demo.school, principal@demo.school,
teacher@demo.school, parent@demo.school.

## Known limits / Phase 4 notes

1. Scanner camera requires HTTPS or localhost in real browsers; a deployed
   gate tablet must use HTTPS.
2. Notice delivery still uses the Phase 2 `log` provider adapter — the UI
   shows real delivery rows, but no external WhatsApp message is sent until
   Phase 4 providers land.
3. The correction **approval** queue UI is minimal (audit list only);
   approvals currently happen via API. A dedicated approvals inbox can be
   added in Phase 4/5 polish if the pilot needs it.
4. No PWA/offline support yet; Capacitor wrapping is Phase 4.

**Phase 4 must not start until the owner approves this Phase 3.**
