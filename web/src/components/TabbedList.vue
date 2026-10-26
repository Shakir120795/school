<script setup>
import { computed, ref, watch } from "vue";
import { usePager, matchStatus } from "../composables/usePager.js";
import Pager from "./Pager.vue";

// Shared tabbed member/people list — ONE pattern used by the owner
// Console drill-in and the school-side Team & Access page (and any
// future grouped list), so tabs + search + status filter + pagination
// behave identically everywhere.
//
// Props:
//   groups:           [{ key, label, items }] — one tab per group,
//                     label rendered with its count.
//   searchText(item): haystack string the search box matches against.
//   statusOf(item):   member status string, or null when the group has
//                     no status (e.g. Removed) — the status filter then
//                     hides itself for that tab.
//   resetKey:         change it (e.g. a different school opened) to
//                     reset tab/search/filter/page.
// Rows are rendered by the parent through the `row` slot
// ({ item, group }) so each view keeps its own row actions/markup.
const props = defineProps({
  groups: { type: Array, required: true },
  searchText: { type: Function, required: true },
  statusOf: { type: Function, default: null },
  pageSize: { type: Number, default: 25 },
  resetKey: { type: [String, Number], default: "" },
  searchPlaceholder: { type: String, default: "Search name, email, phone…" },
  rowKey: { type: Function, default: (i) => i.membershipId || i.id },
  // Deep-link support (Phase 28): the owner dashboard's global
  // search lands here with a chosen tab + prefilled search text.
  initialTab: { type: String, default: "" },
  initialQuery: { type: String, default: "" },
  // Phase 29: while the parent view's fetch is in flight, render a
  // loading block INSTEAD of rows / empty text / pager, and hide the
  // per-tab counts (which would otherwise flash "(0)").
  loading: { type: Boolean, default: false },
  loadingText: { type: String, default: "Loading…" },
});

const startTab = () =>
  props.groups.some((g) => g.key === props.initialTab) ? props.initialTab : props.groups[0]?.key || "";
const activeKey = ref(startTab());
const query = ref(props.initialQuery || "");
const statusFilter = ref(""); // "" all | ACTIVE | INACTIVE

const activeGroup = computed(
  () => props.groups.find((g) => g.key === activeKey.value) || props.groups[0] || { key: "", label: "", items: [] }
);
const hasStatus = computed(
  () => !!props.statusOf && (activeGroup.value.items || []).some((i) => props.statusOf(i))
);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return (activeGroup.value.items || []).filter((item) => {
    if (q && !props.searchText(item).toLowerCase().includes(q)) return false;
    if (statusFilter.value && props.statusOf && !matchStatus(props.statusOf(item), statusFilter.value)) return false;
    return true;
  });
});
const { page, pageItems, total, totalPages, from, to, reset } = usePager(filtered, props.pageSize);

watch([activeKey, query, statusFilter], reset);
watch(
  () => props.resetKey,
  () => {
    query.value = props.initialQuery || "";
    statusFilter.value = "";
    activeKey.value = startTab();
    reset();
  }
);
watch(
  () => props.groups.map((g) => g.key).join(","),
  (keys) => {
    if (!keys.split(",").includes(activeKey.value)) activeKey.value = startTab();
  }
);
</script>

<template>
  <div>
    <div class="flex gap-2 overflow-x-auto pb-1 mb-3 -mx-1 px-1">
      <button
        v-for="g in groups"
        :key="g.key"
        type="button"
        class="btn whitespace-nowrap !py-2 shrink-0"
        :class="activeKey === g.key ? 'btn-primary' : 'btn-ghost'"
        @click="activeKey = g.key"
      >
        {{ g.label }}<span v-if="!loading"> ({{ g.items.length }})</span>
      </button>
    </div>
    <div class="flex flex-wrap gap-2 mb-2">
      <input v-model="query" class="input flex-1 min-w-[180px]" :placeholder="searchPlaceholder" />
      <select v-if="hasStatus" v-model="statusFilter" class="input !w-auto">
        <option value="">All status</option>
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
      </select>
    </div>
    <div v-if="loading" class="py-2" aria-busy="true">
      <p class="text-sm text-slate-500 mb-2">{{ loadingText }}</p>
      <div class="grid gap-2 animate-pulse">
        <div class="h-10 rounded-xl bg-slate-100"></div>
        <div class="h-10 rounded-xl bg-slate-100"></div>
        <div class="h-10 rounded-xl bg-slate-100"></div>
      </div>
    </div>
    <template v-else>
      <slot v-for="item in pageItems" :key="rowKey(item)" name="row" :item="item" :group="activeGroup" />
      <p v-if="!filtered.length" class="text-sm text-slate-400 py-2">
        {{ query || statusFilter ? "No matches — try a different search or filter." : "Nothing here yet." }}
      </p>
      <Pager
        :page="page"
        :total-pages="totalPages"
        :from="from"
        :to="to"
        :total="total"
        @update:page="page = $event"
      />
    </template>
  </div>
</template>
