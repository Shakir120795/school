<script setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, currentUser } from "../api.js";

// Platform overview for the operator (Phase 27) — what the owner
// sees on "/" instead of an empty school dashboard: the WHOLE
// platform in one place. Totals are computed from GET
// /platform/schools, which already returns per-school counts.
// Management (members, suspend, delete…) stays in /console —
// clicking a school card goes there.
const router = useRouter();
const user = currentUser();
const schools = ref([]);
const loading = ref(true);
const err = ref("");

const totals = computed(() => {
  const t = { schools: schools.value.length, active: 0, suspended: 0, students: 0, teachers: 0, parents: 0, classes: 0 };
  for (const s of schools.value) {
    if (s.status === "ACTIVE") t.active++;
    else if (s.status === "SUSPENDED") t.suspended++;
    t.students += s.students || 0;
    t.teachers += s.teachers || 0;
    t.parents += s.parents || 0;
    t.classes += s.classes || 0;
  }
  return t;
});

async function load() {
  const r = await api("/platform/schools", { school: false });
  if (r.status === 200) schools.value = r.json.schools || [];
  else err.value = r.json?.error || "Could not load platform data";
  loading.value = false;
}
onMounted(load);
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">👑 Platform Dashboard</h1>
        <p class="text-sm text-slate-500">Platform overview · Welcome back, {{ user?.fullName }} (PLATFORM_ADMIN)</p>
      </div>
      <button type="button" class="btn btn-primary" @click="router.push('/console')">Open Super Admin Console →</button>
    </div>

    <div v-if="loading" class="card text-slate-500">Loading platform data…</div>
    <p v-else-if="err" class="card text-sm text-red-700 !bg-red-50 !border-red-200">{{ err }}</p>

    <template v-else>
      <!-- Platform totals -->
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <div class="card">
          <div class="text-3xl font-extrabold">{{ totals.schools }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Schools</div>
          <div class="text-[11px] text-slate-400 mt-1">{{ totals.active }} active · {{ totals.suspended }} suspended</div>
        </div>
        <div class="card">
          <div class="text-3xl font-extrabold">🎓 {{ totals.students }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Students</div>
        </div>
        <div class="card">
          <div class="text-3xl font-extrabold">👩‍🏫 {{ totals.teachers }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Teachers</div>
        </div>
        <div class="card">
          <div class="text-3xl font-extrabold">👨‍👩‍👧 {{ totals.parents }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Parents</div>
        </div>
        <div class="card">
          <div class="text-3xl font-extrabold">🏫 {{ totals.classes }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Classes</div>
        </div>
      </div>

      <h2 class="font-bold mb-3">Schools</h2>
      <p v-if="!schools.length" class="card text-sm text-slate-400">No schools yet — create the first one in the Super Admin Console.</p>
      <div class="grid md:grid-cols-2 gap-3">
        <button
          v-for="s in schools"
          :key="s.id"
          type="button"
          class="card text-left w-full hover:border-brand-300 transition"
          @click="router.push('/console')"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-lg font-bold">{{ s.name }}</span>
            <span class="text-xs text-slate-400">{{ s.slug }}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto" :class="s.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'">{{ s.status }}</span>
          </div>
          <div class="flex flex-wrap gap-2 mt-3 text-xs">
            <span class="chip bg-slate-100 text-slate-600">🎓 {{ s.students }} students</span>
            <span class="chip bg-slate-100 text-slate-600">👩‍🏫 {{ s.teachers }} teachers</span>
            <span class="chip bg-slate-100 text-slate-600">👨‍👩‍👧 {{ s.parents }} parents</span>
            <span class="chip bg-slate-100 text-slate-600">🏫 {{ s.classes }} classes</span>
          </div>
          <div class="text-sm text-slate-500 mt-3">
            Admin: <span class="font-medium text-slate-700">{{ s.adminName || "—" }}</span>
            <span v-if="s.adminEmail"> · {{ s.adminEmail }}</span>
          </div>
          <div class="text-[11px] text-slate-400 mt-1">Since {{ String(s.createdAt).slice(0, 10) }} · Tap to manage in the Console →</div>
        </button>
      </div>
    </template>
  </div>
</template>
