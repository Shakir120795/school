# iOS Apps — Build Guide (Parent / Staff / Owner)

The three Smart School iOS apps are prepared in this repo (Phase 55).
They are Capacitor apps, exactly like the Android APKs: on open they
load the **live website** (`server.url` per flavor), so every website
update reaches the apps automatically — no new build needed.

| App | Bundle ID | Opens at |
| --- | --- | --- |
| Smart School Parent | `in.thedigitalwork.smartschool.parent` | `/login/parent` |
| Smart School Staff | `in.thedigitalwork.smartschool.staff` | `/login` (school + teacher) |
| Smart School Owner | `in.thedigitalwork.smartschool.owner` | `/login/admin` |

## What you need (Apple's rules — no way around them)

1. **A Mac** with the latest **Xcode** (free from the Mac App Store).
   iOS apps can only be compiled on macOS.
2. **An Apple Developer Program account — $99/year.**
   Without it, an app cannot be installed on any iPhone, uploaded
   to TestFlight, or published to the App Store. There is no free
   or sideload route for distribution.
3. This repo, cloned on that Mac, with Node 18+ installed.

## One-time setup (about 20 minutes)

1. Enroll at <https://developer.apple.com/programs/> ($99/year).
2. In the Developer portal → **Certificates, Identifiers & Profiles →
   Identifiers**, register the three App IDs (bundle IDs in the
   table above). (The build script uses automatic signing with
   `-allowProvisioningUpdates`, so Xcode can also create them for
   you on first archive — registering manually just keeps the
   portal tidy.)
3. Note your **Team ID** (Developer portal → Membership details).
   Every signed build below uses it.

## Build one app

From the repo root on the Mac:

```bash
# Signed .ipa (development export — install on registered devices)
DEVELOPMENT_TEAM=<YOUR_TEAM_ID> scripts/build-app-ios.sh parent

# Signed .ipa for App Store / TestFlight upload
DEVELOPMENT_TEAM=<YOUR_TEAM_ID> EXPORT_METHOD=app-store scripts/build-app-ios.sh parent

# No Team ID yet? Compile-check only (unsigned .app — will NOT
# install on an iPhone, it only proves the project builds)
scripts/build-app-ios.sh parent
```

Repeat with `staff` and `owner`. Output lands in `build/apps-ios/`.

The script swaps the flavor identity in, builds, and **restores the
repo to its generic state afterwards** — the committed iOS project
always keeps the base identity (`in.smartschool.app`, "Smart
School"); per-flavor identity lives only inside each build.

To check the flavor wiring without building (works on any OS):

```bash
scripts/build-app-ios.sh parent --prep-only
```

## Publishing

- **Parent app → App Store:** build with `EXPORT_METHOD=app-store`,
  then upload the `.ipa` with Apple's **Transporter** app (free, Mac
  App Store) or `xcrun altool`. Create the App Store Connect listing
  first: name *Smart School Parent*, bundle ID
  `in.thedigitalwork.smartschool.parent`, privacy policy URL
  `https://smart-school-tawny.vercel.app/privacy`. Start with a
  **TestFlight** internal build before public release.
- **Staff & Owner apps:** these are internal tools — do **not** put
  them on the public App Store. Distribute via **TestFlight**
  (internal testers, same App Store Connect account) using the same
  app-store export, or a development export installed on registered
  device UDIDs.

## Notes

- **Icons & splash** are already branded (generated from
  `web/icon-src/`). The App icon is 1024×1024 with no alpha, as the
  App Store requires. The binary PNGs are stored base64-encoded in
  `scripts/ios-assets/*.b64` (the repo's file sync is text-only);
  the build script decodes and places them automatically before
  every build. If you open the Xcode project **without** the
  script, the icon/splash files will be missing — run the build
  script once with `--prep-only`, or decode the `.b64` files into
  `web/ios/App/App/Assets.xcassets/` by hand. To change the icon,
  replace the `.b64` sources, not the generated PNGs.
- **Push notifications stay OFF on iOS** until Firebase is set up
  for iOS (a `GoogleService-Info.plist` per app + the APNs key).
  The web side already gates native push behind
  `VITE_NATIVE_PUSH=on` (Phase 49b lesson), so the apps run safely
  without it.
- **First-open needs internet** — same trade-off as Android
  (Phase 43): the apps open the live website.
