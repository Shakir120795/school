<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session, currentUser } from "../api.js";

const sid = session.schoolId;
const user = currentUser();
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
  // Last 14 attendance records, oldest → newest, as colored dots.
  return (child.attendances || []).slice(0, 14).reverse();
}
const dotClass = (s) =>
  s === "PRESENT" ? "bg-emerald-500" : s === "LATE" ? "bg-amber-500" : s === "ABSENT" ? "bg-rose-500" : "bg-slate-300";
const todayStatus = (child) => (child.attendances || [])[0] || null;

async function load() {
  const [c, t, n] = await Promise.all([
    api(`/schools/${sid}/my-children`),
    api(`/schools/${sid}/teachers`),
    api(`/schools/${sid}/my-notifications`),
  ]);
  children.value = c.json.children || [];
  teachers.value = t.json.teachers || [];
  if (n.status === 200) {
    inbox.value = n.json.notifications.slice(0, 3);
    unread.value = n.json.unread;
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
      <div class="text-sm text-white/70">Welcome,</div>
      <h1 class="text-2xl font-extrabold">{{ user?.fullName }}</h1>
      <div class="flex flex-wrap gap-2 mt-3">
        <span class="chip bg-white/15 text-white">{{ children.length }} child{{ children.length === 1 ? "" : "ren" }} linked</span>
        <router-link to="/notifications" class="chip bg-white text-emerald-800 font-bold">🔔 {{ unread }} new notification{{ unread === 1 ? "" : "s" }}</router-link>
      </div>
    </div>

    <!-- Quick tiles (UI reference layout) -->
    <div class="grid grid-cols-4 gap-2.5 mb-5">
      <router-link to="/parent" class="tile"><span class="tile-ico" style="background:#dbeafe">📅</span>Attendance</router-link>
      <router-link to="/notifications" class="tile"><span class="tile-ico" style="background:#fef3c7">🔔</span>Alerts<span v-if="unread" class="tile-badge">{{ unread }}</span></router-link>
      <router-link to="/notices" class="tile"><span class="tile-ico" style="background:#e0e7ff">📣</span>Notices</router-link>
      <a href="#teachers" class="tile"><span class="tile-ico" style="background:#dcfce7">🧑‍🏫</span>Teachers</a>
      <router-link to="/homework" class="tile"><span class="tile-ico" style="background:#ffedd5">📚</span>Homework</router-link>
      <router-link to="/fees" class="tile"><span class="tile-ico" style="background:#fce7f3">💳</span>Fees</router-link>
      <div class="tile tile-soon"><span class="tile-ico" style="background:#e0f2fe">🗓️</span>Time Table<span class="soon">Soon</span></div>
      <router-link to="/pickup" class="tile"><span class="tile-ico" style="background:#fef9c3">🚌</span>Pickup</router-link>
      <router-link to="/leave" class="tile"><span class="tile-ico" style="background:#ede9fe">✉️</span>Leave</router-link>
      <div class="tile tile-soon"><span class="tile-ico" style="background:#f1f5f9">🖼️</span>Gallery<span class="soon">Soon</span></div>
      <router-link to="/notifications" class="tile"><span class="tile-ico" style="background:#ffe4e6">📩</span>Inbox</router-link>
      <a href="#prefs" class="tile"><span class="tile-ico" style="background:#f1f5f9">⚙️</span>More</a>
    </div>

    <div v-if="!children.length" class="card text-slate-500 text-sm mb-4">
      No children are linked to your account yet. Ask the school office to link your guardian profile.
    </div>

    <div class="grid md:grid-cols-2 gap-4 items-start mb-4">
      <div v-for="(child, i) in children" :key="child.id" class="card">
        <div class="flex items-center gap-3 mb-3">
          <div class="avatar w-12 h-12 text-lg" :style="{ background: COLORS[i % COLORS.length] }">{{ initials(child.fullName) }}</div>
          <div class="min-w-0">
            <div class="font-extrabold text-lg leading-tight truncate">{{ child.fullName }}</div>
            <div class="text-xs text-slate-500">Adm {{ child.admissionNo }} · Class {{ child.classroom?.name }}<span v-if="child.classroom?.section">-{{ child.classroom.section }}</span></div>
          </div>
          <span v-if="todayStatus(child)" class="chip ml-auto"
            :class="todayStatus(child).status === 'PRESENT' ? 'bg-emerald-100 text-emerald-700' : todayStatus(child).status === 'LATE' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'">
            Today: {{ todayStatus(child).status }}
          </span>
        </div>

        <div class="flex items-center gap-4">
          <svg class="w-[76px] h-[76px]" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r="30" fill="none" stroke="#e2e8f0" stroke-width="8" />
            <circle cx="38" cy="38" r="30" fill="none" :stroke="COLORS[i % COLORS.length]" stroke-width="8" stroke-linecap="round"
              :stroke-dasharray="ringStyle(attPct(child)).c" :stroke-dashoffset="ringStyle(attPct(child)).off" transform="rotate(-90 38 38)" />
            <text x="38" y="42" text-anchor="middle" font-size="14" font-weight="800" class="fill-slate-800">{{ attPct(child) ?? "–" }}%</text>
          </svg>
          <div class="flex-1">
            <div class="text-xs font-semibold text-slate-500 mb-1.5">Attendance (recent school days)</div>
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

    <div class="grid md:grid-cols-2 gap-4 items-start">
      <div class="card">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold">🔔 Latest from school</h3>
          <router-link to="/notifications" class="text-sm text-brand-700 font-semibold">Open inbox →</router-link>
        </div>
        <div v-if="!inbox.length" class="text-sm text-slate-500">No notifications yet.</div>
        <div v-for="n in inbox" :key="n.recipientId" class="py-2 border-b border-slate-100 last:border-0">
          <div class="text-sm font-semibold">{{ n.notice.title }} <span v-if="!n.read" class="chip bg-brand-600 text-white ml-1">NEW</span></div>
          <p class="text-sm text-slate-500 line-clamp-2">{{ n.notice.body }}</p>
        </div>
      </div>

      <div class="space-y-4">
        <div class="card" id="teachers">
          <h3 class="font-bold mb-2">🧑‍🏫 Teachers</h3>
          <div v-if="!teachers.length" class="text-sm text-slate-500">No teacher contacts published yet.</div>
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
      </div>
    </div>
  </div>
</template>
<style scoped>
.tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px; background: #fff; border: 1px solid #e8edf3; border-radius: 18px; padding: 10px 2px 8px; font-size: 11px; font-weight: 600; color: #334155; box-shadow: 0 1px 2px rgba(16,24,40,.05); }
.tile-ico { width: 40px; height: 40px; border-radius: 13px; display: grid; place-items: center; font-size: 19px; }
.tile-soon { opacity: .75; }
.tile .soon { position: absolute; top: 6px; right: 6px; font-size: 8px; font-weight: 800; letter-spacing: .03em; background: #f59e0b; color: #fff; border-radius: 999px; padding: 1px 5px; text-transform: uppercase; }
.tile-badge { position: absolute; top: 6px; right: 6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: #dc2626; color: #fff; font-size: 9px; font-weight: 800; display: grid; place-items: center; }
</style>
