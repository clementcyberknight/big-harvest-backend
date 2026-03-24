import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";

let singleton: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!singleton) {
    singleton = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return singleton;
}
