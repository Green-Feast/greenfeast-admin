"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { dbError, sensitive } from "@/lib/audit"
import { settleBalance, validProof, type SettleInput } from "@/lib/money-ops"
import type { ProofInput } from "@/components/payment-proof"

export type MoneyActionResult = { ok: true; message: string } | { ok: false; error: string }

// Proof for a payment recorded before the audit (method 'unrecorded'): how it
// was paid, its reference, the day. The database lets this happen once per
// payment, and never changes the amount (admin_add_payment_proof).
export async function addPaymentProof(paymentId: string, proof: ProofInput, password: string): Promise<MoneyActionResult> {
  return sensitive("money.addPaymentProof", password, { ref: paymentId, details: { method: proof.method, proof: proof.reference, paid_on: proof.paidOn } }, async (ctx): Promise<MoneyActionResult> => {
    const { data: pay } = await supabaseAdmin.from("payments").select("user_id, subscription_id, amount, method").eq("id", paymentId).maybeSingle()
    if (!pay) return { ok: false, error: "Payment not found." }
    if (pay.method !== "unrecorded") return { ok: false, error: "This payment already has its proof." }
    ctx.note({ userId: pay.user_id, subscriptionId: pay.subscription_id, amountPaise: pay.amount })
    const bad = validProof(proof, pay.amount)
    if (bad) return { ok: false, error: bad }
    if (proof.method === "cash_upi") return { ok: false, error: "For a cash + UPI payment from before, pick the main method and note the split in the reference." }
    const { error } = await supabaseAdmin.rpc("admin_add_payment_proof", {
      p_payment: paymentId, p_method: proof.method, p_reference: proof.reference.trim() || "Cash collected",
      p_paid_on: proof.paidOn, p_admin: ctx.admin.id, p_action: ctx.actionId,
    })
    if (error) return { ok: false, error: dbError(error, "Could not save the proof.") }
    revalidatePath("/money")
    return { ok: true, message: "Proof saved." }
  })
}

// A customer without a plan who still has wallet money: keep it as credit,
// refund it, or forfeit it (Money → Checks → balances to settle).
export async function settleCustomerBalance(userId: string, input: SettleInput, password: string): Promise<MoneyActionResult> {
  return sensitive("money.settleCustomerBalance", password, { userId, amountPaise: input.amountPaise, details: { decision: input.decision } }, async (ctx): Promise<MoneyActionResult> => {
    const { count } = await supabaseAdmin.from("subscriptions").select("id", { count: "exact", head: true })
      .eq("user_id", userId).in("status", ["active", "paused", "pending"])
    if ((count ?? 0) > 0) return { ok: false, error: "This customer has a plan now — the balance belongs to it." }
    const res = await settleBalance(ctx, userId, null, input)
    if (res.ok) revalidatePath("/money")
    return res.ok ? { ok: true, message: res.message } : res
  })
}
