<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";

// Teacher class roll-call (Phase 13): mark the class for today.
// Gate entry times stay visible — a child who scanned in shows their
// gate time, and marking them absent flags the conflict on save.
const sid = session.schoolId;
const classes = ref([]);
const classroomId = ref("");
const roster = ref([]);
const marks = ref({}); // studentId -> status
const msg = ref("");
const err = ref("");
const saving = ref(false);
const STATUSES = [
  { v: "PRESENT", label: "Present", cls: "bg-emerald-500" },
  { v: "LATE", label: "Late", cls: "bg-amber-500" },
  { v: "ABSENT", label: "Absent", cls: "bg-rose-500" },
  { v: "ON_LEAVE", label: "Leave", cls: "bg-violet-500" },
];

async function loadClasses() {
  const r = await api(`/schools/${sid}/rollcall/classes`);
  if (r.status === 200) {
    classes.value = r.json.classes;
    if (classes.value.length && !classroomId.value) {
      classroomId.value = classes.value[0].id;
      await loadRoster();
    }
  }
}
async function loadRoster() {
  roster.value = []; marks.value = {};
  if (!classroomId.value) return;
  const r = await api(`/schools/${sid}/rollcall/roster?classroomId=${classroomId.value}`);
  if (r.status === 200) {
    roster.value = r.json.roster;
    for (const row of roster.value) {
      if (row.attendance?.status) marks.value[row.student.id] = row.attendance.status;
    }
  } else err.value = r.json?.error || "Could not load the class roster";
}
function allPresent() {
  for (const row of roster.value) marks.value[row.student.id] = "PRESENT";
}
const counts = computed(() => {
  const c = { PRESENT: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0, unmarked: 0 };
  for (const row of roster.value) {
    const m = marks.value[row.student.id];
    if (m) c[m]++; else c.unmarked++;
  }
  return c;
});
async function save() {
  err.value = ""; msg.value = ""; saving.value = true;
  const payload = Object.entries(marks.value).map(([studentId, status]) => ({ studentId, status }));
  if (!payload.length) { err.value = "Mark at least one student first."; saving.value = false; return; }
  const r = await api(`/schools/${sid}/rollcall`, { method: "POST", body: { classroomId: classroomId.value, marks: payload } });
  saving.value = false;
  if (r.status === 200) {
    msg.value = `Saved ${r.json.saved} marks.` +
      (r.json.absentAlerts ? ` ${r.json.absentAlerts} absent alert(s) sent to parents.` : "") +
      (r.json.conflicts?.length ? ` ⚠️ Conflict: ${r.json.conflicts.map((c) => c.name).join(", ")} marked absent but had a gate entry — flagged for review.` : "");
    await loadRoster();
  } else err.value = r.json?.error || "Save failed";
}
onMounted(loadClasses);
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">📋 Class Roll-Call</h1>
    <p class="text-sm text-slate-500 mb-4">Mark today's attendance for your class. This writes the same register the gate scanner uses — entry times are never changed.</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <div class="card mb-4 flex flex-wrap items-end gap-3">
      <div class="flex-1 min-w-[180px]">
        <label class="label">Class</label>
        <select v-model="classroomId" class="input" @change="loadRoster">
          <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}{{ c.section ? "-" + c.section : "" }}</option>
        </select>
      </div>
      <button class="btn btn-ghost" @click="allPresent" :disabled="!roster.length">Mark all present</button>
      <div class="text-sm text-slate-500">
        <span class="text-emerald-600 font-semibold">{{ counts.PRESENT }} present</span> ·
        <span class="text-amber-600 font-semibold">{{ counts.LATE }} late</span> ·
        <span class="text-rose-600 font-semibold">{{ counts.ABSENT }} absent</span> ·
        <span class="text-violet-600 font-semibold">{{ counts.ON_LEAVE }} leave</span>
        <span v-if="counts.unmarked"> · {{ counts.unmarked }} unmarked</span>
      </div>
    </div>

    <div v-if="!classes.length" class="card text-sm text-slate-400">No classes are assigned to you yet. Ask the school admin to assign your class.</div>

    <div class="grid gap-2">
      <div v-for="row in roster" :key="row.student.id" class="card !py-3 flex flex-wrap items-center gap-3">
        <img v-if="row.student.photoUrl" :src="row.student.photoUrl" alt="" class="w-10 h-10 rounded-full object-cover" />
        <span v-else class="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center font-bold text-brand-700">{{ row.student.fullName.slice(0, 1) }}</span>
        <div class="min-w-[140px]">
          <div class="font-semibold text-sm">{{ row.student.fullName }}</div>
          <div class="text-xs text-slate-400">
            {{ row.student.admissionNo }}<span v-if="row.student.rollNo"> · Roll {{ row.student.rollNo }}</span>
            <span v-if="row.attendance?.entryAt" class="text-emerald-600"> · Gate in {{ new Date(row.attendance.entryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
          </div>
        </div>
        <div class="ml-auto flex gap-1.5">
          <button v-for="s in STATUSES" :key="s.v" type="button"
            class="px-3 py-1.5 rounded-full text-xs font-bold border transition"
            :class="marks[row.student.id] === s.v ? s.cls + ' text-white border-transparent' : 'bg-white text-slate-500 border-slate-200'"
            @click="marks[row.student.id] = s.v">{{ s.label }}</button>
        </div>
      </div>
    </div>

    <div v-if="roster.length" class="sticky bottom-20 md:bottom-4 mt-4">
      <button class="btn btn-primary w-full !py-3 shadow-lg" :disabled="saving" @click="save">{{ saving ? "Saving…" : "Save roll-call" }}</button>
    </div>
  </div>
</template>
