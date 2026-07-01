// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT
// One shared connection to your Supabase project, used everywhere in the app.
// The URL + publishable key come from the .env file (VITE_ vars). The
// publishable key is designed to be safe in the browser — it only allows what
// your Row Level Security policies permit.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  // Helpful console message if the .env file is missing or misnamed.
  console.error(
    "Supabase env vars missing. Check your .env file has VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then restart the dev server."
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,      // keep the user logged in across page reloads
    autoRefreshToken: true,    // silently refresh the login token before it expires
  },
});
