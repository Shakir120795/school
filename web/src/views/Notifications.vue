<script setup>
import { onMounted, ref } from "vue";
import { api, session } from "../api.js";
import { fetchPushConfig, webPushState, enableWebPush, disableWebPush } from "../push.js";

// Browser Web Push opt-in (Phase 29 WS9). pushUi stays "hidden" unless
// the browser supports push AND the server has VAPID keys configured —
// and nothing ever prompts without the user tapping the button.
const pushUi = ref("hidden"); // hidden | off | on | denied
const pushBusy = ref(false);
const pushMsg = ref("");

async function refreshPushUi() {
  const cfg = await fetchPushConfig();
  if (!cfg.configured) {
    pushUi.value = "hidden";
    return;
  }
  pushUi.value = await webPushState();
}
async function turnOnPush() {
  pushBusy.value = true;
  pushMsg.value = "";
  const r = await enableWebPush();
  pushBusy.value = false;
  if (r.ok) {
    pushMsg.value = "Notifications on — school notices will also pop up on this device.";
    pushUi.value = "on";
  } else if (r.reason === "denied") {
    pushUi.value = "denied";
  } else {
    pushMsg.value = "Could not enable notifications on this browser. Please try again.";
  }
  await refreshPushUi();
}
async function turnOffPush() {
  pushBusy.value = true;
  await disableWebPush();
  pushBusy.value = false;
  pushMsg.value = "Notifications off for this device.";
  pushUi.value = "off";
}

const loading = ref(true);
const items = ref([]);
const unread = ref(0);
const msg = ref("");
const sid = session.schoolId;

async function load() {
  loading.value = true;
  try {
    const r = await api(`/schools/${sid}/my-notifications`);
    if (r.status === 200) {
      items.value = r.json.notifications;
      unread.value = r.json.unread;
    }
  } finally {
    loading.value = false;
  }
}
async function markRead(n) {
  if (n.read) return;
  const r = await api(`/schools/${sid}/my-notifications/${n.recipientId}/read`, { method: "POST", body: {} });
  if (r.status === 200) {
    n.read = true;
    n.status = "ACKNOWLEDGED";
    unread.value = Math.max(0, unread.value - 1);
  }
}
async function markAll() {
  for (const n of items.value) await markRead(n);
  msg.value = "All caught up.";
}
onMounted(() => {
  load();
  refreshPushUi();
});
</script>

<template>
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-bold">Notifications <span v-if="unread" class="text-sm bg-red-600 text-white rounded-full px-2 py-0.5 align-middle">{{ unread }} new</span></h1>
    <button v-if="unread" type="button" class="btn btn-ghost" @click="markAll">Mark all read</button>
  </div>
  <p v-if="msg" class="text-sm text-brand-700 mb-3">{{ msg }}</p>
  <div v-if="pushUi !== 'hidden'" class="card mb-3 flex flex-wrap items-center gap-2">
    <span class="text-sm font-medium">🔔 Device notifications</span>
    <span v-if="pushUi === 'on'" class="text-sm text-emerald-700">On for this device</span>
    <span v-else-if="pushUi === 'denied'" class="text-sm text-slate-500">Blocked in browser settings — allow notifications for this site to turn them on.</span>
    <span v-else class="text-sm text-slate-500">Get school notices as pop-ups on this device, even when the app is closed.</span>
    <span class="ml-auto flex gap-2">
      <button v-if="pushUi === 'off'" type="button" class="btn btn-primary !py-1.5 text-xs" :disabled="pushBusy" @click="turnOnPush">{{ pushBusy ? "Enabling…" : "Enable notifications" }}</button>
      <button v-if="pushUi === 'on'" type="button" class="btn btn-ghost !py-1.5 text-xs" :disabled="pushBusy" @click="turnOffPush">Turn off</button>
    </span>
    <p v-if="pushMsg" class="w-full text-sm text-brand-700">{{ pushMsg }}</p>
  </div>
  <div v-if="loading" class="card text-slate-500 text-sm animate-pulse">Loading notifications…</div>
  <div v-else-if="!items.length" class="card text-slate-500 text-sm">No notifications yet. School notices will appear here.</div>
  <div class="space-y-2">
    <button v-for="n in items" :key="n.recipientId" type="button" @click="markRead(n)"
      class="card w-full text-left block" :class="n.read ? 'opacity-70' : 'border-l-4 !border-l-brand-600'">
      <div class="flex items-center justify-between gap-2">
        <div class="font-semibold">{{ n.notice.title }}
          <span v-if="!n.read" class="ml-1 text-[10px] bg-brand-600 text-white rounded px-1.5 py-0.5 align-middle">NEW</span>
        </div>
        <div class="text-xs text-slate-400">{{ new Date(n.receivedAt).toLocaleString() }}</div>
      </div>
      <p class="text-sm text-slate-600 mt-1 whitespace-pre-line">{{ n.notice.body }}</p>
      <div class="text-[11px] text-slate-400 mt-1">{{ n.notice.type }} · {{ n.notice.priority }} · {{ n.read ? "Read" : "Tap to mark read" }}</div>
    </button>
  </div>
</template>
