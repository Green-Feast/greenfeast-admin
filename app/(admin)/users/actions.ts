"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import type { CreateSubInput } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete every app-data row that belongs to a user, child-first so foreign keys
 * never block the delete. Several FKs to public.users / public.subscriptions have
 * NO cascade (payments, orders, wallet_transactions), so order matters:
 *   payments → wallet_transactions → orders → subscriptions (cascades schedule/
 *   addons/order_*) → dietary_profiles → addresses → wallets → questionnaire →
 *   notifications.
 * The auth + public.users rows themselves are left intact (reset) or removed by
 * the caller afterwards (delete).
 */
async function wipeUserData(userId: string) {
  await supabaseAdmin.from("payments").delete().eq("user_id", userId)
  await supabaseAdmin.from("wallet_transactions").delete().eq("user_id", userId)
  await supabaseAdmin.from("orders").delete().eq("user_id", userId)
  await supabaseAdmin.from("subscriptions").delete().eq("user_id", userId)
  await supabaseAdmin.from("dietary_profiles").delete().eq("user_id", userId)
  await supabaseAdmin.from("addresses").delete().eq("user_id", userId)
  await supabaseAdmin.from("wallets").delete().eq("user_id", userId)
  await supabaseAdmin.from("questionnaire_responses").delete().eq("user_id", userId)
  await supabaseAdmin.from("notifications").delete().eq("user_id", userId)
}

async function instantiateOrders(subscriptionId: string) {
  // Reuse the tested edge function (ingredient snapshot, addon copy, pause skip).
  // Service-role key in the Authorization header unlocks any subscription_id.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/functions/v1/instantiate-orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subscription_id: subscriptionId }),
    })
  } catch (e) {
    // Non-fatal — the nightly cron will pick the subscription up regardless.
    console.error("instantiate-orders call failed:", e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create subscription (admin-side onboarding)
// ─────────────────────────────────────────────────────────────────────────────

export async function createSubscription(
  input: CreateSubInput
): Promise<{ ok: boolean; error?: string }> {
  const {
    userId, name, phone, hasPublicRow, planId, days,
    mealsLunch, mealsDinner, deliveryMode, activation, address,
  } = input

  if (!planId) return { ok: false, error: "Pick a plan." }
  if (!days || days.length === 0) return { ok: false, error: "Select at least one delivery day." }
  if (mealsLunch + mealsDinner < 1) return { ok: false, error: "Set at least one meal per day." }

  // 1. Ensure a public.users row exists (phone is NOT NULL UNIQUE).
  if (!hasPublicRow) {
    if (!phone?.trim()) return { ok: false, error: "Phone is required to create this user's profile." }
    const { error: userErr } = await supabaseAdmin
      .from("users")
      .insert({ id: userId, name: name?.trim() || null, phone: phone.trim(), onboarded: false })
    if (userErr) {
      return { ok: false, error: userErr.code === "23505" ? "That phone number is already in use." : userErr.message }
    }
  }

  // 2. Look up plan economics.
  const { data: plan, error: planErr } = await supabaseAdmin
    .from("plans")
    .select("id, name, meals_total, base_price")
    .eq("id", planId)
    .single()
  if (planErr || !plan) return { ok: false, error: "Plan not found." }

  // 3. Optional default address (needed for orders to carry a delivery address).
  if (address?.line1?.trim()) {
    const { error: addrErr } = await supabaseAdmin.from("addresses").insert({
      user_id: userId,
      label: address.label || "Home",
      type: address.type || "home",
      line1: address.line1.trim(),
      city: "Jaipur",
      pincode: address.pincode || null,
      landmark: address.landmark?.trim() || null,
      is_default: true,
    })
    if (addrErr) return { ok: false, error: `Address: ${addrErr.message}` }
  }

  const isCod = activation === "cod"

  // 4. Create the subscription row.
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      plan_name: plan.name,
      status: isCod ? "pending" : "active",
      payment_method: isCod ? "cod" : "online",
      delivery_mode: deliveryMode,
      meals_per_day: mealsLunch + mealsDinner,
      meals_lunch: mealsLunch,
      meals_dinner: mealsDinner,
      deliveries_remaining: isCod ? 0 : plan.meals_total,
    })
    .select("id")
    .single()
  if (subErr || !sub) return { ok: false, error: subErr?.message ?? "Could not create subscription." }

  // 5. Schedule — assign a starter meal to each selected day.
  const { data: starter } = await supabaseAdmin
    .from("meal_templates")
    .select("id")
    .eq("is_active", true)
    .order("category")
    .limit(1)
    .single()
  if (starter) {
    await supabaseAdmin.from("subscription_schedule").insert(
      days.map((day) => ({
        subscription_id: sub.id,
        day_of_week: day,
        meal_template_id: starter.id,
      }))
    )
  }

  // 6. Wallet + onboarding flag.
  await supabaseAdmin.from("wallets").upsert(
    { user_id: userId, balance: 0 },
    { onConflict: "user_id", ignoreDuplicates: true }
  )
  await supabaseAdmin.from("users").update({ onboarded: true }).eq("id", userId)

  // 7. Activated-now subs log a paid payment for history.
  if (!isCod) {
    await supabaseAdmin.from("payments").insert({
      user_id: userId,
      subscription_id: sub.id,
      amount: plan.base_price,
      status: "paid",
    })
  }

  // 8. Generate the next 14 days of orders (active + CoD-pending are eligible).
  await instantiateOrders(sub.id)

  revalidatePath("/users")
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Destructive / profile actions
// ─────────────────────────────────────────────────────────────────────────────

/** Wipe app data but keep the login, so onboarding can be re-tested fresh. */
export async function resetUserData(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await wipeUserData(userId)
    await supabaseAdmin.from("users").update({ onboarded: false }).eq("id", userId)
    revalidatePath("/users")
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Reset failed." }
  }
}

/** Remove the user entirely — app data first, then the auth + public.users rows. */
export async function deleteUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await wipeUserData(userId)
    await supabaseAdmin.from("users").delete().eq("id", userId)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (error) return { ok: false, error: error.message }
    revalidatePath("/users")
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Delete failed." }
  }
}

export async function editUserProfile(
  userId: string,
  name: string,
  phone: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle()

  const payload = { name: name.trim() || null, phone: phone.trim() }
  const { error } = existing
    ? await supabaseAdmin.from("users").update(payload).eq("id", userId)
    : await supabaseAdmin.from("users").insert({ id: userId, ...payload, onboarded: false })

  if (error) {
    return { ok: false, error: error.code === "23505" ? "That phone number is already in use." : error.message }
  }
  revalidatePath("/users")
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline subscription management (mirrors subscribers/[id]/actions.ts, but also
// revalidates /users so the table updates in place)
// ─────────────────────────────────────────────────────────────────────────────

export async function pauseSub(subId: string, from: string, until: string) {
  await supabaseAdmin.from("subscriptions")
    .update({ status: "paused", pause_from: from, pause_until: until })
    .eq("id", subId)
  await supabaseAdmin.from("orders").update({ status: "cancelled" })
    .eq("subscription_id", subId)
    .gte("delivery_date", from)
    .lte("delivery_date", until)
    .in("status", ["scheduled", "confirmed"])
  revalidatePath("/users")
}

export async function resumeSub(subId: string) {
  await supabaseAdmin.from("subscriptions")
    .update({ status: "active", pause_from: null, pause_until: null })
    .eq("id", subId)
  revalidatePath("/users")
}

export async function cancelSub(subId: string) {
  await supabaseAdmin.from("subscriptions").update({ status: "cancelled" }).eq("id", subId)
  await supabaseAdmin.from("orders").update({ status: "cancelled" })
    .eq("subscription_id", subId)
    .in("status", ["scheduled", "confirmed"])
  revalidatePath("/users")
}

export async function extendSub(subId: string, meals: number) {
  const { data } = await supabaseAdmin
    .from("subscriptions").select("deliveries_remaining").eq("id", subId).single()
  if (!data) return
  await supabaseAdmin.from("subscriptions")
    .update({ deliveries_remaining: data.deliveries_remaining + meals })
    .eq("id", subId)
  revalidatePath("/users")
}
