import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { PARTNER_COOKIE } from "./partner-cookie";

// Same as lib/supabase-server's client, but on the partner app's own session
// cookie (see lib/partner-cookie.ts). Only for knowing *which partner* is
// signed in — partner data is read and written with the service-role client
// after lib/partner-auth.ts has checked who they are.
export async function createPartnerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: PARTNER_COOKIE },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — safe to ignore;
            // proxy.ts refreshes the session cookie instead.
          }
        },
      },
    }
  );
}
