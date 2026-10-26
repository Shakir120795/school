<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";

// Pickup & safety (Phase 12).
// Staff: gate release desk — today's parent approvals + standing
// authorised persons per student, release/reject with a log + parent
// alert. Parent: manage authorised persons for their own children and
// approve one-time pickups.
const role = session.membership?.role;
const isStaff = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF"].includes(role);
const sid = session.schoolId;
const msg = ref("");
const err = ref("");

const today = ref(null);
const students = ref([]);
const deskStudent = ref(null);
const deskPersons = ref([]);
const rejectForm = ref({ personName: "", reason: "" });

const children = ref([]);
const childData = ref({}); // studentId -> { persons, logs }
const newPerson = ref({}); // studentId -> form
const adhoc = ref({}); // studentId -> { name, phone }

async function loadDesk() {
  const [t, s] = await Promise.all([
    api(`/schools/${sid}/pickup/today`),
    api(`/schools/${sid}/students`),
  ]);
  if (t.status === 200) today.value = t.json;
  if (s.status === 200) students.value = s.json.students || s.json || [];
}
async function loadDeskStudent() {
  deskPersons.value = [];
  if (!deskStudent.value) return;
  const r = await api(`/schools/${sid}/students/${deskStudent.value}/pickup-persons`);
  if (r.status === 200) deskPersons.value = r.json.persons.filter((p) => p.isActive);
}
async function release({ studentId, pickupPersonId, approvalId, personName, outcome = "RELEASED", reason }) {
  err.value = ""; msg.value = "";
  const r = await api(`/schools/${sid}/students/${studentId}/release`, {
    method: "POST",
    body: { pickupPersonId, approvalId, personName, outcome, reason },
  });
  if (r.status === 201) {
    msg.value = outcome === "RELEASED" ? "Released. Parent has been notified." : "Attempt logged. Parent has been alerted.";
    await loadDesk(); await loadDeskStudent();
    if (!isStaff) await loadParent();
  } else err.value = r.json?.error || "Action failed";
}

async function loadParent() {
  const r = await api(`/schools/${sid}/my-children`);
  if (r.status !== 200) return;
  children.value = r.json.children || [];
  for (const c of children.value) {
    const [p, l] = await Promise.all([
      api(`/schools/${sid}/students/${c.id}/pickup-persons`),
      api(`/schools/${sid}/students/${c.id}/pickup-logs`),
    ]);
    childData.value[c.id] = {
      persons: p.status === 200 ? p.json.persons : [],
      logs: l.status === 200 ? l.json.logs : [],
    };
    if (!newPerson.value[c.id]) newPerson.value[c.id] = { fullName: "", relationship: "", phone: "" };
    if (!adhoc.value[c.id]) adhoc.value[c.id] = { name: "", phone: "" };
  }
}
async function addPerson(childId) {
  const f = newPerson.value[childId];
  if (!f.fullName) return;
  const r = await api(`/schools/${sid}/students/${childId}/pickup-persons`, { method: "POST", body: f });
  if (r.status === 201) { msg.value = "Authorised person added."; newPerson.value[childId] = { fullName: "", relationship: "", phone: "" }; await loadParent(); }
  else err.value = r.json?.error || "Could not add person";
}
async function togglePerson(person) {
  await api(`/schools/${sid}/pickup-persons/${person.id}`, { method: "PATCH", body: { isActive: !person.isActive } });
  await loadParent();
}
async function approveToday(childId, personId) {
  const body = personId ? { pickupPersonId: personId } : { adhocName: adhoc.value[childId].name, adhocPhone: adhoc.value[childId].phone };
  if (!personId && !body.adhocName) { err.value = "Enter the person's name for a one-time approval."; return; }
  const r = await api(`/schools/${sid}/students/${childId}/pickup-approvals`, { method: "POST", body });
  if (r.status === 201) { msg.value = "Approved for today. The gate staff can see this now."; adhoc.value[childId] = { name: "", phone: "" }; }
  else err.value = r.json?.error || "Approval failed";
}

onMounted(async () => { if (isStaff) await loadDesk(); else await loadParent(); });
const classLabel = (c) => (c ? `${c.name}${c.section ? "-" + c.section : ""}` : "");
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">🛡️ Pickup & Safety</h1>
    <p class="text-sm text-slate-500 mb-4">A card scan alone never releases a child — staff verify the pickup person here, and every release is logged and sent to the parent.</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <!-- STAFF GATE DESK -->
    <template v-if="isStaff">
      <section class="card mb-4">
        <h2 class="font-bold mb-2">Today's parent approvals</h2>
        <div v-if="today && today.approvals.length" class="grid gap-2">
          <div v-for="a in today.approvals" :key="a.id" class="flex flex-wrap items-center gap-2 border border-slate-100 rounded-xl px-3 py-2">
            <div class="min-w-0">
              <div class="font-semibold text-sm">{{ a.student.fullName }} <span class="text-slate-400 font-normal">· {{ a.student.admissionNo }} · Class {{ classLabel(a.student.classroom) }}</span></div>
              <div class="text-xs text-slate-500">Pickup by: <b>{{ a.person ? a.person.fullName : a.adhocName }}</b><span v-if="a.person?.relationship || a.adhocPhone"> ({{ a.person?.relationship || a.adhocPhone }})</span></div>
            </div>
            <div class="ml-auto flex gap-2">
              <button class="btn btn-primary !py-1.5" @click="release({ studentId: a.studentId, approvalId: a.id, pickupPersonId: a.pickupPersonId || undefined })">Release child</button>
              <button class="btn btn-ghost !py-1.5 text-red-600" @click="release({ studentId: a.studentId, approvalId: a.id, personName: a.person ? a.person.fullName : a.adhocName, outcome: 'REJECTED', reason: 'Rejected at gate desk' })">Reject</button>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-slate-400">No one-time approvals for today.</p>
      </section>

      <section class="card mb-4">
        <h2 class="font-bold mb-2">Release by authorised person</h2>
        <label class="label">Student</label>
        <select v-model="deskStudent" class="input mb-3" @change="loadDeskStudent">
          <option :value="null">Choose a student…</option>
          <option v-for="s in students" :key="s.id" :value="s.id">{{ s.fullName }} ({{ s.admissionNo }})</option>
        </select>
        <div v-if="deskStudent" class="grid gap-2">
          <div v-for="p in deskPersons" :key="p.id" class="flex items-center gap-2 border border-slate-100 rounded-xl px-3 py-2">
            <img v-if="p.photoUrl" :src="p.photoUrl" alt="" class="w-9 h-9 rounded-full object-cover" />
            <span v-else class="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center">👤</span>
            <div class="text-sm"><b>{{ p.fullName }}</b> <span class="text-slate-400">{{ p.relationship || "" }} {{ p.phone || "" }}</span></div>
            <button class="btn btn-primary !py-1.5 ml-auto" @click="release({ studentId: deskStudent, pickupPersonId: p.id })">Release child</button>
          </div>
          <p v-if="!deskPersons.length" class="text-sm text-slate-400">No active authorised persons for this student.</p>
          <div class="border-t border-slate-100 pt-3 grid gap-2">
            <div class="text-sm font-semibold text-red-600">Log a rejected attempt</div>
            <div class="flex flex-wrap gap-2">
              <input v-model="rejectForm.personName" class="input flex-1 min-w-[140px]" placeholder="Person's name" />
              <input v-model="rejectForm.reason" class="input flex-1 min-w-[140px]" placeholder="Reason (e.g. not authorised)" />
              <button class="btn btn-danger" :disabled="!rejectForm.personName" @click="release({ studentId: deskStudent, personName: rejectForm.personName, outcome: 'REJECTED', reason: rejectForm.reason }); rejectForm = { personName: '', reason: '' }">Log rejection</button>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <h2 class="font-bold mb-2">Today's pickup log</h2>
        <div v-if="today && today.logs.length" class="grid gap-1.5">
          <div v-for="l in today.logs" :key="l.id" class="text-sm flex gap-2 items-center">
            <span>{{ l.outcome === "RELEASED" ? "✅" : "⛔" }}</span>
            <span><b>{{ l.student.fullName }}</b> — {{ l.outcome === "RELEASED" ? "collected by" : "attempt by" }} {{ l.personName }}<span v-if="l.reason" class="text-slate-400"> · {{ l.reason }}</span></span>
            <span class="ml-auto text-xs text-slate-400">{{ new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
          </div>
        </div>
        <p v-else class="text-sm text-slate-400">No pickups logged yet today.</p>
      </section>
    </template>

    <!-- PARENT -->
    <template v-else>
      <div v-for="c in children" :key="c.id" class="card mb-4">
        <h2 class="font-bold">{{ c.fullName }} <span class="text-slate-400 font-normal text-sm">· Class {{ classLabel(c.classroom) }}</span></h2>

        <h3 class="font-semibold text-sm mt-3 mb-1">Authorised pickup persons</h3>
        <div class="grid gap-1.5">
          <div v-for="p in (childData[c.id]?.persons || [])" :key="p.id" class="flex items-center gap-2 text-sm border border-slate-100 rounded-xl px-3 py-2" :class="{ 'opacity-50': !p.isActive }">
            <span>👤</span>
            <span><b>{{ p.fullName }}</b> <span class="text-slate-400">{{ p.relationship || "" }} {{ p.phone || "" }}</span></span>
            <span class="ml-auto flex gap-2">
              <button class="btn btn-ghost !py-1" @click="approveToday(c.id, p.id)">Approve for today</button>
              <button class="btn btn-ghost !py-1" @click="togglePerson(p)">{{ p.isActive ? "Deactivate" : "Activate" }}</button>
            </span>
          </div>
          <p v-if="!(childData[c.id]?.persons || []).length" class="text-sm text-slate-400">No authorised persons yet — add grandparents, drivers or relatives below.</p>
        </div>
        <form class="flex flex-wrap gap-2 mt-2" @submit.prevent="addPerson(c.id)">
          <input v-model="newPerson[c.id].fullName" class="input flex-1 min-w-[130px]" placeholder="Full name" required />
          <input v-model="newPerson[c.id].relationship" class="input w-32" placeholder="Relation" />
          <input v-model="newPerson[c.id].phone" class="input w-36" placeholder="Phone" />
          <button class="btn btn-primary">Add person</button>
        </form>

        <h3 class="font-semibold text-sm mt-4 mb-1">One-time pickup today (someone not in the list)</h3>
        <form class="flex flex-wrap gap-2" @submit.prevent="approveToday(c.id, null)">
          <input v-model="adhoc[c.id].name" class="input flex-1 min-w-[130px]" placeholder="Person's name" />
          <input v-model="adhoc[c.id].phone" class="input w-36" placeholder="Phone" />
          <button class="btn btn-ghost">Approve for today</button>
        </form>

        <h3 class="font-semibold text-sm mt-4 mb-1">Recent pickups</h3>
        <div class="grid gap-1">
          <div v-for="l in (childData[c.id]?.logs || [])" :key="l.id" class="text-sm">
            {{ l.outcome === "RELEASED" ? "✅" : "⛔" }} {{ l.personName }} — {{ new Date(l.createdAt).toLocaleString() }}<span v-if="l.reason" class="text-slate-400"> · {{ l.reason }}</span>
          </div>
          <p v-if="!(childData[c.id]?.logs || []).length" class="text-sm text-slate-400">No pickups recorded yet.</p>
        </div>
      </div>
    </template>
  </div>
</template>
