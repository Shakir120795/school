<script setup>
import { onMounted, ref, computed } from "vue";
import { api, session, myRole } from "../api.js";

const role = myRole();
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const loading = ref(true);
const students = ref([]);
const staff = ref([]);
const notices = ref([]);
const studentsTotal = ref(0);
const loadError = ref("");

const present = computed(() => students.value.filter((s) => ["PRESENT", "LATE"].includes(s.status)).length);
const late = computed(() => students.value.filter((s) => s.status === "LATE").length);
const absent = computed(() => students.value.filter((s) => s.status === "ABSENT").length);
const flagged = computed(() => students.value.filter((s) => s.reviewFlag).length);
const staffPresent = computed(() => staff.value.filter((s) => ["PRESENT", "LATE"].includes(s.status)).length);

onMounted(async () => {
  if (role === "PARENT") { loading.value = false; return; }
  const sid = session.schoolId;
  const [a, b, c, d] = await Promise.all([
    api(`/schools/${sid}/attendance/students?date=${today}`),
    api(`/schools/${sid}/attendance/staff?date=${today}`),
    api(`/schools/${sid}/notices`),
    api(`/schools/${sid}/students`),
  ]);
  if (a.status !== 200) loadError.value = a.json.error || "Failed to load";
  students.value = a.json.attendance || [];
  staff.value = b.json.attendance || [];
  notices.value = (c.json.notices || []).slice(0, 5);
  studentsTotal.value = (d.json.students || []).length;
  loading.value = false;
});
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">Today — {{ today }}</h1>
    <p class="text-sm text-slate-500 mb-4">School overview (school timezone)</p>
    <p v-if="loadError" class="text-red-600 text-sm mb-3">{{ loadError }}</p>
    <div v-if="loading" class="text-slate-500">Loading…</div>
    <template v-else-if="role !== 'PARENT'">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div class="card"><div class="text-3xl font-bold">{{ present }}<span class="text-base text-slate-400">/{{ studentsTotal }}</span></div><div class="text-sm text-slate-500">Students present</div></div>
        <div class="card"><div class="text-3xl font-bold text-amber-600">{{ late }}</div><div class="text-sm text-slate-500">Late arrivals</div></div>
        <div class="card"><div class="text-3xl font-bold text-red-600">{{ absent }}</div><div class="text-sm text-slate-500">Marked absent</div></div>
        <div class="card"><div class="text-3xl font-bold">{{ staffPresent }}</div><div class="text-sm text-slate-500">Staff checked in</div></div>
      </div>
      <div v-if="flagged" class="card mb-4 border-amber-300 bg-amber-50">
        <b>{{ flagged }}</b> attendance record(s) have review flags (out-of-window / missing entry). Check the Attendance tab.
      </div>
      <div class="card">
        <div class="font-semibold mb-2">Recent notices</div>
        <div v-if="!notices.length" class="text-sm text-slate-500">No notices yet.</div>
        <div v-for="n in notices" :key="n.id" class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
          <span class="badge" :class="n.status === 'SENT' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'">{{ n.status }}</span>
          <span class="text-sm font-medium">{{ n.title }}</span>
          <span class="text-xs text-slate-400 ml-auto">{{ n.audienceType.replaceAll("_", " ") }}</span>
        </div>
      </div>
    </template>
    <div v-else class="card">Welcome! Use <b>My Children</b> to see attendance and teachers.</div>
  </div>
</template>
