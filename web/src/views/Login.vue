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
  <div class="min-h-screen flex items-center justify-center p-4 bg-ink-900">
    <form class="card w-full max-w-sm" @submit.prevent="submit">
      <div class="text-2xl font-bold">Smart School</div>
      <p class="text-sm text-slate-500 mb-5">Attendance & Communication — sign in</p>
      <label class="label">Email</label>
      <input v-model="email" type="email" required class="input mb-3" placeholder="you@school.example" />
      <label class="label">Password</label>
      <input v-model="password" type="password" required class="input mb-4" placeholder="••••••••" />
      <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
      <button class="btn btn-primary w-full" :disabled="busy">{{ busy ? "Signing in…" : "Sign in" }}</button>
      <p class="text-xs text-slate-400 mt-4">Use the demo accounts from <code>scripts/seed-demo.mjs</code> for local testing.</p>
    </form>
  </div>
</template>
