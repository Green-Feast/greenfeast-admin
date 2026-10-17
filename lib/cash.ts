import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { notifyEvent } from "./notifications";

export type CashResult = { ok: true; message: string; paymentId: string } | { ok: false; error: string };

export function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/**
 * Cash a customer handed over (cash on delivery): a payment row, the same
 * amount into their wallet, less cash still due, and the "cash received"
 * message. Partial payments are fine. One path for the subscriber profile,
 * Operations and the cash delivery partners report — callers check who's
 * allowed (requireAdminStrict) first.
 */
export async function recordCash(subId: string, amountPaise: number): Promise<CashResult> {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > 20_000_000) {
    return { ok: false, error: "Enter an amount between ₹1 and ₹2,00,000." };
  }
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, status, plan_name, cod_due_paise, cod_on_credit")
    .eq("id", subId)
    .single();
  if (!sub) return { ok: false, error: "Subscription not found." };
  if (!["active", "paused"].includes(sub.status)) {
    return { ok: false, error: "Activate the plan first (it isn't live yet)." };
  }

  const { data: pay, error: payErr } = await supabaseAdmin
    .from("payments")
    .insert({ user_id: sub.user_id, subscription_id: subId, amount: amountPaise, status: "paid" })
    .select("id")
    .single();
  if (payErr || !pay) return { ok: false, error: `Payment record failed: ${payErr?.message ?? "unknown error"}` };

  const { error: creditErr } = await supabaseAdmin.rpc("wallet_credit", {
    p_user: sub.user_id,
    p_amount: amountPaise,
    p_reason: `Cash received — ${sub.plan_name ?? "plan"}`,
    p_reference_id: `cash_${pay.id}`,
  });
  if (creditErr) return { ok: false, error: `Payment recorded but the wallet credit failed: ${creditErr.message}` };

  const due = Math.max((sub.cod_due_paise ?? 0) - amountPaise, 0);
  await supabaseAdmin
    .from("subscriptions")
    .update({ cod_due_paise: due, cod_on_credit: due > 0 ? sub.cod_on_credit : false })
    .eq("id", subId);

  const { data: user } = await supabaseAdmin.from("users").select("name, phone").eq("id", sub.user_id).maybeSingle();
  await notifyEvent(
    "cash_received",
    [{ user_id: sub.user_id, name: user?.name ?? "Customer", phone: user?.phone ?? null }],
    { amount: rupees(amountPaise), cash_due: rupees(due) }
  );

  return {
    ok: true,
    paymentId: pay.id,
    message: due > 0 ? `${rupees(amountPaise)} recorded — ${rupees(due)} still to collect.` : `${rupees(amountPaise)} recorded — all cash collected.`,
  };
}
