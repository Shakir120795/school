# Phase 4 Report — Provider & Mobile Integration

**Date:** 25 Oct 2026
**Scope delivered:** WhatsApp Cloud API adapter + signed status webhooks,
FCM push adapter + device-token registration, scheduled-notice sending in
the worker, QR card batch-print workflow, Capacitor Android preparation,
iOS/NFC documentation. Phase 5 (pilot + production hardening) not started.

## What was built

### WhatsApp Business Platform (`src/services/providers/whatsapp.js`)
- Worker sends approved **template** messages through the Cloud API when
  `NOTIFICATION_PROVIDER=whatsapp` (template `WHATSAPP_NOTICE_TEMPLATE`,
  default `school_notice`, body params = notice title + body).
- Recipient phone resolution: guardian phone / staff user phone; a missing
  phone is a **permanent** delivery failure (`NO_PHONE`), never retried.
- If WhatsApp is selected but env is incomplete, the outbox fails visibly
  with `PROVIDER_NOT_CONFIGURED` — nothing is silently marked sent.
- Config is env-only (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, optional
  `WHATSAPP_API_BASE` for sandbox/testing). No credentials are in the repo.

### Status webhooks (`src/routes/webhooks.js`)
- `GET /webhooks/whatsapp` — Meta verification challenge.
- `POST /webhooks/whatsapp` — raw-body HMAC-SHA256 verification against
  `WHATSAPP_APP_SECRET` (invalid signature → 403), then status mapping
  sent/delivered/read/failed onto `NotificationDelivery` **and** the
  recipient snapshot, with timestamps and Meta error details.
- Updates are idempotent and monotonic: replays and out-of-order older
  statuses never move a delivery backwards.

### Push notifications (`src/services/providers/fcm.js`, `src/routes/push.js`, `PushDeviceToken`)
- FCM HTTP v1 adapter with service-account OAuth (signed JWT, no SDK);
  attempted only when `FCM_SERVICE_ACCOUNT_PATH` is set.
- Members register/deactivate device tokens
  (`POST/DELETE /schools/:id/push-tokens`); the worker sends a PUSH copy
  per active token as a best-effort second channel (push failures are
  recorded but never fail the WhatsApp send).
- Web/native: Capacitor push registration posts the token automatically
  when running inside the mobile shell.

### Worker completion
- Due `SCHEDULED` notices are now flipped to sends by the worker
  (recipient snapshot + outbox in the same transaction via the shared
  `sendNoticeCore`), closing the gap noted in Phase 2.

### QR card print workflow (web)
- People → Students gains a bulk flow: select students → issue cards →
  print sheet (card grid with school header, name, admission no, class,
  QR) with print CSS. This respects the security model — QRs exist only at
  issuance, so printing happens in the same step; lost cards are revoked
  and re-issued.

### Mobile (`docs/MOBILE-AND-NFC.md`)
- Capacitor configured; Android platform added and synced locally
  (`web/android/` is git-ignored because it contains generated binaries —
  regenerate with `npx cap add android`).
- iOS: documented add/sync steps for a Mac (cannot be generated on Linux).
- NFC: pilot plan documented; schema already supports NFC as a scan source.
  NFC was **not** selected by the owner, so no NFC code ships.

## Tests — actual results

```
DATABASE_URL=postgresql://…/school_saas_test npm test
→ tests 15 · pass 15 · fail 0   (Phase 2 suite 10/10 still green)
```

New Phase 4 tests (`tests/phase4.test.js`):
1. ✅ WhatsApp adapter sends a template through a **local mock of the Meta
   Graph API**; request shape verified (product, phone, template, params)
   and the returned `wamid.*` id is recorded on the delivery.
2. ✅ Webhook: verification challenge ok / wrong token 403; signed
   `delivered` update moves delivery + recipient to DELIVERED with
   timestamp; replay is a no-op; an older `sent` status does not regress
   it; bad signature → 403.
3. ✅ Push tokens: register → list mine (1) → deactivate → list mine (0).
4. ✅ Scheduled notice: a past-due SCHEDULED notice is flipped by the
   worker to SENT with recipients snapshotted.
5. ✅ WhatsApp selected but unconfigured: outbox ends FAILED with a clear
   configuration error (no fake success).

Also: web production build ✅ after the print workflow + push wiring;
`npx cap sync android` ✅.

## What was NOT verified — stated plainly

- **No real WhatsApp message was sent.** There are no Meta/WhatsApp
  Business credentials in this environment; the adapter is verified
  against a local mock that mimics the Graph API contract, plus the
  webhook receiver is verified with real HMAC signatures. Real sending
  needs the owner's WABA + phone number id + token + an approved
  `school_notice` template, then one live test message.
- **No real FCM push was sent** (no Firebase project/service account here);
  the adapter implements the documented HTTP v1 flow and is exercised only
  in its unconfigured path.
- **No APK was built and no real device was used** — the build VM has no
  JDK/Android SDK. Android Studio steps are in `docs/MOBILE-AND-NFC.md`.
- Real-device QR scanning was likewise not performed (see Phase 3 report).

**Phase 5 must not start until the owner approves this Phase 4.**
