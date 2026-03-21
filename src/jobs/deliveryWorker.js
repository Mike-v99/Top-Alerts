// src/pages/App.jsx
//
// This is the existing Top-Alerts UI (price-alert-app-v3.jsx) wired to live data.
// useAlerts() replaces all mock state. useAuth() gates Pro features.

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth }   from "../context/AuthContext.jsx";
import { useAlerts } from "../hooks/useAlerts.js";
import { billingApi } from "../api/client.js";

// ── Themes (same as v3) ───────────────────────────────────────────────────────
const THEMES = {
  paper: {
    bg: "#faf9f6", bgCard: "#f4f2ed", bgDeep: "#ede9e0", bgModal: "#f4f2ed", bgInput: "#ede9e0",
    border: "#d0c8b8", borderLight: "#ddd5c5", text: "#1a1200", textMid: "#6a6050", textFaint: "#aaa090",
    accent: "#8a6a00", accentBg: "rgba(138,106,0,0.1)", accentBorder: "rgba(138,106,0,0.25)",
    green: "#1a8a44", greenGlow: "none", yellow: "#c89000", yellowGlow: "none", red: "#cc2222", redGlow: "none",
    gridColor: "rgba(138,106,0,0.06)", proGradient: "#ede5cc", proBorder: "rgba(138,106,0,0.3)",
    btnPrimary: "#1a1200", btnText: "#f4f0e8", activeTab: "#1a1200", activeTabBorder: "#1a1200",
    planActiveBg: "#1a1200", planActiveText: "#f4f0e8", planInactiveText: "#aaa090",
    sparkStroke: "#8a6a00", sparkFire: "#8a6a00", icon: "☀",
  },
  charcoal: {
    bg: "#141414", bgCard: "#1a1a1a", bgDeep: "#0f0f0f", bgModal: "#1a1a1a", bgInput: "#0f0f0f",
    border: "#282828", borderLight: "#222", text: "#e0e0e0", textMid: "#888", textFaint: "#444",
    accent: "#cccccc", accentBg: "rgba(255,255,255,0.06)", accentBorder: "rgba(255,255,255,0.15)",
    green: "#3ddc84", greenGlow: "0 0 8px #3ddc84", yellow: "#bbbbbb", yellowGlow: "none",
    red: "#ff5a5a", redGlow: "0 0 8px #ff5a5a",
    gridColor: "rgba(255,255,255,0.02)", proGradient: "#1e1e1e", proBorder: "rgba(255,255,255,0.12)",
    btnPrimary: "#e0e0e0", btnText: "#141414", activeTab: "#e0e0e0", activeTabBorder: "#888",
    planActiveBg: "#282828", planActiveText: "#e0e0e0", planInactiveText: "#444",
    sparkStroke: "#aaa", sparkFire: "#ccc", icon: "◑",
  },
};

const ASSETS = ["BTC/USD","ETH/USD","SOL/USD","AAPL","TSLA","SPY","GOLD"];
const FREE_TRIGGERS = [
  { id: "price_above", label: "Price rises above", icon: "↑", input: "price",   desc: "Fires when price exceeds your target" },
  { id: "price_below", label: "Price drops below", icon: "↓", input: "price",   desc: "Fires when price falls under your target" },
  { id: "pct_change",  label: "% change exceeds",  icon: "±", input: "percent", desc: "Fires on big moves in either direction" },
];
const PRO_TRIGGERS = [
  { id: "ma_cross_above", label: "Price crosses above MA",  icon: "↗", input: "ma",     desc: "Bullish MA crossover" },
  { id: "ma_cross_below", label: "Price crosses below MA",  icon: "↘", input: "ma",     desc: "Bearish MA crossover" },
  { id: "golden_cross",   label: "Golden Cross",            icon: "✦", input: null,     desc: "50MA crosses above 200MA" },
  { id: "death_cross",    label: "Death Cross",             icon: "✗", input: null,     desc: "50MA crosses below 200MA" },
  { id: "rsi_overbought", label: "RSI Overbought >70",      icon: "⚡", input: null,    desc: "Potential pullback signal" },
  { id: "rsi_oversold",   label: "RSI Oversold <30",        icon: "▼", input: null,     desc: "Potential reversal signal" },
  { id: "macd_cross",     label: "MACD Signal Cross",       icon: "⊕", input: null,     desc: "MACD line crosses signal" },
  { id: "bb_breakout",    label: "Bollinger Band Breakout", icon: "◈", input: "bb",     desc: "Price exits Bollinger Band" },
  { id: "volume_surge",   label: "Volume Surge",            icon: "▲", input: "volume", desc: "Unusual volume detected" },
];
const MA_OPTIONS = ["9","20","50","100","200"];
const BB_OPTIONS = ["Upper Band","Lower Band"];
const DELIVERY   = [
  { id: "push", label: "Push", pro: false },{ id: "email", label: "Email", pro: false },
  { id: "sms",  label: "SMS",  pro: true  },{ id: "webhook", label: "Webhook", pro: true },
];

export default function AppPage() {
  const navigate = useNavigate();
  const { user, profile, isPro, signOut } = useAuth();
  const { alerts, history, loading, createAlert, deleteAlert, togglePause } = useAlerts();

  const [themeName, setThemeName] = useState("paper");
  const [tab,       setTab]       = useState("market");
  const [showModal, setShowModal] = useState(false);
  const [step,      setStep]      = useState(1);
  const [toast,     setToast]     = useState(null);
  const [marketData, setMarketData] = useState({});
  const [marketLoading, setMarketLoading] = useState(true);
  const [flashState,    setFlashState]    = useState({});
  const [search,        setSearch]        = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [watchlist,     setWatchlist]     = useState(() => {
    try { return JSON.parse(localStorage.getItem("ta-watchlist") || "[]"); } catch { return []; }
  });
  const [watchData,     setWatchData]     = useState({});
  const [chartSymbol,   setChartSymbol]   = useState(null);
  const [chartRange,    setChartRange]    = useState("1D");
  const [chartData,     setChartData]     = useState([]);
  const [chartLoading,  setChartLoading]  = useState(false);
  const [chartLabel,    setChartLabel]    = useState("");
  const chartPanelRef = useRef(null);
  const [flyingCard,   setFlyingCard]   = useState(null); // {x,y,label,symbol}
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [modalSource,      setModalSource]      = useState("standalone"); // "card" | "standalone"
  const [modalAssetLabel,  setModalAssetLabel]  = useState(""); // display name from card
  const [modalSymbolSearch, setModalSymbolSearch] = useState("");
  const [modalSearchResults, setModalSearchResults] = useState([]);
  const [modalSearchLoading, setModalSearchLoading] = useState(false);
  const [modalPrice,  setModalPrice]  = useState(null); // { price, change, changePct, marketOpen }

  const MARKET_SYMBOLS = [
    { id: "DIA",   label: "Dow 30",  symbol: "DIA"  },
    { id: "SPY",   label: "S&P 500", symbol: "SPY"  },
    { id: "VIXY",  label: "VIX",     symbol: "VIXY" },
    { id: "QQQ",   label: "Nasdaq",  symbol: "QQQ"  },
    { id: "UUP",   label: "DXY",     symbol: "UUP"  },
    { id: "IBIT",  label: "BTC/USD", symbol: "IBIT" },
    { id: "USO",   label: "USO",     symbol: "USO"  },
    { id: "GLD",   label: "Gold",    symbol: "GLD"  },
  ];

  // ── Massive.com real-time prices ─────────────────────────────────────────────
  useEffect(() => {
    const key = import.meta.env.VITE_MASSIVE_KEY || "";
    if (!key) { setMarketLoading(false); return; }

    let ws = null;
    let fallback = null;
    let destroyed = false;

    const symbolToId = Object.fromEntries(MARKET_SYMBOLS.map(m => [m.symbol, m.id]));

    // Fetch snapshot for multiple symbols in one call
    async function fetchSnapshots(symbols) {
      try {
        const tickers = symbols.join(",");
        const res  = await fetch(`https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${key}`);
        const data = await res.json();
        return (data.tickers || []).map(t => {
          const price = t.lastTrade?.p || t.day?.c || t.min?.c || 0;
          return {
            id: symbolToId[t.ticker] || t.ticker,
            symbol: t.ticker,
            price,
            change: t.todaysChange || 0,
            changePct: t.todaysChangePerc || 0,
            prevClose: t.prevDay?.c || 0,
            high: t.day?.h || 0,
            low: t.day?.l || 0,
          };
        }).filter(r => r.price !== 0);
      } catch (e) {
        console.error("[Massive] snapshot error", e);
        return [];
      }
    }

    // Load all market symbols in one batch request
    async function loadInitialQuotes() {
      const results = await fetchSnapshots(MARKET_SYMBOLS.map(m => m.symbol));
      if (results.length > 0) {
        const out = {};
        results.forEach(r => { out[r.id] = r; });
        setMarketData(prev => ({ ...prev, ...out }));
        setMarketLoading(false);
      }
    }

    // Fetch watchlist symbols in one batch
    async function loadWatchlistQuotes(saved) {
      if (!saved.length) return;
      const results = await fetchSnapshots(saved.map(m => m.symbol));
      results.forEach(r => {
        setWatchData(prev => ({ ...prev, [r.symbol]: r }));
      });
    }

    // Massive WebSocket — true tick-by-tick from all US exchanges
    function connectWS() {
      if (destroyed) return;
      ws = new WebSocket(`wss://delayed.polygon.io/stocks`);

      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "auth", params: key }));
      };

      ws.onmessage = (event) => {
        console.log("[WS]", event.data.slice(0, 150));
        try {
          const msgs = JSON.parse(event.data);
          msgs.forEach(msg => {
            // After auth success, subscribe to all symbols
            if (msg.ev === "status" && msg.status === "auth_success") {
              const subs = MARKET_SYMBOLS.map(m => `A.${m.symbol}`).join(",");
              ws.send(JSON.stringify({ action: "subscribe", params: subs }));
            }
            // Per-second aggregate event (smoother than raw trades)
            if (msg.ev === "A") {
              const id = symbolToId[msg.sym];
              if (!id) return;
              setMarketData(prev => {
                if (!prev[id]) return prev;
                const oldPrice  = prev[id].price;
                const prevClose = prev[id].prevClose || oldPrice;
                const newPrice  = msg.c || msg.vw || msg.p;
                const change    = newPrice - prevClose;
                const changePct = prevClose ? (change / prevClose) * 100 : 0;
                const dir = newPrice > oldPrice ? "up" : newPrice < oldPrice ? "down" : null;
                if (dir) {
                  setFlashState(f => ({ ...f, [id]: dir }));
                  setTimeout(() => setFlashState(f => { const n = {...f}; delete n[id]; return n; }), 700);
                }
                return { ...prev, [id]: { ...prev[id], price: newPrice, change, changePct } };
              });
            }
          });
        } catch (e) {}
      };

      ws.onerror = (e) => console.warn("[WS] error", e);
      ws.onclose = (e) => { console.log("[WS] closed", e.code, e.reason); if (!destroyed) setTimeout(connectWS, 3000); };
    }

    // Start everything
    loadInitialQuotes();
    connectWS();
    fallback = setInterval(loadInitialQuotes, 30000);

    // Load watchlist on mount
    const saved = (() => { try { return JSON.parse(localStorage.getItem("ta-watchlist") || "[]"); } catch { return []; } })();
    loadWatchlistQuotes(saved);

    return () => {
      destroyed = true;
      clearInterval(fallback);
      if (ws) ws.close();
    };
  }, []);
  const [form, setForm] = useState({
    asset: "BTC/USD", trigger: null, value: "",
    ma: "50", bb: "Upper Band", volume: "3",
    delivery: ["push"], cooldown: "60", webhook_url: "",
  });

  const T    = THEMES[themeName];
  const font = { fontFamily: "'Roboto', sans-serif" };
  const mono = { fontFamily: "'Roboto', sans-serif" };

  const chipBtn = (active) => ({
    padding: "7px 14px", borderRadius: 7,
    border: `1px solid ${active ? T.accent : T.border}`,
    background: active ? T.accentBg : "transparent",
    color: active ? T.accent : T.textFaint,
    cursor: "pointer", ...font, fontSize: 17, transition: "all 0.15s",
  });

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Symbol search ──────────────────────────────────────────────────────────
  async function searchSymbols(q) {
    if (!q || q.length < 1) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const key = import.meta.env.VITE_MASSIVE_KEY || "";
      const res  = await fetch(`https://api.massive.com/v3/reference/tickers?search=${encodeURIComponent(q)}&active=true&market=stocks&limit=8&apiKey=${key}`);
      const data = await res.json();
      const results = (data.results || []).map(r => ({
        symbol: r.ticker,
        description: r.name,
        type: r.type,
        displaySymbol: r.ticker,
      }));
      setSearchResults(results);
    } catch (e) { setSearchResults([]); }
    setSearchLoading(false);
  }

  // ── Chart data ────────────────────────────────────────────────────────────────────────
  async function fetchChart(symbol, range) {
    setChartLoading(true);
    setChartData([]);
    try {
      const key = import.meta.env.VITE_MASSIVE_KEY || "";
      const now   = new Date();
      const pad   = n => String(n).padStart(2, "0");
      const fmt   = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      const mapR  = r => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
      const getAggs = (mult, span, f, t) =>
        fetch(`https://api.massive.com/v2/aggs/ticker/${symbol}/range/${mult}/${span}/${f}/${t}?adjusted=true&sort=asc&limit=300&apiKey=${key}`)
          .then(r => r.json()).then(d => d.results || []).catch(() => []);

      if (range === "15m") {
        // 5 day chart — 15 min candles
        const start = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
        const results = await getAggs(15, "minute", fmt(start), fmt(now));
        if (results.length) setChartData(results.map(mapR));
      } else if (range === "1D") {
        // 1 month chart — daily candles
        const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const results = await getAggs(1, "day", fmt(start), fmt(now));
        if (results.length) setChartData(results.map(mapR));
      } else if (range === "1W") {
        // 1 year chart — weekly candles
        const start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        const results = await getAggs(1, "week", fmt(start), fmt(now));
        if (results.length) setChartData(results.map(mapR));
      } else {
        // 5 year chart — fetch 3 chunks of ~20 monthly candles each and stitch
        const yr = now.getFullYear();
        const mo = pad(now.getMonth() + 1);
        const chunks = await Promise.all([
          getAggs(1, "month", `${yr - 5}-01-01`, `${yr - 3}-01-01`),
          getAggs(1, "month", `${yr - 3}-01-01`, `${yr - 1}-01-01`),
          getAggs(1, "month", `${yr - 1}-01-01`, `${yr}-${mo}-${pad(now.getDate())}`),
        ]);
        const merged = Object.values(
          chunks.flat().reduce((acc, r) => { acc[r.t] = r; return acc; }, {})
        ).sort((a, b) => a.t - b.t);
        if (merged.length) setChartData(merged.map(mapR));
      }
    } catch (e) { console.error("Chart fetch failed", e); }
    setChartLoading(false);
  }


  function openChart(symbol, label, e) {
    // Magnetic pull animation: record card position, animate flying clone to chart panel
    if (e && e.currentTarget) {
      const r = e.currentTarget.getBoundingClientRect();
      setFlyingCard({ x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height, label: label || symbol, symbol });
    }
    setChartSymbol(symbol);
    setChartLabel(label || symbol);
    setChartRange("1D");
    fetchChart(symbol, "1D");
  }

  function changeChartRange(range) {
    setChartRange(range);
    if (chartSymbol) fetchChart(chartSymbol, range);
  }

  function addToWatchlist(symbol, description) {
    const entry = { id: symbol, label: description ? description.slice(0, 24) : symbol, symbol };
    const updated = [entry, ...watchlist.filter(w => w.symbol !== symbol)].slice(0, 20);
    setWatchlist(updated);
    try { localStorage.setItem("ta-watchlist", JSON.stringify(updated)); } catch {}
    setSearch(""); setSearchResults([]);
    const key = import.meta.env.VITE_MASSIVE_KEY || "";
    fetch(`https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${symbol}&apiKey=${key}`)
      .then(r => r.json())
      .then(data => {
        const t = data.tickers?.[0];
        const price = t?.lastTrade?.p || t?.day?.c || t?.min?.c || 0;
        if (price !== 0) {
          setWatchData(prev => ({ ...prev, [symbol]: {
            id: symbol, symbol, price,
            change: t.todaysChange || 0,
            changePct: t.todaysChangePerc || 0,
            prevClose: t.prevDay?.c || 0,
            high: t.day?.h || 0,
            low: t.day?.l || 0,
          }}));
          showToast(`${symbol} added`);
        } else {
          setWatchlist(prev => {
            const filtered = prev.filter(w => w.symbol !== symbol);
            try { localStorage.setItem("ta-watchlist", JSON.stringify(filtered)); } catch {}
            return filtered;
          });
          showToast(`${symbol} not found`, "warn");
        }
      })
      .catch(() => showToast(`${symbol} not available`, "warn"));
  }

  function removeFromWatchlist(symbol) {
    const updated = watchlist.filter(w => w.symbol !== symbol);
    setWatchlist(updated);
    try { localStorage.setItem("ta-watchlist", JSON.stringify(updated)); } catch {}
  }

  function openModal(assetOverride, assetLabel, initialPrice) {
    // Guard: ignore non-string arguments (e.g. React click events passed accidentally)
    if (assetOverride && typeof assetOverride !== "string") assetOverride = undefined;

    // Free users limited to 10 alerts — show upgrade modal on 11th attempt
    const activeAlerts = alerts.filter(a => a.status !== "deleted").length;
    if (!isPro && activeAlerts >= 10) {
      setShowUpgradeModal(true);
      return;
    }
    setStep(1);
    if (assetOverride) {
      // Opened from a card — seed with known price immediately, then fetch fresh
      setModalSource("card");
      setModalAssetLabel(assetLabel || assetOverride);
      setModalPrice(initialPrice || null);
      setForm(f => ({ ...f, trigger: null, value: "", asset: assetOverride }));
      fetchModalPrice(assetOverride);
    } else {
      // Opened standalone — user needs to search for a symbol
      setModalSource("standalone");
      setModalAssetLabel("");
      setModalSymbolSearch("");
      setModalSearchResults([]);
      setForm(f => ({ ...f, trigger: null, value: "", asset: "" }));
    }
    setShowModal(true);
  }

  async function searchModalSymbols(q) {
    if (!q || q.length < 1) { setModalSearchResults([]); return; }
    setModalSearchLoading(true);
    try {
      const key = import.meta.env.VITE_MASSIVE_KEY || "";
      const res  = await fetch(`https://api.massive.com/v3/reference/tickers?search=${encodeURIComponent(q)}&active=true&market=stocks&limit=6&apiKey=${key}`);
      const data = await res.json();
      setModalSearchResults((data.results || []).map(r => ({ symbol: r.ticker, name: r.name, type: r.type })));
    } catch { setModalSearchResults([]); }
    setModalSearchLoading(false);
  }

  async function fetchModalPrice(symbol) {
    // Don't clear existing price — keep showing it until fresh data arrives
    try {
      const key = import.meta.env.VITE_MASSIVE_KEY || "";
      const res  = await fetch(`https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${symbol}&apiKey=${key}`);
      const data = await res.json();
      const t = data.tickers?.[0];
      if (!t) return;
      const price     = t.lastTrade?.p || t.day?.c || t.min?.c || 0;
      const prevClose = t.prevDay?.c || 0;
      const change    = t.todaysChange || 0;
      const changePct = t.todaysChangePerc || 0;
      // Market is open if there's a last trade price different from prev close
      const marketOpen = !!(t.lastTrade?.p && t.lastTrade.p !== prevClose);
      if (price) setModalPrice({ price, change, changePct, marketOpen });
    } catch {}
  }

  async function handleSaveAlert() {
    // Build trigger_value payload
    const tv = form.trigger?.input === "price"   ? { price: parseFloat(form.value) }
             : form.trigger?.input === "percent"  ? { percent: parseFloat(form.value) }
             : form.trigger?.input === "ma"       ? { ma_period: parseInt(form.ma) }
             : form.trigger?.input === "bb"       ? { band: form.bb === "Upper Band" ? "upper" : "lower" }
             : form.trigger?.input === "volume"   ? { volume_multiplier: parseInt(form.volume) }
             : {};

    const { error, upgrade } = await createAlert({
      asset:         form.asset,
      asset_type:    form.asset.includes("/") ? "crypto" : "stock",
      trigger_type:  form.trigger.id,
      trigger_value: tv,
      delivery:      form.delivery,
      webhook_url:   form.delivery.includes("webhook") ? form.webhook_url : null,
      cooldown_mins: parseInt(form.cooldown),
    });

    if (upgrade) {
      setShowModal(false);
      setTab("pricing");
      showToast("Upgrade to Pro to unlock this feature", "warn");
      return;
    }
    if (error) { showToast(error, "error"); return; }

    setShowModal(false);
    showToast("Alert created!");
  }

  async function handleUpgrade(priceId) {
    const { data, error } = await billingApi.createCheckout(priceId);
    if (error) { showToast(error, "error"); return; }
    window.location.href = data.url;  // redirect to Stripe Checkout
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: T.bg, ...font, color: T.text, position: "relative", overflowX: "hidden", transition: "background 0.3s" }}>
      <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes slideFromLeft  { from { transform: translateX(-60%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes slideFromRight { from { transform: translateX(60%);  opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .price-slide-up   { animation: slideFromLeft  0.22s cubic-bezier(0.22,1,0.36,1) forwards; }
        .price-slide-down { animation: slideFromRight 0.22s cubic-bezier(0.22,1,0.36,1) forwards; }
        @keyframes chartPanelPulse {
          0%   { box-shadow: 0 0 0 0px rgba(138,106,0,0.5); }
          50%  { box-shadow: 0 0 0 6px rgba(138,106,0,0.15); }
          100% { box-shadow: 0 0 0 0px rgba(138,106,0,0); }
        }
        .chart-panel-pulse { animation: chartPanelPulse 0.5s ease-out forwards; }
      `}</style>



      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 200,
          background: toast.type === "success" ? T.btnPrimary : toast.type === "warn" ? T.yellow : T.red,
          color: T.btnText, padding: "12px 20px", borderRadius: 10,
          ...font, fontSize: 18, boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ position: "relative", zIndex: 1, maxWidth: 820, margin: "0 auto", padding: "32px 20px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 36 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 38, color: "#5F5E5A", lineHeight: 1 }}>◈</span>
              <span style={{ fontSize: 45, letterSpacing: "1px" }}>
                <span style={{ color: "#5F5E5A" }}>TOP</span>
                <span style={{ color: "#5F5E5A" }}>-</span>
                <span style={{ color: "#5F5E5A" }}>ALERTS</span>
              </span>
            </div>
            <div style={{ ...mono, fontSize: 9, letterSpacing: "3px", color: "#378ADD", marginTop: 2 }}>INTELLIGENT PRICE ALERTS</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Theme toggle */}
            <button onClick={() => setThemeName(t => t === "paper" ? "charcoal" : "paper")} style={{
              ...font, fontSize: 18, background: T.bgCard, border: `1px solid ${T.border}`,
              borderRadius: 8, padding: "6px 12px", cursor: "pointer",
            }}>
              <span style={{ color: themeName === "paper" ? "#f5a623" : "#ffffff" }}>{T.icon}</span>
            </button>

            {/* Plan badge */}
            <div style={{ ...mono, fontSize: 9, letterSpacing: "1.5px",
              background: isPro ? T.accentBg : "transparent",
              color: isPro ? T.accent : T.textFaint,
              border: `1px solid ${isPro ? T.accentBorder : T.border}`,
              padding: "6px 12px", borderRadius: 8 }}>
              {profile?.plan?.toUpperCase() || "FREE"}
            </div>

            {/* User + sign out */}
            {user ? (
              <button onClick={() => { signOut(); navigate("/"); }} style={{
                ...font, fontSize: 16, background: T.bgCard, border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "6px 12px", cursor: "pointer", color: T.textFaint,
              }}>
                {user?.email?.split("@")[0]} ↩
              </button>
            ) : (
              <button onClick={() => navigate("/login")} style={{
                ...font, fontSize: 18, background: "none", border: "1px solid #5F5E5A",
                borderRadius: 8, padding: "6px 16px", cursor: "pointer", color: "#5F5E5A",
              }}>
                SIGN IN
              </button>
            )}
          </div>
        </div>

        {/* Pro banner */}
        {isPro && (
          <div style={{ background: T.proGradient, border: `1px solid ${T.accentBorder}`, borderRadius: 12, padding: "14px 20px", marginBottom: 24, display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 20 }}>⚡</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, color: T.accent }}>Pro Plan Active</div>
              <div style={{ ...mono, fontSize: 10, color: T.textFaint, marginTop: 2 }}>Advanced triggers · Multi-condition logic · Backtesting · Webhook delivery</div>
            </div>
            <div style={{ ...mono, fontSize: 9, color: T.textFaint, border: `1px solid ${T.border}`, padding: "4px 12px", borderRadius: 5 }}>UNLIMITED</div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", marginBottom: 28, borderBottom: `1px solid ${T.border}` }}>
          {["market","alerts","history","pricing"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "10px 22px", background: "none", border: "none", cursor: "pointer",
              ...font, fontSize: 20, letterSpacing: "1px",
              color: tab === t ? T.activeTab : T.textFaint,
              borderBottom: tab === t ? `2px solid ${T.activeTabBorder}` : "2px solid transparent",
              marginBottom: -1, transition: "all 0.2s",
            }}>
              {t.toUpperCase()}
            </button>
          ))}
          <button onClick={() => openModal()} style={{
            marginLeft: "auto", padding: "8px 22px", background: "#0a1f4a", border: "none",
            borderRadius: 8, cursor: "pointer", ...font, fontSize: 20, color: "#e8f2ff",
          }}>
            + NEW ALERT
          </button>
        </div>

        {/* Two-column layout for market tab */}
        <div style={{ display: "flex", gap: 20 }}>

          {/* Market sidebar — style #2 left border accent */}
          <div style={{ width: 210, flexShrink: 0 }}>

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {MARKET_SYMBOLS.map(m => {
                const d   = marketData[m.id];
                const up  = d?.changePct >= 0;
                const col = !d ? T.border : up ? T.green : T.red;
                return (
                  <div key={m.id} onClick={(e) => openChart(m.symbol, m.label, e)} style={{
                    background: T.bgCard,
                    border: `1px solid ${T.border}`,
                    borderLeft: `4px solid ${col}`,
                    borderRadius: 9,
                    padding: "10px 12px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    transition: "border-left-color 0.3s",
                  }}>
                    <div>
                      <div style={{ ...font, fontSize: 13, fontWeight: 500, color: T.text }}>{m.label}</div>
                      <div style={{ ...mono, fontSize: 10, color: T.textFaint, marginTop: 1 }}>{m.symbol}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ overflow: "hidden" }}>
                        <div
                          key={d?.price}
                          className={flashState[m.id] === "up" ? "price-slide-up" : flashState[m.id] === "down" ? "price-slide-down" : ""}
                          style={{ ...font, fontSize: 14, fontWeight: 500, color: flashState[m.id] === "up" ? T.green : flashState[m.id] === "down" ? T.red : T.text, transition: "color 0.8s" }}>
                          {marketLoading && !d ? "—" : d?.price ? `$${Number(d.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                        </div>
                      </div>
                      {d && <div style={{ ...mono, fontSize: 10, color: col, marginTop: 1 }}>
                        {up ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}%
                      </div>}
                    </div>
                  </div>
                );
              })}
              <div style={{ ...mono, fontSize: 9, color: T.textFaint, textAlign: "center", marginTop: 4 }}>
                Live · WebSocket
              </div>
            </div>
          </div>

          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0 }}>

        {/* Market tab */}
        {tab === "market" && (
          <div>
            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: 20 }}>
              <input
                type="text"
                placeholder="Search any symbol — AAPL, TSLA, ETH-USD..."
                value={search}
                onChange={e => { setSearch(e.target.value); searchSymbols(e.target.value); }}
                style={{
                  width: "100%", padding: "12px 16px", boxSizing: "border-box",
                  background: T.bgCard, border: `1px solid ${search ? T.accent : T.border}`,
                  borderRadius: 10, color: T.text, ...font, fontSize: 18,
                  outline: "none", transition: "border 0.2s",
                }}
              />
              {search && (
                <button onClick={() => { setSearch(""); setSearchResults([]); }} style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", color: T.textFaint, cursor: "pointer", fontSize: 18,
                }}>×</button>
              )}

              {/* Search results dropdown */}
              {(searchResults.length > 0 || searchLoading) && search && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
                  background: T.bgModal, border: `1px solid ${T.border}`, borderRadius: 10,
                  overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
                }}>
                  {searchLoading && (
                    <div style={{ padding: "12px 16px", ...mono, fontSize: 11, color: T.textFaint }}>Searching...</div>
                  )}
                  {searchResults.map(r => (
                    <div key={r.symbol} onClick={() => addToWatchlist(r.symbol, r.description)} style={{
                      padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                      borderBottom: `1px solid ${T.border}`,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = T.bgDeep}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ ...mono, fontSize: 11, color: T.accent, minWidth: 60, fontWeight: 700 }}>{r.symbol}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ ...font, fontSize: 16, color: T.text }}>{(r.description || "").slice(0, 35)}</div>
                        <div style={{ ...mono, fontSize: 9, color: T.textFaint, marginTop: 1 }}>{r.type} · {r.displaySymbol}</div>
                      </div>
                      <div style={{ ...mono, fontSize: 9, color: T.accent, border: `1px solid ${T.accentBorder}`, padding: "2px 8px", borderRadius: 4 }}>+ ADD</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Chart panel */}
            {chartSymbol && (
              <div ref={chartPanelRef} style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ ...font, fontSize: 16, fontWeight: 500, color: T.text }}>{chartLabel}</span>
                    <span style={{ ...mono, fontSize: 10, color: T.textFaint }}>{chartSymbol}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {[["15m","5D"],["1D","1M"],["1W","1Y"],["1M","5Y"]].map(([r,lbl]) => (
                      <button key={r} onClick={() => changeChartRange(r)} style={{
                        ...mono, fontSize: 11, padding: "3px 10px", borderRadius: 6, cursor: "pointer",
                        background: chartRange === r ? T.btnPrimary : "none",
                        color: chartRange === r ? T.btnText : T.textFaint,
                        border: `1px solid ${chartRange === r ? T.btnPrimary : T.border}`,
                      }}>{lbl}</button>
                    ))}
                    <button onClick={() => { setChartSymbol(null); setChartData([]); }} style={{
                      background: "none", border: "none", color: T.textFaint, cursor: "pointer", fontSize: 18, marginLeft: 4,
                    }}>×</button>
                  </div>
                </div>
                {chartLoading && (
                  <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 11, color: T.textFaint }}>
                    Loading chart...
                  </div>
                )}
                {!chartLoading && chartData.length > 0 && (
                  <CandlestickChart data={chartData} T={T} range={chartRange} />
                )}
                {!chartLoading && chartData.length === 0 && (
                  <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 11, color: T.textFaint }}>
                    No data available for this range
                  </div>
                )}
              </div>
            )}

            {/* Watchlist (user-added symbols) */}
            {watchlist.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 10 }}>YOUR WATCHLIST</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {watchlist.map(m => {
                    const d        = watchData[m.symbol];
                    const up       = d?.changePct >= 0;
                    const col      = !d ? T.border : up ? T.green : T.red;
                    const rangePct = d?.high && d?.low && d.high !== d.low
                      ? Math.min(100, Math.max(0, ((d.price - d.low) / (d.high - d.low)) * 100))
                      : null;
                    const fmt = n => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    return (
                      <div key={m.symbol} style={{
                        background: T.bgCard, border: `1px solid ${T.border}`,
                        borderLeft: `4px solid ${col}`, borderRadius: 11, padding: "14px 16px",
                        position: "relative",
                      }}>
                        <button onClick={() => removeFromWatchlist(m.symbol)} style={{
                          position: "absolute", top: 8, right: 10,
                          background: "none", border: "none", color: T.textFaint,
                          cursor: "pointer", fontSize: 14, lineHeight: 1,
                        }}>×</button>
                        {/* Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingRight: 16, cursor: "pointer" }} onClick={(e) => openChart(m.symbol, m.label, e)}>
                          <div>
                            <div style={{ ...mono, fontSize: 10, color: T.accent, fontWeight: 500 }}>{m.symbol}</div>
                            <div style={{ ...font, fontSize: 14, fontWeight: 500, color: T.text, marginTop: 1 }}>{m.label}</div>
                          </div>
                          {d && <div style={{ textAlign: "right" }}>
                            <div style={{ ...mono, fontSize: 11, color: col }}>{up ? "▲" : "▼"} {Math.abs(d.changePct || 0).toFixed(2)}%</div>
                            <div style={{ ...mono, fontSize: 10, color: T.textFaint }}>{up ? "+" : ""}{d.change?.toFixed(2)}</div>
                          </div>}
                        </div>
                        {/* Price */}
                        <div style={{ ...font, fontSize: 24, fontWeight: 500, color: T.text, margin: "8px 0" }}>
                          {!d ? "Loading..." : d.price ? fmt(d.price) : "—"}
                        </div>
                        {/* Day range bar */}
                        {rangePct !== null && (
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ ...mono, fontSize: 9, color: T.textFaint }}>L {fmt(d.low)}</span>
                              <span style={{ ...mono, fontSize: 9, color: T.textFaint }}>H {fmt(d.high)}</span>
                            </div>
                            <div style={{ height: 4, background: T.bgDeep, borderRadius: 2 }}>
                              <div style={{ height: "100%", width: `${rangePct.toFixed(1)}%`, background: col, borderRadius: 2, transition: "width 0.5s" }} />
                            </div>
                          </div>
                        )}
                        {/* Footer */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ ...mono, fontSize: 9, color: T.textFaint }}>
                            {d?.prevClose ? `Prev ${fmt(d.prevClose)}` : ""}
                          </div>
                          <button onClick={() => openModal(m.symbol, m.label, d ? { price: d.price, change: d.change, changePct: d.changePct, marketOpen: !!d.price } : null)} style={{
                            padding: "4px 12px", background: "none",
                            border: "1px solid #5F5E5A", borderRadius: 6,
                            cursor: "pointer", ...font, fontSize: 13, color: "#5F5E5A",
                          }}>+ SET ALERT</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 14 }}>MARKET OVERVIEW</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {MARKET_SYMBOLS.map(m => {
                const d   = marketData[m.id];
                const up  = d?.changePct >= 0;
                const col = !d ? T.border : up ? T.green : T.red;
                const rangePct = d?.high && d?.low && d.high !== d.low
                  ? Math.min(100, Math.max(0, ((d.price - d.low) / (d.high - d.low)) * 100))
                  : null;
                const fmt = n => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                return (
                  <div key={m.id} style={{
                    background: T.bgCard, border: `1px solid ${T.border}`,
                    borderLeft: `4px solid ${col}`,
                    borderRadius: 11, padding: "14px 16px",
                  }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", cursor: "pointer" }} onClick={(e) => openChart(m.symbol, m.label, e)}>
                      <div>
                        <div style={{ ...font, fontSize: 15, fontWeight: 500, color: T.text }}>{m.label}</div>
                        <div style={{ ...mono, fontSize: 10, color: T.textFaint, marginTop: 1 }}>{m.symbol}</div>
                      </div>
                      {d && <div style={{ textAlign: "right" }}>
                        <div style={{ ...mono, fontSize: 11, color: col }}>
                          {up ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}%
                        </div>
                        <div style={{ ...mono, fontSize: 10, color: T.textFaint, marginTop: 1 }}>
                          {up ? "+" : ""}{d.change?.toFixed(2)}
                        </div>
                      </div>}
                    </div>
                    {/* Price */}
                    <div style={{ overflow: "hidden", margin: "8px 0" }}>
                      <div
                        key={d?.price}
                        className={flashState[m.id] === "up" ? "price-slide-up" : flashState[m.id] === "down" ? "price-slide-down" : ""}
                        style={{ ...font, fontSize: 26, fontWeight: 500, color: flashState[m.id] === "up" ? T.green : flashState[m.id] === "down" ? T.red : T.text, transition: "color 0.8s" }}>
                        {marketLoading && !d ? "Loading..." : d?.price ? fmt(d.price) : "—"}
                      </div>
                    </div>
                    {/* Day range bar */}
                    {rangePct !== null && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ ...mono, fontSize: 9, color: T.textFaint }}>L {fmt(d.low)}</span>
                          <span style={{ ...mono, fontSize: 9, color: T.textFaint }}>H {fmt(d.high)}</span>
                        </div>
                        <div style={{ height: 4, background: T.bgDeep, borderRadius: 2 }}>
                          <div style={{ height: "100%", width: `${rangePct.toFixed(1)}%`, background: col, borderRadius: 2, transition: "width 0.5s" }} />
                        </div>
                      </div>
                    )}
                    {/* Footer */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ ...mono, fontSize: 9, color: T.textFaint }}>
                        {d?.prevClose ? `Prev ${fmt(d.prevClose)}` : ""}
                      </div>
                      <button onClick={() => openModal(m.symbol, m.label, d ? { price: d.price, change: d.change, changePct: d.changePct, marketOpen: !!d.price } : null)} style={{
                        padding: "4px 12px", background: "none",
                        border: "1px solid #5F5E5A", borderRadius: 6,
                        cursor: "pointer", ...font, fontSize: 13, color: "#5F5E5A",
                      }}>+ SET ALERT</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Alerts tab */}
        {tab === "alerts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {loading && <div style={{ textAlign: "center", padding: 60, color: T.textFaint, fontSize: 18 }}>Loading...</div>}
            {!loading && alerts.filter(a => a.status !== "deleted").map((a) => (
              <div key={a.id} style={{
                background: T.bgCard,
                border: `1px solid ${a.status === "triggered" ? T.red + "55" : a.status === "paused" ? T.border : T.border}`,
                borderRadius: 11, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16,
                position: "relative", overflow: "hidden",
              }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${T.accent},transparent)` }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: a.status === "triggered" ? T.red : a.status === "paused" ? T.textFaint : T.green,
                  boxShadow: a.status === "triggered" ? T.redGlow : a.status === "paused" ? "none" : T.greenGlow }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{a.asset}</span>
                    {a.is_multi && <span style={{ ...mono, fontSize: 9, background: "rgba(100,180,255,0.1)", color: "#6ab4ff", padding: "2px 7px", borderRadius: 3, letterSpacing: 1 }}>MULTI</span>}
                  </div>
                  <div style={{ ...mono, fontSize: 11, color: T.textFaint, marginTop: 3 }}>
                    {a.trigger_type?.replace(/_/g," ")}
                    {a.fire_count > 0 && <span style={{ marginLeft: 10, color: T.accent }}>Fired {a.fire_count}×</span>}
                    {a.last_fired_at && <span style={{ marginLeft: 8, color: T.textFaint }}>Last: {new Date(a.last_fired_at).toLocaleDateString()}</span>}
                  </div>
                </div>
                <button onClick={() => togglePause(a.id)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.textFaint, cursor: "pointer", ...font, fontSize: 14, padding: "4px 10px" }}>
                  {a.status === "paused" ? "▶" : "⏸"}
                </button>
                <div style={{ ...mono, fontSize: 10, letterSpacing: 1,
                  color: a.status === "triggered" ? T.red : a.status === "paused" ? T.textFaint : T.green,
                  border: `1px solid ${a.status === "triggered" ? T.red + "55" : T.border}`,
                  padding: "4px 10px", borderRadius: 4 }}>
                  {a.status.toUpperCase()}
                </div>
                <button onClick={() => deleteAlert(a.id)} style={{ background: "none", border: "none", color: T.textFaint, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
            ))}
            {!loading && alerts.filter(a => a.status !== "deleted").length === 0 && (
              <div style={{ textAlign: "center", padding: 60, color: T.textFaint, fontSize: 18 }}>No alerts yet — create one above</div>
            )}
          </div>
        )}

        {/* History tab */}
        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {history.map((h, i) => (
              <div key={i} style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${T.accent},transparent)` }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.accent, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 20 }}>{h.asset}</div>
                  <div style={{ ...mono, fontSize: 11, color: T.textFaint, marginTop: 3 }}>{h.trigger_type?.replace(/_/g," ")}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ ...mono, fontSize: 11, color: T.textFaint }}>{new Date(h.fired_at).toLocaleString()}</div>
                  {h.price_at_fire && <div style={{ ...mono, fontSize: 11, color: T.accent, marginTop: 2 }}>${Number(h.price_at_fire).toLocaleString()}</div>}
                </div>
              </div>
            ))}
            {history.length === 0 && <div style={{ textAlign: "center", padding: 60, color: T.textFaint, fontSize: 18 }}>No history yet</div>}
          </div>
        )}

        {/* Pricing tab */}
        {tab === "pricing" && (
          <PricingPage T={T} font={font} mono={mono} currentPlan={profile?.plan || "free"} onUpgrade={handleUpgrade} />
        )}

        </div>{/* end main content */}
        </div>{/* end two-column layout */}
      </div>

      {/* Upgrade modal — shown when free user hits 10 alert limit */}
      {showUpgradeModal && (
        <UpgradeModal T={T} font={font} mono={mono} onClose={() => setShowUpgradeModal(false)} onUpgrade={() => { setShowUpgradeModal(false); setTab("pricing"); }} />
      )}

      {/* Flying card animation — ghost fade trail #8 */}
      {flyingCard && (
        <FlyingCard
          card={flyingCard}
          chartPanelRef={chartPanelRef}
          T={T}
          onDone={() => setFlyingCard(null)}
        />
      )}

      {/* Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 18, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 40px 80px rgba(0,0,0,0.3)" }}>

            {/* Modal header — cobalt blue with integrated search */}
            <div style={{ background: "#0a1f4a", borderRadius: "18px 18px 0 0", position: "sticky", top: 0, zIndex: 10 }}>
              {/* Top row: step + title + close */}
              <div style={{ padding: "18px 24px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", border: "2px solid #378ADD", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#e8f2ff", flexShrink: 0 }}>
                    {step}
                  </div>
                  <div>
                    <div style={{ fontSize: 20, color: "#e8f2ff" }}>{step === 1 ? "Choose Trigger" : step === 2 ? "Configure" : "Delivery"}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
                      {[1,2,3].map(s => <div key={s} style={{ width: s <= step ? 20 : 6, height: 3, borderRadius: 2, background: s <= step ? "#378ADD" : "rgba(255,255,255,0.15)", transition: "all 0.3s" }} />)}
                    </div>
                  </div>
                </div>
                <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 22 }}>×</button>
              </div>

              {/* Asset search / display row — always in header */}
              <div style={{ padding: "14px 24px 18px" }}>
                {!form.asset ? (
                  /* Search input */
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      placeholder="Search symbol — AAPL, TSLA, BTC-USD..."
                      value={modalSymbolSearch}
                      onChange={e => { setModalSymbolSearch(e.target.value); searchModalSymbols(e.target.value); }}
                      autoFocus
                      style={{ width: "100%", padding: "11px 14px", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, color: "#e8f2ff", ...font, fontSize: 15, outline: "none", caretColor: "#378ADD" }}
                    />
                    {modalSymbolSearch && (
                      <button onClick={() => { setModalSymbolSearch(""); setModalSearchResults([]); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 18 }}>×</button>
                    )}
                  </div>
                ) : (
                  /* Selected asset card */
                  <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(55,138,221,0.25)", border: "1px solid rgba(55,138,221,0.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ ...mono, fontSize: 10, color: "#378ADD", fontWeight: 700 }}>{form.asset?.slice(0,3)}</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ ...font, fontSize: 15, fontWeight: 500, color: "#e8f2ff" }}>{form.asset}</div>
                      <div style={{ ...mono, fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{modalAssetLabel !== form.asset ? modalAssetLabel : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ ...font, fontSize: 15, fontWeight: 500, color: "#e8f2ff" }}>
                        {modalPrice ? `$${Number(modalPrice.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}
                      </div>
                      {modalPrice && (
                        <div style={{ ...mono, fontSize: 8, color: modalPrice.marketOpen ? (modalPrice.changePct >= 0 ? "#3ddc84" : "#ff5a5a") : "rgba(255,255,255,0.3)", marginTop: 2 }}>
                          {modalPrice.marketOpen ? `${modalPrice.changePct >= 0 ? "▲" : "▼"} ${Math.abs(modalPrice.changePct).toFixed(2)}%` : "CLOSED"}
                        </div>
                      )}
                    </div>
                    <button onClick={() => { setForm(f => ({ ...f, asset: "" })); setModalAssetLabel(""); setModalSymbolSearch(""); setModalSearchResults([]); setModalPrice(null); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 16, marginLeft: 4, flexShrink: 0 }}>×</button>
                  </div>
                )}
                {/* Search results dropdown — inside header */}
                {!form.asset && (modalSearchResults.length > 0 || modalSearchLoading) && (
                  <div style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, overflow: "hidden", marginTop: 6 }}>
                    {modalSearchLoading && <div style={{ padding: "10px 14px", ...mono, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Searching...</div>}
                    {modalSearchResults.map(r => (
                      <div key={r.symbol} onClick={() => { setForm(f => ({ ...f, asset: r.symbol })); setModalAssetLabel(r.name); setModalSymbolSearch(r.symbol); setModalSearchResults([]); fetchModalPrice(r.symbol); }}
                        style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ ...mono, fontSize: 11, color: "#378ADD", minWidth: 52, fontWeight: 500 }}>{r.symbol}</div>
                        <div style={{ ...font, fontSize: 14, color: "#e8f2ff", flex: 1 }}>{(r.name || "").slice(0, 32)}</div>
                        <div style={{ ...mono, fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{r.type}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Step 1 — Triggers */}
            {step === 1 && (
              <div>
                {/* Triggers — always visible, disabled if no asset */}
                <div style={{ padding: "20px 24px" }}>
                  <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 10 }}>FREE TRIGGERS</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                    {FREE_TRIGGERS.map(t => {
                      const iconBg  = t.id === "price_above" ? "rgba(26,138,68,0.12)" : t.id === "price_below" ? "rgba(204,34,34,0.12)" : "rgba(138,106,0,0.12)";
                      const iconCol = t.id === "price_above" ? T.green : t.id === "price_below" ? T.red : T.accent;
                      const disabled = !form.asset;
                      return (
                        <button key={t.id} onClick={() => { if (disabled) return; setForm(f => ({ ...f, trigger: t })); setStep(2); }} style={{
                          padding: "10px 14px", borderRadius: 10,
                          border: `1px solid ${T.border}`,
                          background: T.bgCard,
                          color: T.text, cursor: disabled ? "not-allowed" : "pointer", ...font,
                          textAlign: "left", display: "flex", gap: 12, alignItems: "center",
                          opacity: disabled ? 0.4 : 1, transition: "opacity 0.2s",
                        }}>
                          <div style={{ width: 32, height: 32, borderRadius: 7, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16, color: iconCol }}>{t.icon}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>{t.label}</div>
                            <div style={{ ...mono, fontSize: 10, color: T.textFaint, marginTop: 2 }}>{t.desc}</div>
                          </div>
                          <span style={{ fontSize: 14, color: T.textFaint }}>→</span>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 10 }}>PRO TRIGGERS</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {PRO_TRIGGERS.map(t => {
                      const disabled = !form.asset;
                      return (
                        <button key={t.id} onClick={() => { if (disabled) return; if (!isPro) { setShowModal(false); setTab("pricing"); showToast("Pro plan required", "warn"); return; } setForm(f => ({ ...f, trigger: t })); setStep(2); }} style={{
                          padding: "10px 14px", borderRadius: 10,
                          border: `1px solid ${T.border}`,
                          background: T.bgCard,
                          cursor: disabled ? "not-allowed" : "pointer", ...font,
                          textAlign: "left", display: "flex", gap: 12, alignItems: "center",
                          opacity: disabled ? 0.4 : isPro ? 1 : 0.45, transition: "opacity 0.2s",
                        }}>
                          <div style={{ width: 32, height: 32, borderRadius: 7, background: T.bgDeep, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14, color: T.textFaint }}>{t.icon}</div>
                          <span style={{ flex: 1, fontSize: 14, color: T.text }}>{t.label}</span>
                          {!isPro
                            ? <span style={{ ...mono, fontSize: 8, color: T.textFaint, border: `1px solid ${T.border}`, padding: "2px 6px", borderRadius: 3, flexShrink: 0 }}>PRO</span>
                            : <span style={{ fontSize: 14, color: T.textFaint }}>→</span>
                          }
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Step 2 — Configure value */}
            {step === 2 && form.trigger && (
              <div style={{ padding: "22px 28px" }}>
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 22 }}>
                  <div style={{ background: "#0a1f4a", padding: "14px 18px", display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, background: "rgba(55,138,221,0.2)", border: "1px solid rgba(55,138,221,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                      {form.trigger.icon}
                    </div>
                    <div>
                      <div style={{ ...mono, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{form.asset}</div>
                      <div style={{ fontSize: 18, color: "#e8f2ff", marginTop: 2 }}>{form.trigger.label}</div>
                    </div>
                  </div>
                  {modalPrice && (
                    <div style={{ background: T.bgCard, borderTop: `1px solid ${T.border}`, padding: "7px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ ...font, fontSize: 14, fontWeight: 500, color: T.text }}>${Number(modalPrice.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      {modalPrice.marketOpen
                        ? <span style={{ ...mono, fontSize: 10, color: modalPrice.changePct >= 0 ? T.green : T.red }}>{modalPrice.changePct >= 0 ? "▲" : "▼"} {Math.abs(modalPrice.changePct).toFixed(2)}% · {modalPrice.changePct >= 0 ? "+" : ""}{Number(modalPrice.change).toFixed(2)}</span>
                        : <span style={{ ...mono, fontSize: 9, color: T.textMid, border: `1px solid ${T.border}`, borderRadius: 3, padding: "1px 6px" }}>CLOSED</span>
                      }
                    </div>
                  )}
                </div>

                {form.trigger.input === "price" && (
                  <div>
                    <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 8 }}>TARGET PRICE (USD)</div>
                    <input type="number" placeholder="0.00" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                      style={{ width: "100%", padding: "12px 14px", background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, ...font, fontSize: 20, outline: "none", boxSizing: "border-box" }} />
                  </div>
                )}
                {form.trigger.input === "percent" && (
                  <div>
                    <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 8 }}>% CHANGE THRESHOLD</div>
                    <input type="number" placeholder="5" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                      style={{ width: "100%", padding: "12px 14px", background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, ...font, fontSize: 20, outline: "none", boxSizing: "border-box" }} />
                  </div>
                )}
                {form.trigger.input === "ma" && (
                  <div>
                    <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 10 }}>MOVING AVERAGE PERIOD</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {MA_OPTIONS.map(m => <button key={m} onClick={() => setForm(f => ({ ...f, ma: m }))} style={{ ...chipBtn(form.ma === m), flex: 1, padding: "10px 0", textAlign: "center" }}>{m}D</button>)}
                    </div>
                  </div>
                )}
                {form.trigger.input === "bb" && (
                  <div>
                    <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 10 }}>BAND</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {BB_OPTIONS.map(b => <button key={b} onClick={() => setForm(f => ({ ...f, bb: b }))} style={{ ...chipBtn(form.bb === b), flex: 1, padding: "10px 0", textAlign: "center" }}>{b}</button>)}
                    </div>
                  </div>
                )}
                {form.trigger.input === "volume" && (
                  <div>
                    <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 10 }}>SURGE MULTIPLIER</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {["2","3","5","10"].map(v => <button key={v} onClick={() => setForm(f => ({ ...f, volume: v }))} style={{ ...chipBtn(form.volume === v), flex: 1, padding: "10px 0", textAlign: "center" }}>{v}×</button>)}
                    </div>
                  </div>
                )}
                {form.trigger.input === null && (
                  <div style={{ background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 10, padding: 20, textAlign: "center", ...mono, fontSize: 11, color: T.textMid }}>
                    This trigger fires automatically — no configuration needed.
                  </div>
                )}

                <button onClick={() => setStep(3)} style={{ marginTop: 22, width: "100%", padding: 12, background: T.btnPrimary, border: "none", borderRadius: 9, cursor: "pointer", ...font, fontSize: 20, color: T.btnText }}>
                  CONTINUE →
                </button>
              </div>
            )}

            {/* Step 3 — Delivery */}
            {step === 3 && (
              <div style={{ padding: "22px 28px" }}>
                <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 12 }}>DELIVERY METHOD</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 22 }}>
                  {DELIVERY.map(d => {
                    const blocked = d.pro && !isPro;
                    const active  = form.delivery.includes(d.id) && !blocked;
                    return (
                      <button key={d.id} onClick={() => !blocked && setForm(f => ({ ...f, delivery: active ? f.delivery.filter(x => x !== d.id) : [...f.delivery, d.id] }))} style={{
                        padding: "13px 16px", borderRadius: 9,
                        border: `1px solid ${active ? T.accent : T.border}`,
                        background: active ? T.accentBg : T.bgDeep,
                        color: blocked ? T.border : active ? T.accent : T.textMid,
                        cursor: blocked ? "not-allowed" : "pointer", ...font, fontSize: 18,
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                      }}>
                        {d.label}
                        {blocked ? <span style={{ ...mono, fontSize: 9, color: T.border, border: `1px solid ${T.border}`, padding: "2px 5px", borderRadius: 3 }}>PRO</span>
                          : active ? <span style={{ color: T.accent }}>✓</span> : null}
                      </button>
                    );
                  })}
                </div>

                {/* Webhook URL input — shown when webhook is selected */}
                {form.delivery.includes("webhook") && (
                  <div style={{ marginBottom: 22 }}>
                    <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 8 }}>WEBHOOK URL</div>
                    <input
                      type="url"
                      placeholder="https://your-server.com/webhook"
                      value={form.webhook_url}
                      onChange={e => setForm(f => ({ ...f, webhook_url: e.target.value }))}
                      style={{ width: "100%", padding: "11px 14px", boxSizing: "border-box", background: T.bgInput, border: `1px solid ${form.webhook_url ? T.accent : T.border}`, borderRadius: 9, color: T.text, ...font, fontSize: 14, outline: "none" }}
                    />
                    <div style={{ ...mono, fontSize: 9, color: T.textFaint, marginTop: 6, lineHeight: 1.5 }}>
                      We'll POST a JSON payload with alert details when this alert fires.
                    </div>
                  </div>
                )}

                {isPro && (
                  <>
                    <div style={{ ...mono, fontSize: 9, letterSpacing: "2px", color: T.textFaint, marginBottom: 10 }}>COOLDOWN</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
                      {[["15","15m"],["60","1h"],["240","4h"],["1440","24h"]].map(([v,l]) => (
                        <button key={v} onClick={() => setForm(f => ({ ...f, cooldown: v }))} style={{ ...chipBtn(form.cooldown === v), flex: 1, padding: "10px 0", textAlign: "center" }}>{l}</button>
                      ))}
                    </div>
                  </>
                )}

                <button onClick={handleSaveAlert} style={{ width: "100%", padding: 13, background: T.btnPrimary, border: "none", borderRadius: 9, cursor: "pointer", ...font, fontSize: 20, color: T.btnText }}>
                  SAVE ALERT
                </button>
                <button onClick={() => setStep(2)} style={{ marginTop: 8, width: "100%", padding: 10, background: "none", border: "none", color: T.textFaint, cursor: "pointer", ...font, fontSize: 16 }}>← Back</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ── UpgradeModal — shown when free user hits 10-alert limit ─────────────────
function UpgradeModal({ T, font, mono, onClose, onUpgrade }) {
  const benefits = [
    { icon: "∞", title: "Unlimited alerts",       desc: "No cap — monitor as many assets as you want" },
    { icon: "⚡", title: "12 trigger types",       desc: "RSI, MACD, Bollinger Bands, Golden Cross and more" },
    { icon: "◈", title: "Multi-condition logic",  desc: "Combine AND/OR conditions in a single alert" },
    { icon: "↗", title: "SMS & Webhook delivery", desc: "Get notified via text or pipe into any workflow" },
    { icon: "⏱", title: "Custom cooldowns",       desc: "Control how often the same alert can fire" },
    { icon: "★", title: "Priority delivery",      desc: "Alerts processed first in the queue" },
  ];

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: T.bgModal, border: `1px solid ${T.border}`, borderRadius: 18, width: "100%", maxWidth: 480, boxShadow: "0 40px 80px rgba(0,0,0,0.3)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ background: T.btnPrimary, padding: "28px 32px 24px", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: T.btnText, opacity: 0.5, cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
          <div style={{ ...mono, fontSize: 10, letterSpacing: "2px", color: T.btnText, opacity: 0.6, marginBottom: 8 }}>FREE PLAN LIMIT REACHED</div>
          <div style={{ fontSize: 24, color: T.btnText, marginBottom: 6 }}>You've used all 10 free alerts</div>
          <div style={{ ...mono, fontSize: 12, color: T.btnText, opacity: 0.65, lineHeight: 1.5 }}>Upgrade to Pro for unlimited alerts and advanced triggers</div>
        </div>

        {/* Benefits list */}
        <div style={{ padding: "24px 32px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
            {benefits.map(b => (
              <div key={b.title} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 16, color: T.accent, flexShrink: 0, marginTop: 1 }}>{b.icon}</span>
                <div>
                  <div style={{ ...font, fontSize: 13, fontWeight: 500, color: T.text }}>{b.title}</div>
                  <div style={{ ...mono, fontSize: 10, color: T.textFaint, marginTop: 2, lineHeight: 1.4 }}>{b.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Price + CTA */}
          <div style={{ background: T.bgDeep, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ ...mono, fontSize: 10, color: T.textFaint, letterSpacing: "1px" }}>PRO PLAN</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                <span style={{ fontSize: 28, color: T.text }}>$9</span>
                <span style={{ ...mono, fontSize: 11, color: T.textFaint }}>/mo</span>
              </div>
            </div>
            <button onClick={onUpgrade} style={{
              padding: "10px 24px", background: T.btnPrimary, border: "none", borderRadius: 9,
              cursor: "pointer", ...font, fontSize: 16, color: T.btnText,
            }}>
              UPGRADE NOW →
            </button>
          </div>

          <div style={{ textAlign: "center", ...mono, fontSize: 10, color: T.textFaint }}>
            14-day money-back guarantee · Cancel anytime
          </div>
        </div>
      </div>
    </div>
  );
}

// ── FlyingCard — ghost fade trail animation (concept #8) ────────────────────
// Card glides smoothly to chart, leaving fading ghost copies behind it.
function FlyingCard({ card, chartPanelRef, T, onDone }) {
  const elRef = useRef(null);

  useEffect(() => {
    if (!elRef.current || !chartPanelRef.current) { onDone(); return; }

    const el = elRef.current;
    const panelRect = chartPanelRef.current.getBoundingClientRect();
    const targetX   = panelRect.left + window.scrollX + panelRect.width  / 2 - card.w / 2;
    const targetY   = panelRect.top  + window.scrollY + panelRect.height / 2 - card.h / 2;

    // Container for ghost clones — appended to body so they are fixed-positioned
    const ghosts = [];
    let lastGhostFrame = -1;

    let start = null;
    const duration = 700;

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function spawnGhost(x, y) {
      const g = document.createElement('div');
      g.style.cssText = [
        'position:fixed',
        'top:0','left:0',
        `width:${card.w}px`,`height:${card.h}px`,
        `transform:translate(${x}px,${y}px)`,
        `background:${T.bgCard}`,
        `border:1px solid ${T.accent}`,
        'border-radius:11px',
        'pointer-events:none',
        'z-index:9998',
        'opacity:0.45',
        'transition:opacity 0.55s ease-out',
        'box-sizing:border-box',
        'padding:10px 14px',
        'display:flex','flex-direction:column','justify-content:center',
      ].join(';');
      g.innerHTML = `<div style="font-family:'Roboto',sans-serif;font-size:13px;font-weight:500;color:${T.text};opacity:0.5">${card.label}</div>`;
      document.body.appendChild(g);
      ghosts.push(g);
      // Fade out after short delay
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { g.style.opacity = '0'; });
      });
      setTimeout(() => g.remove(), 600);
    }

    function step(ts) {
      if (!start) start = ts;
      const raw  = Math.min((ts - start) / duration, 1);
      const ease = easeOutCubic(raw);

      const x = card.x + (targetX - card.x) * ease;
      const y = card.y + (targetY - card.y) * ease;
      const opacity = raw > 0.78 ? 1 - (raw - 0.78) * (1 / 0.22) : 1;

      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.opacity   = Math.max(0, opacity);

      // Spawn a ghost every ~8 animation frames while not fading out yet
      const frameNum = Math.floor(raw * 60);
      if (raw < 0.75 && frameNum % 8 === 0 && frameNum !== lastGhostFrame) {
        lastGhostFrame = frameNum;
        spawnGhost(x, y);
      }

      if (raw < 1) {
        requestAnimationFrame(step);
      } else {
        // Pulse chart panel
        if (chartPanelRef.current) {
          chartPanelRef.current.classList.add('chart-panel-pulse');
          setTimeout(() => chartPanelRef.current?.classList.remove('chart-panel-pulse'), 500);
        }
        onDone();
      }
    }

    requestAnimationFrame(step);

    return () => { ghosts.forEach(g => g.remove()); };
  }, []);

  return (
    <div
      ref={elRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: card.w,
        height: card.h,
        transform: `translate(${card.x}px, ${card.y}px)`,
        background: T.bgCard,
        border: `1.5px solid ${T.accent}`,
        borderRadius: 11,
        pointerEvents: "none",
        zIndex: 9999,
        padding: "10px 14px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        willChange: "transform, opacity",
      }}
    >
      <div style={{ fontFamily: "'Roboto', sans-serif", fontSize: 13, fontWeight: 500, color: T.text }}>{card.label}</div>
      <div style={{ fontFamily: "'Roboto', sans-serif", fontSize: 10, color: T.textFaint, marginTop: 2 }}>{card.symbol}</div>
    </div>
  );
}

// ── Candlestick Chart ────────────────────────────────────────────────────────
function CandlestickChart({ data, T, range }) {
  const W = range === "1M" ? 700 : 600, H = 200, PAD = { top: 10, right: 10, bottom: 24, left: 52 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const highs = data.map(d => d.h);
  const lows  = data.map(d => d.l);
  const minP  = Math.min(...lows);
  const maxP  = Math.max(...highs);
  const priceRange = maxP - minP || 1;

  const scaleY  = p => cH - ((p - minP) / priceRange) * cH;
  // For 5Y (monthly candles) squeeze tighter so all ~60 fit
  const barW    = range === "1M"
    ? Math.max(1, (cW / data.length) * 0.5)
    : Math.max(1, Math.min(12, (cW / data.length) * 0.7));
  const spacing = cW / data.length;

  const fmt = n => n >= 1000
    ? `$${(n/1000).toFixed(1)}k`
    : `$${Number(n).toFixed(2)}`;

  // Y axis labels
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => minP + (priceRange * i) / yTicks);

  // X axis label formatter — changes based on range
  function formatXLabel(ts) {
    const dt = new Date(ts);
    if (range === "1M") {
      // 5Y chart — monthly candles → show year only
      return dt.getFullYear().toString();
    } else if (range === "1W") {
      // 1Y chart — weekly candles → show "Jan '25" style
      return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    } else if (range === "1D") {
      // 1M chart — daily candles → show "Mar 5"
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } else {
      // 5D chart — 15min candles → show "Mar 5"
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  }

  // X axis: for 5Y deduplicate so we only label each year once
  function getXLabels() {
    if (range === "1M") {
      // Group candles by year, pick the middle candle of each year for centering
      const byYear = {};
      data.forEach((d, i) => {
        const year = new Date(d.t).getFullYear();
        if (!byYear[year]) byYear[year] = [];
        byYear[year].push({ d, i });
      });
      return Object.values(byYear).map(candles => {
        const mid = Math.floor(candles.length / 2);
        return candles[mid];
      });
    }
    // All other ranges: ~5 evenly spaced
    const xStep = Math.ceil(data.length / 5);
    return data
      .map((d, i) => ({ d, i }))
      .filter(({ i }) => i % xStep === 0 || i === data.length - 1);
  }

  const xLabels = getXLabels();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <text x="300" y="9" textAnchor="middle" fontSize="8" fill="#aaa" fontFamily="monospace">{`${data.length} candles · ${data.length > 0 ? new Date(data[0].t).toLocaleDateString("en-US",{month:"short",year:"numeric"}) : ""} → ${data.length > 0 ? new Date(data[data.length-1].t).toLocaleDateString("en-US",{month:"short",year:"numeric"}) : ""}`}</text>
      {/* Y grid lines + labels */}
      {yLabels.map((v, i) => {
        const y = PAD.top + scaleY(v);
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
              stroke={T.border} strokeWidth="0.5" strokeDasharray="3,3" />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end"
              fontSize="9" fill={T.textFaint} fontFamily="'DM Mono',monospace">
              {fmt(v)}
            </text>
          </g>
        );
      })}

      {/* Candles */}
      {data.map((d, i) => {
        const x     = PAD.left + i * spacing + spacing / 2;
        const up    = d.c >= d.o;
        const col   = up ? T.green : T.red;
        const top   = PAD.top + scaleY(Math.max(d.o, d.c));
        const bot   = PAD.top + scaleY(Math.min(d.o, d.c));
        const hHi   = PAD.top + scaleY(d.h);
        const hLo   = PAD.top + scaleY(d.l);
        const bodyH = Math.max(1, bot - top);

        return (
          <g key={i}>
            <line x1={x} x2={x} y1={hHi} y2={hLo} stroke={col} strokeWidth="1" />
            <rect x={x - barW/2} y={top} width={barW} height={bodyH}
              fill={col} stroke={col} strokeWidth="0.5" fillOpacity={0.9} />
          </g>
        );
      })}

      {/* X axis labels */}
      {xLabels.map(({ d, i }) => {
        const x = PAD.left + i * spacing + spacing / 2;
        return (
          <text key={i} x={x} y={H - 4} textAnchor="middle"
            fontSize="9" fill={T.textFaint} fontFamily="'DM Mono',monospace">
            {formatXLabel(d.t)}
          </text>
        );
      })}
    </svg>
  );
}

// ── Pricing page (inline) ─────────────────────────────────────────────────────

function PricingPage({ T, font, mono, currentPlan, onUpgrade }) {
  const isFree = !currentPlan || currentPlan === "free";
  const proPriceId = import.meta.env.VITE_STRIPE_PRO_PRICE_ID;

  const freeFeatures = ["10 active alerts","Price above / below","% change alerts","Push & Email"];
  const proFeatures  = ["Unlimited alerts","All 12 trigger types","Multi-condition AND/OR","90-day backtesting","SMS & Webhook","Alert cooldown","Priority delivery"];

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", borderRadius: 18, overflow: "hidden", border: `1px solid ${T.border}` }}>
      {/* Cobalt hero header */}
      <div style={{ background: "#0a1f4a", padding: "36px 32px", textAlign: "center" }}>
        <div style={{ ...mono, fontSize: 9, letterSpacing: "3px", color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>CHOOSE YOUR PLAN</div>
        <div style={{ ...font, fontSize: 28, color: "#e8f2ff" }}>Top-Alerts Pricing</div>
        <div style={{ ...font, fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 8 }}>Start monitoring for free. Go Pro when you need more.</div>
      </div>

      {/* Two-column plans */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: T.bg }}>
        {/* Free column */}
        <div style={{ padding: "28px 24px", borderRight: `1px solid ${T.border}` }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: "2px", color: T.textFaint }}>FREE</div>
          <div style={{ ...font, fontSize: 36, color: T.text, margin: "8px 0 16px" }}>$0</div>
          {freeFeatures.map(f => (
            <div key={f} style={{ padding: "6px 0", ...font, fontSize: 13, color: T.textMid }}>· {f}</div>
          ))}
          {isFree && (
            <div style={{ ...mono, fontSize: 10, color: T.textFaint, textAlign: "center", marginTop: 20, padding: "8px 0", border: `1px solid ${T.border}`, borderRadius: 8 }}>✓ CURRENT PLAN</div>
          )}
        </div>

        {/* Pro column */}
        <div style={{ padding: "28px 24px" }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: "2px", color: "#378ADD" }}>PRO</div>
          <div style={{ ...font, fontSize: 36, color: T.text, margin: "8px 0 16px" }}>$9<span style={{ fontSize: 13, color: T.textFaint }}>/mo</span></div>
          {proFeatures.map(f => (
            <div key={f} style={{ padding: "6px 0", ...font, fontSize: 13, color: T.textMid }}>· {f}</div>
          ))}
          {isFree ? (
            <button onClick={() => proPriceId && onUpgrade(proPriceId)} style={{
              width: "100%", marginTop: 20, padding: 11, background: "#0a1f4a", color: "#e8f2ff",
              border: "none", borderRadius: 8, ...font, fontSize: 14, cursor: "pointer",
            }}>Upgrade →</button>
          ) : (
            <div style={{ ...mono, fontSize: 10, color: "#378ADD", textAlign: "center", marginTop: 20, padding: "8px 0", border: "1px solid rgba(55,138,221,0.3)", borderRadius: 8, background: "rgba(55,138,221,0.08)" }}>✓ PRO ACTIVE</div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "14px 0", borderTop: `1px solid ${T.border}`, background: T.bg }}>
        <span style={{ ...mono, fontSize: 10, color: T.textFaint }}>14-day money-back guarantee · Cancel anytime</span>
      </div>
    </div>
  );
}
