import express from "express";
import authRoutes from "./routes/auth.js";
import schoolRoutes from "./routes/schools.js";
import attendanceRoutes from "./routes/attendance.js";
import noticeRoutes from "./routes/notices.js";
import webhookRoutes from "./routes/webhooks.js";
import pushRoutes from "./routes/push.js";
import { errorHandler } from "./utils/http.js";

export function createApp() {
  const app = express();
  // CORS for the web app (Phase 3). Origins are allow-listed via CORS_ORIGINS
  // (comma-separated); default covers local Vite dev/preview.
  const origins = (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:4173").split(",");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "authorization,content-type,x-school-id,x-device-key");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  });
  // WhatsApp webhook needs the RAW body for HMAC signature verification.
  app.use("/webhooks", express.raw({ type: "*/*", limit: "1mb" }), webhookRoutes);
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => res.json({ ok: true, service: "smart-school-api", phase: 2 }));

  app.use("/auth", authRoutes);
  app.use("/schools", schoolRoutes);
  app.use("/", attendanceRoutes); // /attendance/scan + /schools/:id/attendance/*
  app.use("/", noticeRoutes); // /schools/:id/notices/*
  app.use("/", pushRoutes); // /schools/:id/push-tokens

  app.use((req, res) => res.status(404).json({ error: "ROUTE_NOT_FOUND" }));
  app.use(errorHandler);
  return app;
}
