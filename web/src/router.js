import { createRouter, createWebHistory } from "vue-router";
import { session, myRole } from "./api.js";

const routes = [
  { path: "/login", component: () => import("./views/Login.vue"), meta: { public: true } },
  { path: "/login/parent", component: () => import("./views/Login.vue"), meta: { public: true, variant: "parent" } },
  { path: "/login/teacher", component: () => import("./views/Login.vue"), meta: { public: true, variant: "teacher" } },
  { path: "/login/school", component: () => import("./views/Login.vue"), meta: { public: true, variant: "school" } },
  { path: "/login/admin", component: () => import("./views/Login.vue"), meta: { public: true, variant: "admin" } },
  { path: "/login/staff", redirect: "/login/school", meta: { public: true } },
  { path: "/", component: () => import("./views/Dashboard.vue") },
  { path: "/people", component: () => import("./views/People.vue") },
  { path: "/attendance", component: () => import("./views/Attendance.vue") },
  { path: "/scanner", component: () => import("./views/Scanner.vue") },
  { path: "/pickup", component: () => import("./views/Pickup.vue") },
  { path: "/rollcall", component: () => import("./views/RollCall.vue") },
  { path: "/homework", component: () => import("./views/Homework.vue") },
  { path: "/leave", component: () => import("./views/Leave.vue") },
  { path: "/fees", component: () => import("./views/Fees.vue") },
  { path: "/timetable", component: () => import("./views/Timetable.vue") },
  { path: "/exams", component: () => import("./views/Exams.vue") },
  { path: "/data", component: () => import("./views/ImportExport.vue") },
  { path: "/support", component: () => import("./views/Support.vue") },
  { path: "/console", component: () => import("./views/Console.vue") },
  { path: "/notices", component: () => import("./views/Notices.vue") },
  { path: "/notifications", component: () => import("./views/Notifications.vue") },
  { path: "/parent", component: () => import("./views/Parent.vue") },
  { path: "/team", component: () => import("./views/Team.vue") },
  { path: "/settings", component: () => import("./views/Settings.vue") },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  if (to.meta.public) {
    // Login pages ALWAYS render their own form — even with a live
    // session (26 Oct correction, overriding the Phase 22 redirect):
    // the separate login links are the backbone of the future
    // per-role apps, so opening any /login page must
    // show that page. Login.vue handles the signed-in case in-page
    // with a "you are logged in" banner (dashboard / logout actions)
    // and replaces the session only on a successful sign-in.
    return true;
  }
  if (!session.accessToken) return "/login";
  const role = myRole();
  // The console is the platform owner's alone — every other role is
  // bounced to its own home, the page is never even rendered for them.
  if (to.path === "/console" && role !== "PLATFORM_ADMIN") return role === "PARENT" ? "/parent" : "/";
  if (to.path === "/parent" && role !== "PARENT") return "/";
  if (["/people", "/settings"].includes(to.path) && !["SCHOOL_ADMIN", "PRINCIPAL", "PLATFORM_ADMIN"].includes(role)) return "/";
  if (to.path === "/rollcall" && !["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"].includes(role)) return "/";
  if (to.path === "/scanner" && role === "PARENT") return "/parent";
  return true;
});
