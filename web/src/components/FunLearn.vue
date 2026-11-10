<script setup>
// Phase 49: baccho ke liye roz ka Fun & Learn — Thought of the
// Day, ek riddle (jawab chhupa, tap par khulta hai) aur class ke
// hisaab ka maths sawal (3 options, tap par shabashi/try again).
// Sab kuch din ki tareh se banta hai — poora din ek hi content,
// agle din naya. Koi server call nahi.
import { computed, ref } from "vue";

const props = defineProps({
  name: { type: String, required: true }, // bacche ka pehla naam
  grade: { type: Number, default: 5 },    // class number (1-12)
});

const THOUGHTS = [
  "Be kind. Everyone you meet is learning something new.",
  "Mistakes are proof that you are trying.",
  "Reading is to the mind what exercise is to the body.",
  "The best time to plant a tree was 10 years ago. The second best time is today.",
  "Small steps every day make big changes one day.",
  "Be the reason someone smiles today.",
  "Hard work beats talent when talent doesn't work hard.",
  "Ask questions. Curious minds learn the most.",
  "Honesty is the first chapter in the book of wisdom.",
  "Share what you have, help where you can.",
  "A good listener learns more than a loud talker.",
  "Today's practice is tomorrow's victory.",
  "Treat others the way you want to be treated.",
  "Every expert was once a beginner who refused to give up.",
];

const RIDDLES = [
  { q: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", a: "An echo" },
  { q: "What has hands but cannot clap?", a: "A clock" },
  { q: "What has a neck but no head?", a: "A bottle" },
  { q: "I am tall when I am young and short when I am old. What am I?", a: "A candle" },
  { q: "What comes once in a minute, twice in a moment, but never in a thousand years?", a: "The letter M" },
  { q: "What has keys but cannot open a single lock?", a: "A piano" },
  { q: "The more of me you take, the more you leave behind. What am I?", a: "Footsteps" },
  { q: "What belongs to you, but everyone else uses it more than you?", a: "Your name" },
  { q: "What runs but never walks, has a mouth but never talks?", a: "A river" },
  { q: "What can you catch, but never throw?", a: "A cold" },
  { q: "I have cities but no houses, forests but no trees, and rivers without water. What am I?", a: "A map" },
  { q: "What gets wetter the more it dries?", a: "A towel" },
  { q: "Forward I am heavy, but backward I am not. What am I?", a: "The word 'ton'" },
  { q: "What has one eye but cannot see?", a: "A needle" },
];

const now = new Date();
const dayNum = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
const thought = THOUGHTS[dayNum % THOUGHTS.length];
const riddle = RIDDLES[(dayNum + props.grade) % RIDDLES.length];

// Din + class se bana seeded random — poora din sawal ek hi.
function rand(seed) {
  let x = (seed * 9301 + 49297) % 233280;
  return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
}
const r = rand(dayNum * 31 + props.grade * 101);
const pick = (arr) => arr[Math.floor(r() * arr.length)];
const num = (min, max) => min + Math.floor(r() * (max - min + 1));

const quiz = computed(() => {
  const g = props.grade;
  let q, ans;
  const kind = num(0, 2);
  if (g <= 2) {
    if (kind === 0) { const a = num(3, 20), b = num(2, 15); q = `${a} + ${b} = ?`; ans = a + b; }
    else if (kind === 1) { const a = num(8, 25), b = num(2, a - 1); q = `${a} − ${b} = ?`; ans = a - b; }
    else { const a = pick([2, 3, 5, 10]), b = num(1, 5); q = `${a} × ${b} = ?`; ans = a * b; }
  } else if (g <= 5) {
    if (kind === 0) { const a = num(3, 12), b = num(3, 9); q = `${a} × ${b} = ?`; ans = a * b; }
    else if (kind === 1) { const a = num(60, 480), b = num(25, 240); q = `${a} + ${b} = ?`; ans = a + b; }
    else { const b = num(3, 12), c = num(3, 9); q = `${b * c} ÷ ${b} = ?`; ans = c; }
  } else if (g <= 8) {
    if (kind === 0) { const a = num(12, 48), b = num(3, 9); q = `${a} × ${b} = ?`; ans = a * b; }
    else if (kind === 1) { const a = num(11, 15); q = `${a}² = ?`; ans = a * a; }
    else { const base = pick([100, 200, 400, 500]), p = pick([10, 20, 25, 50]); q = `${p}% of ${base} = ?`; ans = (base * p) / 100; }
  } else {
    if (kind === 0) { const a = num(12, 25); q = `√${a * a} = ?`; ans = a; }
    else if (kind === 1) { const x = num(3, 15), b = num(4, 30); q = `x + ${b} = ${x + b}. What is x?`; ans = x; }
    else { const a = num(2, 6); q = `${a}³ = ?`; ans = a * a * a; }
  }
  const offs = new Set();
  while (offs.size < 2) { const o = pick([-10, -5, -2, -1, 1, 2, 5, 10]); if (o !== 0 && ans + o > 0) offs.add(o); }
  const options = [ans, ...[...offs].map((o) => ans + o)];
  for (let i = options.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
  return { q, ans, options };
});

const showAnswer = ref(false);
const picked = ref(null);
</script>

<template>
  <div class="card overflow-hidden !p-0">
    <div class="px-4 py-3 text-white" style="background: linear-gradient(100deg, #7c3aed, #db2777)">
      <div class="font-extrabold text-lg leading-tight">🎉 Fun &amp; Learn — {{ name }}</div>
      <div class="text-xs text-white/80">Class {{ grade }} · New fun every day!</div>
    </div>
    <div class="p-4 grid gap-4">
      <div>
        <div class="text-xs font-extrabold tracking-wide text-violet-600 mb-1">🌟 THOUGHT OF THE DAY</div>
        <p class="text-[15px] font-semibold text-slate-700 leading-snug">"{{ thought }}"</p>
      </div>
      <div class="rounded-2xl bg-amber-50 border border-amber-100 px-3.5 py-3">
        <div class="text-xs font-extrabold tracking-wide text-amber-600 mb-1">🧩 TODAY'S RIDDLE</div>
        <p class="text-[15px] font-semibold text-slate-700 leading-snug">{{ riddle.q }}</p>
        <button v-if="!showAnswer" type="button" class="mt-2 text-sm font-bold text-amber-700 underline" @click="showAnswer = true">See the answer 👀</button>
        <p v-else class="mt-2 text-[15px] font-extrabold text-emerald-700">✅ {{ riddle.a }}</p>
      </div>
      <div class="rounded-2xl bg-sky-50 border border-sky-100 px-3.5 py-3">
        <div class="text-xs font-extrabold tracking-wide text-sky-600 mb-1">🔢 MATHS CHALLENGE</div>
        <p class="text-lg font-extrabold text-slate-800">{{ quiz.q }}</p>
        <div class="flex gap-2 mt-2.5 flex-wrap">
          <button v-for="o in quiz.options" :key="o" type="button"
            class="px-4 py-2 rounded-xl border-2 font-extrabold text-[15px] transition"
            :class="picked === null ? 'border-sky-200 bg-white text-slate-700' : o === quiz.ans ? 'border-emerald-500 bg-emerald-100 text-emerald-800' : picked === o ? 'border-rose-400 bg-rose-100 text-rose-700' : 'border-slate-200 bg-white text-slate-400'"
            @click="picked = o">
            {{ o }}
          </button>
        </div>
        <p v-if="picked !== null && picked === quiz.ans" class="mt-2.5 font-extrabold text-emerald-700">🎉 Great job, {{ name }}! That is the right answer!</p>
        <p v-else-if="picked !== null" class="mt-2.5 font-bold text-rose-600">Try once more — you can do it! 💪</p>
      </div>
    </div>
  </div>
</template>
