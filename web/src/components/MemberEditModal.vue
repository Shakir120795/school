<script setup>
import { ref } from "vue";

// Shared member EDIT form (owner Console drill-in + school-side Team
// page): one proper in-app modal instead of the old chain of browser
// prompt()s that made it look like only the name was editable. Edits
// the login profile — Full name, Login email / ID, Phone. Role is
// deliberately NOT editable here; password stays on Reset password.
// The parent performs the PATCH and passes server errors back via
// the `error` prop (shown inline, form stays open, nothing saved).
const props = defineProps({
  title: { type: String, default: "Edit member" },
  subtitle: { type: String, default: "" },
  initial: { type: Object, required: true }, // { fullName, email, phone }
  error: { type: String, default: "" },
  saving: { type: Boolean, default: false },
});
const emit = defineEmits(["save", "close"]);
const form = ref({
  fullName: props.initial.fullName || "",
  email: props.initial.email || "",
  phone: props.initial.phone || "",
});
const localError = ref("");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function submit() {
  localError.value = "";
  const fullName = form.value.fullName.trim();
  const email = form.value.email.trim();
  if (!fullName) { localError.value = "Full name cannot be empty."; return; }
  if (!EMAIL_RE.test(email)) { localError.value = "Please enter a valid login email address."; return; }
  emit("save", { fullName, email, phone: form.value.phone.trim() });
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="emit('close')">
    <form class="card w-full max-w-md" @submit.prevent="submit">
      <h2 class="font-bold mb-1">{{ title }}</h2>
      <p v-if="subtitle" class="text-sm text-slate-500 mb-3">{{ subtitle }}</p>
      <div class="grid gap-3 mb-3">
        <div><label class="label">Full name</label><input v-model="form.fullName" class="input" required /></div>
        <div><label class="label">Login email / ID</label><input v-model="form.email" type="email" class="input" required /></div>
        <div><label class="label">Phone (optional)</label><input v-model="form.phone" class="input" placeholder="Leave blank for none" /></div>
      </div>
      <p class="text-[11px] text-slate-400 mb-3">Changing the login email signs this member out everywhere — they will log in with the new email. The password is not changed here (use Reset password for that).</p>
      <p v-if="localError || error" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ localError || error }}</p>
      <div class="flex gap-2">
        <button class="btn btn-primary flex-1" :disabled="saving">{{ saving ? "Saving…" : "Save changes" }}</button>
        <button type="button" class="btn btn-ghost flex-1" @click="emit('close')">Cancel</button>
      </div>
    </form>
  </div>
</template>
