// src/index.js — Top-Alerts backend entry point

import express        from "express";
import { config }     from "./config/index.js";
import { alertsRouter } from "./routes/alerts.js";
import { stripeRouter } from "./routes/stripe.js";
import { startEngine, stopEngine } from "./engine/alertEngine.js";
import { startDeliveryWorker, stopDeliveryWorker } from "./jobs/deliveryWorker.js";

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

// Raw body for Stripe webhook (must come before json())
app.use("/stripe/webhook", express.raw({ type: "application/json" }));

// JSON for all other routes
app.use(express.json());

// CORS
app.use((req, res, next) => {
  const allowed = [
    "http://localhost:5173",
    "https://top-alerts.com",
    "https://www.top-alerts.com",
  ];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.use("/alerts", alertsRouter);
app.use("/stripe", stripeRouter);

app.get("/health", (_, res) => res.json({
  status: "ok",
  env:    config.env,
  ts:     new Date().toISOString(),
}));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[server] Top-Alerts running on port ${config.port}`);
  startEngine();
  startDeliveryWorker();
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received — shutting down");
  stopEngine();
  stopDeliveryWorker();
  process.exit(0);
});

process.on("SIGINT", () => {
  stopEngine();
  stopDeliveryWorker();
  process.exit(0);
});
