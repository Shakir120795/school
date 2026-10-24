<script setup>
import { onMounted, ref } from "vue";
import { api, session, myRole } from "../api.js";

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

async function load() {
  const [a, b] = await Promise.all([
    api(`/schools/${sid}/attendance/students?date=${date.value}`),
    api(`/schools/${sid}/attendance/staff?date=${date.value}`),
  ]);
  rows.value = a.json.attendance || [];
  staffRows.value = b.json.attendance || [];
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
    <h1 class="text-xl font-bold mb-3">Attendance</h1>
    <p v-if="msg" class="card mb-3 !py-2 text-sm">{{ msg }}</p>
    <div class="flex flex-wrap gap-2 items-center mb-4">
      <input type="date" v-model="date" class="input !w-auto" @change="load" />
      <button class="btn" :class="tab === 'students' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'students'">Students ({{ rows.length }})</button>
      <button class="btn" :class="tab === 'staff' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'staff'">Staff ({{ staffRows.length }})</button>
      <button class="btn btn-ghost" @click="load">Refresh</button>
    </div>

    <div v-if="tab === 'students'" class="card !p-0 overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-slate-500 border-b"><th class="p-3">Student</th><th class="p-3">Status</th><th class="p-3">Entry</th><th class="p-3">Exit</th><th class="p-3">Flags</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="border-b last:border-0">
            <td class="p-3 font-medium">{{ r.student?.fullName }} <span class="text-slate-400">({{ r.student?.admissionNo }})</span></td>
            <td class="p-3"><span class="badge" :class="statusBadge(r.status)">{{ r.status }}</span></td>
            <td class="p-3">{{ fmt(r.entryAt) }}</td><td class="p-3">{{ fmt(r.exitAt) }}</td>
            <td class="p-3 text-amber-600">{{ r.reviewFlag || "" }}</td>
          </tr>
          <tr v-if="!rows.length"><td class="p-3 text-slate-500" colspan="5">No student attendance for this date yet.</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="tab === 'staff'" class="card !p-0 overflow-x-auto">
      <table class="w-full text-sm">
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
