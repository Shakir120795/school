<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, session, myRole } from "../api.js";

// Student 360 profile (Phase 29 WS5): one aggregate read —
// GET /schools/:id/students/:studentId/profile — renders the
// child's core + family + guardians + last-30 attendance + fees
// (+ targeted notices when the API returns them). WS1 loading
// pattern: "Loading student…" first; empty / not-available text
// only appears after the load settles. A 403/404 is a clear
// "not available" state, never a broken page. Family fields come
// back as family: null until the Phase 27 columns exist in the
// live DB — every family value then falls back to "—".
const route = useRoute();
const router = useRouter();
const sid = session.schoolId;
const studentId = route.params.studentId;

const loading = ref(true);
const notAvailable = ref(false);
const err = ref("");
const data = ref(null);

const student = computed(() => data.value?.student || null);
const family = computed(() => data.value?.family || null);
const guardians = computed(() => data.value?.guardians || []);
const primaryGuardian = computed(() => guardians.value.find((g) => g.isPrimary) || guardians.value[0] || null);
const attendance = computed(() => data.value?.attendance || { records: [], summary: null });
const fees = computed(() => data.value?.fees || { invoices: [], totals: { totalBilled: 0, totalPaid: 0, totalDue: 0 } });
const notices = computed(() => data.value?.notices || []);

const initials = (name) =>
  (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const genderText = (g) => ({ M: "Male", F: "Female", Male: "Male", Female: "Female", Other: "Other" })[g] || g || "—";
const dobText = (d) => (d ? String(d).slice(0, 10) : "—");
const dateText = (d) => (d ? String(d).slice(0, 10) : "—");
const inr = (paise) => "₹" + ((paise || 0) / 100).toLocaleString("en-IN");
const ATT_CLS = {
  PRESENT: "bg-emerald-100 text-emerald-700",
  LATE: "bg-amber-100 text-amber-700",
  ABSENT: "bg-rose-100 text-rose-700",
  ON_LEAVE: "bg-violet-100 text-violet-700",
  HALF_DAY: "bg-sky-100 text-sky-700",
};
const FEE_CLS = {
  UNPAID: "bg-rose-100 text-rose-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-emerald-100 text-emerald-700",
  WAIVED: "bg-slate-100 text-slate-500",
};

// Phase 29 WS6: manager actions — class transfer + admission-no
// correction (PATCH /schools/:id/students/:studentId, audited
// server-side). Managers only (SCHOOL_ADMIN / PRINCIPAL); the
// endpoint's WRITE guard 403s everyone else anyway. Hidden for
// TEACHER / STAFF.
const isManager = ["SCHOOL_ADMIN", "PRINCIPAL"].includes(myRole());
const classrooms = ref([]);
const classroomsLoading = ref(false);
const transferTo = ref("");
const transferring = ref(false);
const transferMsg = ref("");
const transferErr = ref("");
const admInput = ref("");
const admSaving = ref(false);
const admMsg = ref("");
const admErr = ref("");
const roomLabel = (c) => `${c.name}${c.section ? "-" + c.section : ""}`;

watch(student, (s) => {
  if (!s) return;
  transferTo.value = s.classroomId || "";
  admInput.value = s.admissionNo || "";
});

async function loadClassrooms() {
  classroomsLoading.value = true;
  try {
    const r = await api(`/schools/${sid}/classrooms`);
    if (r.status === 200) classrooms.value = r.json.classrooms || [];
  } catch {
    classrooms.value = [];
  } finally {
    classroomsLoading.value = false;
  }
}

async function doTransfer() {
  transferMsg.value = "";
  transferErr.value = "";
  transferring.value = true;
  try {
    const r = await api(`/schools/${sid}/students/${studentId}`, {
      method: "PATCH",
      body: { classroomId: transferTo.value || null },
    });
    if (r.status === 200) {
      transferMsg.value = "Class updated.";
      await load();
    } else {
      transferErr.value = r.json?.error || `Could not transfer (${r.status})`;
    }
  } catch {
    transferErr.value = "Could not transfer. Please try again.";
  } finally {
    transferring.value = false;
  }
}

async function doAdmission() {
  admMsg.value = "";
  admErr.value = "";
  admSaving.value = true;
  try {
    const r = await api(`/schools/${sid}/students/${studentId}`, {
      method: "PATCH",
      body: { admissionNo: admInput.value.trim() },
    });
    if (r.status === 200) {
      admMsg.value = "Admission number updated.";
      await load();
    } else {
      // 409 ADMISSION_NO_TAKEN lands here — shown inline verbatim.
      admErr.value = r.json?.error || `Could not save (${r.status})`;
    }
  } catch {
    admErr.value = "Could not save. Please try again.";
  } finally {
    admSaving.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const r = await api(`/schools/${sid}/students/${studentId}/profile`);
    if (r.status === 200) {
      data.value = r.json;
    } else if (r.status === 403 || r.status === 404) {
      notAvailable.value = true;
    } else {
      err.value = r.json?.error || `Could not load this student (${r.status})`;
    }
  } catch {
    err.value = "Could not load this student. Please try again.";
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  load();
  if (isManager) loadClassrooms();
});
</script>

<template>
  <div>
    <button type="button" class="text-sm text-brand-700 font-semibold mb-3" @click="router.back()">← Back</button>

    <div v-if="loading" class="card text-slate-500">Loading student…</div>

    <div v-else-if="notAvailable" class="card text-center py-10">
      <div class="text-4xl mb-2">🔒</div>
      <h1 class="text-xl font-bold mb-1">Student not available</h1>
      <p class="text-sm text-slate-500">This student profile is not available for your account, or the student does not exist in this school.</p>
    </div>

    <p v-else-if="err" class="card text-sm text-red-700 !bg-red-50 !border-red-200">{{ err }}</p>

    <template v-else-if="student">
      <!-- Header card -->
      <div class="card !p-5 mb-4">
        <div class="flex items-start gap-4">
          <img v-if="student.photoUrl" :src="student.photoUrl" alt="" class="w-16 h-16 rounded-full object-cover shrink-0" />
          <span v-else class="w-16 h-16 rounded-full bg-brand-50 flex items-center justify-center font-extrabold text-brand-700 text-2xl shrink-0">{{ initials(student.fullName) }}</span>
          <div class="min-w-0">
            <h1 class="text-2xl font-extrabold leading-tight">{{ student.fullName }}</h1>
            <div class="flex flex-wrap gap-1.5 mt-2">
              <span class="chip bg-brand-50 text-brand-700">Class {{ student.classLabel || "—" }}</span>
              <span class="chip bg-slate-100 text-slate-600">Adm {{ student.admissionNo || "—" }}</span>
              <span v-if="student.rollNo" class="chip bg-slate-100 text-slate-600">Roll {{ student.rollNo }}</span>
              <span class="chip" :class="student.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ student.status }}</span>
              <span v-if="student.academicYear?.name" class="chip bg-slate-100 text-slate-600">{{ student.academicYear.name }}</span>
            </div>
            <p class="text-sm text-slate-500 mt-2">{{ genderText(student.gender) }} · DOB {{ dobText(student.dateOfBirth) }}</p>
          </div>
        </div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 mt-4 pt-4 border-t border-slate-100 text-sm">
          <div>
            <dt class="text-[11px] font-semibold text-slate-400">FATHER</dt>
            <dd class="font-medium">{{ family?.fatherName || "—" }}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-semibold text-slate-400">MOTHER</dt>
            <dd class="font-medium">{{ family?.motherName || "—" }}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-semibold text-slate-400">MOBILE (PRIMARY GUARDIAN)</dt>
            <dd class="font-medium">{{ primaryGuardian?.phone || "—" }}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-semibold text-slate-400">ADDRESS</dt>
            <dd class="font-medium">{{ family?.address || "—" }}</dd>
          </div>
        </dl>
      </div>

      <!-- Manager actions (WS6): class transfer + admission correction -->
      <div v-if="isManager" class="grid lg:grid-cols-2 gap-4 mb-4 items-start">
        <div class="card">
          <h2 class="font-bold mb-2">🔀 Transfer class</h2>
          <p class="text-sm text-slate-500 mb-3">Move {{ student.fullName }} to another class. Attendance and fees history stay with the student.</p>
          <div class="flex gap-2">
            <select v-model="transferTo" class="input flex-1" :disabled="transferring || classroomsLoading">
              <option value="">— No class —</option>
              <option v-for="c in classrooms" :key="c.id" :value="c.id">{{ roomLabel(c) }}{{ c.id === student.classroomId ? " (current)" : "" }}</option>
            </select>
            <button type="button" class="btn btn-primary" :disabled="transferring || classroomsLoading || transferTo === (student.classroomId || '')" @click="doTransfer">{{ transferring ? "Transferring…" : "Transfer" }}</button>
          </div>
          <p v-if="classroomsLoading" class="text-sm text-slate-400 mt-2">Loading classes…</p>
          <p v-if="transferErr" class="text-sm text-red-700 mt-2">{{ transferErr }}</p>
          <p v-else-if="transferMsg" class="text-sm text-emerald-700 mt-2">{{ transferMsg }}</p>
        </div>

        <div class="card">
          <h2 class="font-bold mb-2">✏️ Correct admission no</h2>
          <p class="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">⚠️ Parent login IDs made from the admission number will NOT change automatically.</p>
          <div class="flex gap-2">
            <input v-model="admInput" class="input flex-1" :disabled="admSaving" />
            <button type="button" class="btn btn-primary" :disabled="admSaving || !admInput.trim() || admInput.trim() === student.admissionNo" @click="doAdmission">{{ admSaving ? "Saving…" : "Save" }}</button>
          </div>
          <p v-if="admErr" class="text-sm text-red-700 mt-2">{{ admErr }}</p>
          <p v-else-if="admMsg" class="text-sm text-emerald-700 mt-2">{{ admMsg }}</p>
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-4 items-start">
        <!-- Guardians -->
        <div class="card">
          <h2 class="font-bold mb-3">👨‍👩‍👧 Guardians</h2>
          <div v-if="guardians.length" class="space-y-3">
            <div v-for="g in guardians" :key="g.id" class="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
              <span class="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center font-bold text-brand-700 shrink-0">{{ initials(g.name) }}</span>
              <div class="min-w-0 text-sm">
                <div class="font-semibold">{{ g.name }} <span v-if="g.isPrimary" class="chip bg-brand-50 text-brand-700 ml-1">Primary</span></div>
                <div class="text-slate-500">{{ g.relationship || "—" }}<span v-if="g.phone"> · {{ g.phone }}</span></div>
                <div v-if="g.email" class="text-slate-400 text-xs">{{ g.email }}</div>
              </div>
            </div>
          </div>
          <p v-else class="text-sm text-slate-400">No guardians linked yet.</p>
        </div>

        <!-- Attendance -->
        <div class="card">
          <h2 class="font-bold mb-3">✓ Attendance — last 30 records</h2>
          <template v-if="attendance.summary && attendance.summary.total">
            <div class="flex items-center gap-4 mb-3">
              <div class="text-3xl font-extrabold text-emerald-600">{{ attendance.summary.pctPresent }}%</div>
              <div class="text-sm text-slate-500">
                present (incl. late) of {{ attendance.summary.total }} marked day{{ attendance.summary.total === 1 ? "" : "s" }}<br />
                <span class="text-emerald-600 font-semibold">{{ attendance.summary.present }} present</span> ·
                <span class="text-amber-600 font-semibold">{{ attendance.summary.late }} late</span> ·
                <span class="text-rose-600 font-semibold">{{ attendance.summary.absent }} absent</span> ·
                <span class="text-violet-600 font-semibold">{{ attendance.summary.onLeave }} leave</span>
              </div>
            </div>
            <div class="max-h-64 overflow-y-auto">
              <div v-for="r in attendance.records" :key="r.id" class="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0 text-sm">
                <span class="font-medium">{{ dateText(r.date) }}</span>
                <span class="chip" :class="ATT_CLS[r.status] || 'bg-slate-100 text-slate-500'">{{ r.status.replace("_", " ") }}</span>
              </div>
            </div>
          </template>
          <p v-else class="text-sm text-slate-400">No attendance recorded yet.</p>
        </div>

        <!-- Fees -->
        <div class="card lg:col-span-2">
          <h2 class="font-bold mb-3">💳 Fees</h2>
          <div class="grid grid-cols-3 gap-3 mb-3 text-center">
            <div class="rounded-2xl bg-slate-50 py-3"><div class="text-lg font-extrabold">{{ inr(fees.totals.totalBilled) }}</div><div class="text-[11px] text-slate-500 font-medium">TOTAL BILLED</div></div>
            <div class="rounded-2xl bg-emerald-50 py-3"><div class="text-lg font-extrabold text-emerald-700">{{ inr(fees.totals.totalPaid) }}</div><div class="text-[11px] text-slate-500 font-medium">TOTAL PAID</div></div>
            <div class="rounded-2xl bg-rose-50 py-3"><div class="text-lg font-extrabold text-rose-600">{{ inr(fees.totals.totalDue) }}</div><div class="text-[11px] text-slate-500 font-medium">TOTAL DUE</div></div>
          </div>
          <div v-if="fees.invoices.length">
            <div v-for="inv in fees.invoices" :key="inv.id" class="flex flex-wrap items-center gap-2 py-2.5 border-b border-slate-100 last:border-0 text-sm">
              <span class="font-semibold">{{ inv.title || inv.periodLabel }}</span>
              <span class="text-slate-400 text-xs">Due {{ dateText(inv.dueDate) }}</span>
              <span class="chip ml-auto" :class="FEE_CLS[inv.status] || 'bg-slate-100 text-slate-500'">{{ inv.status }}</span>
              <span class="text-slate-500">{{ inr(inv.totalPaise) }} · Paid {{ inr(inv.paidPaise) }} · Due {{ inr(inv.balancePaise) }}</span>
            </div>
          </div>
          <p v-else class="text-sm text-slate-400">No fee invoices for this student yet.</p>
        </div>

        <!-- Notices (targeted) -->
        <div v-if="notices.length" class="card lg:col-span-2">
          <h2 class="font-bold mb-3">✉️ Recent notices for this student / class</h2>
          <div v-for="n in notices" :key="n.id" class="py-2 border-b border-slate-100 last:border-0 text-sm">
            <span class="font-semibold">{{ n.title }}</span>
            <span class="text-slate-400 text-xs ml-2">{{ dateText(n.sentAt || n.createdAt) }}</span>
            <p class="text-slate-500 mt-0.5">{{ n.body }}</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
