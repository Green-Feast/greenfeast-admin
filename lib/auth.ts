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

// For actions that move money, bill deliveries, create or delete accounts, or
// message customers: verify the session with the Auth server itself
// (getUser), so a session revoked by a password change or "sign out
// everywhere" stops working immediately — getClaims() alone would accept the
// still-unexpired token for up to its lifetime (~1 hour). Costs one extra
// round trip, only on these clicks.
export const requireAdminStrict = cache(async (): Promise<AdminUser> => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!adminRow) redirect("/login");

  return { id: user.id, email: user.email ?? null };
});
