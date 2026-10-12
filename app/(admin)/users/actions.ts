"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { notifyUsers } from "@/lib/notifications"
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
  // INTERNAL_FN_SECRET (not SUPABASE_SECRET_KEY — see
  // app/api/cron/instantiate-orders/route.ts for why that doesn't work from
  // outside Supabase's own edge runtime) unlocks any subscription_id.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.INTERNAL_FN_SECRET
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !secret || !anonKey) return
  try {
    await fetch(`${url}/functions/v1/instantiate-orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        apikey: anonKey,
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
  await requireAdmin()
  const {
    userId, name, phone, hasPublicRow, planId, days,
    mealsLunch, mealsDinner, deliveryMode, activation, address,
    mealsLeft, walletCredit, addonIds, startDate,
  } = input

  if (!planId) return { ok: false, error: "Pick a plan." }
  if (!days || days.length === 0) return { ok: false, error: "Select at least one delivery day." }
  if (mealsLunch + mealsDinner < 1) return { ok: false, error: "Set at least one meal per day." }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false, error: "Pick a valid first delivery date." }
  const isCod = activation === "cod"
  if (!isCod) {
    if (!Number.isInteger(mealsLeft) || (mealsLeft as number) < 1 || (mealsLeft as number) > 500) {
      return { ok: false, error: "Meals left must be between 1 and 500." }
    }
    if (!Number.isInteger(walletCredit) || (walletCredit as number) < 0 || (walletCredit as number) > 20_000_000) {
      return { ok: false, error: "Wallet credit must be between ₹0 and ₹2,00,000." }
    }
  }

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
      deliveries_remaining: isCod ? 0 : (mealsLeft as number),
      // Orders start from here (instantiate-orders) — lets the app take over
      // from a chosen day without doubling up with the old process.
      start_date: startDate || null,
    })
    .select("id")
    .single()
  if (subErr || !sub) {
    // subscriptions_one_live_plan_per_user (migration 049)
    if (subErr?.code === "23505") return { ok: false, error: "This customer already has an active or paused plan." }
    return { ok: false, error: subErr?.message ?? "Could not create subscription." }
  }

  if (addonIds && addonIds.length > 0) {
    const { error: addonErr } = await supabaseAdmin.from("subscription_addons").insert(
      addonIds.map((id) => ({ subscription_id: sub.id, addon_id: id }))
    )
    if (addonErr) return { ok: false, error: `Plan created, but add-ons failed: ${addonErr.message}` }
  }

  // 5. Schedule — assign a starter meal to each selected day.
  const { data: starter } = await supabaseAdmin
    .from("meal_templates")
    .select("id")
    .eq("is_active", true)
    .eq("subscription_valid", true)
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

  // 7. Already paid outside the app: record it and put the money in the wallet.
  //    Meals are billed from the wallet at delivery and the 8 AM / 1 PM check
  //    skips meals it can't cover, so without this credit every meal of a
  //    customer moved over from the spreadsheet would be skipped.
  if (!isCod && (walletCredit as number) > 0) {
    const { error: payErr } = await supabaseAdmin.from("payments").insert({
      user_id: userId,
      subscription_id: sub.id,
      amount: walletCredit,
      status: "paid",
    })
    if (payErr) console.error("createSubscription: payment record failed:", payErr.message)

    const { error: creditErr } = await supabaseAdmin.rpc("wallet_credit", {
      p_user: userId,
      p_amount: walletCredit,
      p_reason: "Opening balance — moved from previous records",
      p_reference_id: sub.id,
    })
    if (creditErr) return { ok: false, error: `Plan created, but the wallet credit failed: ${creditErr.message}` }
  }

  if (!isCod) {
    const { data: who } = await supabaseAdmin.from("users").select("name, phone").eq("id", userId).maybeSingle()
    const rupees = `₹${((walletCredit as number) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    await notifyUsers(
      [{ user_id: userId, name: who?.name ?? "Customer", phone: who?.phone ?? null }],
      "Your GreenFeast plan is ready",
      `${mealsLeft} meals are set up in the app${(walletCredit as number) > 0 ? ` and ${rupees} is in your wallet` : ""}. Manage meals, skips and deliveries from My Plan.`,
      "custom",
      ["push"]
    )
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
  await requireAdmin()
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
  await requireAdmin()
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
  await requireAdmin()
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
  await requireAdmin()
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
  await requireAdmin()
  await supabaseAdmin.from("subscriptions")
    .update({ status: "active", pause_from: null, pause_until: null })
    .eq("id", subId)
  revalidatePath("/users")
}

export async function cancelSub(subId: string) {
  await requireAdmin()
  await supabaseAdmin.from("subscriptions").update({ status: "cancelled" }).eq("id", subId)
  await supabaseAdmin.from("orders").update({ status: "cancelled" })
    .eq("subscription_id", subId)
    .in("status", ["scheduled", "confirmed"])
  revalidatePath("/users")
}

export async function extendSub(subId: string, meals: number) {
  await requireAdmin()
  const { data } = await supabaseAdmin
    .from("subscriptions").select("deliveries_remaining").eq("id", subId).single()
  if (!data) return
  await supabaseAdmin.from("subscriptions")
    .update({ deliveries_remaining: data.deliveries_remaining + meals })
    .eq("id", subId)
  revalidatePath("/users")
}
