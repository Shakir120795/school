#!/usr/bin/env bash
# Sandbox-only Gradle runner (Phase 42):
# Is VM ka egress proxy TLS-MITM karta hai — curl use trust karta
# hai, lekin Gradle ka Apache HTTP client handshake par hi reset
# ho jata hai. Isliye: Gradle ko ek local file Maven repo
# (/tmp/m2repo, init.gradle se) diya jata hai; jo artifact missing
# mile, use curl se download karke repo me daal kar dobara chalate
# hain, jab tak build pura na ho jaye.
#
# Usage: scripts/gradle-offline-loop.sh <gradle args...>
# Env:   GRADLE_USER_HOME (init.gradle + gradle.properties wahi se),
#        JAVA_HOME, ANDROID_HOME, M2REPO pehle se set hone chahiye.
set -uo pipefail

REPO="${M2REPO:-$HOME/workspace/tools/m2repo}"
mkdir -p "$REPO"
GRADLE="${GRADLE_BIN:-$HOME/workspace/tools/gradle/bin/gradle}"
LOG="$(mktemp /tmp/gradle-run.XXXXXX.log)"

for i in $(seq 1 30); do
  echo "—— gradle attempt $i: $*"
  timeout "${GRADLE_TIMEOUT:-560}" "$GRADLE" "$@" --console=plain >"$LOG" 2>&1
  code=$?
  if [ $code -eq 0 ]; then
    tail -3 "$LOG"
    echo "—— gradle OK (attempt $i)"
    exit 0
  fi
  if [ $code -eq 124 ]; then
    # Timeout par mara, lekin build aage badh raha tha (UP-TO-DATE
    # cache se har attempt aur aage jata hai) — error mat samjho,
    # bas dobara chalao.
    echo "—— attempt $i timeout (build chal raha tha) — dobara"
    continue
  fi
  # Missing artifact URLs nikalo (remote base ke baad ka path hi
  # local repo ka layout hai — google/central dono ka path same hai).
  before=$(find "$REPO" -type f | wc -l)
  python3 - "$LOG" "$REPO" <<'PYEOF'
import re, subprocess, sys, os
log, repo = sys.argv[1], sys.argv[2]
text = open(log, errors="ignore").read()
# 1) Remote URLs jo Gradle ne try kiye aur fail hue.
paths = set()
for url in re.findall(r"Could not (?:get resource|GET) '(https://[^']+)'", text):
    m = re.search(r"(?:maven2|m2)/(.+)$", url)
    if m:
        paths.add(m.group(1))
# 2) File-repo wale miss: "Could not find x.jar ... Searched in:
#    file:<repo>/<path>" — inka remote base path se banta hai.
for p in re.findall(re.escape(repo) + r"/(\S+)", text):
    paths.add(p)
BASES = ["https://dl.google.com/dl/android/maven2/",
         "https://repo.maven.apache.org/maven2/",
         "https://plugins.gradle.org/m2/"]
fetched = 0
for path in sorted(paths):
    dest = os.path.join(repo, path)
    if os.path.exists(dest):
        continue
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    ok = False
    for base in BASES:
        r = subprocess.run(["curl", "-sfL", "--max-time", "120", "-o", dest + ".tmp", base + path],
                           capture_output=True)
        if r.returncode == 0:
            os.replace(dest + ".tmp", dest)
            fetched += 1
            print("fetched:", path)
            ok = True
            # POM ke saath uski .module (Gradle Module Metadata) bhi
            # le aao — KMP libraries (datastore, collection) ke sahi
            # variant sirf isi se chune jate hain; iske bina JVM
            # variant Android classpath me ghus jata hai aur
            # duplicate-class errors aate hain.
            if path.endswith(".pom"):
                mpath = path[:-4] + ".module"
                mdest = os.path.join(repo, mpath)
                if not os.path.exists(mdest):
                    r2 = subprocess.run(["curl", "-sfL", "--max-time", "60", "-o", mdest + ".tmp", base + mpath],
                                        capture_output=True)
                    if r2.returncode == 0:
                        os.replace(mdest + ".tmp", mdest)
                        print("fetched:", mpath)
                    elif os.path.exists(mdest + ".tmp"):
                        os.remove(mdest + ".tmp")
            break
    if not ok:
        # 404 waghera (jaise kuch .module files upstream hoti hi
        # nahi) — chhod do, Gradle POM par fallback kar lega.
        if os.path.exists(dest + ".tmp"):
            os.remove(dest + ".tmp")
        print("skip (upstream nahi mila):", path)
print(f"FETCHED={fetched}")
PYEOF
  after=$(find "$REPO" -type f | wc -l)
  if ! grep -q "Could not get resource\|Could not GET\|Could not find" "$LOG"; then
    echo "—— gradle fail, lekin koi missing artifact nahi — asli error:"
    grep -B2 -A14 "What went wrong" "$LOG" | head -40
    exit 1
  fi
  if [ "$after" -le "$before" ]; then
    echo "—— koi naya artifact nahi aaya, loop rok raha hu — asli error:"
    grep -B2 -A14 "What went wrong" "$LOG" | head -40
    exit 1
  fi
  echo "—— repo me ab $after files; dobara try"
done
echo "—— 30 attempts ke baad bhi pura nahi hua; last log: $LOG"
grep -B2 -A14 "What went wrong" "$LOG" | head -40
exit 1
