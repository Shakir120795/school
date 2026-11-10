<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session, currentUser } from "../api.js";

const sid = session.schoolId;
const user = currentUser();
const loading = ref(true);
const school = ref(null);
const children = ref([]);
const teachers = ref([]);
const inbox = ref([]);
const unread = ref(0);
const whatsapp = ref(true);
const msg = ref("");

const COLORS = ["#0b8457", "#2563eb", "#d97706", "#db2777", "#7c3aed", "#0891b2"];
const initials = (name) => name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function attPct(child) {
  const days = child.attendances || [];
  if (!days.length) return null;
  const ok = days.filter((a) => ["PRESENT", "LATE"].includes(a.status)).length;
  return Math.round((ok / days.length) * 100);
}
function ringStyle(p) {
  const c = 2 * Math.PI * 30;
  return { c, off: c - (c * (p ?? 0)) / 100 };
}
function stripDays(child) {
  // Last 10 attendance records, oldest → newest, as colored dots
  // (Phase 47b: shakir — 'last 10 day ki attendance dot se show ho').
  return (child.attendances || []).slice(0, 10).reverse();
}

// Phase 47b: present wale sabse taze din ka entry/exit time —
// gate scan se aata hai (entryAt/exitAt). Jis record me koi bhi
// time bhara ho, wahi dikhta hai; time school ke timezone me.
function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: school.value?.timezone || undefined });
}
function entryLine(child) {
  const a = (child.attendances || []).find((x) => ["PRESENT", "LATE"].includes(x.status) && (x.entryAt || x.exitAt));
  if (!a) return null;
  const d = new Date(a.localDate);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const when = sameDay ? "Today" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return { when, entry: fmtTime(a.entryAt), exit: fmtTime(a.exitAt) };
}
const dotClass = (s) =>
  s === "PRESENT" ? "bg-emerald-500" : s === "LATE" ? "bg-amber-500" : s === "ABSENT" ? "bg-rose-500" : "bg-slate-300";
const todayStatus = (child) => (child.attendances || [])[0] || null;

// Phase 45: bacche ka sabse taza status BADA banner banke dikhta
// hai — kam padhe-likhe parent bhi ek nazar me samjhe. Tarih bhi
// saath me, taaki purana record "aaj" na lage.
const STATUS_VIEW = {
  PRESENT: { emoji: "✅", word: "Present", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  LATE: { emoji: "🟡", word: "Came late", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  ABSENT: { emoji: "❌", word: "Absent", cls: "bg-rose-100 text-rose-800 border-rose-200" },
  ON_LEAVE: { emoji: "🏠", word: "On leave", cls: "bg-sky-100 text-sky-800 border-sky-200" },
};
function statusBanner(child) {
  const a = todayStatus(child);
  if (!a) return { emoji: "⏳", text: "No school news yet", cls: "bg-slate-100 text-slate-600 border-slate-200" };
  const v = STATUS_VIEW[a.status] || { emoji: "📋", word: a.status, cls: "bg-slate-100 text-slate-700 border-slate-200" };
  const d = new Date(a.localDate);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const when = sameDay ? "today" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return { emoji: v.emoji, text: `${v.word} · ${when}`, cls: v.cls };
}

async function load() {
  loading.value = true;
  try {
    const [c, t, n, s] = await Promise.all([
      api(`/schools/${sid}/my-children`),
      api(`/schools/${sid}/teachers`),
      api(`/schools/${sid}/my-notifications`),
      api(`/schools/${sid}`).catch(() => null),
    ]);
    school.value = s?.json?.school || null;
    children.value = c.json.children || [];
    teachers.value = t.json.teachers || [];
    if (n.status === 200) {
      inbox.value = n.json.notifications.slice(0, 3);
      unread.value = n.json.unread;
    }
  } finally {
    loading.value = false;
  }
}
async function savePref() {
  const r = await api(`/schools/${sid}/my-consents`, {
    method: "PUT",
    body: { channel: "WHATSAPP", optedIn: whatsapp.value },
  });
  msg.value = r.status < 300 ? "Preference saved." : "Could not save preference.";
}
onMounted(load);
</script>

<template>
  <div>
    <div class="rounded-3xl text-white p-5 mb-4 shadow" style="background: linear-gradient(100deg, #1e3a8a, #2563eb)">
      <div class="text-sm text-white/70">Hello 👋</div>
      <h1 class="text-2xl font-extrabold">{{ user?.fullName }}</h1>
      <div v-if="school" class="mt-1.5 flex items-center gap-2 text-sm font-bold text-white/95">
        <img v-if="school.logoUrl" :src="school.logoUrl" class="w-6 h-6 rounded-md object-contain bg-white shrink-0" alt="" />
        <span v-else>🏫</span>
        <span class="truncate">{{ school.name }}</span>
      </div>
      <div class="flex flex-wrap gap-2 mt-3">
        <span class="chip bg-white/15 text-white">{{ loading ? "Loading…" : `${children.length} child${children.length === 1 ? "" : "ren"} linked` }}</span>
        <router-link to="/notifications" class="chip bg-white text-emerald-800 font-bold">🔔 {{ unread }} new notification{{ unread === 1 ? "" : "s" }}</router-link>
      </div>
    </div>

    <!-- Phase 47b: baccho ke cards SABSE UPAR (shakir: 'inhe upr
         set kro') — parent app kholte hi pehle apne bacche dikhte
         hain, bade buttons unke neeche gaye. -->
    <div v-if="loading" class="card text-slate-500 text-sm mb-4 animate-pulse">Loading your children…</div>
    <div v-else-if="!children.length" class="card text-slate-500 text-sm mb-4">
      No children are linked to your account yet. Ask the school office to link your guardian profile.
    </div>

    <div class="grid md:grid-cols-2 gap-4 items-start mb-4">
      <div v-for="(child, i) in children" :key="child.id" class="card">
        <div class="flex items-center gap-3 mb-3">
          <div class="avatar w-14 h-14 text-xl" :style="{ background: COLORS[i % COLORS.length] }">{{ initials(child.fullName) }}</div>
          <div class="min-w-0">
            <div class="font-extrabold text-xl leading-tight truncate">{{ child.fullName }}</div>
            <div class="text-xs text-slate-500">Adm {{ child.admissionNo }} · Class {{ child.classroom?.name }}<span v-if="child.classroom?.section">-{{ child.classroom.section }}</span></div>
          </div>
        </div>
        <div class="rounded-2xl border px-4 py-3 mb-3 text-center text-lg font-extrabold" :class="statusBanner(child).cls">{{ statusBanner(child).emoji }} {{ statusBanner(child).text }}</div>
        <div v-if="entryLine(child)" class="flex items-center justify-center gap-2 text-sm font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-2xl px-3 py-2 mb-3">
          <span>🕗 {{ entryLine(child).when }}</span>
          <span class="text-emerald-700">Entry: {{ entryLine(child).entry }}</span>
          <span class="text-slate-300">|</span>
          <span class="text-rose-700">Exit: {{ entryLine(child).exit }}</span>
        </div>

        <div class="flex items-center gap-4">
          <svg class="w-[76px] h-[76px]" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r="30" fill="none" stroke="#e2e8f0" stroke-width="8" />
            <circle cx="38" cy="38" r="30" fill="none" :stroke="COLORS[i % COLORS.length]" stroke-width="8" stroke-linecap="round"
              :stroke-dasharray="ringStyle(attPct(child)).c" :stroke-dashoffset="ringStyle(attPct(child)).off" transform="rotate(-90 38 38)" />
            <text x="38" y="42" text-anchor="middle" font-size="14" font-weight="800" class="fill-slate-800">{{ attPct(child) ?? "–" }}%</text>
          </svg>
          <div class="flex-1">
            <div class="text-xs font-semibold text-slate-500 mb-1.5">Last 10 school days</div>
            <div class="flex gap-1.5 flex-wrap">
              <span v-for="d in stripDays(child)" :key="d.id" class="w-3.5 h-3.5 rounded-full" :class="dotClass(d.status)"
                :title="`${new Date(d.localDate).toLocaleDateString()} · ${d.status}`"></span>
              <span v-if="!stripDays(child).length" class="text-sm text-slate-400">No records yet</span>
            </div>
            <div class="flex gap-3 mt-2 text-[11px] text-slate-500">
              <span><span class="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1"></span>Present</span>
              <span><span class="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1"></span>Late</span>
              <span><span class="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1"></span>Absent</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Phase 45 ke bade buttons — Phase 47b me baccho ke cards
         ke NEECHE aa gaye (pehle bacche, phir buttons). -->
    <div class="grid grid-cols-2 gap-3 mb-5">
      <router-link to="/parent" class="big-btn"><span class="big-ico" style="background:#dbeafe">📅</span><span><span class="big-label">Attendance</span><span class="big-sub">See present / absent days</span></span></router-link>
      <router-link to="/notifications" class="big-btn"><span class="big-ico" style="background:#fef3c7">🔔</span><span><span class="big-label">Alerts</span><span class="big-sub">New messages from school</span></span><span v-if="unread" class="tile-badge">{{ unread }}</span></router-link>
      <router-link to="/homework" class="big-btn"><span class="big-ico" style="background:#ffedd5">📚</span><span><span class="big-label">Homework</span><span class="big-sub">Today's homework</span></span></router-link>
      <router-link to="/fees" class="big-btn"><span class="big-ico" style="background:#fce7f3">💳</span><span><span class="big-label">Fees</span><span class="big-sub">Fees &amp; receipts</span></span></router-link>
      <router-link to="/notices" class="big-btn"><span class="big-ico" style="background:#e0e7ff">📣</span><span><span class="big-label">Notices</span><span class="big-sub">School announcements</span></span></router-link>
      <router-link to="/leave" class="big-btn"><span class="big-ico" style="background:#ede9fe">✉️</span><span><span class="big-label">Leave</span><span class="big-sub">Tell school about leave</span></span></router-link>
      <router-link to="/pickup" class="big-btn"><span class="big-ico" style="background:#fef9c3">🚌</span><span><span class="big-label">Pickup</span><span class="big-sub">Who can pick your child</span></span></router-link>
      <router-link to="/timetable" class="big-btn"><span class="big-ico" style="background:#e0f2fe">🗓️</span><span><span class="big-label">Time Table</span><span class="big-sub">Daily class timings</span></span></router-link>
      <a href="#teachers" class="big-btn"><span class="big-ico" style="background:#dcfce7">🧑‍🏫</span><span><span class="big-label">Teachers</span><span class="big-sub">Meet the teachers</span></span></a>
      <a href="#prefs" class="big-btn"><span class="big-ico" style="background:#f1f5f9">⚙️</span><span><span class="big-label">More</span><span class="big-sub">Settings &amp; preferences</span></span></a>
    </div>

    <div class="grid md:grid-cols-2 gap-4 items-start">
      <div class="card">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold">🔔 Latest from school</h3>
          <router-link to="/notifications" class="text-sm text-brand-700 font-semibold">Open inbox →</router-link>
        </div>
        <div v-if="!loading && !inbox.length" class="text-sm text-slate-500">No notifications yet.</div>
        <div v-for="n in inbox" :key="n.recipientId" class="py-2 border-b border-slate-100 last:border-0">
          <div class="text-sm font-semibold">{{ n.notice.title }} <span v-if="!n.read" class="chip bg-brand-600 text-white ml-1">NEW</span></div>
          <p class="text-sm text-slate-500 line-clamp-2">{{ n.notice.body }}</p>
        </div>
      </div>

      <div class="space-y-4">
        <div class="card" id="teachers">
          <h3 class="font-bold mb-2">🧑‍🏫 Teachers</h3>
          <div v-if="!loading && !teachers.length" class="text-sm text-slate-500">No teacher contacts published yet.</div>
          <div v-for="t in teachers" :key="t.id" class="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <div class="avatar w-9 h-9 text-xs" style="background:#2563eb">{{ initials(t.displayName) }}</div>
            <div class="text-sm">
              <div class="font-semibold">{{ t.displayName }} <span v-if="t.inchargeAssignments?.length" class="chip bg-emerald-100 text-emerald-700 ml-1">Class incharge</span></div>
              <div class="text-slate-500 text-xs"><span v-for="a in t.classAssignments" :key="a.id" class="mr-2">{{ a.subject?.name }} — Class {{ a.classroom?.name }}-{{ a.classroom?.section }}</span></div>
              <div v-if="t.approvedContactChannel" class="text-slate-400 text-xs">Contact: {{ t.approvedContactChannel }}</div>
            </div>
          </div>
        </div>

        <div class="card" id="prefs">
          <h3 class="font-bold mb-2">Communication preferences</h3>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="whatsapp" class="w-4 h-4 accent-emerald-600" />
            Also receive school notices on WhatsApp (when enabled by the school)
          </label>
          <button type="button" class="btn btn-primary mt-3 !py-2" @click="savePref">Save preference</button>
          <p v-if="msg" class="text-xs text-brand-700 mt-2">{{ msg }}</p>
        </div>

        <p class="text-center text-xs text-slate-400 mt-6 flex flex-wrap justify-center gap-x-3 gap-y-1">
          <router-link to="/privacy" class="underline">Privacy Policy</router-link>
          <router-link to="/terms" class="underline">Terms of Service</router-link>
          <router-link to="/safety" class="underline">Safety & Security</router-link>
        </p>
      </div>
    </div>
  </div>
</template>
<style scoped>
.big-btn { position: relative; display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e8edf3; border-radius: 20px; padding: 12px; box-shadow: 0 1px 2px rgba(16,24,40,.05); text-align: left; }
.big-ico { width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; font-size: 26px; flex-shrink: 0; }
.big-label { display: block; font-size: 16px; font-weight: 800; color: #1e293b; line-height: 1.15; }
.big-sub { display: block; font-size: 11.5px; color: #64748b; margin-top: 2px; line-height: 1.25; }
.tile-badge { position: absolute; top: 6px; right: 6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: #dc2626; color: #fff; font-size: 9px; font-weight: 800; display: grid; place-items: center; }
</style>
