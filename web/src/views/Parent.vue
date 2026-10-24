<script setup>
import { onMounted, ref } from "vue";
import { api, session } from "../api.js";

const sid = session.schoolId;
const children = ref([]);
const teachers = ref([]);
const whatsapp = ref(true);
const msg = ref("");

async function load() {
  const [c, t] = await Promise.all([
    api(`/schools/${sid}/my-children`),
    api(`/schools/${sid}/teachers`),
  ]);
  children.value = c.json.children || [];
  teachers.value = t.json.teachers || [];
}
onMounted(load);

async function saveConsent() {
  const r = await api(`/schools/${sid}/my-consents`, {
    method: "PUT",
    body: { channel: "WHATSAPP", optedIn: whatsapp.value },
  });
  msg.value = r.status === 200 ? "Preference saved." : `Error: ${r.json.error}`;
}
function attBadge(s) {
  return { PRESENT: "bg-green-100 text-green-700", LATE: "bg-amber-100 text-amber-700", ABSENT: "bg-red-100 text-red-700", ON_LEAVE: "bg-blue-100 text-blue-700" }[s] || "bg-slate-100 text-slate-600";
}
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-3">My Children</h1>
    <p v-if="msg" class="card mb-3 !py-2 text-sm">{{ msg }}</p>

    <div v-if="!children.length" class="card text-slate-500 text-sm mb-4">
      No children are linked to your account yet. Ask the school office to link your guardian profile.
    </div>

    <div v-for="child in children" :key="child.id" class="card mb-4">
      <div class="flex items-center gap-2">
        <div class="font-semibold text-lg">{{ child.fullName }}</div>
        <span class="badge bg-slate-100 text-slate-600">Adm {{ child.admissionNo }}</span>
        <span v-if="child.classroom" class="badge bg-brand-50 text-brand-700">Class {{ child.classroom.name }}-{{ child.classroom.section }}</span>
      </div>
      <div class="font-medium mt-3 mb-1 text-sm">Recent attendance</div>
      <div v-if="!child.attendances?.length" class="text-sm text-slate-500">No attendance records yet.</div>
      <div class="flex flex-wrap gap-2">
        <span v-for="a in (child.attendances || []).slice(0, 14)" :key="a.id" class="badge" :class="attBadge(a.status)">
          {{ String(a.localDate).slice(0, 10) }} · {{ a.status }}
        </span>
      </div>
    </div>

    <div class="card mb-4">
      <div class="font-semibold mb-2">Teachers (school-approved directory)</div>
      <div v-for="t in teachers" :key="t.id" class="py-2 border-b border-slate-100 last:border-0">
        <div class="font-medium">{{ t.displayName }}</div>
        <div class="text-sm text-slate-500">
          <span v-for="a in t.classAssignments" :key="a.id" class="mr-2">{{ a.subject?.name }} — Class {{ a.classroom?.name }}-{{ a.classroom?.section }}</span>
          <span v-if="t.inchargeAssignments?.length" class="text-brand-700">Class incharge</span>
        </div>
        <div v-if="t.approvedContactChannel" class="text-xs text-slate-400">Contact: {{ t.approvedContactChannel }}</div>
      </div>
      <div v-if="!teachers.length" class="text-sm text-slate-500">No teacher profiles published yet.</div>
    </div>

    <div class="card">
      <div class="font-semibold mb-2">Communication preferences</div>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" v-model="whatsapp" /> Receive school notices on WhatsApp
      </label>
      <button class="btn btn-primary mt-3" @click="saveConsent">Save preference</button>
    </div>
  </div>
</template>
