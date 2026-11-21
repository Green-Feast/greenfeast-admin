"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { notifyEvent } from "@/lib/notifications"
import { background } from "@/lib/background"
import { instantiateForUser } from "@/lib/instantiate"
import { dbError, sensitive } from "@/lib/audit"
import { bankRefund } from "@/lib/money-ops"

export type RefundResult = { ok: true; message: string } | { ok: false; error: string }

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

function validAmount(amountPaise: number) {
  return Number.isInteger(amountPaise) && amountPaise > 0 && amountPaise <= 10_000_000 // ≤ ₹1,00,000
}

async function recipient(userId: string) {
  const { data } = await supabaseAdmin.from("users").select("name, phone").eq("id", userId).maybeSingle()
  return { user_id: userId, name: data?.name ?? "Customer", phone: data?.phone ?? null }
}

// Store credit — the default under the Refunds & Cancellations policy
// (undelivered meal, quality issue, wrong or missing item…). One transaction
// in the database (admin_refund_to_wallet): the refund row and the credit,
// stamped with the admin and this action.
export async function refundToWallet(userId: string, amountPaise: number, reason: string, password: string): Promise<RefundResult> {
  return sensitive("rewards.refundToWallet", password, { userId, amountPaise, details: { reason } }, async (ctx): Promise<RefundResult> => {
    if (!userId) return { ok: false, error: "Pick a customer." }
    if (!validAmount(amountPaise)) return { ok: false, error: "Enter an amount between ₹1 and ₹1,00,000." }
    if (!reason.trim()) return { ok: false, error: "Add a reason — the customer sees it." }
    const { data: refundId, error } = await supabaseAdmin.rpc("admin_refund_to_wallet", {
      p_user: userId, p_amount: amountPaise, p_reason: reason.trim(), p_admin: ctx.admin.id, p_action: ctx.actionId,
    })
    if (error) return { ok: false, error: dbError(error, "Could not record the refund.") }
    ctx.note({ ref: refundId as string })
    background(async () => notifyEvent("refund_wallet", [await recipient(userId)], { amount: rupees(amountPaise), reason: reason.trim() }))
    // Meals this money now pays for are made now, not at 1 AM.
    background(() => instantiateForUser(userId))
    revalidatePath("/rewards")
    revalidatePath("/money")
    return { ok: true, message: `${rupees(amountPaise)} added to the wallet and the customer was notified.` }
  })
}

// Money back to the original UPI / card / bank through Cashfree, against one
// paid payment. The edge function deducts the same amount from the wallet.
export async function refundToBank(paymentId: string, amountPaise: number, reason: string, password: string): Promise<RefundResult> {
  return sensitive("rewards.refundToBank", password, { amountPaise, details: { payment_id: paymentId, reason } }, async (ctx): Promise<RefundResult> => {
    if (!paymentId) return { ok: false, error: "Pick the payment to refund." }
    if (!validAmount(amountPaise)) return { ok: false, error: "Enter an amount between ₹1 and ₹1,00,000." }
    if (!reason.trim()) return { ok: false, error: "Add a reason — the customer sees it." }
    const r = await bankRefund(ctx, paymentId, amountPaise, reason)
    revalidatePath("/rewards")
    revalidatePath("/money")
    if (!r.ok) return r
    background(async () => notifyEvent("refund_bank_started", [await recipient(r.userId)], { amount: rupees(amountPaise) }))
    return {
      ok: true,
      message: r.status === "completed"
        ? `${rupees(amountPaise)} refunded to the customer's bank.`
        : `${rupees(amountPaise)} refund sent to Cashfree — it shows as completed once the bank confirms.`,
    }
  })
}

// Money handed back outside Cashfree — cash, UPI from our account, a bank
// transfer — with its reference (admin_refund_offline). Taken from the wallet.
export async function refundOffline(
  userId: string, amountPaise: number, method: "cash" | "upi" | "bank_transfer", reference: string, reason: string, password: string
): Promise<RefundResult> {
  return sensitive("rewards.refundOffline", password, { userId, amountPaise, details: { method, reference, reason } }, async (ctx): Promise<RefundResult> => {
    if (!userId) return { ok: false, error: "Pick a customer." }
    if (!validAmount(amountPaise)) return { ok: false, error: "Enter an amount between ₹1 and ₹1,00,000." }
    if (!reason.trim()) return { ok: false, error: "Add a reason." }
    const { data: refundId, error } = await supabaseAdmin.rpc("admin_refund_offline", {
      p_user: userId, p_amount: amountPaise, p_method: method, p_reference: reference, p_reason: reason.trim(),
      p_admin: ctx.admin.id, p_action: ctx.actionId,
    })
    if (error) return { ok: false, error: dbError(error, "Could not record the refund.") }
    ctx.note({ ref: refundId as string })
    revalidatePath("/rewards")
    revalidatePath("/money")
    return { ok: true, message: `${rupees(amountPaise)} refund recorded and taken from the wallet.` }
  })
}

// ── Gifts (081) ─────────────────────────────────────────────────────────────

// What one meal's worth is for this customer: their live plan's meal price +
// default add-ons, or the 30-meal plan's meal price with no live plan.
export async function mealWorth(userId: string): Promise<number | null> {
  await requireAdmin()
  const { data, error } = await supabaseAdmin.rpc("meal_worth", { p_user: userId })
  if (error) return null
  return (data as number | null) ?? null
}

// Gift meals: a meal's worth × meals into the wallet, recorded and messaged
// (template meal_gift) by gift_meals(), stamped with the admin (092).
export async function giftMeals(userId: string, meals: number, reason: string, password: string): Promise<RefundResult> {
  return sensitive("rewards.giftMeals", password, { userId, details: { meals, reason } }, async (ctx): Promise<RefundResult> => {
    if (!Number.isInteger(meals) || meals < 1 || meals > 30) return { ok: false, error: "Gift between 1 and 30 meals." }
    if (!reason.trim()) return { ok: false, error: "Add a reason — the customer sees it." }
    const { data, error } = await supabaseAdmin.rpc("admin_gift_meals", {
      p_user: userId, p_meals: meals, p_reason: reason.trim(), p_admin: ctx.admin.id, p_admin_email: ctx.admin.email, p_action: ctx.actionId,
    })
    if (error) return { ok: false, error: dbError(error, "Could not gift the meals.") }
    const amount = (data as { amount?: number } | null)?.amount ?? 0
    ctx.note({ amountPaise: amount })
    background(() => instantiateForUser(userId))
    revalidatePath("/rewards")
    revalidatePath("/money")
    return { ok: true, message: `${meals} meal${meals === 1 ? "" : "s"} (${rupees(amount)}) added to their wallet — they've been told.` }
  })
}

// Gift money (104): an amount into the wallet, recorded as a gift; the
// customer is told it's about N meals. Up to 30 meals' worth.
export async function giftMoney(userId: string, amountPaise: number, reason: string, password: string): Promise<RefundResult> {
  return sensitive("rewards.giftMoney", password, { userId, amountPaise, details: { reason } }, async (ctx): Promise<RefundResult> => {
    if (!Number.isInteger(amountPaise) || amountPaise < 100) return { ok: false, error: "Enter an amount." }
    if (!reason.trim()) return { ok: false, error: "Add a reason — the customer sees it." }
    const { data, error } = await supabaseAdmin.rpc("admin_gift_money", {
      p_user: userId, p_amount: amountPaise, p_reason: reason.trim(), p_admin: ctx.admin.id, p_admin_email: ctx.admin.email, p_action: ctx.actionId,
    })
    if (error) return { ok: false, error: dbError(error, "Could not add the gift.") }
    const about = (data as { about_meals?: number } | null)?.about_meals ?? 0
    background(() => instantiateForUser(userId))
    revalidatePath("/rewards")
    revalidatePath("/money")
    return { ok: true, message: `${rupees(amountPaise)} added to their wallet${about ? ` (about ${about} meal${about === 1 ? "" : "s"})` : ""} — they've been told.` }
  })
}
