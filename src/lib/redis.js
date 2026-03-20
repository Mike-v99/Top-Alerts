// src/lib/redis.js
import { Redis } from "@upstash/redis";
import { config } from "../config/index.js";

export const redis = new Redis({
  url:   config.redis.url,
  token: config.redis.token,
});

// ── Price cache ───────────────────────────────────────────────────────────────

const PRICE_KEY   = (asset) => `price:${asset}`;
const HISTORY_KEY = (asset) => `history:${asset}`;   // last 200 closes for indicators

/** Get cached price. Returns null if stale or missing. */
export async function getCachedPrice(asset) {
  const data = await redis.get(PRICE_KEY(asset));
  return data ? JSON.parse(data) : null;
}

/** Store price with TTL. */
export async function setCachedPrice(asset, priceData) {
  await redis.setex(
    PRICE_KEY(asset),
    config.prices.cacheTtl,
    JSON.stringify(priceData)
  );
}

/** Get historical closes for indicator calculations (RSI, MA, etc). */
export async function getCachedHistory(asset) {
  const data = await redis.get(HISTORY_KEY(asset));
  return data ? JSON.parse(data) : null;
}

/** Store historical closes. TTL is longer — this data changes slowly. */
export async function setCachedHistory(asset, closes) {
  await redis.setex(HISTORY_KEY(asset), 3600, JSON.stringify(closes));
}

// ── Alert job queue ───────────────────────────────────────────────────────────

const ALERT_QUEUE = "queue:alerts";

/** Push a fired alert onto the delivery queue. */
export async function enqueueDelivery(job) {
  await redis.lpush(ALERT_QUEUE, JSON.stringify(job));
}

/** Pop the next delivery job (blocking-style via polling). Returns null if empty. */
export async function dequeueDelivery() {
  const item = await redis.rpop(ALERT_QUEUE);
  return item ? JSON.parse(item) : null;
}

/** Peek at queue depth for monitoring. */
export async function queueDepth() {
  return redis.llen(ALERT_QUEUE);
}

// ── Cooldown tracking ─────────────────────────────────────────────────────────

const COOLDOWN_KEY = (alertId) => `cooldown:${alertId}`;

/** Returns true if the alert is still in its cooldown window. */
export async function isOnCooldown(alertId) {
  const val = await redis.get(COOLDOWN_KEY(alertId));
  return val !== null;
}

/** Set cooldown for an alert after it fires. */
export async function setCooldown(alertId, cooldownMins) {
  await redis.setex(COOLDOWN_KEY(alertId), cooldownMins * 60, "1");
}
