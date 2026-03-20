-- ─────────────────────────────────────────────────────────────────────────────
-- Top-Alerts  ·  Schema addon (run AFTER supabase_schema.sql)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper: increment alert_count ────────────────────────────────────────────
-- Called by the API when a user creates an alert
create or replace function public.increment_alert_count(user_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.profiles
  set alert_count = alert_count + 1
  where id = user_id;
end;
$$;

-- ── Helper: decrement alert_count ────────────────────────────────────────────
-- Called by the API when a user deletes an alert
create or replace function public.decrement_alert_count(user_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.profiles
  set alert_count = greatest(alert_count - 1, 0)  -- never go below 0
  where id = user_id;
end;
$$;

-- ── Helper: generic increment (used by alertEngine for fire_count) ────────────
create or replace function public.increment(x int)
returns int language sql immutable as $$
  select x + 1;
$$;

-- ── Plan enforcement view ─────────────────────────────────────────────────────
-- Handy read-only view to check a user's current plan limits at a glance
create or replace view public.user_plan_status as
select
  p.id                                          as user_id,
  p.email,
  p.plan,
  p.alert_count,
  case p.plan
    when 'free' then 3
    when 'pro'  then 999999
    when 'team' then 999999
    else 3
  end                                           as alert_limit,
  p.alert_count >= case p.plan
    when 'free' then 3
    else 999999
  end                                           as at_limit,
  p.stripe_customer_id,
  p.stripe_subscription_id,
  p.created_at
from public.profiles p;

-- ── Stripe billing columns (already in schema, listed here for reference) ─────
-- profiles.plan                  → 'free' | 'pro' | 'team'
-- profiles.stripe_customer_id    → set by Stripe checkout webhook
-- profiles.stripe_subscription_id → set by Stripe checkout webhook
--
-- Flow:
--   1. User clicks "Upgrade to Pro" in the app
--   2. Frontend calls POST /stripe/create-checkout
--   3. User completes Stripe Checkout
--   4. Stripe fires checkout.session.completed webhook to POST /stripe/webhook
--   5. Backend updates profiles.plan = 'pro' and stores customer/subscription IDs
--   6. On cancellation, customer.subscription.deleted fires → plan reverts to 'free'
