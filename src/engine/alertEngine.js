// src/engine/alertEngine.js
//
// The heartbeat of Top-Alerts.
//
// Every POLL_INTERVAL_MS:
//   1. Load all active alerts from Supabase
//   2. Group them by asset (batches price fetches)
//   3. Fetch current prices + history for each unique asset
//   4. Evaluate each alert's trigger condition(s)
//   5. For alerts that fire: check cooldown → enqueue delivery job → update DB

import { supabase }           from "../lib/supabase.js";
import { enqueueDelivery, isOnCooldown, setCooldown } from "../lib/redis.js";
import { getPrices, getPriceHistory } from "./priceFeed.js";
import { evaluateTrigger, evaluateMultiTrigger } from "./triggers.js";
import { config }             from "../config/index.js";

let running = false;
let pollTimer = null;

// ── Start / stop ──────────────────────────────────────────────────────────────

export function startEngine() {
  if (running) return;
  running = true;
  console.log(`[engine] Starting — poll interval ${config.engine.pollIntervalMs}ms`);
  poll(); // run immediately on start
  pollTimer = setInterval(poll, config.engine.pollIntervalMs);
}

export function stopEngine() {
  if (!running) return;
  running = false;
  clearInterval(pollTimer);
  console.log("[engine] Stopped");
}

// ── Main poll cycle ───────────────────────────────────────────────────────────

async function poll() {
  const cycleStart = Date.now();
  console.log(`[engine] Poll cycle started`);

  try {
    // 1. Load all active alerts
    const { data: alerts, error } = await supabase
      .from("alerts")
      .select("*, profiles!inner(plan)")
      .eq("status", "active");

    if (error) throw error;
    if (!alerts || alerts.length === 0) {
      console.log("[engine] No active alerts");
      return;
    }

    console.log(`[engine] Evaluating ${alerts.length} active alerts`);

    // 2. Group by asset — deduplicate price fetches
    const assetSet = new Set(alerts.map((a) => a.asset));
    const assets   = [...assetSet];

    // 3. Fetch prices + history concurrently
    const [priceMap, historyMap] = await Promise.all([
      getPrices(assets),
      fetchHistoriesForAssets(assets),
    ]);

    // 4 & 5. Evaluate each alert
    const results = await Promise.allSettled(
      alerts.map((alert) =>
        evaluateAlert(alert, priceMap.get(alert.asset), historyMap.get(alert.asset))
      )
    );

    const fired    = results.filter((r) => r.status === "fulfilled" && r.value?.fired).length;
    const duration = Date.now() - cycleStart;
    console.log(`[engine] Cycle complete — ${fired} fired, ${duration}ms`);

  } catch (err) {
    console.error("[engine] Poll cycle error:", err.message);
  }
}

// ── Per-alert evaluation ──────────────────────────────────────────────────────

async function evaluateAlert(alert, priceData, history) {
  if (!priceData) {
    console.warn(`[engine] No price data for ${alert.asset} — skipping alert ${alert.id}`);
    return { fired: false };
  }

  // Evaluate trigger(s)
  const result = alert.is_multi
    ? evaluateMultiTrigger({ alert, priceData, history })
    : evaluateTrigger({ alert, priceData, history });

  if (!result.fired) return { fired: false };

  // Check cooldown — prevents alert spam
  const onCooldown = await isOnCooldown(alert.id);
  if (onCooldown) {
    console.log(`[engine] Alert ${alert.id} on cooldown — skipping`);
    return { fired: false };
  }

  console.log(`[engine] 🔔 Alert FIRED: ${alert.id} (${alert.asset} ${alert.trigger_type}) — ${result.reason}`);

  // Enqueue delivery job (handled by separate worker)
  await enqueueDelivery({
    alertId:     alert.id,
    userId:      alert.user_id,
    asset:       alert.asset,
    triggerType: alert.trigger_type,
    reason:      result.reason,
    price:       priceData.price,
    delivery:    alert.delivery,
    webhookUrl:  alert.webhook_url,
    firedAt:     new Date().toISOString(),
  });

  // Set cooldown
  await setCooldown(alert.id, alert.cooldown_mins);

  // Update alert state in DB (non-blocking — fire and forget)
  updateAlertFired(alert.id, priceData.price).catch(console.error);

  return { fired: true, reason: result.reason };
}

async function updateAlertFired(alertId, price) {
  const now = new Date().toISOString();
  await supabase
    .from("alerts")
    .update({
      last_fired_at: now,
      fire_count:    supabase.rpc("increment", { x: 1 }), // see below
      updated_at:    now,
    })
    .eq("id", alertId);

  // Insert history record
  await supabase.from("alert_history").insert({
    alert_id:     alertId,
    price_at_fire: price,
  });
}

// ── History fetcher ───────────────────────────────────────────────────────────

async function fetchHistoriesForAssets(assets) {
  const historyMap = new Map();
  await Promise.allSettled(
    assets.map(async (asset) => {
      try {
        const closes = await getPriceHistory(asset, 200);
        historyMap.set(asset, { closes });
      } catch (err) {
        console.warn(`[engine] History fetch failed for ${asset}:`, err.message);
        historyMap.set(asset, { closes: [] });
      }
    })
  );
  return historyMap;
}
