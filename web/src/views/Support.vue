<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";

// Support tickets + PTM (Phase 20).
const role = session.membership?.role;
const isParent = role === "PARENT";
const isManager = ["SCHOOL_ADMIN", "PRINCIPAL"].includes(role);
const sid = session.schoolId;
const msg = ref("");
const err = ref("");

const loading = ref(true);
const children = ref([]);
// Phase 51: staff ke form ke liye school ke students + class labels.
const students = ref([]);
const classMap = ref({});
const classLabel = (c) => (c ? `Class ${c.name}${c.section ? "-" + c.section : ""}` : "");
const tickets = ref([]);
const open = ref(null);
const thread = ref([]);
const reply = ref("");
const form = ref({ subject: "", body: "", category: "GENERAL", studentId: "", audience: "OFFICE" });
// Phase 52: ticket list do sections me — School Office aur Class Teacher.
const sections = computed(() => [
  { key: "OFFICE", title: "🏫 School Office", list: tickets.value.filter((t) => t.audience !== "TEACHER") },
  { key: "TEACHER", title: "👩‍🏫 Class Teacher", list: tickets.value.filter((t) => t.audience === "TEACHER") },
].filter((s) => s.list.length));
const STATUS_CLS = { OPEN: "bg-rose-100 text-rose-700", IN_PROGRESS: "bg-amber-100 text-amber-700", RESOLVED: "bg-emerald-100 text-emerald-700", CLOSED: "bg-slate-200 text-slate-500" };

const ptms = ref([]);
const classes = ref([]);
const ptmForm = ref({ title: "", date: "", startTime: "10:00", endTime: "13:00", slotMinutes: 15, classroomId: "" });
const bookChild = ref({});
const bookTime = ref({});

async function loadTickets() {
  const r = await api(`/schools/${sid}/tickets`);
  if (r.status === 200) tickets.value = r.json.tickets;
}
async function createTicket() {
  err.value = ""; msg.value = "";
  // Phase 51: parent ko child chunna hi hoga — ticket hamesha
  // kisi bacche ke baare me hoti hai (server bhi yahi kehta hai).
  if (isParent && !form.value.studentId) { err.value = "Please choose which child this ticket is about."; return; }
  const body = { ...form.value, studentId: form.value.studentId || undefined };
  const r = await api(`/schools/${sid}/tickets`, { method: "POST", body });
  if (r.status === 201) {
    msg.value = body.audience === "TEACHER"
      ? `Ticket #${r.json.ticket.ticketNo} raised — sent to the class teacher. She will reply here.`
      : `Ticket #${r.json.ticket.ticketNo} raised. The school office will reply here.`;
    form.value = { subject: "", body: "", category: "GENERAL", studentId: "", audience: "OFFICE" };
    await loadTickets(); await openTicket(r.json.ticket);
  }
  else if (r.json?.error === "NO_CLASS_TEACHER") err.value = "This class has no class teacher set yet — please send this ticket to the School Office instead.";
  else err.value = r.json?.error || "Could not raise ticket";
}
async function openTicket(t) {
  open.value = t;
  const r = await api(`/schools/${sid}/tickets/${t.id}`);
  if (r.status === 200) { thread.value = r.json.messages; open.value = r.json.ticket; }
}
async function sendReply() {
  if (!reply.value.trim()) return;
  const r = await api(`/schools/${sid}/tickets/${open.value.id}/messages`, { method: "POST", body: { body: reply.value } });
  if (r.status === 201) { reply.value = ""; await openTicket(open.value); await loadTickets(); }
  else err.value = r.json?.error || "Reply failed";
}
async function setStatus(status) {
  const r = await api(`/schools/${sid}/tickets/${open.value.id}/status`, { method: "PATCH", body: { status } });
  if (r.status === 200) { open.value = r.json.ticket; await loadTickets(); }
  else err.value = r.json?.error || "Status change failed";
}

async function loadPtm() {
  const [p, c] = await Promise.all([
    api(`/schools/${sid}/ptm`),
    isManager ? api(`/schools/${sid}/rollcall/classes`) : Promise.resolve(null),
  ]);
  if (p.status === 200) ptms.value = p.json.slots;
  if (c && c.status === 200) classes.value = c.json.classes;
  loading.value = false;
}
async function createPtm() {
  err.value = ""; msg.value = "";
  const body = { ...ptmForm.value, classroomId: ptmForm.value.classroomId || undefined, slotMinutes: Number(ptmForm.value.slotMinutes) };
  const r = await api(`/schools/${sid}/ptm`, { method: "POST", body });
  if (r.status === 201) { msg.value = "PTM created — parents can now book their time."; ptmForm.value.title = ""; await loadPtm(); }
  else err.value = r.json?.error || "Could not create PTM";
}
async function book(slot) {
  err.value = ""; msg.value = "";
  const studentId = bookChild.value[slot.id] || children.value[0]?.id;
  const startTime = bookTime.value[slot.id];
  if (!studentId || !startTime) { err.value = "Pick a child and a free time."; return; }
  const r = await api(`/schools/${sid}/ptm/${slot.id}/book`, { method: "POST", body: { studentId, startTime } });
  if (r.status === 201) { msg.value = `Booked for ${startTime} on ${String(slot.date).slice(0, 10)}.`; await loadPtm(); }
  else err.value = r.json?.error || "Booking failed";
}
async function cancelBooking(bookingId) {
  const r = await api(`/schools/${sid}/ptm/bookings/${bookingId}`, { method: "DELETE" });
  if (r.status === 200) { msg.value = "Booking cancelled — the time is free again."; await loadPtm(); }
}
async function deletePtm(slot) {
  if (!confirm(`Delete PTM "${slot.title}" and all its bookings?`)) return;
  const r = await api(`/schools/${sid}/ptm/${slot.id}`, { method: "DELETE" });
  if (r.status === 200) await loadPtm();
}
onMounted(async () => {
  if (isParent) {
    const c = await api(`/schools/${sid}/my-children`);
    if (c.status === 200) { children.value = c.json.children || []; if (children.value.length) form.value.studentId = children.value[0].id; }
  } else {
    // Phase 51: staff bhi ticket ko student se jod sake — form ke
    // 'Student' select ke liye students + class labels lao.
    const [sr, cr] = await Promise.all([api(`/schools/${sid}/students`), api(`/schools/${sid}/classrooms`)]);
    if (cr.status === 200) classMap.value = Object.fromEntries((cr.json.classrooms || []).map((c) => [c.id, classLabel(c)]));
    if (sr.status === 200) students.value = sr.json.students || [];
  }
  await loadTickets();
  await loadPtm();
});
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">🎫 Support & PTM</h1>
    <p class="text-sm text-slate-500 mb-4">{{ isParent ? "Ask the school anything, and book your parent-teacher meeting time here." : "Answer parent queries and manage PTM bookings." }}</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <!-- NEW TICKET -->
    <form class="card grid gap-3 mb-4" @submit.prevent="createTicket">
      <h2 class="font-bold">{{ isParent ? "Raise a query / complaint" : "New ticket" }}</h2>
      <div class="grid md:grid-cols-3 gap-3">
        <div v-if="isParent"><label class="label">About child</label>
          <select v-model="form.studentId" class="input">
            <option v-for="c in children" :key="c.id" :value="c.id">{{ c.fullName }} — {{ classLabel(c.classroom) }}</option>
          </select>
        </div>
        <div v-else><label class="label">Student</label>
          <select v-model="form.studentId" class="input">
            <option value="">General — no specific student</option>
            <option v-for="s in students" :key="s.id" :value="s.id">{{ s.fullName }} — {{ classMap[s.classroomId] || "No class" }}</option>
          </select>
        </div>
        <div><label class="label">Category</label>
          <select v-model="form.category" class="input">
            <option>GENERAL</option><option>FEES</option><option>TRANSPORT</option><option>ACADEMIC</option><option>OTHER</option>
          </select>
        </div>
        <div><label class="label">Subject</label><input v-model="form.subject" class="input" required placeholder="e.g. Bus route change request" /></div>
      </div>
      <div v-if="isParent"><label class="label">Send to</label>
        <div class="flex gap-2">
          <button type="button" class="btn flex-1 !py-2.5" :class="form.audience === 'OFFICE' ? 'btn-primary' : 'btn-ghost'" @click="form.audience = 'OFFICE'">🏫 School Office</button>
          <button type="button" class="btn flex-1 !py-2.5" :class="form.audience === 'TEACHER' ? 'btn-primary' : 'btn-ghost'" @click="form.audience = 'TEACHER'">👩‍🏫 Class Teacher</button>
        </div>
        <p class="text-xs text-slate-400 mt-1">{{ form.audience === 'TEACHER' ? "Class work, leave or studies — goes straight to your child's class teacher." : "Fees, bus or office matters — goes to the school office." }}</p>
      </div>
      <div><label class="label">Message</label><textarea v-model="form.body" class="input" rows="2" required placeholder="Write your query in detail…"></textarea></div>
      <button class="btn btn-primary">Submit ticket</button>
    </form>

    <!-- TICKET LIST + THREAD -->
    <div class="grid md:grid-cols-2 gap-4 mb-4">
      <div class="grid gap-2 content-start">
        <template v-for="sec in sections" :key="sec.key">
          <h3 class="font-bold text-sm mt-1">{{ sec.title }}</h3>
          <div v-for="t in sec.list" :key="t.id" class="card !py-3 cursor-pointer" :class="{ 'ring-2 ring-brand-500': open?.id === t.id }" @click="openTicket(t)">
            <div class="flex items-center gap-2">
              <span class="font-bold text-sm">#{{ t.ticketNo }}</span>
              <span class="font-semibold text-sm truncate">{{ t.subject }}</span>
              <span class="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full" :class="STATUS_CLS[t.status]">{{ t.status.replace("_", " ") }}</span>
            </div>
            <div class="text-xs text-slate-400 mt-0.5">{{ t.category }}<span v-if="t.studentName"> · {{ t.studentName }}<span v-if="t.studentClass"> · {{ t.studentClass }}</span></span><span v-else> · General</span> · {{ String(t.updatedAt).slice(0, 10) }}</div>
            <div v-if="t.classTeacher" class="text-xs text-slate-400 mt-0.5">👩‍🏫 Class teacher: {{ t.classTeacher }}</div>
          </div>
        </template>
        <p v-if="loading" class="card text-sm text-slate-400 animate-pulse">Loading tickets…</p>
        <p v-else-if="!tickets.length" class="card text-sm text-slate-400">No tickets yet.</p>
      </div>

      <div v-if="open" class="card content-start">
        <div class="flex items-center gap-2 mb-2">
          <h3 class="font-bold text-sm">#{{ open.ticketNo }} — {{ open.subject }}</h3>
          <span class="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full" :class="STATUS_CLS[open.status]">{{ open.status.replace("_", " ") }}</span>
        </div>
        <div v-if="open.studentName" class="text-xs text-slate-500 mb-2">🎓 {{ open.studentName }}<span v-if="open.studentClass"> · {{ open.studentClass }}</span><span v-if="open.classTeacher"> · 👩‍🏫 Class teacher: {{ open.classTeacher }}</span></div>
        <div v-else class="text-xs text-slate-400 mb-2">General ticket — no specific student</div>
        <div class="text-xs text-slate-400 mb-2">Sent to: {{ open.audience === 'TEACHER' ? '👩‍🏫 Class Teacher' : '🏫 School Office' }}</div>
        <div class="grid gap-2 max-h-80 overflow-y-auto mb-3">
          <div v-for="m in thread" :key="m.id" class="rounded-xl px-3 py-2 text-sm" :class="m.isStaff ? 'bg-brand-50 ml-6' : 'bg-slate-50 mr-6'">
            <div class="text-[11px] font-bold text-slate-400">{{ m.authorName }} · {{ m.isStaff ? "School" : "Parent" }} · {{ String(m.createdAt).slice(0, 16).replace("T", " ") }}</div>
            <div>{{ m.body }}</div>
          </div>
        </div>
        <div v-if="open.status !== 'CLOSED'" class="flex gap-2">
          <input v-model="reply" class="input" placeholder="Type a reply…" @keyup.enter="sendReply" />
          <button class="btn btn-primary" @click="sendReply">Send</button>
        </div>
        <div class="flex flex-wrap gap-2 mt-3">
          <button v-if="!isParent && open.status !== 'RESOLVED'" class="btn btn-ghost !py-1.5 text-xs" @click="setStatus('RESOLVED')">Mark resolved</button>
          <button v-if="!isParent && open.status !== 'IN_PROGRESS'" class="btn btn-ghost !py-1.5 text-xs" @click="setStatus('IN_PROGRESS')">In progress</button>
          <button v-if="open.status !== 'CLOSED'" class="btn btn-ghost !py-1.5 text-xs text-red-600" @click="setStatus('CLOSED')">Close ticket</button>
          <button v-if="!isParent && open.status === 'CLOSED'" class="btn btn-ghost !py-1.5 text-xs" @click="setStatus('OPEN')">Reopen</button>
        </div>
      </div>
    </div>

    <!-- PTM -->
    <section class="card">
      <h2 class="font-bold mb-3">👨‍👩‍👧 Parent-Teacher Meetings</h2>
      <div class="grid gap-3">
        <div v-for="s in ptms" :key="s.id" class="border border-slate-100 rounded-2xl p-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-sm">{{ s.title }}</span>
            <span class="text-xs text-slate-400">{{ String(s.date).slice(0, 10) }} · {{ s.startTime }}–{{ s.endTime }} · {{ s.slotMinutes }} min slots</span>
            <button v-if="isManager" class="ml-auto text-xs text-red-500 font-semibold" @click="deletePtm(s)">Delete PTM</button>
          </div>
          <div v-if="s.myBookings.length" class="mt-2 grid gap-1">
            <div v-for="b in s.myBookings" :key="b.id" class="text-sm bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 flex items-center gap-2">
              ✅ Booked: <b>{{ b.studentName }}</b> at <b>{{ b.startTime }}</b>
              <button class="ml-auto text-xs text-red-500 font-semibold" @click="cancelBooking(b.id)">Cancel</button>
            </div>
          </div>
          <div v-if="isParent" class="mt-2 flex flex-wrap items-end gap-2">
            <div><label class="label">Child</label>
              <select v-model="bookChild[s.id]" class="input !w-auto">
                <option v-for="c in children" :key="c.id" :value="c.id">{{ c.fullName }}</option>
              </select>
            </div>
            <div class="flex flex-wrap gap-1">
              <button v-for="t in s.times" :key="t" class="btn !py-1.5 !px-2.5 text-xs"
                :class="bookTime[s.id] === t ? 'btn-primary' : 'btn-ghost'"
                :disabled="s.takenTimes.includes(t)"
                @click="bookTime[s.id] = t">{{ t }}{{ s.takenTimes.includes(t) ? " ✕" : "" }}</button>
            </div>
            <button class="btn btn-primary !py-2" @click="book(s)">Book</button>
          </div>
        </div>
        <p v-if="loading" class="text-sm text-slate-400 animate-pulse">Loading PTMs…</p>
        <p v-else-if="!ptms.length" class="text-sm text-slate-400">No PTM scheduled right now.</p>
      </div>

      <form v-if="isManager" class="grid md:grid-cols-3 gap-2 mt-4 border-t border-slate-100 pt-3" @submit.prevent="createPtm">
        <input v-model="ptmForm.title" class="input" placeholder="PTM title — e.g. October PTM" required />
        <input v-model="ptmForm.date" type="date" class="input" required />
        <select v-model="ptmForm.classroomId" class="input">
          <option value="">Whole school</option>
          <option v-for="c in classes" :key="c.id" :value="c.id">Class {{ c.name }}{{ c.section ? "-" + c.section : "" }} only</option>
        </select>
        <input v-model="ptmForm.startTime" type="time" class="input" required />
        <input v-model="ptmForm.endTime" type="time" class="input" required />
        <input v-model.number="ptmForm.slotMinutes" type="number" min="5" max="120" class="input" placeholder="Minutes per meeting" required />
        <button class="btn btn-primary md:col-span-3">Create PTM</button>
      </form>
    </section>
  </div>
</template>
