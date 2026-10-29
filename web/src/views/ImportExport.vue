<script setup>
import { ref } from "vue";
import { api, session } from "../api.js";

// Bulk import + exports (Phase 19). Managers only.
const sid = session.schoolId;
const msg = ref("");
const err = ref("");
const fileName = ref("");
const rowCount = ref(0);
const csvText = ref("");
const result = ref(null);
const busy = ref(false);
const attMonth = ref(new Date().toISOString().slice(0, 7));

const TEMPLATE = "fullName,admissionNo,className,section,rollNo,gender,dob,guardianName,guardianPhone,guardianRelation\nRiya Sharma,ADM101,5,A,12,F,2015-04-11,Neha Sharma,9811100011,mother\nArjun Mehta,ADM102,5,A,3,M,2015-09-02,Raj Mehta,9811100022,father\n";

function download(name, text, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadTemplate() { download("students-import-template.csv", TEMPLATE); }

async function onFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  fileName.value = f.name;
  csvText.value = await f.text();
  const lines = csvText.value.split(/\r?\n/).filter((l) => l.trim());
  rowCount.value = Math.max(0, lines.length - 1);
  result.value = null;
}
async function runImport() {
  err.value = ""; msg.value = ""; busy.value = true;
  const r = await api(`/schools/${sid}/import/students`, { method: "POST", body: { csv: csvText.value } });
  busy.value = false;
  if (r.status === 201) {
    result.value = r.json.import;
    msg.value = `Import done: ${r.json.import.created} student(s) added out of ${r.json.totalRows} rows.`;
  } else err.value = r.json?.error || "Import failed";
}
async function downloadExport(path, name) {
  err.value = "";
  const token = session.accessToken;
  const res = await fetch(path, { headers: { authorization: `Bearer ${token}`, "x-school-id": sid } });
  if (!res.ok) { err.value = "Export failed"; return; }
  download(name, await res.text());
}
function exportAttendance() {
  const [y, m] = attMonth.value.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  downloadExport(`/schools/${sid}/exports/attendance.csv?from=${attMonth.value}-01&to=${last}`, `attendance-${attMonth.value}.csv`);
}
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">📥 Import & Export</h1>
    <p class="text-sm text-slate-500 mb-4">Add the whole school's students from one Excel/CSV file, and download reports as CSV.</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <section class="card mb-4">
      <h2 class="font-bold mb-1">Import students (CSV)</h2>
      <p class="text-sm text-slate-500 mb-3">
        Columns: <b>fullName, admissionNo</b> (required), className, section, rollNo, gender, dob (YYYY-MM-DD),
        guardianName, guardianPhone, guardianRelation. A class that doesn't exist yet is created automatically.
        Parents get app access automatically when they log in with the guardian mobile number.
      </p>
      <div class="flex flex-wrap gap-2 mb-3">
        <button class="btn btn-ghost" @click="downloadTemplate">⬇ Download template CSV</button>
        <label class="btn btn-ghost cursor-pointer">
          Choose CSV file
          <input type="file" accept=".csv,text/csv" class="hidden" @change="onFile" />
        </label>
        <span v-if="fileName" class="text-sm text-slate-500 self-center">{{ fileName }} — {{ rowCount }} data rows</span>
      </div>
      <button class="btn btn-primary" :disabled="!csvText || busy" @click="runImport">{{ busy ? "Importing…" : "Import students" }}</button>

      <div v-if="result" class="mt-4 text-sm">
        <div class="flex flex-wrap gap-2 mb-2">
          <span class="chip bg-emerald-100 text-emerald-700">Added: {{ result.created }}</span>
          <span class="chip bg-sky-100 text-sky-700">Guardians linked: {{ result.guardiansLinked }}</span>
          <span v-if="result.createdClasses.length" class="chip bg-violet-100 text-violet-700">New classes: {{ result.createdClasses.join(", ") }}</span>
          <span v-if="result.errors.length" class="chip bg-rose-100 text-rose-700">Skipped rows: {{ result.errors.length }}</span>
        </div>
        <div v-if="result.errors.length" class="grid gap-1">
          <div v-for="(e, i) in result.errors" :key="i" class="text-xs bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
            Row {{ e.row }}<span v-if="e.admissionNo"> ({{ e.admissionNo }})</span> — {{ e.error }}
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="font-bold mb-3">Download reports (CSV)</h2>
      <div class="grid gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium w-40">Students master list</span>
          <button class="btn btn-ghost" @click="downloadExport(`/schools/${sid}/exports/students.csv`, 'students.csv')">⬇ Students CSV</button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium w-40">Fees ledger</span>
          <button class="btn btn-ghost" @click="downloadExport(`/schools/${sid}/exports/fees.csv`, 'fees.csv')">⬇ Fees CSV</button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium w-40">Attendance (month)</span>
          <input v-model="attMonth" type="month" class="input !w-auto" />
          <button class="btn btn-ghost" @click="exportAttendance">⬇ Attendance CSV</button>
        </div>
      </div>
      <p class="text-xs text-slate-400 mt-3">CSV files open directly in Excel / Google Sheets.</p>
    </section>
  </div>
</template>
