// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";
import { config } from "../config/index.js";

// Service-role client — bypasses RLS, only used server-side
export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey,
  { auth: { persistSession: false } }
);
