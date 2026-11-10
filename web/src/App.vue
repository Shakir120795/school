<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { initPush } from "./push.js";
const schoolInfo = ref(null);
const unreadCount = ref(0);
// Phase 44 (per-login branding): school ki pehchan (logo/naam) har
// login par usi school ki dikhti hai; parent par student bhi upar.
// schoolInfo pehle sirf onMounted par banta tha — school switch ya
// dusri ID se sign-in par purani pehchan atki rehti thi. Ab branding
// loader schoolId badalte hi dobara chalta hai (route watch se).
const myChildren = ref([]);
const loadedSchoolId = ref(null);
// School selector me kachchi ID ki jagah school ka NAAM dikhe —
// naam /schools/mine se aate hain (login wale memberships me sirf
// ID hoti hai). Phase 45: map me logo + childrenCount bhi —
// parent ke school cards ke liye.
const schoolInfoById = ref({});
const TILE_COLORS = ["#0b8457", "#2563eb", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#b91c1c", "#0f766e"];
function tileColor(name) { let h = 0; for (const ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return TILE_COLORS[h % TILE_COLORS.length]; }
function initialsOf(name) { return String(name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }
function childClass(c) { return c?.classroom ? `Class ${c.classroom.name}${c.classroom.section ? "-" + c.classroom.section : ""}` : ""; }
async function loadBranding() {
  const sidNow = session.schoolId;
  if (!sidNow) { schoolInfo.value = null; myChildren.value = []; loadedSchoolId.value = null; return; }
  loadedSchoolId.value = sidNow;
  const sres = await api(`/schools/${sidNow}`).catch(() => null);
  if (sres?.json?.school) schoolInfo.value = sres.json.school;
  // Phase 45b: pichli baar ka map pehle paint par hi dikha do —
  // school switch (reload) par ek pal ke liye kachchi ID aur
  // "No children linked" flash hota tha. Server se taza map
  // aate hi cache bhi update ho jata hai.
  try {
    const cached = JSON.parse(localStorage.getItem("ss_school_info_v1") || "null");
    if (cached && !Object.keys(schoolInfoById.value).length) schoolInfoById.value = cached;
  } catch { /* cache kharab ho to ignore */ }
  const mres = await api("/schools/mine", { school: false }).catch(() => null);
  if (mres?.json?.memberships) {
    const map = {};
    for (const m of mres.json.memberships) {
      if (m.school?.id) map[m.school.id] = { name: m.school.name, logoUrl: m.school.logoUrl || null, childrenCount: m.childrenCount || 0 };
    }
    schoolInfoById.value = map;
    try { localStorage.setItem("ss_school_info_v1", JSON.stringify(map)); } catch { /* storage full ho to ignore */ }
  }
  if (myRole() === "PARENT") {
    const cres = await api(`/schools/${sidNow}/my-children`).catch(() => null);
    myChildren.value = cres?.json?.children || [];
  } else {
    myChildren.value = [];
  }
}
onMounted(async () => {
  initPush();
  if (!route.meta.public) pruneDeadActiveAccount();
  await loadBranding();
  if (session.schoolId) {
    const nres = await api(`/schools/${session.schoolId}/my-notifications`).catch(() => null);
    if (nres?.json) unreadCount.value = nres.json.unread || 0;
  }
});
import { useRoute, useRouter } from "vue-router";
import { lang, setLang, availableLangs } from "./i18n.js";
import { session, currentUser, myRole, myMemberships, api, pruneDeadActiveAccount } from "./api.js";
import { installState, promptInstall } from "./install.js";

// PWA install banner (Phase 41): shown until the app is installed
// or the user dismisses it on this device.
const installDismissed = ref(localStorage.getItem("ss_install_dismissed") === "1");
const iosHelp = ref(false);
async function doInstall() { await promptInstall(); }
function dismissInstall() { installDismissed.value = true; localStorage.setItem("ss_install_dismissed", "1"); }

const route = useRoute();
const router = useRouter();
// The session helpers read storage, which Vue cannot track — without
// a nudge the shell (name/role in the sidebar) keeps showing the
// PREVIOUS account after an in-app sign-in until a full reload
// (seen live in the Phase 30 multi-tab test). Re-read on navigation.
const navTick = ref(0);
watch(() => route.fullPath, () => {
  navTick.value += 1;
  // Phase 44: dusri ID/school par gaye to branding bhi badlo.
  if (session.schoolId !== loadedSchoolId.value) loadBranding();
});
const role = computed(() => { void navTick.value; return myRole(); });
const user = computed(() => { void navTick.value; return currentUser(); });
const memberships = computed(() => { void navTick.value; return myMemberships(); });
// Public routes (all login variants) render bare — never wrapped in
// the app shell. (Was an exact "/login" match: /login/staff opened
// inside the sidebar of whoever was still logged in.)
const isLogin = computed(() => route.meta.public === true);

const NAV = [
  { to: "/", label: "Dashboard", icon: "▦", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PLATFORM_ADMIN"] },
  { to: "/students", label: "My Students", icon: "🎓", roles: ["TEACHER"] },
  { to: "/people", label: "Students & Staff", icon: "👥", roles: ["SCHOOL_ADMIN", "PRINCIPAL"] },
  { to: "/attendance", label: "Attendance", icon: "✓", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"] },
  { to: "/scanner", label: "Gate Scanner", icon: "▣", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF"] },
  { to: "/pickup", label: "Pickup", icon: "🛡️", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"] },
  { to: "/rollcall", label: "Roll-Call", icon: "📋", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"] },
  { to: "/homework", label: "Homework", icon: "📚", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT"] },
  { to: "/leave", label: "Leave", icon: "✉️", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT"] },
  { to: "/fees", label: "Fees", icon: "💳", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "STAFF", "PARENT"] },
  { to: "/timetable", label: "Timetable", icon: "🗓️", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"] },
  { to: "/exams", label: "Exams", icon: "📝", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT"] },
  { to: "/data", label: "Import/Export", icon: "📥", roles: ["SCHOOL_ADMIN", "PRINCIPAL"] },
  { to: "/console", label: "Super Admin", icon: "👑", roles: ["PLATFORM_ADMIN"] },
  { to: "/support", label: "Support & PTM", icon: "🎫", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"] },
  { to: "/notices", label: "Notices", icon: "✉", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"] },
  { to: "/parent", label: "My Children", icon: "🏠", roles: ["PARENT"] },
  { to: "/notices", label: "Notices", icon: "✉", roles: ["PARENT"] },
  { to: "/notifications", label: "Notifications", icon: "🔔", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"], badge: true },
  { to: "/team", label: "Team & Access", icon: "🔐", roles: ["SCHOOL_ADMIN", "PRINCIPAL"] },
  { to: "/settings", label: "Settings", icon: "⚙", roles: ["SCHOOL_ADMIN", "PRINCIPAL"] },
];
const nav = computed(() => NAV.filter((n) => n.roles.includes(role.value)));
// Role themes from the UI reference: Parent = blue, Teacher = green,
// Admin/Principal = navy blue. Brand utilities read these CSS vars.
const THEME_VARS = {
  PARENT: { "--brand-50": "#eff6ff", "--brand-100": "#dbeafe", "--brand-500": "#3b82f6", "--brand-600": "#2563eb", "--brand-700": "#1d4ed8" },
  TEACHER: { "--brand-50": "#f0fdf4", "--brand-100": "#dcfce7", "--brand-500": "#22c55e", "--brand-600": "#16a34a", "--brand-700": "#15803d" },
  STAFF: { "--brand-50": "#f0fdfa", "--brand-100": "#ccfbf1", "--brand-500": "#14b8a6", "--brand-600": "#0d9488", "--brand-700": "#0f766e" },
  SCHOOL_ADMIN: { "--brand-50": "#eef4ff", "--brand-100": "#dbe4ff", "--brand-500": "#2563eb", "--brand-600": "#1e40af", "--brand-700": "#1e3a8a" },
  PRINCIPAL: { "--brand-50": "#eef4ff", "--brand-100": "#dbe4ff", "--brand-500": "#2563eb", "--brand-600": "#1e40af", "--brand-700": "#1e3a8a" },
};
const themeStyle = computed(() => THEME_VARS[role.value] || {});
const mobileNav = computed(() => {
  const items = nav.value.slice(0, 5);
  const scanIdx = items.findIndex((n) => n.to === "/scanner");
  if (scanIdx > -1 && items.length === 5) {
    const [scan] = items.splice(scanIdx, 1);
    items.splice(2, 0, scan); // center slot
  }
  return items;
});

async function logout() {
  await api("/auth/logout", { method: "POST", body: {} }).catch(() => {});
  session.clear();
  router.push("/login");
}
function switchSchool(id) {
  session.setSchool(id);
  location.reload();
}
// Phase 41: every ID can be signed in on this device (one per
// tab), but there is deliberately NO account switcher anywhere —
// an account opens only by signing in with its own credentials.
</script>

<template>
  <!-- The bare (public) router-view is keyed by fullPath: every
       /login* route renders the SAME Login.vue component, and Vue
       Router would otherwise REUSE the mounted instance when moving
       between login routes — Login.vue reads its variant once in
       setup (const variant = route.meta.variant), so the URL changed
       but the chooser/form on screen stayed frozen until a manual
       refresh. The key forces a fresh mount per login URL, so the
       correct variant (and signed-in banner state) renders
       instantly. The shell's router-view below stays UNKEYED, so
       in-app navigation never remounts the shell. -->
  <div v-if="isLogin"><router-view :key="route.fullPath" /></div>
  <div v-else class="min-h-screen md:flex" :style="themeStyle">
    <!-- Phase 44 watermark: har school login par peeche halka sa
         usi school ka logo (na ho to naam) — print me kabhi nahi. -->
    <div v-if="schoolInfo && role !== 'PLATFORM_ADMIN'" aria-hidden="true" class="pointer-events-none fixed inset-0 md:left-64 z-0 flex items-center justify-center overflow-hidden print:hidden">
      <img v-if="schoolInfo.logoUrl" :src="schoolInfo.logoUrl" alt="" class="w-[380px] h-[380px] max-w-[80vw] object-contain opacity-[0.07]" />
      <div v-else class="text-6xl md:text-7xl font-black text-[#0a2436] opacity-[0.06] text-center leading-tight px-6 select-none">{{ schoolInfo.name }}</div>
    </div>
    <!-- Desktop sidebar -->
    <aside class="hidden md:flex md:w-64 md:flex-col bg-gradient-to-b from-[#0a2436] via-[#0b2e3f] to-[#07332a] text-white p-5 gap-1">
      <div class="mb-6">
        <img v-if="schoolInfo?.logoUrl" :src="schoolInfo.logoUrl" alt="School logo" class="w-10 h-10 rounded-lg object-contain bg-white mb-2" />
        <span v-else-if="schoolInfo" class="grid place-items-center w-10 h-10 rounded-lg text-white text-sm font-bold mb-2" :style="{ background: tileColor(schoolInfo.name) }">{{ initialsOf(schoolInfo.name) }}</span>
        <div class="text-lg font-bold">{{ schoolInfo?.name || "Smart School" }}</div>
        <div class="text-xs text-slate-300">Attendance & Communication</div>
      </div>
      <router-link v-for="n in nav" :key="n.to + n.label" :to="n.to"
        class="rounded-xl px-3 py-2.5 text-sm hover:bg-white/10"
        :class="route.path === n.to ? 'bg-white/15 font-semibold' : ''">
        <span class="mr-2">{{ n.icon }}</span>{{ n.label }}<span v-if="n.badge && unreadCount" class="ml-2 bg-red-600 text-white text-[10px] rounded-full px-1.5 py-0.5">{{ unreadCount }}</span>
      </router-link>
      <div class="mt-auto text-xs text-slate-300">
        <div class="mb-3">
          <div class="text-[11px] uppercase tracking-wide text-slate-400 mb-1">🌐 Language</div>
          <select :value="lang" class="input !py-1.5 !text-xs" @change="setLang($event.target.value)">
            <option v-for="l in availableLangs" :key="l.code" :value="l.code">{{ l.label }}</option>
          </select>
        </div>
        <div class="font-semibold text-white">{{ user?.fullName }}</div>
        <div>{{ role }}</div>
        <button class="btn btn-ghost mt-3 w-full !py-2" @click="logout">Logout</button>
      </div>
    </aside>

    <!-- Mobile top bar -->
    <header class="md:hidden sticky top-0 z-20 safe-t bg-gradient-to-r from-[#0a2436] to-[#07332a] text-white px-4 py-3 flex items-center gap-3 shadow">
      <img v-if="schoolInfo?.logoUrl" :src="schoolInfo.logoUrl" alt="" class="w-8 h-8 rounded-lg object-contain bg-white" />
      <span v-else-if="schoolInfo" class="grid place-items-center w-8 h-8 rounded-lg text-white text-[11px] font-bold shrink-0" :style="{ background: tileColor(schoolInfo.name) }">{{ initialsOf(schoolInfo.name) }}</span>
      <div class="min-w-0">
        <div class="font-bold leading-tight truncate">{{ schoolInfo?.name || "Smart School" }}</div>
        <div class="text-[11px] text-white/60 leading-tight">{{ role }}</div>
      </div>
      <router-link to="/notifications" class="relative ml-auto text-xl p-1" aria-label="Notifications">🔔
        <span v-if="unreadCount" class="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full min-w-4 h-4 px-0.5 grid place-items-center">{{ unreadCount }}</span>
      </router-link>
      <div class="avatar w-8 h-8 text-xs bg-white/20">{{ (user?.fullName || "?").split(" ").map((w) => w[0]).slice(0, 2).join("") }}</div>
      <button class="text-xs underline text-white/80" @click="logout">Logout</button>
    </header>

    <main class="relative z-10 flex-1 p-4 md:p-6 pb-28 md:pb-6 max-w-6xl mx-auto w-full">
      <!-- Phase 45: parent ke liye bade school cards — har school
           ka naam + uske bacche wahan kitne; school SIRF tap par
           badalta hai, apne aap kabhi nahi. -->
      <div v-if="role === 'PARENT' && memberships.length > 1" class="mb-4">
        <div class="text-xs font-bold text-slate-500 mb-2">🏫 YOUR SCHOOLS — TAP TO OPEN</div>
        <div class="grid gap-2">
          <button v-for="m in memberships" :key="m.schoolId" type="button" @click="switchSchool(m.schoolId)"
            class="flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-left shadow-sm"
            :class="m.schoolId === session.schoolId ? 'border-brand-600 ring-2 ring-brand-100' : 'border-slate-200'">
            <img v-if="schoolInfoById[m.schoolId]?.logoUrl" :src="schoolInfoById[m.schoolId].logoUrl" class="w-10 h-10 rounded-xl object-contain bg-white border shrink-0" alt="" />
            <span v-else class="grid place-items-center w-10 h-10 rounded-xl text-white text-xs font-bold shrink-0" :style="{ background: tileColor(schoolInfoById[m.schoolId]?.name || '?') }">{{ initialsOf(schoolInfoById[m.schoolId]?.name || '?') }}</span>
            <span class="min-w-0 flex-1">
              <span class="block font-bold truncate">{{ schoolInfoById[m.schoolId]?.name || m.schoolId }}</span>
              <span class="block text-xs text-slate-500">{{ schoolInfoById[m.schoolId]?.childrenCount ? `Your ${schoolInfoById[m.schoolId].childrenCount} child${schoolInfoById[m.schoolId].childrenCount === 1 ? "" : "ren"} in this school` : "No children linked yet" }}</span>
            </span>
            <span v-if="m.schoolId === session.schoolId" class="chip bg-brand-600 text-white shrink-0">Open now</span>
            <span v-else class="text-brand-700 font-bold text-sm shrink-0">Open →</span>
          </button>
        </div>
      </div>
      <div v-else-if="memberships.length > 1" class="mb-4 flex items-center gap-2">
        <span class="label !mb-0">School</span>
        <select class="input !w-auto" :value="session.schoolId" @change="switchSchool($event.target.value)">
          <option v-for="m in memberships" :key="m.schoolId" :value="m.schoolId">{{ schoolInfoById[m.schoolId]?.name || m.schoolId }} ({{ m.role }})</option>
        </select>
      </div>
      <div v-if="(installState === 'available' || installState === 'ios' || installState === 'menu') && !installDismissed" class="mb-4 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 flex flex-wrap items-center gap-2">
        <span class="text-sm">📲 <b>Use Smart School like an app</b> — add it to your home screen and open it without the browser.</span>
        <button v-if="installState === 'available'" class="btn btn-primary !py-1.5 !w-auto ml-auto" @click="doInstall">Install App</button>
        <button v-else class="btn btn-primary !py-1.5 !w-auto ml-auto" @click="iosHelp = !iosHelp">How to install?</button>
        <button class="btn btn-ghost !py-1.5 !w-auto" aria-label="Dismiss" @click="dismissInstall">✕</button>
        <p v-if="installState === 'ios' && iosHelp" class="w-full text-xs text-slate-600 mt-1">On iPhone/iPad (Safari): tap the <b>Share</b> button → choose <b>“Add to Home Screen”</b> → tap <b>Add</b>. The Smart School icon will appear on your home screen.</p>
        <p v-if="installState === 'menu' && iosHelp" class="w-full text-xs text-slate-600 mt-1">Open your browser menu (<b>⋮</b>) and tap <b>“Install app”</b> (or <b>“Add to Home screen”</b>). On a computer, you can also click the install icon at the right end of the address bar. The Smart School icon will then open the app directly.</p>
      </div>
      <!-- Phase 44: parent strip — parent ko upar hi apna school
           aur apne bachche (naam + class) dikhte hain. -->
      <div v-if="role === 'PARENT' && schoolInfo" class="mb-4 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 flex items-center gap-3">
        <img v-if="schoolInfo.logoUrl" :src="schoolInfo.logoUrl" class="w-11 h-11 rounded-xl object-contain bg-white border shrink-0" alt="" />
        <span v-else class="grid place-items-center w-11 h-11 rounded-xl text-white font-bold shrink-0" :style="{ background: tileColor(schoolInfo.name) }">{{ initialsOf(schoolInfo.name) }}</span>
        <div class="min-w-0">
          <div class="font-bold truncate">{{ schoolInfo.name }}</div>
          <div v-if="myChildren.length" class="text-xs text-slate-500 truncate">🎓 {{ myChildren.map((c) => c.fullName + (childClass(c) ? " · " + childClass(c) : "")).join("   •   ") }}</div>
          <div v-else class="text-xs text-slate-400">Parent account</div>
        </div>
      </div>
      <router-view />
    </main>

    <!-- Mobile bottom nav -->
    <nav class="md:hidden fixed bottom-0 inset-x-0 z-20 safe-b bg-white/95 backdrop-blur border-t border-slate-200 flex justify-around items-end px-1 pt-1.5">
      <router-link v-for="n in mobileNav" :key="n.to + n.label" :to="n.to"
        class="relative flex flex-col items-center gap-0.5 text-[10px] font-medium px-2.5 py-1.5 rounded-2xl min-w-14"
        :class="route.path === n.to ? 'text-brand-700' : 'text-slate-500'">
        <span v-if="n.to === '/scanner'"
          class="grid place-items-center w-12 h-12 -mt-7 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white text-2xl shadow-lg shadow-emerald-600/30 border-4 border-white">{{ n.icon }}</span>
        <span v-else class="text-[22px] leading-none py-1 px-3 rounded-full" :class="route.path === n.to ? 'bg-brand-50' : ''">{{ n.icon }}</span>
        {{ n.label.split(" ")[0] }}
        <span v-if="n.badge && unreadCount" class="absolute top-0.5 right-1.5 bg-red-600 text-white text-[9px] font-bold rounded-full min-w-4 h-4 px-0.5 grid place-items-center">{{ unreadCount }}</span>
      </router-link>
    </nav>
  </div>
</template>
