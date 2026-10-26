<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";

// Fees (Phase 16). Office: set up heads + class structures, generate a
// period's invoices, record payments (receipt numbers are automatic),
// waive when needed. Parents: their children's invoices, balances and
// payment history (receipts). Amounts cross the API in rupees; the
// server stores paise.
const role = session.membership?.role;
const isParent = role === "PARENT";
const isManager = ["SCHOOL_ADMIN", "PRINCIPAL"].includes(role);
const sid = session.schoolId;
const msg = ref("");
const err = ref("");
const loading = ref(true);
const summary = ref(null);
const invoices = ref([]);
const myInvoices = ref([]);
const classes = ref([]);
const heads = ref([]);
const structures = ref([]);
const gen = ref({ classroomId: "", periodLabel: "", dueDate: "", frequency: "MONTHLY" });
const newHead = ref("");
const newStruct = ref({ classroomId: "", feeHeadId: "", amountRupees: "", frequency: "MONTHLY" });
const payForms = ref({});
const expanded = ref(null);
const detail = ref(null);
const classFilter = ref("");
const STATUS_CLS = { UNPAID: "bg-rose-50 text-rose-600", PARTIAL: "bg-amber-50 text-amber-600", PAID: "bg-emerald-50 text-emerald-600", WAIVED: "bg-slate-100 text-slate-500" };
const inr = (paise) => "₹" + ((paise || 0) / 100).toLocaleString("en-IN");

async function loadStaff() {
  loading.value = true;
  try {
  const [s, inv, c, h, st] = await Promise.all([
    api(`/schools/${sid}/fees/summary`),
    api(`/schools/${sid}/fees/invoices${classFilter.value ? `?classroomId=${classFilter.value}` : ""}`),
    api(`/schools/${sid}/rollcall/classes`),
    api(`/schools/${sid}/fee-heads`),
    api(`/schools/${sid}/fee-structures`),
  ]);
  if (s.status === 200) summary.value = s.json;
  if (inv.status === 200) invoices.value = inv.json.invoices;
  if (c.status === 200) { classes.value = c.json.classes; if (classes.value.length) { gen.value.classroomId = classes.value[0].id; newStruct.value.classroomId = classes.value[0].id; } }
  if (h.status === 200) { heads.value = h.json.heads; if (heads.value.length) newStruct.value.feeHeadId = heads.value[0].id; }
  if (st.status === 200) structures.value = st.json.structures;
  } finally {
    loading.value = false;
  }
}
async function loadParent() {
  loading.value = true;
  try {
    const r = await api(`/schools/${sid}/fees/my-invoices`);
    if (r.status === 200) myInvoices.value = r.json.invoices;
  } finally {
    loading.value = false;
  }
}
async function generate() {
  err.value = ""; msg.value = "";
  const r = await api(`/schools/${sid}/fees/generate`, { method: "POST", body: gen.value });
  if (r.status === 201) { msg.value = `Generated ${r.json.created} invoice(s) (${inr(r.json.totalPaise)} each)${r.json.skipped ? `, ${r.json.skipped} already existed` : ""}.`; await loadStaff(); }
  else err.value = r.json?.error || "Generation failed";
}
async function addHead() {
  if (!newHead.value.trim()) return;
  const r = await api(`/schools/${sid}/fee-heads`, { method: "POST", body: { name: newHead.value.trim() } });
  if (r.status === 201) { newHead.value = ""; await loadStaff(); } else err.value = r.json?.error || "Could not add head";
}
async function addStruct() {
  const r = await api(`/schools/${sid}/fee-structures`, { method: "POST", body: { ...newStruct.value, amountRupees: Number(newStruct.value.amountRupees) } });
  if (r.status === 201) { msg.value = "Fee structure saved."; await loadStaff(); } else err.value = r.json?.error || "Could not save structure";
}
async function pay(inv) {
  const f = payForms.value[inv.id];
  if (!f?.amountRupees) return;
  err.value = ""; msg.value = "";
  const r = await api(`/schools/${sid}/fees/invoices/${inv.id}/payments`, { method: "POST", body: { amountRupees: Number(f.amountRupees), method: f.method || "CASH", reference: f.reference || undefined } });
  if (r.status === 201) { msg.value = `Payment recorded — receipt ${r.json.payment.receiptNo}. Parent notified.`; payForms.value[inv.id] = {}; await loadStaff(); }
  else err.value = r.json?.error || "Payment failed";
}
async function waive(inv) {
  if (!confirm(`Waive invoice "${inv.title}" for ${inv.student.fullName}? Payments already recorded stay in the ledger.`)) return;
  const r = await api(`/schools/${sid}/fees/invoices/${inv.id}/waive`, { method: "PATCH" });
  if (r.status === 200) { msg.value = "Invoice waived."; await loadStaff(); } else err.value = r.json?.error || "Waive failed";
}
// Phase 29 WS7: one-click defaulter reminders (managers only).
// Preview first so the confirm dialog carries exact counts/amounts.
const remindBusy = ref(false);
async function remindDefaulters() {
  err.value = ""; msg.value = ""; remindBusy.value = true;
  try {
    const p = await api(`/schools/${sid}/fees/defaulters-preview`);
    if (p.status !== 200) { err.value = p.json?.error || "Could not load defaulters"; return; }
    if (!p.json.guardians) { msg.value = "No pending dues 🎉"; return; }
    if (!confirm(`Remind ${p.json.guardians} guardians about ${inr(p.json.totalDuePaise)} total fees due?`)) return;
    const r = await api(`/schools/${sid}/fees/remind-defaulters`, { method: "POST", body: {} });
    if (r.status === 201) msg.value = `Reminders sent to ${r.json.reminded} guardians.`;
    else err.value = r.json?.error || "Could not send reminders";
  } finally {
    remindBusy.value = false;
  }
}
async function toggleDetail(inv) {
  if (expanded.value === inv.id) { expanded.value = null; detail.value = null; return; }
  expanded.value = inv.id;
  const r = await api(`/schools/${sid}/fees/invoices/${inv.id}`);
  if (r.status === 200) detail.value = r.json.invoice;
}
onMounted(async () => { if (isParent) await loadParent(); else await loadStaff(); });
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">💳 Fees</h1>
    <p class="text-sm text-slate-500 mb-4">{{ isParent ? "Your children's fee invoices, balances and payment receipts." : "Fee setup, invoice generation, collections and receipts. Online payment collection comes later — this ledger is the record." }}</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <!-- STAFF / OFFICE -->
    <template v-if="!isParent">
      <div v-if="summary" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div class="stat-card"><div class="stat-label">Billed</div><div class="stat-value">{{ inr(summary.billedPaise) }}</div></div>
        <div class="stat-card"><div class="stat-label">Collected</div><div class="stat-value text-emerald-600">{{ inr(summary.collectedPaise) }}</div></div>
        <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value text-amber-600">{{ inr(summary.pendingPaise) }}</div></div>
        <div class="stat-card"><div class="stat-label">Overdue invoices</div><div class="stat-value text-rose-600">{{ summary.overdueCount }}</div></div>
      </div>

      <section v-if="isManager" class="card mb-4">
        <h2 class="font-bold mb-2">Generate invoices</h2>
        <form class="grid md:grid-cols-4 gap-2" @submit.prevent="generate">
          <select v-model="gen.classroomId" class="input" required>
            <option v-for="c in classes" :key="c.id" :value="c.id">Class {{ c.name }}{{ c.section ? "-" + c.section : "" }}</option>
          </select>
          <input v-model="gen.periodLabel" class="input" placeholder="Period — e.g. 2026-11" required />
          <input v-model="gen.dueDate" type="date" class="input" required />
          <select v-model="gen.frequency" class="input">
            <option>MONTHLY</option><option>QUARTERLY</option><option>ANNUAL</option><option>ONE_TIME</option>
          </select>
          <button class="btn btn-primary md:col-span-4">Generate for all students in class</button>
        </form>
        <p class="text-xs text-slate-400 mt-2">Uses the class fee structure for that frequency. Students who already have this period's invoice are skipped.</p>
      </section>

      <section class="card mb-4">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <h2 class="font-bold">Invoices</h2>
          <button v-if="isManager" class="btn btn-primary !py-1.5" :disabled="remindBusy" @click="remindDefaulters">{{ remindBusy ? "Working…" : "🔔 Remind all defaulters" }}</button>
          <select v-model="classFilter" class="input !w-auto ml-auto" @change="loadStaff">
            <option value="">All classes</option>
            <option v-for="c in classes" :key="c.id" :value="c.id">Class {{ c.name }}{{ c.section ? "-" + c.section : "" }}</option>
          </select>
        </div>
        <div class="grid gap-2">
          <div v-for="inv in invoices" :key="inv.id" class="border border-slate-100 rounded-xl px-3 py-2">
            <div class="flex flex-wrap items-center gap-2">
              <div class="min-w-0">
                <div class="font-semibold text-sm">{{ inv.student.fullName }} <span class="text-slate-400 font-normal">· {{ inv.student.admissionNo }} · Class {{ inv.student.classroom?.name }}{{ inv.student.classroom?.section ? "-" + inv.student.classroom.section : "" }}</span></div>
                <div class="text-xs text-slate-500">{{ inv.periodLabel }} · Total {{ inr(inv.totalPaise) }} · Paid {{ inr(inv.paidPaise) }} · <b>Balance {{ inr(inv.balancePaise) }}</b> · Due {{ String(inv.dueDate).slice(0, 10) }}</div>
              </div>
              <span class="ml-auto text-xs font-bold px-2 py-1 rounded-full" :class="STATUS_CLS[inv.status]">{{ inv.status }}</span>
              <button class="btn btn-ghost !py-1 !px-2 text-xs" @click="toggleDetail(inv)">{{ expanded === inv.id ? "Hide" : "Details" }}</button>
              <button v-if="isManager && inv.status !== 'WAIVED' && inv.status !== 'PAID'" class="btn btn-ghost !py-1 !px-2 text-xs" @click="waive(inv)">Waive</button>
            </div>
            <div v-if="inv.balancePaise > 0 && inv.status !== 'WAIVED'" class="flex flex-wrap gap-2 mt-2">
              <input v-model="payForms[inv.id]" v-show="false" />
              <input :value="payForms[inv.id]?.amountRupees || ''" @input="payForms[inv.id] = { ...(payForms[inv.id] || {}), amountRupees: $event.target.value }" type="number" min="1" class="input !w-32" placeholder="₹ amount" />
              <select :value="payForms[inv.id]?.method || 'CASH'" @change="payForms[inv.id] = { ...(payForms[inv.id] || {}), method: $event.target.value }" class="input !w-28">
                <option>CASH</option><option>UPI</option><option>BANK</option><option>CHEQUE</option>
              </select>
              <input :value="payForms[inv.id]?.reference || ''" @input="payForms[inv.id] = { ...(payForms[inv.id] || {}), reference: $event.target.value }" class="input !w-36" placeholder="Reference (optional)" />
              <button class="btn btn-primary !py-1.5" @click="pay(inv)">Record payment</button>
            </div>
            <div v-if="expanded === inv.id && detail" class="mt-2 border-t border-slate-100 pt-2 text-sm grid gap-1">
              <div v-for="it in detail.items" :key="it.id" class="flex"><span>{{ it.label }}</span><span class="ml-auto">{{ inr(it.amountPaise) }}</span></div>
              <div v-for="p in detail.payments" :key="p.id" class="flex text-slate-500 text-xs"><span>🧾 {{ p.receiptNo }} · {{ p.method }} · {{ new Date(p.createdAt).toLocaleDateString() }}</span><span class="ml-auto">{{ inr(p.amountPaise) }}</span></div>
              <p v-if="!detail.payments.length" class="text-xs text-slate-400">No payments yet.</p>
            </div>
          </div>
          <p v-if="loading" class="text-sm text-slate-400 animate-pulse">Loading invoices…</p>
          <p v-else-if="!invoices.length" class="text-sm text-slate-400">No invoices yet — generate a period above.</p>
        </div>
      </section>

      <section v-if="isManager" class="card">
        <h2 class="font-bold mb-2">Fee setup</h2>
        <div class="flex flex-wrap gap-2 mb-3">
          <input v-model="newHead" class="input flex-1 min-w-[160px]" placeholder="New fee head — e.g. Tuition, Transport, Exam" />
          <button class="btn btn-ghost" @click="addHead">Add head</button>
        </div>
        <form class="grid md:grid-cols-4 gap-2" @submit.prevent="addStruct">
          <select v-model="newStruct.classroomId" class="input" required>
            <option v-for="c in classes" :key="c.id" :value="c.id">Class {{ c.name }}{{ c.section ? "-" + c.section : "" }}</option>
          </select>
          <select v-model="newStruct.feeHeadId" class="input" required>
            <option v-for="h in heads" :key="h.id" :value="h.id">{{ h.name }}</option>
          </select>
          <input v-model="newStruct.amountRupees" type="number" min="0" class="input" placeholder="₹ per period" required />
          <select v-model="newStruct.frequency" class="input">
            <option>MONTHLY</option><option>QUARTERLY</option><option>ANNUAL</option><option>ONE_TIME</option>
          </select>
          <button class="btn btn-primary md:col-span-4">Save structure</button>
        </form>
        <div class="mt-3 grid gap-1">
          <div v-for="s in structures" :key="s.id" class="text-sm flex gap-2">
            <span>Class {{ s.classroom.name }}{{ s.classroom.section ? "-" + s.classroom.section : "" }} · {{ s.feeHead.name }}</span>
            <span class="ml-auto font-semibold">{{ inr(s.amountPaise) }} <span class="text-slate-400 font-normal">{{ s.frequency }}</span></span>
          </div>
          <p v-if="!loading && !structures.length" class="text-sm text-slate-400">No structures yet.</p>
        </div>
      </section>
    </template>

    <!-- PARENT -->
    <template v-else>
      <div class="grid gap-3">
        <div v-for="inv in myInvoices" :key="inv.id" class="card !py-3">
          <div class="flex flex-wrap items-start gap-2">
            <div>
              <div class="font-semibold">{{ inv.title }} <span class="text-slate-400 font-normal text-sm">· {{ inv.student.fullName }}</span></div>
              <div class="text-sm text-slate-500">Total {{ inr(inv.totalPaise) }} · Paid {{ inr(inv.paidPaise) }} · <b>Balance {{ inr(inv.balancePaise) }}</b> · Due {{ String(inv.dueDate).slice(0, 10) }}</div>
            </div>
            <span class="ml-auto text-xs font-bold px-2 py-1 rounded-full" :class="STATUS_CLS[inv.status]">{{ inv.status }}</span>
          </div>
          <div class="mt-2 grid gap-1 text-sm">
            <div v-for="it in inv.items" :key="it.id" class="flex"><span class="text-slate-500">{{ it.label }}</span><span class="ml-auto">{{ inr(it.amountPaise) }}</span></div>
          </div>
          <div v-if="inv.payments.length" class="mt-2 border-t border-slate-100 pt-2 grid gap-1">
            <div class="text-xs font-bold text-slate-400">PAYMENTS / RECEIPTS</div>
            <div v-for="p in inv.payments" :key="p.id" class="text-sm flex gap-2">
              <span>🧾 {{ p.receiptNo }}</span><span class="text-slate-400">{{ p.method }} · {{ new Date(p.createdAt).toLocaleDateString() }}</span>
              <span class="ml-auto font-semibold">{{ inr(p.amountPaise) }}</span>
            </div>
          </div>
        </div>
        <p v-if="loading" class="card text-sm text-slate-400 animate-pulse">Loading invoices…</p>
        <p v-else-if="!myInvoices.length" class="card text-sm text-slate-400">No fee invoices yet.</p>
      </div>
    </template>
  </div>
</template>
