#!/usr/bin/env bash
# Phase 42 — ek flavor ki Android DEBUG app (APK) banao.
#
# Usage:  scripts/build-app.sh <parent|staff|owner>
# Output: build/apps/SmartSchool-<Parent|Staff|Owner>-debug.apk
#
# Kaise kaam karta hai:
#  1. Web ko flavor ke saath build karta hai (VITE_APP_FLAVOR +
#     VITE_API_BASE — app live API se baat karti hai, isliye native
#     build me API base absolute URL hota hai; website build hamesha
#     relative rehta hai).
#  2. Capacitor config + Android applicationId/app_name ko flavor ke
#     hisab se badal kar `cap sync` + Gradle assembleDebug chalata
#     hai, phir saari files wapas original kar deta hai (repo hamesha
#     generic "web" halat me rehta hai).
# Toolchain: JAVA_HOME / ANDROID_HOME env, warna ~/workspace/tools
# (Corretto 21 + manually-installed SDK — sdkmanager is sandbox ke
# proxy par chalta nahi, isliye SDK zips curl se aayi thi).
set -euo pipefail

FLAVOR="${1:?Usage: build-app.sh <parent|staff|owner>}"
case "$FLAVOR" in parent|staff|owner) ;; *) echo "Galat flavor: $FLAVOR" >&2; exit 2;; esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/web"
API_BASE="${API_BASE:-https://smart-school-tawny.vercel.app}"
TOOLS="$HOME/workspace/tools"
export JAVA_HOME="${JAVA_HOME:-$TOOLS/jdk}"
export ANDROID_HOME="${ANDROID_HOME:-$TOOLS/android-sdk}"
export PATH="$JAVA_HOME/bin:$PATH"
# Gradle setup is sandbox ke liye khaas hai (Phase 42 me khoja gaya):
#  - GRADLE_USER_HOME ~/workspace/tools me (persistent): JVM ka
#    user.home /root hai; /tmp VM replacement par ud jata hai —
#    ek build isi me marr gaya tha (8 Nov), isliye caches yahan.
#  - preferIPv4Stack: daemon-client IPC IPv6-mapped socket par
#    bina kisi error ke tut jati thi.
#  - Truststore: egress proxy TLS-MITM karta hai (Hatch Sandbox
#    Egress CA) — Java ke default cacerts use nahi pehchante.
#  - Dependencies Gradle se download NAHI hoti (uska HTTP client
#    MITM handshake par reset hota hai) — isliye init.gradle ek
#    local file repo (~/workspace/tools/m2repo) lagata hai aur
#    gradle-offline-loop.sh missing artifacts curl se lata hai.
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$TOOLS/gradle-home}"
export M2REPO="${M2REPO:-$TOOLS/m2repo}"
setup_gradle_home() {
  mkdir -p "$GRADLE_USER_HOME"
  if [ ! -f "$GRADLE_USER_HOME/truststore.jks" ] && [ -f /usr/local/share/ca-certificates/hatch-egress-ca.crt ]; then
    cp "$JAVA_HOME/lib/security/cacerts" "$GRADLE_USER_HOME/truststore.jks"
    "$JAVA_HOME/bin/keytool" -importcert -noprompt -storepass changeit \
      -keystore "$GRADLE_USER_HOME/truststore.jks" -alias hatch-egress \
      -file /usr/local/share/ca-certificates/hatch-egress-ca.crt >/dev/null 2>&1 || true
  fi
  python3 - "$GRADLE_USER_HOME" "$M2REPO" <<'PYEOF'
import os, sys, urllib.parse
gh, m2 = sys.argv[1], sys.argv[2]
u = urllib.parse.urlparse(os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY") or "")
lines = [
    f"org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8 -Djava.net.preferIPv4Stack=true -Djavax.net.ssl.trustStore={gh}/truststore.jks -Djavax.net.ssl.trustStorePassword=changeit -Djdk.tls.client.protocols=TLSv1.2 -Dhttps.protocols=TLSv1.2",
    "org.gradle.daemon=false",
    f"systemProp.javax.net.ssl.trustStore={gh}/truststore.jks",
    "systemProp.javax.net.ssl.trustStorePassword=changeit",
    "systemProp.https.protocols=TLSv1.2",
    "systemProp.jdk.tls.client.protocols=TLSv1.2",
]
if u.hostname and u.port:
    for scheme in ("http", "https"):
        lines += [f"systemProp.{scheme}.proxyHost={u.hostname}",
                  f"systemProp.{scheme}.proxyPort={u.port}"]
        if u.username: lines.append(f"systemProp.{scheme}.proxyUser={u.username}")
        if u.password: lines.append(f"systemProp.{scheme}.proxyPassword={u.password}")
open(os.path.join(gh, "gradle.properties"), "w").write("\n".join(lines) + "\n")
init = (
    "allprojects {\n"
    "    buildscript {\n"
    "        repositories {\n"
    "            maven { url 'file://" + m2 + "' }\n"
    "        }\n"
    "    }\n"
    "    repositories {\n"
    "        maven { url 'file://" + m2 + "' }\n"
    "    }\n"
    "}\n")
open(os.path.join(gh, "init.gradle"), "w").write(init)
print("gradle home ready:", gh)
PYEOF
}
setup_gradle_home
export GRADLE_OPTS="-Xmx1536m -Dfile.encoding=UTF-8 -Djava.net.preferIPv4Stack=true -Djavax.net.ssl.trustStore=$GRADLE_USER_HOME/truststore.jks -Djavax.net.ssl.trustStorePassword=changeit -Djdk.tls.client.protocols=TLSv1.2"

CFG="$WEB/app-flavors/$FLAVOR.json"
APP_ID="$(python3 -c "import json;print(json.load(open('$CFG'))['appId'])")"
APP_NAME="$(python3 -c "import json;print(json.load(open('$CFG'))['appName'])")"
LABEL="$(python3 -c "print('$FLAVOR'.capitalize())")"
echo "== $APP_NAME ($APP_ID) — API: $API_BASE"

# Android project git me nahi hai (regenerable) — na ho to bana lo.
if [ ! -d "$WEB/android/app" ]; then
  (cd "$WEB" && npx cap add android)
fi

# --- Flavor swap (trap se restore) ---
# Restore ka bharosa runtime backup par NAHI hai: is VM par
# EXIT trap kabhi kabhi chalta hi nahi (session teardown) aur
# /tmp reaper backup uda deta tha — 8 Nov ko files parent
# flavor me atki mili. Isliye pristine copies repo me rakhi
# hain (scripts/android-template/) aur restore hamesha wahi
# se hota hai; run ki shuruaat me bhi pehle heal karte hain.
TPL="$ROOT/scripts/android-template"
restore() {
  cp "$TPL/capacitor.config.json" "$WEB/capacitor.config.json" 2>/dev/null || true
  cp "$TPL/build.gradle" "$WEB/android/app/build.gradle" 2>/dev/null || true
  cp "$TPL/strings.xml" "$WEB/android/app/src/main/res/values/strings.xml" 2>/dev/null || true
}
restore
trap restore EXIT

# --- Web build (flavor) ---
cd "$WEB"
VITE_APP_FLAVOR="$FLAVOR" VITE_API_BASE="$API_BASE" npm run build

# --- Native sync (flavor identity) ---
cp "$CFG" "$WEB/capacitor.config.json"
sed -i "s/applicationId \"[^\"]*\"/applicationId \"$APP_ID\"/" "$WEB/android/app/build.gradle"
sed -i \
  -e "s|<string name=\"app_name\">[^<]*</string>|<string name=\"app_name\">$APP_NAME</string>|" \
  -e "s|<string name=\"title_activity_main\">[^<]*</string>|<string name=\"title_activity_main\">$APP_NAME</string>|" \
  -e "s|<string name=\"package_name\">[^<]*</string>|<string name=\"package_name\">$APP_ID</string>|" \
  -e "s|<string name=\"custom_url_scheme\">[^<]*</string>|<string name=\"custom_url_scheme\">$APP_ID</string>|" \
  "$WEB/android/app/src/main/res/values/strings.xml"
echo "sdk.dir=$ANDROID_HOME" > "$WEB/android/local.properties"
# KMP jars (androidx.collection/datastore) ka duplicate
# 'commonMain/default/manifest' mergeDebugJavaResource par
# rokta hai — packaging exclude (sirf build ke liye, restore
# trap ise bhi wapas kar dega).
python3 - "$WEB/android/app/build.gradle" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()
if "commonMain/default/manifest" not in s:
    s = s.replace("android {", "android {\n    packaging {\n        resources {\n            excludes += \"commonMain/default/manifest\"\n        }\n    }", 1)
    open(p, "w").write(s)
print("packaging exclude applied")
PYEOF
npx cap sync android

# --- APK build (local Gradle: wrapper ka downloader is sandbox ke
# proxy par tut jata hai, isliye distribution curl se aakar
# ~/workspace/tools/gradle me rakhi hai; dependencies bhi curl se
# aati hain — gradle-offline-loop.sh dekho) ---
cd "$WEB/android"
GRADLE_BIN="$TOOLS/gradle/bin/gradle" bash "$ROOT/scripts/gradle-offline-loop.sh" assembleDebug
OUT="$ROOT/build/apps"
mkdir -p "$OUT"
cp app/build/outputs/apk/debug/app-debug.apk "$OUT/SmartSchool-$LABEL-debug.apk"
echo "== READY: $OUT/SmartSchool-$LABEL-debug.apk"
