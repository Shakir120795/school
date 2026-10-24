<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { login, myRole } from "../api.js";

const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = "";
  const r = await login(email.value.trim(), password.value);
  busy.value = false;
  if (r.status !== 200) {
    error.value = r.json.error === "INVALID_CREDENTIALS" ? "Wrong email or password." : `Login failed (${r.json.error || r.status})`;
    return;
  }
  router.push(myRole() === "PARENT" ? "/parent" : "/");
}
</script>

<template>
  <div class="min-h-dvh flex flex-col items-center justify-center p-4 bg-gradient-to-b from-[#0a2436] via-[#0b2e3f] to-[#07332a] safe-t safe-b">
    <div class="text-center text-white mb-6">
      <img src="/icons/icon-192.png" alt="Smart School" class="w-20 h-20 rounded-[22px] mx-auto shadow-2xl mb-3" />
      <div class="text-3xl font-extrabold tracking-tight">Smart School</div>
      <p class="text-sm text-white/60">Attendance & Communication</p>
    </div>
    <form class="card w-full max-w-sm !rounded-[28px] !p-6 shadow-2xl" @submit.prevent="submit">
      <div class="text-lg font-bold mb-4">Welcome back 👋</div>
      <label class="label">Email</label>
      <input v-model="email" type="email" required class="input mb-3" placeholder="you@school.example" />
      <label class="label">Password</label>
      <input v-model="password" type="password" required class="input mb-4" placeholder="••••••••" />
      <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
      <button class="btn btn-primary w-full" :disabled="busy">{{ busy ? "Signing in…" : "Sign in" }}</button>
    </form>
    <p class="text-[11px] text-white/40 mt-5">Install: browser menu → “Add to Home screen”</p>
  </div>
</template>
