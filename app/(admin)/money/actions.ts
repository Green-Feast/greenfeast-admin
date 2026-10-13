"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"
import { notifyUsers } from "@/lib/notifications"

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

  await notifyUsers(
    [await recipient(userId)],
    "Refund added to your wallet",
    `${rupees(amountPaise)} has been added to your GreenFeast wallet. Reason: ${reason.trim()}`,
    "custom",
    ["push"]
  )

  revalidatePath("/money")
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
    revalidatePath("/money")
    return { ok: false, error: body?.error ?? `Refund failed (${res.status}).` }
  }

  await notifyUsers(
    [await recipient(body.user_id)],
    "Refund started",
    `${rupees(amountPaise)} is being refunded to your original payment method. Banks usually take 5–7 working days.`,
    "custom",
    ["push"]
  )

  revalidatePath("/money")
  return {
    ok: true,
    message: body.status === "completed"
      ? `${rupees(amountPaise)} refunded to the customer's bank.`
      : `${rupees(amountPaise)} refund sent to Cashfree — it shows as completed once the bank confirms.`,
  }
}
