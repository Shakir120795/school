<script setup>
import { onBeforeUnmount, onMounted, onUnmounted, ref } from "vue";
import { Html5Qrcode } from "html5-qrcode";
import { session, api } from "../api.js";

// Gate scanner: this browser acts as a scanning device. The device key is
// created once in Settings (admin) and stored only in this browser.
const schoolId = ref(session.schoolId || localStorage.getItem("ss_device_school") || "");
const deviceKey = ref(localStorage.getItem("ss_device_key") || "");
const configured = ref(!!(schoolId.value && deviceKey.value));
const eventType = ref("ENTRY");
const manualToken = ref("");
const result = ref(null);
const scanning = ref(false);
let scanner = null;

// On-campus live panel (Phase 11)
const campus = ref(null);
let campusTimer = null;
async function loadCampus() {
  if (!session.schoolId) return;
  const r = await api(`/schools/${session.schoolId}/attendance/on-campus`).catch(() => null);
  if (r?.status === 200) campus.value = r.json;
}
onMounted(() => { loadCampus(); campusTimer = setInterval(loadCampus, 30000); });
onUnmounted(() => { if (campusTimer) clearInterval(campusTimer); });

function saveDevice() {
  localStorage.setItem("ss_device_key", deviceKey.value);
  localStorage.setItem("ss_device_school", schoolId.value);
  configured.value = true;
}
function resetDevice() {
  localStorage.removeItem("ss_device_key");
  localStorage.removeItem("ss_device_school");
  configured.value = false;
  stop();
}

async function scanWithSchool(token) {
  const headers = {
    "content-type": "application/json",
    "x-school-id": schoolId.value,
    "x-device-key": deviceKey.value,
  };
  const res = await fetch(`${import.meta.env.VITE_API_BASE || ""}/attendance/scan`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      qrToken: token,
      eventType: eventType.value,
      idempotencyKey: `${deviceKey.value.slice(0, 6)}-${Date.now()}`,
    }),
  });
  const json = await res.json().catch(() => ({}));
  result.value = { status: res.status, ...json };
  if (json.outcome === "RECORDED") loadCampus();
}

async function start() {
  result.value = null;
  scanner = new Html5Qrcode("qr-reader");
  scanning.value = true;
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 8, qrbox: { width: 240, height: 240 } },
      async (decoded) => {
        await stop();
        await scanWithSchool(decoded.trim());
      },
      () => {}
    );
  } catch (e) {
    scanning.value = false;
    result.value = { outcome: "CAMERA_ERROR", reason: String(e?.message || e) };
  }
}
async function stop() {
  if (scanner && scanning.value) {
    try { await scanner.stop(); } catch { /* already stopped */ }
    scanner.clear();
  }
  scanning.value = false;
}
onBeforeUnmount(stop);

function outcomeClass() {
  if (!result.value) return "";
  if (result.value.outcome === "RECORDED") return "border-green-400 bg-green-50";
  if (result.value.outcome === "DUPLICATE") return "border-amber-400 bg-amber-50";
  return "border-red-400 bg-red-50";
}
</script>

<template>
  <div class="max-w-xl mx-auto">
    <h1 class="text-xl font-bold mb-3">Gate Scanner</h1>

    <form v-if="!configured" class="card grid gap-3" @submit.prevent="saveDevice">
      <p class="text-sm text-slate-500">Configure this device once. An admin creates the device key in Settings → Devices. The key stays in this browser only.</p>
      <div><label class="label">School ID</label><input v-model="schoolId" required class="input" placeholder="School id" /></div>
      <div><label class="label">Device key</label><input v-model="deviceKey" required class="input" placeholder="Device key (shown once at creation)" /></div>
      <button class="btn btn-primary">Save device</button>
    </form>

    <template v-else>
      <div class="flex gap-2 mb-3">
        <button class="btn flex-1" :class="eventType === 'ENTRY' ? 'btn-primary' : 'btn-ghost'" @click="eventType = 'ENTRY'">ENTRY</button>
        <button class="btn flex-1" :class="eventType === 'EXIT' ? 'btn-primary' : 'btn-ghost'" @click="eventType = 'EXIT'">EXIT</button>
      </div>

      <div class="card mb-3">
        <div id="qr-reader" class="rounded-xl overflow-hidden bg-black/5 min-h-[240px] flex items-center justify-center text-slate-400 text-sm">
          <span v-if="!scanning">Camera preview</span>
        </div>
        <div class="flex gap-2 mt-3">
          <button v-if="!scanning" class="btn btn-primary flex-1" @click="start">Start camera scan</button>
          <button v-else class="btn btn-danger flex-1" @click="stop">Stop camera</button>
        </div>
        <div class="flex gap-2 mt-3">
          <input v-model="manualToken" class="input" placeholder="Or paste the QR token manually" />
          <button class="btn btn-ghost" @click="scanWithSchool(manualToken.trim())">Submit</button>
        </div>
      </div>

      <div v-if="result" class="card border-2" :class="outcomeClass()">
        <div class="text-lg font-bold">{{ result.outcome }}</div>
        <div class="text-sm text-slate-600">
          <span v-if="result.kind">{{ result.kind }} · </span>
          <span v-if="result.reason">{{ result.reason }}</span>
          <span v-if="result.evaluation">Late: {{ result.evaluation.isLate ? "yes" : "no" }}</span>
          <span v-if="result.reviewFlag"> · Flag: {{ result.reviewFlag }}</span>
        </div>
        <button class="btn btn-primary mt-3" @click="result = null; start()">Scan next</button>
      </div>

      <div v-if="campus" class="card mt-4 !p-0 overflow-hidden text-left">
        <div class="p-4 pb-2 flex items-center justify-between">
          <h3 class="font-bold">🏫 On campus now</h3>
          <button type="button" class="text-xs font-semibold text-brand-700" @click="loadCampus">Refresh</button>
        </div>
        <div class="grid grid-cols-4 gap-2 px-4 pb-3 text-center">
          <div class="rounded-xl bg-emerald-50 py-2"><div class="font-extrabold text-emerald-700">{{ campus.totals.onCampus }}</div><div class="text-[10px] font-semibold text-slate-500">INSIDE</div></div>
          <div class="rounded-xl bg-slate-50 py-2"><div class="font-extrabold">{{ campus.totals.arrived }}</div><div class="text-[10px] font-semibold text-slate-500">ARRIVED</div></div>
          <div class="rounded-xl bg-sky-50 py-2"><div class="font-extrabold text-sky-700">{{ campus.totals.departed }}</div><div class="text-[10px] font-semibold text-slate-500">LEFT</div></div>
          <div class="rounded-xl bg-amber-50 py-2"><div class="font-extrabold text-amber-600">{{ campus.totals.notArrived }}</div><div class="text-[10px] font-semibold text-slate-500">NOT YET</div></div>
        </div>
        <div class="max-h-64 overflow-y-auto border-t border-slate-100">
          <div v-for="st in campus.students" :key="st.studentId" class="flex items-center gap-2 px-4 py-2 border-b border-slate-50 text-sm">
            <span class="w-2 h-2 rounded-full" :class="st.onCampus ? 'bg-emerald-500' : 'bg-slate-300'"></span>
            <span class="font-medium">{{ st.name }}</span>
            <span class="text-xs text-slate-400">Class {{ st.className }}</span>
            <span class="ml-auto text-xs text-slate-500">in {{ st.entryAt ? new Date(st.entryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' }}<span v-if="st.exitAt"> · out {{ new Date(st.exitAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span></span>
          </div>
          <div v-if="!campus.students.length" class="px-4 py-3 text-sm text-slate-400">No arrivals yet today.</div>
        </div>
      </div>

      <button class="btn btn-ghost mt-4" @click="resetDevice">Reconfigure device</button>
    </template>
  </div>
</template>
