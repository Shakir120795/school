# Pilot Runbook — One-School Launch, Support & Card SOP

For the platform operator and the pilot school's admin. Keep this next to
the deployment; update it with what the pilot teaches you.

## 1. Pilot onboarding checklist (one school)

1. **Agree scope in writing**: one school, named classes for week 1,
   success criteria (scan reliability, notice delivery, parent logins),
   and a named school contact.
2. **Create the tenant**: register the platform admin (first run only),
   create the school with its admin login, set the school **timezone** —
   attendance dates and policy windows depend on it.
3. **Structure**: academic year, classrooms, subjects; set the
   **attendance policies** (student + staff windows, late rule, working
   days) and holidays.
4. **People**: add teachers (+ class assignments, visibility), students,
   guardians; link guardians to students; create parent logins.
5. **Devices**: register each gate device and store its key in the gate
   browser (Scanner view). The key is shown once.
6. **Cards**: People → Students → bulk print for the pilot classes
   (issue + print in one step; QR exists only at issuance). Keep 5 spare
   blank prints for replacements.
7. **Providers (when live messaging starts)**: Meta WABA + approved
   `school_notice` template + env vars (see §5); Firebase project for
   push. Until then the worker runs with the log adapter — deliveries are
   tracked but nothing leaves the building.
8. **Rehearsal day**: run one full morning with staff shadowing the gate;
   verify registers, a correction, a notice, and a parent login before
   students rely on it.

## 2. Daily operations

- Morning: gate device opens the Scanner view; watch for
  `requiresReview` scans (out-of-window / no policy) in the register.
- Worker must be running (`npm run worker`) whenever notices are sent;
  check the outbox for `DEAD_LETTER` rows daily (admin → notice delivery
  history shows failures per recipient).
- Corrections: teachers request, principal/admin approves — nobody can
  approve their own request (enforced).

## 3. Support procedures

| Problem | First steps |
|---|---|
| Parent can't log in | Verify the account exists and role is PARENT; reset password via admin (Users). Check they're selecting the right school. |
| Notice "sent" but parent didn't get it | Notice → delivery history: `PROVIDER_ACCEPTED` = Meta accepted; `FAILED/NO_PHONE` = guardian has no phone on file; `OPTED_OUT` = parent turned the channel off in Preferences; `DEAD_LETTER` = provider outage, resend after fixing. |
| Scan shows INVALID | Card was revoked (lost/replaced) or is from another school. Check Cards list; reissue if needed. |
| Scan shows DUPLICATE | Same card re-scanned inside the duplicate window — expected at a busy gate; the first scan is the record. |
| Whole gate offline | Scans need the API. Keep a paper register during outages and enter corrections afterwards (request → approve). Never invent scans after the fact without a correction trail. |
| Wrong attendance | Correction request flow only — the audit log must show who changed what and why. |

## 4. Lost / damaged card SOP (card replacement)

1. Student/parent reports the loss to the class teacher or office.
2. Admin opens **People → Cards**, finds the student's ACTIVE card and
   **Revoke**s it immediately (the old QR stops working at once).
3. Issue a replacement (single issue or the bulk print sheet) and hand it
   over against the student's admission number.
4. If the old card is later found, do **not** reactivate it informally —
   it stays revoked; the replacement is the only live card.
5. Repeated losses: note them in the school register; charging for
   replacements is a school policy decision, not a system setting.

Device key lost (gate phone/tablet replaced): revoke the device in
Settings → Devices and register a new one — the old key stops working
immediately.

## 5. Production checklist (before real parents use it)

- [ ] HTTPS in front of the API; `CORS_ORIGINS` set to the real web origin.
- [ ] `JWT_SECRET` long + random; stored only in the server env.
- [ ] PostgreSQL reachable only from the API host; strong DB password.
- [ ] `NOTIFICATION_PROVIDER=whatsapp` + WhatsApp env complete; one live
      test message delivered to a staff phone; webhook URL registered in
      the Meta app with the same verify token.
- [ ] FCM service account path set (if push is offered); one live push
      received on a real device.
- [ ] Nightly `scripts/backup.sh` scheduled; **monthly**
      `scripts/restore-verify.sh` run against the latest dump.
- [ ] Rate limits reviewed (`RATE_LIMIT_*` env) for the deployment size.
- [ ] Worker running under a process manager (auto-restart).
- [ ] Register-platform-admin bootstrap closed (it auto-closes after the
      first platform admin exists — verify).
- [ ] Pilot sign-off recorded before onboarding a second school.

## 6. Backup & restore

```bash
DATABASE_URL=postgresql://… ./scripts/backup.sh /var/backups/school
DATABASE_URL=postgresql://… ./scripts/restore-verify.sh /var/backups/school/school-saas-<stamp>.dump
```

`restore-verify` restores into a throwaway database and compares key
table counts — it never touches the live database. A real disaster
restore is: create an empty DB, `pg_restore` the dump into it, point
`DATABASE_URL` at it, run `npx prisma migrate status`, restart API +
worker.
