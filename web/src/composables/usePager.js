import { computed, ref, watch } from "vue";

// Shared client-side pager (scale-ready lists). Pass a ref/computed
// holding the ALREADY search/filtered list; get back the current page
// slice plus pager state for the <Pager> component. Filtering stays in
// the view; this only slices — so 500–1000 row lists behave the same
// everywhere (Console, Team, Students, Roll-Call, Exams, Attendance).
export function usePager(source, pageSize = 25) {
  const page = ref(1);
  const total = computed(() => source.value?.length || 0);
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
  // If the list shrinks (filter change, removal) never strand the user
  // on a page that no longer exists.
  watch(totalPages, (tp) => {
    if (page.value > tp) page.value = tp;
  });
  const pageItems = computed(() =>
    (source.value || []).slice((page.value - 1) * pageSize, page.value * pageSize)
  );
  const from = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize + 1));
  const to = computed(() => Math.min(total.value, page.value * pageSize));
  function reset() {
    page.value = 1;
  }
  return { page, pageItems, total, totalPages, from, to, reset, pageSize };
}

// Shared status-filter predicate used by the list views: the filter is
// "" (all) | "ACTIVE" | "INACTIVE", where INACTIVE means "any status
// other than ACTIVE" (SUSPENDED / LEFT / INACTIVE in the data).
export function matchStatus(status, filter) {
  if (!filter) return true;
  if (filter === "ACTIVE") return status === "ACTIVE";
  return !!status && status !== "ACTIVE";
}
