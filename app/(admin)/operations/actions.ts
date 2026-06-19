"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"

export type DeliveryStatus = "preparing" | "out_for_delivery" | "delivered"

// Statuses that are allowed to advance INTO the target (so re-clicking or going
// backwards is a no-op rather than an error).
const PRIOR: Record<Exclude<DeliveryStatus, "delivered">, string[]> = {
  preparing: ["scheduled", "confirmed"],
  out_for_delivery: ["scheduled", "confirmed", "preparing"],
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
}
