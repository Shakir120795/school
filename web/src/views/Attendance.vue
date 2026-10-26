<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api, session, myRole } from "../api.js";
import { usePager } from "../composables/usePager.js";
import Pager from "../components/Pager.vue";

const sid = session.schoolId;
const role = myRole();
const date = ref(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
const tab = ref("students");
const rows = ref([]);
const staffRows = ref([]);
const corrections = ref([]);
const audits = ref([]);
const msg = ref("");
const canDecide = ["SCHOOL_ADMIN", "PRINCIPAL"].includes(role);
const classes = ref([]);
const classFilter = ref("");
const summary = computed(() => {
  const list = tab.value === "students" ? rows.value : staffRows.value;
  return {
    present: list.filter((r) => r.status === "PRESENT").length,
    late: list.filter((r) => r.status === "LATE").length,
    absent: list.filter((r) => r.status === "ABSENT").length,
    flagged: list.filter((r) => r.reviewFlag).length,
    total: list.length,
  };
});
// Students register: class filter + name/admission search + 25/page
// pagination (read-only list — the summary cards above always count
// the FULL day, never just the visible page).
const attQuery = ref("");
const visibleRows = computed(() => {
  let list = rows.value;
  if (classFilter.value) list = list.filter((r) => r.student?.classroomId === classFilter.value);
  const q = attQuery.value.trim().toLowerCase();
  if (q) list = list.filter((r) => `${r.student?.fullName || ""} ${r.student?.admissionNo || ""}`.toLowerCase().includes(q));
  return list;
});
const attPager = usePager(visibleRows, 25);
watch([attQuery, classFilter, date, tab], () => attPager.reset());

async function load() {
  const [a, b] = await Promise.all([
    api(`/schools/${sid}/attendance/students?date=${date.value}`),
    api(`/schools/${sid}/attendance/staff?date=${date.value}`),
  ]);
  rows.value = a.json.attendance || [];
  staffRows.value = b.json.attendance || [];
  if (!classes.value.length) {
    const c = await api(`/schools/${sid}/classrooms`);
    classes.value = c.json.classrooms || [];
  }
  if (canDecide) {
    const au = await api(`/schools/${sid}/attendance/audit`);
    audits.value = (au.json.audit || []).slice(0, 10);
  }
}
onMounted(load);

const corrForm = ref({ entityId: "", reason: "", status: "" });
async function requestCorrection() {
  const r = await api(`/schools/${sid}/attendance/corrections`, {
    method: "POST",
    body: {
      entityType: "StudentAttendance",
      entityId: corrForm.value.entityId,
      reason: corrForm.value.reason,
      proposedChanges: { status: corrForm.value.status },
    },
  });
  msg.value = r.status === 201 ? "Correction requested. A principal/admin must approve it." : `Error: ${r.json.error}`;
  corrForm.value = { entityId: "", reason: "", status: "" };
}
async function decide(id, decision) {
  const r = await api(`/schools/${sid}/attendance/corrections/${id}/decide`, { method: "POST", body: { decision } });
  msg.value = r.status === 200 ? `Request ${decision.toLowerCase()}.` : `Error: ${r.json.error}`;
  load();
}
function fmt(t) {
  if (!t) return "—";
  return new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
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
</script>

<template>
  <div>
    <h1 class="text-2xl font-extrabold mb-3">Attendance register</h1>
    <p v-if="msg" class="card mb-3 !py-2 text-sm">{{ msg }}</p>
    <div class="flex flex-wrap gap-2 items-center mb-4">
      <input type="date" v-model="date" class="input !w-auto" @change="load" />
      <button class="btn" :class="tab === 'students' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'students'">Students ({{ rows.length }})</button>
      <button class="btn" :class="tab === 'staff' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'staff'">Staff ({{ staffRows.length }})</button>
      <button class="btn btn-ghost" @click="load">Refresh</button>
      <select v-if="tab === 'students'" v-model="classFilter" class="input !w-auto">
        <option value="">All classes</option>
        <option v-for="c in classes" :key="c.id" :value="c.id">Class {{ c.name }}<span v-if="c.section">-{{ c.section }}</span></option>
      </select>
      <input v-if="tab === 'students'" v-model="attQuery" class="input flex-1 min-w-[180px]" placeholder="Search student by name or admission no…" />
    </div>

    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      <div class="card !py-3 text-center"><div class="text-xl font-extrabold">{{ summary.total }}</div><div class="text-[11px] font-semibold text-slate-500">MARKED</div></div>
      <div class="card !py-3 text-center"><div class="text-xl font-extrabold text-emerald-600">{{ summary.present }}</div><div class="text-[11px] font-semibold text-slate-500">PRESENT</div></div>
      <div class="card !py-3 text-center"><div class="text-xl font-extrabold text-amber-600">{{ summary.late }}</div><div class="text-[11px] font-semibold text-slate-500">LATE</div></div>
      <div class="card !py-3 text-center"><div class="text-xl font-extrabold text-rose-600">{{ summary.absent }}</div><div class="text-[11px] font-semibold text-slate-500">ABSENT</div></div>
      <div class="card !py-3 text-center"><div class="text-xl font-extrabold text-orange-500">{{ summary.flagged }}</div><div class="text-[11px] font-semibold text-slate-500">FLAGGED ⚠</div></div>
    </div>

    <div v-if="tab === 'students'" class="card !p-0 overflow-x-auto">
      <table class="w-full text-sm mtable">
        <thead><tr class="text-left text-slate-500 border-b"><th class="p-3">Student</th><th class="p-3">Status</th><th class="p-3">Entry</th><th class="p-3">Exit</th><th class="p-3">Flags</th></tr></thead>
        <tbody>
          <tr v-for="r in attPager.pageItems.value" :key="r.id" class="border-b last:border-0">
            <td class="p-3 font-medium">{{ r.student?.fullName }} <span class="text-slate-400">({{ r.student?.admissionNo }})</span></td>
            <td class="p-3"><span class="badge" :class="statusBadge(r.status)">{{ r.status }}</span></td>
            <td class="p-3">{{ fmt(r.entryAt) }}</td><td class="p-3">{{ fmt(r.exitAt) }}</td>
            <td class="p-3 text-amber-600">{{ r.reviewFlag || "" }}</td>
          </tr>
          <tr v-if="!rows.length"><td class="p-3 text-slate-500" colspan="5">No student attendance for this date yet.</td></tr>
          <tr v-else-if="!visibleRows.length"><td class="p-3 text-slate-500" colspan="5">No students match your search or class filter.</td></tr>
        </tbody>
      </table>
      <div class="px-3 pb-3">
        <Pager :page="attPager.page.value" :total-pages="attPager.totalPages.value" :from="attPager.from.value" :to="attPager.to.value" :total="attPager.total.value" @update:page="attPager.page.value = $event" />
      </div>
    </div>

    <div v-if="tab === 'staff'" class="card !p-0 overflow-x-auto">
      <table class="w-full text-sm mtable">
        <thead><tr class="text-left text-slate-500 border-b"><th class="p-3">Staff</th><th class="p-3">Status</th><th class="p-3">Check-in</th><th class="p-3">Check-out</th><th class="p-3">Flags</th></tr></thead>
        <tbody>
          <tr v-for="r in staffRows" :key="r.id" class="border-b last:border-0">
            <td class="p-3 font-medium">{{ r.teacherProfile?.displayName }}</td>
            <td class="p-3"><span class="badge" :class="statusBadge(r.status)">{{ r.status }}</span></td>
            <td class="p-3">{{ fmt(r.checkInAt) }}</td><td class="p-3">{{ fmt(r.checkOutAt) }}</td>
            <td class="p-3 text-amber-600">{{ r.reviewFlag || "" }}</td>
          </tr>
          <tr v-if="!staffRows.length"><td class="p-3 text-slate-500" colspan="5">No staff attendance for this date yet.</td></tr>
        </tbody>
      </table>
    </div>

    <form class="card mt-4 grid md:grid-cols-4 gap-3" @submit.prevent="requestCorrection">
      <div class="md:col-span-4 font-semibold">Request a correction</div>
      <select v-model="corrForm.entityId" required class="input">
        <option value="">Attendance record…</option>
        <option v-for="r in rows" :key="r.id" :value="r.id">{{ r.student?.fullName }} — {{ r.status }}</option>
      </select>
      <select v-model="corrForm.status" required class="input">
        <option value="">New status…</option>
        <option>PRESENT</option><option>LATE</option><option>ABSENT</option><option>ON_LEAVE</option><option>HALF_DAY</option>
      </select>
      <input v-model="corrForm.reason" required class="input" placeholder="Reason (required, audited)" />
      <button class="btn btn-primary">Submit request</button>
      <p class="md:col-span-4 text-xs text-slate-400">Approvals happen from the API/admin flow; you cannot approve your own request.</p>
    </form>

    <div v-if="canDecide && audits.length" class="card mt-4">
      <div class="font-semibold mb-2">Recent correction audit</div>
      <div v-for="a in audits" :key="a.id" class="text-sm py-1.5 border-b border-slate-100 last:border-0">
        {{ a.action }} · {{ a.entityType }} · {{ a.reason || "" }}
        <span class="text-slate-400">{{ new Date(a.createdAt).toLocaleString("en-IN") }}</span>
      </div>
    </div>
  </div>
</template>
