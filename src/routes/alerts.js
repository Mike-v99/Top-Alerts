// src/routes/alerts.js
//
// REST API for creating, reading, updating, and deleting alerts.
// All routes require a valid Supabase JWT — middleware verifies it.

import { Router }   from "express";
import { supabase } from "../lib/supabase.js";

export const alertsRouter = Router();

// Plan limits
const PLAN_LIMITS = { free: 3, pro: Infinity, team: Infinity };

// ── Middleware: verify JWT ────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing token" });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid token" });

  req.user = user;
  next();
}

alertsRouter.use(requireAuth);

// ── GET /alerts ───────────────────────────────────────────────────────────────

alertsRouter.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("user_id", req.user.id)
    .neq("status", "deleted")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ alerts: data });
});

// ── POST /alerts ──────────────────────────────────────────────────────────────

alertsRouter.post("/", async (req, res) => {
  const {
    asset, asset_type, trigger_type, trigger_value,
    is_multi, conditions, delivery, webhook_url, cooldown_mins,
  } = req.body;

  // Basic validation
  if (!asset || !trigger_type) {
    return res.status(400).json({ error: "asset and trigger_type are required" });
  }

  // Load user profile for plan check
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, alert_count")
    .eq("id", req.user.id)
    .single();

  if (!profile) return res.status(404).json({ error: "Profile not found" });

  // Enforce free plan limit
  const limit = PLAN_LIMITS[profile.plan] ?? 3;
  if (profile.alert_count >= limit) {
    return res.status(403).json({
      error: `Free plan limit reached (${limit} alerts). Upgrade to Pro for unlimited alerts.`,
      upgrade: true,
    });
  }

  // Pro-only trigger types
  const PRO_TRIGGERS = [
    "ma_cross_above","ma_cross_below","golden_cross","death_cross",
    "rsi_overbought","rsi_oversold","macd_cross","bb_breakout","volume_surge",
  ];
  if (PRO_TRIGGERS.includes(trigger_type) && profile.plan === "free") {
    return res.status(403).json({
      error: "This trigger type requires a Pro plan.",
      upgrade: true,
    });
  }

  if (is_multi && profile.plan === "free") {
    return res.status(403).json({
      error: "Multi-condition alerts require a Pro plan.",
      upgrade: true,
    });
  }

  // Create alert
  const { data: alert, error } = await supabase
    .from("alerts")
    .insert({
      user_id:       req.user.id,
      asset:         asset.toUpperCase(),
      asset_type:    asset_type || "stock",
      trigger_type,
      trigger_value: trigger_value || {},
      is_multi:      is_multi || false,
      conditions:    conditions || null,
      delivery:      delivery || ["push"],
      webhook_url:   webhook_url || null,
      cooldown_mins: cooldown_mins || 60,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Increment alert count on profile
  await supabase.rpc("increment_alert_count", { user_id: req.user.id });

  res.status(201).json({ alert });
});

// ── PATCH /alerts/:id ─────────────────────────────────────────────────────────

alertsRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Prevent changing user_id
  delete updates.user_id;
  delete updates.id;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("alerts")
    .update(updates)
    .eq("id", id)
    .eq("user_id", req.user.id)  // RLS-style check
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: "Alert not found" });
  res.json({ alert: data });
});

// ── DELETE /alerts/:id ────────────────────────────────────────────────────────

alertsRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;

  // Soft delete
  const { error } = await supabase
    .from("alerts")
    .update({ status: "deleted", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", req.user.id);

  if (error) return res.status(500).json({ error: error.message });

  await supabase.rpc("decrement_alert_count", { user_id: req.user.id });
  res.json({ success: true });
});

// ── GET /alerts/history ───────────────────────────────────────────────────────

alertsRouter.get("/history", async (req, res) => {
  const { data, error } = await supabase
    .from("alert_history")
    .select("*")
    .eq("user_id", req.user.id)
    .order("fired_at", { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ history: data });
});
