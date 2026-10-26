<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";
import TabbedList from "../components/TabbedList.vue";
import MemberEditModal from "../components/MemberEditModal.vue";
import MemberCard from "../components/MemberCard.vue";
import Pager from "../components/Pager.vue";

const sid = session.schoolId;
const loading = ref(true);
const memberships = ref([]);
const msg = ref("");
const form = ref({ fullName: "", email: "", password: "", role: "TEACHER", phone: "", guardianPhone: "" });
const origin = window.location.origin;
async function copyLink(path) {
  try { await navigator.clipboard.writeText(origin + path); msg.value = `Copied: ${origin}${path}`; } catch { msg.value = origin + path; }
}

const ROLES = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"];
const counts = computed(() => {
  const c = {};
  for (const r of ROLES) c[r] = memberships.value.filter((m) => m.role === r).length;
  return c;
});
// Scale-ready member list: one tab per group (Admins / Teachers /
// Staff / Parents / Removed), each with search + status filter +
// 25-per-page pagination — the shared <TabbedList> pattern, identical
// to the owner Console drill-in. Client-side over the fetched lists.
const memberGroups = computed(() => {
  const by = (...roles) => memberships.value.filter((m) => roles.includes(m.role));
  return [
    { key: "ADMINS", label: "Admins", items: by("SCHOOL_ADMIN", "PRINCIPAL") },
    { key: "TEACHERS", label: "Teachers", items: by("TEACHER") },
    { key: "STAFF", label: "Staff", items: by("STAFF") },
    { key: "PARENTS", label: "Parents", items: by("PARENT") },
    { key: "REMOVED", label: "Removed", items: removedList.value },
  ];
});
const memberSearchText = (m) =>
  [
    m.user?.fullName || m.fullName, m.user?.email || m.email, m.user?.phone || m.phone, m.role, m.reason, m.note,
    // Parents are also findable by their child's name or class ("1-A").
    ...((m.children || []).flatMap((c) => [c.name, c.classLabel, c.fatherName, c.motherName])),
  ]
    .filter(Boolean)
    .join(" ");
const memberStatusOf = (m) => m.status ?? null;
const memberRowKey = (m) => m.id || m.membershipId;
const roleChip = (r) =>
  ({ SCHOOL_ADMIN: "bg-violet-100 text-violet-700", PRINCIPAL: "bg-indigo-100 text-indigo-700", TEACHER: "bg-sky-100 text-sky-700", STAFF: "bg-slate-200 text-slate-600", PARENT: "bg-emerald-100 text-emerald-700" })[r];

const removedList = ref([]);
const REASON_LABEL = { LEFT_SCHOOL: "Naam katwaya — school chhoda", RESIGNED: "Staff ne chhoda", DUPLICATE: "Duplicate ID galti se bani", OTHER: "Other" };
async function load() {
  loading.value = true;
  try {
    const r = await api(`/schools/${sid}/users`);
    if (r.status === 200) memberships.value = r.json.memberships.filter((m) => m.status !== "INACTIVE");
    const rr = await api(`/schools/${sid}/users/removed`);
    if (rr.status === 200) removedList.value = rr.json.removed;
  } finally {
    loading.value = false;
  }
}
async function createLogin() {
  const r = await api(`/schools/${sid}/users`, { method: "POST", body: form.value });
  if (r.status === 201) {
    msg.value = `Login created for ${form.value.email} (${form.value.role}). Share the password with them securely.` +
      (r.json.guardiansLinked ? ` Linked to ${r.json.guardiansLinked} guardian record(s) — their children are now visible on this login.` : "");
    form.value = { fullName: "", email: "", password: "", role: "TEACHER", phone: "", guardianPhone: "" };
    load();
  } else msg.value = r.json.error || "Could not create login.";
}
async function resetPassword(m) {
  const pw = prompt(`New password for ${m.user.fullName} (${m.user.email}) — at least 8 characters:`);
  if (!pw) return;
  const r = await api(`/schools/${sid}/users/${m.id}/reset-password`, { method: "POST", body: { newPassword: pw } });
  if (r.status === 200) msg.value = `Password reset for ${m.user.fullName}. Share the new password with them securely.`;
  else msg.value = r.json.error || "Could not reset password.";
}
async function toggleStatus(m) {
  const next = m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const r = await api(`/schools/${sid}/users/${m.id}`, { method: "PATCH", body: { status: next } });
  if (r.status === 200) { m.status = next; msg.value = `${m.user.fullName} is now ${next}.`; }
  else msg.value = r.json.error || "Could not change status.";
}
// Edit = one in-app modal form (Full name / Login email / Phone),
// shared with the owner Console via <MemberEditModal>. Server errors
// (e.g. the 409 email conflict) show INSIDE the form and nothing is
// saved; on success the list reloads in place.
const EDIT_ERRORS = {
  EMAIL_ALREADY_IN_USE: "This login email is already used by another account — nothing was saved.",
  INVALID_EMAIL: "Please enter a valid email address.",
  FULL_NAME_REQUIRED: "Full name cannot be empty.",
};
const editTarget = ref(null); // membership (with .user)
const editError = ref("");
const editSaving = ref(false);
function editMember(m) {
  editError.value = "";
  editTarget.value = m;
}
async function saveEditMember(values) {
  const m = editTarget.value;
  editSaving.value = true; editError.value = "";
  const r = await api(`/schools/${sid}/users/${m.id}`, { method: "PATCH", body: values });
  editSaving.value = false;
  if (r.status === 200) {
    editTarget.value = null;
    msg.value = `${values.fullName} updated.`;
    load();
  } else editError.value = EDIT_ERRORS[r.json?.error] || r.json?.error || "Could not edit member.";
}
const removeTarget = ref(null);
const removeForm = ref({ reason: "LEFT_SCHOOL", note: "" });
function openRemove(m) {
  removeTarget.value = m;
  removeForm.value = { reason: "LEFT_SCHOOL", note: "" };
}
async function confirmRemove() {
  const m = removeTarget.value;
  if (removeForm.value.reason === "OTHER" && !removeForm.value.note.trim()) { msg.value = "“Other” ke liye note likhna zaroori hai."; return; }
  const r = await api(`/schools/${sid}/users/${m.id}`, { method: "DELETE", body: { reason: removeForm.value.reason, note: removeForm.value.note.trim() || undefined } });
  removeTarget.value = null;
  if (r.status === 200) { msg.value = `${m.user.fullName} removed (${REASON_LABEL[r.json.reason]}).`; load(); }
  else msg.value = r.json.error || "Could not remove member.";
}
// Phase 29 WS2: this school's activity log (own school only —
// the server forces the school scope and requires SCHOOL_ADMIN /
// PRINCIPAL, so other roles simply see the empty state).
const actItems = ref([]);
const actTotal = ref(0);
const actPage = ref(1);
const actTotalPages = ref(1);
const actLoading = ref(true);
const actLoaded = ref(false);
const actAction = ref("");
const actActions = ref([]);
const ACT_PAGE_SIZE = 25;
const actFrom = computed(() => (actTotal.value === 0 ? 0 : (actPage.value - 1) * ACT_PAGE_SIZE + 1));
const actTo = computed(() => Math.min(actTotal.value, actPage.value * ACT_PAGE_SIZE));
const actRoleChip = (r) =>
  ({ PLATFORM_ADMIN: "bg-violet-600 text-white", SCHOOL_ADMIN: "bg-violet-100 text-violet-700", PRINCIPAL: "bg-indigo-100 text-indigo-700", TEACHER: "bg-sky-100 text-sky-700", STAFF: "bg-slate-200 text-slate-600", PARENT: "bg-emerald-100 text-emerald-700" })[r] || "bg-slate-100 text-slate-500";
const fmtWhen = (iso) => (iso ? String(iso).replace("T", " ").slice(0, 16) : "—");
async function loadActivity() {
  actLoading.value = true;
  try {
    const qs = new URLSearchParams({ page: String(actPage.value), pageSize: String(ACT_PAGE_SIZE) });
    if (actAction.value) qs.set("action", actAction.value);
    const r = await api(`/schools/${sid}/activity?${qs}`);
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

// Phase 29 WS7: bulk teacher import — same UX as the student import
// (Import & Export page): download a template, pick a CSV file, run,
// then a per-row results panel. Rows that fail (duplicate email etc.)
// are reported, never fatal; the member list refreshes after import.
const impFileName = ref("");
const impRowCount = ref(0);
const impCsv = ref("");
const impBusy = ref(false);
const impResult = ref(null);
const impErr = ref("");
const TEACHER_TEMPLATE = "name,email,phone,password\nPriya Nair,priya.nair@example.com,9811100033,\nKabir Shah,kabir.shah@example.com,,Welcome@123\n";
function impDownloadTemplate() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([TEACHER_TEMPLATE], { type: "text/csv" }));
  a.download = "teachers-import-template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function impOnFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  impFileName.value = f.name;
  impCsv.value = await f.text();
  const lines = impCsv.value.split(/\r?\n/).filter((l) => l.trim());
  impRowCount.value = Math.max(0, lines.length - 1);
  impResult.value = null;
  impErr.value = "";
}
async function runTeacherImport() {
  impErr.value = ""; impBusy.value = true;
  const r = await api(`/schools/${sid}/teachers/import`, { method: "POST", body: { csv: impCsv.value } });
  impBusy.value = false;
  if (r.status === 201) {
    impResult.value = r.json;
    msg.value = `Teacher import done: ${r.json.created} teacher login(s) created, ${r.json.failed} row(s) skipped.`;
    load();
  } else impErr.value = r.json?.error || "Teacher import failed";
}

onMounted(load);
onMounted(loadActivity);
</script>

<template>
  <h1 class="text-2xl font-extrabold mb-1">Team & Access</h1>
  <p class="text-sm text-slate-500 mb-4">Who can log in to this school, with what role. Create new login IDs and suspend access here.</p>

  <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
    <div v-for="r in ROLES" :key="r" class="card text-center !py-3">
      <div class="text-2xl font-extrabold">{{ loading ? "…" : counts[r] }}</div>
      <div class="text-[11px] font-semibold text-slate-500">{{ r.replace("_", " ") }}</div>
    </div>
  </div>

  <div class="card mb-4">
    <h2 class="font-bold mb-1">Login links for your school</h2>
    <p class="text-sm text-slate-500 mb-3">Share the right link with each person. Parents, teachers and the school office each have their own login page.</p>
    <div class="grid sm:grid-cols-3 gap-2 text-sm">
      <div class="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-3 py-2"><span>👨‍👩‍👧 {{ origin }}/login/parent</span><button type="button" class="btn !py-1 !px-2 text-xs" @click="copyLink('/login/parent')">Copy</button></div>
      <div class="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-3 py-2"><span>🧑‍🏫 {{ origin }}/login/teacher</span><button type="button" class="btn !py-1 !px-2 text-xs" @click="copyLink('/login/teacher')">Copy</button></div>
      <div class="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-3 py-2"><span>🏫 {{ origin }}/login/school</span><button type="button" class="btn !py-1 !px-2 text-xs" @click="copyLink('/login/school')">Copy</button></div>
    </div>
  </div>

  <div class="grid lg:grid-cols-3 gap-4 items-start">
    <form class="card space-y-3" @submit.prevent="createLogin">
      <h2 class="font-bold">Create new login ID</h2>
      <div><label class="label">Full name</label><input v-model="form.fullName" class="input" required /></div>
      <div><label class="label">Email (login ID)</label><input v-model="form.email" type="email" class="input" required /></div>
      <div><label class="label">Password</label><input v-model="form.password" class="input" required minlength="8" /></div>
      <div><label class="label">Phone (optional)</label><input v-model="form.phone" class="input" /></div>
      <div v-if="form.role === 'PARENT'"><label class="label">Guardian mobile (links this parent to their children)</label><input v-model="form.guardianPhone" type="tel" class="input" placeholder="Guardian's registered mobile number" /></div>
      <div><label class="label">Role / permission</label>
        <select v-model="form.role" class="input">
          <option v-for="r in ROLES" :key="r" :value="r">{{ r.replace("_", " ") }}</option>
        </select>
      </div>
      <button class="btn btn-primary w-full">Create login</button>
      <p class="text-[11px] text-slate-400">A teacher also needs a teacher profile + class assignment (People tab) before they can send class notices.</p>
    </form>

    <div class="card lg:col-span-2">
      <h2 class="font-bold mb-3">All members<span v-if="!loading"> ({{ memberships.length }})</span></h2>
      <p v-if="msg" class="pb-2 text-sm text-brand-700">{{ msg }}</p>
      <TabbedList
        :groups="memberGroups"
        :search-text="memberSearchText"
        :status-of="memberStatusOf"
        :row-key="memberRowKey"
        :loading="loading"
        loading-text="Loading members…"
        search-placeholder="Search name, email, phone…"
      >
        <template #row="{ item: m, group }">
          <div v-if="group.key === 'REMOVED'" class="flex flex-wrap items-center gap-2 py-2 border-b border-slate-50 last:border-0 opacity-70">
            <span class="font-semibold text-sm">{{ m.fullName }}</span>
            <span class="chip" :class="roleChip(m.role)">{{ m.role.replace("_", " ") }}</span>
            <span class="text-xs text-slate-500">{{ REASON_LABEL[m.reason] || m.reason || "—" }}{{ m.note ? " · " + m.note : "" }}</span>
            <span class="text-[11px] text-slate-400 ml-auto">by {{ m.removedBy || "—" }} · {{ String(m.removedAt).slice(0, 10) }}</span>
          </div>
          <MemberCard
            v-else
            :name="m.user.fullName"
            :role="m.role"
            :status="m.status"
            :email="m.user.email || ''"
            :phone="m.user.phone || ''"
            :children="m.role === 'PARENT' ? (m.children || []) : null"
            :toggle-text="m.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'"
            @edit="editMember(m)"
            @toggle-status="toggleStatus(m)"
            @reset="resetPassword(m)"
            @remove="openRemove(m)"
          />
        </template>
      </TabbedList>
      <p class="text-[11px] text-slate-400 mt-3">Removed members ke login band hain — unka record Removed tab me rehta hai: kab, kisne, kyun hataya.</p>
    </div>
  </div>

  <div class="card mt-4">
    <h2 class="font-bold mb-1">Import teachers (CSV)</h2>
    <p class="text-sm text-slate-500 mb-3">
      Columns: <b>name, email</b> (required), phone, password. Format: name,email,phone,password — one teacher per row.
      The password column is optional: leave it blank and the login is created with the default password <b>Welcome@123</b> (ask the teacher to change it later via password reset).
      An email that already belongs to this school, or is repeated in the file, is skipped and reported — the rest still import.
    </p>
    <p v-if="impErr" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ impErr }}</p>
    <div class="flex flex-wrap gap-2 mb-3">
      <button type="button" class="btn btn-ghost" @click="impDownloadTemplate">⬇ Download template CSV</button>
      <label class="btn btn-ghost cursor-pointer">
        Choose CSV file
        <input type="file" accept=".csv,text/csv" class="hidden" @change="impOnFile" />
      </label>
      <span v-if="impFileName" class="text-sm text-slate-500 self-center">{{ impFileName }} — {{ impRowCount }} data rows</span>
    </div>
    <button type="button" class="btn btn-primary" :disabled="!impCsv || impBusy" @click="runTeacherImport">{{ impBusy ? "Importing…" : "Import teachers" }}</button>

    <div v-if="impResult" class="mt-4 text-sm">
      <div class="flex flex-wrap gap-2 mb-2">
        <span class="chip bg-emerald-100 text-emerald-700">Created: {{ impResult.created }}</span>
        <span v-if="impResult.failed" class="chip bg-rose-100 text-rose-700">Skipped rows: {{ impResult.failed }}</span>
      </div>
      <div class="grid gap-1">
        <div v-for="(r, i) in impResult.results" :key="i" class="text-xs rounded-lg px-2 py-1.5 border" :class="r.ok ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'">
          Row {{ r.row }}<span v-if="r.email"> ({{ r.email }})</span> — {{ r.ok ? "Created" : r.error }}
        </div>
      </div>
    </div>
  </div>

  <div class="card mt-4">
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <h2 class="font-bold">🕘 Activity</h2>
      <span v-if="actLoaded && !actLoading" class="text-xs text-slate-400">{{ actTotal }} event(s) in this school</span>
      <span class="ml-auto">
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
        <span v-if="it.actorRole" class="chip" :class="actRoleChip(it.actorRole)">{{ it.actorRole.replace("_", " ") }}</span>
        <span class="text-sm">{{ it.label }}</span>
        <span v-if="it.detailsText" class="text-xs text-slate-500 w-full sm:w-auto">{{ it.detailsText }}</span>
      </div>
      <Pager :page="actPage" :total-pages="actTotalPages" :from="actFrom" :to="actTo" :total="actTotal" @update:page="actPageChanged" />
    </template>
  </div>

  <MemberEditModal
    v-if="editTarget"
    title="Edit member"
    :subtitle="editTarget.role.replace('_', ' ')"
    :initial="{ fullName: editTarget.user.fullName, email: editTarget.user.email, phone: editTarget.user.phone }"
    :error="editError"
    :saving="editSaving"
    @save="saveEditMember"
    @close="editTarget = null"
  />

  <div v-if="removeTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="removeTarget = null">
    <div class="card w-full max-w-md">
      <h2 class="font-bold mb-1">Remove {{ removeTarget.user.fullName }}?</h2>
      <p class="text-sm text-slate-500 mb-3">{{ removeTarget.role.replace("_", " ") }} — unka login band ho jayega. Pehle wajah chuno:</p>
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
</template>
