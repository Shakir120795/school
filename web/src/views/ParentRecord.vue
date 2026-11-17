<script setup>
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, session, fmtDate, friendlyError } from "../api.js";

// Phase 76: parent's full-record view for one child — the current
// year in detail (attendance, exam average + class rank, homework,
// PTM, functions, achievements) and previous years as one line
// each. Read-only; the API only ever serves a guardian-linked
// child to a parent session.
const route = useRoute();
const sid = session.schoolId;
const studentId = route.params.studentId;
const child = ref(null);
const record = ref(null);
const msg = ref("");

onMounted(async () => {
  const r = await api(`/schools/${sid}/my-children`).catch(() => null);
  child.value = (r?.json?.children || []).find((c) => c.id === studentId) || null;
  const res = await api(`/schools/${sid}/students/${studentId}/record`);
  if (res.status !== 200) {
    msg.value = friendlyError(res.json?.error) || "Record could not be loaded.";
    return;
  }
  record.value = res.json;
});
</script>

<template>
  <div>
    <router-link to="/parent" class="text-sm text-brand-700 font-semibold">← Back to home</router-link>
    <h1 class="text-2xl font-extrabold mt-2 mb-1">🏆 Full record</h1>
    <p v-if="child" class="text-slate-500 mb-3">{{ child.fullName }}<span v-if="child.classroom"> · Class {{ child.classroom.name }}{{ child.classroom.section ? "-" + child.classroom.section : "" }}</span></p>

    <p v-if="msg" class="card !py-2 text-sm text-rose-600 mb-3">{{ msg }}</p>

    <template v-if="record">
      <div class="card mb-4">
        <div class="font-semibold mb-3">This year<span v-if="record.currentYear"> — {{ record.currentYear.name }}</span></div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
          <div class="rounded-2xl bg-emerald-50 py-3 px-1"><div class="text-lg font-extrabold text-emerald-700">{{ record.currentYear?.attendance.percentage ?? "–" }}%</div><div class="text-[11px] text-slate-500 font-medium">ATTENDANCE</div></div>
          <div class="rounded-2xl bg-sky-50 py-3 px-1"><div class="text-lg font-extrabold text-sky-700">{{ record.currentYear?.exams.averagePct ?? "–" }}%<span v-if="record.currentYear?.exams.rank" class="text-xs font-bold text-slate-500"> · Rank {{ record.currentYear.exams.rank }}/{{ record.currentYear.exams.classSize }}</span></div><div class="text-[11px] text-slate-500 font-medium">EXAM AVERAGE</div></div>
          <div class="rounded-2xl bg-violet-50 py-3 px-1"><div class="text-lg font-extrabold text-violet-700">{{ record.currentYear?.homework.done ?? 0 }}/{{ record.currentYear?.homework.assigned ?? 0 }}</div><div class="text-[11px] text-slate-500 font-medium">HOMEWORK DONE<span v-if="record.currentYear?.homework.missed"> · {{ record.currentYear.homework.missed }} MISSED</span></div></div>
          <div class="rounded-2xl bg-amber-50 py-3 px-1"><div class="text-lg font-extrabold text-amber-700">{{ record.currentYear?.ptm.attended ?? 0 }}</div><div class="text-[11px] text-slate-500 font-medium">PTM ATTENDED<span v-if="record.currentYear?.ptm.upcoming"> · {{ record.currentYear.ptm.upcoming }} UPCOMING</span></div></div>
          <div class="rounded-2xl bg-rose-50 py-3 px-1"><div class="text-lg font-extrabold text-rose-700">{{ record.currentYear?.functions.attended ?? 0 }}/{{ record.currentYear?.functions.total ?? 0 }}</div><div class="text-[11px] text-slate-500 font-medium">FUNCTIONS ATTENDED</div></div>
        </div>
      </div>

      <div class="card mb-4">
        <div class="font-semibold mb-2">🏆 Achievements</div>
        <div v-if="record.currentYear?.achievements.length">
          <div v-for="a in record.currentYear.achievements" :key="a.id" class="py-2 border-b border-slate-100 last:border-0 text-sm">
            <span class="font-semibold">{{ a.title }}</span>
            <span class="text-slate-400 text-xs ml-2">{{ fmtDate(a.awardedOn) }}</span>
            <p v-if="a.note" class="text-slate-500 mt-0.5">{{ a.note }}</p>
          </div>
        </div>
        <p v-else class="text-sm text-slate-400">No achievements recorded this year yet.</p>
      </div>

      <div class="card mb-4">
        <div class="font-semibold mb-2">🎉 School functions</div>
        <div v-if="record.currentYear?.functions.items.length">
          <div v-for="f in record.currentYear.functions.items" :key="f.id" class="flex flex-wrap items-center gap-2 py-2 border-b border-slate-100 last:border-0 text-sm">
            <span class="font-medium">{{ f.title }}</span>
            <span class="text-slate-400 text-xs">{{ fmtDate(f.date) }}</span>
            <span v-if="!f.past" class="chip bg-slate-100 text-slate-500 ml-auto">Upcoming</span>
            <span v-else class="chip ml-auto" :class="f.attended ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ f.attended ? "✓ Attended" : "Not marked" }}</span>
          </div>
        </div>
        <p v-else class="text-sm text-slate-400">No school functions this year yet.</p>
      </div>

      <div v-if="record.previousYears.length" class="card">
        <div class="font-semibold mb-2">Previous years</div>
        <div v-for="y in record.previousYears" :key="y.name" class="text-sm py-1.5 border-b border-slate-100 last:border-0">
          <span class="font-semibold">{{ y.name }}</span>
          <span class="text-slate-500"> — Attendance {{ y.attendancePct ?? "–" }}% · Exam average {{ y.examAvgPct ?? "–" }}% · {{ y.achievements }} achievement{{ y.achievements === 1 ? "" : "s" }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
