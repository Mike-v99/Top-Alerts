# Top-Alerts — Backend Engine

The core alert engine, price feed, and delivery worker for Top-Alerts.

## Architecture

```
src/
├── config/         Environment + config
├── lib/
│   ├── supabase.js  DB client (service role)
│   └── redis.js     Cache, queue, cooldowns
├── engine/
│   ├── priceFeed.js  Finnhub + Twelve Data with Redis cache
│   ├── indicators.js SMA, EMA, RSI, MACD, Bollinger Bands
│   ├── triggers.js   All 12 trigger evaluators
│   └── alertEngine.js Main poll loop (every 30s)
├── jobs/
│   └── deliveryWorker.js Push, Email, SMS, Webhook
├── routes/
│   ├── alerts.js     CRUD API (requires Supabase JWT)
│   └── stripe.js     Billing webhooks + checkout
└── index.js          Express server entry point
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in all required values
```

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase_schema.sql` in the SQL editor
3. Copy your project URL and service role key into `.env`

### 4. Set up Upstash Redis

1. Create a database at [upstash.com](https://upstash.com) (free tier)
2. Copy REST URL and token into `.env`

### 5. Get price API keys

- **Finnhub** — [finnhub.io](https://finnhub.io) — free, 60 req/min
- **Twelve Data** — [twelvedata.com](https://twelvedata.com) — free, 800 req/day

### 6. Set up delivery services

- **Resend** — [resend.com](https://resend.com) — free: 3,000 emails/mo
- **OneSignal** — [onesignal.com](https://onesignal.com) — free push notifications
- **Twilio** — [twilio.com](https://twilio.com) — SMS (Pro plan users only)

### 7. Run locally

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

## How the engine works

1. Every **30 seconds**, `alertEngine.js` loads all `active` alerts from Supabase
2. It groups them by asset and fetches **live prices** from Finnhub / Twelve Data
3. Prices are **cached in Redis** for 60 seconds — 100 users watching BTC still only = 1 API call
4. Each alert's trigger is **evaluated** using pure functions in `indicators.js` / `triggers.js`
5. If a trigger fires and the alert is **not on cooldown**, a delivery job is pushed to Redis queue
6. The `deliveryWorker.js` drains the queue, sending notifications via Push / Email / SMS / Webhook
7. The alert's `last_fired_at` and `fire_count` are updated in Supabase

## Trigger types

| ID | Plan | Description |
|---|---|---|
| `price_above` | Free | Price rises above target |
| `price_below` | Free | Price drops below target |
| `pct_change` | Free | % change exceeds threshold |
| `ma_cross_above` | Pro | Price crosses above moving average |
| `ma_cross_below` | Pro | Price crosses below moving average |
| `golden_cross` | Pro | 50MA crosses above 200MA |
| `death_cross` | Pro | 50MA crosses below 200MA |
| `rsi_overbought` | Pro | RSI rises above 70 |
| `rsi_oversold` | Pro | RSI falls below 30 |
| `macd_cross` | Pro | MACD line crosses signal line |
| `bb_breakout` | Pro | Price exits Bollinger Band |
| `volume_surge` | Pro | Volume exceeds N× average |

## Deployment

Recommended: **Railway** or **Render** (both have free tiers).

```bash
# Railway
railway up

# Render — add a Web Service pointing to npm start
```

Set all `.env` variables in your hosting platform's environment settings.
Configure your Stripe webhook to point to `https://your-domain.com/stripe/webhook`.
