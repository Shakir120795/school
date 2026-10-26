<script setup>
// Shared pager bar: "Showing X–Y of Z" + Prev/Next + page indicator.
// Used by every scale-ready list so pagination looks/behaves the same.
defineProps({
  page: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  from: { type: Number, required: true },
  to: { type: Number, required: true },
  total: { type: Number, required: true },
});
const emit = defineEmits(["update:page"]);
</script>

<template>
  <div v-if="total > 0" class="flex flex-wrap items-center gap-2 mt-3 text-sm">
    <span class="text-slate-500">Showing {{ from }}–{{ to }} of {{ total }}</span>
    <span class="ml-auto flex items-center gap-2">
      <button type="button" class="btn btn-ghost !py-1.5 !px-3 text-xs" :disabled="page <= 1" @click="emit('update:page', page - 1)">← Prev</button>
      <span class="text-xs text-slate-500">Page {{ page }} of {{ totalPages }}</span>
      <button type="button" class="btn btn-ghost !py-1.5 !px-3 text-xs" :disabled="page >= totalPages" @click="emit('update:page', page + 1)">Next →</button>
    </span>
  </div>
</template>
