<script setup>
// Support Inbox (Phase 67) — sab schools ke support tickets ab
// owner ko ek jagah dikhte hain (ab tak ticket sirf usi school
// ke andar band rehta tha). Owner padh sakta hai; jawab school
// ya teacher deta hai.
import { onMounted, ref } from "vue";
import { api } from "../api.js";
import Pager from "../components/Pager.vue";

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const items = ref([]);
const counts = ref({});
const total = ref(0);
const page = ref(1);
const pageSize = ref(25);
const totalPages = ref(1);
const loading = ref(true);
const status = ref("");
const detail = ref(null);
const detailLoading = ref(false);

const fmtWhen = (d) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const statusChip = (s) => s === "OPEN" ? "bg-rose-100 text-rose-700"
  : s === "IN_PROGRESS" ? "bg-amber-100 text-amber-700"
  : s === "RESOLVED" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500";

async function load() {
  loading.value = true;
  try {
    const qs = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) });
    if (status.value) qs.set("status", status.value);
    const r = await api(`/platform/support-tickets?${qs}`, { school: false });
    if (r.ok) {
      items.value = r.json.items || [];
      counts.value = r.json.counts || {};
      total.value = r.json.total || 0;
      totalPages.value = r.json.totalPages || 1;
    }
  } finally { loading.value = false; }
}
function setStatus(s) { status.value = s; page.value = 1; detail.value = null; load(); }
async function openTicket(t) {
  detailLoading.value = true; detail.value = null;
  const r = await api(`/platform/support-tickets/${t.id}`, { school: false });
  if (r.ok) detail.value = r.json;
  detailLoading.value = false;
}
onMounted(load);
</script>

<template>
  <section>
    <h1 class="text-xl font-extrabold">🎫 Support — sab schools ke tickets</h1>
    <p class="text-sm text-slate-500 mt-0.5">Kaunsi school me kya dikkat chal rahi hai — sab ek nazar me. Jawab school/teacher deta hai; tum sirf nazar rakho.</p>

    <div class="flex flex-wrap gap-1.5 mt-4">
      <button type="button" class="chip !px-3 !py-1.5 font-bold" :class="status === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'" @click="setStatus('')">All ({{ total }})</button>
      <button v-for="s in STATUSES" :key="s" type="button" class="chip !px-3 !py-1.5 font-bold" :class="status === s ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'" @click="setStatus(s)">{{ s.replace("_", " ") }} ({{ counts[s] || 0 }})</button>
      <select v-model.number="pageSize" class="input !w-auto !py-1.5 text-xs ml-auto" @change="setStatus(status)">
        <option :value="25">25 / page</option>
        <option :value="50">50 / page</option>
        <option :value="100">100 / page</option>
      </select>
    </div>

    <div class="card mt-3 !p-0 overflow-hidden">
      <p v-if="loading" class="p-4 text-sm text-slate-400 animate-pulse">Loading tickets…</p>
      <p v-else-if="!items.length" class="p-4 text-sm text-slate-400">Koi ticket nahi mila.</p>
      <button v-for="t in items" :key="t.id" type="button" class="w-full text-left px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50" @click="openTicket(t)">
        <span class="flex flex-wrap items-center gap-2">
          <span class="font-bold">#{{ t.ticketNo }} {{ t.subject }}</span>
          <span class="chip font-bold" :class="statusChip(t.status)">{{ t.status.replace("_", " ") }}</span>
          <span class="chip bg-slate-100 text-slate-600">{{ t.schoolName }}</span>
          <span class="chip bg-slate-100 text-slate-500">{{ t.audience === "TEACHER" ? "👩‍🏫 Class Teacher" : "🏫 School Office" }}</span>
          <span class="text-xs text-slate-400 ml-auto">{{ fmtWhen(t.updatedAt) }}</span>
        </span>
        <span class="block text-sm text-slate-500 mt-1">
          {{ t.raisedByName }}<span v-if="t.studentName"> · 🎓 {{ t.studentName }}<span v-if="t.classLabel"> ({{ t.classLabel }})</span></span> · {{ t.category }}
        </span>
        <span v-if="t.lastMessage" class="block text-sm text-slate-400 mt-0.5 truncate">💬 {{ t.lastMessage }}</span>
      </button>
      <div class="px-4 py-2">
        <Pager :page="page" :total-pages="totalPages" :from="total ? (page - 1) * pageSize + 1 : 0" :to="Math.min(total, page * pageSize)" :total="total" @update:page="(p) => { page = p; load(); }" />
      </div>
    </div>

    <div v-if="detailLoading" class="card mt-3 text-sm text-slate-400 animate-pulse">Loading baat-cheet…</div>
    <div v-else-if="detail" class="card mt-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-extrabold">#{{ detail.ticket.ticketNo }} {{ detail.ticket.subject }}</span>
        <span class="chip font-bold" :class="statusChip(detail.ticket.status)">{{ detail.ticket.status.replace("_", " ") }}</span>
        <span class="chip bg-slate-100 text-slate-600">{{ detail.ticket.schoolName }}</span>
        <button type="button" class="ml-auto text-xs font-bold text-slate-400" @click="detail = null">✕ Band karo</button>
      </div>
      <div class="mt-3 space-y-2">
        <div v-for="m in detail.messages" :key="m.id" class="rounded-xl px-3 py-2 text-sm" :class="m.isStaff ? 'bg-brand-50' : 'bg-slate-50'">
          <div class="text-xs font-bold text-slate-500">{{ m.authorName }} · {{ m.isStaff ? "School" : "Parent" }} · {{ fmtWhen(m.createdAt) }}</div>
          <div class="mt-0.5">{{ m.body }}</div>
        </div>
        <p v-if="!detail.messages.length" class="text-sm text-slate-400">Abhi koi message nahi.</p>
      </div>
    </div>
  </section>
</template>
