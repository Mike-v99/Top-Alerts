// src/engine/priceFeed.js
//
// Abstracts over multiple data sources:
//   • Finnhub  → stocks, ETFs, commodities (free: 60 req/min)
//   • Twelve Data → crypto + stocks (free: 800 req/day, 8 req/min)
//
// All prices are cached in Redis for PRICE_CACHE_TTL_SECONDS to avoid
// hammering rate limits when many alerts share the same asset.

import axios from "axios";
import { config } from "../config/index.js";
import {
  getCachedPrice,
  setCachedPrice,
  getCachedHistory,
  setCachedHistory,
} from "../lib/redis.js";

// Assets routed to each provider
const CRYPTO_ASSETS  = new Set(["BTC/USD","ETH/USD","SOL/USD","BNB/USD","XRP/USD"]);
const STOCK_ASSETS   = new Set(["AAPL","TSLA","SPY","QQQ","MSFT","GOOGL","AMZN","NVDA"]);
const COMMODITY_ASSETS = new Set(["GOLD","SILVER","OIL"]);

// Commodity symbol map for Finnhub
const COMMODITY_MAP = { GOLD: "XAUUSD", SILVER: "XAGUSD", OIL: "USOIL" };

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the latest price for an asset.
 * Returns { asset, price, change, changePct, volume, timestamp }
 */
export async function getPrice(asset) {
  // 1. Check Redis cache first
  const cached = await getCachedPrice(asset);
  if (cached) return cached;

  // 2. Fetch from appropriate provider
  let priceData;
  if (CRYPTO_ASSETS.has(asset)) {
    priceData = await fetchFromTwelveData(asset, "crypto");
  } else if (STOCK_ASSETS.has(asset)) {
    priceData = await fetchFromFinnhub(asset);
  } else if (COMMODITY_ASSETS.has(asset)) {
    priceData = await fetchFromFinnhub(COMMODITY_MAP[asset] || asset);
  } else {
    // Unknown — try Finnhub as fallback
    priceData = await fetchFromFinnhub(asset);
  }

  // 3. Store in cache
  await setCachedPrice(asset, priceData);
  return priceData;
}

/**
 * Get historical daily closes for indicator calculations.
 * Returns array of closing prices, oldest first. [ 100.2, 101.5, ... ]
 */
export async function getPriceHistory(asset, periods = 200) {
  const cached = await getCachedHistory(asset);
  if (cached && cached.length >= periods) return cached;

  let closes;
  if (CRYPTO_ASSETS.has(asset)) {
    closes = await fetchHistoryTwelveData(asset, periods);
  } else {
    closes = await fetchHistoryFinnhub(asset, periods);
  }

  await setCachedHistory(asset, closes);
  return closes;
}

/**
 * Batch fetch prices for multiple assets efficiently.
 * Returns Map<asset, priceData>
 */
export async function getPrices(assets) {
  const results = new Map();
  await Promise.allSettled(
    assets.map(async (asset) => {
      try {
        const data = await getPrice(asset);
        results.set(asset, data);
      } catch (err) {
        console.error(`[priceFeed] Failed to fetch ${asset}:`, err.message);
      }
    })
  );
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Finnhub (stocks, ETFs, commodities)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFromFinnhub(symbol) {
  const { data } = await axios.get("https://finnhub.io/api/v1/quote", {
    params: { symbol, token: config.prices.finnhubKey },
    timeout: 5000,
  });

  if (!data || data.c === 0) throw new Error(`Finnhub: no data for ${symbol}`);

  return {
    asset:     symbol,
    price:     data.c,           // current price
    open:      data.o,
    high:      data.h,
    low:       data.l,
    prevClose: data.pc,
    change:    data.d,           // change vs prev close
    changePct: data.dp,          // % change
    volume:    null,             // not in quote endpoint
    timestamp: data.t * 1000,   // unix → ms
    source:    "finnhub",
  };
}

async function fetchHistoryFinnhub(symbol, periods) {
  const to   = Math.floor(Date.now() / 1000);
  const from = to - periods * 86400;  // approx — market days only

  const { data } = await axios.get("https://finnhub.io/api/v1/stock/candle", {
    params: { symbol, resolution: "D", from, to, token: config.prices.finnhubKey },
    timeout: 8000,
  });

  if (data.s !== "ok") throw new Error(`Finnhub history: ${data.s} for ${symbol}`);
  return data.c; // array of closing prices
}

// ─────────────────────────────────────────────────────────────────────────────
// Twelve Data (crypto + stocks)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFromTwelveData(asset, type) {
  // Twelve Data uses '/' for crypto pairs: BTC/USD
  const { data } = await axios.get("https://api.twelvedata.com/price", {
    params: { symbol: asset, apikey: config.prices.twelveDataKey },
    timeout: 5000,
  });

  if (data.status === "error") throw new Error(`TwelveData: ${data.message}`);

  // Also fetch quote for change/volume data
  const { data: quote } = await axios.get("https://api.twelvedata.com/quote", {
    params: { symbol: asset, apikey: config.prices.twelveDataKey },
    timeout: 5000,
  });

  return {
    asset,
    price:     parseFloat(data.price),
    open:      parseFloat(quote.open || 0),
    high:      parseFloat(quote.fifty_two_week?.high || 0),
    low:       parseFloat(quote.fifty_two_week?.low  || 0),
    prevClose: parseFloat(quote.previous_close || 0),
    change:    parseFloat(quote.change || 0),
    changePct: parseFloat(quote.percent_change || 0),
    volume:    parseInt(quote.volume || 0),
    timestamp: Date.now(),
    source:    "twelvedata",
  };
}

async function fetchHistoryTwelveData(asset, periods) {
  const { data } = await axios.get("https://api.twelvedata.com/time_series", {
    params: {
      symbol:     asset,
      interval:   "1day",
      outputsize: periods,
      apikey:     config.prices.twelveDataKey,
    },
    timeout: 8000,
  });

  if (data.status === "error") throw new Error(`TwelveData history: ${data.message}`);

  // Returns newest-first — reverse so oldest is index 0
  return data.values
    .map((v) => parseFloat(v.close))
    .reverse();
}
