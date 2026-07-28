import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Component / Server Action Supabase client, backed by the request's
// auth cookies (anon key, respects RLS — this is for reading *who's signed
// in*, not for admin data access; use lib/supabase-admin's service-role
// client for that).
//
// setAll() throwing is expected and safe to ignore when this is called from
// a Server Component render (Server Components can't set cookies) — proxy.ts
// refreshes the session cookie on every request instead, so the session
// still stays alive.
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
            // Called from a Server Component render — safe to ignore.
          }
        },
      },
    }
  );
}
