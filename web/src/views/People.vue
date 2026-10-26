<script setup>
import { computed, onMounted, ref, watch } from "vue";
import QRCode from "qrcode";
import { api, session } from "../api.js";
import { usePager, matchStatus } from "../composables/usePager.js";
import Pager from "../components/Pager.vue";
import StudentCard from "../components/StudentCard.vue";

const sid = session.schoolId;
const tab = ref("students");
const students = ref([]);
const teachers = ref([]);
const classrooms = ref([]);
const subjects = ref([]);
const years = ref([]);
const memberships = ref([]);
const guardians = ref([]);
const msg = ref("");
const qrDataUrl = ref("");
const printSelection = ref([]);
const schoolName = ref("Smart School");
const printCards = ref([]);
const qrFor = ref("");

const emptyStudent = () => ({
  admissionNo: "", fullName: "", classroomId: "", academicYearId: "", rollNo: "", photoUrl: "",
  gender: "", dateOfBirth: "", fatherName: "", motherName: "", address: "",
});
const newStudent = ref(emptyStudent());
// Edit student (Phase 27): the same detail fields as Add, PATCHed
// via /schools/:id/students/:studentId. admissionNo is shown but
// never edited (parent logins are derived from it).
const editing = ref(null);
function startEdit(s) {
  editing.value = {
    id: s.id,
    admissionNo: s.admissionNo,
    fullName: s.fullName || "",
    classroomId: s.classroomId || "",
    rollNo: s.rollNo || "",
    photoUrl: s.photoUrl || "",
    gender: s.gender || "",
    dateOfBirth: s.dateOfBirth ? String(s.dateOfBirth).slice(0, 10) : "",
    fatherName: s.fatherName || "",
    motherName: s.motherName || "",
    address: s.address || "",
  };
}
async function saveEdit() {
  const e = editing.value;
  const { id, admissionNo, ...body } = e;
  const r = await api(`/schools/${sid}/students/${id}`, { method: "PATCH", body });
  if (r.status === 200) {
    msg.value = `${e.fullName} updated.`;
    editing.value = null;
    load();
  } else msg.value = `Error: ${r.json.error || r.status}`;
}
const link = ref({ studentId: "", guardianId: "", isPrimary: false });
const newGuardian = ref({ fullName: "", phone: "", email: "" });
const newTeacher = ref({ email: "", password: "", fullName: "", displayName: "" });
const assign = ref({ teacherId: "", classroomId: "", subjectId: "", academicYearId: "" });
const incharge = ref({ teacherId: "", classroomId: "", academicYearId: "", effectiveFrom: "" });

async function load() {
  const [s, t, c, sub, y, m, g] = await Promise.all([
    api(`/schools/${sid}/students`),
    api(`/schools/${sid}/teachers`),
    api(`/schools/${sid}/classrooms`),
    api(`/schools/${sid}/subjects`),
    api(`/schools/${sid}/academic-years`),
    api(`/schools/${sid}/users`),
    api(`/schools/${sid}/guardians`),
  ]);
  students.value = s.json.students || [];
  teachers.value = t.json.teachers || [];
  classrooms.value = c.json.classrooms || [];
  subjects.value = sub.json.subjects || [];
  years.value = y.json.academicYears || [];
  memberships.value = m.json.memberships || [];
  guardians.value = g.json.guardians || [];
}
onMounted(async () => {
  const sres = await api(`/schools/${sid}`).catch(() => null);
  if (sres?.json?.school?.name) schoolName.value = sres.json.school.name;
  await load();
});

function note(r, okText) {
  msg.value = r.status < 300 ? okText : `Error: ${r.json.error || r.status}`;
  if (r.status < 300) load();
}

async function addStudent() {
  const body = {
    ...newStudent.value,
    academicYearId: newStudent.value.academicYearId || years.value[0]?.id,
    classroomId: newStudent.value.classroomId || undefined,
    gender: newStudent.value.gender || undefined,
    dateOfBirth: newStudent.value.dateOfBirth || undefined,
  };
  note(await api(`/schools/${sid}/students`, { method: "POST", body }), "Student added.");
  newStudent.value = emptyStudent();
}
async function addGuardian() {
  note(await api(`/schools/${sid}/guardians`, { method: "POST", body: newGuardian.value }), "Guardian added.");
  newGuardian.value = { fullName: "", phone: "", email: "" };
}
async function linkGuardian() {
  note(await api(`/schools/${sid}/students/${link.value.studentId}/guardians`, { method: "POST", body: { guardianId: link.value.guardianId, isPrimary: link.value.isPrimary } }), "Guardian linked.");
}
async function addTeacher() {
  const u = await api(`/schools/${sid}/users`, {
    method: "POST",
    body: { email: newTeacher.value.email, password: newTeacher.value.password, fullName: newTeacher.value.fullName, role: "TEACHER" },
  });
  if (u.status !== 201) return note(u);
  const list = await api(`/schools/${sid}/users`);
  const membership = (list.json.memberships || []).find((m) => m.userId === u.json.userId);
  const p = await api(`/schools/${sid}/teachers`, {
    method: "POST",
    body: { membershipId: membership.id, displayName: newTeacher.value.displayName || newTeacher.value.fullName },
  });
  note(p, "Teacher added.");
  newTeacher.value = { email: "", password: "", fullName: "", displayName: "" };
}
async function doAssign() {
  note(await api(`/schools/${sid}/teacher-assignments`, { method: "POST", body: { ...assign.value, academicYearId: assign.value.academicYearId || years.value[0]?.id } }), "Assignment saved.");
}
async function doIncharge() {
  note(await api(`/schools/${sid}/class-incharge`, { method: "POST", body: { ...incharge.value, academicYearId: incharge.value.academicYearId || years.value[0]?.id, effectiveFrom: incharge.value.effectiveFrom || new Date().toISOString().slice(0, 10) } }), "Class incharge saved.");
}
async function issueCard(body, label) {
  const r = await api(`/schools/${sid}/cards`, { method: "POST", body });
  if (r.status !== 201) return note(r);
  qrFor.value = label;
  qrDataUrl.value = await QRCode.toDataURL(r.json.qrToken, { width: 220, margin: 1 });
  msg.value = `Card issued for ${label}. Print this QR on the ID card. The token is shown only once.`;
}
async function issueAndPrint() {
  printCards.value = [];
  for (const studentId of printSelection.value) {
    const stu = students.value.find((x) => x.id === studentId);
    const r = await api(`/schools/${sid}/cards`, { method: "POST", body: { ownerType: "STUDENT", studentId } });
    if (r.status === 201) {
      printCards.value.push({
        name: stu.fullName, adm: stu.admissionNo, cls: className(stu.classroomId), roll: stu.rollNo || "", photo: stu.photoUrl || "", 
        qr: await QRCode.toDataURL(r.json.qrToken, { width: 200, margin: 1 }),
      });
    }
  }
  msg.value = printCards.value.length
    ? `${printCards.value.length} card(s) ready below — use Print. Each QR is shown only at issuance.`
    : "No cards issued (check selection).";
}
function printSheet() { window.print(); }
async function revokeCard(id) {
  note(await api(`/schools/${sid}/cards/${id}/revoke`, { method: "POST", body: { reason: "from web" } }), "Card revoked.");
}
function className(id) {
  const c = classrooms.value.find((x) => x.id === id);
  return c ? `${c.name}${c.section ? "-" + c.section : ""}` : "—";
}

// --- Scale-ready list controls (search + filters + 25/page pager) ----
// Students: search matches name / admission no / roll no AND the
// linked guardians' name+phone+email (built from the guardians fetch,
// which carries studentLinks) — no API change needed.
const stuQuery = ref("");
const stuClass = ref("");
const stuStatus = ref(""); // "" all | ACTIVE | INACTIVE
const guardianTextByStudent = computed(() => {
  const map = {};
  for (const g of guardians.value) {
    for (const l of g.studentLinks || []) {
      map[l.studentId] = `${map[l.studentId] || ""} ${g.fullName} ${g.phone || ""} ${g.email || ""}`.trim();
    }
  }
  return map;
});
const filteredStudents = computed(() => {
  const q = stuQuery.value.trim().toLowerCase();
  return students.value.filter((s) => {
    if (q && !`${s.fullName} ${s.admissionNo} ${s.rollNo || ""} ${guardianTextByStudent.value[s.id] || ""}`.toLowerCase().includes(q)) return false;
    if (stuClass.value && s.classroomId !== stuClass.value) return false;
    if (!matchStatus(s.status, stuStatus.value)) return false;
    return true;
  });
});
const stuPager = usePager(filteredStudents, 25);
watch([stuQuery, stuClass, stuStatus], () => stuPager.reset());

// Teachers tab: search by name (a school has ~15–20 teachers, so a
// filter is enough there — no pager needed).
const teacherQuery = ref("");
const filteredTeachers = computed(() => {
  const q = teacherQuery.value.trim().toLowerCase();
  if (!q) return teachers.value;
  return teachers.value.filter((t) => t.displayName.toLowerCase().includes(q));
});

// Guardians tab: guardians grow with students (~1 per student), so
// they get the same search + 25/page pagination as the students list.
const guardQuery = ref("");
const filteredGuardians = computed(() => {
  const q = guardQuery.value.trim().toLowerCase();
  if (!q) return guardians.value;
  return guardians.value.filter((g) => `${g.fullName} ${g.phone || ""} ${g.email || ""}`.toLowerCase().includes(q));
});
const guardPager = usePager(filteredGuardians, 25);
watch(guardQuery, () => guardPager.reset());
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-3">Students & Staff</h1>
    <p v-if="msg" class="card mb-3 !py-2 text-sm">{{ msg }}</p>

    <div v-if="qrDataUrl" class="card mb-4 flex items-center gap-4">
      <img :src="qrDataUrl" alt="QR card" class="w-32 h-32" />
      <div>
        <div class="font-semibold">ID card QR — {{ qrFor }}</div>
        <p class="text-sm text-slate-500">Print and stick/print on the student's existing ID card. If lost, revoke the old card and issue a new one.</p>
        <button class="btn btn-ghost mt-2" @click="qrDataUrl = ''">Close</button>
      </div>
    </div>

    <div class="flex gap-2 mb-4">
      <button class="btn" :class="tab === 'students' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'students'">Students ({{ students.length }})</button>
      <button class="btn" :class="tab === 'teachers' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'teachers'">Teachers ({{ teachers.length }})</button>
      <button class="btn" :class="tab === 'guardians' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'guardians'">Guardians ({{ guardians.length }})</button>
    </div>

    <div v-if="tab === 'students'">
      <form class="card grid md:grid-cols-4 gap-3 mb-4" @submit.prevent="addStudent">
        <div><label class="label">Admission No</label><input v-model="newStudent.admissionNo" required class="input" /></div>
        <div><label class="label">Full name</label><input v-model="newStudent.fullName" required class="input" /></div>
        <div><label class="label">Roll No (optional)</label><input v-model="newStudent.rollNo" class="input" /></div>
        <div><label class="label">Photo URL (optional)</label><input v-model="newStudent.photoUrl" class="input" placeholder="https://…" /></div>
        <div><label class="label">Class</label>
          <select v-model="newStudent.classroomId" class="input"><option value="">—</option><option v-for="c in classrooms" :key="c.id" :value="c.id">{{ c.name }}-{{ c.section }}</option></select></div>
        <div><label class="label">Gender (optional)</label>
          <select v-model="newStudent.gender" class="input"><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select></div>
        <div><label class="label">Date of birth (optional)</label><input v-model="newStudent.dateOfBirth" type="date" class="input" /></div>
        <div><label class="label">Father name (optional)</label><input v-model="newStudent.fatherName" class="input" /></div>
        <div><label class="label">Mother name (optional)</label><input v-model="newStudent.motherName" class="input" /></div>
        <div class="md:col-span-2"><label class="label">Address (optional)</label><input v-model="newStudent.address" class="input" /></div>
        <div class="flex items-end"><button class="btn btn-primary w-full">Add student</button></div>
      </form>
      <form v-if="editing" class="card grid md:grid-cols-4 gap-3 mb-4 !border-brand-300" @submit.prevent="saveEdit">
        <div class="md:col-span-4 font-bold">Edit student — Admission No {{ editing.admissionNo }} (login IDs derive from it, so it cannot change)</div>
        <div><label class="label">Full name</label><input v-model="editing.fullName" required class="input" /></div>
        <div><label class="label">Roll No</label><input v-model="editing.rollNo" class="input" /></div>
        <div><label class="label">Photo URL</label><input v-model="editing.photoUrl" class="input" placeholder="https://…" /></div>
        <div><label class="label">Class</label>
          <select v-model="editing.classroomId" class="input"><option value="">—</option><option v-for="c in classrooms" :key="c.id" :value="c.id">{{ c.name }}-{{ c.section }}</option></select></div>
        <div><label class="label">Gender</label>
          <select v-model="editing.gender" class="input"><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select></div>
        <div><label class="label">Date of birth</label><input v-model="editing.dateOfBirth" type="date" class="input" /></div>
        <div><label class="label">Father name</label><input v-model="editing.fatherName" class="input" /></div>
        <div><label class="label">Mother name</label><input v-model="editing.motherName" class="input" /></div>
        <div class="md:col-span-2"><label class="label">Address</label><input v-model="editing.address" class="input" /></div>
        <div class="flex items-end gap-2">
          <button class="btn btn-primary flex-1">Save changes</button>
          <button type="button" class="btn btn-ghost flex-1" @click="editing = null">Cancel</button>
        </div>
      </form>
      <div class="card mb-4 flex flex-wrap gap-2 items-center">
        <span class="font-semibold text-sm">Bulk ID cards:</span>
        <select v-model="printSelection" multiple class="input !w-64" size="4">
          <option v-for="s in students" :key="s.id" :value="s.id">{{ s.fullName }} ({{ s.admissionNo }})</option>
        </select>
        <button type="button" class="btn btn-primary" @click="issueAndPrint">Issue & prepare print sheet</button>
        <button v-if="printCards.length" type="button" class="btn btn-ghost" @click="printSheet">Print sheet</button>
      </div>
      <div v-if="printCards.length" id="print-sheet" class="card mb-4">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div v-for="c in printCards" :key="c.adm" class="id-card border-2 border-brand-600 rounded-xl p-3 text-center">
            <div class="font-bold text-sm">{{ schoolName }}</div>
            <img v-if="c.photo" :src="c.photo" class="w-16 h-16 rounded-full object-cover mx-auto mb-1 border" alt="Student photo" />
            <img :src="c.qr" class="w-28 h-28 mx-auto" alt="QR" />
            <div class="font-semibold">{{ c.name }}</div>
            <div class="text-xs text-slate-500">Adm {{ c.adm }}<span v-if="c.roll"> · Roll {{ c.roll }}</span> · Class {{ c.cls }}</div>

          </div>
        </div>
      </div>
      <div class="card mb-4 flex flex-wrap gap-2 items-center">
        <input v-model="stuQuery" class="input flex-1 min-w-[200px]" placeholder="Search student, admission no, guardian name / phone…" />
        <select v-model="stuClass" class="input !w-auto">
          <option value="">All classes</option>
          <option v-for="c in classrooms" :key="c.id" :value="c.id">{{ c.name }}-{{ c.section }}</option>
        </select>
        <select v-model="stuStatus" class="input !w-auto">
          <option value="">All status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>
      <div v-if="filteredStudents.length" class="grid sm:grid-cols-2 gap-3">
        <StudentCard v-for="s in stuPager.pageItems.value" :key="s.id" :student="s" :class-label="className(s.classroomId)">
          <template #actions>
            <button type="button" class="btn btn-ghost !py-1.5 text-xs" @click="issueCard({ ownerType: 'STUDENT', studentId: s.id }, s.fullName)">Issue QR card</button>
            <button type="button" class="btn btn-ghost !py-1.5 text-xs" @click="startEdit(s)">Edit details</button>
          </template>
        </StudentCard>
      </div>
      <p v-else class="card text-sm text-slate-400">No students match — try a different search or filter.</p>
      <div class="mt-3">
        <Pager :page="stuPager.page.value" :total-pages="stuPager.totalPages.value" :from="stuPager.from.value" :to="stuPager.to.value" :total="stuPager.total.value" @update:page="stuPager.page.value = $event" />
      </div>
    </div>

    <div v-if="tab === 'teachers'">
      <form class="card grid md:grid-cols-5 gap-3 mb-4" @submit.prevent="addTeacher">
        <div><label class="label">Full name</label><input v-model="newTeacher.fullName" required class="input" /></div>
        <div><label class="label">Email (login)</label><input v-model="newTeacher.email" type="email" required class="input" /></div>
        <div><label class="label">Password</label><input v-model="newTeacher.password" type="password" required class="input" /></div>
        <div><label class="label">Display name (parents see)</label><input v-model="newTeacher.displayName" class="input" /></div>
        <div class="flex items-end"><button class="btn btn-primary w-full">Add teacher</button></div>
      </form>

      <div class="grid md:grid-cols-2 gap-4 mb-4">
        <form class="card grid gap-3" @submit.prevent="doAssign">
          <div class="font-semibold">Assign teacher → class + subject</div>
          <select v-model="assign.teacherId" required class="input"><option value="">Teacher…</option><option v-for="t in teachers" :key="t.id" :value="t.id">{{ t.displayName }}</option></select>
          <select v-model="assign.classroomId" required class="input"><option value="">Class…</option><option v-for="c in classrooms" :key="c.id" :value="c.id">{{ c.name }}-{{ c.section }}</option></select>
          <select v-model="assign.subjectId" required class="input"><option value="">Subject…</option><option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option></select>
          <button class="btn btn-primary">Save assignment</button>
        </form>
        <form class="card grid gap-3" @submit.prevent="doIncharge">
          <div class="font-semibold">Class incharge</div>
          <select v-model="incharge.teacherId" required class="input"><option value="">Teacher…</option><option v-for="t in teachers" :key="t.id" :value="t.id">{{ t.displayName }}</option></select>
          <select v-model="incharge.classroomId" required class="input"><option value="">Class…</option><option v-for="c in classrooms" :key="c.id" :value="c.id">{{ c.name }}-{{ c.section }}</option></select>
          <input v-model="incharge.effectiveFrom" type="date" class="input" />
          <button class="btn btn-primary">Save incharge</button>
        </form>
      </div>

      <div class="card mb-4">
        <input v-model="teacherQuery" class="input" placeholder="Search teacher by name…" />
        <p v-if="!filteredTeachers.length" class="text-sm text-slate-400 mt-2">No teachers match your search.</p>
      </div>
      <div class="grid md:grid-cols-2 gap-3">
        <div v-for="t in filteredTeachers" :key="t.id" class="card">
          <div class="flex items-start gap-3">
            <div class="font-semibold">{{ t.displayName }}</div>
            <span class="badge ml-auto" :class="t.isVisibleToParents ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'">{{ t.isVisibleToParents ? "Visible to parents" : "Hidden" }}</span>
          </div>
          <div class="text-sm text-slate-500 mt-1">
            <span v-for="a in t.classAssignments" :key="a.id" class="mr-2">{{ className(a.classroomId) }} · {{ a.subject?.name }}</span>
            <span v-if="!t.classAssignments?.length">No assignments yet</span>
          </div>
          <div class="text-sm text-brand-700" v-if="t.inchargeAssignments?.length">Incharge: {{ t.inchargeAssignments.map(a => className(a.classroomId)).join(", ") }}</div>
          <button class="btn btn-ghost mt-3 !py-1.5" @click="issueCard({ ownerType: 'STAFF', teacherProfileId: t.id }, t.displayName)">Issue staff QR card</button>
        </div>
      </div>
    </div>

    <div v-if="tab === 'guardians'">
      <div class="grid md:grid-cols-2 gap-4">
        <form class="card grid gap-3" @submit.prevent="addGuardian">
          <div class="font-semibold">Add guardian</div>
          <input v-model="newGuardian.fullName" required class="input" placeholder="Full name" />
          <input v-model="newGuardian.phone" class="input" placeholder="Phone" />
          <input v-model="newGuardian.email" class="input" placeholder="Email" />
          <button class="btn btn-primary">Add guardian</button>
        </form>
        <form class="card grid gap-3" @submit.prevent="linkGuardian">
          <div class="font-semibold">Link guardian → student</div>
          <select v-model="link.studentId" required class="input"><option value="">Student…</option><option v-for="s in students" :key="s.id" :value="s.id">{{ s.fullName }} ({{ s.admissionNo }})</option></select>
          <select v-model="link.guardianId" required class="input"><option value="">Guardian…</option><option v-for="g in guardians" :key="g.id" :value="g.id">{{ g.fullName }}</option></select>
          <label class="text-sm flex gap-2 items-center"><input type="checkbox" v-model="link.isPrimary" /> Primary guardian</label>
          <button class="btn btn-primary">Link</button>
        </form>
      </div>
      <div class="card mt-4 flex flex-wrap gap-2 items-center">
        <input v-model="guardQuery" class="input flex-1 min-w-[200px]" placeholder="Search guardian by name, phone or email…" />
      </div>
      <div class="card mt-4 !p-0 overflow-x-auto">
        <table class="w-full text-sm mtable">
          <thead><tr class="text-left text-slate-500 border-b"><th class="p-3">Name</th><th class="p-3">Phone</th><th class="p-3">Children</th></tr></thead>
          <tbody>
            <tr v-for="g in guardPager.pageItems.value" :key="g.id" class="border-b last:border-0">
              <td class="p-3 font-medium">{{ g.fullName }}</td><td class="p-3">{{ g.phone || "—" }}</td>
              <td class="p-3">{{ (g.studentLinks || []).length }}</td>
            </tr>
            <tr v-if="!filteredGuardians.length"><td class="p-3 text-slate-400" colspan="3">No guardians match your search.</td></tr>
          </tbody>
        </table>
        <div class="px-3 pb-3">
          <Pager :page="guardPager.page.value" :total-pages="guardPager.totalPages.value" :from="guardPager.from.value" :to="guardPager.to.value" :total="guardPager.total.value" @update:page="guardPager.page.value = $event" />
        </div>
      </div>
    </div>
  </div>
</template>
