<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import QRCode from "qrcode";
import { api, session, friendlyError } from "../api.js";
import { usePager, matchStatus } from "../composables/usePager.js";
import Pager from "../components/Pager.vue";
import StudentCard from "../components/StudentCard.vue";

const sid = session.schoolId;
const loading = ref(true);
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
// Phase 60: list pehle, form baad me — Add student form toggle ke peeche.
const showAdd = ref(false);
function onStudentPhoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 256 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    newStudent.value.photoUrl = canvas.toDataURL("image/jpeg", 0.85);
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
}
// Phase 60: Quick admission — student + parent EK submit me
// (pehle 3 alag forms bharne padte thay).
const quick = ref({ admissionNo: "", fullName: "", classroomId: "", parentName: "", parentPhone: "" });
const quickBusy = ref(false);
async function quickAdmission() {
  quickBusy.value = true;
  try {
    const s = await api(`/schools/${sid}/students`, { method: "POST", body: { admissionNo: quick.value.admissionNo, fullName: quick.value.fullName, classroomId: quick.value.classroomId || undefined, academicYearId: years.value[0]?.id } });
    if (s.status !== 201) { note(s); return; }
    const studentId = s.json.student.id;
    if (quick.value.parentName.trim()) {
      const g = await api(`/schools/${sid}/guardians`, { method: "POST", body: { fullName: quick.value.parentName, phone: quick.value.parentPhone || undefined } });
      if (g.status === 201) {
        await api(`/schools/${sid}/students/${studentId}/guardians`, { method: "POST", body: { guardianId: g.json.guardian.id, isPrimary: true } });
        msg.value = `Admission done — ${quick.value.fullName} added and parent ${quick.value.parentName} linked.`;
      } else {
        msg.value = `Student added, but the parent could not be saved (${g.json?.error || g.status}). Link the parent below.`;
      }
    } else {
      msg.value = "Student added.";
    }
    quick.value = { admissionNo: "", fullName: "", classroomId: "", parentName: "", parentPhone: "" };
    load();
  } finally { quickBusy.value = false; }
}
// Edit student (Phase 27): the same detail fields as Add, PATCHed
// via /schools/:id/students/:studentId. Phase 29 WS6: classroomId
// changes are audited class transfers and admissionNo is now
// correctable on the same endpoint (409 ADMISSION_NO_TAKEN when
// another student already has it) — parent login IDs derived
// from the old admission number do NOT change automatically.
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
const editSaving = ref(false);
const editErr = ref("");
async function saveEdit() {
  const e = editing.value;
  editErr.value = "";
  editSaving.value = true;
  try {
    const { id, ...rest } = e;
    const body = { ...rest, admissionNo: (e.admissionNo || "").trim() };
    const r = await api(`/schools/${sid}/students/${id}`, { method: "PATCH", body });
    if (r.status === 200) {
      msg.value = `${e.fullName} updated.`;
      editing.value = null;
      load();
    } else {
      // 409 ADMISSION_NO_TAKEN lands here — shown inline in the form.
      editErr.value = friendlyError(r.json?.error) || `Error ${r.status}`;
    }
  } finally {
    editSaving.value = false;
  }
}
const link = ref({ studentId: "", guardianId: "", isPrimary: false });
const newGuardian = ref({ fullName: "", phone: "", email: "" });
const newTeacher = ref({ email: "", password: "", fullName: "", displayName: "" });
const assign = ref({ teacherId: "", classroomId: "", subjectId: "", academicYearId: "" });
const incharge = ref({ teacherId: "", classroomId: "", academicYearId: "", effectiveFrom: "" });

async function load() {
  loading.value = true;
  try {
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
  } finally {
    loading.value = false;
  }
}
const route = useRoute();
onMounted(async () => {
  const sres = await api(`/schools/${sid}`).catch(() => null);
  if (sres?.json?.school?.name) schoolName.value = sres.json.school.name;
  await load();
  // Phase 38: dashboard se click karke aane par seedha sahi jagah —
  // ?tab=teachers&q=<name> teacher ko filter karke, ?class=<id>
  // us class ke students (parents ke saath) dikhata hai.
  const q = route.query || {};
  if (q.tab === "teachers") tab.value = "teachers";
  if (q.class) stuClass.value = String(q.class);
  if (q.q) {
    if (tab.value === "teachers") teacherQuery.value = String(q.q);
    else stuQuery.value = String(q.q);
  }
});

function note(r, okText) {
  msg.value = r.status < 300 ? okText : (friendlyError(r.json?.error) || `Error ${r.status}`);
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

// Phase 38: alag Guardians tab khatam — child aur parents EK hi
// view me hain. Har student card par uske father/mother/guardian
// ka naam + mobile pehle se dikhta hai, aur students search
// guardian ke naam/phone par bhi match karta hai (upar dekho).
// Guardians ka data ab bhi load hota hai — add/link forms aur
// search text ke liye, jo Students tab ke andar hi hain.
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
      <button class="btn" :class="tab === 'students' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'students'">Students & Parents<span v-if="!loading"> ({{ students.length }})</span></button>
      <button class="btn" :class="tab === 'teachers' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'teachers'">Teachers<span v-if="!loading"> ({{ teachers.length }})</span></button>
    </div>
    <p v-if="tab === 'students'" class="text-sm text-slate-500 mb-4 -mt-2">Every student card shows the child together with their parents — father, mother, guardian name and mobile are on the same card. Search also matches a parent's name or mobile number.</p>

    <div v-if="tab === 'students'">
      <div class="flex flex-wrap gap-2 items-center mb-4">
        <button type="button" class="btn btn-primary" @click="showAdd = !showAdd">{{ showAdd ? "✕ Close form" : "＋ Add student" }}</button>
        <span class="text-xs text-slate-400">Naya admission? Neeche Parents section me <b>Quick admission</b> hai — student + parent ek hi baar me.</span>
      </div>
      <form v-if="showAdd" class="card grid md:grid-cols-4 gap-3 mb-4" @submit.prevent="addStudent">
        <div><label class="label">Admission No</label><input v-model="newStudent.admissionNo" required class="input" /></div>
        <div><label class="label">Full name</label><input v-model="newStudent.fullName" required class="input" /></div>
        <div><label class="label">Roll No (optional)</label><input v-model="newStudent.rollNo" class="input" /></div>
        <div><label class="label">Photo (optional)</label>
          <div class="flex items-center gap-2">
            <img v-if="newStudent.photoUrl" :src="newStudent.photoUrl" class="w-9 h-9 rounded-full object-cover border" alt="" />
            <label class="btn btn-ghost !py-2 cursor-pointer">{{ newStudent.photoUrl ? "Change photo" : "Add photo" }}<input type="file" accept="image/*" class="hidden" @change="onStudentPhoto" /></label>
            <button v-if="newStudent.photoUrl" type="button" class="text-xs text-rose-600 underline" @click="newStudent.photoUrl = ''">Remove</button>
          </div></div>
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
        <div class="md:col-span-4 font-bold">Edit student</div>
        <div><label class="label">Admission No</label><input v-model="editing.admissionNo" required class="input" /></div>
        <div class="md:col-span-3 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 self-end">⚠️ Parent login IDs made from the admission number will NOT change automatically.</div>
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
          <button class="btn btn-primary flex-1" :disabled="editSaving">{{ editSaving ? "Saving…" : "Save changes" }}</button>
          <button type="button" class="btn btn-ghost flex-1" :disabled="editSaving" @click="editing = null">Cancel</button>
        </div>
        <p v-if="editErr" class="md:col-span-4 text-sm text-red-700">Error: {{ editErr }}</p>
      </form>
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
      <div v-if="loading" class="card text-slate-500 animate-pulse mb-4">Loading students…</div>
      <div v-else-if="filteredStudents.length" class="grid sm:grid-cols-2 gap-3">
        <StudentCard v-for="s in stuPager.pageItems.value" :key="s.id" :student="s" :class-label="className(s.classroomId)">
          <template #actions>
            <button type="button" class="btn btn-ghost !py-1.5 text-xs" @click="issueCard({ ownerType: 'STUDENT', studentId: s.id }, s.fullName)">Issue QR card</button>
            <button type="button" class="btn btn-ghost !py-1.5 text-xs" @click="startEdit(s)">Edit details</button>
          </template>
        </StudentCard>
      </div>
      <p v-else class="card text-sm text-slate-400">{{ students.length ? "No students match — try a different search or filter." : "No students yet." }}</p>
      <div v-if="!loading" class="mt-3">
        <Pager :page="stuPager.page.value" :total-pages="stuPager.totalPages.value" :from="stuPager.from.value" :to="stuPager.to.value" :total="stuPager.total.value" @update:page="stuPager.page.value = $event" />
      </div>

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
      <h2 class="font-bold mt-6 mb-1">👨‍👩‍👧 Parents — add or link with a student</h2>
      <p class="text-sm text-slate-500 mb-3">Parents are not a separate list — a parent is always shown with their child above. Add a new parent here, then link them to their student; the parent's name and mobile then appear on that student's card.</p>
      <form class="card grid md:grid-cols-3 gap-3 mb-4 !border-brand-300" @submit.prevent="quickAdmission">
        <div class="md:col-span-3 font-semibold">⚡ Quick admission — student + parent in one go</div>
        <div><label class="label">Admission No</label><input v-model="quick.admissionNo" required class="input" /></div>
        <div><label class="label">Student name</label><input v-model="quick.fullName" required class="input" /></div>
        <div><label class="label">Class</label><select v-model="quick.classroomId" class="input"><option value="">—</option><option v-for="c in classrooms" :key="c.id" :value="c.id">{{ c.name }}-{{ c.section }}</option></select></div>
        <div><label class="label">Parent name</label><input v-model="quick.parentName" class="input" /></div>
        <div><label class="label">Parent mobile</label><input v-model="quick.parentPhone" class="input" /></div>
        <div class="flex items-end"><button class="btn btn-primary w-full" :disabled="quickBusy">{{ quickBusy ? "Saving…" : "Admit student" }}</button></div>
      </form>
      <div class="grid md:grid-cols-2 gap-4">
        <form class="card grid gap-3" @submit.prevent="addGuardian">
          <div class="font-semibold">Add parent (guardian)</div>
          <input v-model="newGuardian.fullName" required class="input" placeholder="Full name" />
          <input v-model="newGuardian.phone" class="input" placeholder="Phone" />
          <input v-model="newGuardian.email" class="input" placeholder="Email" />
          <button class="btn btn-primary">Add parent</button>
        </form>
        <form class="card grid gap-3" @submit.prevent="linkGuardian">
          <div class="font-semibold">Link parent → student</div>
          <select v-model="link.studentId" required class="input"><option value="">Student…</option><option v-for="s in students" :key="s.id" :value="s.id">{{ s.fullName }} ({{ s.admissionNo }})</option></select>
          <select v-model="link.guardianId" required class="input"><option value="">Parent…</option><option v-for="g in guardians" :key="g.id" :value="g.id">{{ g.fullName }}</option></select>
          <label class="text-sm flex gap-2 items-center"><input type="checkbox" v-model="link.isPrimary" /> Primary parent (guardian)</label>
          <button class="btn btn-primary">Link</button>
        </form>
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
        <p v-if="loading" class="text-sm text-slate-400 mt-2 animate-pulse">Loading teachers…</p>
        <p v-else-if="!filteredTeachers.length" class="text-sm text-slate-400 mt-2">{{ teachers.length ? "No teachers match your search." : "No teachers yet." }}</p>
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

  </div>
</template>
