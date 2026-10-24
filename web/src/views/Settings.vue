<script setup>
import { onMounted, ref } from "vue";
import { api, session } from "../api.js";

const sid = session.schoolId;
const school = ref(null);
const years = ref([]);
const classrooms = ref([]);
const subjects = ref([]);
const devices = ref([]);
const policies = ref([]);
const msg = ref("");
const newDeviceKey = ref("");

const year = ref({ name: "", startsOn: "", endsOn: "" });
const room = ref({ name: "", section: "", academicYearId: "" });
const subject = ref({ name: "", code: "" });
const device = ref({ name: "" });
const policy = ref({ appliesTo: "STUDENT", entryStart: "07:30", entryEnd: "08:15", lateAfter: "08:15", exitStart: "13:30", exitEnd: "14:30", workingWeekdays: [1, 2, 3, 4, 5, 6] });

async function load() {
  const [s, y, c, sub, d, p] = await Promise.all([
    api(`/schools/${sid}`),
    api(`/schools/${sid}/academic-years`),
    api(`/schools/${sid}/classrooms`),
    api(`/schools/${sid}/subjects`),
    api(`/schools/${sid}/devices`),
    api(`/schools/${sid}/attendance-policies`),
  ]);
  school.value = s.json.school;
  years.value = y.json.academicYears || [];
  classrooms.value = c.json.classrooms || [];
  subjects.value = sub.json.subjects || [];
  devices.value = d.json.devices || [];
  policies.value = p.json.policies || [];
}
onMounted(load);
function note(r, ok) { msg.value = r.status < 300 ? ok : `Error: ${r.json.error || r.status}`; if (r.status < 300) load(); }

async function addYear() { note(await api(`/schools/${sid}/academic-years`, { method: "POST", body: year.value }), "Academic year added."); }
async function addRoom() { note(await api(`/schools/${sid}/classrooms`, { method: "POST", body: { ...room.value, academicYearId: room.value.academicYearId || years.value[0]?.id } }), "Classroom added."); }
async function addSubject() { note(await api(`/schools/${sid}/subjects`, { method: "POST", body: subject.value }), "Subject added."); }
async function addDevice() {
  const r = await api(`/schools/${sid}/devices`, { method: "POST", body: device.value });
  if (r.status === 201) {
    newDeviceKey.value = r.json.deviceKey;
    msg.value = "Device created. Copy the key now — it is shown only once. Enter it on the gate device's Scanner page.";
    load();
  } else note(r);
}
async function savePolicy() {
  note(await api(`/schools/${sid}/attendance-policies`, { method: "POST", body: policy.value }), "Policy saved (now the active policy for this scope).");
}
async function saveSchool() {
  note(await api(`/schools/${sid}`, { method: "PATCH", body: { name: school.value.name, timezone: school.value.timezone } }), "School settings saved.");
}
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-3">Settings</h1>
    <p v-if="msg" class="card mb-3 !py-2 text-sm">{{ msg }}</p>

    <div v-if="school" class="card grid md:grid-cols-3 gap-3 mb-4">
      <div class="md:col-span-3 font-semibold">School</div>
      <div><label class="label">Name</label><input v-model="school.name" class="input" /></div>
      <div><label class="label">Timezone (IANA)</label><input v-model="school.timezone" class="input" /></div>
      <div><label class="label">School ID (for gate devices)</label><input :value="school.id" readonly class="input bg-slate-50" /></div>
      <div><button class="btn btn-primary" @click="saveSchool">Save</button></div>
    </div>

    <div class="grid md:grid-cols-3 gap-4 mb-4">
      <form class="card grid gap-2" @submit.prevent="addYear">
        <div class="font-semibold">Academic year</div>
        <input v-model="year.name" required class="input" placeholder="2026-27" />
        <input v-model="year.startsOn" required type="date" class="input" />
        <input v-model="year.endsOn" required type="date" class="input" />
        <button class="btn btn-primary">Add year</button>
        <div class="text-xs text-slate-400">{{ years.map(y => y.name).join(", ") }}</div>
      </form>
      <form class="card grid gap-2" @submit.prevent="addRoom">
        <div class="font-semibold">Classroom</div>
        <input v-model="room.name" required class="input" placeholder="Class (e.g. 5)" />
        <input v-model="room.section" class="input" placeholder="Section (e.g. A)" />
        <select v-model="room.academicYearId" class="input"><option value="">Year (default first)</option><option v-for="y in years" :key="y.id" :value="y.id">{{ y.name }}</option></select>
        <button class="btn btn-primary">Add classroom</button>
        <div class="text-xs text-slate-400">{{ classrooms.map(c => c.name + "-" + (c.section || "")).join(", ") }}</div>
      </form>
      <form class="card grid gap-2" @submit.prevent="addSubject">
        <div class="font-semibold">Subject</div>
        <input v-model="subject.name" required class="input" placeholder="Mathematics" />
        <input v-model="subject.code" required class="input" placeholder="MATH" />
        <button class="btn btn-primary">Add subject</button>
        <div class="text-xs text-slate-400">{{ subjects.map(s => s.name).join(", ") }}</div>
      </form>
    </div>

    <form class="card grid md:grid-cols-7 gap-3 mb-4" @submit.prevent="savePolicy">
      <div class="md:col-span-7 font-semibold">Attendance policy (school-local times)</div>
      <select v-model="policy.appliesTo" class="input"><option>STUDENT</option><option>STAFF</option></select>
      <div><label class="label">Entry start</label><input v-model="policy.entryStart" type="time" class="input" /></div>
      <div><label class="label">Entry end</label><input v-model="policy.entryEnd" type="time" class="input" /></div>
      <div><label class="label">Late after</label><input v-model="policy.lateAfter" type="time" class="input" /></div>
      <div><label class="label">Exit start</label><input v-model="policy.exitStart" type="time" class="input" /></div>
      <div><label class="label">Exit end</label><input v-model="policy.exitEnd" type="time" class="input" /></div>
      <div class="flex items-end"><button class="btn btn-primary w-full">Save policy</button></div>
      <div class="md:col-span-7 text-xs text-slate-400">
        Active now: <span v-for="p in policies.filter(x => x.isActive)" :key="p.id" class="mr-3">{{ p.appliesTo }} {{ p.entryStart }}–{{ p.entryEnd }}, late after {{ p.lateAfter }}</span>
      </div>
    </form>

    <div class="card">
      <div class="font-semibold mb-2">Gate devices</div>
      <form class="flex gap-2 mb-3" @submit.prevent="addDevice">
        <input v-model="device.name" required class="input" placeholder="Device name (e.g. Main gate tablet)" />
        <button class="btn btn-primary">Create device</button>
      </form>
      <p v-if="newDeviceKey" class="text-sm bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
        Device key (shown once): <code class="font-mono break-all">{{ newDeviceKey }}</code>
      </p>
      <div v-for="d in devices" :key="d.id" class="flex gap-2 py-1.5 text-sm border-b border-slate-100 last:border-0">
        <span class="font-medium">{{ d.name }}</span>
        <span class="badge" :class="d.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'">{{ d.status }}</span>
        <span class="text-slate-400 ml-auto">Last seen: {{ d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString("en-IN") : "never" }}</span>
      </div>
    </div>
  </div>
</template>
