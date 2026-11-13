<script setup>
// Hisab / Payments (Phase 67) — owner ka paisa wala tab: har
// school ka hisab ek jagah (students × rate = charge, kitna
// mila, kitna baaki), payment yahi se jodo, galat entry hatao,
// rate bhi yahi se badlo. Ab tak ye sab Console ke andar har
// school ko khol-khol kar karna padta tha.
import { computed, onMounted, ref } from "vue";
import { api } from "../api.js";

const rows = ref([]);
const loading = ref(true);
const error = ref("");
const msg = ref("");
const payForm = ref({});   // schoolId -> { rupees, note }
const rateForm = ref({});  // schoolId -> rupees string
const alertForm = ref({}); // schoolId -> note (Phase 68)
const alertBusy = ref("");
const busyId = ref("");

const totals = computed(() => ({
  charge: rows.value.reduce((a, r) => a + (r.hisab?.totalChargePaise || 0), 0),
  received: rows.value.reduce((a, r) => a + (r.hisab?.receivedPaise || 0), 0),
  due: rows.value.reduce((a, r) => a + (r.hisab?.balancePaise || 0), 0),
}));
const rs = (p) => "₹" + Math.round((p || 0) / 100).toLocaleString("en-IN");
const fmtDate = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

async function load() {
  loading.value = true; error.value = "";
  try {
    const r = await api("/platform/schools", { school: false });
    if (!r.ok) throw new Error("schools");
    const schools = r.json.schools || [];
    const out = [];
    for (const s of schools) {
      // Phase 68: ek school ka hisab atak jaye to POORA page nahi
      // rukna chahiye — usi school ke card par note dikhega.
      let hisab = null; let failed = false;
      try {
        const h = await api(`/platform/schools/${s.id}/hisab`, { school: false });
        if (h.ok) hisab = h.json; else failed = true;
      } catch { failed = true; }
      out.push({ ...s, hisab, failed });
      payForm.value[s.id] = { rupees: "", note: "" };
      alertForm.value[s.id] = "";
      rateForm.value[s.id] = hisab?.perStudentRatePaise != null ? String(Math.round(hisab.perStudentRatePaise / 100)) : "";
    }
    rows.value = out;
  } catch (e) { error.value = "Hisab load nahi hua — dobara try karo."; }
  loading.value = false;
}
async function addPayment(s) {
  const f = payForm.value[s.id];
  const rupees = Number(f?.rupees);
  if (!Number.isFinite(rupees) || rupees <= 0) { error.value = "Sahi rakam (₹) likho."; return; }
  busyId.value = s.id; error.value = ""; msg.value = "";
  try {
    const r = await api(`/platform/schools/${s.id}/payments`, {
      method: "POST", school: false, body: { amountRupees: rupees, note: f.note || undefined },
    });
    if (!r.ok) throw new Error(r.json.error || "failed");
    msg.value = `${s.name}: ${rs(rupees * 100)} jama ho gaya.`;
    await load();
  } catch (e) { error.value = "Payment save nahi hua."; }
  busyId.value = "";
}
async function deletePayment(s, p) {
  if (!confirm(`${s.name} ki ${rs(p.amountPaise)} wali payment entry delete kar dun?`)) return;
  const r = await api(`/platform/payments/${p.id}`, { method: "DELETE", school: false });
  if (r.ok) { msg.value = "Payment entry delete ho gayi."; await load(); }
  else error.value = "Delete nahi hua.";
}
// Phase 68: school ko payment alert — uske admin/staff ke
// inbox (bell) me jayega, hisab server apne aap jodta hai.
async function sendAlert(s) {
  const dueTxt = s.hisab ? rs(s.hisab.balancePaise) : "";
  if (!confirm(`${s.name} ko payment alert bhejun? (Baaki: ${dueTxt}) — school ke admin/staff ko bell me dikhega.`)) return;
  alertBusy.value = s.id; error.value = ""; msg.value = "";
  try {
    const r = await api(`/platform/schools/${s.id}/payment-alert`, {
      method: "POST", school: false, body: { note: alertForm.value[s.id] || undefined },
    });
    if (!r.ok) {
      error.value = r.json?.error === "HISAB_NOT_SETUP"
        ? "Is school ka hisab setup nahi hai — pehle Console se Apply database updates chalao."
        : r.json?.error === "NO_STAFF_TO_ALERT"
          ? "Is school me koi admin/staff hi nahi hai — alert kise bhejun?"
          : "Alert nahi gaya — dobara try karo.";
      return;
    }
    msg.value = `${s.name}: payment alert bhej diya — ${r.json.sentTo} logo ko mila.`;
    alertForm.value[s.id] = "";
  } finally { alertBusy.value = ""; }
}
async function saveRate(s) {
  const rupees = Number(rateForm.value[s.id]);
  if (!Number.isFinite(rupees) || rupees < 0) { error.value = "Rate sahi likho (₹)."; return; }
  busyId.value = "rate-" + s.id;
  const r = await api(`/platform/schools/${s.id}/rate`, { method: "PATCH", school: false, body: { rateRupees: rupees } });
  if (r.ok) { msg.value = `${s.name} ka rate ${rs(rupees * 100)}/student ho gaya.`; await load(); }
  else error.value = r.json?.error === "DB_UPDATE_PENDING" ? "Rate wala column abhi live nahi — Console se Apply database updates chalao." : "Rate save nahi hua.";
  busyId.value = "";
}
onMounted(load);
</script>

<template>
  <section>
    <h1 class="text-xl font-extrabold">💰 Hisab — Payments</h1>
    <p class="text-sm text-slate-500 mt-0.5">Har school ka kul hisab ek jagah — kitna banta hai, kitna mila, kitna baaki.</p>

    <div v-if="error" class="card bg-rose-50 text-rose-600 text-sm font-semibold mt-3 flex items-center gap-2">
      <span>{{ error }}</span>
      <button type="button" class="btn btn-ghost !w-auto !py-1.5 !px-3 text-xs ml-auto" @click="load">🔄 Dobara try karo</button>
    </div>
    <div v-if="msg" class="card bg-emerald-50 text-emerald-700 text-sm font-semibold mt-3">{{ msg }}</div>
    <div v-if="loading" class="card text-slate-500 text-sm mt-3 animate-pulse">Loading hisab…</div>

    <template v-else>
      <div class="grid grid-cols-3 gap-3 mt-4">
        <div class="card !mb-0 text-center"><div class="text-xl sm:text-2xl font-extrabold">{{ rs(totals.charge) }}</div><div class="text-xs text-slate-500 font-semibold">Kul charge</div></div>
        <div class="card !mb-0 text-center"><div class="text-xl sm:text-2xl font-extrabold text-emerald-600">{{ rs(totals.received) }}</div><div class="text-xs text-slate-500 font-semibold">Mil gaya</div></div>
        <div class="card !mb-0 text-center"><div class="text-xl sm:text-2xl font-extrabold text-rose-600">{{ rs(totals.due) }}</div><div class="text-xs text-slate-500 font-semibold">Baaki</div></div>
      </div>

      <div v-for="s in rows" :key="s.id" class="card mt-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-extrabold text-[16px]">{{ s.name }}</span>
          <span class="chip bg-slate-100 text-slate-500">{{ s.slug }}</span>
          <span class="ml-auto flex flex-wrap gap-1.5">
            <span class="chip bg-slate-100 text-slate-600 font-bold">{{ s.hisab ? s.hisab.students : "—" }} students</span>
            <span class="chip bg-emerald-100 text-emerald-700 font-bold">Mila: {{ s.hisab ? rs(s.hisab.receivedPaise) : "—" }}</span>
            <span class="chip font-bold" :class="s.hisab && s.hisab.balancePaise > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'">Baaki: {{ s.hisab ? rs(s.hisab.balancePaise) : "—" }}</span>
          </span>
        </div>

        <div v-if="s.failed" class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-3">
          ⚠️ Is school ka hisab abhi load nahi hua — upar wala 🔄 button dabakar dobara try karo.
        </div>
        <div v-if="s.hisab?.setupRequired" class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-3">
          ⚠️ Is school ka hisab abhi setup nahi — Console se <b>Apply database updates</b> chalao.
        </div>
        <template v-else-if="s.hisab">
          <div class="flex flex-wrap items-end gap-2 mt-3">
            <div>
              <label class="label">Rate ₹ / student</label>
              <input v-model="rateForm[s.id]" class="input !w-28" type="number" min="0" />
            </div>
            <button class="btn btn-ghost !w-auto !py-2 text-sm" :disabled="busyId === 'rate-' + s.id" @click="saveRate(s)">Rate save</button>
            <div class="flex-1 min-w-[140px]">
              <label class="label">Payment mila ₹</label>
              <input v-model="payForm[s.id].rupees" class="input" type="number" min="1" placeholder="e.g. 5000" />
            </div>
            <div class="flex-1 min-w-[140px]">
              <label class="label">Note (optional)</label>
              <input v-model="payForm[s.id].note" class="input" type="text" placeholder="UPI / cash / bank…" />
            </div>
            <button class="btn btn-primary !w-auto !py-2 text-sm" :disabled="busyId === s.id" @click="addPayment(s)">+ Payment jodo</button>
          </div>

          <div v-if="s.hisab.payments?.length" class="mt-3">
            <div v-for="p in s.hisab.payments.slice(0, 8)" :key="p.id" class="flex items-center gap-2 py-1.5 border-b border-slate-50 last:border-0 text-sm">
              <span class="font-bold text-emerald-700">{{ rs(p.amountPaise) }}</span>
              <span class="text-slate-500">{{ p.note || "—" }}</span>
              <span class="text-xs text-slate-400 ml-auto">{{ fmtDate(p.receivedAt) }}</span>
              <button type="button" class="text-rose-500 text-xs font-bold" @click="deletePayment(s, p)">Delete</button>
            </div>
            <p v-if="s.hisab.payments.length > 8" class="text-xs text-slate-400 mt-1">…aur {{ s.hisab.payments.length - 8 }} purani entries (Console me poori list).</p>
          </div>
          <p v-else class="text-sm text-slate-400 mt-3">Abhi tak koi payment nahi mila.</p>

          <div class="border-t border-slate-100 mt-4 pt-3">
            <div class="font-semibold text-sm mb-2">🔔 School ko payment alert bhejo</div>
            <div class="flex flex-wrap gap-2">
              <input v-model="alertForm[s.id]" class="input flex-1 min-w-[200px]" type="text" placeholder="Apna note (optional) — jaise: is hafte bhej dein" />
              <button class="btn btn-primary !w-auto !py-2 text-sm" :disabled="alertBusy === s.id" @click="sendAlert(s)">{{ alertBusy === s.id ? "Bhej raha hai…" : "🔔 Alert bhejo" }}</button>
            </div>
            <p class="text-xs text-slate-400 mt-1.5">Alert school ke admin/staff ke bell 🔔 me jayega — kul charge, mila aur baaki apne aap likha jayega.</p>
          </div>
        </template>
      </div>
    </template>
  </section>
</template>
