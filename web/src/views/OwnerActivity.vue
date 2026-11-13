<script setup>
// Activity (Phase 67) — owner ka platform-wide activity log ab
// apne tab me (ab tak Console ke andar band tha). Kaun, kab, kis
// school me, kya hua — school + action filter ke saath.
import { computed, onMounted, ref } from "vue";
import { api } from "../api.js";
import Pager from "../components/Pager.vue";

const items = ref([]);
const schools = ref([]);
const actions = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(25);
const totalPages = ref(1);
const loading = ref(true);
const schoolId = ref("");
const action = ref("");

const from = computed(() => (total.value ? (page.value - 1) * pageSize.value + 1 : 0));
const to = computed(() => Math.min(total.value, page.value * pageSize.value));
const fmtWhen = (d) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const roleChipCls = (r) => r === "PLATFORM_ADMIN" ? "bg-violet-100 text-violet-700"
  : r === "SCHOOL_ADMIN" ? "bg-brand-100 text-brand-700"
  : r === "TEACHER" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600";

async function load() {
  loading.value = true;
  try {
    const qs = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) });
    if (schoolId.value) qs.set("schoolId", schoolId.value);
    if (action.value) qs.set("action", action.value);
    const r = await api(`/platform/activity?${qs}`, { school: false });
    if (r.ok) {
      items.value = r.json.items || [];
      total.value = r.json.total || 0;
      totalPages.value = r.json.totalPages || 1;
      if (r.json.actions?.length) actions.value = r.json.actions;
    }
  } finally { loading.value = false; }
}
function filterChanged() { page.value = 1; load(); }
onMounted(async () => {
  const s = await api("/platform/schools", { school: false });
  if (s.ok) schools.value = s.json.schools || [];
  load();
});
</script>

<template>
  <section>
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-extrabold">🕘 Activity</h1>
      <span class="text-xs text-slate-400">{{ total }} event(s)</span>
      <span class="ml-auto flex flex-wrap gap-2">
        <select v-model="schoolId" class="input !w-auto !py-1.5 text-xs" @change="filterChanged">
          <option value="">All schools</option>
          <option v-for="s in schools" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <select v-model="action" class="input !w-auto !py-1.5 text-xs" @change="filterChanged">
          <option value="">All actions</option>
          <option v-for="a in actions" :key="a.action" :value="a.action">{{ a.label }}</option>
        </select>
        <select v-model.number="pageSize" class="input !w-auto !py-1.5 text-xs" @change="filterChanged">
          <option :value="25">25 / page</option>
          <option :value="50">50 / page</option>
          <option :value="100">100 / page</option>
        </select>
      </span>
    </div>

    <div class="card mt-3">
      <p v-if="loading" class="text-sm text-slate-400 animate-pulse">Loading activity…</p>
      <template v-else>
        <p v-if="!items.length" class="text-sm text-slate-400">No activity yet.</p>
        <div v-for="it in items" :key="it.id" class="flex flex-wrap items-center gap-2 py-2 border-b border-slate-50 last:border-0">
          <span class="text-[11px] text-slate-400 w-32 shrink-0">{{ fmtWhen(it.createdAt) }}</span>
          <span class="font-semibold text-sm">{{ it.actorName || "—" }}</span>
          <span v-if="it.actorRole" class="text-[10px] font-bold px-1.5 py-0.5 rounded" :class="roleChipCls(it.actorRole)">{{ it.actorRole.replace("_", " ") }}</span>
          <span class="text-sm">{{ it.label }}</span>
          <span v-if="it.schoolName" class="chip bg-slate-100 text-slate-600">{{ it.schoolName }}</span>
          <span v-if="it.detailsText" class="text-xs text-slate-500 w-full sm:w-auto">{{ it.detailsText }}</span>
        </div>
        <Pager :page="page" :total-pages="totalPages" :from="from" :to="to" :total="total" @update:page="(p) => { page = p; load(); }" />
      </template>
    </div>
  </section>
</template>
