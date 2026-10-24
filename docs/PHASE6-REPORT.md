# Phase 6 Report — In-App First + Live Deployment

**Date:** 25 Oct 2026 · Added at the owner's direction after Phase 5.

## Direction change (owner)

- WhatsApp is **not** the primary channel anymore. Notifications are
  delivered **inside the app** (inbox + unread badge + optional push), so
  families must use the app — WhatsApp stays an optional extra for later.
- Each new school is onboarded by creating its tenant and handing over its
  own admin login/ID; the **school admin fills the school profile**
  (logo/photo, address, phone, email) from Settings.

## What changed

- `NotificationChannel.IN_APP` + worker: every notice send records an
  IN_APP delivery (DELIVERED) first; WhatsApp/push are extras. A WhatsApp
  opt-out no longer blocks the in-app copy. External-provider failure
  still retries/dead-letters the send, but the in-app copy survives
  (tests updated to the new semantics — see Phase 2/5 test notes).
- Inbox API: `GET /schools/:id/my-notifications` (own rows only, unread
  count) + `POST …/:recipientId/read` (404 for anyone else's row).
- Web: Notifications view with NEW badges + mark-read, unread count in the
  sidebar nav, school logo/name in the sidebar, profile fields in
  Settings, school name on printed ID cards.
- School profile: `logoUrl, address, phone, email` on School (migration
  `phase6_school_profile_inapp`), PATCH extended with an http(s)
  validation for the logo URL.
- Tests: **23/23 PASS** (3 new Phase 6 tests: profile CRUD + permissions,
  inbox delivery/unread/read, cross-user read protection).

## Live deployment (verified end-to-end)

- **App:** https://smart-school-tawny.vercel.app — Vercel project
  `smart-school`, git-linked to this repo (pushes auto-deploy).
  API runs as a serverless function (`api/index.js` + rewrites); the
  outbox runs inline on notice-send plus a daily cron (Vercel Hobby
  allows only daily crons — the original 5-minute schedule failed the
  first build and was fixed; an exact-path rewrite for `POST /schools`
  was fixed the same way).
- **Database:** Postgres on a NEW Supabase account kept separate from the
  owner's other projects (owner's explicit rule), full schema applied
  cleanly (31 tables). Connection string lives only in Vercel env.
- **Live checks actually run:** `/health` OK; demo school seeded through
  the public API; admin + parent logins OK; parent `my-children` OK;
  gate scan recorded on production; **admin sent a notice and the
  parent's in-app inbox showed unread = 1, status DELIVERED** — the
  in-app-first flow proven live, no WhatsApp involved.
- Demo logins are the seed values in `scripts/seed-demo.mjs` (demo only —
  replace before any real school uses this deployment).
