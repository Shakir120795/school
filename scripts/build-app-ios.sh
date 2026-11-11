#!/usr/bin/env bash
# Phase 55 — ek flavor ki iOS app banao. SIRF Mac par chalega
# (iOS build ke liye Xcode lazmi hai; Linux/Windows par sirf
# --prep-only chal sakta hai).
#
# Usage:  scripts/build-app-ios.sh <parent|staff|owner> [--prep-only]
# Env:    DEVELOPMENT_TEAM=<Apple Team ID>   (signed IPA ke liye)
#         EXPORT_METHOD=app-store|development (default: development)
#
# Output: build/apps-ios/
#   - Team ID diya  -> SmartSchool-<Flavor>.xcarchive + IPA (export)
#   - Team ID nahi  -> SmartSchool-<Flavor>-unsigned.app (compile
#     verify ke liye; iPhone par install NAHI hogi — signing ke
#     bina Apple kisi app ko chalne nahi deta)
#
# Android wali hi soch (Phase 42/43):
#  - Web flavor ke saath build hoti hai (VITE_APP_FLAVOR +
#    VITE_API_BASE); flavor config me server.url hai — app khulte
#    hi LIVE website load karti hai, isliye website ka har update
#    bina nayi app banaye aa jata hai. Flavor live site ko
#    ?appFlavor= se batata hai (runtime lock sirf native me).
#  - Build ke dauran capacitor.config.json + iOS project ki
#    pehchan (bundle ID + display name) flavor ke hisab se badli
#    jati hai; baad me pristine copies se restore — repo hamesha
#    generic "web" halat me rehta hai. Pristine copies:
#    scripts/android-template/capacitor.config.json (shared) aur
#    scripts/ios-template/{Info.plist, project.pbxproj}.
#  - Capacitor 8 ka iOS project SPM (Swift Package Manager) par
#    hai — CocoaPods ki zaroorat NAHI hai.
set -euo pipefail

FLAVOR="${1:?Usage: build-app-ios.sh <parent|staff|owner> [--prep-only]}"
case "$FLAVOR" in parent|staff|owner) ;; *) echo "Galat flavor: $FLAVOR" >&2; exit 2;; esac
PREP_ONLY=0
[ "${2:-}" = "--prep-only" ] && PREP_ONLY=1

if [ "$(uname)" != "Darwin" ] && [ "$PREP_ONLY" != "1" ]; then
  echo "iOS build sirf Mac (Xcode) par banta hai." >&2
  echo "Is machine par sirf --prep-only chalega (config/sync/identity ki jaanch)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/web"
API_BASE="${API_BASE:-https://smart-school-tawny.vercel.app}"
OUT="$ROOT/build/apps-ios"
mkdir -p "$OUT"

CFG="$WEB/app-flavors/$FLAVOR.json"
APP_ID="$(python3 -c "import json;print(json.load(open('$CFG'))['appId'])")"
APP_NAME="$(python3 -c "import json;print(json.load(open('$CFG'))['appName'])")"
LABEL="$(python3 -c "print('$FLAVOR'.capitalize())")"
echo "== $APP_NAME ($APP_ID) — API: $API_BASE"

if [ ! -d "$WEB/ios/App" ]; then
  echo "web/ios project nahi mila — repo se restore karo (git checkout -- web/ios)" >&2
  echo "ya dobara banao: (cd web && npx cap add ios) — phir icon/splash git se wapas aayenge." >&2
  exit 1
fi

# --- Icon/splash: binaries repo me .b64 bankar rehte hain
# (snapshot push text-only hai — web/icon-src wala hi pattern);
# build se pehle asli PNG jagah par rakh do. ---
python3 - "$ROOT" <<'PYEOF'
import base64, pathlib, sys
root = pathlib.Path(sys.argv[1])
assets = root / "scripts" / "ios-assets"
xc = root / "web" / "ios" / "App" / "App" / "Assets.xcassets"
(xc / "AppIcon.appiconset" / "AppIcon-512@2x.png").write_bytes(
    base64.b64decode((assets / "AppIcon-512@2x.png.b64").read_text()))
splash = base64.b64decode((assets / "splash-2732x2732.png.b64").read_text())
for f in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    (xc / "Splash.imageset" / f).write_bytes(splash)
print("iOS icon/splash ready")
PYEOF

# --- Flavor swap (restore hamesha pristine templates se) ---
TPL_SHARED="$ROOT/scripts/android-template"
TPL_IOS="$ROOT/scripts/ios-template"
restore() {
  cp "$TPL_SHARED/capacitor.config.json" "$WEB/capacitor.config.json" 2>/dev/null || true
  cp "$TPL_IOS/Info.plist" "$WEB/ios/App/App/Info.plist" 2>/dev/null || true
  cp "$TPL_IOS/project.pbxproj" "$WEB/ios/App/App.xcodeproj/project.pbxproj" 2>/dev/null || true
}
restore
trap restore EXIT

# --- Web build (flavor) ---
cd "$WEB"
[ -d node_modules ] || npm ci
VITE_APP_FLAVOR="$FLAVOR" VITE_API_BASE="$API_BASE" npm run build

# --- Native sync + flavor identity ---
cp "$CFG" "$WEB/capacitor.config.json"
npx cap sync ios
python3 - "$WEB/ios/App/App.xcodeproj/project.pbxproj" "$WEB/ios/App/App/Info.plist" "$APP_ID" "$APP_NAME" <<'PYEOF'
import re, sys
pbx, plist, app_id, app_name = sys.argv[1:5]
s = open(pbx).read()
s = re.sub(r"PRODUCT_BUNDLE_IDENTIFIER = [^;]+;", f"PRODUCT_BUNDLE_IDENTIFIER = {app_id};", s)
open(pbx, "w").write(s)
s = open(plist).read()
s = re.sub(r"(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)", rf"\g<1>{app_name}\g<2>", s)
open(plist, "w").write(s)
print("identity set:", app_id, "|", app_name)
PYEOF

if [ "$PREP_ONLY" = "1" ]; then
  echo "--- PREP VERIFY ---"
  grep -o "PRODUCT_BUNDLE_IDENTIFIER = [^;]*;" "$WEB/ios/App/App.xcodeproj/project.pbxproj" | sort -u
  grep -A1 "CFBundleDisplayName" "$WEB/ios/App/App/Info.plist" | tail -1
  grep -o '"appId": "[^"]*"' "$WEB/ios/App/App/capacitor.config.json" || true
  grep -o '"url": "[^"]*"' "$WEB/ios/App/App/capacitor.config.json" || true
  echo "--- prep-only: build nahi hua, files restore ho jayengi ---"
  exit 0
fi

# --- Xcode build (Mac) ---
PROJ="$WEB/ios/App/App.xcodeproj"
TEAM="${DEVELOPMENT_TEAM:-}"
if [ -n "$TEAM" ]; then
  METHOD="${EXPORT_METHOD:-development}"
  OPTS_SRC="$ROOT/scripts/ios/ExportOptions-$METHOD.plist"
  OPTS="$OUT/ExportOptions-$FLAVOR.plist"
  sed "s/__TEAM_ID__/$TEAM/" "$OPTS_SRC" > "$OPTS"
  xcodebuild -project "$PROJ" -scheme App -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$OUT/SmartSchool-$LABEL.xcarchive" \
    -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" archive
  xcodebuild -exportArchive -archivePath "$OUT/SmartSchool-$LABEL.xcarchive" \
    -exportPath "$OUT/SmartSchool-$LABEL-ipa" \
    -exportOptionsPlist "$OPTS" -allowProvisioningUpdates
  echo "== READY: $OUT/SmartSchool-$LABEL-ipa (signed, method: $METHOD)"
else
  xcodebuild -project "$PROJ" -scheme App -configuration Release \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$OUT/derived-$FLAVOR" CODE_SIGNING_ALLOWED=NO build
  APP_BUILT="$(find "$OUT/derived-$FLAVOR/Build/Products" -name "*.app" -maxdepth 2 | head -1)"
  cp -R "$APP_BUILT" "$OUT/SmartSchool-$LABEL-unsigned.app"
  echo "== READY (UNSIGNED): $OUT/SmartSchool-$LABEL-unsigned.app"
  echo "iPhone par lagane/TestFlight ke liye DEVELOPMENT_TEAM dekar dobara chalao:"
  echo "  DEVELOPMENT_TEAM=<TeamID> EXPORT_METHOD=app-store scripts/build-app-ios.sh $FLAVOR"
fi
