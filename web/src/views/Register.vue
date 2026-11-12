<script setup>
// Register (Phase 66) — class-wise register book: har bacche ki
// fees ki haalat (asal Fees ledger se), exam fee, aur school kit
// (ID card / tie / belt / cap / bag) mila ya nahi. Kit ke tick
// yahi se lagte hain; fees sirf dikhti hai — paisa Fees page se
// bharta hai. Teacher ko sirf apni classes dikhti hain (server
// pehle se rok lagata hai).
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";

const KIT = [
  { key: "idCard", label: "ID Card", emoji: "🪪" },
  { key: "tie", label: "Tie", emoji: "👔" },
  { key: "belt", label: "Belt", emoji: "🎗️" },
  { key: "cap", label: "Cap", emoji: "🧢" },
  { key: "bag", label: "Bag", emoji: "🎒" },
];
const students = ref([]);
const classes = ref([]);
const classFilter = ref("");
const q = ref("");
const kitReady = ref(false);
const loading = ref(true);
const error = ref("");
const savingKey = ref("");

const classLabelOf = (c) => (c.section ? `${c.name}-${c.section}` : c.name);
const classKey = (label) => {
  const m = String(label || "").match(/(\d+)\s*-\s*(.+)/);
  return m ? [parseInt(m[1], 10), m[2]] : [999, String(label || "")];
};
const sorted = computed(() => [...students.value].sort((a, b) => {
  const [ga, sa] = classKey(a.classLabel); const [gb, sb] = classKey(b.classLabel);
  return ga - gb || String(sa).localeCompare(String(sb)) || a.fullName.localeCompare(b.fullName);
}));
const filtered = computed(() => sorted.value.filter((s) =>
  (!classFilter.value || s.classroomId === classFilter.value) &&
  (!q.value || `${s.fullName} ${s.admissionNo} ${s.classLabel}`.toLowerCase().includes(q.value.toLowerCase()))));
const due = (st) => st === "DUE" || st === "PARTIAL";
const counts = computed(() => ({
  total: filtered.value.length,
  feesDue: filtered.value.filter((s) => due(s.fees.status)).length,
  examDue: filtered.value.filter((s) => due(s.fees.examStatus)).length,
  cardPending: kitReady.value ? filtered.value.filter((s) => s.kit && !s.kit.idCard).length : null,
}));
const feeChip = (st) => st === "PAID" ? "bg-emerald-100 text-emerald-700"
  : st === "PARTIAL" ? "bg-amber-100 text-amber-700"
  : st === "DUE" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-400";
const feeText = (st) => st === "PAID" ? "✓ Paid" : st === "PARTIAL" ? "◐ Part paid" : st === "DUE" ? "✗ Due" : "—";

async function load() {
  loading.value = true; error.value = "";
  try {
    const sid = session.schoolId();
    const [r, c] = await Promise.all([
      api(`/schools/${sid}/register`),
      api(`/schools/${sid}/rollcall/classes`),
    ]);
    if (!r.ok) throw new Error(r.json.error || "load failed");
    students.value = r.json.students || [];
    kitReady.value = !!r.json.kitReady;
    classes.value = c.ok ? (c.json.classes || []) : [];
  } catch (e) { error.value = "Register load nahi hua — dobara try karo."; }
  loading.value = false;
}
async function toggleKit(s, field) {
  if (!kitReady.value || !s.kit || savingKey.value) return;
  const next = !s.kit[field];
  savingKey.value = s.id + field;
  try {
    const r = await api(`/schools/${session.schoolId()}/register/${s.id}/kit`, {
      method: "PATCH", body: { field, value: next },
    });
    if (r.ok) s.kit[field] = next;
    else if (r.json.error === "KIT_NOT_READY") kitReady.value = false;
  } finally { savingKey.value = ""; }
}
onMounted(load);
</script>

<template>
  <section>
    <div class="flex items-end justify-between gap-2 flex-wrap">
      <h1 class="text-xl font-extrabold">📋 Register</h1>
      <span class="text-xs text-slate-500">Kit ke tick yahi se lagao — fees sirf dikhti hai, paisa Fees page se bharta hai.</span>
    </div>

    <div v-if="error" class="card bg-rose-50 text-rose-600 text-sm font-semibold mt-3">{{ error }}</div>
    <div v-if="!kitReady && !loading" class="card bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold mt-3">
      ⚠️ Kit wale tick (card / tie / belt / cap / bag) abhi live nahi hain — owner Console se <b>Apply database updates</b> chala de to ye tick chalne lagenge. Fees ki haalat abhi bhi sahi dikhegi.
    </div>

    <div class="flex flex-wrap gap-1.5 mt-4">
      <button type="button" class="chip !px-3 !py-1.5 font-bold" :class="classFilter === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'" @click="classFilter = ''">All classes ({{ students.length }})</button>
      <button v-for="c in classes" :key="c.id" type="button" class="chip !px-3 !py-1.5 font-bold" :class="classFilter === c.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'" @click="classFilter = c.id">{{ classLabelOf(c) }}</button>
    </div>
    <input v-model="q" class="input mt-3" type="search" placeholder="Search student, admission no…" />

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
      <div class="card !mb-0 text-center"><div class="text-2xl font-extrabold">{{ counts.total }}</div><div class="text-xs text-slate-500 font-semibold">Students</div></div>
      <div class="card !mb-0 text-center"><div class="text-2xl font-extrabold text-rose-600">{{ counts.feesDue }}</div><div class="text-xs text-slate-500 font-semibold">Fees baaki</div></div>
      <div class="card !mb-0 text-center"><div class="text-2xl font-extrabold text-rose-600">{{ counts.examDue }}</div><div class="text-xs text-slate-500 font-semibold">Exam fee baaki</div></div>
      <div class="card !mb-0 text-center"><div class="text-2xl font-extrabold text-amber-600">{{ counts.cardPending === null ? "—" : counts.cardPending }}</div><div class="text-xs text-slate-500 font-semibold">ID card pending</div></div>
    </div>

    <div class="card mt-3 !p-0 overflow-hidden">
      <div v-if="loading" class="p-4 text-slate-500 text-sm animate-pulse">Loading register…</div>
      <div v-else-if="!filtered.length" class="p-4 text-slate-500 text-sm">Is class me koi student nahi mila.</div>
      <div v-for="s in filtered" :key="s.id" class="px-4 py-3 border-b border-slate-100 last:border-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-bold">{{ s.fullName }}</span>
          <span class="chip bg-slate-100 text-slate-500">{{ s.classLabel }}</span>
          <span class="text-xs text-slate-400">Adm. {{ s.admissionNo }}</span>
          <span class="ml-auto flex items-center gap-1.5 flex-wrap">
            <span class="chip font-bold" :class="feeChip(s.fees.status)">💳 Fees {{ feeText(s.fees.status) }}<span v-if="s.fees.balancePaise"> · ₹{{ Math.round(s.fees.balancePaise / 100) }} due</span></span>
            <span class="chip font-bold" :class="feeChip(s.fees.examStatus)">📝 Exam {{ feeText(s.fees.examStatus) }}</span>
          </span>
        </div>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <button v-for="k in KIT" :key="k.key" type="button"
            :disabled="!kitReady || savingKey === s.id + k.key"
            class="chip !px-2.5 !py-1.5 font-bold disabled:opacity-50"
            :class="s.kit && s.kit[k.key] ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'"
            @click="toggleKit(s, k.key)">{{ k.emoji }} {{ k.label }} {{ s.kit && s.kit[k.key] ? '✓' : '✗' }}</button>
        </div>
      </div>
    </div>
  </section>
</template>
