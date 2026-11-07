<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { session } from "../api.js";

// Phase 39: teen public legal/trust pages — bina login ke khulte
// hain (Play Store / App Store rules + parents ka bharosa).
// /privacy = Privacy Policy, /terms = Terms of Service,
// /safety = Safety & Security. Content jaan-boojh kar simple
// English me hai taaki har parent aasani se samajh sake.
const route = useRoute();
const page = computed(() => route.meta.legal || "privacy");
const UPDATED = "7 November 2026";
const TITLES = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  safety: "Safety & Security",
};
</script>

<template>
  <div class="min-h-dvh bg-slate-50 safe-t safe-b">
    <header class="bg-gradient-to-r from-[#0a2436] to-[#07332a] text-white">
      <div class="max-w-3xl mx-auto px-4 py-5 flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="Smart School" class="w-11 h-11 rounded-xl shadow" />
        <div>
          <div class="font-extrabold text-lg leading-tight">Smart School</div>
          <div class="text-xs text-white/60">Attendance & Communication</div>
        </div>
        <router-link v-if="session.accessToken" to="/" class="ml-auto btn !py-2 !px-3 text-sm bg-white/10 text-white hover:bg-white/20">← Back to app</router-link>
        <router-link v-else to="/login" class="ml-auto btn !py-2 !px-3 text-sm bg-white/10 text-white hover:bg-white/20">Login →</router-link>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-4 py-6">
      <div class="flex flex-wrap gap-2 mb-5">
        <router-link to="/privacy" class="btn !py-2 text-sm" :class="page === 'privacy' ? 'btn-primary' : 'btn-ghost'">Privacy Policy</router-link>
        <router-link to="/terms" class="btn !py-2 text-sm" :class="page === 'terms' ? 'btn-primary' : 'btn-ghost'">Terms of Service</router-link>
        <router-link to="/safety" class="btn !py-2 text-sm" :class="page === 'safety' ? 'btn-primary' : 'btn-ghost'">Safety & Security</router-link>
      </div>

      <article class="card !p-6 md:!p-8 legal">
        <h1 class="text-2xl font-extrabold mb-1">{{ TITLES[page] }}</h1>
        <p class="text-xs text-slate-400 mb-6">Last updated: {{ UPDATED }} · For the Smart School app and website (smart-school-tawny.vercel.app)</p>

        <!-- ================= PRIVACY POLICY ================= -->
        <template v-if="page === 'privacy'">
          <h2>1. Who we are</h2>
          <p>Smart School is a school attendance and communication service provided by TheDigitalWork (thedigitalwork.in). Schools use Smart School to record attendance, send notices, and keep parents informed. Your child's school decides what information is entered into the app — we provide the technology and keep it safe.</p>

          <h2>2. What information we collect</h2>
          <p><b>Student information (entered by the school):</b> name, admission number, class and section, roll number, date of birth, gender, a photo if the school adds one, father's and mother's names, and home address.</p>
          <p><b>Parent / guardian information:</b> name, mobile number, email address, and relationship with the child.</p>
          <p><b>School records created during daily use:</b> gate entry and exit scans, attendance, leave requests, homework, exam results, fee records and receipts created by the school, notices, and pickup records.</p>
          <p><b>Account information:</b> your login ID and password. Passwords are stored in a protected (hashed) form — we never store your plain password. If you use the app on a phone, basic device information may be stored so the app can send you notifications.</p>
          <p><b>Camera:</b> the camera is used only inside the app by school staff to scan student ID cards at the gate. We do not access your photos or camera in the background.</p>

          <h2>3. How we use this information</h2>
          <ul>
            <li>To show parents their child's attendance, entry/exit alerts, homework, notices, exam results and fee records.</li>
            <li>To help the school run daily attendance, gate safety and authorised pickup.</li>
            <li>To operate, secure and improve the service.</li>
          </ul>
          <p>We do <b>not</b> use children's or parents' information for advertising, and we do <b>not</b> sell personal information to anyone.</p>

          <h2>4. Who can see the information</h2>
          <ul>
            <li><b>Parents</b> can see only their own children's information.</li>
            <li><b>Teachers and school staff</b> can see the information they need for their work, as permitted by the school.</li>
            <li><b>Your school's data stays separate</b> — no other school can see it.</li>
            <li><b>Service providers</b> who run our servers (hosting and database) can process data only to operate this service.</li>
            <li>We may share information if the law requires it.</li>
          </ul>

          <h2>5. Children's privacy</h2>
          <p>Children do not create accounts on Smart School. A child's information is entered and controlled by their school, and parents are linked to their own children by the school. If you believe any information about your child is wrong, please contact your school office — the school can correct or remove it, and so can we on the school's instruction.</p>

          <h2>6. How long we keep information</h2>
          <p>Information is kept while your child is enrolled and the school uses Smart School. When a school stops using the service, or asks us to delete its data, we remove the school's data within a reasonable time, except where the law requires us to keep a record.</p>

          <h2>7. Your rights</h2>
          <p>You can ask your school to show you, correct, or delete your or your child's information. You can also contact us through the <b>Support</b> option inside the app, and we will take your request to the school and help resolve it.</p>

          <h2>8. Security</h2>
          <p>We protect information with login-based access, encrypted connections, and hashed passwords and ID-card codes. Read our <router-link to="/safety" class="underline font-semibold">Safety & Security</router-link> page for a simple explanation.</p>

          <h2>9. Changes to this policy</h2>
          <p>If we change this policy, we will update the date at the top of this page. Important changes will also be announced in the app.</p>

          <h2>10. Contact us</h2>
          <p>For any privacy question: contact your school office, use the Support option inside the app, or reach the platform team through <b>thedigitalwork.in</b>.</p>
        </template>

        <!-- ================= TERMS OF SERVICE ================= -->
        <template v-else-if="page === 'terms'">
          <h2>1. The service</h2>
          <p>Smart School is an attendance and communication service for schools, provided by TheDigitalWork (thedigitalwork.in). Schools use it to manage students, attendance, notices, fees records, exams and parent communication. By using Smart School — as a school, teacher, staff member or parent — you agree to these Terms.</p>

          <h2>2. Accounts</h2>
          <ul>
            <li>Login accounts are created by your school (or by the platform team for the school). Keep your password private — you are responsible for activity on your account.</li>
            <li>Tell your school office immediately if you think someone else has used your account.</li>
            <li>The school is responsible for keeping student, parent and staff information accurate and up to date.</li>
          </ul>

          <h2>3. Fees, payments and refunds — please read carefully</h2>
          <p>Smart School only <b>records and displays</b> fee information that the school creates — fee amounts, invoices and receipts.</p>
          <ul>
            <li>All fee amounts are decided by the <b>school</b>, never by Smart School.</li>
            <li>Any payment you make is made <b>to the school</b> (in cash, or through any payment channel the school itself chooses). Payments are never made to Smart School.</li>
            <li><b>Refunds, waivers, discounts and payment disputes are the school's sole responsibility.</b> For any refund or payment question, please contact your school office.</li>
            <li>Receipts shown in the app are generated from the school's own records.</li>
          </ul>

          <h2>4. Attendance and school records</h2>
          <p>Attendance, entry/exit logs and other records are created from ID-card scans and entries made by school staff. If you think a record is wrong, contact your school — only the school can correct its records, using the correction process in the app.</p>

          <h2>5. Acceptable use</h2>
          <ul>
            <li>Use the service only for your own school-related work or your own children's information.</li>
            <li>Do not try to see another person's or another school's information.</li>
            <li>Do not misuse, disrupt, or attempt to break the security of the service.</li>
          </ul>

          <h2>6. Service availability</h2>
          <p>We work to keep Smart School running smoothly, but we do not promise the service will be available at every moment without interruption. Features may be improved or changed over time.</p>

          <h2>7. Suspension</h2>
          <p>The school, or the platform team for security reasons, may suspend an account that is misused or puts children's information at risk.</p>

          <h2>8. Limitation of liability</h2>
          <p>To the extent permitted by law, Smart School and TheDigitalWork are not responsible for losses arising from incorrect information entered by a school, payments made to a school, or decisions a school takes using its records.</p>

          <h2>9. Changes to these Terms</h2>
          <p>If we change these Terms, we will update the date at the top of this page. Continuing to use the service after a change means you accept the updated Terms.</p>

          <h2>10. Governing law</h2>
          <p>These Terms are governed by the laws of India. Also see our <router-link to="/privacy" class="underline font-semibold">Privacy Policy</router-link>.</p>
        </template>

        <!-- ================= SAFETY & SECURITY ================= -->
        <template v-else>
          <p class="lead">Your child's safety is the first job of Smart School. This page explains, in simple words, how we protect your child and your information.</p>

          <h2>🛡️ Gate safety — know when your child reaches and leaves</h2>
          <p>Your child carries a school ID card. When the card is scanned at the school gate, the scan is recorded and an alert is sent to the parents in the app. You can see when your child entered and left the school.</p>

          <h2>🙋 Authorised pickup only</h2>
          <p>A child is handed over only to persons approved by the parents and the school. Pickup approvals are recorded in the app, so the school can check who is allowed to take your child home.</p>

          <h2>👨‍👩‍👧 Only you can see your child</h2>
          <ul>
            <li>Your parent login is linked only to <b>your own children</b>. You cannot see any other child, and no other parent can see yours.</li>
            <li>Teachers see only their own classes. School staff see only what their job needs.</li>
            <li>Every school's data is kept completely separate — one school can never see another school's children.</li>
          </ul>

          <h2>🔐 How your account is protected</h2>
          <ul>
            <li>Passwords are stored in a protected (hashed) form — nobody, including our team, can read your password.</li>
            <li>Everything you send or receive in the app travels over an encrypted (secure) connection.</li>
            <li>If a password is shared or lost, the school can reset it and sign out old sessions immediately.</li>
          </ul>

          <h2>▣ ID cards are safe to carry</h2>
          <p>The QR code on the ID card contains only a random code. It does <b>not</b> contain your child's name, photo, address, or any personal detail. If a card is lost, the school can cancel that card in one step and issue a new one — the old card then stops working.</p>

          <h2>🚫 No ads, no selling data</h2>
          <p>We never sell children's or parents' information, and there is no advertising in Smart School.</p>

          <h2>✅ What parents should do</h2>
          <ul>
            <li>Keep your login password private — do not share it with anyone.</li>
            <li>Tell the school office at once if your ID card is lost, your mobile number changes, or a pickup person changes.</li>
            <li>If you ever get an alert that looks wrong, contact the school office immediately.</li>
          </ul>

          <h2>📣 Report a concern</h2>
          <p>Contact your school office, or use the <b>Support</b> option inside the app. Safety concerns are treated as urgent. Also read our <router-link to="/privacy" class="underline font-semibold">Privacy Policy</router-link>.</p>
        </template>
      </article>

      <p class="text-center text-xs text-slate-400 mt-6">Smart School · Attendance & Communication · Provided by TheDigitalWork</p>
    </main>
  </div>
</template>

<style scoped>
.legal h2 { font-weight: 700; font-size: 1.05rem; margin: 1.4rem 0 0.45rem; }
.legal h2:first-of-type { margin-top: 0.5rem; }
.legal p { font-size: 0.925rem; line-height: 1.65; color: #334155; margin-bottom: 0.55rem; }
.legal ul { list-style: disc; padding-left: 1.25rem; margin-bottom: 0.6rem; }
.legal li { font-size: 0.925rem; line-height: 1.65; color: #334155; margin-bottom: 0.25rem; }
.legal .lead { font-size: 1rem; }
</style>
