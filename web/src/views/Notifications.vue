<script setup>
import { onMounted, ref } from "vue";
import { api, session } from "../api.js";

const items = ref([]);
const unread = ref(0);
const msg = ref("");
const sid = session.schoolId;

async function load() {
  const r = await api(`/schools/${sid}/my-notifications`);
  if (r.status === 200) {
    items.value = r.json.notifications;
    unread.value = r.json.unread;
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
onMounted(load);
</script>

<template>
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-xl font-bold">Notifications <span v-if="unread" class="text-sm bg-red-600 text-white rounded-full px-2 py-0.5 align-middle">{{ unread }} new</span></h1>
    <button v-if="unread" type="button" class="btn btn-ghost" @click="markAll">Mark all read</button>
  </div>
  <p v-if="msg" class="text-sm text-brand-700 mb-3">{{ msg }}</p>
  <div v-if="!items.length" class="card text-slate-500 text-sm">No notifications yet. School notices will appear here.</div>
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
