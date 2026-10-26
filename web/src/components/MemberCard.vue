<script setup>
// One member as a big, mobile-friendly CARD (Phase 27) — shared by
// the owner Console drill-in and the school-side Team page, which
// previously rendered members as cramped single-line rows.
// Parents get one detail block per child (name + class + family
// details from the Phase 26/27 children[] payload); other roles
// show the details they actually have — no fake fields.
// Actions are emitted; the parent view owns the API calls, the
// edit modal and the remove-reason popup.
const props = defineProps({
  name: { type: String, required: true },
  role: { type: String, required: true },
  status: { type: String, default: "ACTIVE" },
  email: { type: String, default: "" },
  phone: { type: String, default: "" },
  // null = not a parent (no children section); [] = parent, none linked yet.
  children: { type: Array, default: null },
  toggleText: { type: String, default: "" },
});
defineEmits(["edit", "toggle-status", "reset", "remove"]);

const roleChip = (r) =>
  ({
    SCHOOL_ADMIN: "bg-violet-100 text-violet-700",
    PRINCIPAL: "bg-indigo-100 text-indigo-700",
    TEACHER: "bg-sky-100 text-sky-700",
    STAFF: "bg-slate-200 text-slate-600",
    PARENT: "bg-emerald-100 text-emerald-700",
  })[r] || "bg-slate-100 text-slate-600";
const genderText = (g) => ({ M: "Male", F: "Female", Male: "Male", Female: "Female", Other: "Other" })[g] || g || "—";
</script>

<template>
  <div class="rounded-3xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06),0_8px_24px_-12px_rgba(16,24,40,0.12)] p-4 mb-3">
    <div class="flex flex-wrap items-start gap-2">
      <div class="min-w-0">
        <div class="text-lg font-bold leading-snug">{{ name }}</div>
        <div class="text-sm text-slate-500 break-all">
          {{ email || "—" }}<span v-if="phone"> · {{ phone }}</span>
        </div>
      </div>
      <div class="ml-auto flex flex-wrap gap-1.5 shrink-0">
        <span class="chip" :class="roleChip(role)">{{ role.replace("_", " ") }}</span>
        <span class="chip" :class="status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'">{{ status }}</span>
      </div>
    </div>

    <div v-if="children !== null" class="mt-3">
      <div class="text-xs font-bold tracking-wide text-slate-400 mb-2">
        🎓 {{ children.length }} CHILD{{ children.length === 1 ? "" : "REN" }}
      </div>
      <p v-if="!children.length" class="text-sm text-slate-400">No children linked to this login yet.</p>
      <div v-for="(c, i) in children" :key="i" class="rounded-2xl bg-sky-50/70 border border-sky-100 p-3 mb-2 last:mb-0">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-base font-bold">{{ c.name }}</span>
          <span v-if="c.classLabel" class="chip bg-sky-100 text-sky-800">Class {{ c.classLabel }}</span>
        </div>
        <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mt-2 text-sm">
          <div>
            <dt class="text-[11px] font-semibold text-slate-400">GENDER</dt>
            <dd class="font-medium">{{ genderText(c.gender) }}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-semibold text-slate-400">FATHER</dt>
            <dd class="font-medium">{{ c.fatherName || "—" }}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-semibold text-slate-400">MOTHER</dt>
            <dd class="font-medium">{{ c.motherName || "—" }}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-semibold text-slate-400">MOBILE</dt>
            <dd class="font-medium">{{ c.guardianPhone || phone || "—" }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-[11px] font-semibold text-slate-400">ADDRESS</dt>
            <dd class="font-medium">{{ c.address || "—" }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
      <button type="button" class="btn btn-ghost !py-1.5 text-xs" @click="$emit('edit')">Edit</button>
      <button type="button" class="btn btn-ghost !py-1.5 text-xs" @click="$emit('toggle-status')">{{ toggleText || (status === "ACTIVE" ? "Deactivate" : "Activate") }}</button>
      <button type="button" class="btn btn-ghost !py-1.5 text-xs" @click="$emit('reset')">Reset password</button>
      <button type="button" class="btn btn-ghost !py-1.5 text-xs text-red-600" @click="$emit('remove')">Remove</button>
    </div>
  </div>
</template>
