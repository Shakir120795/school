# Roadmap — PDF Feature Checklist vs Build Status

Source: `School_Smart_ID_App_Features_List.pdf` (owner, 26 Oct 2026) +
UI reference image (3 role themes). Status as of Phase 9.

## Already built (Phases 1–9)
- §1 QR smart ID cards: issue/revoke/replace, batch print (photo/roll fields in Phase 10)
- §2 Entry/exit gate scanning: late/early/duplicate handling, device keys
- §3 Parent app: mobile-OTP login (guardian-phone whitelist), children,
  attendance, notices, holidays, in-app inbox
- §5 Teacher: login, assigned classes, class notices, corrections
- §6 Admin panel: dashboard analytics, people, team & access, devices,
  settings, school branding (logo), audit-backed corrections
- §7 Attendance registers (class/date/student-wise), correction workflow
- §11/§12 Notices + scheduling + delivery tracking; in-app primary channel
- §24 Multi-school tenancy with DB-level isolation
- §25 PWA: installable, mobile app shell
- §27 Role-based access, hashed secrets, rate limits, audit log
- §28 Backups with verified restore; outbox retry/dead-letter

## Build order from here (PDF's own suggested rollout)
- Phase 10 — Role themes per UI reference (Parent blue #2563EB, Teacher
  green #16A34A, Admin navy #0F172A) + parent tile home + student
  roll number/photo + ID card photo
- Phase 11 — DONE (26 Oct): scan → parent entry/exit in-app alerts +
  "on campus now" gate view in the Scanner
- Phase 12 — Pickup & safety (§4): authorised persons, one-time parent
  approvals, staff release log, parent release alert, audit trail
- Phase 13 — DONE (26 Oct): teacher roll-call attendance (own classes only, gate-scan merge, absent alerts)
- Phase 14 — DONE (26 Oct): homework assign + parent notice, per-child done toggle, teacher completion tracking
- Phase 15 — DONE (26 Oct): leave applications (parent applies, teacher/manager decides, ON_LEAVE auto-applied without overwriting attended days, decision alerts)
- Phase 16 — DONE (26 Oct): fees ledger (heads + class structures, idempotent invoice generation, payments with receipt numbers, waive, summary; gateway later)
  recording + receipts, parent fee view; gateway integration after
- Phase 17 — DONE (26 Oct): class timetable grids + teacher my-periods + merged school calendar (events + holidays)
- Phase 18 — DONE (26 Oct): exams + marks entry, publish-gated parent report cards (per-exam %/grade + overall), publish announces to class parents
- Phase 19 — DONE (26 Oct): CSV bulk student import (row-wise results, auto class/year creation, guardian linking) + students/attendance/fees CSV exports
- Phase 20 — DONE (26 Oct): support tickets (threaded, status flow, staff reply alerts) + PTM slots with per-child time booking (no double-booking). Core roadmap (Phases 1–20) complete.
- Phase 21 — DONE (26 Oct): Super Admin console (operator: schools list+counts, create, suspend/reactivate, reset school-admin password, full school delete-purge) + Team password reset for managers + parent demo OTP fixed 123456 (OTP_PROVIDER=demo, until a real SMS provider is connected). No schema change.
- Later / hardware-dependent: transport + GPS (§15), library (§19),
  health & incidents (§20), staff HR/payroll (§18), super-admin billing
  (§31), AI assists (§32), NFC/RFID readers (§26 — QR stays the MVP)

<!-- deploy trigger 26 Oct 2026: Phase 21 webhook retry -->
- Phase 22 — DONE (26 Oct): unique login links per role (/login/parent, /login/teacher, /login/staff — the seeds of future separate apps; /login keeps the tabs) + parent login switched to school-issued ID + password (PARENT_AUTH_MODE env: "password" default; set to "otp" any time to restore mobile-OTP login — OTP endpoints untouched) + PARENT login creation links the guardian by mobile so children appear immediately + login links card in Team & Access. Diagnosis of the "parent login everywhere" report: server roles verified clean per account; the cause was the pre-Phase-21 Login.vue submit crash (missing myRole import) since fixed + stale cached app. No schema change.
- Phase 23 — DONE (26 Oct): console drill-in with FULL member management (operator opens any school → members grouped Admins/Teachers/Staff/Parents with login ID/phone/status + parent children count; operator can ADD a member login incl. parent guardian-mobile linking, EDIT name/email/phone/status, REMOVE a member — hard delete, or deactivation when the member has sent notices since Notice.sender is Restrict; a user left with no memberships is deactivated + signed out — and RESET any member's password; cross-school membership id 404s; all endpoints operator-only) + exactly three role login pages (/login/parent, /login/teacher, /login/school — school covers admin/principal/office staff; /login/staff redirects to /login/school; each page role-locked with a clear wrong-page error; the owner signs in on plain /login and lands on the console; Team login-links card shows the 3 links) + performance: API functions pinned to bom1 (Mumbai) instead of US, login's session+memberships queries parallelized. No schema change.
