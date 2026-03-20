-- ─────────────────────────────────────────────────────────────────────────────
-- Top-Alerts  ·  Supabase schema
-- Run this in the Supabase SQL editor to bootstrap the database.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ── Users (extends Supabase auth.users) ──────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  plan          text not null default 'free',   -- 'free' | 'pro' | 'team'
  stripe_customer_id  text,
  stripe_subscription_id text,
  alert_count   int  not null default 0,
  created_at    timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Alerts ────────────────────────────────────────────────────────────────────
create table public.alerts (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  asset         text not null,          -- e.g. 'BTC/USD', 'AAPL'
  asset_type    text not null,          -- 'crypto' | 'stock' | 'commodity'

  -- Trigger definition
  trigger_type  text not null,          -- see TRIGGER_TYPES in engine/triggers.js
  trigger_value jsonb not null default '{}',
  -- e.g. { "price": 105000 }
  -- e.g. { "percent": 5 }
  -- e.g. { "ma_period": 50 }
  -- e.g. { "band": "upper" }
  -- e.g. { "volume_multiplier": 3 }

  -- Multi-condition (Pro)
  is_multi      boolean not null default false,
  conditions    jsonb,
  -- e.g. [{ "trigger_type": "rsi_oversold", "op": "AND" }, ...]

  -- Delivery
  delivery      text[] not null default '{push}',  -- ['push','email','sms','webhook']
  webhook_url   text,
  cooldown_mins int not null default 60,

  -- State
  status        text not null default 'active',  -- 'active' | 'triggered' | 'paused' | 'deleted'
  last_fired_at timestamptz,
  fire_count    int not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index alerts_user_id_status on public.alerts(user_id, status);
create index alerts_asset_status   on public.alerts(asset, status);

-- ── Alert history ─────────────────────────────────────────────────────────────
create table public.alert_history (
  id            uuid primary key default uuid_generate_v4(),
  alert_id      uuid not null references public.alerts(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  asset         text not null,
  trigger_type  text not null,
  price_at_fire numeric,
  delivered_via text[],
  fired_at      timestamptz not null default now()
);

create index alert_history_user_id on public.alert_history(user_id, fired_at desc);

-- ── Row-level security ────────────────────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.alerts         enable row level security;
alter table public.alert_history  enable row level security;

-- Users can only see/modify their own data
create policy "own profile"   on public.profiles     for all using (auth.uid() = id);
create policy "own alerts"    on public.alerts       for all using (auth.uid() = user_id);
create policy "own history"   on public.alert_history for select using (auth.uid() = user_id);

-- Service role (used by the engine) bypasses RLS
