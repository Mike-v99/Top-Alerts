// src/jobs/deliveryWorker.js
//
// Runs alongside the engine, draining the Redis delivery queue.
// Each job is processed independently — one failure won't block others.
//
// Delivery channels:
//   push    → OneSignal (free)
//   email   → Resend    (free: 3k/mo)
//   sms     → Twilio    (Pro plan)
//   webhook → HTTP POST (Pro plan)

import { Resend }    from "resend";
import OneSignal     from "onesignal-node";
import twilio        from "twilio";
import axios         from "axios";
import { supabase }  from "../lib/supabase.js";
import { dequeueDelivery } from "../lib/redis.js";
import { config }    from "../config/index.js";

// ── Clients ───────────────────────────────────────────────────────────────────

const resend = new Resend(config.delivery.resendKey);

const oneSignalClient = new OneSignal.Client(
  config.delivery.oneSignalAppId,
  config.delivery.oneSignalKey
);

const twilioClient = config.delivery.twilioSid?.startsWith("AC")
  ? twilio(config.delivery.twilioSid, config.delivery.twilioToken)
  : null;

// ── Worker loop ───────────────────────────────────────────────────────────────

let workerRunning = false;

export function startDeliveryWorker() {
  if (workerRunning) return;
  workerRunning = true;
  console.log("[delivery] Worker started");
  drainLoop();
}

export function stopDeliveryWorker() {
  workerRunning = false;
  console.log("[delivery] Worker stopped");
}

async function drainLoop() {
  while (workerRunning) {
    try {
      const job = await dequeueDelivery();
      if (job) {
        await processJob(job);
      } else {
        // Queue empty — wait before polling again
        await sleep(2000);
      }
    } catch (err) {
      console.error("[delivery] Loop error:", err.message);
      await sleep(5000);
    }
  }
}

// ── Job processor ─────────────────────────────────────────────────────────────

async function processJob(job) {
  console.log(`[delivery] Processing job for alert ${job.alertId} via ${job.delivery.join(", ")}`);

  const message = formatMessage(job);
  const delivered = [];

  // Load user profile for contact details
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", job.userId)
    .single();

  const userEmail = profile?.email;

  // Dispatch all channels concurrently
  const tasks = job.delivery.map(async (channel) => {
    try {
      switch (channel) {
        case "push":    await sendPush(job, message); break;
        case "email":   await sendEmail(job, message, userEmail); break;
        case "sms":     await sendSms(job, message, profile?.phone); break;
        case "webhook": await sendWebhook(job); break;
      }
      delivered.push(channel);
      console.log(`[delivery] ✓ ${channel} sent for alert ${job.alertId}`);
    } catch (err) {
      console.error(`[delivery] ✗ ${channel} failed for alert ${job.alertId}:`, err.message);
    }
  });

  await Promise.allSettled(tasks);

  // Update history record with delivery channels used
  if (delivered.length > 0) {
    await supabase
      .from("alert_history")
      .update({ delivered_via: delivered })
      .eq("alert_id", job.alertId)
      .order("fired_at", { ascending: false })
      .limit(1);
  }
}

// ── Channel handlers ──────────────────────────────────────────────────────────

async function sendPush(job, message) {
  const notification = new OneSignal.Notification();
  notification.contents = { en: message.body };
  notification.headings  = { en: message.title };
  notification.filters   = [
    { field: "tag", key: "user_id", relation: "=", value: job.userId }
  ];
  notification.data = {
    alertId:     job.alertId,
    asset:       job.asset,
    price:       job.price,
    triggerType: job.triggerType,
  };
  await oneSignalClient.createNotification(notification);
}

async function sendEmail(job, message, email) {
  if (!email) throw new Error("No email address for user");
  await resend.emails.send({
    from:    "Top-Alerts <alerts@top-alerts.app>",
    to:      email,
    subject: message.title,
    html:    buildEmailHtml(job, message),
  });
}

async function sendSms(job, message, phone) {
  if (!twilioClient) throw new Error("Twilio not configured");
  if (!phone) throw new Error("No phone number for user");
  await twilioClient.messages.create({
    body: `${message.title}\n${message.body}`,
    from: config.delivery.twilioPhone,
    to:   phone,
  });
}

async function sendWebhook(job) {
  if (!job.webhookUrl) throw new Error("No webhook URL configured");
  await axios.post(job.webhookUrl, {
    event:       "alert.fired",
    alertId:     job.alertId,
    asset:       job.asset,
    triggerType: job.triggerType,
    price:       job.price,
    reason:      job.reason,
    firedAt:     job.firedAt,
  }, {
    timeout: 10000,
    headers: { "Content-Type": "application/json", "User-Agent": "Top-Alerts/1.0" },
  });
}

// ── Message formatter ─────────────────────────────────────────────────────────

function formatMessage(job) {
  const price = typeof job.price === "number"
    ? `$${job.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : job.price;

  const triggerLabels = {
    price_above:    "Price target hit",
    price_below:    "Price target hit",
    pct_change:     "Price movement alert",
    ma_cross_above: "MA crossover (bullish)",
    ma_cross_below: "MA crossover (bearish)",
    golden_cross:   "Golden Cross detected",
    death_cross:    "Death Cross detected",
    rsi_overbought: "RSI overbought",
    rsi_oversold:   "RSI oversold",
    macd_cross:     "MACD crossover",
    bb_breakout:    "Bollinger Band breakout",
    volume_surge:   "Volume surge",
  };

  const title = `${job.asset} — ${triggerLabels[job.triggerType] || "Alert fired"}`;
  const body  = `Current price: ${price}. ${job.reason}`;

  return { title, body };
}

function buildEmailHtml(job, message) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f0e8;font-family:'Courier New',monospace">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ede9df;border:1px solid #d0c8b8;border-radius:12px;overflow:hidden">
        <!-- Header -->
        <tr><td style="background:#1a1200;padding:24px 32px">
          <span style="color:#f4f0e8;font-size:20px;letter-spacing:2px;font-weight:700">◈ TOP-ALERTS</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px">
          <p style="font-size:11px;color:#aaa090;letter-spacing:2px;margin:0 0 8px">ALERT TRIGGERED</p>
          <h1 style="font-size:22px;color:#1a1200;margin:0 0 16px;letter-spacing:1px">${message.title}</h1>
          <p style="font-size:14px;color:#6a6050;margin:0 0 24px;line-height:1.6">${message.body}</p>
          <table style="width:100%;background:#e6e2d8;border-radius:8px;border:1px solid #d0c8b8">
            <tr><td style="padding:16px">
              <div style="display:flex;justify-content:space-between">
                <span style="font-size:11px;color:#aaa090">ASSET</span>
                <span style="font-size:14px;color:#1a1200;font-weight:700">${job.asset}</span>
              </div>
              <div style="margin-top:8px">
                <span style="font-size:11px;color:#aaa090">FIRED AT</span>
                <span style="font-size:13px;color:#6a6050;margin-left:8px">${new Date(job.firedAt).toUTCString()}</span>
              </div>
            </td></tr>
          </table>
          <p style="font-size:11px;color:#aaa090;margin:24px 0 0;text-align:center">
            Manage your alerts at <a href="https://top-alerts.app" style="color:#8a6a00">top-alerts.app</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Util ──────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
