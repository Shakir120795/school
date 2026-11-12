<script setup>
// Phase 64: owner ke "View as" ki nayi-tab wali chaabi ghumane
// wali jagah. OwnerSchool ek ek-baar-ki chaabi (localStorage,
// 2 minute ki umar) ke saath ye page naye tab me kholta hai;
// ye page chaabi padhkar session establish karta hai aur
// chaabi turant mita deta hai — URL me token kabhi nahi jata.
import { onMounted, ref } from "vue";
import { session } from "../api.js";

const state = ref("working"); // working | error
const note = ref("");

onMounted(() => {
  try {
    const k = new URLSearchParams(location.search).get("k") || "";
    const raw = k ? localStorage.getItem(`ss_viewas_${k}`) : null;
    if (k) localStorage.removeItem(`ss_viewas_${k}`);
    if (!raw) throw new Error("missing");
    const { payload, ts } = JSON.parse(raw);
    if (!payload?.accessToken || !payload?.user?.id || Date.now() - ts > 120000) throw new Error("expired");
    session.establish(payload);
    if (payload.viewAs?.schoolId) session.setSchool(payload.viewAs.schoolId);
    const role = payload.viewAs?.role;
    location.replace(role === "PARENT" ? "/parent" : "/");
  } catch {
    state.value = "error";
    note.value = "This view-as link has expired or was already used. Go back to the owner panel and tap “View as” again.";
  }
});
</script>

<template>
  <div class="min-h-screen grid place-items-center bg-[#0a2436] text-white px-4">
    <div class="text-center max-w-sm">
      <div class="text-4xl mb-3">👁️</div>
      <p v-if="state === 'working'" class="font-bold">Opening the account…</p>
      <template v-else>
        <p class="font-bold mb-2">Link expired</p>
        <p class="text-sm text-white/70">{{ note }}</p>
      </template>
    </div>
  </div>
</template>
