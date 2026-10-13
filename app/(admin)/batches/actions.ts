"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"

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
    .from("addresses")
    .select("*", { count: "exact", head: true })
    .or(`batch_id_lunch.eq.${id},batch_id_dinner.eq.${id}`)
    .is("archived_at", null)
  if ((count ?? 0) > 0) throw new Error("Addresses are still on this batch. Move them to another batch first.")
  const { error } = await supabaseAdmin.from("batches").delete().eq("id", id)
  if (error) throw error
  revalidatePath("/batches")
}

// Batches belong to addresses (migration 052). Setting one moves every
// upcoming meal going to that address in that slot onto the batch (trigger
// addresses_batch_changed), so Operations follows straight away.
export async function setAddressBatch(addressId: string, slot: MealSlot, batchId: string | null) {
  await requireAdmin()
  if (batchId) {
    const { data: batch } = await supabaseAdmin.from("batches").select("meal_slot").eq("id", batchId).maybeSingle()
    if (!batch) throw new Error("Batch not found.")
    if (batch.meal_slot !== slot) throw new Error(`That's a ${batch.meal_slot} batch.`)
  }
  const column = slot === "lunch" ? "batch_id_lunch" : "batch_id_dinner"
  const { error } = await supabaseAdmin.from("addresses").update({ [column]: batchId }).eq("id", addressId)
  if (error) throw error
  revalidatePath("/batches")
  revalidatePath("/operations")
  revalidatePath("/dashboard")
}
