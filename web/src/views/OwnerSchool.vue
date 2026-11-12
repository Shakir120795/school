<script setup>
// Phase 64: owner ka SCHOOL-WISE panel (shakir ki ask) — platform
// dashboard par kisi school ko tap karo to USI school ka pura
// data alag khulta hai, sab mix nahi: kitne students, kitne
// teachers/staff, parents — har list apni search + apni
// pagination (20/50/100 owner khud chune) ke saath. Har member
// ki LOGIN ID (email) saaf dikhti hai; dikkat aaye to owner
// yahi se "View as" karke uski asal screen dekh sakta hai ya
// password reset kar sakta hai, aur nayi login ID bhi yahi se
// banti hai. Data wahi purane platform APIs se aata hai
// (/platform/schools/:id/members + /students) — koi nakli
// rasta nahi.
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, friendlyError } from "../api.js";
import { usePager } from "../composables/usePager.js";
import Pager from "../components/Pager.vue";

const route = useRoute();
const router = useRouter();
const schoolId = route.params.id;

const loading = ref(true);
const err = ref("");
const msg = ref("");
const school = ref(null); // { id, name, slug, status, students, classes } (members wali API se)
const listEntry = ref(null); // /platform/schools wali entry — paisa + admin + rate
const groups = ref({ SCHOOL_ADMIN: [], PRINCIPAL: [], TEACHER: [], STAFF: [], PARENT: [] });
const students = ref([]);

const inr = (paise) => "₹" + ((paise || 0) / 100).toLocaleString("en-IN");
const ROLE_LABEL = { SCHOOL_ADMIN: "School Admin", PRINCIPAL: "Principal", TEACHER: "Teacher", STAFF: "Staff", PARENT: "Parent" };
const ROLE_CHIP = {
  SCHOOL_ADMIN: "bg-indigo-100 text-indigo-700", PRINCIPAL: "bg-indigo-100 text-indigo-700",
  TEACHER: "bg-emerald-100 text-emerald-700", STAFF: "bg-teal-100 text-teal-700", PARENT: "bg-sky-100 text-sky-700",
};

const staffItems = computed(() => [
  ...(groups.value.SCHOOL_ADMIN || []), ...(groups.value.PRINCIPAL || []),
  ...(groups.value.TEACHER || []), ...(groups.value.STAFF || []),
]);
const parentItems = computed(() => groups.value.PARENT || []);
const counts = computed(() => ({
  students: school.value?.students ?? students.value.length,
  teachers: (groups.value.TEACHER || []).length,
  staff: (groups.value.STAFF || []).length,
  parents: parentItems.value.length,
  classes: school.value?.classes ?? 0,
}));

async function load() {
  loading.value = true; err.value = "";
  try {
    const [m, s, l] = await Promise.all([
      api(`/platform/schools/${schoolId}/members`, { school: false }),
      api(`/platform/schools/${schoolId}/students`, { school: false }),
      api("/platform/schools", { school: false }),
    ]);
    if (m.status !== 200) { err.value = friendlyError(m.json?.error) || "Could not load this school."; return; }
    school.value = m.json.school;
    groups.value = m.json.members || groups.value;
    if (s.status === 200) students.value = s.json.students || [];
    if (l.status === 200) listEntry.value = (l.json.schools || []).find((x) => x.id === schoolId) || null;
  } catch {
    err.value = "Could not load this school — check the connection and reload.";
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// --- Tabs + search + pagination (page size owner khud chune) ---
const tab = ref("staff");
const pageSize = ref(20);
const qStaff = ref(""); const qParents = ref(""); const qStudents = ref("");
const match = (q, parts) => !q || parts.filter(Boolean).join(" ").toLowerCase().includes(q.trim().toLowerCase());
const staffFiltered = computed(() => staffItems.value.filter((m) => match(qStaff.value, [m.fullName, m.email, m.phone, m.role])));
const parentsFiltered = computed(() => parentItems.value.filter((m) => match(qParents.value, [m.fullName, m.email, m.phone, ...((m.children || []).flatMap((c) => [c.name, c.classLabel]))])));
const studentsFiltered = computed(() => students.value.filter((s) => match(qStudents.value, [s.fullName, s.admissionNo, s.classLabel, s.guardianName, s.guardianPhone])));
const staffPager = usePager(staffFiltered, pageSize);
const parentsPager = usePager(parentsFiltered, pageSize);
const studentsPager = usePager(studentsFiltered, pageSize);

// --- View as: server se asal login jaisa session, naye tab me ---
const viewAsBusy = ref("");
async function viewAs(m) {
  viewAsBusy.value = m.membershipId; err.value = ""; msg.value = "";
  // Naya khali tab pehle hi kholo (click ke saath) — warna
  // browser ka popup blocker fetch ke baad khulne wala tab rok
  // deta hai.
  const w = window.open("", "_blank");
  try {
    const r = await api(`/platform/schools/${schoolId}/members/${m.membershipId}/view-as`, { method: "POST", school: false, body: {} });
    if (r.status !== 200) { err.value = friendlyError(r.json?.error) || "View as failed."; if (w) w.close(); return; }
    const k = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
    localStorage.setItem(`ss_viewas_${k}`, JSON.stringify({ payload: r.json, ts: Date.now() }));
    if (w) w.location.href = `/view-as?k=${k}`;
    else window.open(`/view-as?k=${k}`, "_blank");
    msg.value = `Viewing as ${m.fullName} (${ROLE_LABEL[m.role] || m.role}) — a new tab has opened with their account. This is recorded in the activity log.`;
  } finally {
    viewAsBusy.value = "";
  }
}

// --- Password reset (inline) ---
const resetId = ref("");
const resetPw = ref("");
const resetBusy = ref(false);
async function doReset(m) {
  if (resetPw.value.length < 8) { err.value = "New password must be at least 8 characters."; return; }
  resetBusy.value = true; err.value = ""; msg.value = "";
  try {
    const r = await api(`/platform/schools/${schoolId}/members/${m.membershipId}/reset-password`, { method: "POST", school: false, body: { newPassword: resetPw.value } });
    if (r.status === 200) {
      msg.value = `Password reset for ${m.fullName}. Their old sessions are signed out — give them the new password.`;
      resetId.value = ""; resetPw.value = "";
    } else err.value = friendlyError(r.json?.error) || "Reset failed.";
  } finally {
    resetBusy.value = false;
  }
}

// --- Nayi login ID banana (Console wala hi API) ---
const showAdd = ref(false);
const addForm = ref({ fullName: "", email: "", password: "", phone: "", role: "TEACHER", guardianPhone: "" });
const addBusy = ref(false);
async function addMember() {
  addBusy.value = true; err.value = ""; msg.value = "";
  try {
    const r = await api(`/platform/schools/${schoolId}/members`, { method: "POST", school: false, body: { ...addForm.value } });
    if (r.status === 201) {
      msg.value = `${addForm.value.fullName} added as ${ROLE_LABEL[addForm.value.role] || addForm.value.role} — login ID: ${addForm.value.email}.` + (r.json.guardiansLinked ? ` Linked to ${r.json.guardiansLinked} guardian record(s) — children visible.` : "");
      addForm.value = { fullName: "", email: "", password: "", phone: "", role: "TEACHER", guardianPhone: "" };
      showAdd.value = false;
      await load();
    } else err.value = friendlyError(r.json?.error) || "Could not add the login ID.";
  } finally {
    addBusy.value = false;
  }
}
</script>

<template>
  <div>
    <button type="button" class="text-sm font-bold text-brand-700 mb-3" @click="router.push('/')">← All schools</button>

    <div v-if="loading" class="card text-slate-500">Loading school…</div>
    <p v-else-if="err && !school" class="card text-sm text-red-700 !bg-red-50 !border-red-200">{{ err }}</p>

    <template v-else-if="school">
      <!-- School ki pehchan -->
      <div class="card mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-extrabold tracking-tight">{{ school.name }}</h1>
          <span class="text-xs text-slate-400">{{ school.slug }}</span>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="school.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'">{{ school.status }}</span>
        </div>
        <p class="text-sm text-slate-500 mt-1">
          Admin: <span class="font-medium text-slate-700">{{ listEntry?.adminName || "—" }}</span>
          <span v-if="listEntry?.adminEmail"> · Login ID: {{ listEntry.adminEmail }}</span>
          <span v-if="listEntry?.createdAt"> · Since {{ String(listEntry.createdAt).slice(0, 10) }}</span>
        </p>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3 text-center">
          <div class="rounded-2xl bg-slate-50 py-2.5"><div class="text-xl font-extrabold">🎓 {{ counts.students }}</div><div class="text-[11px] text-slate-500 font-medium">Students</div></div>
          <div class="rounded-2xl bg-slate-50 py-2.5"><div class="text-xl font-extrabold">👩‍🏫 {{ counts.teachers }}</div><div class="text-[11px] text-slate-500 font-medium">Teachers</div></div>
          <div class="rounded-2xl bg-slate-50 py-2.5"><div class="text-xl font-extrabold">🧑‍💼 {{ counts.staff }}</div><div class="text-[11px] text-slate-500 font-medium">Staff</div></div>
          <div class="rounded-2xl bg-slate-50 py-2.5"><div class="text-xl font-extrabold">👨‍👩‍👧 {{ counts.parents }}</div><div class="text-[11px] text-slate-500 font-medium">Parents</div></div>
          <div class="rounded-2xl bg-slate-50 py-2.5"><div class="text-xl font-extrabold">🏫 {{ counts.classes }}</div><div class="text-[11px] text-slate-500 font-medium">Classes</div></div>
        </div>
        <div v-if="listEntry && listEntry.totalChargePaise != null" class="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm">
          <span>💰 Charge: <b>{{ inr(listEntry.totalChargePaise) }}</b><span class="text-slate-400" v-if="listEntry.perStudentRatePaise != null"> ({{ inr(listEntry.perStudentRatePaise) }}/student)</span></span>
          <span class="text-emerald-700">✅ Received: <b>{{ inr(listEntry.receivedPaise) }}</b></span>
          <span class="text-rose-600">⏳ Due: <b>{{ inr(listEntry.balancePaise) }}</b></span>
          <button type="button" class="font-bold text-brand-700 ml-auto" @click="router.push({ path: '/console', query: { school: schoolId } })">Console me kholo →</button>
        </div>
      </div>

      <p v-if="msg" class="card text-sm text-emerald-800 !bg-emerald-50 !border-emerald-200 mb-4">{{ msg }}</p>
      <p v-if="err" class="card text-sm text-red-700 !bg-red-50 !border-red-200 mb-4">{{ err }}</p>

      <!-- Nayi login ID -->
      <div class="card mb-4">
        <button type="button" class="font-bold w-full text-left" @click="showAdd = !showAdd">➕ Add a login ID (teacher / staff / parent) {{ showAdd ? "▴" : "▾" }}</button>
        <form v-if="showAdd" class="grid sm:grid-cols-2 gap-3 mt-3" @submit.prevent="addMember">
          <div><label class="label">Full name</label><input v-model="addForm.fullName" class="input" required /></div>
          <div><label class="label">Role</label>
            <select v-model="addForm.role" class="input">
              <option value="TEACHER">Teacher</option><option value="STAFF">Staff</option>
              <option value="PARENT">Parent</option><option value="SCHOOL_ADMIN">School Admin</option>
            </select>
          </div>
          <div><label class="label">Login ID (email)</label><input v-model="addForm.email" class="input" type="email" required /></div>
          <div><label class="label">Password (min 8)</label><input v-model="addForm.password" class="input" type="text" required minlength="8" /></div>
          <div><label class="label">Phone</label><input v-model="addForm.phone" class="input" /></div>
          <div v-if="addForm.role === 'PARENT'"><label class="label">Guardian phone (bachche se jodne ke liye — school ke record wala number)</label><input v-model="addForm.guardianPhone" class="input" /></div>
          <div class="sm:col-span-2"><button class="btn btn-primary" :disabled="addBusy">{{ addBusy ? "Adding…" : "Add login ID" }}</button></div>
        </form>
      </div>

      <!-- Tabs -->
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" class="!w-auto !py-2 text-sm" :class="tab === 'staff' ? 'btn btn-primary' : 'btn btn-ghost'" @click="tab = 'staff'">👩‍🏫 Teachers &amp; Staff ({{ staffItems.length }})</button>
        <button type="button" class="!w-auto !py-2 text-sm" :class="tab === 'parents' ? 'btn btn-primary' : 'btn btn-ghost'" @click="tab = 'parents'">👨‍👩‍👧 Parents ({{ parentItems.length }})</button>
        <button type="button" class="!w-auto !py-2 text-sm" :class="tab === 'students' ? 'btn btn-primary' : 'btn btn-ghost'" @click="tab = 'students'">🎓 Students ({{ students.length }})</button>
        <label class="ml-auto text-xs text-slate-500 flex items-center gap-1.5">Per page
          <select v-model.number="pageSize" class="input !w-auto !py-1.5 !text-xs">
            <option :value="20">20</option><option :value="50">50</option><option :value="100">100</option>
          </select>
        </label>
      </div>

      <!-- Teachers & Staff -->
      <div v-if="tab === 'staff'" class="card">
        <input v-model="qStaff" class="input mb-2" type="search" placeholder="Search name, login ID, phone…" />
        <p v-if="!staffFiltered.length" class="text-sm text-slate-400 py-3">No teachers or staff found.</p>
        <div v-for="m in staffPager.pageItems.value" :key="m.membershipId" class="py-2.5 border-b border-slate-50 last:border-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold text-[15px]">{{ m.fullName }}</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" :class="ROLE_CHIP[m.role]">{{ ROLE_LABEL[m.role] || m.role }}</span>
            <span v-if="m.status !== 'ACTIVE'" class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">{{ m.status }}</span>
            <span class="ml-auto flex gap-1.5">
              <button type="button" class="btn btn-ghost !w-auto !py-1.5 !px-3 text-xs" :disabled="viewAsBusy === m.membershipId" @click="viewAs(m)">👁 {{ viewAsBusy === m.membershipId ? "Opening…" : "View as" }}</button>
              <button type="button" class="btn btn-ghost !w-auto !py-1.5 !px-3 text-xs" @click="resetId = resetId === m.membershipId ? '' : m.membershipId; resetPw = ''">🔑 Reset password</button>
            </span>
          </div>
          <div class="text-sm text-slate-500 mt-0.5">Login ID: <span class="font-medium text-slate-700">{{ m.email || "—" }}</span><span v-if="m.phone"> · 📱 {{ m.phone }}</span></div>
          <form v-if="resetId === m.membershipId" class="flex flex-wrap gap-2 mt-2" @submit.prevent="doReset(m)">
            <input v-model="resetPw" class="input !w-auto flex-1 min-w-44" type="text" placeholder="New password (min 8)" minlength="8" required />
            <button class="btn btn-primary !w-auto !py-2 text-sm" :disabled="resetBusy">{{ resetBusy ? "Setting…" : "Set password" }}</button>
          </form>
        </div>
        <Pager :page="staffPager.page.value" :total-pages="staffPager.totalPages.value" :from="staffPager.from.value" :to="staffPager.to.value" :total="staffPager.total.value" @update:page="(p) => (staffPager.page.value = p)" />
      </div>

      <!-- Parents -->
      <div v-else-if="tab === 'parents'" class="card">
        <input v-model="qParents" class="input mb-2" type="search" placeholder="Search parent, login ID, phone, child name…" />
        <p v-if="!parentsFiltered.length" class="text-sm text-slate-400 py-3">No parents found.</p>
        <div v-for="m in parentsPager.pageItems.value" :key="m.membershipId" class="py-2.5 border-b border-slate-50 last:border-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold text-[15px]">{{ m.fullName }}</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" :class="ROLE_CHIP.PARENT">Parent</span>
            <span v-if="m.status !== 'ACTIVE'" class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">{{ m.status }}</span>
            <span class="ml-auto flex gap-1.5">
              <button type="button" class="btn btn-ghost !w-auto !py-1.5 !px-3 text-xs" :disabled="viewAsBusy === m.membershipId" @click="viewAs(m)">👁 {{ viewAsBusy === m.membershipId ? "Opening…" : "View as" }}</button>
              <button type="button" class="btn btn-ghost !w-auto !py-1.5 !px-3 text-xs" @click="resetId = resetId === m.membershipId ? '' : m.membershipId; resetPw = ''">🔑 Reset password</button>
            </span>
          </div>
          <div class="text-sm text-slate-500 mt-0.5">Login ID: <span class="font-medium text-slate-700">{{ m.email || "—" }}</span><span v-if="m.phone"> · 📱 {{ m.phone }}</span></div>
          <div v-if="m.children && m.children.length" class="flex flex-wrap gap-1.5 mt-1.5">
            <span v-for="c in m.children" :key="c.name + c.classLabel" class="chip bg-slate-100 text-slate-600">🎓 {{ c.name }} · {{ c.classLabel }}</span>
          </div>
          <form v-if="resetId === m.membershipId" class="flex flex-wrap gap-2 mt-2" @submit.prevent="doReset(m)">
            <input v-model="resetPw" class="input !w-auto flex-1 min-w-44" type="text" placeholder="New password (min 8)" minlength="8" required />
            <button class="btn btn-primary !w-auto !py-2 text-sm" :disabled="resetBusy">{{ resetBusy ? "Setting…" : "Set password" }}</button>
          </form>
        </div>
        <Pager :page="parentsPager.page.value" :total-pages="parentsPager.totalPages.value" :from="parentsPager.from.value" :to="parentsPager.to.value" :total="parentsPager.total.value" @update:page="(p) => (parentsPager.page.value = p)" />
      </div>

      <!-- Students -->
      <div v-else class="card">
        <input v-model="qStudents" class="input mb-2" type="search" placeholder="Search student, admission no, class, parent…" />
        <p v-if="!studentsFiltered.length" class="text-sm text-slate-400 py-3">No students found.</p>
        <div v-for="s in studentsPager.pageItems.value" :key="s.id" class="flex flex-wrap items-center gap-2 py-2.5 border-b border-slate-50 last:border-0">
          <span class="font-bold text-[15px]">{{ s.fullName }}</span>
          <span v-if="s.classLabel" class="chip bg-slate-100 text-slate-600">{{ s.classLabel }}</span>
          <span class="text-xs text-slate-400">Adm. {{ s.admissionNo || "—" }}</span>
          <span class="text-sm text-slate-500 ml-auto" v-if="s.guardianName">👨‍👩‍👧 {{ s.guardianName }}<span v-if="s.guardianPhone"> · {{ s.guardianPhone }}</span></span>
        </div>
        <Pager :page="studentsPager.page.value" :total-pages="studentsPager.totalPages.value" :from="studentsPager.from.value" :to="studentsPager.to.value" :total="studentsPager.total.value" @update:page="(p) => (studentsPager.page.value = p)" />
      </div>
    </template>
  </div>
</template>
