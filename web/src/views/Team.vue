<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";

const sid = session.schoolId;
const memberships = ref([]);
const msg = ref("");
const query = ref("");
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
const filtered = computed(() =>
  memberships.value.filter((m) =>
    (m.user.fullName + m.user.email + m.role).toLowerCase().includes(query.value.toLowerCase())
  )
);
const roleChip = (r) =>
  ({ SCHOOL_ADMIN: "bg-violet-100 text-violet-700", PRINCIPAL: "bg-indigo-100 text-indigo-700", TEACHER: "bg-sky-100 text-sky-700", STAFF: "bg-slate-200 text-slate-600", PARENT: "bg-emerald-100 text-emerald-700" })[r];

const removedList = ref([]);
const REASON_LABEL = { LEFT_SCHOOL: "Naam katwaya — school chhoda", RESIGNED: "Staff ne chhoda", DUPLICATE: "Duplicate ID galti se bani", OTHER: "Other" };
async function load() {
  const r = await api(`/schools/${sid}/users`);
  if (r.status === 200) memberships.value = r.json.memberships.filter((m) => m.status !== "INACTIVE");
  const rr = await api(`/schools/${sid}/users/removed`);
  if (rr.status === 200) removedList.value = rr.json.removed;
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
async function editMember(m) {
  const fullName = prompt("Full name:", m.user.fullName); if (fullName === null) return;
  const email = prompt("Login email / ID:", m.user.email || ""); if (email === null) return;
  const phone = prompt("Phone (leave blank for none):", m.user.phone || ""); if (phone === null) return;
  const r = await api(`/schools/${sid}/users/${m.id}`, { method: "PATCH", body: { fullName, email, phone } });
  if (r.status === 200) { msg.value = `${fullName} updated.`; load(); }
  else msg.value = r.json.error || "Could not edit member.";
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
onMounted(load);
</script>

<template>
  <h1 class="text-2xl font-extrabold mb-1">Team & Access</h1>
  <p class="text-sm text-slate-500 mb-4">Who can log in to this school, with what role. Create new login IDs and suspend access here.</p>

  <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
    <div v-for="r in ROLES" :key="r" class="card text-center !py-3">
      <div class="text-2xl font-extrabold">{{ counts[r] }}</div>
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

    <div class="card lg:col-span-2 !p-0 overflow-hidden">
      <div class="p-4 pb-2 flex items-center justify-between gap-3">
        <h2 class="font-bold">All members ({{ memberships.length }})</h2>
        <input v-model="query" class="input !w-56" placeholder="Search name, email, role…" />
      </div>
      <p v-if="msg" class="px-4 pb-2 text-sm text-brand-700">{{ msg }}</p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm mtable">
          <thead><tr class="text-left text-slate-500 border-y bg-slate-50"><th class="p-3">Member</th><th class="p-3">Role</th><th class="p-3">Status</th><th class="p-3"></th></tr></thead>
          <tbody>
            <tr v-for="m in filtered" :key="m.id" class="border-b last:border-0" :class="m.status !== 'ACTIVE' ? 'opacity-50' : ''">
              <td class="p-3"><div class="font-semibold">{{ m.user.fullName }}</div><div class="text-xs text-slate-400">{{ m.user.email }}<span v-if="m.user.phone"> · {{ m.user.phone }}</span></div></td>
              <td class="p-3"><span class="chip" :class="roleChip(m.role)">{{ m.role.replace("_", " ") }}</span></td>
              <td class="p-3"><span class="chip" :class="m.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'">{{ m.status }}</span></td>
              <td class="p-3 text-right whitespace-nowrap"><button type="button" class="text-xs font-bold text-brand-600 mr-3" @click="editMember(m)">Edit</button><button type="button" class="text-xs font-bold text-brand-600 mr-3" @click="resetPassword(m)">Reset password</button><button type="button" class="text-xs font-bold mr-3" :class="m.status === 'ACTIVE' ? 'text-rose-600' : 'text-emerald-600'" @click="toggleStatus(m)">{{ m.status === "ACTIVE" ? "Suspend" : "Reactivate" }}</button><button type="button" class="text-xs font-bold text-rose-700" @click="openRemove(m)">Remove</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div v-if="removedList.length" class="card mt-4">
    <h2 class="font-bold mb-1">Removed members ({{ removedList.length }})</h2>
    <p class="text-sm text-slate-500 mb-3">Inke login band hain. Wajah ke saath record rehta hai — kab, kisne, kyun hataya.</p>
    <div v-for="m in removedList" :key="m.membershipId" class="flex flex-wrap items-center gap-2 py-2 border-b border-slate-50 last:border-0 opacity-70">
      <span class="font-semibold text-sm">{{ m.fullName }}</span>
      <span class="chip" :class="roleChip(m.role)">{{ m.role.replace("_", " ") }}</span>
      <span class="text-xs text-slate-500">{{ REASON_LABEL[m.reason] || m.reason || "—" }}{{ m.note ? " · " + m.note : "" }}</span>
      <span class="text-[11px] text-slate-400 ml-auto">by {{ m.removedBy || "—" }} · {{ String(m.removedAt).slice(0, 10) }}</span>
    </div>
  </div>

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
