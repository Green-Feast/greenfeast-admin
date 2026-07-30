"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { notifyUsers, logBroadcast } from "@/lib/notifications"

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
  let billingSummary: { billed: number; skipped_insufficient: number; already_settled: number } | null = null

  if (newStatus === "delivered") {
    const { data, error } = await supabaseAdmin.rpc("advance_batch_delivered", {
      p_batch: batchId,
      p_date: date,
      p_slot: slot,
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
    if (error) throw error
  }

  revalidatePath("/operations")

  const copy = notifyCopy(slot)[newStatus]
  if (copy) {
    await notifyAffectedSubscribers(batchId, date, slot, newStatus, copy.title, copy.body)
  }

  return billingSummary
}

// Best-effort — a notification failure should never undo or block the actual
// status advance above, so this is deliberately swallowed on error.
async function notifyAffectedSubscribers(
  batchId: string,
  date: string,
  slot: MealSlot,
  status: DeliveryStatus,
  title: string,
  body: string
) {
  try {
    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("subscription_id")
      .eq("batch_id", batchId)
      .eq("delivery_date", date)
      .eq("meal_slot", slot)
      .eq("status", status)
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
