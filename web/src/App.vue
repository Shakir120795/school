<script setup>
import { computed, onMounted, ref } from "vue";
import { initPush } from "./push.js";
const schoolInfo = ref(null);
const unreadCount = ref(0);
onMounted(async () => {
  initPush();
  if (session.schoolId) {
    const sres = await api(`/schools/${session.schoolId}`).catch(() => null);
    if (sres?.json?.school) schoolInfo.value = sres.json.school;
    const nres = await api(`/schools/${session.schoolId}/my-notifications`).catch(() => null);
    if (nres?.json) unreadCount.value = nres.json.unread || 0;
  }
});
import { useRoute, useRouter } from "vue-router";
import { session, currentUser, myRole, myMemberships, api } from "./api.js";

const route = useRoute();
const router = useRouter();
const role = computed(() => myRole());
const user = computed(() => currentUser());
const memberships = computed(() => myMemberships());
const isLogin = computed(() => route.path === "/login");

const NAV = [
  { to: "/", label: "Dashboard", icon: "▦", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PLATFORM_ADMIN"] },
  { to: "/people", label: "Students & Staff", icon: "👥", roles: ["SCHOOL_ADMIN", "PRINCIPAL"] },
  { to: "/attendance", label: "Attendance", icon: "✓", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"] },
  { to: "/scanner", label: "Gate Scanner", icon: "▣", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF"] },
  { to: "/pickup", label: "Pickup", icon: "🛡️", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"] },
  { to: "/rollcall", label: "Roll-Call", icon: "📋", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"] },
  { to: "/homework", label: "Homework", icon: "📚", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT"] },
  { to: "/leave", label: "Leave", icon: "✉️", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "PARENT"] },
  { to: "/fees", label: "Fees", icon: "💳", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "STAFF", "PARENT"] },
  { to: "/timetable", label: "Timetable", icon: "🗓️", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"] },
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
</script>

<template>
  <div v-if="isLogin"><router-view /></div>
  <div v-else class="min-h-screen md:flex" :style="themeStyle">
    <!-- Desktop sidebar -->
    <aside class="hidden md:flex md:w-64 md:flex-col bg-gradient-to-b from-[#0a2436] via-[#0b2e3f] to-[#07332a] text-white p-5 gap-1">
      <div class="mb-6">
        <img v-if="schoolInfo?.logoUrl" :src="schoolInfo.logoUrl" alt="School logo" class="w-10 h-10 rounded-lg object-contain bg-white mb-2" />
        <div class="text-lg font-bold">{{ schoolInfo?.name || "Smart School" }}</div>
        <div class="text-xs text-slate-300">Attendance & Communication</div>
      </div>
      <router-link v-for="n in nav" :key="n.to + n.label" :to="n.to"
        class="rounded-xl px-3 py-2.5 text-sm hover:bg-white/10"
        :class="route.path === n.to ? 'bg-white/15 font-semibold' : ''">
        <span class="mr-2">{{ n.icon }}</span>{{ n.label }}<span v-if="n.badge && unreadCount" class="ml-2 bg-red-600 text-white text-[10px] rounded-full px-1.5 py-0.5">{{ unreadCount }}</span>
      </router-link>
      <div class="mt-auto text-xs text-slate-300">
        <div class="font-semibold text-white">{{ user?.fullName }}</div>
        <div>{{ role }}</div>
        <button class="btn btn-ghost mt-3 w-full !py-2" @click="logout">Logout</button>
      </div>
    </aside>

    <!-- Mobile top bar -->
    <header class="md:hidden sticky top-0 z-20 safe-t bg-gradient-to-r from-[#0a2436] to-[#07332a] text-white px-4 py-3 flex items-center gap-3 shadow">
      <img v-if="schoolInfo?.logoUrl" :src="schoolInfo.logoUrl" alt="" class="w-8 h-8 rounded-lg object-contain bg-white" />
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

    <main class="flex-1 p-4 md:p-6 pb-28 md:pb-6 max-w-6xl mx-auto w-full">
      <div v-if="memberships.length > 1" class="mb-4 flex items-center gap-2">
        <span class="label !mb-0">School</span>
        <select class="input !w-auto" :value="session.schoolId" @change="switchSchool($event.target.value)">
          <option v-for="m in memberships" :key="m.schoolId" :value="m.schoolId">{{ m.schoolId }} ({{ m.role }})</option>
        </select>
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
