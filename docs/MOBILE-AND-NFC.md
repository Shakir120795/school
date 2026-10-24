# Mobile (Capacitor) & NFC — Phase 4 notes

## Android (prepared in this repo)

- Capacitor is configured in `web/` (`capacitor.config.json`, appId
  `in.smartschool.app`) and the Android platform is added under `web/android/`.
- Push: `@capacitor/push-notifications` is wired — on a native device the app
  requests permission, registers, and posts the FCM token to
  `POST /schools/:schoolId/push-tokens`. The worker then sends PUSH copies of
  notices when `FCM_SERVICE_ACCOUNT_PATH` is configured on the server.
- Build an APK/AAB on a machine with Android Studio (Windows works):
  ```powershell
  cd web
  npm install
  npm run build
  npx cap sync android
  npx cap open android   # then Build > Build App Bundle / APK in Android Studio
  ```
  Set `VITE_API_BASE=https://your-api-host` before `npm run build` for a
  production APK (the dev proxy does not exist inside the app).
- A Firebase project + `google-services.json` (placed in
  `web/android/app/`) is required for real push delivery; the file is NOT in
  this repo.
- **Not verified here:** no JDK/Android SDK exists in the build VM, so no APK
  was produced and no real-device run was performed in Phase 4.

## iOS (preparation only)

- iOS was not added from this Linux VM. On a Mac:
  ```bash
  cd web && npx cap add ios && npx cap sync ios && npx cap open ios
  ```
  Push on iOS additionally needs an APNs key in Firebase and the Push
  Notifications capability in Xcode. Validate on a real device before any
  release claim (blueprint MVP criteria).

## NFC pilot (optional, not selected for the MVP)

The data model already supports NFC as a scan *source* (`ScanSource.NFC`)
and card credentials are source-agnostic — a scan produced by an NFC reader
goes through the same server-side resolution, revocation and duplicate
rules as QR. Before offering NFC to a school:

1. Pick the card/chip + reader hardware and confirm the reader can send an
   opaque identifier (do **not** trust a publicly readable static UID as
   authentication — blueprint §4).
2. Pilot with one class: issue dual QR+NFC cards, compare scan reliability
   and per-card cost against QR-only.
3. Keep the same lost-card procedure: revoke the credential, reissue.

No NFC-specific code ships until a school selects the pilot and hardware is
confirmed.
