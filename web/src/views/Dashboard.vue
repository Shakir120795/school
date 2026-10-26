<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, session, myRole, currentUser } from "../api.js";
import ParentView from "./Parent.vue";
import PlatformDashboard from "./PlatformDashboard.vue";

const role = myRole();
const router = useRouter();
const sid = session.schoolId;
const user = currentUser();
const A = ref(null); // analytics
const notices = ref([]);
const holidays = ref([]);
const school = ref(null);
const loading = ref(true);
const holForm = ref({ localDate: "", name: "" });
const msg = ref("");

const isManager = ["SCHOOL_ADMIN", "PRINCIPAL"].includes(role);

// Phase 29 WS4: setup wizard (managers only). One aggregate call;
// a failed check leaves setup null and the card simply stays hidden
// rather than breaking the dashboard.
const setup = ref(null);
const setupLoading = ref(isManager);
const SETUP_STEPS = [
  { key: "academicYear", label: "Academic year created", hint: "Create your current academic year", to: "/settings" },
  { key: "classes", label: "Classes added", hint: "Add your first class", to: "/settings" },
  { key: "teachers", label: "Teachers added", hint: "Add teachers to your team", to: "/team" },
  { key: "students", label: "Students added", hint: "Add or import your students", to: "/people" },
  { key: "attendancePolicy", label: "Attendance policy set", hint: "Set entry and late timings", to: "/settings" },
  { key: "feeStructure", label: "Fee structure added", hint: "Set fees for a class", to: "/fees" },
];
async function loadSetup() {
  if (!isManager) return;
  try {
    const r = await api(`/schools/${sid}/setup-status`);
    if (r.status === 200) setup.value = r.json;
  } catch { /* wizard is best-effort; dashboard must not break */ }
  setupLoading.value = false;
}
const pct = computed(() => A.value?.today.attendancePct ?? 0);
const ring = computed(() => {
  const c = 2 * Math.PI * 34;
  return { c, off: c - (c * pct.value) / 100 };
});
const upcomingHolidays = computed(() =>
  holidays.value.filter((h) => h.localDate >= (A.value?.date || "")).slice(0, 5)
);

async function load() {
  const [a, n, h, s] = await Promise.all([
    api(`/schools/${sid}/analytics/today`),
    api(`/schools/${sid}/notices`),
    api(`/schools/${sid}/holidays`),
    api(`/schools/${sid}`),
  ]);
  if (a.status === 200) A.value = a.json;
  notices.value = (n.json.notices || []).slice(0, 5);
  holidays.value = h.json.holidays || [];
  school.value = s.json.school || null;
  loading.value = false;
}
async function addHoliday() {
  if (!holForm.value.localDate || !holForm.value.name) return;
  const r = await api(`/schools/${sid}/holidays`, { method: "POST", body: holForm.value });
  if (r.status === 201) {
    msg.value = "Holiday added.";
    holForm.value = { localDate: "", name: "" };
    const h = await api(`/schools/${sid}/holidays`);
    holidays.value = h.json.holidays || [];
  } else msg.value = r.json.error || "Could not add holiday.";
}
async function removeHoliday(id) {
  await api(`/schools/${sid}/holidays/${id}`, { method: "DELETE" });
  holidays.value = holidays.value.filter((x) => x.id !== id);
}
// The operator has no school context — the school dashboard below
// would render an empty page for them (Phase 27 complaint). They
// get the platform overview instead; school loading is skipped.
onMounted(() => { if (role !== "PARENT" && role !== "PLATFORM_ADMIN") { load(); loadSetup(); } else loading.value = false; });
</script>

<template>
  <PlatformDashboard v-if="role === 'PLATFORM_ADMIN'" />
  <ParentView v-else-if="role === 'PARENT'" />
  <div v-else>
    <!-- Header -->
    <div class="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">{{ school?.name || "Dashboard" }}</h1>
        <p class="text-sm text-slate-500">{{ A?.date || "" }} · Welcome back, {{ user?.fullName }} ({{ role }})</p>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn btn-ghost" @click="router.push('/attendance')">📋 Register</button>
        <button type="button" class="btn btn-primary" @click="router.push('/notices')">✉️ New notice</button>
      </div>
    </div>

    <!-- Phase 29 WS4: setup wizard — managers only, never blocks the dashboard -->
    <div v-if="isManager && setupLoading" class="card text-slate-500 mb-4">Checking your setup…</div>
    <div v-else-if="isManager && setup && setup.complete" class="card mb-4 py-3 text-sm font-semibold text-emerald-700">✅ School setup complete</div>
    <div v-else-if="isManager && setup" class="card mb-4">
      <h2 class="font-bold mb-1">🚀 Finish setting up your school</h2>
      <p class="text-sm text-slate-500 mb-3">Work through these steps to get your school fully running.</p>
      <div v-for="s in SETUP_STEPS" :key="s.key" class="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0 text-sm">
        <span v-if="setup.steps[s.key]?.done" class="text-emerald-600 font-bold">✓</span>
        <span v-else class="text-slate-300 font-bold">○</span>
        <span class="flex-1">
          <span class="font-semibold" :class="setup.steps[s.key]?.done ? 'text-slate-400 line-through' : ''">{{ s.label }}</span>
          <span v-if="!setup.steps[s.key]?.done" class="block text-xs text-slate-500">{{ s.hint }}</span>
        </span>
        <router-link v-if="!setup.steps[s.key]?.done" :to="s.to" class="text-brand-700 font-semibold shrink-0">Set up →</router-link>
      </div>
    </div>

    <div v-if="loading" class="card text-slate-500">Loading…</div>
    <template v-else-if="A">
      <!-- Stat row -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div class="card flex items-center gap-3">
          <svg class="w-[84px] h-[84px] -my-1" viewBox="0 0 84 84">
            <circle cx="42" cy="42" r="34" fill="none" stroke="#e2e8f0" stroke-width="9" />
            <circle cx="42" cy="42" r="34" fill="none" stroke="#0b8457" stroke-width="9" stroke-linecap="round"
              :stroke-dasharray="ring.c" :stroke-dashoffset="ring.off" transform="rotate(-90 42 42)" />
            <text x="42" y="47" text-anchor="middle" class="fill-slate-800" font-size="17" font-weight="800">{{ pct }}%</text>
          </svg>
          <div>
            <div class="text-2xl font-extrabold">{{ A.today.present + A.today.late }}<span class="text-slate-400 text-base">/{{ A.totals.students }}</span></div>
            <div class="text-xs text-slate-500 font-medium">Students present today</div>
          </div>
        </div>
        <div class="card flex items-center gap-3">
          <div class="stat-ico bg-amber-100">⏰</div>
          <div><div class="text-2xl font-extrabold text-amber-600">{{ A.today.late }}</div><div class="text-xs text-slate-500 font-medium">Late arrivals</div></div>
        </div>
        <div class="card flex items-center gap-3">
          <div class="stat-ico bg-rose-100">🚫</div>
          <div><div class="text-2xl font-extrabold text-rose-600">{{ A.today.absent }}</div><div class="text-xs text-slate-500 font-medium">Marked absent</div>
            <div class="text-[11px] text-slate-400">{{ A.today.notMarked }} not marked yet</div></div>
        </div>
        <div class="card flex items-center gap-3">
          <div class="stat-ico bg-sky-100">🧑‍🏫</div>
          <div><div class="text-2xl font-extrabold text-sky-700">{{ A.today.staffPresent }}<span class="text-slate-400 text-base">/{{ A.totals.teachers }}</span></div><div class="text-xs text-slate-500 font-medium">Staff checked in</div></div>
        </div>
      </div>

      <div class="grid lg:grid-cols-3 gap-4 items-start">
        <!-- Class-wise -->
        <div class="card lg:col-span-2">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-bold">{{ role === "TEACHER" ? "My classes today" : "Class-wise attendance" }}</h2>
            <router-link to="/attendance" class="text-sm text-brand-700 font-semibold">Open register →</router-link>
          </div>
          <div v-if="!A.classes.length" class="text-sm text-slate-500">No classes assigned yet.</div>
          <div v-for="c in A.classes" :key="c.id" class="py-2.5 border-b border-slate-100 last:border-0">
            <div class="flex justify-between text-sm mb-1">
              <span class="font-semibold">Class {{ c.name }}<span v-if="c.section">-{{ c.section }}</span></span>
              <span class="text-slate-500">{{ c.present + c.late }}/{{ c.total }} present · {{ c.absent }} absent</span>
            </div>
            <div class="bar"><div :style="{ width: (c.total ? ((c.present + c.late) / c.total) * 100 : 0) + '%' }"></div></div>
          </div>
          <div class="grid grid-cols-3 gap-3 mt-4 text-center">
            <div class="rounded-2xl bg-slate-50 py-3"><div class="text-lg font-extrabold">{{ A.totals.students }}</div><div class="text-[11px] text-slate-500 font-medium">STUDENTS</div></div>
            <div class="rounded-2xl bg-slate-50 py-3"><div class="text-lg font-extrabold">{{ A.totals.teachers }}</div><div class="text-[11px] text-slate-500 font-medium">TEACHERS</div></div>
            <div class="rounded-2xl bg-slate-50 py-3"><div class="text-lg font-extrabold">{{ A.totals.guardians }}</div><div class="text-[11px] text-slate-500 font-medium">PARENTS</div></div>
          </div>
        </div>

        <!-- Side column -->
        <div class="space-y-4">
          <div v-if="A.pendingCorrections || A.today.reviewFlags" class="card !bg-amber-50 !border-amber-200">
            <h3 class="font-bold text-amber-800 mb-1">Needs attention</h3>
            <p v-if="A.pendingCorrections" class="text-sm text-amber-700">{{ A.pendingCorrections }} correction request(s) waiting for approval.</p>
            <p v-if="A.today.reviewFlags" class="text-sm text-amber-700">{{ A.today.reviewFlags }} attendance record(s) flagged for review today.</p>
            <router-link to="/attendance" class="text-sm font-semibold text-amber-800">Review in register →</router-link>
          </div>

          <div class="card">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-bold">🏖️ Holidays</h3>
              <span class="text-[11px] text-slate-400">{{ holidays.length }} total</span>
            </div>
            <div v-if="!upcomingHolidays.length" class="text-sm text-slate-500 mb-2">No upcoming holidays.</div>
            <div v-for="h in upcomingHolidays" :key="h.id" class="flex items-center justify-between py-1.5 text-sm border-b border-slate-100 last:border-0">
              <span><span class="font-semibold">{{ h.name }}</span> <span class="text-slate-400">· {{ h.localDate }}</span></span>
              <button v-if="isManager" type="button" class="text-rose-500 text-xs font-semibold" @click="removeHoliday(h.id)">Remove</button>
            </div>
            <form v-if="isManager" class="grid grid-cols-2 gap-2 mt-3" @submit.prevent="addHoliday">
              <input v-model="holForm.localDate" type="date" class="input" required />
              <input v-model="holForm.name" class="input" placeholder="Holiday name" required />
              <button class="btn btn-primary col-span-2 !py-2">Add holiday</button>
            </form>
            <p v-if="msg" class="text-xs text-brand-700 mt-2">{{ msg }}</p>
          </div>

          <div class="card">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-bold">Recent notices</h3>
              <span class="chip bg-brand-50 text-brand-700">{{ A.noticesSent7d }} sent this week</span>
            </div>
            <div v-if="!notices.length" class="text-sm text-slate-500">No notices yet.</div>
            <div v-for="n in notices" :key="n.id" class="py-1.5 border-b border-slate-100 last:border-0 text-sm">
              <span class="chip mr-2" :class="n.status === 'SENT' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ n.status }}</span>
              <span class="font-medium">{{ n.title }}</span>
              <span class="block text-[11px] text-slate-400 ml-1">{{ n.audienceType.replaceAll("_", " ") }}</span>
            </div>
            <router-link to="/notices" class="text-sm text-brand-700 font-semibold">All notices →</router-link>
          </div>

          <div v-if="isManager" class="card">
            <h3 class="font-bold mb-2">Quick actions</h3>
            <div class="grid grid-cols-2 gap-2">
              <router-link to="/team" class="btn btn-ghost !py-2">🔐 Team & access</router-link>
              <router-link to="/people" class="btn btn-ghost !py-2">👥 Add people</router-link>
              <router-link to="/scanner" class="btn btn-ghost !py-2">▣ Gate scanner</router-link>
              <router-link to="/settings" class="btn btn-ghost !py-2">⚙ Settings</router-link>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
