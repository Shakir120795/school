<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { login, loginWithOtp, api, myRole, myMemberships, currentUser, session, revokeSession } from "../api.js";

const router = useRouter();
const route = useRoute();
// Role-specific entry points: /login/parent, /login/teacher and
// /login/school lock this page to one audience (these URLs are the
// future separate apps' starting points). Plain /login shows the
// Parent/Staff tab switcher; the platform owner signs in there too
// and lands on the console.
const variant = route.meta.variant || "";
const locked = computed(() => variant !== "");
const tab = ref(variant === "parent" ? "parent" : "staff");

const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

// A login page can be opened while another account is signed in
// (26 Oct: login links must always show their own page). The banner
// names the current session; a SUCCESSFUL sign-in below replaces it,
// a failed attempt leaves it completely untouched.
const signedInUser = ref(session.accessToken ? currentUser() : null);
const signedInRole = computed(() => {
  if (!signedInUser.value) return "";
  if (signedInUser.value.isPlatformAdmin) return "PLATFORM_ADMIN";
  return myRole() || myMemberships()[0]?.role || "";
});

function goDashboard() {
  if (signedInUser.value?.isPlatformAdmin) return router.push("/console");
  router.push(myRole() === "PARENT" ? "/parent" : "/");
}

async function bannerLogout() {
  await api("/auth/logout", { method: "POST", body: {} }).catch(() => {});
  session.clear();
  signedInUser.value = null;
  error.value = "";
  notice.value = "";
}

// Snapshot/restore of the stored session, so a sign-in attempt that
// fails (bad credentials or wrong-role page) changes nothing, while a
// successful one can revoke the old session and take its place.
function snapshotSession() {
  return {
    access: session.accessToken,
    refresh: localStorage.getItem("ss_refresh"),
    user: localStorage.getItem("ss_user"),
    memberships: localStorage.getItem("ss_memberships"),
    school: session.schoolId,
  };
}
function restoreSession(old) {
  session.setTokens(old.access, old.refresh);
  if (old.user) localStorage.setItem("ss_user", old.user); else localStorage.removeItem("ss_user");
  if (old.memberships) localStorage.setItem("ss_memberships", old.memberships); else localStorage.removeItem("ss_memberships");
  session.setSchool(old.school);
}
// After login() has stored the new account: revoke the replaced
// session server-side and pin the active school to the new account.
async function replaceOldSession(old) {
  if (old.access) await revokeSession(old.access, old.refresh);
  const ms = myMemberships();
  if (ms.length) session.setSchool(ms[0].schoolId);
}

const phone = ref("");
const code = ref("");
const otpSent = ref(false);
const demoCode = ref("");
const notice = ref("");

// Parent login mode is decided by the server (PARENT_AUTH_MODE):
// "password" = school-issued login ID + password (current default);
// "otp" = mobile number + OTP (the original Phase 9 flow, kept intact
// and re-enabled any time by flipping that one server setting).
const parentMode = ref("password");
onMounted(async () => {
  const r = await api("/auth/config", { school: false }).catch(() => null);
  if (r && r.status === 200 && r.json.parentAuthMode) parentMode.value = r.json.parentAuthMode;
});

const staffTitle = computed(() => {
  if (variant === "teacher") return "Teacher Login";
  if (variant === "school") return "School Login";
  return "Staff Login";
});
const staffNote = computed(() => {
  if (variant === "teacher") return "Use the email & password given by your school office.";
  if (variant === "school") return "For the school admin, principal and office staff — use the email & password issued for your school.";
  return "For the school admin, principal and office staff — use the email & password given to you.";
});

async function sendOtp() {
  busy.value = true; error.value = ""; notice.value = "";
  const r = await api("/auth/parent-otp/request", { method: "POST", body: { phone: phone.value.trim() }, school: false }).catch(() => null);
  busy.value = false;
  if (!r) { error.value = "Network error. Try again."; return; }
  if (r.status === 202) {
    otpSent.value = true;
    demoCode.value = r.json.demoCode || "";
    notice.value = "If this number is registered with your school, an OTP has been sent. It is valid for 5 minutes.";
  } else if (r.status === 429) error.value = "Too many attempts. Wait a bit and try again.";
  else error.value = r.json.error === "INVALID_PHONE" ? "Enter a valid 10-digit mobile number." : "Could not send OTP.";
}

async function verifyOtp() {
  busy.value = true; error.value = "";
  const old = snapshotSession();
  const r = await loginWithOtp(phone.value.trim(), code.value.trim());
  busy.value = false;
  if (r.status !== 200) {
    error.value = r.json.error === "OTP_INVALID" ? "Wrong OTP. Check and try again."
      : r.json.error === "OTP_EXPIRED_OR_MISSING" ? "OTP expired. Tap Resend."
      : r.json.error === "NOT_WHITELISTED" ? "This number is not registered with any school. Ask the school office to add your mobile number."
      : `Login failed (${r.json.error || r.status})`;
    return;
  }
  await replaceOldSession(old);
  router.push("/parent");
}

async function submit() {
  busy.value = true;
  error.value = "";
  const old = snapshotSession();
  const r = await login(email.value.trim(), password.value);
  busy.value = false;
  if (r.status !== 200) {
    error.value = r.json.error === "INVALID_CREDENTIALS" ? "Wrong login ID or password." : `Login failed (${r.json.error || r.status})`;
    return;
  }
  // Role-locked pages (Phase 23): the credentials are valid but the
  // account belongs to a different audience — say so clearly instead
  // of silently landing on the wrong app. A wrong-page attempt is a
  // FAILED attempt: an existing session is restored untouched (with
  // no prior session, the just-created one is simply discarded).
  const roles = myMemberships().map((m) => m.role);
  const wrongPage = (msg) => { if (old.access) restoreSession(old); else session.clear(); error.value = msg; };
  if (variant === "parent" && !roles.includes("PARENT")) { wrongPage("This page is for parents only. Your account is not a parent account — please use the Teacher or School login page."); return; }
  if (variant === "teacher" && !roles.includes("TEACHER")) { wrongPage("This page is for teachers only. Your account does not have a teacher role."); return; }
  if (variant === "school" && !roles.some((x) => ["SCHOOL_ADMIN", "PRINCIPAL", "STAFF"].includes(x))) { wrongPage("This page is for the school office — admin, principal and staff. Teachers use the Teacher login page, parents use the Parent login page."); return; }
  // Success: the new account takes over — revoke the session it
  // replaced and land on the NEW role's home.
  await replaceOldSession(old);
  if (currentUser()?.isPlatformAdmin) { router.push("/console"); return; }
  router.push(myRole() === "PARENT" ? "/parent" : "/");
}
</script>

<template>
  <div class="min-h-dvh flex flex-col items-center justify-center p-4 bg-gradient-to-b from-[#0a2436] via-[#0b2e3f] to-[#07332a] safe-t safe-b">
    <div class="text-center text-white mb-6">
      <img src="/icons/icon-192.png" alt="Smart School" class="w-20 h-20 rounded-[22px] mx-auto shadow-2xl mb-3" />
      <div class="text-3xl font-extrabold tracking-tight">Smart School</div>
      <p class="text-sm text-white/60">Attendance & Communication</p>
    </div>
    <div class="card w-full max-w-sm !rounded-[28px] !p-6 shadow-2xl">
      <div v-if="signedInUser" class="mb-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
        <p class="text-sm text-blue-900">You are logged in as <b>{{ signedInUser.fullName }}</b><span v-if="signedInRole"> ({{ signedInRole }})</span></p>
        <div class="flex gap-2 mt-2">
          <button type="button" class="btn btn-primary flex-1 !py-2 !text-sm" @click="goDashboard">Go to my dashboard</button>
          <button type="button" class="btn btn-ghost flex-1 !py-2 !text-sm" @click="bannerLogout">Logout</button>
        </div>
        <p class="text-xs text-blue-700/70 mt-2">Or sign in below with a different account — it will replace this session.</p>
      </div>

      <div v-if="!locked" class="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-2xl mb-5">
        <button type="button" class="rounded-xl py-2 text-sm font-bold" :class="tab === 'parent' ? 'bg-white shadow text-blue-700' : 'text-slate-500'" @click="tab = 'parent'">👨‍👩‍👧 Parent</button>
        <button type="button" class="rounded-xl py-2 text-sm font-bold" :class="tab === 'staff' ? 'bg-white shadow text-green-700' : 'text-slate-500'" @click="tab = 'staff'">🧑‍🏫 Staff</button>
      </div>

      <!-- PARENT -->
      <template v-if="tab === 'parent'">
        <form v-if="parentMode === 'password'" @submit.prevent="submit">
          <div class="text-lg font-bold mb-1">Parent Login</div>
          <p class="text-sm text-slate-500 mb-4">Use the login ID & password given by your school office.</p>
          <label class="label">Login ID (email)</label>
          <input v-model="email" type="email" required class="input mb-3" placeholder="you@example.com" />
          <label class="label">Password</label>
          <input v-model="password" type="password" required class="input mb-4" placeholder="••••••••" />
          <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
          <button class="btn btn-primary w-full !py-3 !text-base" :disabled="busy">{{ busy ? "Signing in…" : "Sign in" }}</button>
        </form>

        <form v-else @submit.prevent="otpSent ? verifyOtp() : sendOtp()">
          <div class="text-lg font-bold mb-1">Parent Login</div>
          <p class="text-sm text-slate-500 mb-4">Use the mobile number given to your school. No password needed — we send an OTP.</p>
          <label class="label">Mobile number</label>
          <input v-model="phone" type="tel" inputmode="numeric" maxlength="13" required class="input mb-3 !text-lg tracking-wide" placeholder="10-digit mobile number" :disabled="otpSent" />
          <template v-if="otpSent">
            <label class="label">Enter OTP</label>
            <input v-model="code" type="text" inputmode="numeric" maxlength="6" required class="input mb-2 !text-2xl !tracking-[0.4em] text-center font-bold" placeholder="••••••" />
            <p v-if="demoCode" class="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 mb-3">Pilot demo OTP: <b>{{ demoCode }}</b> (real SMS will replace this in production)</p>
          </template>
          <p v-if="notice" class="text-sm text-brand-700 mb-3">{{ notice }}</p>
          <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
          <button class="btn btn-primary w-full !py-3 !text-base" :disabled="busy">{{ busy ? "Please wait…" : otpSent ? "Verify & Login" : "Send OTP" }}</button>
          <button v-if="otpSent" type="button" class="w-full text-sm text-slate-500 mt-3 underline" @click="otpSent = false; code = ''">Change number / Resend</button>
        </form>
      </template>

      <!-- STAFF / TEACHER -->
      <form v-else @submit.prevent="submit">
        <div class="text-lg font-bold mb-1">{{ staffTitle }}</div>
        <p class="text-sm text-slate-500 mb-4">{{ staffNote }}</p>
        <label class="label">Email</label>
        <input v-model="email" type="email" required class="input mb-3" placeholder="you@school.example" />
        <label class="label">Password</label>
        <input v-model="password" type="password" required class="input mb-4" placeholder="••••••••" />
        <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
        <button class="btn btn-primary w-full !py-3 !text-base" :disabled="busy">{{ busy ? "Signing in…" : "Sign in" }}</button>
      </form>

      <div v-if="locked" class="mt-5 pt-4 border-t border-slate-100 text-center text-sm text-slate-500">
        Not your page?
        <router-link v-if="variant !== 'parent'" class="underline font-semibold" to="/login/parent">Parent login</router-link><span v-if="variant !== 'parent'"> · </span>
        <router-link v-if="variant !== 'teacher'" class="underline font-semibold" to="/login/teacher">Teacher login</router-link><span v-if="variant !== 'teacher'"> · </span>
        <router-link v-if="variant !== 'school'" class="underline font-semibold" to="/login/school">School login</router-link>
      </div>
    </div>
    <p class="text-[11px] text-white/40 mt-5">Install: browser menu → “Add to Home screen”</p>
  </div>
</template>
