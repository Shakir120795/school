<script setup>
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, session, fmtDate, friendlyError } from "../api.js";

const route = useRoute();
const sid = session.schoolId;
const studentId = route.params.studentId;
const child = ref(null);
const hist = ref(null);
const msg = ref("");
const from = ref("");
const to = ref("");

function dayStr(d) { return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }
function fmt(t) {
  if (!t) return "—";
  return new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}
function statusLabel(s) {
  return { ON_LEAVE: "On leave", HALF_DAY: "Half day" }[s] || s;
}
function statusBadge(s) {
  return {
    PRESENT: "bg-green-100 text-green-700",
    LATE: "bg-amber-100 text-amber-700",
    ABSENT: "bg-red-100 text-red-700",
    ON_LEAVE: "bg-blue-100 text-blue-700",
    HALF_DAY: "bg-purple-100 text-purple-700",
  }[s] || "bg-slate-100 text-slate-600";
}
function monthLabel(m) {
  return new Date(`${m}-02T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}
async function load() {
  msg.value = "";
  const q = new URLSearchParams();
  if (from.value) q.set("from", from.value);
  if (to.value) q.set("to", to.value);
  const r = await api(`/schools/${sid}/students/${studentId}/attendance-history?${q}`);
  if (r.status !== 200) { msg.value = friendlyError(r.json?.error) || "Attendance could not be loaded."; return; }
  hist.value = r.json;
  from.value = r.json.from;
  to.value = r.json.to;
}
function quick(kind) {
  const now = new Date();
  to.value = dayStr(now);
  if (kind === "month") {
    from.value = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  } else if (kind === "3m") {
    const d = new Date(now); d.setMonth(d.getMonth() - 3); from.value = dayStr(d);
  } else {
    const d = new Date(now); d.setFullYear(d.getFullYear() - 1); from.value = dayStr(d);
  }
  load();
}
onMounted(async () => {
  const r = await api(`/schools/${sid}/my-children`).catch(() => null);
  child.value = (r?.json?.children || []).find((c) => c.id === studentId) || null;
  quick("year");
});
</script>

<template>
  <div>
    <router-link to="/parent" class="text-sm text-brand-700 font-semibold">← Back to home</router-link>
    <h1 class="text-2xl font-extrabold mt-2 mb-1">📅 Attendance history</h1>
    <p v-if="child" class="text-slate-500 mb-3">{{ child.fullName }}<span v-if="child.classroom"> · Class {{ child.classroom.name }}{{ child.classroom.section ? "-" + child.classroom.section : "" }}</span></p>

    <div class="card mb-4">
      <div class="flex flex-wrap gap-2 items-center">
        <button type="button" class="btn btn-ghost !py-1.5" @click="quick('month')">This month</button>
        <button type="button" class="btn btn-ghost !py-1.5" @click="quick('3m')">Last 3 months</button>
        <button type="button" class="btn btn-ghost !py-1.5" @click="quick('year')">Full year</button>
        <input v-model="from" type="date" class="input !w-40" />
        <span class="text-slate-400 text-sm">to</span>
        <input v-model="to" type="date" class="input !w-40" />
        <button type="button" class="btn btn-primary !py-1.5" @click="load">Show</button>
      </div>
      <p class="text-xs text-slate-400 mt-2">Pick any two dates to see exactly that period — up to one full year.</p>
    </div>

    <p v-if="msg" class="card !py-2 text-sm text-rose-600 mb-3">{{ msg }}</p>

    <template v-if="hist">
      <div class="card mb-4">
        <div class="flex flex-wrap gap-2">
          <span class="chip bg-brand-50 text-brand-700 font-bold text-base !px-3 !py-1">{{ hist.summary.percentage ?? "–" }}% attendance</span>
          <span class="chip bg-green-100 text-green-700">Present {{ hist.summary.present }}</span>
          <span class="chip bg-amber-100 text-amber-700">Late {{ hist.summary.late }}</span>
          <span class="chip bg-red-100 text-red-700">Absent {{ hist.summary.absent }}</span>
          <span class="chip bg-blue-100 text-blue-700">Leave {{ hist.summary.onLeave }}</span>
          <span class="chip bg-purple-100 text-purple-700">Half day {{ hist.summary.halfDay }}</span>
          <span class="chip bg-slate-100 text-slate-500">{{ hist.summary.marked }} days marked</span>
        </div>
      </div>

      <div v-if="hist.months.length" class="card mb-4">
        <div class="font-semibold mb-2">Month by month</div>
        <div v-for="m in hist.months" :key="m.month" class="flex flex-wrap gap-2 items-center text-sm py-2 border-b border-slate-100 last:border-0">
          <span class="font-semibold w-24">{{ monthLabel(m.month) }}</span>
          <span class="font-bold" :class="m.percentage >= 75 ? 'text-emerald-600' : 'text-rose-600'">{{ m.percentage ?? "–" }}%</span>
          <span class="text-slate-500">Present {{ m.present }} · Late {{ m.late }} · Absent {{ m.absent }} · Leave {{ m.onLeave }} · Half {{ m.halfDay }}</span>
        </div>
      </div>

      <div class="card">
        <div class="font-semibold mb-2">Every day</div>
        <div v-for="d in hist.days" :key="d.localDate" class="flex flex-wrap gap-2 items-center text-sm py-2 border-b border-slate-100 last:border-0">
          <span class="w-28 font-medium">{{ fmtDate(d.localDate) }}</span>
          <span class="badge" :class="statusBadge(d.status)">{{ statusLabel(d.status) }}</span>
          <span v-if="d.entryAt" class="text-slate-500">In {{ fmt(d.entryAt) }}</span>
          <span v-if="d.exitAt" class="text-slate-500">Out {{ fmt(d.exitAt) }}</span>
          <span v-if="d.isEarlyExit" class="text-xs text-amber-600">left early</span>
        </div>
        <p v-if="!hist.days.length" class="text-sm text-slate-400 py-2">No attendance marked in this period.</p>
      </div>
    </template>
  </div>
</template>
