import express from "express";
import authRoutes from "./routes/auth.js";
import schoolRoutes from "./routes/schools.js";
import attendanceRoutes from "./routes/attendance.js";
import noticeRoutes from "./routes/notices.js";
import { errorHandler } from "./utils/http.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => res.json({ ok: true, service: "smart-school-api", phase: 2 }));

  app.use("/auth", authRoutes);
  app.use("/schools", schoolRoutes);
  app.use("/", attendanceRoutes); // /attendance/scan + /schools/:id/attendance/*
  app.use("/", noticeRoutes); // /schools/:id/notices/*

  app.use((req, res) => res.status(404).json({ error: "ROUTE_NOT_FOUND" }));
  app.use(errorHandler);
  return app;
}
