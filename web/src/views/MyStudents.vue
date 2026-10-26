<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api, session } from "../api.js";
import { usePager } from "../composables/usePager.js";
import Pager from "../components/Pager.vue";
import StudentCard from "../components/StudentCard.vue";

// Teacher "My Students" (Phase 27): a read-only detail view of the
// students in the teacher's own classes — the same big detail cards
// the school office sees on the People page (name, class, admission,
// gender, DOB, father, mother, mobile, address). Until now a
// teacher could only see a compact name/admission roster inside
// the roll-call MARKING screen; this view is deliberately separate
// from it and changes no marking mechanics. The backend already
// scopes GET /schools/:id/students for TEACHER to assigned classes.
const sid = session.schoolId;
const students = ref([]);
const classrooms = ref([]);
const loading = ref(true);
const err = ref("");
const classFilter = ref("");
const query = ref("");

function classLabel(id) {
  const c = classrooms.value.find((x) => x.id === id);
  return c ? `${c.name}${c.section ? "-" + c.section : ""}` : "—";
}
const myClasses = computed(() => {
  const ids = new Set(students.value.map((s) => s.classroomId).filter(Boolean));
  return classrooms.value.filter((c) => ids.has(c.id));
});
const visible = computed(() => {
  let list = students.value;
  if (classFilter.value) list = list.filter((s) => s.classroomId === classFilter.value);
  const q = query.value.trim().toLowerCase();
  if (q) {
    list = list.filter((s) =>
      `${s.fullName} ${s.admissionNo} ${s.rollNo || ""} ${s.fatherName || ""} ${s.motherName || ""}`.toLowerCase().includes(q)
    );
  }
  return list;
});
const pager = usePager(visible, 25);
watch([query, classFilter], () => pager.reset());

async function load() {
  const [s, c] = await Promise.all([api(`/schools/${sid}/students`), api(`/schools/${sid}/classrooms`)]);
  if (s.status === 200) students.value = s.json.students || [];
  else err.value = s.json?.error || "Could not load students";
  classrooms.value = c.json.classrooms || [];
  loading.value = false;
}
onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-extrabold mb-1">🎓 My Students</h1>
    <p class="text-sm text-slate-500 mb-4">Full details of the students in your classes — the same cards the school office sees.</p>

    <div v-if="loading" class="card text-slate-500">Loading…</div>
    <p v-else-if="err" class="card text-sm text-red-700 !bg-red-50 !border-red-200">{{ err }}</p>
    <template v-else>
      <div class="card mb-4 flex flex-wrap gap-2 items-center">
        <select v-model="classFilter" class="input !w-auto">
          <option value="">All my classes</option>
          <option v-for="c in myClasses" :key="c.id" :value="c.id">Class {{ c.name }}<span v-if="c.section">-{{ c.section }}</span></option>
        </select>
        <input v-model="query" class="input flex-1 min-w-[180px]" placeholder="Search student, admission no, parent name…" />
        <span class="text-sm text-slate-500">{{ students.length }} student{{ students.length === 1 ? "" : "s" }} in your classes</span>
      </div>
      <div v-if="visible.length" class="grid sm:grid-cols-2 gap-3">
        <StudentCard v-for="s in pager.pageItems.value" :key="s.id" :student="s" :class-label="classLabel(s.classroomId)" />
      </div>
      <p v-else class="card text-sm text-slate-400">
        {{ students.length ? "No students match your search or class filter." : "No students in your classes yet — ask the school admin to assign your class." }}
      </p>
      <div class="mt-3">
        <Pager :page="pager.page.value" :total-pages="pager.totalPages.value" :from="pager.from.value" :to="pager.to.value" :total="pager.total.value" @update:page="pager.page.value = $event" />
      </div>
    </template>
  </div>
</template>
