"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"

export async function saveNotes(subId: string, notes: string) {
  await supabaseAdmin.from("subscriptions").update({ special_notes: notes }).eq("id", subId)
  revalidatePath(`/subscribers/${subId}`)
}

export async function pauseSubscription(subId: string, from: string, until: string) {
  await supabaseAdmin.from("subscriptions")
    .update({ status: "paused", pause_from: from, pause_until: until })
    .eq("id", subId)
  await supabaseAdmin.from("orders").update({ status: "cancelled" })
    .eq("subscription_id", subId)
    .gte("delivery_date", from)
    .lte("delivery_date", until)
    .in("status", ["scheduled", "confirmed"])
  revalidatePath(`/subscribers/${subId}`)
}

export async function resumeSubscription(subId: string) {
  await supabaseAdmin.from("subscriptions")
    .update({ status: "active", pause_from: null, pause_until: null })
    .eq("id", subId)
  revalidatePath(`/subscribers/${subId}`)
}

export async function cancelSubscription(subId: string) {
  await supabaseAdmin.from("subscriptions").update({ status: "cancelled" }).eq("id", subId)
  await supabaseAdmin.from("orders").update({ status: "cancelled" })
    .eq("subscription_id", subId)
    .in("status", ["scheduled", "confirmed"])
  revalidatePath(`/subscribers/${subId}`)
}

export async function extendSubscription(subId: string, meals: number) {
  const { data } = await supabaseAdmin
    .from("subscriptions").select("deliveries_remaining").eq("id", subId).single()
  if (!data) return
  await supabaseAdmin.from("subscriptions")
    .update({ deliveries_remaining: data.deliveries_remaining + meals })
    .eq("id", subId)
  revalidatePath(`/subscribers/${subId}`)
}

export async function markCodPaid(subId: string) {
  // Called when the delivery partner has collected the cash on first delivery.
  // Activates the CoD subscription, sets its delivery allowance, and logs a
  // paid payment row for the history.
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, plans ( meals_total, base_price )")
    .eq("id", subId)
    .single()
  if (!sub) return

  const plan = Array.isArray((sub as any).plans) ? (sub as any).plans[0] : (sub as any).plans

  await supabaseAdmin.from("subscriptions")
    .update({ status: "active", deliveries_remaining: plan?.meals_total ?? 0 })
    .eq("id", subId)

  await supabaseAdmin.from("payments").insert({
    user_id: (sub as any).user_id,
    subscription_id: subId,
    amount: plan?.base_price ?? 0,
    status: "paid",
  })

  revalidatePath(`/subscribers/${subId}`)
}

export async function changeBatch(subId: string, batchId: string | null) {
  await supabaseAdmin.from("subscriptions")
    .update({ batch_id: batchId || null })
    .eq("id", subId)
  revalidatePath(`/subscribers/${subId}`)
}
