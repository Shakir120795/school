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
  { to: "/notices", label: "Notices", icon: "✉", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"] },
  { to: "/parent", label: "My Children", icon: "🏠", roles: ["PARENT"] },
  { to: "/notices", label: "Notices", icon: "✉", roles: ["PARENT"] },
  { to: "/notifications", label: "Notifications", icon: "🔔", roles: ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"], badge: true },
  { to: "/settings", label: "Settings", icon: "⚙", roles: ["SCHOOL_ADMIN", "PRINCIPAL"] },
];
const nav = computed(() => NAV.filter((n) => n.roles.includes(role.value)));

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
  <div v-else class="min-h-screen md:flex">
    <!-- Desktop sidebar -->
    <aside class="hidden md:flex md:w-64 md:flex-col bg-ink-900 text-white p-5 gap-1">
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
    <header class="md:hidden sticky top-0 z-20 bg-ink-900 text-white px-4 py-3 flex items-center gap-3">
      <div class="font-bold">Smart School</div>
      <div class="ml-auto text-xs">{{ user?.fullName }} · {{ role }}</div>
      <button class="text-sm underline" @click="logout">Logout</button>
    </header>

    <main class="flex-1 p-4 md:p-6 pb-24 md:pb-6 max-w-6xl mx-auto w-full">
      <div v-if="memberships.length > 1" class="mb-4 flex items-center gap-2">
        <span class="label !mb-0">School</span>
        <select class="input !w-auto" :value="session.schoolId" @change="switchSchool($event.target.value)">
          <option v-for="m in memberships" :key="m.schoolId" :value="m.schoolId">{{ m.schoolId }} ({{ m.role }})</option>
        </select>
      </div>
      <router-view />
    </main>

    <!-- Mobile bottom nav -->
    <nav class="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 flex justify-around py-2">
      <router-link v-for="n in nav.slice(0, 5)" :key="n.to + n.label" :to="n.to"
        class="flex flex-col items-center text-[11px] px-2" :class="route.path === n.to ? 'text-brand-700 font-semibold' : 'text-slate-500'">
        <span class="text-lg leading-none">{{ n.icon }}</span>{{ n.label.split(" ")[0] }}
      </router-link>
    </nav>
  </div>
</template>
