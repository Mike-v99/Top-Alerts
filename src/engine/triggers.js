// src/engine/triggers.js
//
// Each trigger function receives:
//   { alert, priceData, history }
// and returns:
//   { fired: boolean, reason: string }

import {
  sma, rsi, macd, bollingerBands, crossedAbove, crossedBelow,
} from "./indicators.js";

// ── Trigger registry ──────────────────────────────────────────────────────────

export const TRIGGER_TYPES = {
  // Free
  price_above:    evalPriceAbove,
  price_below:    evalPriceBelow,
  pct_change:     evalPctChange,
  // Pro
  ma_cross_above: evalMaCrossAbove,
  ma_cross_below: evalMaCrossBelow,
  golden_cross:   evalGoldenCross,
  death_cross:    evalDeathCross,
  rsi_overbought: evalRsiOverbought,
  rsi_oversold:   evalRsiOversold,
  macd_cross:     evalMacdCross,
  bb_breakout:    evalBBBreakout,
  volume_surge:   evalVolumeSurge,
};

/**
 * Main entry point.
 * Evaluates a single alert and returns { fired, reason }.
 */
export function evaluateTrigger({ alert, priceData, history }) {
  const fn = TRIGGER_TYPES[alert.trigger_type];
  if (!fn) return { fired: false, reason: `Unknown trigger: ${alert.trigger_type}` };

  try {
    return fn({ alert, priceData, history });
  } catch (err) {
    return { fired: false, reason: `Error: ${err.message}` };
  }
}

/**
 * Evaluates a multi-condition alert (Pro).
 * Conditions use AND / OR logic per condition's `op` field.
 * First condition has no op (it's the base).
 */
export function evaluateMultiTrigger({ alert, priceData, history }) {
  const conditions = alert.conditions;
  if (!conditions || conditions.length === 0) return { fired: false, reason: "No conditions" };

  // Evaluate each condition independently
  const results = conditions.map((cond) =>
    evaluateTrigger({
      alert: { ...alert, trigger_type: cond.trigger_type, trigger_value: cond.trigger_value },
      priceData,
      history,
    })
  );

  // Apply AND/OR logic left-to-right
  let result = results[0].fired;
  for (let i = 1; i < conditions.length; i++) {
    const op = conditions[i].op?.toUpperCase() || "AND";
    if (op === "AND") result = result && results[i].fired;
    else if (op === "OR") result = result || results[i].fired;
  }

  const reasons = results.map((r, i) => `[${i}] ${r.reason}`).join(" | ");
  return { fired: result, reason: reasons };
}

// ── Free triggers ─────────────────────────────────────────────────────────────

function evalPriceAbove({ alert, priceData }) {
  const target = parseFloat(alert.trigger_value.price);
  const current = priceData.price;
  const fired = current >= target;
  return {
    fired,
    reason: `Price ${current} ${fired ? ">=" : "<"} target ${target}`,
  };
}

function evalPriceBelow({ alert, priceData }) {
  const target = parseFloat(alert.trigger_value.price);
  const current = priceData.price;
  const fired = current <= target;
  return {
    fired,
    reason: `Price ${current} ${fired ? "<=" : ">"} target ${target}`,
  };
}

function evalPctChange({ alert, priceData }) {
  const threshold = parseFloat(alert.trigger_value.percent);
  const pctChange = Math.abs(priceData.changePct);
  const fired = pctChange >= threshold;
  return {
    fired,
    reason: `|Change| ${pctChange.toFixed(2)}% ${fired ? ">=" : "<"} threshold ${threshold}%`,
  };
}

// ── Pro triggers ──────────────────────────────────────────────────────────────

function evalMaCrossAbove({ alert, priceData, history }) {
  const period = parseInt(alert.trigger_value.ma_period || 50);
  const closes = [...(history?.closes || []), priceData.price];
  const maCurrent = sma(closes, period);
  const maPrev    = sma(closes.slice(0, -1), period);
  if (!maCurrent || !maPrev) return { fired: false, reason: "Insufficient history" };

  const prevPrice = closes[closes.length - 2];
  const fired = prevPrice < maPrev && priceData.price >= maCurrent;
  return {
    fired,
    reason: `Price crossed ${fired ? "↑" : "–"} ${period}MA @ ${maCurrent?.toFixed(2)}`,
  };
}

function evalMaCrossBelow({ alert, priceData, history }) {
  const period = parseInt(alert.trigger_value.ma_period || 50);
  const closes = [...(history?.closes || []), priceData.price];
  const maCurrent = sma(closes, period);
  const maPrev    = sma(closes.slice(0, -1), period);
  if (!maCurrent || !maPrev) return { fired: false, reason: "Insufficient history" };

  const prevPrice = closes[closes.length - 2];
  const fired = prevPrice > maPrev && priceData.price <= maCurrent;
  return {
    fired,
    reason: `Price crossed ${fired ? "↓" : "–"} ${period}MA @ ${maCurrent?.toFixed(2)}`,
  };
}

function evalGoldenCross({ priceData, history }) {
  const closes = [...(history?.closes || []), priceData.price];
  const fired = crossedAbove(closes, 50, 200);
  return { fired, reason: fired ? "50MA crossed above 200MA (Golden Cross)" : "No golden cross" };
}

function evalDeathCross({ priceData, history }) {
  const closes = [...(history?.closes || []), priceData.price];
  const fired = crossedBelow(closes, 50, 200);
  return { fired, reason: fired ? "50MA crossed below 200MA (Death Cross)" : "No death cross" };
}

function evalRsiOverbought({ alert, priceData, history }) {
  const threshold = parseFloat(alert.trigger_value.threshold || 70);
  const closes = [...(history?.closes || []), priceData.price];
  const rsiVal = rsi(closes);
  if (rsiVal === null) return { fired: false, reason: "Insufficient history for RSI" };
  const fired = rsiVal >= threshold;
  return {
    fired,
    reason: `RSI ${rsiVal.toFixed(1)} ${fired ? ">=" : "<"} ${threshold}`,
  };
}

function evalRsiOversold({ alert, priceData, history }) {
  const threshold = parseFloat(alert.trigger_value.threshold || 30);
  const closes = [...(history?.closes || []), priceData.price];
  const rsiVal = rsi(closes);
  if (rsiVal === null) return { fired: false, reason: "Insufficient history for RSI" };
  const fired = rsiVal <= threshold;
  return {
    fired,
    reason: `RSI ${rsiVal.toFixed(1)} ${fired ? "<=" : ">"} ${threshold}`,
  };
}

function evalMacdCross({ alert, priceData, history }) {
  const closes = [...(history?.closes || []), priceData.price];
  const result = macd(closes);
  if (!result) return { fired: false, reason: "Insufficient history for MACD" };

  const direction = alert.trigger_value.direction || "bullish";
  const fired = direction === "bullish" ? result.bullishCross : result.bearishCross;
  return {
    fired,
    reason: `MACD ${fired ? direction + " cross ✓" : "no cross"} (macd: ${result.macd?.toFixed(4)}, signal: ${result.signal?.toFixed(4)})`,
  };
}

function evalBBBreakout({ alert, priceData, history }) {
  const closes = [...(history?.closes || []), priceData.price];
  const bands = bollingerBands(closes);
  if (!bands) return { fired: false, reason: "Insufficient history for Bollinger Bands" };

  const band = alert.trigger_value.band || "upper";  // 'upper' | 'lower'
  const fired = band === "upper"
    ? priceData.price >= bands.upper
    : priceData.price <= bands.lower;

  return {
    fired,
    reason: `Price ${priceData.price} ${fired ? "outside" : "inside"} ${band} band (${band === "upper" ? bands.upper.toFixed(2) : bands.lower.toFixed(2)})`,
  };
}

function evalVolumeSurge({ alert, priceData, history }) {
  const multiplier = parseFloat(alert.trigger_value.volume_multiplier || 3);
  if (!priceData.volume || !history?.volumes?.length) {
    return { fired: false, reason: "No volume data available" };
  }
  const avg = history.volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const fired = priceData.volume >= avg * multiplier;
  return {
    fired,
    reason: `Volume ${priceData.volume.toLocaleString()} ${fired ? ">=" : "<"} ${multiplier}× avg (${Math.round(avg).toLocaleString()})`,
  };
}
