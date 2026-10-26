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
- Phase 11 — Scan → parent entry/exit alerts (in-app, instant) +
  "on campus now" gate view
- Phase 12 — Pickup & safety (§4): authorised persons, one-time parent
  approvals, staff release log, parent release alert, audit trail
- Phase 13 — Teacher roll-call attendance (manual mark in app) (§5/§7)
- Phase 14 — Homework (§10): post with subject/due date, parent view
- Phase 15 — Leave & permissions (§14): parent submits, staff decides
- Phase 16 — Fees (§13): fee heads, student ledger, dues, manual payment
  recording + receipts, parent fee view; gateway integration after
- Phase 17 — Timetable + school calendar/events (§8/§22)
- Phase 18 — Exams, marks, report cards (§9)
- Phase 19 — Bulk import students/guardians (CSV) + report exports (§16/§21)
- Phase 20 — Support tickets (§23/§30) + PTM bookings (§17)
- Later / hardware-dependent: transport + GPS (§15), library (§19),
  health & incidents (§20), staff HR/payroll (§18), super-admin billing
  (§31), AI assists (§32), NFC/RFID readers (§26 — QR stays the MVP)
