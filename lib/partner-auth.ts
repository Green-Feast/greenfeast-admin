import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createPartnerSupabase } from "./supabase-partner";
import { supabaseAdmin } from "./supabase-admin";

export type PartnerSession = {
  partnerId: string;
  userId: string;
  name: string;
  phone: string;
  isTest: boolean;
};

// A signed-in session isn't enough: the account has to be linked to an
// active delivery_partners row (the admin's "Create login"). Setting the
// partner inactive or removing the login cuts them off at the next click.
async function partnerFor(userId: string): Promise<PartnerSession | null> {
  const { data: p } = await supabaseAdmin
    .from("delivery_partners")
    .select("id, name, phone, is_test, status, last_seen_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!p || p.status !== "active") return null;

  // "Last active" on the admin's Delivery Partners page — at most one write
  // every 5 minutes.
  const seen = p.last_seen_at ? new Date(p.last_seen_at).getTime() : 0;
  if (Date.now() - seen > 5 * 60 * 1000) {
    await supabaseAdmin.from("delivery_partners").update({ last_seen_at: new Date().toISOString() }).eq("id", p.id);
  }
  return { partnerId: p.id, userId, name: p.name, phone: p.phone, isTest: !!p.is_test };
}

// For pages: the JWT is checked locally (getClaims), like requireAdmin.
// Returns null instead of redirecting — the login page uses it to tell a
// signed-in partner from a session that no longer has access.
export const getPartner = cache(async (): Promise<PartnerSession | null> => {
  const supabase = await createPartnerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  return partnerFor(sub);
});

export const requirePartner = cache(async (): Promise<PartnerSession> => {
  const partner = await getPartner();
  if (!partner) redirect("/partner/login");
  return partner;
});

// For actions that bill deliveries or report cash: confirm the session with
// the Auth server itself, so a login the admin removed stops working at once
// (a still-unexpired JWT would otherwise pass for up to an hour).
export const requirePartnerStrict = cache(async (): Promise<PartnerSession> => {
  const supabase = await createPartnerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect("/partner/login");
  const partner = await partnerFor(user.id);
  if (!partner) redirect("/partner/login");
  return partner;
});
