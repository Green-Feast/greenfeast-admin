import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "./supabase-server";
import { supabaseAdmin } from "./supabase-admin";

export type AdminUser = { id: string; email: string | null };

// The single gate every admin page/layout goes through. Two checks, not one:
// a valid Supabase session is not enough by itself — this Supabase project
// is shared with the consumer app, so any subscriber's login would otherwise
// work here too. admin_users is the actual allow-list.
//
// Speed: getClaims() verifies the session JWT locally against the project's
// ES256 signing key (fetched once and cached) instead of a round trip to the
// Auth server on every click, and React cache() runs this once per request —
// the layout and the page both call it, so it used to run twice per click.
export const requireAdmin = cache(async (): Promise<AdminUser> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) redirect("/login");

  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", claims.sub)
    .maybeSingle();

  if (!adminRow) redirect("/login");

  return { id: claims.sub, email: (claims.email as string | undefined) ?? null };
});
