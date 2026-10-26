import { createRouter, createWebHistory } from "vue-router";
import { session, myRole } from "./api.js";

const routes = [
  { path: "/login", component: () => import("./views/Login.vue"), meta: { public: true } },
  { path: "/", component: () => import("./views/Dashboard.vue") },
  { path: "/people", component: () => import("./views/People.vue") },
  { path: "/attendance", component: () => import("./views/Attendance.vue") },
  { path: "/scanner", component: () => import("./views/Scanner.vue") },
  { path: "/pickup", component: () => import("./views/Pickup.vue") },
  { path: "/rollcall", component: () => import("./views/RollCall.vue") },
  { path: "/homework", component: () => import("./views/Homework.vue") },
  { path: "/leave", component: () => import("./views/Leave.vue") },
  { path: "/notices", component: () => import("./views/Notices.vue") },
  { path: "/notifications", component: () => import("./views/Notifications.vue") },
  { path: "/parent", component: () => import("./views/Parent.vue") },
  { path: "/team", component: () => import("./views/Team.vue") },
  { path: "/settings", component: () => import("./views/Settings.vue") },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  if (to.meta.public) return true;
  if (!session.accessToken) return "/login";
  const role = myRole();
  if (to.path === "/parent" && role !== "PARENT") return "/";
  if (["/people", "/settings"].includes(to.path) && !["SCHOOL_ADMIN", "PRINCIPAL", "PLATFORM_ADMIN"].includes(role)) return "/";
  if (to.path === "/rollcall" && !["SCHOOL_ADMIN", "PRINCIPAL", "TEACHER"].includes(role)) return "/";
  if (to.path === "/scanner" && role === "PARENT") return "/parent";
  return true;
});
