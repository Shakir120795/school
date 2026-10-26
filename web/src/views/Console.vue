<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api.js";
import TabbedList from "../components/TabbedList.vue";
import MemberEditModal from "../components/MemberEditModal.vue";
import MemberCard from "../components/MemberCard.vue";

// Super Admin console (Phase 21) — platform operator only.
const schools = ref([]);
const msg = ref("");
const err = ref("");
const form = ref({ name: "", slug: "", adminName: "", adminEmail: "", adminPassword: "" });

async function load() {
  const r = await api("/platform/schools", { school: false });
  if (r.status === 200) schools.value = r.json.schools;
  else err.value = r.json?.error || "Could not load schools";
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
  if (removeForm.value.reason === "OTHER" && !removeForm.value.note.trim()) { err.value = "“Other” ke liye note likhna zaroori hai."; return; }
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
onMounted(async () => {
  await load();
  await applyDeepLink();
});
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">👑 Super Admin Console</h1>
    <p class="text-sm text-slate-500 mb-4">Every school on the platform. You are above all schools — school staff work inside their own school only.</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <div class="grid gap-3 mb-4">
      <div v-for="s in schools" :key="s.id" :id="`school-card-${s.id}`" class="card !py-3">
        <div class="flex flex-wrap items-center gap-2">
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
        <div class="flex flex-wrap gap-2 mt-3">
          <button class="btn btn-ghost !py-1.5 text-xs" @click="toggleMembers(s)">{{ openId === s.id ? "Hide members" : "👥 Members" }}</button>
          <button class="btn btn-ghost !py-1.5 text-xs" @click="toggleStatus(s)">{{ s.status === "ACTIVE" ? "Suspend school" : "Reactivate" }}</button>
          <button class="btn btn-ghost !py-1.5 text-xs" @click="resetAdmin(s)">Reset admin password</button>
          <button class="btn btn-ghost !py-1.5 text-xs text-red-600" @click="removeSchool(s)">Delete school</button>
        </div>
        <div v-if="openId === s.id" class="mt-3 border-t border-slate-100 pt-3">
          <p v-if="membersBusy" class="text-sm text-slate-400">Loading members…</p>
          <template v-else-if="members">
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
                  <option value="PRINCIPAL">Principal</option>
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

    <form class="card grid gap-3" @submit.prevent="createSchool">
      <h2 class="font-bold">Add a new school</h2>
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="label">School name</label><input v-model="form.name" class="input" required placeholder="e.g. Green Valley Public School" /></div>
        <div><label class="label">Slug (URL id, optional)</label><input v-model="form.slug" class="input" placeholder="green-valley" /></div>
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
        <input v-model="removeForm.note" class="input mb-3" :placeholder="removeForm.reason === 'OTHER' ? 'Note (zaroori hai)' : 'Note (optional)'" />
        <div class="flex gap-2">
          <button class="btn btn-primary flex-1 !bg-rose-600" @click="confirmRemove">Remove member</button>
          <button class="btn btn-ghost flex-1" @click="removeTarget = null">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>
