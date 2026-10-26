<script setup>
import { onMounted, ref } from "vue";
import { api } from "../api.js";

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
// Phase 23 drill-in: open one school and see/control everyone in it.
const openId = ref("");
const members = ref(null);
const membersBusy = ref(false);
const ROLE_ORDER = ["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER", "STAFF", "PARENT"];
const ROLE_LABEL = { SCHOOL_ADMIN: "School Admin", PRINCIPAL: "Principal", TEACHER: "Teachers", STAFF: "Staff", PARENT: "Parents" };
async function toggleMembers(s) {
  if (openId.value === s.id) { openId.value = ""; members.value = null; return; }
  openId.value = s.id; members.value = null; membersBusy.value = true; err.value = "";
  const r = await api(`/platform/schools/${s.id}/members`, { school: false });
  membersBusy.value = false;
  if (r.status === 200) members.value = r.json.members;
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
onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">👑 Super Admin Console</h1>
    <p class="text-sm text-slate-500 mb-4">Every school on the platform. You are above all schools — school staff work inside their own school only.</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <div class="grid gap-3 mb-4">
      <div v-for="s in schools" :key="s.id" class="card !py-3">
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
            <template v-for="role in ROLE_ORDER" :key="role">
              <div v-if="members[role]?.length" class="mb-3">
                <div class="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">{{ ROLE_LABEL[role] }} ({{ members[role].length }})</div>
                <div v-for="m in members[role]" :key="m.membershipId" class="flex flex-wrap items-center gap-2 py-1.5 border-b border-slate-50 last:border-0">
                  <span class="font-semibold text-sm">{{ m.fullName }}</span>
                  <span class="text-xs text-slate-400">{{ m.email || "" }}{{ m.phone ? " · " + m.phone : "" }}</span>
                  <span v-if="role === 'PARENT'" class="chip bg-sky-50 text-sky-700 text-[10px]">🎓 {{ m.childrenCount }} child{{ m.childrenCount === 1 ? "" : "ren" }}</span>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="m.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ m.status }}</span>
                  <button class="btn btn-ghost !py-1 !px-2 text-[11px] ml-auto" @click="resetMember(s, m)">Reset password</button>
                </div>
              </div>
            </template>
            <p v-if="!Object.values(members).some((g) => g.length)" class="text-sm text-slate-400">No members yet.</p>
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
  </div>
</template>
