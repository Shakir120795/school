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
  <!-- Phase 62: teeno activities ab apni-apni alag kid-friendly
       card me — har card ka apna rang, bada icon aur halki
       animation, taaki baccho ko kholne me maza aaye. -->
  <div class="grid gap-3">
    <div class="fl-pop flex items-end justify-between px-1">
      <div>
        <div class="text-lg font-black text-slate-800 leading-tight">🎉 Fun &amp; Learn</div>
        <div class="text-xs font-bold text-slate-500">For {{ name }} · Class {{ grade }} · New fun every day!</div>
      </div>
      <div class="text-2xl fl-float">🎈</div>
    </div>

    <!-- Thought of the Day — sunrise card -->
    <div class="fl-card fl-pop relative overflow-hidden rounded-3xl p-4 shadow-md" style="background: linear-gradient(120deg, #fff7ed, #ffedd5 55%, #ffe4e6); animation-delay: .05s">
      <span class="fl-sparkle" style="top: 10px; right: 58px">✦</span>
      <span class="fl-sparkle" style="top: 34px; right: 20px; animation-delay: 1.1s">✦</span>
      <div class="flex items-start gap-3">
        <div class="fl-float text-4xl leading-none shrink-0">🌞</div>
        <div class="min-w-0">
          <div class="text-[11px] font-black tracking-widest text-orange-500">THOUGHT OF THE DAY</div>
          <p class="mt-1 text-[17px] font-extrabold text-orange-950 leading-snug">"{{ thought }}"</p>
          <p class="mt-1.5 text-xs font-bold text-orange-400">Think about it today, {{ name }}! 🌈</p>
        </div>
      </div>
    </div>

    <!-- Riddle — mystery night card -->
    <div class="fl-card fl-pop relative overflow-hidden rounded-3xl p-4 shadow-md text-white" style="background: linear-gradient(120deg, #4c1d95, #7c3aed 60%, #a855f7); animation-delay: .15s">
      <span class="fl-sparkle text-amber-300" style="top: 12px; right: 70px">✦</span>
      <span class="fl-sparkle text-amber-200" style="top: 44px; right: 26px; animation-delay: .7s">✦</span>
      <span class="fl-sparkle text-violet-200" style="bottom: 14px; right: 96px; animation-delay: 1.6s">✦</span>
      <div class="flex items-start gap-3">
        <div class="fl-wiggle text-4xl leading-none shrink-0">🧩</div>
        <div class="min-w-0 flex-1">
          <div class="text-[11px] font-black tracking-widest text-violet-200">TODAY'S RIDDLE</div>
          <p class="mt-1 text-[16px] font-bold leading-snug text-white">{{ riddle.q }}</p>
          <button v-if="!showAnswer" type="button"
            class="fl-answer-btn mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2 text-sm font-black text-amber-950 shadow transition active:scale-95"
            @click="showAnswer = true">
            👀 See the answer
          </button>
          <p v-else class="fl-answer-pop mt-3 inline-block rounded-2xl bg-white/95 px-3.5 py-2 text-[15px] font-black text-emerald-700 shadow">✅ {{ riddle.a }}</p>
        </div>
      </div>
    </div>

    <!-- Maths Challenge — bubble playground card -->
    <div class="fl-card fl-pop relative overflow-hidden rounded-3xl p-4 shadow-md" :class="picked !== null && picked !== quiz.ans ? 'fl-shake' : ''" style="background: linear-gradient(120deg, #ecfeff, #cffafe 55%, #dbeafe); animation-delay: .25s">
      <span class="fl-bubble" style="width: 54px; height: 54px; top: -18px; right: 30px"></span>
      <span class="fl-bubble" style="width: 30px; height: 30px; top: 26px; right: 84px; animation-delay: 1.3s"></span>
      <span class="fl-bubble" style="width: 20px; height: 20px; bottom: 12px; right: 16px; animation-delay: 2s"></span>
      <div class="flex items-start gap-3">
        <div class="fl-float text-4xl leading-none shrink-0">🔢</div>
        <div class="min-w-0 flex-1">
          <div class="text-[11px] font-black tracking-widest text-sky-600">MATHS CHALLENGE</div>
          <p class="mt-1 text-[22px] font-black text-slate-800 tracking-wide">{{ quiz.q }}</p>
          <div class="flex gap-2 mt-3 flex-wrap">
            <button v-for="o in quiz.options" :key="o" type="button"
              class="fl-opt px-5 py-2.5 rounded-full border-b-4 font-black text-[16px] shadow-sm transition active:scale-90"
              :class="picked === null ? 'border-sky-300 bg-white text-slate-700' : o === quiz.ans ? 'border-emerald-600 bg-emerald-400 text-white fl-correct' : picked === o ? 'border-rose-500 bg-rose-400 text-white' : 'border-slate-200 bg-white text-slate-400'"
              @click="picked = o">
              {{ o }}
            </button>
          </div>
          <p v-if="picked !== null && picked === quiz.ans" class="fl-answer-pop mt-3 font-black text-emerald-700 text-[15px]">🎉 Great job, {{ name }}! That is the right answer! ⭐</p>
          <p v-else-if="picked !== null" class="mt-3 font-bold text-rose-600 text-[15px]">Try once more — you can do it! 💪</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Phase 62 kid animations — halki, sirf CSS, koi JS cost nahi. */
@keyframes fl-pop-in {
  from { opacity: 0; transform: translateY(14px) scale(.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes fl-float-y {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50% { transform: translateY(-6px) rotate(3deg); }
}
@keyframes fl-wiggle {
  0%, 100% { transform: rotate(-6deg); }
  50% { transform: rotate(7deg) scale(1.06); }
}
@keyframes fl-twinkle {
  0%, 100% { opacity: .15; transform: scale(.7); }
  50% { opacity: .95; transform: scale(1.15); }
}
@keyframes fl-bubble-up {
  0%, 100% { transform: translateY(0); opacity: .5; }
  50% { transform: translateY(-10px); opacity: .9; }
}
@keyframes fl-answer-in {
  0% { opacity: 0; transform: scale(.6) rotate(-3deg); }
  60% { transform: scale(1.08) rotate(1deg); }
  100% { opacity: 1; transform: scale(1) rotate(0); }
}
@keyframes fl-shake-x {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
@keyframes fl-bounce-soft {
  0%, 100% { transform: scale(1); }
  40% { transform: scale(1.18); }
  70% { transform: scale(.96); }
}
.fl-pop { animation: fl-pop-in .55s cubic-bezier(.2, .9, .3, 1.2) both; }
.fl-float { animation: fl-float-y 3.2s ease-in-out infinite; }
.fl-wiggle { animation: fl-wiggle 2.4s ease-in-out infinite; }
.fl-sparkle { position: absolute; font-size: 13px; color: #fb923c; pointer-events: none; animation: fl-twinkle 2.6s ease-in-out infinite; }
.fl-bubble { position: absolute; border-radius: 9999px; background: rgba(255, 255, 255, .55); border: 2px solid rgba(255, 255, 255, .8); pointer-events: none; animation: fl-bubble-up 4s ease-in-out infinite; }
.fl-answer-pop { animation: fl-answer-in .45s cubic-bezier(.2, .9, .3, 1.3) both; }
.fl-answer-btn { animation: fl-bounce-soft 2.8s ease-in-out infinite; }
.fl-shake { animation: fl-shake-x .45s ease-in-out; }
.fl-correct { animation: fl-bounce-soft .6s ease-in-out 2; }
.fl-opt:active { transform: scale(.9); }
@media (prefers-reduced-motion: reduce) {
  .fl-pop, .fl-float, .fl-wiggle, .fl-sparkle, .fl-bubble, .fl-answer-pop, .fl-answer-btn, .fl-shake, .fl-correct { animation: none; }
}
</style>
