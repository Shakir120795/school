<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, login as apiLogin } from "../api.js";
import { t } from "../i18n.js";
import TabbedList from "../components/TabbedList.vue";
import MemberEditModal from "../components/MemberEditModal.vue";
import MemberCard from "../components/MemberCard.vue";
import Pager from "../components/Pager.vue";

// Super Admin console (Phase 21) — platform operator only.
// Phase 44: har school card par usi school ki pehchan (logo ya
// naam wala rang tile) — helper App.vue wale hi rang/initials.
const TILE_COLORS = ["#0b8457", "#2563eb", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#b91c1c", "#0f766e"];
function tileColor(name) { let h = 0; for (const ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return TILE_COLORS[h % TILE_COLORS.length]; }
function initialsOf(name) { return String(name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }
const schools = ref([]);
const loading = ref(true);
const msg = ref("");
const err = ref("");
const form = ref({ name: "", slug: "", adminName: "", adminEmail: "", adminPassword: "" });

async function load() {
  loading.value = true;
  try {
    const r = await api("/platform/schools", { school: false });
    if (r.status === 200) schools.value = r.json.schools;
    else err.value = r.json?.error || "Could not load schools";
  } catch {
    // Network gir jaye to khali "No schools yet" dikhna galat hai —
    // error dikhao taaki asli wajah pata chale (Phase 44b).
    err.value = "Could not load schools — check the connection and reload the page.";
  } finally {
    loading.value = false;
  }
}
// Phase 31: one-click login test + one-tap demo logins.
const check = ref(null);
const checking = ref(false);
async function runCheck() {
  checking.value = true; err.value = "";
  try {
    const r = await api("/platform/login-check", { school: false });
    if (r.status === 200) check.value = r.json;
    else err.value = r.json?.error || "Check failed";
  } finally { checking.value = false; }
}
async function demoLogin(email, password, dest) {
  err.value = ""; msg.value = "";
  const r = await apiLogin(email, password);
  if (r.status === 200) location.href = dest;
  else err.value = "Demo login failed: " + email;
}

async function createSchool() {
  err.value = ""; msg.value = "";
  const slug = form.value.slug || form.value.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const r = await api("/schools", { method: "POST", school: false, body: { ...form.value, slug } });
  if (r.status === 201) {
    msg.value = `School "${form.value.name}" created. Its admin logs in with ${form.value.adminEmail}.`;
    form.value = { name: "", slug: "", adminName: "", adminEmail: "", adminPassword: "" };
    await load();
  } else err.value = r.json?.error || "Could not create school";
}
async function toggleStatus(s) {
  const status = s.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const r = await api(`/platform/schools/${s.id}/status`, { method: "PATCH", school: false, body: { status } });
  if (r.status === 200) { msg.value = `${s.name} is now ${status}.`; await load(); }
  else err.value = r.json?.error || "Status change failed";
}
async function resetAdmin(s) {
  const pw = prompt(`New password for ${s.name}'s admin (${s.adminEmail}) — at least 8 characters:`);
  if (!pw) return;
  const r = await api(`/platform/schools/${s.id}/reset-admin-password`, { method: "POST", school: false, body: { newPassword: pw } });
  if (r.status === 200) msg.value = `Admin password for ${s.name} has been reset. Share it with the school securely.`;
  else err.value = r.json?.error || "Reset failed";
}
// Phase 28 deep link: the owner dashboard's global search lands
// here as /console?school=<id>&tab=<parents|teachers|admins|staff>
// &q=<text> — open that school's members on the right tab, with the
// tab's search box prefilled, and scroll the school into view.
const route = useRoute();
const TAB_KEYS = { admins: "ADMINS", teachers: "TEACHERS", staff: "STAFF", parents: "PARENTS", removed: "REMOVED" };
const deepTarget = computed(() => ({
  schoolId: String(route.query.school || ""),
  tab: TAB_KEYS[String(route.query.tab || "").toLowerCase()] || "",
  q: String(route.query.q || ""),
}));
async function applyDeepLink() {
  const { schoolId } = deepTarget.value;
  if (!schoolId) return;
  const s = schools.value.find((x) => x.id === schoolId);
  if (!s) return;
  if (openId.value !== s.id) await toggleMembers(s);
  await nextTick();
  document.getElementById(`school-card-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Phase 23 drill-in: open one school and see/control everyone in it.
const openId = ref("");
const members = ref(null);
const membersBusy = ref(false);
// Scale-ready member list: one tab per group (Admins / Teachers /
// Staff / Parents / Removed), each with search + status filter +
// 25-per-page pagination — the shared <TabbedList> pattern, identical
// to the school-side Team page. Search/filter/page run client-side
// over the already-fetched grouped lists (fine up to ~1000 rows).
const memberGroups = computed(() => {
  const m = members.value || {};
  return [
    { key: "ADMINS", label: "Admins", items: [...(m.SCHOOL_ADMIN || []), ...(m.PRINCIPAL || [])] },
    { key: "TEACHERS", label: "Teachers", items: m.TEACHER || [] },
    { key: "STAFF", label: "Staff", items: m.STAFF || [] },
    { key: "PARENTS", label: "Parents", items: m.PARENT || [] },
    { key: "REMOVED", label: "Removed", items: removedList.value },
  ];
});
const memberSearchText = (m) =>
  [
    m.fullName, m.email, m.phone, m.role, m.reason, m.note,
    // Parents are also findable by their child's name or class ("1-A").
    ...((m.children || []).flatMap((c) => [c.name, c.classLabel, c.fatherName, c.motherName])),
  ].filter(Boolean).join(" ");
const memberStatusOf = (m) => m.status ?? null;
const addForm = ref({ fullName: "", email: "", password: "", phone: "", role: "TEACHER", guardianPhone: "" });
async function refreshMembers(s) {
  const r = await api(`/platform/schools/${s.id}/members`, { school: false });
  if (r.status === 200) { members.value = r.json.members; removedList.value = r.json.removed || []; }
}
async function addMember(s) {
  err.value = ""; msg.value = "";
  const r = await api(`/platform/schools/${s.id}/members`, { method: "POST", school: false, body: { ...addForm.value } });
  if (r.status === 201) {
    msg.value = `${addForm.value.fullName} added to ${s.name} (${addForm.value.role}).` + (r.json.guardiansLinked ? ` Linked to ${r.json.guardiansLinked} guardian record(s) — children visible.` : "");
    addForm.value = { fullName: "", email: "", password: "", phone: "", role: "TEACHER", guardianPhone: "" };
    await refreshMembers(s); await load();
  } else err.value = r.json?.error || "Could not add member";
}
// Edit = one in-app modal form (Full name / Login email / Phone),
// shared with the school-side Team page via <MemberEditModal>. Server
// errors (e.g. the 409 email conflict) show INSIDE the form and
// nothing is saved; on success the list refreshes in place.
const EDIT_ERRORS = {
  EMAIL_ALREADY_IN_USE: "This login email is already used by another account — nothing was saved.",
  INVALID_EMAIL: "Please enter a valid email address.",
  FULL_NAME_REQUIRED: "Full name cannot be empty.",
};
const editTarget = ref(null); // { school, member }
const editError = ref("");
const editSaving = ref(false);
function editMember(s, m) {
  editError.value = "";
  editTarget.value = { school: s, member: m };
}
async function saveEditMember(values) {
  const { school: s, member: m } = editTarget.value;
  editSaving.value = true; editError.value = "";
  const r = await api(`/platform/schools/${s.id}/members/${m.membershipId}`, { method: "PATCH", school: false, body: values });
  editSaving.value = false;
  if (r.status === 200) {
    editTarget.value = null;
    msg.value = `${values.fullName} updated.`;
    await refreshMembers(s);
  } else editError.value = EDIT_ERRORS[r.json?.error] || r.json?.error || "Edit failed";
}
async function toggleMemberStatus(s, m) {
  const status = m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const r = await api(`/platform/schools/${s.id}/members/${m.membershipId}`, { method: "PATCH", school: false, body: { status } });
  if (r.status === 200) { msg.value = `${m.fullName} is now ${status} at ${s.name}.`; await refreshMembers(s); }
  else err.value = r.json?.error || "Status change failed";
}
const REASON_LABEL = { LEFT_SCHOOL: "Naam katwaya — school chhoda", RESIGNED: "Staff ne chhoda", DUPLICATE: "Duplicate ID galti se bani", OTHER: "Other" };
const removedList = ref([]);
const removeTarget = ref(null);
const removeForm = ref({ reason: "LEFT_SCHOOL", note: "" });
function openRemove(s, m) {
  removeTarget.value = { school: s, member: m };
  removeForm.value = { reason: "LEFT_SCHOOL", note: "" };
}
async function confirmRemove() {
  const { school: s, member: m } = removeTarget.value;
  if (removeForm.value.reason === "OTHER" && !removeForm.value.note.trim()) { err.value = "A note is required when the reason is \u201cOther\u201d."; return; }
  const r = await api(`/platform/schools/${s.id}/members/${m.membershipId}`, { method: "DELETE", school: false, body: { reason: removeForm.value.reason, note: removeForm.value.note.trim() || undefined } });
  removeTarget.value = null;
  if (r.status === 200) {
    msg.value = `${m.fullName} removed from ${s.name} (${REASON_LABEL[r.json.reason]}).`;
    await refreshMembers(s); await load();
  } else err.value = r.json?.error || "Remove failed";
}
async function toggleMembers(s) {
  if (openId.value === s.id) { openId.value = ""; members.value = null; return; }
  openId.value = s.id; members.value = null; membersBusy.value = true; err.value = "";
  wsTab.value = "members"; resetStuForm(); wsStudents.value = null; wsHisab.value = null; stuQuery.value = "";
  const r = await api(`/platform/schools/${s.id}/members`, { school: false });
  membersBusy.value = false;
  if (r.status === 200) { members.value = r.json.members; removedList.value = r.json.removed || []; }
  else err.value = r.json?.error || "Could not load members";
}
async function resetMember(s, m) {
  const pw = prompt(`New password for ${m.fullName} (${m.role}${m.email ? ", " + m.email : ""}) at ${s.name} — at least 8 characters:`);
  if (!pw) return;
  const r = await api(`/platform/schools/${s.id}/members/${m.membershipId}/reset-password`, { method: "POST", school: false, body: { newPassword: pw } });
  if (r.status === 200) msg.value = `Password for ${m.fullName} (${s.name}) has been reset. Share it securely.`;
  else err.value = r.json?.error || "Reset failed";
}
async function removeSchool(s) {
  const typed = prompt(`PERMANENTLY delete "${s.name}" and ALL its data (students, fees, attendance — everything)?\n\nType the school slug to confirm: ${s.slug}`);
  if (typed !== s.slug) { if (typed !== null) err.value = "Slug did not match — school not deleted."; return; }
  const r = await api(`/platform/schools/${s.id}`, { method: "DELETE", school: false });
  if (r.status === 200) { msg.value = `${s.name} and all its data have been deleted.`; await load(); }
  else err.value = r.json?.error || "Delete failed";
}
// Phase 29 WS2: platform activity log — every AuditLog row across
// all schools (plus platform-level rows with no school), latest
// first, server-paginated 25/page with school + action filters.
const actItems = ref([]);
const actTotal = ref(0);
const actPage = ref(1);
const actTotalPages = ref(1);
const actLoading = ref(true);
const actLoaded = ref(false);
const actSchoolId = ref("");
const actAction = ref("");
const actActions = ref([]);
const ACT_PAGE_SIZE = 25;
const actFrom = computed(() => (actTotal.value === 0 ? 0 : (actPage.value - 1) * ACT_PAGE_SIZE + 1));
const actTo = computed(() => Math.min(actTotal.value, actPage.value * ACT_PAGE_SIZE));
const roleChipCls = (r) =>
  ({ PLATFORM_ADMIN: "bg-violet-600 text-white", SCHOOL_ADMIN: "bg-violet-100 text-violet-700", PRINCIPAL: "bg-indigo-100 text-indigo-700", TEACHER: "bg-sky-100 text-sky-700", STAFF: "bg-slate-200 text-slate-600", PARENT: "bg-emerald-100 text-emerald-700" })[r] || "bg-slate-100 text-slate-500";
const fmtWhen = (iso) => (iso ? String(iso).replace("T", " ").slice(0, 16) : "—");
async function loadActivity() {
  actLoading.value = true;
  try {
    const qs = new URLSearchParams({ page: String(actPage.value), pageSize: String(ACT_PAGE_SIZE) });
    if (actSchoolId.value) qs.set("schoolId", actSchoolId.value);
    if (actAction.value) qs.set("action", actAction.value);
    const r = await api(`/platform/activity?${qs}`, { school: false });
    if (r.status === 200) {
      actItems.value = r.json.items || [];
      actTotal.value = r.json.total || 0;
      actTotalPages.value = r.json.totalPages || 1;
      if (r.json.actions?.length) actActions.value = r.json.actions;
    }
  } finally {
    actLoading.value = false;
    actLoaded.value = true;
  }
}
function actFilterChanged() {
  actPage.value = 1;
  loadActivity();
}
function actPageChanged(p) {
  actPage.value = p;
  loadActivity();
}

// ---------- Phase 32: school search + DB update + workspace ----------
const schoolQuery = ref("");
const filteredSchools = computed(() => {
  const q = schoolQuery.value.trim().toLowerCase();
  if (!q) return schools.value;
  return schools.value.filter((x) => (x.name + " " + x.slug).toLowerCase().includes(q));
});
const dbUpd = ref(null);
const dbBusy = ref(false);
async function runDbUpdate() {
  dbBusy.value = true; err.value = "";
  try {
    const r = await api("/platform/apply-db-updates", { method: "POST", school: false });
    if (r.status === 200) {
      dbUpd.value = r.json;
      if (r.json.applied) { msg.value = t("console.dbDoneMsg"); await load(); }
    } else err.value = r.json?.error || "DB update failed";
  } finally { dbBusy.value = false; }
}
const wsTab = ref("members");
async function openTab(s, tab) {
  wsTab.value = tab;
  if (tab === "students") { await loadWsClasses(s); await loadWsStudents(s); }
  if (tab === "hisab") await loadHisab(s);
}
const wsStudents = ref(null);
const wsStudentsBusy = ref(false);
const wsClasses = ref([]);
const stuQuery = ref("");
const showInactive = ref(false);
const stuBusy = ref(false);
const stuEditId = ref("");
const stuForm = ref({ fullName: "", admissionNo: "", classroomId: "", rollNo: "", fatherName: "", motherName: "", address: "", guardianName: "", guardianPhone: "" });
const classForm = ref({ name: "", section: "" });
const filteredWsStudents = computed(() => {
  const q = stuQuery.value.trim().toLowerCase();
  const list = wsStudents.value || [];
  if (!q) return list;
  return list.filter((st) => [st.fullName, st.admissionNo, st.classLabel, st.guardianName, st.guardianPhone].filter(Boolean).join(" ").toLowerCase().includes(q));
});
function resetStuForm() {
  stuEditId.value = "";
  stuForm.value = { fullName: "", admissionNo: "", classroomId: "", rollNo: "", fatherName: "", motherName: "", address: "", guardianName: "", guardianPhone: "" };
}
async function loadWsClasses(s) {
  const r = await api(`/platform/schools/${s.id}/classes`, { school: false });
  if (r.status === 200) wsClasses.value = r.json.classes;
}
async function loadWsStudents(s) {
  wsStudentsBusy.value = true;
  try {
    const r = await api(`/platform/schools/${s.id}/students${showInactive.value ? "?all=1" : ""}`, { school: false });
    if (r.status === 200) wsStudents.value = r.json.students;
    else err.value = r.json?.error || t("console.studentsLoadFailed");
  } finally { wsStudentsBusy.value = false; }
}
async function saveStudent(s) {
  stuBusy.value = true; err.value = "";
  try {
    const body = { ...stuForm.value, classroomId: stuForm.value.classroomId || null };
    const r = stuEditId.value
      ? await api(`/platform/schools/${s.id}/students/${stuEditId.value}`, { method: "PATCH", school: false, body })
      : await api(`/platform/schools/${s.id}/students`, { method: "POST", school: false, body });
    if (r.status === 200 || r.status === 201) {
      msg.value = stuEditId.value ? t("console.stuUpdated") : t("console.stuSaved");
      resetStuForm();
      await loadWsStudents(s); await loadWsClasses(s); await load();
    } else err.value = r.json?.error === "ADMISSION_TAKEN" ? t("console.admissionTaken") : (r.json?.error || t("console.stuSaveFailed"));
  } finally { stuBusy.value = false; }
}
function editStudent(st) {
  stuEditId.value = st.id;
  stuForm.value = { fullName: st.fullName || "", admissionNo: st.admissionNo || "", classroomId: st.classroomId || "", rollNo: st.rollNo || "", fatherName: st.fatherName || "", motherName: st.motherName || "", address: st.address || "", guardianName: "", guardianPhone: "" };
}
async function removeStudent(s, st) {
  if (!confirm(`${st.fullName} — ${t("console.confirmRemoveStudent")}`)) return;
  const r = await api(`/platform/schools/${s.id}/students/${st.id}`, { method: "DELETE", school: false });
  if (r.status === 200) { msg.value = `${st.fullName} ${t("console.stuRemoved")}`; await loadWsStudents(s); await load(); }
  else err.value = r.json?.error || t("console.removeFailed");
}
async function addClass(s) {
  if (!classForm.value.name.trim()) return;
  stuBusy.value = true;
  try {
    const r = await api(`/platform/schools/${s.id}/classes`, { method: "POST", school: false, body: { name: classForm.value.name.trim(), section: classForm.value.section.trim() || undefined } });
    if (r.status === 201) { classForm.value = { name: "", section: "" }; msg.value = t("console.classAdded"); await loadWsClasses(s); await load(); }
    else err.value = r.json?.error || t("console.classAddFailed");
  } finally { stuBusy.value = false; }
}
const wsHisab = ref(null);
const hisabBusy = ref(false);
const rateForm = ref("");
const payForm = ref({ amountRupees: "", note: "", receivedAt: "" });
async function loadHisab(s) {
  hisabBusy.value = true;
  try {
    const r = await api(`/platform/schools/${s.id}/hisab`, { school: false });
    if (r.status === 200) { wsHisab.value = r.json; rateForm.value = r.json.perStudentRatePaise != null ? String(r.json.perStudentRatePaise / 100) : ""; }
    else err.value = r.json?.error || t("console.hisabLoadFailed");
  } finally { hisabBusy.value = false; }
}
async function saveRate(s) {
  hisabBusy.value = true;
  try {
    const r = await api(`/platform/schools/${s.id}/rate`, { method: "PATCH", school: false, body: { rateRupees: Number(rateForm.value) } });
    if (r.status === 200) { msg.value = t("console.rateSaved"); await loadHisab(s); await load(); }
    else err.value = r.json?.error === "DB_UPDATE_PENDING" ? t("console.dbPendingFirst") : (r.json?.error || t("console.rateSaveFailed"));
  } finally { hisabBusy.value = false; }
}
async function addPayment(s) {
  hisabBusy.value = true;
  try {
    const r = await api(`/platform/schools/${s.id}/payments`, { method: "POST", school: false, body: { amountRupees: Number(payForm.value.amountRupees), note: payForm.value.note || undefined, receivedAt: payForm.value.receivedAt || undefined } });
    if (r.status === 201) { payForm.value = { amountRupees: "", note: "", receivedAt: "" }; msg.value = t("console.payAdded"); await loadHisab(s); await load(); }
    else err.value = r.json?.error === "DB_UPDATE_PENDING" ? t("console.dbPendingFirst") : (r.json?.error || t("console.payFailed"));
  } finally { hisabBusy.value = false; }
}
async function deletePayment(s, pay) {
  if (!confirm(`${t("console.confirmDeletePayment")} (${fmtINR(pay.amountPaise)})?`)) return;
  const r = await api(`/platform/payments/${pay.id}`, { method: "DELETE", school: false });
  if (r.status === 200) { await loadHisab(s); await load(); }
  else err.value = r.json?.error || t("console.deleteFailed");
}

onMounted(async () => {
  await load();
  loadActivity();
  await applyDeepLink();
});
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">👑 Super Admin Console</h1>
    <p class="text-sm text-slate-500 mb-4">Every school on the platform. You are above all schools — school staff work inside their own school only.</p>
    <!-- Phase 60 (audit UX): Tools ki katar upar hi — pehle Login
         Test / DB Update tak pahuchne ke liye puri schools list
         scroll karni padti thi. -->
    <div class="flex flex-wrap gap-2 mb-4">
      <a href="#tool-login" class="btn btn-ghost !w-auto">✅ Login Test</a>
      <a href="#tool-db" class="btn btn-ghost !w-auto">🛠 Database Update</a>
      <a href="#tool-add" class="btn btn-ghost !w-auto">＋ Add a new school</a>
    </div>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <div v-if="loading" class="card text-slate-500 animate-pulse mb-4">Loading schools…</div>
    <input v-if="!loading" v-model="schoolQuery" class="input mb-3" :placeholder="t('console.searchSchool')" />
    <div v-else class="grid gap-3 mb-4">
      <div v-for="s in filteredSchools" :key="s.id" :id="`school-card-${s.id}`" class="card !py-3">
        <div class="flex flex-wrap items-center gap-2">
          <img v-if="s.logoUrl" :src="s.logoUrl" class="w-9 h-9 rounded-lg object-contain bg-white border shrink-0" alt="" />
          <span v-else class="grid place-items-center w-9 h-9 rounded-lg text-white text-xs font-bold shrink-0" :style="{ background: tileColor(s.name) }">{{ initialsOf(s.name) }}</span>
          <span class="font-bold">{{ s.name }}</span>
          <span class="text-xs text-slate-400">{{ s.slug }}</span>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="s.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'">{{ s.status }}</span>
          <span class="ml-auto text-xs text-slate-400">since {{ String(s.createdAt).slice(0, 10) }}</span>
        </div>
        <div class="flex flex-wrap gap-2 mt-2 text-xs">
          <span class="chip bg-slate-100 text-slate-600">🎓 {{ s.students }} students</span>
          <span class="chip bg-slate-100 text-slate-600">👩‍🏫 {{ s.teachers }} teachers</span>
          <span class="chip bg-slate-100 text-slate-600">🏫 {{ s.classes }} classes</span>
          <span class="chip bg-slate-100 text-slate-600">👨‍👩‍👧 {{ s.parents }} parents</span>
          <span class="chip bg-violet-50 text-violet-700">Admin: {{ s.adminName }} · {{ s.adminEmail }}</span>
        </div>
        <p v-if="s.totalChargePaise != null" class="text-xs mt-2">💰 <b>{{ t("console.totalCharge") }}:</b> {{ s.students }} students × {{ fmtINR(s.perStudentRatePaise) }} = <b>{{ fmtINR(s.totalChargePaise) }}</b> · <span class="text-green-700 font-semibold">{{ t("common.received") }} {{ fmtINR(s.receivedPaise) }}</span> · <span class="text-red-600 font-semibold">{{ t("common.balance") }} {{ fmtINR(s.balancePaise) }}</span></p>
        <p v-else class="text-xs mt-2 text-amber-600">{{ t("console.hisabPending") }}</p>
        <div class="flex flex-wrap gap-2 mt-3">
          <button class="btn btn-ghost !py-1.5 text-xs" @click="toggleMembers(s)">{{ openId === s.id ? t("console.close") : t("console.openSchool") }}</button>
          <button class="btn btn-ghost !py-1.5 text-xs" @click="toggleStatus(s)">{{ s.status === "ACTIVE" ? "Suspend school" : "Reactivate" }}</button>
          <button class="btn btn-ghost !py-1.5 text-xs" @click="resetAdmin(s)">Reset admin password</button>
          <button class="btn btn-ghost !py-1.5 text-xs text-red-600" @click="removeSchool(s)">Delete school</button>
        </div>
        <div v-if="openId === s.id" class="mt-3 border-t border-slate-100 pt-3">
          <div class="flex flex-wrap gap-2 mb-3">
            <button :class="wsTab === 'members' ? 'btn-primary' : 'btn-ghost'" class="!w-auto !py-1.5 text-xs" @click="openTab(s, 'members')">👥 Members (IDs)</button>
            <button :class="wsTab === 'students' ? 'btn-primary' : 'btn-ghost'" class="!w-auto !py-1.5 text-xs" @click="openTab(s, 'students')">🎓 Students</button>
            <button :class="wsTab === 'hisab' ? 'btn-primary' : 'btn-ghost'" class="!w-auto !py-1.5 text-xs" @click="openTab(s, 'hisab')">{{ t("console.tabCharges") }}</button>
          </div>
          <div v-if="wsTab === 'students'">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <input v-model="stuQuery" class="input !w-auto flex-1 min-w-[160px]" :placeholder="t('console.stuSearch')" />
              <label class="text-xs flex items-center gap-1"><input type="checkbox" v-model="showInactive" @change="loadWsStudents(s)" /> {{ t("console.showRemoved") }}</label>
            </div>
            <form class="grid gap-2 border rounded-xl p-3 mb-3 bg-slate-50" @submit.prevent="saveStudent(s)">
              <p class="text-sm font-semibold">{{ stuEditId ? t("console.editStudent") : t("console.addStudent") }}</p>
              <div class="grid grid-cols-2 gap-2">
                <input v-model="stuForm.fullName" class="input" placeholder="Student name *" required />
                <input v-model="stuForm.admissionNo" class="input" placeholder="Admission no *" required />
                <select v-model="stuForm.classroomId" class="input"><option value="">{{ t("console.classNone") }}</option><option v-for="c in wsClasses" :key="c.id" :value="c.id">{{ c.label }} ({{ c.students }})</option></select>
                <input v-model="stuForm.rollNo" class="input" placeholder="Roll no" />
                <input v-model="stuForm.fatherName" class="input" placeholder="Father name" />
                <input v-model="stuForm.motherName" class="input" placeholder="Mother name" />
                <input v-model="stuForm.guardianName" class="input" :placeholder="t('console.guardianName')" />
                <input v-model="stuForm.guardianPhone" class="input" placeholder="Guardian mobile" />
              </div>
              <input v-model="stuForm.address" class="input" placeholder="Address" />
              <div class="flex gap-2">
                <button class="btn-primary !w-auto px-4" :disabled="stuBusy">{{ stuEditId ? "Save changes" : "Add student" }}</button>
                <button v-if="stuEditId" type="button" class="btn-ghost !w-auto" @click="resetStuForm">Cancel edit</button>
              </div>
            </form>
            <form class="flex gap-2 mb-3" @submit.prevent="addClass(s)">
              <input v-model="classForm.name" class="input !w-auto flex-1" :placeholder="t('console.classNamePh')" />
              <input v-model="classForm.section" class="input !w-24" placeholder="Section" />
              <button class="btn-ghost !w-auto" :disabled="stuBusy">{{ t("console.addClass") }}</button>
            </form>
            <p v-if="wsStudentsBusy" class="text-sm text-slate-400">{{ t("console.loadingStudents") }}</p>
            <div v-else class="grid gap-1.5">
              <div v-for="st in filteredWsStudents" :key="st.id" class="flex flex-wrap items-center gap-2 border rounded-xl px-3 py-2 text-sm" :class="st.status !== 'ACTIVE' ? 'opacity-50' : ''">
                <b>{{ st.fullName }}</b>
                <span class="text-xs text-slate-400">Adm {{ st.admissionNo }}</span>
                <span v-if="st.classLabel" class="chip bg-slate-100 text-slate-600 text-xs">Class {{ st.classLabel }}</span>
                <span v-if="st.guardianName" class="text-xs text-slate-500">👨‍👩‍👧 {{ st.guardianName }}<span v-if="st.guardianPhone"> · {{ st.guardianPhone }}</span></span>
                <span v-if="st.status !== 'ACTIVE'" class="text-[10px] font-bold text-rose-600">REMOVED</span>
                <span class="ml-auto flex gap-1">
                  <button class="btn-ghost !w-auto !py-1 text-xs" @click="editStudent(st)">Edit</button>
                  <button v-if="st.status === 'ACTIVE'" class="btn-ghost !w-auto !py-1 text-xs text-red-600" @click="removeStudent(s, st)">Remove</button>
                </span>
              </div>
              <p v-if="!filteredWsStudents.length" class="text-sm text-slate-400">{{ t("console.noStudents") }}</p>
            </div>
          </div>
          <div v-if="wsTab === 'hisab'">
            <p v-if="hisabBusy" class="text-sm text-slate-400">{{ t("console.hisabLoading") }}</p>
            <p v-else-if="wsHisab && wsHisab.setupRequired" class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{{ t("console.hisabSetup") }}</p>
            <template v-else-if="wsHisab">
              <div class="grid grid-cols-3 gap-2 mb-3 text-center">
                <div class="border rounded-xl p-2"><p class="text-[11px] text-slate-400">{{ t("console.totalCharge") }}</p><p class="font-bold">{{ fmtINR(wsHisab.totalChargePaise) }}</p><p class="text-[11px] text-slate-400">{{ wsHisab.students }} students × {{ fmtINR(wsHisab.perStudentRatePaise) }}</p></div>
                <div class="border rounded-xl p-2"><p class="text-[11px] text-slate-400">{{ t("common.received") }}</p><p class="font-bold text-green-700">{{ fmtINR(wsHisab.receivedPaise) }}</p></div>
                <div class="border rounded-xl p-2"><p class="text-[11px] text-slate-400">{{ t("common.balance") }}</p><p class="font-bold text-red-600">{{ fmtINR(wsHisab.balancePaise) }}</p></div>
              </div>
              <form class="flex flex-wrap items-center gap-2 mb-3" @submit.prevent="saveRate(s)">
                <label class="text-sm flex items-center gap-2">Per-student rate ₹ <input v-model="rateForm" type="number" min="0" step="1" class="input !w-28" /></label>
                <button class="btn-ghost !w-auto" :disabled="hisabBusy">{{ t("console.saveRate") }}</button>
              </form>
              <form class="grid gap-2 border rounded-xl p-3 mb-3 bg-slate-50" @submit.prevent="addPayment(s)">
                <p class="text-sm font-semibold">{{ t("console.addPaymentTitle") }}</p>
                <div class="flex flex-wrap gap-2">
                  <input v-model="payForm.amountRupees" type="number" min="1" step="1" class="input !w-32" placeholder="Amount ₹ *" required />
                  <input v-model="payForm.receivedAt" type="date" class="input !w-auto" />
                  <input v-model="payForm.note" class="input flex-1 min-w-[140px]" :placeholder="t('console.notePh')" />
                  <button class="btn-primary !w-auto px-4" :disabled="hisabBusy">Add payment</button>
                </div>
              </form>
              <div class="grid gap-1.5">
                <div v-for="pay in wsHisab.payments" :key="pay.id" class="flex items-center gap-2 border rounded-xl px-3 py-2 text-sm">
                  <b class="text-green-700">{{ fmtINR(pay.amountPaise) }}</b>
                  <span class="text-xs text-slate-400">{{ String(pay.receivedAt).slice(0, 10) }}</span>
                  <span class="text-xs text-slate-500">{{ pay.note || "" }}</span>
                  <button class="btn-ghost !w-auto !py-1 text-xs text-red-600 ml-auto" @click="deletePayment(s, pay)">Delete</button>
                </div>
                <p v-if="!wsHisab.payments.length" class="text-sm text-slate-400">{{ t("console.noPayments") }}</p>
              </div>
            </template>
          </div>
          <p v-if="wsTab === 'members' && membersBusy" class="text-sm text-slate-400">Loading members…</p>
          <template v-else-if="wsTab === 'members' && members">
            <TabbedList
              :groups="memberGroups"
              :search-text="memberSearchText"
              :status-of="memberStatusOf"
              :reset-key="s.id"
              :initial-tab="s.id === deepTarget.schoolId ? deepTarget.tab : ''"
              :initial-query="s.id === deepTarget.schoolId ? deepTarget.q : ''"
              search-placeholder="Search name, email, phone…"
            >
              <template #row="{ item: m, group }">
                <div v-if="group.key === 'REMOVED'" :key="m.membershipId" class="flex flex-wrap items-center gap-2 py-1.5 border-b border-slate-50 last:border-0 opacity-60">
                  <span class="font-semibold text-sm line-through">{{ m.fullName }}</span>
                  <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{{ m.role }}</span>
                  <span class="text-xs text-slate-500">{{ REASON_LABEL[m.reason] || m.reason || "—" }}{{ m.note ? " · " + m.note : "" }}</span>
                  <span class="text-[11px] text-slate-400 ml-auto">by {{ m.removedBy || "—" }} · {{ String(m.removedAt).slice(0, 10) }}</span>
                </div>
                <MemberCard
                  v-else
                  :key="m.membershipId"
                  :name="m.fullName"
                  :role="m.role"
                  :status="m.status"
                  :email="m.email || ''"
                  :phone="m.phone || ''"
                  :children="m.role === 'PARENT' ? (m.children || []) : null"
                  @edit="editMember(s, m)"
                  @toggle-status="toggleMemberStatus(s, m)"
                  @reset="resetMember(s, m)"
                  @remove="openRemove(s, m)"
                />
              </template>
            </TabbedList>
            <form class="bg-slate-50 rounded-2xl p-3 grid gap-2 mt-2" @submit.prevent="addMember(s)">
              <div class="text-sm font-bold">Add a member to {{ s.name }}</div>
              <div class="grid sm:grid-cols-2 gap-2">
                <input v-model="addForm.fullName" class="input" required placeholder="Full name" />
                <input v-model="addForm.email" type="email" class="input" required placeholder="Login email / ID" />
                <input v-model="addForm.password" class="input" required minlength="8" placeholder="Password (min 8 characters)" />
                <input v-model="addForm.phone" class="input" placeholder="Phone (optional)" />
                <select v-model="addForm.role" class="input">
                  <option value="TEACHER">Teacher</option>
                  <option value="PARENT">Parent</option>
                  <option value="SCHOOL_ADMIN">School Admin</option>
                  <option value="STAFF">Staff (office)</option>
                </select>
                <input v-if="addForm.role === 'PARENT'" v-model="addForm.guardianPhone" class="input" placeholder="Guardian mobile — links their children" />
              </div>
              <button class="btn btn-primary !py-2 text-sm">Add member</button>
            </form>
          </template>
        </div>
      </div>
      <p v-if="!schools.length" class="card text-sm text-slate-400">No schools yet — create the first one below.</p>
    </div>

    <div class="card mb-4" id="tool-db">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <h2 class="font-bold">🛠 Database Update</h2>
        <span class="text-xs text-slate-400">{{ t("console.dbHint") }}</span>
      </div>
      <button class="btn-primary !w-auto px-5 mb-3" :disabled="dbBusy" @click="runDbUpdate">{{ dbBusy ? t("console.dbRunning") : t("console.dbRun") }}</button>
      <div v-if="dbUpd">
        <p class="font-bold mb-2" :class="dbUpd.applied ? 'text-green-700' : 'text-red-700'">{{ dbUpd.applied ? t("console.dbDone") : t("console.dbPartial") }}</p>
        <div class="grid gap-1">
          <p v-for="r in dbUpd.results" :key="r.label" class="text-sm">{{ r.ok ? "✅" : "❌" }} {{ r.label }}<span v-if="!r.ok" class="text-red-600"> — {{ r.error }}</span></p>
        </div>
      </div>
    </div>

    <div class="card mb-4" id="tool-login">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <h2 class="font-bold">✅ Login Test</h2>
        <span class="text-xs text-slate-400">{{ t("console.testHint") }}</span>
      </div>
      <button class="btn-primary !w-auto px-5 mb-3" :disabled="checking" @click="runCheck">{{ checking ? t("console.testing") : t("console.runTest") }}</button>
      <div v-if="check">
        <p class="font-bold mb-2" :class="check.passed === check.total ? 'text-green-700' : 'text-amber-700'">{{ t("console.result") }}: {{ check.passed }} / {{ check.total }} pass</p>
        <div class="grid gap-1.5">
          <div v-for="c in check.checks" :key="c.label" class="flex items-start gap-2 text-sm border rounded-xl px-3 py-2" :class="c.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'">
            <span>{{ c.ok ? "✅" : "❌" }}</span>
            <span><b>{{ c.label }}</b><br /><span class="text-slate-600">{{ c.detail }}</span></span>
          </div>
        </div>
      </div>
      <div class="border-t mt-4 pt-3">
        <p class="text-sm font-semibold mb-1">👀 {{ t("console.tryDemo") }}</p>
        <p class="text-xs text-slate-400 mb-2">{{ t("console.tryDemoHint") }}</p>
        <div class="flex flex-wrap gap-2">
          <button class="btn-ghost !w-auto" @click="demoLogin('rahul.parent@demo.school', 'ParentDemo1!', '/')">{{ t("console.viewAsParent") }}</button>
          <button class="btn-ghost !w-auto" @click="demoLogin('teacher@demo.school', 'DemoTeach123!', '/')">{{ t("console.viewAsTeacher") }}</button>
          <button class="btn-ghost !w-auto" @click="demoLogin('admin@demo.school', 'DemoAdmin123!', '/')">{{ t("console.viewAsSchoolAdmin") }}</button>
        </div>
      </div>
    </div>

    <div class="card mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="font-bold">🕘 Activity</h2>
        <span v-if="actLoaded && !actLoading" class="text-xs text-slate-400">{{ actTotal }} event(s)</span>
        <span class="ml-auto flex flex-wrap gap-2">
          <select v-model="actSchoolId" class="input !w-auto !py-1.5 text-xs" @change="actFilterChanged">
            <option value="">All schools</option>
            <option v-for="s in schools" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <select v-model="actAction" class="input !w-auto !py-1.5 text-xs" @change="actFilterChanged">
            <option value="">All actions</option>
            <option v-for="a in actActions" :key="a.action" :value="a.action">{{ a.label }}</option>
          </select>
        </span>
      </div>
      <p v-if="actLoading" class="text-sm text-slate-400 animate-pulse">Loading activity…</p>
      <template v-else>
        <div v-if="!actItems.length" class="text-sm text-slate-400">No activity yet.</div>
        <div v-for="it in actItems" :key="it.id" class="flex flex-wrap items-center gap-2 py-2 border-b border-slate-50 last:border-0">
          <span class="text-[11px] text-slate-400 w-32 shrink-0">{{ fmtWhen(it.createdAt) }}</span>
          <span class="font-semibold text-sm">{{ it.actorName || "—" }}</span>
          <span v-if="it.actorRole" class="text-[10px] font-bold px-1.5 py-0.5 rounded" :class="roleChipCls(it.actorRole)">{{ it.actorRole.replace("_", " ") }}</span>
          <span class="text-sm">{{ it.label }}</span>
          <span v-if="it.schoolName" class="chip bg-slate-100 text-slate-600">{{ it.schoolName }}</span>
          <span v-if="it.detailsText" class="text-xs text-slate-500 w-full sm:w-auto">{{ it.detailsText }}</span>
        </div>
        <Pager :page="actPage" :total-pages="actTotalPages" :from="actFrom" :to="actTo" :total="actTotal" @update:page="actPageChanged" />
      </template>
    </div>

    <form class="card grid gap-3" id="tool-add" @submit.prevent="createSchool">
      <h2 class="font-bold">Add a new school</h2>
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="label">School name</label><input v-model="form.name" class="input" required placeholder="e.g. Green Valley Public School" /></div>
        <div><label class="label">School code (URL id, optional)</label><input v-model="form.slug" class="input" placeholder="green-valley" /></div>
        <div><label class="label">School admin name</label><input v-model="form.adminName" class="input" required placeholder="e.g. Rakesh Gupta" /></div>
        <div><label class="label">School admin email (their login)</label><input v-model="form.adminEmail" type="email" class="input" required placeholder="admin@greenvalley.edu" /></div>
        <div class="md:col-span-2"><label class="label">School admin password (share with the school)</label><input v-model="form.adminPassword" class="input" required minlength="8" placeholder="At least 8 characters" /></div>
      </div>
      <button class="btn btn-primary">Create school + admin login</button>
    </form>

    <MemberEditModal
      v-if="editTarget"
      title="Edit member"
      :subtitle="`${editTarget.member.role} · ${editTarget.school.name}`"
      :initial="{ fullName: editTarget.member.fullName, email: editTarget.member.email, phone: editTarget.member.phone }"
      :error="editError"
      :saving="editSaving"
      @save="saveEditMember"
      @close="editTarget = null"
    />

    <div v-if="removeTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="removeTarget = null">
      <div class="card w-full max-w-md">
        <h2 class="font-bold mb-1">Remove {{ removeTarget.member.fullName }}?</h2>
        <p class="text-sm text-slate-500 mb-3">{{ removeTarget.member.role }} · {{ removeTarget.school.name }} — unka login band ho jayega. Pehle wajah chuno:</p>
        <div class="grid gap-2 mb-3">
          <label v-for="(label, key) in REASON_LABEL" :key="key" class="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 text-sm cursor-pointer">
            <input type="radio" :value="key" v-model="removeForm.reason" /> {{ label }}
          </label>
        </div>
        <input v-model="removeForm.note" class="input mb-3" :placeholder="removeForm.reason === 'OTHER' ? 'Note (required)' : 'Note (optional)'" />
        <div class="flex gap-2">
          <button class="btn btn-primary flex-1 !bg-rose-600" @click="confirmRemove">Remove member</button>
          <button class="btn btn-ghost flex-1" @click="removeTarget = null">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>
