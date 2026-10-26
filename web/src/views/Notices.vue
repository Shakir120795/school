<script setup>
import { onMounted, ref, computed } from "vue";
import { api, session, myRole } from "../api.js";

const sid = session.schoolId;
const role = myRole();
const loading = ref(true);
const notices = ref([]);
const classrooms = ref([]);
const students = ref([]);
const msg = ref("");
const preview = ref(null);
const recipients = ref([]);
const openNoticeId = ref("");

const form = ref({
  title: "", body: "", type: "ANNOUNCEMENT", priority: "NORMAL",
  audienceType: role === "TEACHER" ? "ASSIGNED_CLASS" : "ALL_PARENTS",
  classroomId: "", studentIds: [],
});
const teacherAudiences = ["ASSIGNED_CLASS", "SELECTED_STUDENTS"];
const adminAudiences = ["ALL_PARENTS", "ALL_TEACHERS", "ALL_PARENTS_AND_TEACHERS", "ASSIGNED_CLASS", "SELECTED_STUDENTS", "SELECTED_GUARDIANS", "INDIVIDUAL_STAFF"];
const audienceOptions = computed(() => (role === "TEACHER" ? teacherAudiences : adminAudiences));

async function load() {
  loading.value = true;
  try {
    const [n, c, s] = await Promise.all([
      api(`/schools/${sid}/notices`),
      api(`/schools/${sid}/classrooms`),
      api(`/schools/${sid}/students`),
    ]);
    notices.value = n.json.notices || [];
    classrooms.value = c.json.classrooms || [];
    students.value = s.json.students || [];
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function targets() {
  if (form.value.audienceType === "ASSIGNED_CLASS") return [{ classroomId: form.value.classroomId }];
  if (form.value.audienceType === "SELECTED_STUDENTS") return form.value.studentIds.map((id) => ({ studentId: id }));
  return [];
}
async function doPreview() {
  const r = await api(`/schools/${sid}/notices/preview`, {
    method: "POST",
    body: { audienceType: form.value.audienceType, targets: targets() },
  });
  preview.value = r.status === 200 ? r.json : null;
  msg.value = r.status === 200 ? "" : `Preview error: ${r.json.error}`;
}
async function createDraft() {
  const r = await api(`/schools/${sid}/notices`, {
    method: "POST",
    body: {
      title: form.value.title, body: form.value.body, type: form.value.type,
      priority: form.value.priority, audienceType: form.value.audienceType, targets: targets(),
    },
  });
  if (r.status !== 201) return (msg.value = `Error: ${r.json.error}`);
  msg.value = "Draft created.";
  form.value.title = ""; form.value.body = ""; preview.value = null;
  load();
  return r.json.notice;
}
async function createAndSend() {
  const n = await createDraft();
  if (n) await send(n.id);
}
async function send(id) {
  const r = await api(`/schools/${sid}/notices/${id}/send`, { method: "POST", body: {} });
  msg.value = r.status === 200 ? `Sent to ${r.json.recipientCount} recipient(s).` : `Error: ${r.json.error}`;
  load();
}
async function cancel(id) {
  const r = await api(`/schools/${sid}/notices/${id}/cancel`, { method: "POST", body: {} });
  msg.value = r.status === 200 ? "Notice cancelled." : `Error: ${r.json.error}`;
  load();
}
async function showRecipients(n) {
  openNoticeId.value = openNoticeId.value === n.id ? "" : n.id;
  if (openNoticeId.value) {
    const r = await api(`/schools/${sid}/notices/${n.id}/recipients`);
    recipients.value = r.json.recipients || [];
  }
}
async function ack(id) {
  const r = await api(`/schools/${sid}/notices/${id}/ack`, { method: "POST", body: {} });
  msg.value = r.status === 200 ? "Acknowledged." : `Error: ${r.json.error}`;
  load();
}
function deliverySummary(rec) {
  const d = (rec.deliveries || [])[0];
  return d ? `${d.channel} · ${d.status}${d.providerMessageId ? " · " + d.providerMessageId : ""}${d.errorCode ? " · " + d.errorCode : ""}` : "no delivery yet";
}
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-3">Notices</h1>
    <p v-if="msg" class="card mb-3 !py-2 text-sm">{{ msg }}</p>

    <form v-if="role !== 'PARENT'" class="card grid gap-3 mb-4" @submit.prevent>
      <div class="font-semibold">Compose notice</div>
      <input v-model="form.title" class="input" placeholder="Title" />
      <textarea v-model="form.body" class="input" rows="3" placeholder="Message"></textarea>
      <div class="grid md:grid-cols-3 gap-3">
        <select v-model="form.type" class="input"><option>ANNOUNCEMENT</option><option>HOMEWORK</option><option>HOLIDAY</option><option>EMERGENCY</option><option>CUSTOM</option></select>
        <select v-model="form.priority" class="input"><option>NORMAL</option><option>URGENT</option><option>EMERGENCY</option></select>
        <select v-model="form.audienceType" class="input">
          <option v-for="a in audienceOptions" :key="a" :value="a">{{ a.replaceAll("_", " ") }}</option>
        </select>
      </div>
      <select v-if="form.audienceType === 'ASSIGNED_CLASS'" v-model="form.classroomId" class="input">
        <option value="">Select class…</option>
        <option v-for="c in classrooms" :key="c.id" :value="c.id">{{ c.name }}-{{ c.section }}</option>
      </select>
      <div v-if="form.audienceType === 'SELECTED_STUDENTS'" class="grid md:grid-cols-3 gap-2 max-h-40 overflow-auto">
        <label v-for="s in students" :key="s.id" class="text-sm flex gap-2 items-center">
          <input type="checkbox" :value="s.id" v-model="form.studentIds" /> {{ s.fullName }}
        </label>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <button type="button" class="btn btn-ghost" @click="doPreview">Preview audience</button>
        <span v-if="preview" class="text-sm text-slate-600">Recipients: <b>{{ preview.recipientCount }}</b> (guardians {{ preview.guardians }}, staff {{ preview.staff }})</span>
        <span class="flex-1"></span>
        <button type="button" class="btn btn-ghost" @click="createDraft">Save draft</button>
        <button type="button" class="btn btn-primary" @click="createAndSend">Send now</button>
      </div>
      <p class="text-xs text-slate-400">Teachers can only send to their assigned classes / selected students of those classes. School-wide broadcasts are principal/admin only. Delivery goes through the outbox worker.</p>
    </form>

    <div class="grid gap-3">
      <div v-for="n in notices" :key="n.id" class="card">
        <div class="flex flex-wrap items-center gap-2">
          <span class="badge" :class="n.status === 'SENT' ? 'bg-green-100 text-green-700' : n.status === 'DRAFT' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'">{{ n.status }}</span>
          <span class="font-semibold">{{ n.title }}</span>
          <span class="text-xs text-slate-400">{{ n.type }} · {{ n.audienceType.replaceAll("_", " ") }}</span>
          <span class="flex-1"></span>
          <button v-if="['DRAFT', 'SCHEDULED'].includes(n.status) && role !== 'PARENT'" class="btn btn-primary !py-1.5" @click="send(n.id)">Send</button>
          <button v-if="['DRAFT', 'SCHEDULED'].includes(n.status) && role !== 'PARENT'" class="btn btn-ghost !py-1.5" @click="cancel(n.id)">Cancel</button>
          <button v-if="role === 'PARENT' && n.requiresAck" class="btn btn-primary !py-1.5" @click="ack(n.id)">Acknowledge</button>
          <button class="btn btn-ghost !py-1.5" @click="showRecipients(n)">Deliveries</button>
        </div>
        <p class="text-sm text-slate-600 mt-1">{{ n.body }}</p>
        <div v-if="openNoticeId === n.id" class="mt-3 border-t border-slate-100 pt-2">
          <div v-if="!recipients.length" class="text-sm text-slate-500">No recipients snapshot yet (notice not sent).</div>
          <div v-for="r in recipients" :key="r.id" class="text-sm py-1 flex gap-2">
            <span class="badge bg-slate-100 text-slate-600">{{ r.recipientType }}</span>
            <span>{{ r.status }}</span>
            <span class="text-slate-400">{{ deliverySummary(r) }}</span>
          </div>
        </div>
      </div>
      <div v-if="loading" class="card text-slate-500 text-sm animate-pulse">Loading notices…</div>
      <div v-else-if="!notices.length" class="card text-slate-500 text-sm">No notices yet.</div>
    </div>
  </div>
</template>
