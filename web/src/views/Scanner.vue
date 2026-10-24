<script setup>
import { onBeforeUnmount, ref } from "vue";
import { Html5Qrcode } from "html5-qrcode";
import { session } from "../api.js";

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

      <button class="btn btn-ghost mt-4" @click="resetDevice">Reconfigure device</button>
    </template>
  </div>
</template>
