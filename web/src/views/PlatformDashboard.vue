<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, currentUser } from "../api.js";

// Platform overview for the operator (Phase 27) — what the owner
// sees on "/" instead of an empty school dashboard: the WHOLE
// platform in one place. Totals are computed from GET
// /platform/schools, which already returns per-school counts.
// Management (members, suspend, delete…) stays in /console —
// clicking a school card goes there.
const router = useRouter();
const user = currentUser();
const schools = ref([]);
const loading = ref(true);
const err = ref("");

const totals = computed(() => {
  const t = { schools: schools.value.length, active: 0, suspended: 0, students: 0, teachers: 0, parents: 0, classes: 0 };
  for (const s of schools.value) {
    if (s.status === "ACTIVE") t.active++;
    else if (s.status === "SUSPENDED") t.suspended++;
    t.students += s.students || 0;
    t.teachers += s.teachers || 0;
    t.parents += s.parents || 0;
    t.classes += s.classes || 0;
  }
  return t;
});

async function load() {
  const r = await api("/platform/schools", { school: false });
  if (r.status === 200) schools.value = r.json.schools || [];
  else err.value = r.json?.error || "Could not load platform data";
  loading.value = false;
}
onMounted(load);

// Phase 28: GLOBAL search — one box searches the WHOLE platform
// (schools, members of any role, guardians, students) by name,
// login email, mobile number or admission number, via
// GET /platform/search. Results deep-link into the Console:
// /console?school=<id>&tab=<tab>&q=<text> opens that school's
// members on the right tab with the search prefilled.
const query = ref("");
const results = ref(null); // { schools, people, students }
const searching = ref(false);
let searchSeq = 0;
let debounce = null;
watch(query, (val) => {
  const q = val.trim();
  clearTimeout(debounce);
  if (q.length < 2) { results.value = null; searching.value = false; return; }
  searching.value = true;
  debounce = setTimeout(async () => {
    const seq = ++searchSeq;
    const r = await api(`/platform/search?q=${encodeURIComponent(q)}`, { school: false });
    if (seq !== searchSeq) return;
    searching.value = false;
    results.value = r.status === 200 ? r.json : { schools: [], people: [], students: [] };
  }, 300);
});
const ROLE_LABEL = { SCHOOL_ADMIN: "School Admin", PRINCIPAL: "Principal", TEACHER: "Teacher", STAFF: "Staff", PARENT: "Parent" };
const staffResults = computed(() => (results.value?.people || []).filter((p) => p.role !== "PARENT"));
const parentResults = computed(() => (results.value?.people || []).filter((p) => p.role === "PARENT"));
const hasResults = computed(
  () =>
    !!results.value &&
    (results.value.schools.length || staffResults.value.length || parentResults.value.length || results.value.students.length)
);
const TAB_FOR_ROLE = { TEACHER: "teachers", PARENT: "parents", STAFF: "staff", SCHOOL_ADMIN: "admins", PRINCIPAL: "admins" };
function openSchool(id) {
  router.push({ path: "/console", query: { school: id } });
}
function openPerson(p) {
  router.push({ path: "/console", query: { school: p.schoolId, tab: TAB_FOR_ROLE[p.role] || "admins", q: p.fullName } });
}
function openStudent(s) {
  // Land on the school's Parents tab prefilled with the student's
  // name — the parent rows there are searchable by child name.
  router.push({ path: "/console", query: { school: s.schoolId, tab: "parents", q: s.fullName } });
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">👑 Platform Dashboard</h1>
        <p class="text-sm text-slate-500">Platform overview · Welcome back, {{ user?.fullName }} (PLATFORM_ADMIN)</p>
      </div>
      <button type="button" class="btn btn-primary" @click="router.push('/console')">Open Super Admin Console →</button>
    </div>

    <!-- Global search (Phase 28): the whole platform in one box -->
    <div class="card mb-5">
      <label class="label" for="platform-search">🔎 Search the whole platform</label>
      <input
        id="platform-search"
        v-model="query"
        class="input"
        type="search"
        placeholder="Search any school, teacher, parent or student — by name or mobile number…"
        autocomplete="off"
      />
      <p class="text-[11px] text-slate-400 mt-1">Naam, login email, mobile number ya admission number — kisi bhi school me milega.</p>
    </div>

    <div v-if="loading" class="card text-slate-500">Loading platform data…</div>
    <p v-else-if="err" class="card text-sm text-red-700 !bg-red-50 !border-red-200">{{ err }}</p>

    <template v-else>
      <!-- Platform totals -->
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <div class="card">
          <div class="text-3xl font-extrabold">{{ totals.schools }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Schools</div>
          <div class="text-[11px] text-slate-400 mt-1">{{ totals.active }} active · {{ totals.suspended }} suspended</div>
        </div>
        <div class="card">
          <div class="text-3xl font-extrabold">🎓 {{ totals.students }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Students</div>
        </div>
        <div class="card">
          <div class="text-3xl font-extrabold">👩‍🏫 {{ totals.teachers }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Teachers</div>
        </div>
        <div class="card">
          <div class="text-3xl font-extrabold">👨‍👩‍👧 {{ totals.parents }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Parents</div>
        </div>
        <div class="card">
          <div class="text-3xl font-extrabold">🏫 {{ totals.classes }}</div>
          <div class="text-xs text-slate-500 font-medium">Total Classes</div>
        </div>
      </div>

      <!-- Search results (shown while a query is typed) -->
      <template v-if="query.trim()">
        <p v-if="query.trim().length < 2" class="card text-sm text-slate-400">Type at least 2 letters to search…</p>
        <p v-else-if="searching && !results" class="card text-sm text-slate-400">Searching…</p>
        <p v-else-if="results && !hasResults" class="card text-sm text-slate-400">No matches found for “{{ query.trim() }}” — try a name, mobile number or admission number.</p>
        <template v-else-if="results">
          <div v-if="results.schools.length" class="mb-5">
            <h2 class="font-bold mb-3">🏫 Schools ({{ results.schools.length }})</h2>
            <div class="grid gap-2">
              <button v-for="s in results.schools" :key="s.id" type="button" class="card !py-3 text-left w-full hover:border-brand-300 transition" @click="openSchool(s.id)">
                <span class="font-bold">{{ s.name }}</span>
                <span class="text-xs text-slate-400 ml-2">{{ s.slug }}</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ml-2" :class="s.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'">{{ s.status }}</span>
                <span class="block text-xs text-slate-400 mt-1">Tap to open in the Console →</span>
              </button>
            </div>
          </div>
          <div v-if="staffResults.length" class="mb-5">
            <h2 class="font-bold mb-3">👩‍🏫 Teachers &amp; Staff ({{ staffResults.length }})</h2>
            <div class="grid gap-2">
              <button v-for="p in staffResults" :key="p.membershipId || p.userId" type="button" class="card !py-3 text-left w-full hover:border-brand-300 transition" @click="openPerson(p)">
                <span class="font-bold">{{ p.fullName }}</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 ml-2">{{ ROLE_LABEL[p.role] || p.role }}</span>
                <span class="block text-sm text-slate-500 mt-1">{{ p.schoolName }}<span v-if="p.email"> · {{ p.email }}</span><span v-if="p.phone"> · {{ p.phone }}</span></span>
              </button>
            </div>
          </div>
          <div v-if="parentResults.length" class="mb-5">
            <h2 class="font-bold mb-3">👨‍👩‍👧 Parents ({{ parentResults.length }})</h2>
            <div class="grid gap-2">
              <button v-for="p in parentResults" :key="p.membershipId || p.guardianId || p.userId" type="button" class="card !py-3 text-left w-full hover:border-brand-300 transition" @click="openPerson(p)">
                <span class="font-bold">{{ p.fullName }}</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 ml-2">Parent</span>
                <span class="block text-sm text-slate-500 mt-1">{{ p.schoolName }}<span v-if="p.email"> · {{ p.email }}</span><span v-if="p.phone"> · {{ p.phone }}</span></span>
                <span v-if="p.children && p.children.length" class="block text-xs text-slate-400 mt-0.5">🎓 {{ p.children.join(" · ") }}</span>
              </button>
            </div>
          </div>
          <div v-if="results.students.length" class="mb-5">
            <h2 class="font-bold mb-3">🎓 Students ({{ results.students.length }})</h2>
            <div class="grid gap-2">
              <button v-for="s in results.students" :key="s.id" type="button" class="card !py-3 text-left w-full hover:border-brand-300 transition" @click="openStudent(s)">
                <span class="font-bold">{{ s.fullName }}</span>
                <span v-if="s.classLabel" class="chip bg-slate-100 text-slate-600 ml-2">{{ s.classLabel }}</span>
                <span class="block text-sm text-slate-500 mt-1">{{ s.schoolName }} · Admission no. {{ s.admissionNo }}</span>
              </button>
            </div>
          </div>
        </template>
      </template>

      <template v-else>
      <h2 class="font-bold mb-3">Schools</h2>
      <p v-if="!schools.length" class="card text-sm text-slate-400">No schools yet — create the first one in the Super Admin Console.</p>
      <div class="grid md:grid-cols-2 gap-3">
        <button
          v-for="s in schools"
          :key="s.id"
          type="button"
          class="card text-left w-full hover:border-brand-300 transition"
          @click="router.push('/console')"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-lg font-bold">{{ s.name }}</span>
            <span class="text-xs text-slate-400">{{ s.slug }}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto" :class="s.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'">{{ s.status }}</span>
          </div>
          <div class="flex flex-wrap gap-2 mt-3 text-xs">
            <span class="chip bg-slate-100 text-slate-600">🎓 {{ s.students }} students</span>
            <span class="chip bg-slate-100 text-slate-600">👩‍🏫 {{ s.teachers }} teachers</span>
            <span class="chip bg-slate-100 text-slate-600">👨‍👩‍👧 {{ s.parents }} parents</span>
            <span class="chip bg-slate-100 text-slate-600">🏫 {{ s.classes }} classes</span>
          </div>
          <div class="text-sm text-slate-500 mt-3">
            Admin: <span class="font-medium text-slate-700">{{ s.adminName || "—" }}</span>
            <span v-if="s.adminEmail"> · {{ s.adminEmail }}</span>
          </div>
          <div class="text-[11px] text-slate-400 mt-1">Since {{ String(s.createdAt).slice(0, 10) }} · Tap to manage in the Console →</div>
        </button>
      </div>
      </template>
    </template>
  </div>
</template>
