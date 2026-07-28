import "server-only";
import { redirect } from "next/navigation";
import { createServerSupabase } from "./supabase-server";
import { supabaseAdmin } from "./supabase-admin";

// The single gate every admin page/layout goes through. Two checks, not one:
// a valid Supabase session is not enough by itself — this Supabase project
// is shared with the consumer app, so any subscriber's login would otherwise
// work here too. admin_users is the actual allow-list.
export async function requireAdmin() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!adminRow) redirect("/login");

  return user;
}
