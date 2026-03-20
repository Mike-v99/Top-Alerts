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
    from:    "Top-Alerts <alerts@top-alerts.com>",
    to:      email,
    subject: message.title,
    html:    buildEmailHtml(
