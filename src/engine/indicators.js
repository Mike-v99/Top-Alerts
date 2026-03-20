// src/engine/indicators.js
//
// Pure functions — no side effects, no I/O.
// All take an array of closing prices (oldest first) and return a number.

// ── Moving Average ────────────────────────────────────────────────────────────

/** Simple Moving Average over the last `period` closes. */
export function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential Moving Average. */
export function ema(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
  }
  return val;
}

// ── RSI ───────────────────────────────────────────────────────────────────────

/** Relative Strength Index (Wilder smoothing, period=14). */
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;

  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Initial averages (simple mean for first window)
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for remaining changes
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── MACD ──────────────────────────────────────────────────────────────────────

/**
 * MACD line, signal line, and histogram.
 * Standard settings: fast=12, slow=26, signal=9
 */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;

  // Build MACD line from EMA differences at each point
  const macdLine = [];
  for (let i = slow - 1; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const fastEma = ema(slice, fast);
    const slowEma = ema(slice, slow);
    if (fastEma !== null && slowEma !== null) {
      macdLine.push(fastEma - slowEma);
    }
  }

  if (macdLine.length < signal) return null;

  const signalLine = ema(macdLine, signal);
  const currentMacd = macdLine[macdLine.length - 1];

  return {
    macd:      currentMacd,
    signal:    signalLine,
    histogram: currentMacd - signalLine,
    // Cross direction (prev macd vs signal)
    bullishCross: macdLine[macdLine.length - 2] < ema(macdLine.slice(0, -1), signal)
                  && currentMacd > signalLine,
    bearishCross: macdLine[macdLine.length - 2] > ema(macdLine.slice(0, -1), signal)
                  && currentMacd < signalLine,
  };
}

// ── Bollinger Bands ───────────────────────────────────────────────────────────

/**
 * Bollinger Bands: upper, middle (SMA), lower.
 * Standard: period=20, stdDev=2
 */
export function bollingerBands(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, p) => sum + (p - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper:  middle + multiplier * std,
    middle,
    lower:  middle - multiplier * std,
    bandwidth: ((middle + multiplier * std) - (middle - multiplier * std)) / middle,
  };
}

// ── MA Crossover helpers ──────────────────────────────────────────────────────

/**
 * Returns true if the fast MA crossed above the slow MA on the last candle.
 * Requires at least (slow + 2) closes.
 */
export function crossedAbove(closes, fastPeriod, slowPeriod) {
  if (closes.length < slowPeriod + 2) return false;
  const prev  = closes.slice(0, -1);
  const prevFast = sma(prev, fastPeriod);
  const prevSlow = sma(prev, slowPeriod);
  const currFast = sma(closes, fastPeriod);
  const currSlow = sma(closes, slowPeriod);
  if (!prevFast || !prevSlow || !currFast || !currSlow) return false;
  return prevFast <= prevSlow && currFast > currSlow;
}

/** Returns true if the fast MA crossed below the slow MA on the last candle. */
export function crossedBelow(closes, fastPeriod, slowPeriod) {
  if (closes.length < slowPeriod + 2) return false;
  const prev  = closes.slice(0, -1);
  const prevFast = sma(prev, fastPeriod);
  const prevSlow = sma(prev, slowPeriod);
  const currFast = sma(closes, fastPeriod);
  const currSlow = sma(closes, slowPeriod);
  if (!prevFast || !prevSlow || !currFast || !currSlow) return false;
  return prevFast >= prevSlow && currFast < currSlow;
}

// ── Volume ────────────────────────────────────────────────────────────────────

/**
 * Returns the average volume over `period` candles.
 * volumes = array of volume numbers, oldest first.
 */
export function avgVolume(volumes, period = 20) {
  if (volumes.length < period) return null;
  const slice = volumes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}
