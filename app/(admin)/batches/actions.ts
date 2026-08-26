"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { syncFutureOrdersBatch } from "@/lib/batch-sync"

export type MealSlot = "lunch" | "dinner"

export async function createBatch(data: {
  name: string
  area?: string
  time_window: "morning" | "noon" | "evening"
  meal_slot: MealSlot
  primary_partner_id?: string
  secondary_partner_id?: string
}) {
  await requireAdmin()
  const { error } = await supabaseAdmin.from("batches").insert({
    ...data,
    primary_partner_id: data.primary_partner_id || null,
    secondary_partner_id: data.secondary_partner_id || null,
  })
  if (error) throw error
  revalidatePath("/batches")
}

export async function updateBatch(id: string, data: {
  name: string
  area?: string
  time_window: "morning" | "noon" | "evening"
  meal_slot: MealSlot
  primary_partner_id?: string
  secondary_partner_id?: string
}) {
  await requireAdmin()
  const { error } = await supabaseAdmin.from("batches").update({
    ...data,
    primary_partner_id: data.primary_partner_id || null,
    secondary_partner_id: data.secondary_partner_id || null,
  }).eq("id", id)
  if (error) throw error
  revalidatePath("/batches")
}

export async function deleteBatch(id: string) {
  await requireAdmin()
  const { count } = await supabaseAdmin
    .from("subscriptions")
    .select("*", { count: "exact", head: true })
    .or(`batch_id_lunch.eq.${id},batch_id_dinner.eq.${id}`)
    .in("status", ["active", "paused", "pending"])
  if ((count ?? 0) > 0) throw new Error("Batch has active subscribers. Reassign them first.")
  const { error } = await supabaseAdmin.from("batches").delete().eq("id", id)
  if (error) throw error
  revalidatePath("/batches")
}

export async function moveSubscriberToBatch(subscriptionId: string, batchId: string | null, slot: MealSlot) {
  await requireAdmin()
  const column = slot === "lunch" ? "batch_id_lunch" : "batch_id_dinner"
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({ [column]: batchId })
    .eq("id", subscriptionId)
  if (error) throw error
  await syncFutureOrdersBatch(subscriptionId, batchId, slot)
  revalidatePath("/batches")
}
