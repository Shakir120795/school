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
// Phase 67: REMOVE / DELETE — ye sab Console me thay, is naye
// panel me gayab thay (shakir: "teacher ya parent ka data delete
// krna ho to wo bhi nhi h"). Member remove = soft (login band,
// record activity log me rehta hai); student remove = INACTIVE;
// school delete = permanent, slug type karke confirm.
const removeTarget = ref(null);
const removeReason = ref("LEFT_SCHOOL");
const removeNote = ref("");
const removeBusy = ref(false);
const removeError = ref("");
const REASONS = [
  { v: "LEFT_SCHOOL", label: "School chhod gaya" },
  { v: "RESIGNED", label: "Resign kar diya" },
  { v: "DUPLICATE", label: "Duplicate ID hai" },
  { v: "OTHER", label: "Other (note zaroori)" },
];
function openRemove(m) {
  removeTarget.value = m; removeReason.value = "LEFT_SCHOOL";
  removeNote.value = ""; removeError.value = "";
}
async function confirmRemove() {
  if (!removeTarget.value || removeBusy.value) return;
  if (removeReason.value === "OTHER" && !removeNote.value.trim()) {
    removeError.value = "Other ke liye note likhna zaroori hai.";
    return;
  }
  removeBusy.value = true; removeError.value = "";
  try {
    const r = await api(`/platform/schools/${schoolId}/members/${removeTarget.value.membershipId}`, {
      method: "DELETE", school: false,
      body: { reason: removeReason.value, note: removeNote.value.trim() || undefined },
    });
    if (!r.ok) throw new Error(r.json.error || "failed");
    removeTarget.value.status = "INACTIVE";
    msg.value = `${removeTarget.value.fullName} ko remove kar diya — uski is school ki login band ho gayi hai.`;
    removeTarget.value = null;
  } catch (e) { removeError.value = "Remove nahi hua — dobara try karo."; }
  removeBusy.value = false;
}
async function removeStudentRow(s) {
  if (!confirm(`${s.fullName} ko is school se remove kar dun? Record rehta hai, bas list aur hisab se hat jayega.`)) return;
  const r = await api(`/platform/schools/${schoolId}/students/${s.id}`, { method: "DELETE", school: false });
  if (r.ok) {
    students.value = students.value.filter((x) => x.id !== s.id);
    msg.value = `${s.fullName} remove ho gaya.`;
  } else err.value = "Student remove nahi hua.";
}
// Phase 72: school delete = slug + owner ka LOGIN PASSWORD
// (inline box). Dono sahi hon tabhi button active; server bhi
// password verify karta hai — galti se delete namumkin.
const delOpen = ref(false);
const delSlug = ref("");
const delPassword = ref("");
const delBusy = ref(false);
async function deleteSchool() {
  if (delSlug.value !== school.value.slug || !delPassword.value || delBusy.value) return;
  delBusy.value = true;
  try {
    const r = await api(`/platform/schools/${schoolId}`, { method: "DELETE", school: false, body: { password: delPassword.value } });
    if (r.ok) router.push("/");
    else if (r.json?.error === "WRONG_PASSWORD") { err.value = "Password galat hai — school delete nahi hua."; delPassword.value = ""; }
    else err.value = "Delete nahi hua — dobara try karo.";
  } finally { delBusy.value = false; }
}

// Phase 69: PAYMENT ALERT ab school ke is page se bhi (shakir
// Console me dhund raha tha — alert Hisab tab me tha; ab school
// select karke yahi se bhej sakta hai). Wahi endpoint.
const alertNote = ref("");
const alertBusy = ref(false);
async function sendPaymentAlert() {
  if (alertBusy.value) return;
  if (!confirm(`${school.value.name} ko payment alert bhejun? School ke admin/staff ko bell me dikhega.`)) return;
  alertBusy.value = true;
  try {
    const r = await api(`/platform/schools/${schoolId}/payment-alert`, {
      method: "POST", school: false, body: { note: alertNote.value.trim() || undefined },
    });
    if (r.ok) {
      msg.value = `🔔 Payment alert bhej diya — ${r.json.sentTo} logo ko mila (baaki: ${inr(r.json.duePaise)}).`;
      alertNote.value = "";
    } else {
      err.value = r.json?.error === "HISAB_NOT_SETUP"
        ? "Is school ka hisab setup nahi — Console se Apply database updates chalao."
        : "Alert nahi gaya — dobara try karo.";
    }
  } finally { alertBusy.value = false; }
}

// Phase 69: school admin ko WHATSAPP — ek click me chat khule
// (owner apne WhatsApp se baat karta hai; app bhejti nahi).
const waHref = (phone, name, text) => {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  const msg = text || `Namaste ${name || ""} ji, Smart School platform ke owner ki taraf se — aapke school ke hisab ke baare me baat karni thi.`;
  return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
};
// Phase 70: har member ke number par WhatsApp link — owner ek
// click me kisi ko bhi message kar sake (shakir ki ask).
const memberWa = (m) => waHref(m.phone, m.fullName,
  `Namaste ${m.fullName || ""} ji, Smart School platform ke owner ki taraf se message hai.`);
const adminMember = computed(() => (groups.value.SCHOOL_ADMIN || [])[0] || (groups.value.PRINCIPAL || [])[0] || null);
const adminPhone = computed(() => listEntry.value?.adminPhone || adminMember.value?.phone || null);
const adminWa = computed(() => waHref(adminPhone.value, listEntry.value?.adminName));

onMounted(load);

// --- Tabs + search + pagination (page size owner khud chune) ---
const tab = ref("staff");
// Phase 66: Register tab — class-wise fees/kit summary (owner
// sirf dekhta hai).
const regSummary = ref(null);
const regLoading = ref(false);
async function loadRegister() {
  if (regSummary.value || regLoading.value) return;
  regLoading.value = true;
  try {
    const r = await api(`/platform/schools/${school.value.id}/register-summary`);
    if (r.ok) regSummary.value = r.json;
  } finally { regLoading.value = false; }
}
const regTotals = computed(() => {
  const t = { students: 0, feesDue: 0, examDue: 0, cardPending: 0, tiePending: 0, beltPending: 0, capPending: 0, bagPending: 0 };
  for (const c of regSummary.value?.classes || []) {
    t.students += c.students; t.feesDue += c.feesDue; t.examDue += c.examDue;
    t.cardPending += c.cardPending; t.tiePending += c.tiePending; t.beltPending += c.beltPending;
    t.capPending += c.capPending; t.bagPending += c.bagPending;
  }
  return t;
});
const pageSize = ref(20);
const qStaff = ref(""); const qParents = ref(""); const qStudents = ref("");
const match = (q, parts) => !q || parts.filter(Boolean).join(" ").toLowerCase().includes(q.trim().toLowerCase());
const staffFiltered = computed(() => staffItems.value.filter((m) => match(qStaff.value, [m.fullName, m.email, m.phone, m.role])));
const parentsFiltered = computed(() => parentItems.value.filter((m) => match(qParents.value, [m.fullName, m.email, m.phone, ...((m.children || []).flatMap((c) => [c.name, c.classLabel]))])));
// Phase 65: students CLASS-WISE — pehle naam ke hisaab se
// mile-jule aate thay (shakir: "class wise nhi aa rhe"). Ab
// list class ke hisaab se sort hoti hai (1-A, 1-B, 2-A… phir
// naam) aur upar class wale chips/tabs hain — jis class ko
// chunoge sirf usi ke bacche dikhenge.
const classKey = (label) => {
  const m = String(label || "").match(/(\d+)\s*-\s*(.+)/);
  return m ? [parseInt(m[1], 10), m[2]] : [999, String(label || "")];
};
const studentsSorted = computed(() => [...students.value].sort((a, b) => {
  const [ga, sa] = classKey(a.classLabel); const [gb, sb] = classKey(b.classLabel);
  return ga - gb || String(sa).localeCompare(String(sb)) || a.fullName.localeCompare(b.fullName);
}));
const classFilter = ref("");
const classOptions = computed(() => {
  const map = new Map();
  for (const s of studentsSorted.value) {
    const l = s.classLabel || "—";
    map.set(l, (map.get(l) || 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count }));
});
const studentsFiltered = computed(() => studentsSorted.value.filter((s) =>
  (!classFilter.value || (s.classLabel || "—") === classFilter.value) &&
  match(qStudents.value, [s.fullName, s.admissionNo, s.classLabel, s.guardianName, s.guardianPhone])));
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
          <a v-if="adminWa" :href="adminWa" target="_blank" rel="noopener" class="inline-flex items-center gap-1 ml-1 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-xs font-bold">💬 WhatsApp<span v-if="adminPhone"> · {{ adminPhone }}</span></a>
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
        <div class="flex flex-wrap gap-2 mt-3">
          <input v-model="alertNote" class="input !w-auto flex-1 min-w-[200px] !py-2 text-sm" type="text" placeholder="Payment alert ke saath apna note (optional)" />
          <button type="button" class="btn btn-primary !w-auto !py-2 text-sm" :disabled="alertBusy" @click="sendPaymentAlert">{{ alertBusy ? "Bhej raha hai…" : "🔔 Payment alert bhejo" }}</button>
        </div>
        <p class="text-xs text-slate-400 mt-1.5">Alert is school ke admin/staff ke bell 🔔 me jayega — hisab (charge / mila / baaki) apne aap likha jayega. Yehi button Payment tab me bhi hai.</p>
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
        <button type="button" class="!w-auto !py-2 text-sm" :class="tab === 'register' ? 'btn btn-primary' : 'btn btn-ghost'" @click="tab = 'register'; loadRegister()">📋 Register</button>
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
              <button v-if="m.status === 'ACTIVE'" type="button" class="btn btn-ghost !w-auto !py-1.5 !px-3 text-xs !text-rose-600" @click="openRemove(m)">🗑 Remove</button>
            </span>
          </div>
          <div class="text-sm text-slate-500 mt-0.5">Login ID: <span class="font-medium text-slate-700">{{ m.email || "—" }}</span><span v-if="m.phone"> · 📱 {{ m.phone }}</span><a v-if="memberWa(m)" :href="memberWa(m)" target="_blank" rel="noopener" class="inline-flex items-center ml-2 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[11px] font-bold">💬 WhatsApp</a></div>
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
              <button v-if="m.status === 'ACTIVE'" type="button" class="btn btn-ghost !w-auto !py-1.5 !px-3 text-xs !text-rose-600" @click="openRemove(m)">🗑 Remove</button>
            </span>
          </div>
          <div class="text-sm text-slate-500 mt-0.5">Login ID: <span class="font-medium text-slate-700">{{ m.email || "—" }}</span><span v-if="m.phone"> · 📱 {{ m.phone }}</span><a v-if="memberWa(m)" :href="memberWa(m)" target="_blank" rel="noopener" class="inline-flex items-center ml-2 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[11px] font-bold">💬 WhatsApp</a></div>
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
      <div v-else-if="tab === 'students'" class="card">
        <div class="flex flex-wrap gap-1.5 mb-3">
          <button type="button" class="chip !px-3 !py-1.5 font-bold" :class="classFilter === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'" @click="classFilter = ''; studentsPager.page.value = 1">All classes ({{ students.length }})</button>
          <button v-for="c in classOptions" :key="c.label" type="button" class="chip !px-3 !py-1.5 font-bold" :class="classFilter === c.label ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'" @click="classFilter = c.label; studentsPager.page.value = 1">{{ c.label }} ({{ c.count }})</button>
        </div>
        <input v-model="qStudents" class="input mb-2" type="search" placeholder="Search student, admission no, class, parent…" />
        <p v-if="!studentsFiltered.length" class="text-sm text-slate-400 py-3">No students found.</p>
        <div v-for="s in studentsPager.pageItems.value" :key="s.id" class="flex flex-wrap items-center gap-2 py-2.5 border-b border-slate-50 last:border-0">
          <span class="font-bold text-[15px]">{{ s.fullName }}</span>
          <span v-if="s.classLabel" class="chip bg-slate-100 text-slate-600">{{ s.classLabel }}</span>
          <span class="text-xs text-slate-400">Adm. {{ s.admissionNo || "—" }}</span>
          <span class="text-sm text-slate-500 ml-auto" v-if="s.guardianName">👨‍👩‍👧 {{ s.guardianName }}<span v-if="s.guardianPhone"> · {{ s.guardianPhone }}</span></span>
          <button type="button" class="text-xs font-bold text-rose-600 shrink-0" @click="removeStudentRow(s)">🗑 Remove</button>
        </div>
        <Pager :page="studentsPager.page.value" :total-pages="studentsPager.totalPages.value" :from="studentsPager.from.value" :to="studentsPager.to.value" :total="studentsPager.total.value" @update:page="(p) => (studentsPager.page.value = p)" />
      </div>

      <!-- Phase 66: Register summary — class-wise fees/kit ki
           baaki ginti. Owner sirf dekhta hai. -->
      <div v-else-if="tab === 'register'" class="card">
        <p v-if="regLoading" class="text-sm text-slate-400 animate-pulse">Loading register…</p>
        <template v-else-if="regSummary">
          <p v-if="!regSummary.kitReady" class="text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">⚠️ Kit wale columns abhi live nahi — Console se <b>Apply database updates</b> chalao, phir card/tie/belt/cap/bag ki ginti yahan dikhegi. Fees wali ginti abhi bhi sahi hai.</p>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div class="rounded-xl bg-slate-50 px-3 py-2 text-center"><div class="text-xl font-extrabold">{{ regTotals.students }}</div><div class="text-[11px] text-slate-500 font-semibold">Students</div></div>
            <div class="rounded-xl bg-rose-50 px-3 py-2 text-center"><div class="text-xl font-extrabold text-rose-600">{{ regTotals.feesDue }}</div><div class="text-[11px] text-slate-500 font-semibold">Fees baaki</div></div>
            <div class="rounded-xl bg-rose-50 px-3 py-2 text-center"><div class="text-xl font-extrabold text-rose-600">{{ regTotals.examDue }}</div><div class="text-[11px] text-slate-500 font-semibold">Exam fee baaki</div></div>
            <div class="rounded-xl bg-amber-50 px-3 py-2 text-center"><div class="text-xl font-extrabold text-amber-600">{{ regSummary.kitReady ? regTotals.cardPending : "—" }}</div><div class="text-[11px] text-slate-500 font-semibold">ID card pending</div></div>
          </div>
          <div v-for="c in regSummary.classes" :key="c.classLabel" class="py-2.5 border-b border-slate-50 last:border-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold text-[15px]">{{ c.classLabel }}</span>
              <span class="chip bg-slate-100 text-slate-600">{{ c.students }} students</span>
              <span class="ml-auto flex flex-wrap gap-1.5">
                <span class="chip font-bold" :class="c.feesDue ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'">💳 Fees baaki: {{ c.feesDue }}</span>
                <span class="chip font-bold" :class="c.examDue ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'">📝 Exam baaki: {{ c.examDue }}</span>
              </span>
            </div>
            <div v-if="regSummary.kitReady" class="flex flex-wrap gap-1.5 mt-1.5 text-xs font-semibold text-slate-500">
              <span>🪪 Card pending: <b class="text-slate-700">{{ c.cardPending }}</b></span>·
              <span>👔 Tie: <b class="text-slate-700">{{ c.tiePending }}</b></span>·
              <span>🎗️ Belt: <b class="text-slate-700">{{ c.beltPending }}</b></span>·
              <span>🧢 Cap: <b class="text-slate-700">{{ c.capPending }}</b></span>·
              <span>🎒 Bag: <b class="text-slate-700">{{ c.bagPending }}</b></span>
            </div>
          </div>
        </template>
        <p v-else class="text-sm text-slate-400">Register load nahi hua.</p>
      </div>

      <!-- Phase 67: danger zone — poora school delete (permanent) -->
      <div class="card mt-3 !border-rose-200 bg-rose-50">
        <div class="flex flex-wrap items-center gap-2">
          <div>
            <div class="font-extrabold text-rose-700">⚠️ Danger zone</div>
            <div class="text-sm text-rose-600">Poora school aur uska saara data hamesha ke liye delete ho jayega — ye wapas nahi aayega.</div>
          </div>
          <button v-if="!delOpen" type="button" class="btn !bg-rose-600 text-white !w-auto ml-auto" @click="delOpen = true">🗑 Delete this school</button>
        </div>
        <div v-if="delOpen" class="mt-3 max-w-md">
          <p class="text-sm text-rose-700 font-medium">Pakka delete karna hai? Pehle school ka slug type karo: <b>{{ school.slug }}</b></p>
          <input v-model="delSlug" class="input mt-2 !py-2 text-sm bg-white" type="text" :placeholder="school.slug" />
          <input v-model="delPassword" class="input mt-2 !py-2 text-sm bg-white" type="password" placeholder="Apna owner login password" autocomplete="current-password" />
          <div class="flex gap-2 mt-3">
            <button type="button" class="rounded-xl bg-rose-600 text-white font-bold px-4 py-2 text-sm disabled:opacity-40" :disabled="delSlug !== school.slug || !delPassword || delBusy" @click="deleteSchool">{{ delBusy ? "Delete ho raha hai…" : "Hamesha ke liye DELETE" }}</button>
            <button type="button" class="btn btn-ghost !w-auto !py-2 text-sm" @click="delOpen = false; delSlug = ''; delPassword = ''">Cancel</button>
          </div>
          <p class="text-xs text-rose-400 mt-2">Dono cheezein sahi hongi tabhi delete hoga — galat password par server khud delete rok dega.</p>
        </div>
      </div>

      <!-- Phase 67: member remove modal (reason zaroori hai) -->
      <div v-if="removeTarget" class="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-3" @click.self="removeTarget = null">
        <div class="bg-white rounded-2xl w-full max-w-md p-4">
          <h2 class="font-extrabold">Remove {{ removeTarget.fullName }}?</h2>
          <p class="text-sm text-slate-500 mt-1">{{ ROLE_LABEL[removeTarget.role] || removeTarget.role }} · Login ID: {{ removeTarget.email || "—" }}<br />Remove karte hi uski is school ki login band ho jayegi. Record activity log me rehta hai.</p>
          <label class="label mt-3">Reason</label>
          <select v-model="removeReason" class="input">
            <option v-for="r in REASONS" :key="r.v" :value="r.v">{{ r.label }}</option>
          </select>
          <label class="label mt-2">Note <span v-if="removeReason === 'OTHER'">(zaroori)</span></label>
          <input v-model="removeNote" class="input" type="text" placeholder="Koi note…" />
          <p v-if="removeError" class="text-sm text-rose-600 font-semibold mt-2">{{ removeError }}</p>
          <div class="flex gap-2 mt-4">
            <button type="button" class="btn btn-ghost" @click="removeTarget = null">Cancel</button>
            <button type="button" class="btn !bg-rose-600 text-white" :disabled="removeBusy" @click="confirmRemove">{{ removeBusy ? "Removing…" : "🗑 Remove kar do" }}</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
