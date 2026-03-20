// src/config/index.js
import "dotenv/config";

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || "3000"),
  env:  process.env.NODE_ENV || "development",

  supabase: {
    url:        required("SUPABASE_URL"),
    serviceKey: required("SUPABASE_SERVICE_KEY"),
  },

  redis: {
    url:   required("UPSTASH_REDIS_REST_URL"),
    token: required("UPSTASH_REDIS_REST_TOKEN"),
  },

  prices: {
    finnhubKey:    required("FINNHUB_API_KEY"),
    twelveDataKey: required("TWELVE_DATA_API_KEY"),
    cacheTtl:      parseInt(process.env.PRICE_CACHE_TTL_SECONDS || "60"),
  },

  engine: {
    pollIntervalMs: parseInt(process.env.ENGINE_POLL_INTERVAL_MS || "30000"),
  },

  delivery: {
    resendKey:       required("RESEND_API_KEY"),
    oneSignalAppId:  required("ONESIGNAL_APP_ID"),
    oneSignalKey:    required("ONESIGNAL_API_KEY"),
    twilioSid:       process.env.TWILIO_ACCOUNT_SID,
    twilioToken:     process.env.TWILIO_AUTH_TOKEN,
    twilioPhone:     process.env.TWILIO_PHONE_NUMBER,
  },

  stripe: {
    secretKey:      required("STRIPE_SECRET_KEY"),
    webhookSecret:  required("STRIPE_WEBHOOK_SECRET"),
    proPriceId:     required("STRIPE_PRO_PRICE_ID"),
    teamPriceId:    required("STRIPE_TEAM_PRICE_ID"),
  },
};
