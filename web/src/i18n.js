// i18n foundation (Phase 33, 2 Nov 2026).
// The product UI is ENGLISH. Regional languages plug in here:
// add a new block to `messages` (same keys, translated values) and
// it automatically appears in the language selector in the sidebar.
// The selected language is kept per device in localStorage.
// Strings migrate to t("...") keys gradually — new UI text should
// always go through t(). See docs/I18N.md.
import { ref } from "vue";

export const messages = {
  en: {
    "common.received": "Received",
    "common.balance": "Balance",
    "console.searchSchool": "🔍 Search schools — type a name or slug…",
    "console.openSchool": "🏫 Open school",
    "console.close": "Close",
    "console.hisabPending": "💰 Charges are not set up yet — run \"Database Update\" above.",
    "console.tabCharges": "💰 Charges",
    "console.dbHint": "Pending database changes apply in one click — no need to open Supabase.",
    "console.dbRun": "▶ Run pending DB update",
    "console.dbRunning": "Updating…",
    "console.dbDone": "✅ All updates applied",
    "console.dbPartial": "⚠️ Some updates did not apply — see below",
    "console.dbDoneMsg": "Database updated — everything should work now.",
    "console.dbPendingFirst": "Run the Database Update first (card above).",
    "console.testHint": "One click shows which logins work, which do not, and why.",
    "console.runTest": "▶ Run full test",
    "console.testing": "Testing…",
    "console.result": "Result",
    "console.tryDemo": "Want to see it yourself? One-tap demo login:",
    "console.tryDemoHint": "Tapping a button opens that demo account in this tab. Your owner account stays signed in on this device — open it in another tab or sign in again here. There is no account switcher in the app.",
    "console.viewAsParent": "👨‍👧 View as Parent",
    "console.viewAsTeacher": "👩‍🏫 View as Teacher",
    "console.viewAsPrincipal": "🎓 View as Principal",
    "console.viewAsSchoolAdmin": "🏫 View as School Admin",
    "console.stuSearch": "🔍 Search students — name / admission no / class",
    "console.showRemoved": "Show removed",
    "console.addStudent": "➕ Add a new student",
    "console.editStudent": "✏️ Edit student",
    "console.classNone": "Class — none",
    "console.guardianName": "Guardian name (parent)",
    "console.classNamePh": "New class — e.g. 6",
    "console.addClass": "➕ Add class",
    "console.loadingStudents": "Loading students…",
    "console.noStudents": "No students found.",
    "console.stuSaved": "Student added.",
    "console.stuUpdated": "Student updated.",
    "console.stuSaveFailed": "Could not save the student",
    "console.admissionTaken": "That admission number is already used — try another.",
    "console.stuRemoved": "removed.",
    "console.removeFailed": "Could not remove",
    "console.confirmRemoveStudent": "Remove this student? The record stays, it just becomes inactive — out of counts and charges.",
    "console.classAdded": "Class added.",
    "console.classAddFailed": "Could not add the class",
    "console.studentsLoadFailed": "Could not load students",
    "console.hisabLoading": "Loading charges…",
    "console.hisabSetup": "Charges need the database update first — run the \"🛠 Database Update\" card above, then come back.",
    "console.totalCharge": "Total charge",
    "console.rateLabel": "Per-student rate ₹",
    "console.saveRate": "Save rate",
    "console.rateSaved": "Rate saved.",
    "console.rateSaveFailed": "Could not save the rate",
    "console.addPaymentTitle": "💵 Add a received payment",
    "console.notePh": "Note — e.g. cash, UPI, cheque",
    "console.addPaymentBtn": "Add payment",
    "console.payAdded": "Payment added.",
    "console.payFailed": "Could not add the payment",
    "console.noPayments": "No payments recorded yet.",
    "console.confirmDeletePayment": "Delete this payment",
    "console.deleteFailed": "Could not delete",
    "console.hisabLoadFailed": "Could not load charges",
    "dashboard.classesSections": "🏫 Classes & Sections",
    "dashboard.teachersWho": "🧑‍🏫 Teachers — who does what",
    "dashboard.classrooms": "classrooms",
    "dashboard.classesWord": "classes",
    "dashboard.sections": "sections",
    "dashboard.section": "Section",
    "dashboard.noSection": "No section",
    "dashboard.students": "students",
    "dashboard.incharge": "Incharge",
    "dashboard.noIncharge": "No incharge set",
    "dashboard.noTeacherAssigned": "No teacher assigned to this section yet",
    "dashboard.noClassesYet": "No classes yet — add your first class from Settings.",
    "dashboard.noTeachersYet": "No teachers yet — add teachers from Team & Access.",
    "dashboard.teacherNoWork": "No class or subject assigned yet — assign from Students & Staff → Teachers.",
    "dashboard.searchTitle": "🔎 Search students & teachers",
    "dashboard.searchPh": "Student name, admission no, parent mobile, or teacher name…",
    "dashboard.noResults": "No match found in this school.",
    "dashboard.viewStudents": "View students →",
    "dashboard.tapHint": "Tap any section to see its students with their parents. Tap a teacher to open their details.",
  },
  // Add regional languages here, e.g.:
  // hi: { "common.received": "...", ... },
};

export const availableLangs = Object.keys(messages).map((code) => ({
  code,
  label: { en: "English", hi: "हिन्दी", ur: "اردو" }[code] || code,
}));

export const lang = ref(localStorage.getItem("ss_lang") || "en");
if (!messages[lang.value]) lang.value = "en";

export function setLang(code) {
  if (!messages[code]) return;
  lang.value = code;
  localStorage.setItem("ss_lang", code);
}

export function t(key) {
  return messages[lang.value]?.[key] || messages.en[key] || key;
}
