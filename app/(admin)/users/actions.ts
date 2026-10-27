"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"
import { notifyEvent } from "@/lib/notifications"
import { instantiateOrders } from "@/lib/instantiate"
import { isTestMode } from "@/lib/mode"
import { tempPassword } from "@/lib/temp-password"
import type { CreateSubInput, NewCustomer } from "./types"

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

// ─────────────────────────────────────────────────────────────────────────────
// Create subscription (admin-side onboarding)
// ─────────────────────────────────────────────────────────────────────────────

export async function createSubscription(
  input: CreateSubInput
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminStrict()
  const {
    userId, name, phone, hasPublicRow, planId, days,
    mealsLunch, mealsDinner, activation, address,
    mealsLeft, walletCredit, addonIds, startDate, cashDue, couponId,
  } = input

  if (!planId) return { ok: false, error: "Pick a plan." }
  if (!days || days.length === 0) return { ok: false, error: "Select at least one delivery day." }
  if (mealsLunch + mealsDinner < 1) return { ok: false, error: "Set at least one meal per day." }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false, error: "Pick a valid first delivery date." }
  // Cash on delivery set up by the admin: whatever was paid upfront goes in
  // the wallet (walletCredit, can be 0) and the plan runs on credit until the
  // rest (cashDue) is recorded — the wallet may go negative meanwhile.
  const isCod = activation === "cod"
  if (!Number.isInteger(mealsLeft) || (mealsLeft as number) < 1 || (mealsLeft as number) > 500) {
    return { ok: false, error: "Meals left must be between 1 and 500." }
  }
  if (!Number.isInteger(walletCredit) || (walletCredit as number) < 0 || (walletCredit as number) > 20_000_000) {
    return { ok: false, error: "Amount paid must be between ₹0 and ₹2,00,000." }
  }
  const due = isCod ? (cashDue ?? 0) : 0
  if (!Number.isInteger(due) || due < 0 || due > 20_000_000) {
    return { ok: false, error: "Cash to collect must be between ₹0 and ₹2,00,000." }
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

  // 2b. A coupon (admin → Coupons): its price for this plan becomes the plan's
  //     meal price. The admin may use any working coupon, whoever it's for.
  let coupon: { id: string; mealPrice: number; regular: number } | null = null
  if (couponId) {
    const { data: c } = await supabaseAdmin.from("coupons").select("code").eq("id", couponId).maybeSingle()
    if (!c) return { ok: false, error: "That coupon no longer exists." }
    const { data: quote, error: quoteErr } = await supabaseAdmin.rpc("coupon_quote", {
      p_user: userId, p_code: c.code, p_plan: plan.id, p_addon_per_meal: 0, p_kind: "admin", p_exclude_sub: null,
    })
    if (quoteErr) return { ok: false, error: quoteErr.message }
    if (!quote?.ok) return { ok: false, error: `Coupon ${c.code}: ${quote?.error ?? "not valid"}` }
    coupon = { id: couponId, mealPrice: quote.meal_price_paise, regular: quote.regular_meal_price_paise }
  }

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
      status: "active",
      payment_method: isCod ? "cod" : "online",
      cod_due_paise: due,
      cod_on_credit: isCod && due > 0,
      menu_type: "M1",
      // Every plan runs every chosen day and is skipped day by day — the app
      // has no opt-in either (delivery_mode is only a label).
      delivery_mode: "opt-out",
      meals_per_day: mealsLunch + mealsDinner,
      meals_lunch: mealsLunch,
      meals_dinner: mealsDinner,
      deliveries_remaining: mealsLeft as number,
      // Orders start from here (instantiate-orders) — lets the app take over
      // from a chosen day without doubling up with the old process.
      start_date: startDate || null,
      meal_price_paise: coupon?.mealPrice ?? null,
      coupon_id: coupon?.id ?? null,
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

  // 7. Already paid outside the app (or the cash-on-delivery upfront): record it
  //    and put the money in the wallet. Meals are billed from the wallet at
  //    delivery and the 8 AM / 1 PM check skips meals it can't cover, so
  //    without this credit every meal of a customer moved over from the
  //    spreadsheet would be skipped (cash-on-delivery plans run on credit).
  const saved = coupon ? (coupon.regular - coupon.mealPrice) * (mealsLeft as number) : 0
  let paymentId: string | null = null
  if ((walletCredit as number) > 0) {
    const { data: payment, error: payErr } = await supabaseAdmin.from("payments").insert({
      user_id: userId,
      subscription_id: sub.id,
      amount: walletCredit,
      status: "paid",
      coupon_id: coupon?.id ?? null,
      meal_price_paise: coupon?.mealPrice ?? null,
      discount_paise: coupon ? saved : null,
    }).select("id").single()
    if (payErr) console.error("createSubscription: payment record failed:", payErr.message)
    paymentId = (payment?.id as string | undefined) ?? null

    const { error: creditErr } = await supabaseAdmin.rpc("wallet_credit", {
      p_user: userId,
      p_amount: walletCredit,
      p_reason: isCod ? "Paid upfront — cash on delivery plan" : "Opening balance — moved from previous records",
      p_reference_id: sub.id,
    })
    if (creditErr) return { ok: false, error: `Plan created, but the wallet credit failed: ${creditErr.message}` }
  }

  if (coupon) {
    const { error: redErr } = await supabaseAdmin.from("coupon_redemptions").insert({
      coupon_id: coupon.id,
      user_id: userId,
      subscription_id: sub.id,
      payment_id: paymentId,
      plan_id: plan.id,
      kind: "admin",
      meal_price_paise: coupon.mealPrice,
      regular_meal_price_paise: coupon.regular,
      meals: mealsLeft as number,
      discount_paise: saved,
    })
    if (redErr) console.error("createSubscription: coupon use not recorded:", redErr.message)
  }

  // 8. Generate the next 14 days of orders.
  await instantiateOrders(sub.id)

  const { data: who } = await supabaseAdmin.from("users").select("name, phone").eq("id", userId).maybeSingle()
  const rupees = `₹${((walletCredit as number) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
  await notifyEvent(
    "plan_ready",
    [{ user_id: userId, name: who?.name ?? "Customer", phone: who?.phone ?? null }],
    { meals: mealsLeft as number, wallet_note: (walletCredit as number) > 0 ? ` and ${rupees} is in your wallet` : "" }
  )

  revalidatePath("/users")
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Destructive / profile actions
// ─────────────────────────────────────────────────────────────────────────────

/** Wipe app data but keep the login, so onboarding can be re-tested fresh. */
export async function resetUserData(userId: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdminStrict()
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
  await requireAdminStrict()
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
  await requireAdminStrict()
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
  await requireAdminStrict()
  await supabaseAdmin.from("subscriptions").update({ status: "cancelled" }).eq("id", subId)
  await supabaseAdmin.from("orders").update({ status: "cancelled" })
    .eq("subscription_id", subId)
    .in("status", ["scheduled", "confirmed"])
  revalidatePath("/users")
}

export async function extendSub(subId: string, meals: number) {
  await requireAdminStrict()
  const { data } = await supabaseAdmin
    .from("subscriptions").select("deliveries_remaining").eq("id", subId).single()
  if (!data) return
  await supabaseAdmin.from("subscriptions")
    .update({ deliveries_remaining: data.deliveries_remaining + meals })
    .eq("id", subId)
  revalidatePath("/users")
}

// ─────────────────────────────────────────────────────────────────────────────
// Live / Test
// ─────────────────────────────────────────────────────────────────────────────

/** Move an account between Live and Test. Going Live gives a test account a real GF- code. */
export async function setUserTestFlag(userId: string, isTest: boolean): Promise<{ ok: boolean; error?: string }> {
  await requireAdminStrict()
  const { error } = await supabaseAdmin.rpc("set_user_test_flag", { p_user: userId, p_is_test: isTest })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/users")
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Add a customer without them signing up first
// ─────────────────────────────────────────────────────────────────────────────


/**
 * A new temporary password for an existing customer (forgot it, or never had
 * one — a Google / Apple sign-in gets one too, on the same email). The app
 * asks them to set their own on the next sign-in (must_change_password), the
 * same as a login made with "Add customer". Their other sign-in methods keep
 * working, and nobody is signed out.
 */
export async function generateCustomerPassword(userId: string): Promise<
  { ok: true; password: string; email: string; name: string; phone: string | null; provider: string } | { ok: false; error: string }
> {
  await requireAdminStrict()
  const { data: found, error: findErr } = await supabaseAdmin.auth.admin.getUserById(userId)
  const authUser = found?.user
  if (findErr || !authUser) return { ok: false, error: "Login not found." }
  if (authUser.user_metadata?.gf_account === "partner") return { ok: false, error: "That's a delivery partner — use Delivery Partners → App login." }
  const email = authUser.email?.trim()
  if (!email) return { ok: false, error: "This account has no email to log in with." }

  const password = tempPassword()
  // user_metadata is merged, not replaced — only the flag changes.
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { must_change_password: true },
  })
  if (error) return { ok: false, error: `Couldn't set the password: ${error.message}` }

  const { data: profile } = await supabaseAdmin.from("users").select("name, phone").eq("id", userId).maybeSingle()
  return {
    ok: true,
    password,
    email,
    name: profile?.name?.trim() || (authUser.user_metadata?.full_name as string | undefined) || "there",
    phone: profile?.phone ?? null,
    provider: (authUser.app_metadata?.provider as string | undefined) ?? "email",
  }
}

/**
 * Creates an email + password login for a customer (e.g. an existing customer
 * being moved over), with a temporary password the admin shares. The account
 * is flagged must_change_password, so the app asks them to set their own on
 * first sign-in. Signing in later with Google on the same (verified) email
 * links to this account automatically.
 */
export async function createCustomerAccount(input: {
  name: string
  email: string
  phone: string
}): Promise<{ ok: true; customer: NewCustomer; tempPassword: string } | { ok: false; error: string }> {
  await requireAdminStrict()
  const isTest = await isTestMode()

  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const digits = input.phone.replace(/\D/g, "").slice(-10)
  if (!name) return { ok: false, error: "Enter their name." }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." }
  if (!/^[6-9]\d{9}$/.test(digits)) return { ok: false, error: "Enter a 10-digit Indian mobile number." }
  const phone = `+91${digits}`

  const { data: taken } = await supabaseAdmin
    .from("users").select("customer_code").eq("phone", phone).maybeSingle()
  if (taken) return { ok: false, error: `That phone number already belongs to ${taken.customer_code ?? "another account"}.` }

  const password = tempPassword()
  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, must_change_password: true },
  })
  if (authErr || !created?.user) {
    const msg = authErr?.message ?? "Could not create the login."
    return { ok: false, error: /already|registered|exists/i.test(msg) ? "An account with this email already exists — find them in the list." : msg }
  }
  const userId = created.user.id

  // handle_new_auth_user has created the profile row; fill it in.
  const { error: profileErr } = await supabaseAdmin
    .from("users").update({ name, phone, is_test: isTest }).eq("id", userId)
  if (profileErr) {
    await supabaseAdmin.auth.admin.deleteUser(userId)
    return { ok: false, error: `Could not save the profile: ${profileErr.message}` }
  }
  if (isTest) {
    // Created while in Test mode: keep it out of the real GF- numbering.
    const { data: row } = await supabaseAdmin.from("users").select("customer_code").eq("id", userId).single()
    if (row?.customer_code?.startsWith("GF-")) {
      await supabaseAdmin.from("users").update({ customer_code: "GT-" + row.customer_code.slice(3) }).eq("id", userId)
    }
  }

  const { data: final } = await supabaseAdmin.from("users").select("customer_code").eq("id", userId).single()
  revalidatePath("/users")
  return {
    ok: true,
    tempPassword: password,
    customer: { id: userId, name, email, phone, customerCode: final?.customer_code ?? null },
  }
}
