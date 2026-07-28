"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { notifyUsers, logBroadcast } from "@/lib/notifications"

export type DeliveryStatus = "preparing" | "out_for_delivery" | "delivered"

// Statuses that are allowed to advance INTO the target (so re-clicking or going
// backwards is a no-op rather than an error).
const PRIOR: Record<Exclude<DeliveryStatus, "delivered">, string[]> = {
  preparing: ["scheduled", "confirmed"],
  out_for_delivery: ["scheduled", "confirmed", "preparing"],
}

// Only these two transitions are worth pinging a subscriber about — "preparing"
// is a kitchen-internal state, not something a customer needs to know about.
const NOTIFY_COPY: Partial<Record<DeliveryStatus, { title: string; body: string }>> = {
  out_for_delivery: {
    title: "Your meal is on its way!",
    body: "Today's delivery just left the kitchen — it'll be with you shortly.",
  },
  delivered: {
    title: "Delivered!",
    body: "Today's meal has been delivered. Enjoy!",
  },
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
  newStatus: DeliveryStatus
) {
  if (newStatus === "delivered") {
    const { error } = await supabaseAdmin.rpc("advance_batch_delivered", {
      p_batch: batchId,
      p_date: date,
    })
    if (error) throw error
  } else {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status: newStatus })
      .eq("batch_id", batchId)
      .eq("delivery_date", date)
      .in("status", PRIOR[newStatus])
    if (error) throw error
  }

  revalidatePath("/operations")

  const copy = NOTIFY_COPY[newStatus]
  if (copy) {
    await notifyAffectedSubscribers(batchId, date, newStatus, copy.title, copy.body)
  }
}

// Best-effort — a notification failure should never undo or block the actual
// status advance above, so this is deliberately swallowed on error.
async function notifyAffectedSubscribers(
  batchId: string,
  date: string,
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
      audience: { description: `Batch ${batchId}, ${date}, status=${status}`, count: recipients.length },
      results,
    })
  } catch {
    // best-effort — see comment above
  }
}
