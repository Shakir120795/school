<script setup>
import { computed, onMounted, ref } from "vue";
import { api, session } from "../api.js";

// Timetable + calendar (Phase 17).
// Weekly grid per class; teachers get "My periods"; everyone gets the
// month calendar (events + holidays). Managers can build the grid and
// add events.
const role = session.membership?.role;
const isParent = role === "PARENT";
const isTeacher = role === "TEACHER";
const isManager = ["SCHOOL_ADMIN", "PRINCIPAL"].includes(role);
const sid = session.schoolId;
const msg = ref("");
const err = ref("");
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const todayWeekday = ((new Date().getDay() + 6) % 7) + 1; // 1=Mon..7=Sun

const classes = ref([]);
const classroomId = ref("");
const slots = ref([]);
const parentClasses = ref([]);
const dayTab = ref(todayWeekday);
const mySlots = ref([]);
const subjects = ref([]);
const teachers = ref([]);
const slotForm = ref({ weekday: 1, periodNo: 1, startTime: "09:00", endTime: "09:45", subjectId: "", label: "", teacherProfileId: "", room: "" });

const month = ref(new Date().toISOString().slice(0, 7));
const calItems = ref([]);
const eventForm = ref({ title: "", eventDate: "", endDate: "", type: "EVENT", description: "" });
const TYPE_ICON = { EVENT: "📌", EXAM: "📝", SPORTS: "🏆", CULTURAL: "🎭", PTM: "👨‍👩‍👧", OTHER: "•", HOLIDAY: "🌴" };

// Phase 54: manager ke alawa INCHARGE teacher bhi apni class ka
// timetable bana sakti hai — canEdit usi hisaab se khulta hai.
const myInchargeIds = computed(() => {
  const me = teachers.value.find((tp) => tp.membershipId === session.membership?.id);
  return (me?.inchargeAssignments || []).map((a) => a.classroomId);
});
const canEdit = computed(() => isManager || (isTeacher && myInchargeIds.value.includes(classroomId.value)));

// Phase 54: copy — ek din pure hafte par, ya ek class dusri par.
const copyFromWeekday = ref(1);
const copyToWeekdays = ref([]);
const copyFromClassId = ref("");
function toggleCopyDay(wd) {
  const i = copyToWeekdays.value.indexOf(wd);
  if (i >= 0) copyToWeekdays.value.splice(i, 1);
  else copyToWeekdays.value.push(wd);
}
async function copyDay() {
  err.value = ""; msg.value = "";
  if (!copyToWeekdays.value.length) { err.value = "Choose at least one target day."; return; }
  const r = await api(`/schools/${sid}/timetable/copy`, {
    method: "POST",
    body: { mode: "DAY", classroomId: classroomId.value, fromWeekday: copyFromWeekday.value, toWeekdays: copyToWeekdays.value },
  });
  if (r.status === 200) { msg.value = `${r.json.copied} period(s) copied.`; slots.value = r.json.slots || slots.value; copyToWeekdays.value = []; }
  else err.value = r.json?.error || "Copy failed";
}
async function copyClass() {
  err.value = ""; msg.value = "";
  if (!copyFromClassId.value) return;
  const src = classes.value.find((c) => c.id === copyFromClassId.value);
  if (!confirm(`Copy the full week from Class ${src?.name || ""}${src?.section ? "-" + src.section : ""} into this class? Periods with the same day and number will be replaced.`)) return;
  const r = await api(`/schools/${sid}/timetable/copy`, {
    method: "POST",
    body: { mode: "CLASS", fromClassroomId: copyFromClassId.value, toClassroomId: classroomId.value },
  });
  if (r.status === 200) { msg.value = `${r.json.copied} period(s) copied into this class.`; slots.value = r.json.slots || slots.value; }
  else err.value = r.json?.error || "Copy failed";
}

const periods = computed(() => [...new Set(slots.value.map((s) => s.periodNo))].sort((a, b) => a - b));
const byCell = computed(() => {
  const m = {};
  for (const s of slots.value) m[`${s.weekday}:${s.periodNo}`] = s;
  return m;
});
const myByDay = computed(() => {
  const m = {};
  for (const s of mySlots.value) (m[s.weekday] ||= []).push(s);
  return m;
});

async function loadGrid() {
  if (isParent) {
    const r = await api(`/schools/${sid}/timetable`);
    if (r.status === 200) parentClasses.value = r.json.classes;
    return;
  }
  if (!classroomId.value) return;
  const r = await api(`/schools/${sid}/timetable?classroomId=${classroomId.value}`);
  if (r.status === 200) slots.value = r.json.slots;
}
async function loadMeta() {
  const [c, s, t, mine] = await Promise.all([
    api(`/schools/${sid}/rollcall/classes`),
    api(`/schools/${sid}/subjects`),
    api(`/schools/${sid}/teachers`),
    isTeacher ? api(`/schools/${sid}/timetable/mine`) : Promise.resolve(null),
  ]);
  if (c.status === 200) { classes.value = c.json.classes; if (classes.value.length) classroomId.value = classes.value[0].id; }
  if (s.status === 200) subjects.value = s.json.subjects || [];
  if (t.status === 200) teachers.value = t.json.teachers || [];
  if (mine && mine.status === 200) mySlots.value = mine.json.slots;
}
async function saveSlot() {
  err.value = ""; msg.value = "";
  const body = { ...slotForm.value, classroomId: classroomId.value, subjectId: slotForm.value.subjectId || undefined, teacherProfileId: slotForm.value.teacherProfileId || undefined, label: slotForm.value.label || undefined, room: slotForm.value.room || undefined };
  const r = await api(`/schools/${sid}/timetable/slots`, { method: "POST", body });
  if (r.status === 201) { msg.value = "Period saved."; await loadGrid(); } else err.value = r.json?.error || "Could not save period";
}
async function deleteSlot(slot) {
  if (!confirm(`Remove ${DAYS[slot.weekday - 1]} period ${slot.periodNo}?`)) return;
  const r = await api(`/schools/${sid}/timetable/slots/${slot.id}`, { method: "DELETE" });
  if (r.status === 200) await loadGrid(); else err.value = r.json?.error || "Delete failed";
}
async function loadCalendar() {
  const r = await api(`/schools/${sid}/calendar?month=${month.value}`);
  if (r.status === 200) calItems.value = r.json.items;
}
async function addEvent() {
  err.value = ""; msg.value = "";
  const body = { ...eventForm.value, endDate: eventForm.value.endDate || undefined, description: eventForm.value.description || undefined };
  const r = await api(`/schools/${sid}/calendar/events`, { method: "POST", body });
  if (r.status === 201) { msg.value = "Event added to the calendar."; eventForm.value = { title: "", eventDate: "", endDate: "", type: "EVENT", description: "" }; await loadCalendar(); }
  else err.value = r.json?.error || "Could not add event";
}
async function deleteEvent(item) {
  if (item.kind !== "EVENT") return;
  if (!confirm(`Delete event "${item.title}"?`)) return;
  const r = await api(`/schools/${sid}/calendar/events/${item.id}`, { method: "DELETE" });
  if (r.status === 200) await loadCalendar();
}
onMounted(async () => { await loadMeta(); await loadGrid(); await loadCalendar(); });
</script>

<template>
  <div>
    <h1 class="text-xl font-bold mb-1">🗓️ Timetable & Calendar</h1>
    <p class="text-sm text-slate-500 mb-4">Weekly class timetable and the school calendar — events and holidays together.</p>
    <p v-if="msg" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3">{{ msg }}</p>
    <p v-if="err" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">{{ err }}</p>

    <!-- TEACHER: my periods -->
    <section v-if="isTeacher" class="card mb-4">
      <h2 class="font-bold mb-2">My periods this week</h2>
      <div v-if="mySlots.length" class="grid gap-1.5">
        <div v-for="wd in 7" :key="wd" v-show="(myByDay[wd] || []).length" class="text-sm">
          <span class="font-bold" :class="{ 'text-brand-700': wd === todayWeekday }">{{ DAYS[wd - 1] }}{{ wd === todayWeekday ? " (today)" : "" }}:</span>
          <span v-for="s in myByDay[wd]" :key="s.id" class="inline-block ml-2 bg-slate-100 rounded-full px-2 py-0.5 text-xs font-semibold">
            P{{ s.periodNo }} · {{ s.display }} · Class {{ s.className }} · {{ s.startTime }}–{{ s.endTime }}
          </span>
        </div>
      </div>
      <p v-else class="text-sm text-slate-400">No periods assigned to you in any class timetable yet.</p>
    </section>

    <!-- PARENT: per-child class grids -->
    <template v-if="isParent">
      <section v-for="g in parentClasses" :key="g.classroomId" class="card mb-4">
        <h2 class="font-bold mb-1">Class {{ g.className }}</h2>
        <p class="text-xs text-slate-400 mb-3">For: {{ g.children.join(", ") }}</p>
        <div class="flex gap-1 mb-3 overflow-x-auto">
          <button v-for="wd in 6" :key="wd" class="btn !py-1.5 !px-3 text-xs" :class="dayTab === wd ? 'btn-primary' : 'btn-ghost'" @click="dayTab = wd">{{ DAYS[wd - 1] }}</button>
        </div>
        <div class="grid gap-1.5">
          <div v-for="s in g.slots.filter((x) => x.weekday === dayTab)" :key="s.id" class="flex items-center gap-2 text-sm border border-slate-100 rounded-xl px-3 py-2">
            <span class="font-bold text-slate-400 w-8">P{{ s.periodNo }}</span>
            <span class="font-semibold">{{ s.display }}</span>
            <span v-if="s.teacherName" class="text-slate-400 text-xs">{{ s.teacherName }}</span>
            <span class="ml-auto text-xs text-slate-500">{{ s.startTime }}–{{ s.endTime }}</span>
          </div>
          <p v-if="!g.slots.filter((x) => x.weekday === dayTab).length" class="text-sm text-slate-400">No periods on this day.</p>
        </div>
      </section>
      <p v-if="!parentClasses.length" class="card text-sm text-slate-400 mb-4">No timetable published yet.</p>
    </template>

    <!-- STAFF: class grid -->
    <template v-else>
      <section class="card mb-4">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <h2 class="font-bold">Weekly timetable</h2>
          <select v-model="classroomId" class="input !w-auto ml-auto" @change="loadGrid">
            <option v-for="c in classes" :key="c.id" :value="c.id">Class {{ c.name }}{{ c.section ? "-" + c.section : "" }}</option>
          </select>
        </div>
        <!-- desktop grid -->
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr>
              <th class="text-left py-1 pr-2 text-slate-400">Period</th>
              <th v-for="wd in 6" :key="wd" class="text-left py-1 px-2" :class="{ 'text-brand-700': wd === todayWeekday }">{{ DAYS[wd - 1] }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="p in periods" :key="p" class="border-t border-slate-100">
                <td class="py-2 pr-2 font-bold text-slate-400">{{ p }}</td>
                <td v-for="wd in 6" :key="wd" class="py-2 px-2 align-top">
                  <template v-if="byCell[`${wd}:${p}`]">
                    <div class="font-semibold">{{ byCell[`${wd}:${p}`].display }}</div>
                    <div class="text-xs text-slate-400">{{ byCell[`${wd}:${p}`].startTime }}–{{ byCell[`${wd}:${p}`].endTime }}<span v-if="byCell[`${wd}:${p}`].teacherName"> · {{ byCell[`${wd}:${p}`].teacherName }}</span><span v-if="byCell[`${wd}:${p}`].room"> · {{ byCell[`${wd}:${p}`].room }}</span></div>
                    <button v-if="canEdit" class="text-xs text-red-500 font-semibold" @click="deleteSlot(byCell[`${wd}:${p}`])">Remove</button>
                  </template>
                  <span v-else class="text-slate-300">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!periods.length" class="text-sm text-slate-400 py-2">No periods yet — add the first one below.</p>
        </div>
        <!-- mobile: day tabs -->
        <div class="md:hidden">
          <div class="flex gap-1 mb-3 overflow-x-auto">
            <button v-for="wd in 6" :key="wd" class="btn !py-1.5 !px-3 text-xs" :class="dayTab === wd ? 'btn-primary' : 'btn-ghost'" @click="dayTab = wd">{{ DAYS[wd - 1] }}</button>
          </div>
          <div class="grid gap-1.5">
            <div v-for="s in slots.filter((x) => x.weekday === dayTab)" :key="s.id" class="flex items-center gap-2 text-sm border border-slate-100 rounded-xl px-3 py-2">
              <span class="font-bold text-slate-400 w-8">P{{ s.periodNo }}</span>
              <span class="font-semibold">{{ s.display }}</span>
              <span v-if="s.teacherName" class="text-slate-400 text-xs">{{ s.teacherName }}</span>
              <span class="ml-auto text-xs text-slate-500">{{ s.startTime }}–{{ s.endTime }}</span>
              <button v-if="canEdit" class="text-xs text-red-500 font-semibold" @click="deleteSlot(s)">✕</button>
            </div>
            <p v-if="!slots.filter((x) => x.weekday === dayTab).length" class="text-sm text-slate-400">No periods on this day.</p>
          </div>
        </div>

        <form v-if="canEdit" class="grid md:grid-cols-4 gap-2 mt-4 border-t border-slate-100 pt-3" @submit.prevent="saveSlot">
          <select v-model.number="slotForm.weekday" class="input">
            <option v-for="wd in 7" :key="wd" :value="wd">{{ DAYS[wd - 1] }}</option>
          </select>
          <input v-model.number="slotForm.periodNo" type="number" min="1" max="12" class="input" placeholder="Period no" required />
          <input v-model="slotForm.startTime" type="time" class="input" required />
          <input v-model="slotForm.endTime" type="time" class="input" required />
          <select v-model="slotForm.subjectId" class="input">
            <option value="">Subject (optional)</option>
            <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <input v-model="slotForm.label" class="input" placeholder="Or label — Lunch / Assembly" />
          <select v-model="slotForm.teacherProfileId" class="input">
            <option value="">Teacher (optional)</option>
            <option v-for="t in teachers" :key="t.id" :value="t.id">{{ t.displayName }}</option>
          </select>
          <input v-model="slotForm.room" class="input" placeholder="Room (optional)" />
          <button class="btn btn-primary md:col-span-4">Save period</button>
        </form>

        <!-- Phase 54: copy tools — pura hafta ek-ek period bharne
             ki jagah ek din ya ek class se copy kar lo -->
        <div v-if="canEdit" class="grid md:grid-cols-2 gap-3 mt-4">
          <div class="border border-slate-100 rounded-xl p-3">
            <div class="font-bold text-sm mb-2">📋 Copy a day</div>
            <div class="flex items-center gap-2 mb-2 text-sm">
              <span class="text-slate-500">From</span>
              <select v-model.number="copyFromWeekday" class="input !w-auto !py-1.5">
                <option v-for="wd in 6" :key="wd" :value="wd">{{ DAYS[wd - 1] }}</option>
              </select>
              <span class="text-slate-500">to</span>
            </div>
            <div class="flex flex-wrap gap-1.5 mb-2.5">
              <button v-for="wd in 6" :key="wd" type="button" class="btn !py-1.5 !px-3 text-xs"
                :class="copyToWeekdays.includes(wd) ? 'btn-primary' : 'btn-ghost'"
                :disabled="wd === copyFromWeekday" @click="toggleCopyDay(wd)">{{ DAYS[wd - 1] }}</button>
            </div>
            <button type="button" class="btn btn-primary !py-2 w-full" @click="copyDay">Copy day to selected days</button>
            <p class="text-xs text-slate-400 mt-1.5">All periods of that day are copied over — a period with the same number on a target day is replaced.</p>
          </div>
          <div class="border border-slate-100 rounded-xl p-3">
            <div class="font-bold text-sm mb-2">🏫 Copy from another class</div>
            <select v-model="copyFromClassId" class="input mb-2.5">
              <option value="">Choose a class…</option>
              <option v-for="c in classes.filter((x) => x.id !== classroomId)" :key="c.id" :value="c.id">Class {{ c.name }}{{ c.section ? "-" + c.section : "" }}</option>
            </select>
            <button type="button" class="btn btn-primary !py-2 w-full" :disabled="!copyFromClassId" @click="copyClass">Copy into this class</button>
            <p class="text-xs text-slate-400 mt-1.5">The whole week of the chosen class is copied into the class open above — same day and period number are replaced.</p>
          </div>
        </div>
      </section>
    </template>

    <!-- CALENDAR -->
    <section class="card">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <h2 class="font-bold">School calendar</h2>
        <input v-model="month" type="month" class="input !w-auto ml-auto" @change="loadCalendar" />
      </div>
      <div class="grid gap-1.5">
        <div v-for="it in calItems" :key="it.kind + it.id" class="flex items-center gap-2 text-sm border border-slate-100 rounded-xl px-3 py-2">
          <span>{{ TYPE_ICON[it.type] || "📌" }}</span>
          <span class="font-semibold">{{ it.title }}</span>
          <span v-if="it.description" class="text-slate-400 text-xs">{{ it.description }}</span>
          <span class="ml-auto text-xs text-slate-500">{{ String(it.date).slice(0, 10) }}<span v-if="it.endDate"> → {{ String(it.endDate).slice(0, 10) }}</span></span>
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full" :class="it.kind === 'HOLIDAY' ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-700'">{{ it.type }}</span>
          <button v-if="isManager && it.kind === 'EVENT'" class="text-xs text-red-500 font-semibold" @click="deleteEvent(it)">✕</button>
        </div>
        <p v-if="!calItems.length" class="text-sm text-slate-400">Nothing in this month.</p>
      </div>
      <form v-if="isManager" class="grid md:grid-cols-4 gap-2 mt-4 border-t border-slate-100 pt-3" @submit.prevent="addEvent">
        <input v-model="eventForm.title" class="input" placeholder="Event title" required />
        <input v-model="eventForm.eventDate" type="date" class="input" required />
        <input v-model="eventForm.endDate" type="date" class="input" />
        <select v-model="eventForm.type" class="input">
          <option>EVENT</option><option>EXAM</option><option>SPORTS</option><option>CULTURAL</option><option>PTM</option><option>OTHER</option>
        </select>
        <input v-model="eventForm.description" class="input md:col-span-3" placeholder="Description (optional)" />
        <button class="btn btn-primary">Add event</button>
      </form>
    </section>
  </div>
</template>
