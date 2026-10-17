"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"
import { isTestMode, modeUserIds } from "@/lib/mode"
import { advanceBatch, advanceOrder, deliverOrders, notifyStatus, type DeliveryStatus, type MealSlot } from "@/lib/delivery"
import { recordCash } from "@/lib/cash"

export type { DeliveryStatus, MealSlot }

/**
 * Advance every (non-terminal) order in a batch for a given date to `newStatus`.
 * "delivered" is special: it runs the advance_batch_delivered RPC, which also
 * decrements each subscriber's deliveries_remaining and debits their wallet by
 * the per-meal cost (meal + add-ons) — atomically and idempotently.
 */
export async function advanceBatchStatus(
  batchId: string,
  date: string,
  newStatus: DeliveryStatus,
  slot: MealSlot
) {
  await requireAdminStrict()
  // Only the current mode's customers (Live / Test) — a batch can hold both,
  // and marking Live deliveries must never touch (or bill) test accounts.
  const isTest = await isTestMode()
  const userIds = await modeUserIds(isTest)
  let billingSummary: { billed: number; skipped_insufficient: number; already_settled: number } | null = null

  if (newStatus === "delivered") {
    // Orders this click can move — so only they get a message, not customers
    // whose order was already delivered (a re-click used to re-notify).
    const { data: candidates } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("batch_id", batchId)
      .eq("delivery_date", date)
      .eq("meal_slot", slot)
      .not("status", "in", "(delivered,cancelled,skipped)")
      .in("user_id", userIds)
    const candidateIds = (candidates ?? []).map((o: { id: string }) => o.id)

    const { data, error } = await supabaseAdmin.rpc("advance_batch_delivered", {
      p_batch: batchId,
      p_date: date,
      p_slot: slot,
      p_is_test: isTest,
    })
    if (error) throw error
    billingSummary = data
    if (candidateIds.length > 0) {
      await notifyStatus(candidateIds, "delivered", slot, null, `Batch ${batchId}, ${date} ${slot}`)
    }
  } else {
    await advanceBatch({ batchId, date, slot, status: newStatus, userIds })
  }

  revalidatePath("/operations")
  return billingSummary
}

/**
 * Same as advanceBatchStatus but for a single order — the per-subscriber
 * buttons on the Operations page. "delivered" runs advance_order_delivered
 * (migration 036), which mirrors advance_batch_delivered's billing/counter
 * logic exactly so the two paths can never diverge.
 */
export async function advanceOrderStatus(orderId: string, newStatus: DeliveryStatus, slot: MealSlot) {
  await requireAdminStrict()
  let result: "billed" | "skipped_insufficient" | "already_settled" | null = null

  if (newStatus === "delivered") {
    result = (await deliverOrders([orderId], slot))[orderId] ?? null
  } else {
    await advanceOrder(orderId, newStatus, slot)
  }

  revalidatePath("/operations")
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery partner app (migration 057): a drop the partner couldn't make,
// cash they say they collected, the handover photo.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

// A failed drop stays unbilled until the office decides: hand it over after
// all (billed like any delivery) or skip it — not charged, and the meal
// stays on the plan.
export async function resolveFailedDrop(orderId: string, outcome: "deliver" | "skip"): Promise<ActionResult> {
  await requireAdminStrict()
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, status, meal_slot")
    .eq("id", orderId)
    .maybeSingle()
  if (!order) return { ok: false, error: "Order not found." }
  if (["delivered", "cancelled", "skipped"].includes(order.status)) return { ok: false, error: "This meal is already settled." }

  if (outcome === "deliver") {
    const result = (await deliverOrders([orderId], order.meal_slot as MealSlot))[orderId]
    revalidatePath("/operations")
    revalidatePath("/dashboard")
    if (result === "skipped_insufficient") return { ok: true, message: "Wallet was short — skipped and the customer was told." }
    return { ok: true, message: "Marked delivered and billed." }
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({ status: "skipped", skip_reason: "not_delivered", updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .not("status", "in", "(delivered,cancelled,skipped)")
  if (error) return { ok: false, error: error.message }
  revalidatePath("/operations")
  revalidatePath("/dashboard")
  return { ok: true, message: "Skipped — not charged, and the meal stays on their plan." }
}

// Cash a partner reported: recording it is the normal "cash received"
// (payment, wallet credit, less cash due, message to the customer).
export async function recordCashReport(reportId: string, amountPaise?: number): Promise<ActionResult> {
  const admin = await requireAdminStrict()
  const { data: report } = await supabaseAdmin
    .from("cash_reports")
    .select("id, subscription_id, amount_paise, recorded_at, dismissed_at")
    .eq("id", reportId)
    .maybeSingle()
  if (!report) return { ok: false, error: "Report not found." }
  if (report.recorded_at || report.dismissed_at) return { ok: false, error: "Already dealt with." }

  // Claim the report first so a double click can't record the cash twice.
  const { data: claimed } = await supabaseAdmin
    .from("cash_reports")
    .update({ recorded_at: new Date().toISOString(), recorded_by: admin.id })
    .eq("id", reportId)
    .is("recorded_at", null)
    .is("dismissed_at", null)
    .select("id")
  if (!claimed?.length) return { ok: false, error: "Already dealt with." }

  const res = await recordCash(report.subscription_id, amountPaise ?? report.amount_paise)
  if (!res.ok) {
    await supabaseAdmin.from("cash_reports").update({ recorded_at: null, recorded_by: null }).eq("id", reportId)
    return res
  }
  await supabaseAdmin.from("cash_reports").update({ payment_id: res.paymentId }).eq("id", reportId)

  revalidatePath("/operations")
  revalidatePath("/dashboard")
  revalidatePath(`/subscribers/${report.subscription_id}`)
  return { ok: true, message: res.message }
}

export async function dismissCashReport(reportId: string): Promise<ActionResult> {
  const admin = await requireAdminStrict()
  const { data, error } = await supabaseAdmin
    .from("cash_reports")
    .update({ dismissed_at: new Date().toISOString(), dismissed_by: admin.id })
    .eq("id", reportId)
    .is("recorded_at", null)
    .is("dismissed_at", null)
    .select("subscription_id")
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: "Already dealt with." }
  revalidatePath("/operations")
  revalidatePath("/dashboard")
  revalidatePath(`/subscribers/${data[0].subscription_id}`)
  return { ok: true, message: "Report dismissed — nothing recorded." }
}

// Handover photos are private; a link lasts 5 minutes.
export async function deliveryPhotoUrl(orderId: string): Promise<string | null> {
  await requireAdmin()
  const { data: order } = await supabaseAdmin.from("orders").select("delivery_photo_path").eq("id", orderId).maybeSingle()
  if (!order?.delivery_photo_path) return null
  const { data } = await supabaseAdmin.storage.from("delivery-photos").createSignedUrl(order.delivery_photo_path, 300)
  return data?.signedUrl ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Kitchen closures (holidays, emergencies). Applies to everyone — Live and
// Test — since it's the kitchen that's closed. close_kitchen() cancels that
// slot's orders unbilled (the meals stay on each plan and get scheduled on
// later days) and notifies the customers; reopen_kitchen() brings them back
// while the slot is still open (migration 051).
// ─────────────────────────────────────────────────────────────────────────────

export async function previewKitchenClosure(date: string, slots: MealSlot[]) {
  await requireAdmin()
  const { data } = await supabaseAdmin
    .from("orders")
    .select("user_id")
    .eq("delivery_date", date)
    .in("meal_slot", slots)
    .in("status", ["scheduled", "confirmed", "preparing"])
  const rows = (data ?? []) as { user_id: string }[]
  return { orders: rows.length, customers: new Set(rows.map((r) => r.user_id)).size }
}

export async function closeKitchen(date: string, slots: MealSlot[], reason: string, notify: boolean) {
  const admin = await requireAdminStrict()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.")
  if (slots.length === 0) throw new Error("Pick lunch, dinner or both.")
  let cancelled = 0
  let customers = 0
  for (const slot of slots) {
    const { data, error } = await supabaseAdmin.rpc("close_kitchen", {
      p_date: date,
      p_slot: slot,
      p_reason: reason,
      p_admin: admin.id,
      p_notify: notify,
    })
    if (error) throw new Error(error.message)
    cancelled += data?.cancelled ?? 0
    customers += data?.customers ?? 0
  }
  revalidatePath("/operations")
  revalidatePath("/dashboard")
  return { cancelled, customers }
}

export async function reopenKitchen(date: string, slot: MealSlot, notify: boolean) {
  await requireAdminStrict()
  const { data, error } = await supabaseAdmin.rpc("reopen_kitchen", { p_date: date, p_slot: slot, p_notify: notify })
  if (error) throw new Error(error.message)
  revalidatePath("/operations")
  revalidatePath("/dashboard")
  return { revived: data?.revived ?? 0, note: (data?.note as string | undefined) ?? null }
}
