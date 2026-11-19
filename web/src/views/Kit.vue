<script setup>
// Kit (Phase 77) — school kit ki poori mapping ek jagah: kis bacche
// ko kaunsi cheez mili, kisko kya baaki hai. Items: ID card, tie,
// belt, cap, bag, books, dress (uniform). Tick Register wale hi API
// se lagte hain (ek hi data, do jagah entry nahi). Teacher ko sirf
// apni classes dikhti hain — server pehle se rok lagata hai.
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";

const KIT = [
  { key: "idCard", label: "ID Card", emoji: "🪪" },
  { key: "tie", label: "Tie", emoji: "👔" },
  { key: "belt", label: "Belt", emoji: "🎗️" },
  { key: "cap", label: "Cap", emoji: "🧢" },
  { key: "bag", label: "Bag", emoji: "🎒" },
  { key: "books", label: "Books", emoji: "📚" },
  { key: "dress", label: "Dress", emoji: "👕" },
];
const students = ref([]);
const classes = ref([]);
const classFilter = ref("");
const q = ref("");
const pendingItem = ref(""); // jis item ke "nahi mile" wale bacche dekhne hain
const kitReady = ref(false);
const loading = ref(true);
const error = ref("");
const msg = ref("");
const savingKey = ref("");
const bulkBusy = ref(false);

const classLabelOf = (c) => (c.section ? `${c.name}-${c.section}` : c.name);
const classKey = (label) => {
  const m = String(label || "").match(/(\d+)\s*-\s*(.+)/);
  return m ? [parseInt(m[1], 10), m[2]] : [999, String(label || "")];
};
const sorted = computed(() => [...students.value].sort((a, b) => {
  const [ga, sa] = classKey(a.classLabel); const [gb, sb] = classKey(b.classLabel);
  return ga - gb || String(sa).localeCompare(String(sb)) || a.fullName.localeCompare(b.fullName);
}));
const inClass = computed(() => sorted.value.filter((s) => !classFilter.value || s.classroomId === classFilter.value));
const filtered = computed(() => inClass.value.filter((s) =>
  (!q.value || `${s.fullName} ${s.admissionNo} ${s.classLabel}`.toLowerCase().includes(q.value.toLowerCase())) &&
  (!pendingItem.value || (s.kit && !s.kit[pendingItem.value]))));
const itemStats = computed(() => KIT.map((k) => {
  const got = inClass.value.filter((s) => s.kit && s.kit[k.key]).length;
  return { ...k, got, total: inClass.value.length, pending: inClass.value.length - got };
}));
const fullKitCount = computed(() => inClass.value.filter((s) => s.kit && KIT.every((k) => s.kit[k.key])).length);
const activeItem = computed(() => KIT.find((k) => k.key === pendingItem.value) || null);
const activeClass = computed(() => classes.value.find((c) => c.id === classFilter.value) || null);

async function load() {
  loading.value = true; error.value = "";
  try {
    const sid = session.schoolId;
    const [r, c] = await Promise.all([
      api(`/schools/${sid}/kit`),
      api(`/schools/${sid}/rollcall/classes`),
    ]);
    if (!r.ok) throw new Error(r.json.error || "load failed");
    students.value = r.json.students || [];
    kitReady.value = !!r.json.kitReady;
    classes.value = c.ok ? (c.json.classes || []) : [];
  } catch (e) { error.value = "Kit ki list load nahi hui — dobara try karo."; }
  loading.value = false;
}
async function toggleKit(s, field) {
  if (!kitReady.value || !s.kit || savingKey.value) return;
  const next = !s.kit[field];
  savingKey.value = s.id + field;
  try {
    const r = await api(`/schools/${session.schoolId}/register/${s.id}/kit`, {
      method: "PATCH", body: { field, value: next },
    });
    if (r.ok) s.kit[field] = next;
    else if (r.json.error === "KIT_NOT_READY") kitReady.value = false;
  } finally { savingKey.value = ""; }
}
async function bulk(value) {
  if (!activeItem.value || !activeClass.value || bulkBusy.value) return;
  const label = `${activeItem.value.emoji} ${activeItem.value.label}`;
  const what = value ? `${label} is class ke SAB baccho ko de diya jayega` : `${label} is class ke sab baccho se wapas (not received) ho jayega`;
  if (!window.confirm(`${what} — pakka?`)) return;
  bulkBusy.value = true; msg.value = "";
  try {
    const r = await api(`/schools/${session.schoolId}/kit/bulk`, {
      method: "PATCH",
      body: { classroomId: activeClass.value.id, field: activeItem.value.key, value },
    });
    if (r.ok) {
      for (const s of students.value) {
        if (s.classroomId === activeClass.value.id && s.kit) s.kit[activeItem.value.key] = value;
      }
      msg.value = `✓ Ho gaya — ${r.json.updated} baccho par ${label} ${value ? "lag gaya" : "hat gaya"}.`;
    } else {
      msg.value = "Bulk update nahi hua — dobara try karo.";
    }
  } finally { bulkBusy.value = false; }
}
function pickItem(key) {
  pendingItem.value = pendingItem.value === key ? "" : key;
}
onMounted(load);
</script>

<template>
  <section>
    <div class="flex items-end justify-between gap-2 flex-wrap">
      <h1 class="text-xl font-extrabold">🎒 School Kit</h1>
      <span class="text-xs text-slate-500">Kis bacche ko kya mila, kisko kya baaki hai — poori mapping ek jagah.</span>
    </div>

    <div v-if="error" class="card bg-rose-50 text-rose-600 text-sm font-semibold mt-3">{{ error }}</div>
    <div v-if="msg" class="card bg-emerald-50 text-emerald-700 text-sm font-semibold mt-3">{{ msg }}</div>
    <div v-if="!kitReady && !loading" class="card bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold mt-3">
      ⚠️ Kit wale tick abhi live nahi hain — owner Console se <b>Apply database updates</b> chala de to ye tick chalne lagenge.
    </div>

    <div class="flex flex-wrap gap-1.5 mt-4">
      <button type="button" class="chip !px-3 !py-1.5 font-bold" :class="classFilter === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'" @click="classFilter = ''">All classes ({{ students.length }})</button>
      <button v-for="c in classes" :key="c.id" type="button" class="chip !px-3 !py-1.5 font-bold" :class="classFilter === c.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'" @click="classFilter = c.id">{{ classLabelOf(c) }}</button>
    </div>
    <input v-model="q" class="input mt-3" type="search" placeholder="Search student, admission no…" />

    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
      <div class="card !mb-0 text-center"><div class="text-2xl font-extrabold">{{ inClass.length }}</div><div class="text-xs text-slate-500 font-semibold">Students</div></div>
      <div class="card !mb-0 text-center"><div class="text-2xl font-extrabold text-emerald-600">{{ fullKitCount }}</div><div class="text-xs text-slate-500 font-semibold">Poora kit mila</div></div>
      <div class="card !mb-0 text-center"><div class="text-2xl font-extrabold text-amber-600">{{ inClass.length - fullKitCount }}</div><div class="text-xs text-slate-500 font-semibold">Kuch na kuch baaki</div></div>
    </div>

    <div class="mt-4">
      <div class="text-xs font-bold text-slate-500 mb-1.5">ITEM-WISE HAALAT — kisi item par tap karo, sirf wahi bacche dikhenge jinhe wo <u>nahi</u> mila:</div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="k in itemStats" :key="k.key" type="button"
          class="chip !px-3 !py-2 font-bold"
          :class="pendingItem === k.key ? 'bg-amber-500 text-white' : k.pending === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
          @click="pickItem(k.key)">{{ k.emoji }} {{ k.label }} · {{ k.got }}/{{ k.total }} mile<span v-if="k.pending"> · {{ k.pending }} baaki</span><span v-else> ✓</span></button>
      </div>
    </div>

    <div v-if="activeItem && activeClass" class="card bg-brand-50 border border-brand-100 mt-3 flex flex-wrap items-center gap-2">
      <span class="text-sm font-bold text-brand-800">{{ activeItem.emoji }} {{ activeItem.label }} — Class {{ classLabelOf(activeClass) }}:</span>
      <button type="button" class="btn btn-primary !py-1.5" :disabled="bulkBusy || !kitReady" @click="bulk(true)">✓ Sab ko de diya</button>
      <button type="button" class="btn btn-ghost !py-1.5" :disabled="bulkBusy || !kitReady" @click="bulk(false)">Sab se wapas lo</button>
    </div>
    <p v-else-if="activeItem" class="text-xs text-slate-400 mt-2">Bulk lagane ke liye upar se ek class bhi chun lo.</p>

    <div class="card mt-3 !p-0 overflow-hidden">
      <div v-if="loading" class="p-4 text-slate-500 text-sm animate-pulse">Loading kit…</div>
      <div v-else-if="!filtered.length" class="p-4 text-slate-500 text-sm">
        {{ activeItem ? `Is list me sab ko ${activeItem.label} mil chuka hai 🎉` : "Is class me koi student nahi mila." }}
      </div>
      <div v-for="s in filtered" :key="s.id" class="px-4 py-3 border-b border-slate-100 last:border-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-bold">{{ s.fullName }}</span>
          <span class="chip bg-slate-100 text-slate-500">{{ s.classLabel }}</span>
          <span class="text-xs text-slate-400">Adm. {{ s.admissionNo }}</span>
          <span v-if="s.kit && KIT.every((k) => s.kit[k.key])" class="chip bg-emerald-100 text-emerald-700 font-bold ml-auto">🎉 Poora kit</span>
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
