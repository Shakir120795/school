<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api, session } from "../api.js";
import { usePager } from "../composables/usePager.js";
import Pager from "../components/Pager.vue";

// Exams & marks (Phase 18). Staff create exams and enter marks;
// parents see the report card only after results are published.
const role = session.membership?.role;
const isParent = role === "PARENT";
const sid = session.schoolId;
const msg = ref("");
const err = ref("");

const classes = ref([]);
const subjects = ref([]);
const exams = ref([]);
const form = ref({ name: "", classroomId: "", subjectId: "", examDate: "", maxMarks: 100 });
const selected = ref(null);
const markRows = ref([]);
const markInputs = ref({});
const children = ref([]);
const reportChild = ref("");
const report = ref(null);

const GRADE_CLS = { "A+": "bg-emerald-500", A: "bg-emerald-400", "B+": "bg-sky-500", B: "bg-sky-400", C: "bg-amber-500", D: "bg-orange-500", F: "bg-rose-500" };

// Marks entry list: search + pagination narrow only the VISIBLE rows.
// Entered marks live in the `markInputs` map keyed by student id, so
// paging/filtering never loses an entered mark; stats and Save always
// run over the FULL markRows list.
const markQuery = ref("");
const visibleMarkRows = computed(() => {
  const q = markQuery.value.trim().toLowerCase();
  if (!q) return markRows.value;
  return markRows.value.filter((s) => `${s.fullName} ${s.admissionNo} ${s.rollNo || ""}`.toLowerCase().includes(q));
});
const markPager = usePager(visibleMarkRows, 25);
watch(markQuery, () => markPager.reset());
watch(selected, () => { markQuery.value = ""; markPager.reset(); });
const stats = computed(() => {
  const vals = markRows.value.filter((r) => r.marksObtained !== null && r.marksObtained !== undefined).map((r) => Number(markInputs.value[r.id] ?? r.marksObtained));
  if (!selected.value || !vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { entered: vals.length, total: markRows.value.length, avgPct: Math.round((avg / selected.value.maxMarks) * 1000) / 10, top: Math.max(...vals) };
});

async function loadStaff() {
  const [c, s, e] = await Promise.all([
    api(`/schools/${sid}/rollcall/classes`),
    api(`/schools/${sid}/subjects`),
    api(`/schools/${sid}/exams`),
  ]);
  if (c.status === 200) { classes.value = c.json.classes; if (classes.value.length && !form.value.classroomId) form.value.classroomId = classes.value[0].id; }
  if (s.status === 200) { subjects.value = s.json.subjects || []; if (subjects.value.length && !form.value.subjectId) form.value.subjectId = subjects.value[0].id; }
  if (e.status === 200) exams.value = e.json.exams;
}
async function createExam() {
  err.value = ""; msg.value = "";
  const r = await api(`/schools/${sid}/exams`, { method: "POST", body: { ...form.value, maxMarks: Number(form.value.maxMarks) } });
  if (r.status === 201) { msg.value = "Exam created. Now enter marks from the list below."; form.value.name = ""; await loadStaff(); }
  else err.value = r.json?.error || "Could not create exam";
}
async function openExam(exam) {
  selected.value = exam;
  const r = await api(`/schools/${sid}/exams/${exam.id}/marks`);
  if (r.status === 200) {
    markRows.value = r.json.students;
    markInputs.value = {};
    for (const s of markRows.value) if (s.marksObtained !== null) markInputs.value[s.id] = s.marksObtained;
  }
}
async function saveMarks() {
  err.value = ""; msg.value = "";
  const entries = Object.entries(markInputs.value)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([studentId, v]) => ({ studentId, marksObtained: Number(v) }));
  if (!entries.length) { err.value = "Enter at least one mark."; return; }
  const r = await api(`/schools/${sid}/exams/${selected.value.id}/marks`, { method: "PUT", body: { marks: entries } });
  if (r.status === 200) { msg.value = `Saved marks for ${r.json.saved} student(s).`; await openExam(selected.value); await loadStaff(); }
  else err.value = r.json?.error || "Could not save marks";
}
async function togglePublish(exam) {
  const r = await api(`/schools/${sid}/exams/${exam.id}/publish`, { method: "PATCH", body: { published: !exam.resultsPublished } });
  if (r.status === 200) { msg.value = !exam.resultsPublished ? "Results published — parents can now see them and have been notified." : "Results hidden from parents."; await loadStaff(); if (selected.value?.id === exam.id) selected.value = r.json.exam; }
  else err.value = r.json?.error || "Publish failed";
}
async function removeExam(exam) {
  if (!confirm(`Delete exam "${exam.name}" and all its marks?`)) return;
  const r = await api(`/schools/${sid}/exams/${exam.id}`, { method: "DELETE" });
  if (r.status === 200) { selected.value = null; await loadStaff(); } else err.value = r.json?.error || "Delete failed";
}
async function loadParent() {
  const c = await api(`/schools/${sid}/my-children`);
  if (c.status === 200) {
    children.value = c.json.children || [];
    if (children.value.length) { reportChild.value = children.value[0].id; await loadReport(); }
  }
}
async function loadReport() {
  const r = await api(`/schools/${sid}/exams/report?studentId=${reportChild.value}`);
  if (r.status === 200) report.value = r.json;
}
onMounted(async () => { if (isParent) await loadParent(); else await loadStaff(); });
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">📝 Exams & Results</h1>
    <p class="text-sm text-slate-500 mb-4">{{ isParent ? "Published results for your child — per exam percentage and grade, with the overall report card." : "Create exams, enter marks, and publish results when ready. Parents see nothing until you publish." }}</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <!-- STAFF -->
    <template v-if="!isParent">
      <form class="card grid gap-3 mb-4" @submit.prevent="createExam">
        <div class="grid md:grid-cols-2 gap-3">
          <div class="md:col-span-2"><label class="label">Exam name</label><input v-model="form.name" class="input" required placeholder="e.g. Unit Test 1, Half Yearly" /></div>
          <div><label class="label">Class</label>
            <select v-model="form.classroomId" class="input" required>
              <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}{{ c.section ? "-" + c.section : "" }}</option>
            </select>
          </div>
          <div><label class="label">Subject</label>
            <select v-model="form.subjectId" class="input" required>
              <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div><label class="label">Exam date</label><input v-model="form.examDate" type="date" class="input" required /></div>
          <div><label class="label">Max marks</label><input v-model="form.maxMarks" type="number" min="1" class="input" required /></div>
        </div>
        <button class="btn btn-primary">Create exam</button>
      </form>

      <div class="grid gap-2 mb-4">
        <div v-for="e in exams" :key="e.id" class="card !py-3 flex flex-wrap items-center gap-2 cursor-pointer" :class="{ 'ring-2 ring-brand-500': selected?.id === e.id }" @click="openExam(e)">
          <div>
            <div class="font-semibold text-sm">{{ e.name }} <span class="text-slate-400 font-normal">· {{ e.subject?.name }} · Class {{ e.classroom?.name }}{{ e.classroom?.section ? "-" + e.classroom.section : "" }}</span></div>
            <div class="text-xs text-slate-400">{{ String(e.examDate).slice(0, 10) }} · Max {{ e.maxMarks }} · Marks entered: {{ e.marksEntered }}</div>
          </div>
          <span class="ml-auto text-xs font-bold px-2 py-1 rounded-full" :class="e.resultsPublished ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'">{{ e.resultsPublished ? "PUBLISHED" : "DRAFT" }}</span>
          <button class="btn btn-ghost !py-1.5" @click.stop="togglePublish(e)">{{ e.resultsPublished ? "Unpublish" : "Publish results" }}</button>
          <button class="btn btn-ghost !py-1.5 text-red-600" @click.stop="removeExam(e)">Delete</button>
        </div>
        <p v-if="!exams.length" class="card text-sm text-slate-400">No exams yet.</p>
      </div>

      <section v-if="selected" class="card">
        <h2 class="font-bold mb-1">Enter marks — {{ selected.name }} ({{ selected.subject?.name }}, max {{ selected.maxMarks }})</h2>
        <p v-if="stats" class="text-sm text-slate-500 mb-3">Entered {{ stats.entered }}/{{ stats.total }} · Class average {{ stats.avgPct }}% · Top score {{ stats.top }}</p>
        <input v-model="markQuery" class="input mb-3" placeholder="Search student by name, admission no, roll no…" />
        <div class="grid gap-1.5">
          <div v-for="s in markPager.pageItems.value" :key="s.id" class="flex items-center gap-2 text-sm border border-slate-100 rounded-xl px-3 py-2">
            <span class="font-medium">{{ s.fullName }}</span>
            <span class="text-xs text-slate-400">{{ s.admissionNo }}<span v-if="s.rollNo"> · Roll {{ s.rollNo }}</span></span>
            <input v-model="markInputs[s.id]" type="number" min="0" :max="selected.maxMarks" step="0.5" class="input !w-28 ml-auto" placeholder="Marks" />
            <span class="text-slate-400 text-xs">/ {{ selected.maxMarks }}</span>
          </div>
          <p v-if="!visibleMarkRows.length" class="text-sm text-slate-400">No students match your search.</p>
        </div>
        <Pager :page="markPager.page.value" :total-pages="markPager.totalPages.value" :from="markPager.from.value" :to="markPager.to.value" :total="markPager.total.value" @update:page="markPager.page.value = $event" />
        <button class="btn btn-primary w-full mt-3 !py-3" @click="saveMarks">Save marks</button>
      </section>
    </template>

    <!-- PARENT REPORT CARD -->
    <template v-else>
      <div v-if="children.length > 1" class="card mb-4">
        <label class="label">Child</label>
        <select v-model="reportChild" class="input" @change="loadReport">
          <option v-for="c in children" :key="c.id" :value="c.id">{{ c.fullName }}</option>
        </select>
      </div>
      <div v-if="report" class="card !p-0 overflow-hidden">
        <div class="bg-gradient-to-r from-brand-700 to-brand-500 text-white p-4">
          <div class="text-xs font-bold opacity-80">REPORT CARD</div>
          <div class="text-lg font-extrabold">{{ report.student.fullName }}</div>
          <div class="text-sm opacity-90">{{ report.student.admissionNo }} · Class {{ report.student.className }}</div>
          <div v-if="report.overall" class="mt-2 flex items-center gap-3">
            <span class="text-3xl font-extrabold">{{ report.overall.percentage }}%</span>
            <span class="text-white text-sm font-bold px-3 py-1 rounded-full" :class="GRADE_CLS[report.overall.grade]">Grade {{ report.overall.grade }}</span>
            <span class="text-sm opacity-90">{{ report.overall.totalObtained }} / {{ report.overall.totalMax }}</span>
          </div>
        </div>
        <div class="p-4 grid gap-1.5">
          <div v-for="r in report.rows" :key="r.examId" class="flex items-center gap-2 text-sm border-b border-slate-50 py-2">
            <div>
              <div class="font-semibold">{{ r.subjectName }}</div>
              <div class="text-xs text-slate-400">{{ r.examName }} · {{ String(r.examDate).slice(0, 10) }}<span v-if="r.remark"> · {{ r.remark }}</span></div>
            </div>
            <span class="ml-auto font-bold">{{ r.marksObtained }} / {{ r.maxMarks }}</span>
            <span class="text-slate-400 text-xs w-14 text-right">{{ r.percentage }}%</span>
            <span class="text-white text-xs font-bold px-2 py-0.5 rounded-full" :class="GRADE_CLS[r.grade]">{{ r.grade }}</span>
          </div>
          <p v-if="!report.rows.length" class="text-sm text-slate-400 py-2">No published results yet. Results appear here once the school publishes them.</p>
        </div>
      </div>
    </template>
  </div>
</template>
