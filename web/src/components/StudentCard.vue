<script setup>
// One student as a big, mobile-friendly detail CARD (Phase 27) —
// shared by the school-side People → Students tab and the teacher
// "My Students" view, so a child's full detail (name, class,
// admission/roll, gender, DOB, father, mother, mobile, address)
// reads the same in every login. The Mobile comes from the primary
// guardian attached to the students payload (guardian phone is the
// mobile source); missing values show "—", never invented data.
// Extra per-view buttons (Issue QR card, Edit…) go in #actions.
defineProps({
  student: { type: Object, required: true },
  classLabel: { type: String, default: "—" },
});
const genderText = (g) => ({ M: "Male", F: "Female", Male: "Male", Female: "Female", Other: "Other" })[g] || g || "—";
const initials = (name) =>
  (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
const dobText = (d) => (d ? String(d).slice(0, 10) : "—");
</script>

<template>
  <div class="card !p-4">
    <div class="flex items-start gap-3">
      <img v-if="student.photoUrl" :src="student.photoUrl" alt="" class="w-12 h-12 rounded-full object-cover shrink-0" />
      <span v-else class="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center font-extrabold text-brand-700 text-lg shrink-0">{{ initials(student.fullName) }}</span>
      <div class="min-w-0">
        <div class="text-lg font-bold leading-snug">{{ student.fullName }}</div>
        <div class="flex flex-wrap gap-1.5 mt-1">
          <span class="chip bg-brand-50 text-brand-700">Class {{ classLabel }}</span>
          <span class="chip" :class="student.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ student.status }}</span>
        </div>
      </div>
    </div>
    <dl class="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
      <div>
        <dt class="text-[11px] font-semibold text-slate-400">ADMISSION NO</dt>
        <dd class="font-medium">{{ student.admissionNo || "—" }}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-400">ROLL NO</dt>
        <dd class="font-medium">{{ student.rollNo || "—" }}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-400">GENDER</dt>
        <dd class="font-medium">{{ genderText(student.gender) }}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-400">DATE OF BIRTH</dt>
        <dd class="font-medium">{{ dobText(student.dateOfBirth) }}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-400">FATHER</dt>
        <dd class="font-medium">{{ student.fatherName || "—" }}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-400">MOTHER</dt>
        <dd class="font-medium">{{ student.motherName || "—" }}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-400">MOBILE (GUARDIAN)</dt>
        <dd class="font-medium">{{ student.guardian?.phone || "—" }}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-400">GUARDIAN</dt>
        <dd class="font-medium">{{ student.guardian?.name || "—" }}</dd>
      </div>
      <div class="col-span-2">
        <dt class="text-[11px] font-semibold text-slate-400">ADDRESS</dt>
        <dd class="font-medium">{{ student.address || "—" }}</dd>
      </div>
    </dl>
    <div v-if="$slots.actions" class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
      <slot name="actions" />
    </div>
  </div>
</template>
