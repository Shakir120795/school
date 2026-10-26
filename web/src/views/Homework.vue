<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";

// Homework (Phase 14). Teachers assign to their classes and track
// completions; parents see homework per child and mark it done.
const role = session.membership?.role;
const isStaff = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"].includes(role);
const sid = session.schoolId;
const msg = ref("");
const err = ref("");
const list = ref([]);
const children = ref([]);
const classes = ref([]);
const subjects = ref([]);
const form = ref({ classroomId: "", subjectId: "", title: "", description: "", dueDate: "", attachmentUrl: "" });
const expanded = ref(null);
const completionDetail = ref(null);

const todayStr = new Date().toISOString().slice(0, 10);
function dueBadge(h) {
  const due = (h.dueDate || "").slice(0, 10);
  if (due < todayStr) return { text: `Overdue · ${due}`, cls: "bg-rose-50 text-rose-600" };
  if (due === todayStr) return { text: "Due today", cls: "bg-amber-50 text-amber-600" };
  return { text: `Due ${due}`, cls: "bg-slate-100 text-slate-500" };
}

async function load() {
  const r = await api(`/schools/${sid}/homework`);
  if (r.status === 200) {
    list.value = r.json.homework || [];
    children.value = r.json.children || [];
  }
}
async function loadMeta() {
  const [c, s] = await Promise.all([api(`/schools/${sid}/rollcall/classes`), api(`/schools/${sid}/subjects`)]);
  if (c.status === 200) { classes.value = c.json.classes; if (classes.value.length) form.value.classroomId = classes.value[0].id; }
  if (s.status === 200) subjects.value = s.json.subjects || [];
}
async function create() {
  err.value = ""; msg.value = "";
  const body = { ...form.value, subjectId: form.value.subjectId || undefined, attachmentUrl: form.value.attachmentUrl || undefined };
  const r = await api(`/schools/${sid}/homework`, { method: "POST", body });
  if (r.status === 201) {
    msg.value = "Homework assigned — parents of this class have been notified in the app.";
    form.value.title = ""; form.value.description = ""; form.value.attachmentUrl = "";
    await load();
  } else err.value = r.json?.error || "Could not assign homework";
}
async function toggleDetail(h) {
  if (expanded.value === h.id) { expanded.value = null; completionDetail.value = null; return; }
  expanded.value = h.id;
  const r = await api(`/schools/${sid}/homework/${h.id}/completions`);
  if (r.status === 200) completionDetail.value = r.json;
}
async function removeHw(h) {
  if (!confirm(`Delete homework "${h.title}"?`)) return;
  const r = await api(`/schools/${sid}/homework/${h.id}`, { method: "DELETE" });
  if (r.status === 200) { msg.value = "Homework deleted."; await load(); }
  else err.value = r.json?.error || "Delete failed";
}
async function toggleDone(h, child) {
  const r = await api(`/schools/${sid}/homework/${h.id}/complete`, { method: "POST", body: { studentId: child.studentId } });
  if (r.status === 200) {
    child.done = r.json.done;
  } else err.value = r.json?.error || "Could not update";
}
onMounted(async () => { await load(); if (isStaff) await loadMeta(); });
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">📚 Homework</h1>
    <p class="text-sm text-slate-500 mb-4">{{ isStaff ? "Assign homework to your class — parents are notified instantly in the app." : "Homework for your children. Mark it done when finished." }}</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <form v-if="isStaff" class="card grid gap-3 mb-5" @submit.prevent="create">
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="label">Class</label>
          <select v-model="form.classroomId" class="input" required>
            <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}{{ c.section ? "-" + c.section : "" }}</option>
          </select>
        </div>
        <div><label class="label">Subject (optional)</label>
          <select v-model="form.subjectId" class="input">
            <option value="">No subject</option>
            <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
      </div>
      <div><label class="label">Title</label><input v-model="form.title" class="input" required placeholder="e.g. Maths chapter 4 — exercises 1 to 10" /></div>
      <div><label class="label">Details (optional)</label><textarea v-model="form.description" class="input" rows="2" placeholder="Instructions for students/parents"></textarea></div>
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="label">Due date</label><input v-model="form.dueDate" type="date" class="input" required /></div>
        <div><label class="label">Attachment link (optional)</label><input v-model="form.attachmentUrl" class="input" placeholder="https://… (worksheet/photo link)" /></div>
      </div>
      <button class="btn btn-primary">Assign homework</button>
    </form>

    <div class="grid gap-3">
      <div v-for="h in list" :key="h.id" class="card !py-3">
        <div class="flex flex-wrap items-start gap-2">
          <div class="min-w-0">
            <div class="font-semibold">{{ h.title }}</div>
            <div class="text-xs text-slate-400">
              Class {{ h.classroom?.name }}{{ h.classroom?.section ? "-" + h.classroom.section : "" }}
              <span v-if="h.subject"> · {{ h.subject.name }}</span>
            </div>
            <p v-if="h.description" class="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{{ h.description }}</p>
            <a v-if="h.attachmentUrl" :href="h.attachmentUrl" target="_blank" rel="noopener" class="text-sm text-brand-700 font-semibold">📎 Attachment</a>
          </div>
          <span class="ml-auto text-xs font-bold px-2 py-1 rounded-full" :class="dueBadge(h).cls">{{ dueBadge(h).text }}</span>
        </div>

        <!-- staff completion tracking -->
        <div v-if="isStaff" class="mt-2 flex items-center gap-2">
          <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div class="h-full bg-emerald-500" :style="{ width: h.classSize ? Math.round((h.completedCount / h.classSize) * 100) + '%' : '0%' }"></div>
          </div>
          <span class="text-xs text-slate-500 font-semibold">{{ h.completedCount }}/{{ h.classSize }} done</span>
          <button class="btn btn-ghost !py-1 !px-2 text-xs" @click="toggleDetail(h)">{{ expanded === h.id ? "Hide" : "Who's done?" }}</button>
          <button class="btn btn-ghost !py-1 !px-2 text-xs text-red-600" @click="removeHw(h)">Delete</button>
        </div>
        <div v-if="isStaff && expanded === h.id && completionDetail" class="mt-2 border-t border-slate-100 pt-2 grid gap-1">
          <div v-for="s in completionDetail.students" :key="s.id" class="text-sm flex gap-2">
            <span>{{ s.done ? "✅" : "⬜" }}</span><span>{{ s.fullName }}</span>
            <span v-if="s.doneAt" class="ml-auto text-xs text-slate-400">{{ new Date(s.doneAt).toLocaleString() }}</span>
          </div>
        </div>

        <!-- parent per-child done toggles -->
        <div v-if="!isStaff" class="mt-2 grid gap-1.5">
          <div v-for="c in h.forChildren" :key="c.studentId" class="flex items-center gap-2 text-sm">
            <span>🧒 {{ c.fullName }}</span>
            <button class="ml-auto btn !py-1.5" :class="c.done ? 'btn-primary' : 'btn-ghost'" @click="toggleDone(h, c)">
              {{ c.done ? "✓ Done" : "Mark done" }}
            </button>
          </div>
        </div>
      </div>
      <p v-if="!list.length" class="card text-sm text-slate-400">No homework yet.</p>
    </div>
  </div>
</template>
