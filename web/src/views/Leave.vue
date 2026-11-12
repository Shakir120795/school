<script setup>
import { onMounted, ref } from "vue";
import { api, session } from "../api.js";

// Leave (Phase 15). Parents apply for their children; class teachers
// and managers approve/reject. Approval marks ON_LEAVE in attendance.
const role = session.membership?.role;
const isStaff = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"].includes(role);
const isParent = role === "PARENT";
const sid = session.schoolId;
const msg = ref("");
const err = ref("");
const loading = ref(true);
const apps = ref([]);
const children = ref([]);
const form = ref({ studentId: "", fromDate: "", toDate: "", category: "SICK", reason: "" });
const notes = ref({});

// Phase 59 (audit UX): parent ko date-picker se dimag na lagana
// pade — ek tap par din, ek tap par wajah. Chips sirf form
// bharte hain; din/Date neeche wale khane me dikh jata hai.
function dayStr(plus = 0) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  now.setDate(now.getDate() + plus);
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
function quickDays(kind) {
  if (kind === "today") { form.value.fromDate = dayStr(0); form.value.toDate = dayStr(0); }
  if (kind === "tomorrow") { form.value.fromDate = dayStr(1); form.value.toDate = dayStr(1); }
  if (kind === "two") { form.value.fromDate = dayStr(0); form.value.toDate = dayStr(1); }
}
const REASON_CHIPS = [
  { label: "🤒 Sick", category: "SICK", text: "Sick — not feeling well" },
  { label: "🚑 Doctor visit", category: "SICK", text: "Doctor visit" },
  { label: "🏠 Family work", category: "FAMILY", text: "Family work at home" },
  { label: "🎉 Function / travel", category: "FUNCTION", text: "Family function / travel" },
];
function pickReason(r) { form.value.category = r.category; form.value.reason = r.text; }

const STATUS_CLS = {
  PENDING: "bg-amber-50 text-amber-600",
  APPROVED: "bg-emerald-50 text-emerald-600",
  REJECTED: "bg-rose-50 text-rose-600",
  CANCELLED: "bg-slate-100 text-slate-500",
};
const fmt = (d) => (d ? String(d).slice(0, 10) : "");

async function load() {
  loading.value = true;
  try {
    const r = await api(`/schools/${sid}/leave-applications`);
    if (r.status === 200) apps.value = r.json.applications;
    if (isParent) {
      const c = await api(`/schools/${sid}/my-children`);
      if (c.status === 200) {
        children.value = c.json.children || [];
        if (children.value.length) form.value.studentId = children.value[0].id;
      }
    }
  } finally {
    loading.value = false;
  }
}
async function apply() {
  err.value = ""; msg.value = "";
  const r = await api(`/schools/${sid}/leave-applications`, { method: "POST", body: form.value });
  if (r.status === 201) { msg.value = "Leave application sent. The school will review it."; form.value.reason = ""; await load(); }
  else err.value = r.json?.error || "Could not apply";
}
async function decide(app, decision) {
  err.value = ""; msg.value = "";
  const r = await api(`/schools/${sid}/leave-applications/${app.id}/decision`, {
    method: "PATCH", body: { decision, note: notes.value[app.id] || undefined },
  });
  if (r.status === 200) {
    msg.value = decision === "APPROVED"
      ? `Approved — ${r.json.appliedDays} day(s) marked ON LEAVE${r.json.skippedDays ? `, ${r.json.skippedDays} day(s) already had attendance and were left unchanged` : ""}. Parent notified.`
      : "Rejected. Parent notified.";
    await load();
  } else err.value = r.json?.error || "Decision failed";
}
async function cancel(app) {
  const r = await api(`/schools/${sid}/leave-applications/${app.id}/cancel`, { method: "PATCH" });
  if (r.status === 200) { msg.value = "Application cancelled."; await load(); }
  else err.value = r.json?.error || "Cancel failed";
}
onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">✉️ Leave</h1>
    <p class="text-sm text-slate-500 mb-4">{{ isParent ? "Apply for leave for your child — approved leave is marked ON LEAVE in attendance automatically." : "Review leave applications. Teachers see only their own classes." }}</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <form v-if="isParent" class="card grid gap-3 mb-5" @submit.prevent="apply">
      <div>
        <label class="label">Which day?</label>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-ghost !py-2" @click="quickDays('today')">Today</button>
          <button type="button" class="btn btn-ghost !py-2" @click="quickDays('tomorrow')">Tomorrow</button>
          <button type="button" class="btn btn-ghost !py-2" @click="quickDays('two')">Today + tomorrow</button>
          <span class="text-xs text-slate-400 self-center">— or pick dates below</span>
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="label">Child</label>
          <select v-model="form.studentId" class="input" required>
            <option v-for="c in children" :key="c.id" :value="c.id">{{ c.fullName }}</option>
          </select>
        </div>
        <div><label class="label">Category</label>
          <select v-model="form.category" class="input">
            <option value="SICK">Sick</option>
            <option value="FAMILY">Family work</option>
            <option value="FUNCTION">Function / travel</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div><label class="label">From</label><input v-model="form.fromDate" type="date" class="input" required /></div>
        <div><label class="label">To</label><input v-model="form.toDate" type="date" class="input" required /></div>
      </div>
      <div><label class="label">Reason</label>
        <div class="flex flex-wrap gap-2 mb-2">
          <button v-for="r in REASON_CHIPS" :key="r.label" type="button" class="btn btn-ghost !py-1.5 text-xs" @click="pickReason(r)">{{ r.label }}</button>
        </div>
        <textarea v-model="form.reason" class="input" rows="2" required placeholder="e.g. Fever since yesterday, doctor advised rest"></textarea></div>
      <button class="btn btn-primary">Apply for leave</button>
    </form>

    <div class="grid gap-3">
      <div v-for="a in apps" :key="a.id" class="card !py-3">
        <div class="flex flex-wrap items-start gap-2">
          <div class="min-w-0">
            <div class="font-semibold text-sm">{{ a.student.fullName }}
              <span class="text-slate-400 font-normal">· {{ a.student.admissionNo }} · Class {{ a.student.classroom?.name }}{{ a.student.classroom?.section ? "-" + a.student.classroom.section : "" }}</span>
            </div>
            <div class="text-sm text-slate-600">{{ fmt(a.fromDate) }} → {{ fmt(a.toDate) }} <span v-if="a.category" class="text-slate-400">· {{ a.category }}</span></div>
            <p class="text-sm text-slate-600 mt-0.5">{{ a.reason }}</p>
            <p v-if="a.decisionNote" class="text-xs text-slate-400 mt-0.5">School note: {{ a.decisionNote }}</p>
          </div>
          <span class="ml-auto text-xs font-bold px-2 py-1 rounded-full" :class="STATUS_CLS[a.status]">{{ a.status }}</span>
        </div>
        <div v-if="isStaff && a.status === 'PENDING'" class="flex flex-wrap gap-2 mt-2">
          <input v-model="notes[a.id]" class="input flex-1 min-w-[160px]" placeholder="Note (optional)" />
          <button class="btn btn-primary !py-1.5" @click="decide(a, 'APPROVED')">Approve</button>
          <button class="btn btn-ghost !py-1.5 text-red-600" @click="decide(a, 'REJECTED')">Reject</button>
        </div>
        <div v-if="isParent && a.status === 'PENDING'" class="mt-2">
          <button class="btn btn-ghost !py-1.5 text-red-600" @click="cancel(a)">Cancel application</button>
        </div>
      </div>
      <p v-if="loading" class="card text-sm text-slate-400 animate-pulse">Loading leave applications…</p>
      <p v-else-if="!apps.length" class="card text-sm text-slate-400">No leave applications.</p>
    </div>
  </div>
</template>
