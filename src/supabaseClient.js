// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT
// One shared connection to your Supabase project, used everywhere in the app.
// The URL + publishable key come from the .env file (VITE_ vars). The
// publishable key is designed to be safe in the browser — it only allows what
// your Row Level Security policies permit.
//
// IMPORTANT: if the keys are missing (e.g. env vars not set on the host), we do
// NOT crash the app. `supabase` is simply null, guests can still play, and the
// login features quietly stay unavailable instead of white-screening the game.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,      // keep the user logged in across page reloads
      autoRefreshToken: true,    // silently refresh the login token before it expires
    },
  });
} else {
  console.error(
    "Supabase env vars missing (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY). " +
    "Login features are disabled, but the game still works. If this is the deployed " +
    "site, add these env vars in your Vercel project settings and redeploy."
  );
}

export { supabase };
