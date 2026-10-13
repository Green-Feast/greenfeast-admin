"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { notifyUsers, logBroadcast } from "@/lib/notifications"
import { isTestMode, modeUserIds } from "@/lib/mode"

export type DeliveryStatus = "preparing" | "out_for_delivery" | "delivered"
export type MealSlot = "lunch" | "dinner"

// Statuses that are allowed to advance INTO the target (so re-clicking or going
// backwards is a no-op rather than an error).
const PRIOR: Record<Exclude<DeliveryStatus, "delivered">, string[]> = {
  preparing: ["scheduled", "confirmed"],
  out_for_delivery: ["scheduled", "confirmed", "preparing"],
}

// Only these two transitions are worth pinging a subscriber about — "preparing"
// is a kitchen-internal state, not something a customer needs to know about.
function notifyCopy(slot: MealSlot): Partial<Record<DeliveryStatus, { title: string; body: string }>> {
  return {
    out_for_delivery: {
      title: "Your meal is on its way!",
      body: `Today's ${slot} just left the kitchen — it'll be with you shortly.`,
    },
    delivered: {
      title: "Delivered!",
      body: `Today's ${slot} has been delivered. Enjoy!`,
    },
  }
}

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
  await requireAdmin()
  // Only the current mode's customers (Live / Test) — a batch can hold both,
  // and marking Live deliveries must never touch (or bill) test accounts.
  const isTest = await isTestMode()
  const userIds = await modeUserIds(isTest)
  let billingSummary: { billed: number; skipped_insufficient: number; already_settled: number } | null = null

  if (newStatus === "delivered") {
    const { data, error } = await supabaseAdmin.rpc("advance_batch_delivered", {
      p_batch: batchId,
      p_date: date,
      p_slot: slot,
      p_is_test: isTest,
    })
    if (error) throw error
    billingSummary = data
  } else {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status: newStatus })
      .eq("batch_id", batchId)
      .eq("delivery_date", date)
      .eq("meal_slot", slot)
      .in("status", PRIOR[newStatus])
      .in("user_id", userIds)
    if (error) throw error
  }

  revalidatePath("/operations")

  const copy = notifyCopy(slot)[newStatus]
  if (copy) {
    await notifyAffectedSubscribers(batchId, date, slot, newStatus, copy.title, copy.body, userIds)
  }

  return billingSummary
}

/**
 * Same as advanceBatchStatus but for a single order — the per-subscriber
 * buttons on the Operations page. "delivered" runs advance_order_delivered
 * (migration 036), which mirrors advance_batch_delivered's billing/counter
 * logic exactly so the two paths can never diverge.
 */
export async function advanceOrderStatus(orderId: string, newStatus: DeliveryStatus, slot: MealSlot) {
  await requireAdmin()
  let result: "billed" | "skipped_insufficient" | "already_settled" | null = null

  if (newStatus === "delivered") {
    const { data, error } = await supabaseAdmin.rpc("advance_order_delivered", { p_order: orderId })
    if (error) throw error
    result = data?.result ?? null
  } else {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId)
      .in("status", PRIOR[newStatus])
    if (error) throw error
  }

  revalidatePath("/operations")

  const copy = notifyCopy(slot)[newStatus]
  if (copy && result !== "skipped_insufficient" && result !== "already_settled") {
    await notifyOrderSubscriber(orderId, copy.title, copy.body, newStatus)
  }

  return result
}

// Same best-effort contract as notifyAffectedSubscribers — a notification
// failure must never undo or block the status advance above.
async function notifyOrderSubscriber(orderId: string, title: string, body: string, status: DeliveryStatus) {
  try {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("subscription_id, subscriptions ( user_id, users ( name, phone ) )")
      .eq("id", orderId)
      .single()
    if (!order) return

    const sub = Array.isArray(order.subscriptions) ? order.subscriptions[0] : order.subscriptions
    const user = Array.isArray((sub as any)?.users) ? (sub as any).users[0] : (sub as any)?.users
    if (!(sub as any)?.user_id) return

    const recipients = [{ user_id: (sub as any).user_id, name: (user as any)?.name ?? "Unknown", phone: (user as any)?.phone ?? null }]
    const results = await notifyUsers(recipients, title, body, "delivery_status", ["push"])
    await logBroadcast({
      type: "delivery_status",
      title,
      body,
      channels: ["push"],
      audience: { description: `Order ${orderId}, status=${status}`, count: 1 },
      results,
    })
  } catch {
    // best-effort — see comment above
  }
}

// Best-effort — a notification failure should never undo or block the actual
// status advance above, so this is deliberately swallowed on error.
async function notifyAffectedSubscribers(
  batchId: string,
  date: string,
  slot: MealSlot,
  status: DeliveryStatus,
  title: string,
  body: string,
  userIds: string[]
) {
  try {
    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("subscription_id")
      .eq("batch_id", batchId)
      .eq("delivery_date", date)
      .eq("meal_slot", slot)
      .eq("status", status)
      .in("user_id", userIds)
    const subIds = Array.from(new Set((orders ?? []).map((o) => o.subscription_id)))
    if (subIds.length === 0) return

    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, users ( name, phone )")
      .in("id", subIds)

    const recipients = (subs ?? []).map((s) => {
      const user = Array.isArray(s.users) ? s.users[0] : s.users
      return { user_id: s.user_id, name: (user as any)?.name ?? "Unknown", phone: (user as any)?.phone ?? null }
    })
    if (recipients.length === 0) return

    const results = await notifyUsers(recipients, title, body, "delivery_status", ["push"])
    await logBroadcast({
      type: "delivery_status",
      title,
      body,
      channels: ["push"],
      audience: { description: `Batch ${batchId}, ${date} ${slot}, status=${status}`, count: recipients.length },
      results,
    })
  } catch {
    // best-effort — see comment above
  }
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
  const admin = await requireAdmin()
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
  await requireAdmin()
  const { data, error } = await supabaseAdmin.rpc("reopen_kitchen", { p_date: date, p_slot: slot, p_notify: notify })
  if (error) throw new Error(error.message)
  revalidatePath("/operations")
  revalidatePath("/dashboard")
  return { revived: data?.revived ?? 0, note: (data?.note as string | undefined) ?? null }
}
