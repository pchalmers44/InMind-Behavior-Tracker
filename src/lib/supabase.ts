import { createClient } from "@supabase/supabase-js";
import { createPasswordRecovery } from "./password-recovery";
import { createPasswordUpdates } from "./password-update";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[supabase] Missing required public env vars.", {
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
  });
  throw new Error(
    "Supabase misconfiguration: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing."
  );
}

export const passwordUpdates = createPasswordUpdates(supabaseUrl);
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: passwordUpdates.fetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const passwordRecovery = createPasswordRecovery(supabase,
  typeof window === "undefined" ? undefined : window.location.href);
