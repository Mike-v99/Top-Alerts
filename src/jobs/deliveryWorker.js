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
    .select("email, phone")
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
    from:    "Top-Alerts <alerts@top-alerts.com>",
    to:      email,
    subject: message.title,
    html:    buildEmailHtml(job, message),
  });
}

async function sendSms(job, message, phone) {
  if (!phone) throw new Error("No phone number for user");
  if (!twilioClient) throw new Error("Twilio not configured");
  await twilioClient.messages.create({
    body: `${message.title}\n${message.body}`,
    from: config.delivery.twilioFrom,
    to:   phone,
  });
}

async function sendWebhook(job) {
  if (!job.webhookUrl) throw new Error("No webhook URL configured for this alert");

  const payload = {
    event:        "alert.fired",
    alert_id:     job.alertId,
    asset:        job.asset,
    trigger_type: job.triggerType,
    reason:       job.reason,
    price:        job.price,
    fired_at:     job.firedAt,
    timestamp:    Date.now(),
  };

  await axios.post(job.webhookUrl, payload, {
    headers: {
      "Content-Type": "application/json",
      "User-Agent":   "Top-Alerts/1.0",
    },
    timeout: 10000,  // 10s timeout — don't hang the worker
  });
}

// ── Message formatting ────────────────────────────────────────────────────────

function formatMessage(job) {
  const priceStr = Number(job.price).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const triggerLabel = job.triggerType.replace(/_/g, " ");

  return {
    title: `🔔 ${job.asset} — ${triggerLabel}`,
    body:  `${job.reason} · Price: $${priceStr}`,
  };
}

function buildEmailHtml(job, message) {
  const priceStr = Number(job.price).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#faf9f6;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e8e4dc;">
    <div style="background:#0a1f4a;padding:28px 32px;">
      <div style="font-size:11px;letter-spacing:2px;color:rgba(255,255,255,0.5);margin-bottom:8px;">TOP-ALERTS</div>
      <div style="font-size:22px;color:#e8f2ff;font-weight:500;">${message.title}</div>
    </div>
    <div style="padding:28px 32px;">
      <div style="font-size:14px;color:#6a6050;line-height:1.6;margin-bottom:20px;">
        Your alert for <strong style="color:#1a1200">${job.asset}</strong> has been triggered.
      </div>
      <div style="background:#f4f2ed;border:1px solid #e8e4dc;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:12px;color:#aaa090;letter-spacing:1px;">TRIGGER</span>
          <span style="font-size:13px;color:#1a1200;font-weight:500;">${job.triggerType.replace(/_/g, " ")}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:12px;color:#aaa090;letter-spacing:1px;">PRICE</span>
          <span style="font-size:13px;color:#1a1200;font-weight:500;">$${priceStr}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="font-size:12px;color:#aaa090;letter-spacing:1px;">TIME</span>
          <span style="font-size:13px;color:#1a1200;font-weight:500;">${new Date(job.firedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
        </div>
      </div>
      <div style="font-size:12px;color:#aaa090;margin-bottom:4px;">${job.reason}</div>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e8e4dc;text-align:center;">
      <a href="https://top-alerts.com/app" style="font-size:14px;color:#0a1f4a;text-decoration:none;font-weight:500;">View in Top-Alerts →</a>
    </div>
  </div>
</body>
</html>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
