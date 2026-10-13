"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"
import { syncFutureOrdersBatch } from "@/lib/batch-sync"
import { istToday, isSlotLocked } from "@/lib/ist"

type OrderRef = { id: string; delivery_date: string; meal_slot: "lunch" | "dinner" }

// Today's slots past their cutoff are already cooked / on the kitchen sheet —
// pause, resume and cancel leave those orders alone (same rule as the app's
// manage-subscription function).
function openIds(rows: OrderRef[] | null): string[] {
  return (rows ?? []).filter((o) => !isSlotLocked(o.delivery_date, o.meal_slot)).map((o) => o.id)
}

export async function saveNotes(subId: string, notes: string) {
  await requireAdmin()
  await supabaseAdmin.from("subscriptions").update({ special_notes: notes }).eq("id", subId)
  revalidatePath(`/subscribers/${subId}`)
}

export async function pauseSubscription(subId: string, from: string, until: string) {
  await requireAdmin()
  await supabaseAdmin.from("subscriptions")
    .update({ status: "paused", pause_from: from, pause_until: until })
    .eq("id", subId)
  const { data: inRange } = await supabaseAdmin.from("orders")
    .select("id, delivery_date, meal_slot")
    .eq("subscription_id", subId)
    .gte("delivery_date", from)
    .lte("delivery_date", until)
    .in("status", ["scheduled", "confirmed"])
  const ids = openIds(inRange as OrderRef[] | null)
  // skip_reason 'pause' marks the pause's own cancellations so resume can
  // revive exactly those.
  if (ids.length > 0) {
    await supabaseAdmin.from("orders").update({ status: "cancelled", skip_reason: "pause" }).in("id", ids)
  }
  revalidatePath(`/subscribers/${subId}`)
}

export async function resumeSubscription(subId: string) {
  await requireAdmin()
  await supabaseAdmin.from("subscriptions")
    .update({ status: "active", pause_from: null, pause_until: null })
    .eq("id", subId)
  // Bring back the meals the pause cancelled (it used to leave them cancelled,
  // and the nightly order job can't recreate a day that already has an order).
  // Removed extra dishes are 'cancelled' too and stay gone.
  const { data: paused } = await supabaseAdmin.from("orders")
    .select("id, delivery_date, meal_slot")
    .eq("subscription_id", subId)
    .gte("delivery_date", istToday())
    .eq("status", "cancelled")
    .or("skip_reason.eq.pause,and(skip_reason.is.null,extra_dish.eq.false)")
  const ids = openIds(paused as OrderRef[] | null)
  if (ids.length > 0) {
    await supabaseAdmin.from("orders").update({ status: "scheduled", skip_reason: null }).in("id", ids)
  }
  revalidatePath(`/subscribers/${subId}`)
}

export async function cancelSubscription(subId: string) {
  await requireAdminStrict()
  await supabaseAdmin.from("subscriptions").update({ status: "cancelled" }).eq("id", subId)
  const { data: open } = await supabaseAdmin.from("orders")
    .select("id, delivery_date, meal_slot")
    .eq("subscription_id", subId)
    .in("status", ["scheduled", "confirmed"])
  // Anything still scheduled for a past date was never delivered, so it's
  // cancelled too; only today's slots past cutoff are kept.
  const ids = (open as OrderRef[] | null ?? [])
    .filter((o) => o.delivery_date !== istToday() || !isSlotLocked(o.delivery_date, o.meal_slot))
    .map((o) => o.id)
  if (ids.length > 0) {
    await supabaseAdmin.from("orders").update({ status: "cancelled" }).in("id", ids)
  }
  revalidatePath(`/subscribers/${subId}`)
}

export async function extendSubscription(subId: string, meals: number) {
  await requireAdminStrict()
  const { data } = await supabaseAdmin
    .from("subscriptions").select("deliveries_remaining").eq("id", subId).single()
  if (!data) return
  await supabaseAdmin.from("subscriptions")
    .update({ deliveries_remaining: data.deliveries_remaining + meals })
    .eq("id", subId)
  revalidatePath(`/subscribers/${subId}`)
}

// Plan price, same formula as the app and cashfree-create-order:
// base price + sum(add-on price per meal) x meals in the plan.
async function planTotal(subId: string, plan: { base_price: number; meals_total: number }) {
  const { data: subAddons } = await supabaseAdmin
    .from("subscription_addons")
    .select("addons ( price_per_meal )")
    .eq("subscription_id", subId)
  const addonPerMeal = ((subAddons as any[]) ?? []).reduce((sum, row) => {
    const a = Array.isArray(row.addons) ? row.addons[0] : row.addons
    return sum + (a?.price_per_meal ?? 0)
  }, 0)
  return plan.base_price + addonPerMeal * plan.meals_total
}

export async function markCodPaid(subId: string) {
  await requireAdminStrict()
  // "Mark cash received": the delivery partner has collected the cash. Records
  // the payment, credits it to the wallet, activates the plan and tells the
  // customer. CoD wallets are no longer funded at signup (that was free wallet
  // money for anyone who picked CoD); until this runs, a pending CoD plan is
  // delivered on credit (migration 044) and its wallet can go negative.
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, status, payment_method, plan_name, plans ( meals_total, base_price )")
    .eq("id", subId)
    .single()
  if (!sub) throw new Error("Subscription not found.")
  if ((sub as any).payment_method !== "cod" || (sub as any).status !== "pending") {
    throw new Error("This plan isn't waiting for a cash payment.")
  }
  const plan = Array.isArray((sub as any).plans) ? (sub as any).plans[0] : (sub as any).plans
  if (!plan) throw new Error("Plan not found.")

  const userId = (sub as any).user_id as string
  const amount = await planTotal(subId, plan)

  // Payment record first: an unrecorded cash collection is a revenue hole.
  const { error: payErr } = await supabaseAdmin.from("payments").insert({
    user_id: userId,
    subscription_id: subId,
    amount,
    status: "paid",
  })
  if (payErr) throw new Error(`Payment record failed: ${payErr.message}`)

  // Same reference as an online plan payment (the subscription id): CoD plans
  // created before this change were already credited at signup, so marking
  // their cash can't credit them twice.
  const { error: creditErr } = await supabaseAdmin.rpc("wallet_credit", {
    p_user: userId,
    p_amount: amount,
    p_reason: `Cash received — ${(sub as any).plan_name ?? "plan"}`,
    p_reference_id: subId,
  })
  if (creditErr) throw new Error(`Payment recorded but the wallet credit failed: ${creditErr.message}`)

  // Deliveries made on credit before the cash was marked already count.
  const { data: delivered } = await supabaseAdmin
    .from("orders")
    .select("quantity")
    .eq("subscription_id", subId)
    .eq("status", "delivered")
  const used = ((delivered as { quantity: number | null }[]) ?? []).reduce((s, o) => s + (o.quantity ?? 1), 0)

  // A new plan after the old one ran out: close the finished plan first (one
  // live plan per customer, migration 049) and take over its delivery batches
  // (this plan's orders were created at signup, before it had any, so they're
  // synced below).
  const { data: retired } = await supabaseAdmin.rpc("retire_previous_subscriptions", { p_new_sub: subId })

  await supabaseAdmin.from("subscriptions")
    .update({ status: "active", deliveries_remaining: Math.max(plan.meals_total - used, 0) })
    .eq("id", subId)
    .eq("status", "pending")

  // (batches inherited from a retired plan — see above)
  if ((retired ?? 0) > 0) {
    const { data: now } = await supabaseAdmin
      .from("subscriptions").select("batch_id_lunch, batch_id_dinner").eq("id", subId).single()
    if (now?.batch_id_lunch) await syncFutureOrdersBatch(subId, now.batch_id_lunch, "lunch")
    if (now?.batch_id_dinner) await syncFutureOrdersBatch(subId, now.batch_id_dinner, "dinner")
  }

  await supabaseAdmin.from("notifications").insert({
    user_id: userId,
    title: "Payment received",
    body: `We've received your cash payment of ₹${(amount / 100).toLocaleString("en-IN")}. Your plan is now active — thank you!`,
    type: "custom",
  })

  revalidatePath(`/subscribers/${subId}`)
}

export async function changeBatch(subId: string, batchId: string | null, slot: "lunch" | "dinner") {
  await requireAdmin()
  const column = slot === "lunch" ? "batch_id_lunch" : "batch_id_dinner"
  await supabaseAdmin.from("subscriptions")
    .update({ [column]: batchId || null })
    .eq("id", subId)
  await syncFutureOrdersBatch(subId, batchId || null, slot)
  revalidatePath(`/subscribers/${subId}`)
}
