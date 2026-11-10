"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"
import { notifyEvent } from "@/lib/notifications"

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
// (undelivered meal, quality issue, wrong or missing item…).
export async function refundToWallet(userId: string, amountPaise: number, reason: string): Promise<RefundResult> {
  const admin = await requireAdminStrict()
  if (!userId) return { ok: false, error: "Pick a customer." }
  if (!validAmount(amountPaise)) return { ok: false, error: "Enter an amount between ₹1 and ₹1,00,000." }
  if (!reason.trim()) return { ok: false, error: "Add a reason — the customer sees it." }

  const { data: refund, error } = await supabaseAdmin
    .from("refunds")
    .insert({ user_id: userId, kind: "wallet", amount: amountPaise, reason: reason.trim(), status: "completed", created_by: admin.id })
    .select("id")
    .single()
  if (error || !refund) return { ok: false, error: `Could not record the refund: ${error?.message ?? "unknown error"}` }

  const { error: creditErr } = await supabaseAdmin.rpc("wallet_credit", {
    p_user: userId,
    p_amount: amountPaise,
    p_reason: `Refund — ${reason.trim()}`,
    p_reference_id: `refund_${refund.id}`,
  })
  if (creditErr) {
    await supabaseAdmin.from("refunds").update({ status: "failed", failure_note: creditErr.message }).eq("id", refund.id)
    return { ok: false, error: `Wallet credit failed: ${creditErr.message}` }
  }

  await notifyEvent("refund_wallet", [await recipient(userId)], { amount: rupees(amountPaise), reason: reason.trim() })

  revalidatePath("/rewards")
  return { ok: true, message: `${rupees(amountPaise)} added to the wallet and the customer was notified.` }
}

// Money back to the original UPI / card / bank through Cashfree, against one
// paid payment. The edge function deducts the same amount from the wallet.
export async function refundToBank(paymentId: string, amountPaise: number, reason: string): Promise<RefundResult> {
  const admin = await requireAdminStrict()
  if (!paymentId) return { ok: false, error: "Pick the payment to refund." }
  if (!validAmount(amountPaise)) return { ok: false, error: "Enter an amount between ₹1 and ₹1,00,000." }
  if (!reason.trim()) return { ok: false, error: "Add a reason — the customer sees it." }

  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/admin-refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INTERNAL_FN_SECRET}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payment_id: paymentId, amount_paise: amountPaise, reason: reason.trim(), admin_user_id: admin.id }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body?.ok) {
    revalidatePath("/rewards")
    return { ok: false, error: body?.error ?? `Refund failed (${res.status}).` }
  }

  await notifyEvent("refund_bank_started", [await recipient(body.user_id)], { amount: rupees(amountPaise) })

  revalidatePath("/rewards")
  return {
    ok: true,
    message: body.status === "completed"
      ? `${rupees(amountPaise)} refunded to the customer's bank.`
      : `${rupees(amountPaise)} refund sent to Cashfree — it shows as completed once the bank confirms.`,
  }
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
// (template meal_gift) by gift_meals().
export async function giftMeals(userId: string, meals: number, reason: string): Promise<RefundResult> {
  const admin = await requireAdminStrict()
  if (!Number.isInteger(meals) || meals < 1 || meals > 30) return { ok: false, error: "Gift between 1 and 30 meals." }
  if (!reason.trim()) return { ok: false, error: "Add a reason — the customer sees it." }
  const { data, error } = await supabaseAdmin.rpc("gift_meals", {
    p_user: userId, p_meals: meals, p_reason: reason.trim(), p_admin: admin.email ?? admin.id,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/rewards")
  const amount = (data as { amount?: number } | null)?.amount ?? 0
  return { ok: true, message: `${meals} meal${meals === 1 ? "" : "s"} (${rupees(amount)}) added to their wallet — they've been told.` }
}
