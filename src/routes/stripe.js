// src/routes/stripe.js
//
// Handles Stripe webhook events to keep user plans in sync.
// Must be raw body parser (not JSON) for signature verification.

import { Router }   from "express";
import Stripe       from "stripe";
import { supabase } from "../lib/supabase.js";
import { config }   from "../config/index.js";

export const stripeRouter = Router();
const stripe = new Stripe(config.stripe.secretKey);

// Determine plan from Stripe price ID
function planFromPriceId(priceId) {
  if (priceId === config.stripe.proPriceId)  return "pro";
  if (priceId === config.stripe.teamPriceId) return "team";
  return "free";
}

// ── POST /stripe/webhook ──────────────────────────────────────────────────────

stripeRouter.post(
  "/webhook",
  // Raw body needed for signature verification — set in main index.js
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        config.stripe.webhookSecret
      );
    } catch (err) {
      console.error("[stripe] Webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`[stripe] Event: ${event.type}`);

    try {
      switch (event.type) {

        case "checkout.session.completed": {
          const session = event.data.object;
          const userId  = session.metadata?.user_id;
          if (!userId) break;

          const sub = await stripe.subscriptions.retrieve(session.subscription);
          const plan = planFromPriceId(sub.items.data[0]?.price?.id);

          await supabase.from("profiles").update({
            plan,
            stripe_customer_id:     session.customer,
            stripe_subscription_id: session.subscription,
          }).eq("id", userId);

          console.log(`[stripe] User ${userId} upgraded to ${plan}`);
          break;
        }

        case "customer.subscription.updated": {
          const sub    = event.data.object;
          const plan   = planFromPriceId(sub.items.data[0]?.price?.id);
          const status = sub.status; // active | past_due | canceled

          await supabase.from("profiles")
            .update({ plan: status === "active" ? plan : "free" })
            .eq("stripe_subscription_id", sub.id);
          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object;
          await supabase.from("profiles")
            .update({ plan: "free", stripe_subscription_id: null })
            .eq("stripe_subscription_id", sub.id);
          console.log(`[stripe] Subscription ${sub.id} cancelled — reverted to free`);
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;
          console.warn(`[stripe] Payment failed for subscription ${invoice.subscription}`);
          // Could send a dunning email here via Resend
          break;
        }
      }
    } catch (err) {
      console.error("[stripe] Handler error:", err.message);
    }

    res.json({ received: true });
  }
);

// ── POST /stripe/create-checkout ──────────────────────────────────────────────

stripeRouter.post("/create-checkout", async (req, res) => {
  const { priceId, userId, userEmail } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      mode:               "subscription",
      payment_method_types: ["card"],
      customer_email:     userEmail,
      line_items:         [{ price: priceId, quantity: 1 }],
      success_url:        "https://top-alerts.app/upgrade/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url:         "https://top-alerts.app/pricing",
      metadata:           { user_id: userId },
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /stripe/create-portal ────────────────────────────────────────────────

stripeRouter.post("/create-portal", async (req, res) => {
  const { userId } = req.body;
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();

  if (!profile?.stripe_customer_id) {
    return res.status(404).json({ error: "No Stripe customer found" });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer:   profile.stripe_customer_id,
    return_url: "https://top-alerts.app/settings",
  });

  res.json({ url: session.url });
});
