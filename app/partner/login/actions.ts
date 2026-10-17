"use server";

import { redirect } from "next/navigation";
import { createPartnerSupabase } from "@/lib/supabase-partner";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type PartnerLoginState = { error?: string } | undefined;

const WRONG = "Wrong phone number or password.";

// The login ID is the partner's phone number; the admin sets the password
// (Delivery Partners → App login). The Supabase account behind it has an
// internal email the partner never sees.
export async function partnerLogin(_prev: PartnerLoginState, formData: FormData): Promise<PartnerLoginState> {
  const digits = String(formData.get("phone") ?? "").replace(/\D/g, "").slice(-10);
  const password = String(formData.get("password") ?? "");
  if (digits.length !== 10 || !password) {
    return { error: "Enter your 10-digit phone number and password." };
  }

  const { data: partners } = await supabaseAdmin
    .from("delivery_partners")
    .select("id, phone, status, user_id")
    .not("user_id", "is", null);
  const partner = (partners ?? []).find(
    (p: { phone: string | null }) => (p.phone ?? "").replace(/\D/g, "").slice(-10) === digits
  );
  if (!partner) return { error: WRONG };
  if (partner.status !== "active") {
    return { error: "Your login is switched off. Please call the GreenFeast office." };
  }

  const { data: account } = await supabaseAdmin.auth.admin.getUserById(partner.user_id);
  const email = account?.user?.email;
  if (!email) return { error: WRONG };

  const supabase = await createPartnerSupabase();
  // A leftover session (e.g. a login the admin replaced) goes first.
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: WRONG };

  redirect("/partner");
}

export async function partnerLogout() {
  const supabase = await createPartnerSupabase();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/partner/login");
}
