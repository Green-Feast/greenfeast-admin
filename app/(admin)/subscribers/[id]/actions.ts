"use server"

import { randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"
import { istToday, isSlotLocked } from "@/lib/ist"
import { notifyEvent } from "@/lib/notifications"
import { instantiateOrders } from "@/lib/instantiate"
import { syncUpcomingOrders, type PlanShape } from "@/lib/plan-sync"
import { audited, sensitive } from "@/lib/audit"
import { recordCod, recordOfficePayment, settleBalance, validProof, type CodInput, type SettleInput } from "@/lib/money-ops"
import type { ProofInput } from "@/components/payment-proof"
import { DRINK_CATEGORY_LIST } from "@/lib/drinks"

type OrderRef = { id: string; delivery_date: string; meal_slot: "lunch" | "dinner" }
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

// Today's slots past their cutoff are already cooked / on the kitchen sheet —
// pause, resume and cancel leave those orders alone (same rule as the app's
// manage-subscription function).
function openIds(rows: OrderRef[] | null): string[] {
  return (rows ?? []).filter((o) => !isSlotLocked(o.delivery_date, o.meal_slot)).map((o) => o.id)
}

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

async function recipient(userId: string) {
  const { data } = await supabaseAdmin.from("users").select("name, phone").eq("id", userId).maybeSingle()
  return { user_id: userId, name: data?.name ?? "Customer", phone: data?.phone ?? null }
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

// ── Notes, pause / resume / cancel / extend ───────────────────────────────

export async function saveNotes(subId: string, notes: string) {
  return audited("subscribers.saveNotes", { subscriptionId: subId }, async () => {
    await requireAdmin()
    await supabaseAdmin.from("subscriptions").update({ special_notes: notes }).eq("id", subId)
    revalidatePath(`/subscribers/${subId}`)
  })
}

export async function pauseSubscription(subId: string, from: string, until: string) {
  return audited("subscribers.pauseSubscription", { subscriptionId: subId }, async () => {
    await requireAdmin()
    // A pause for later leaves the plan active until its first day, when
    // sync_pauses (076) starts it; the dates alone mark it until then.
    await supabaseAdmin.from("subscriptions")
      .update({ status: from <= istToday() ? "paused" : "active", pause_from: from, pause_until: until })
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
  })
}

export async function resumeSubscription(subId: string) {
  return audited("subscribers.resumeSubscription", { subscriptionId: subId }, async () => {
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
    await instantiateOrders(subId)
    revalidatePath(`/subscribers/${subId}`)
  })
}

// Cancelling a plan. If it was the customer's only plan and the wallet still
// holds money, the admin must decide what happens to it (keep as credit,
// refund, forfeit) — settleBalance records the decision (migration 092).
export async function cancelSubscription(subId: string, settle: SettleInput | null, password: string): Promise<ActionResult> {
  return sensitive("subscribers.cancelSubscription", password, { subscriptionId: subId, details: { decision: settle?.decision ?? null } }, async (ctx): Promise<ActionResult> => {
    const { data: sub } = await supabaseAdmin.from("subscriptions").select("user_id, status").eq("id", subId).single()
    if (!sub) return { ok: false, error: "Subscription not found." }
    if (sub.status === "cancelled") return { ok: false, error: "This plan is already cancelled." }
    ctx.note({ userId: sub.user_id })
    const [{ data: others }, { data: wallet }] = await Promise.all([
      supabaseAdmin.from("subscriptions").select("id").eq("user_id", sub.user_id).neq("id", subId).in("status", ["active", "paused", "pending"]),
      supabaseAdmin.from("wallets").select("balance").eq("user_id", sub.user_id).maybeSingle(),
    ])
    const balance = wallet?.balance ?? 0
    const needsDecision = balance > 0 && (others ?? []).length === 0
    if (needsDecision && !settle) {
      return { ok: false, error: `The wallet still has ${rupees(balance)} — decide whether to keep, refund or forfeit it.` }
    }

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
    revalidatePath("/money")

    if (needsDecision && settle) {
      const r = await settleBalance(ctx, sub.user_id, subId, settle)
      if (!r.ok) return { ok: false, error: `Plan cancelled, but the balance wasn't settled: ${r.error} Settle it from Money → Checks.` }
      return { ok: true, message: `Subscription cancelled. ${r.message}` }
    }
    return { ok: true, message: "Subscription cancelled." }
  })
}

// ── Customer details ──────────────────────────────────────────────────────

export async function updateCustomerIdentity(
  subId: string,
  userId: string,
  input: { name: string; phone: string; email: string }
): Promise<ActionResult> {
  return audited<ActionResult>("subscribers.updateCustomerIdentity", { subscriptionId: subId, userId }, async () => {
    await requireAdminStrict()
    const name = input.name.trim()
    const digits = input.phone.replace(/\D/g, "").slice(-10)
    if (!name) return { ok: false, error: "Enter their name." }
    if (!/^[6-9]\d{9}$/.test(digits)) return { ok: false, error: "Enter a 10-digit Indian mobile number." }

    const { error } = await supabaseAdmin.from("users").update({ name, phone: `+91${digits}` }).eq("id", userId)
    if (error) {
      return { ok: false, error: error.code === "23505" ? "That phone number is already on another account." : error.message }
    }

    const email = input.email.trim().toLowerCase()
    if (email) {
      const { data: auth } = await supabaseAdmin.auth.admin.getUserById(userId)
      if (auth?.user && auth.user.email !== email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." }
        const { error: emailErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { email, email_confirm: true })
        if (emailErr) return { ok: false, error: `Name and phone saved, but the email couldn't change: ${emailErr.message}` }
      }
    }
    revalidatePath(`/subscribers/${subId}`)
    revalidatePath("/users")
    return { ok: true, message: "Customer details saved." }
  })
}

export type DietaryInput = {
  dietary_preference: string | null
  health_goal: string | null
  allergens: string[]
  protein_preference: string[]
  base_avoidance: string[]
  veggie_avoidance: string[]
  spice_preference: string | null
  dressing_preference: string | null
  free_text: string | null
}

// What the customer told us on WhatsApp — the kitchen sees these on the
// Operations sheets.
export async function saveDietaryProfile(subId: string, userId: string, input: DietaryInput): Promise<ActionResult> {
  return audited<ActionResult>("subscribers.saveDietaryProfile", { subscriptionId: subId, userId }, async () => {
    await requireAdmin()
    const { error } = await supabaseAdmin.from("dietary_profiles").upsert(
      { user_id: userId, ...input, free_text: input.free_text?.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    )
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/subscribers/${subId}`)
    revalidatePath("/operations")
    return { ok: true, message: "Food preferences saved — the kitchen sheets show them." }
  })
}

// ── Plan settings ─────────────────────────────────────────────────────────

export type PlanInput = {
  planId: string
  mealsLunch: number
  mealsDinner: number
  days: string[]
  addonIds: string[]
  startDate: string | null
  mealsLeft: number
}

export async function updatePlanSettings(subId: string, input: PlanInput): Promise<ActionResult> {
  return audited<ActionResult>("subscribers.updatePlanSettings", { subscriptionId: subId }, async () => {
    await requireAdminStrict()
    if (!Number.isInteger(input.mealsLunch) || !Number.isInteger(input.mealsDinner) || input.mealsLunch < 0 || input.mealsDinner < 0) {
      return { ok: false, error: "Meals per day must be whole numbers." }
    }
    if (input.mealsLunch + input.mealsDinner < 1) return { ok: false, error: "Set at least one meal per day." }
    // No delivery days is allowed (089): the plan's no_delivery_days flag is set
    // and nothing is delivered — an EMPTY schedule alone would mean every day.
    if (!Number.isInteger(input.mealsLeft) || input.mealsLeft < 0 || input.mealsLeft > 500) {
      return { ok: false, error: "Meals left must be between 0 and 500." }
    }
    if (input.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return { ok: false, error: "Pick a valid first delivery date." }

    const [{ data: sub }, { data: schedule }, { data: subAddons }, { data: plan }] = await Promise.all([
      supabaseAdmin
        .from("subscriptions")
        .select("id, plan_id, meals_lunch, meals_dinner, deliveries_remaining, start_date, no_delivery_days")
        .eq("id", subId)
        .single(),
      supabaseAdmin.from("subscription_schedule").select("day_of_week, meal_template_id").eq("subscription_id", subId),
      supabaseAdmin.from("subscription_addons").select("addon_id, sub_option").eq("subscription_id", subId),
      supabaseAdmin.from("plans").select("id, name").eq("id", input.planId).maybeSingle(),
    ])
    if (!sub) return { ok: false, error: "Subscription not found." }
    if (!plan) return { ok: false, error: "Plan not found." }

    const before: PlanShape = {
      planId: sub.plan_id,
      mealsLunch: sub.meals_lunch ?? 0,
      mealsDinner: sub.meals_dinner ?? 0,
      days: ((schedule ?? []) as { day_of_week: string }[]).map((r) => r.day_of_week),
      noDeliveryDays: !!sub.no_delivery_days,
      addonIds: ((subAddons ?? []) as { addon_id: string; sub_option: string | null }[]).map((a) => a.addon_id),
      startDate: sub.start_date ?? null,
      mealsLeft: sub.deliveries_remaining ?? 0,
    }
    const after: PlanShape = {
      planId: input.planId,
      mealsLunch: input.mealsLunch,
      mealsDinner: input.mealsDinner,
      days: DOW.filter((d) => input.days.includes(d)),
      noDeliveryDays: input.days.length === 0,
      addonIds: Array.from(new Set(input.addonIds)),
      startDate: input.startDate || null,
      mealsLeft: input.mealsLeft,
    }

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({
        plan_id: plan.id,
        plan_name: plan.name,
        meals_lunch: after.mealsLunch,
        meals_dinner: after.mealsDinner,
        meals_per_day: after.mealsLunch + after.mealsDinner,
        deliveries_remaining: after.mealsLeft,
        start_date: after.startDate,
        no_delivery_days: after.noDeliveryDays,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subId)
    if (error) return { ok: false, error: error.message }

    // Delivery days live in subscription_schedule (one row per day). No days =
    // no rows plus the no_delivery_days flag set above (an empty schedule alone
    // would mean every day).
    if (after.days.join() !== before.days.join()) {
      let starter = ((schedule ?? []) as { meal_template_id: string | null }[]).find((r) => r.meal_template_id)?.meal_template_id ?? null
      if (!starter) {
        const { data: m } = await supabaseAdmin
          .from("meal_templates").select("id").eq("is_active", true).eq("subscription_valid", true)
          .not("category", "in", DRINK_CATEGORY_LIST) // a drink comes with the meal, it isn't one
          .limit(1).maybeSingle()
        starter = m?.id ?? null
      }
      await supabaseAdmin.from("subscription_schedule").delete().eq("subscription_id", subId)
      if (starter && after.days.length > 0) {
        await supabaseAdmin.from("subscription_schedule").insert(
          after.days.map((d) => ({ subscription_id: subId, day_of_week: d, meal_template_id: starter }))
        )
      }
    }

    if (after.addonIds.slice().sort().join() !== before.addonIds.slice().sort().join()) {
      await supabaseAdmin.from("subscription_addons").delete().eq("subscription_id", subId)
      if (after.addonIds.length) {
        // Add-ons that stay keep the option the customer picked (cheese etc.).
        const kept = new Map(((subAddons ?? []) as { addon_id: string; sub_option: string | null }[]).map((a) => [a.addon_id, a.sub_option]))
        await supabaseAdmin.from("subscription_addons").insert(
          after.addonIds.map((id) => ({ subscription_id: subId, addon_id: id, sub_option: kept.get(id) ?? null }))
        )
      }
    }

    const sync = await syncUpcomingOrders(subId, before, after)
    revalidatePath(`/subscribers/${subId}`)
    revalidatePath("/kitchen")
    return {
      ok: true,
      message: (sync.couponDropped
        ? `Heads up: the coupon price (₹${(sync.couponDropped / 100).toFixed(2)} a meal) has no price for this plan, so it came off — meals are now ₹${(sync.newRate / 100).toFixed(2)}. `
        : "") +
        `Plan saved. Upcoming meals: ${sync.updated} updated, ${sync.removed} removed` +
        (sync.kept ? `, ${sync.kept} the customer changed left as they are` : "") + ".",
    }
  })
}

// ── Cash on delivery / payments ───────────────────────────────────────────

// "Record cash received" for a cash-on-delivery plan: the cash and the UPI
// part (to our QR) must add up exactly to what's due (admin_record_cod).
export async function recordCashPayment(subId: string, input: CodInput, password: string): Promise<ActionResult> {
  return sensitive("subscribers.recordCashPayment", password, { subscriptionId: subId, amountPaise: input.cashPaise + input.upiPaise }, async (ctx): Promise<ActionResult> => {
    const res = await recordCod(ctx, subId, input, null)
    if (!res.ok) return res
    revalidatePath(`/subscribers/${subId}`)
    revalidatePath("/dashboard")
    revalidatePath("/operations")
    revalidatePath("/money")
    return { ok: true, message: res.message }
  })
}

// Changes how much cash is still to collect (an agreed different amount).
// Lowering it without a payment writes money off, so it needs a reason and
// the action password, and the log keeps the before / after.
export async function setCashDue(subId: string, duePaise: number, onCredit: boolean, reason: string, password: string): Promise<ActionResult> {
  return sensitive("subscribers.setCashDue", password, { subscriptionId: subId, amountPaise: duePaise, details: { reason, on_credit: onCredit } }, async (ctx): Promise<ActionResult> => {
    if (!Number.isInteger(duePaise) || duePaise < 0 || duePaise > 20_000_000) return { ok: false, error: "Enter ₹0–₹2,00,000." }
    if (!reason?.trim()) return { ok: false, error: "Add a reason for changing what's due." }
    const { data: before } = await supabaseAdmin.from("subscriptions").select("user_id, cod_due_paise, cod_on_credit").eq("id", subId).single()
    if (!before) return { ok: false, error: "Subscription not found." }
    ctx.note({ userId: before.user_id, details: { due_before: before.cod_due_paise ?? 0, on_credit_before: before.cod_on_credit } })
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({ cod_due_paise: duePaise, cod_on_credit: duePaise > 0 && onCredit, payment_method: duePaise > 0 ? "cod" : undefined })
      .eq("id", subId)
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/subscribers/${subId}`)
    revalidatePath("/dashboard")
    return { ok: true, message: duePaise > 0 ? `Cash due set to ${rupees(duePaise)}.` : "Nothing due now." }
  })
}

// Starts a plan that's still pending: an abandoned online checkout, or a
// cash-on-delivery signup from an older app version. paidPaise = money
// received so far, with its proof (into the wallet); cashDuePaise = still to
// collect — meals run on credit until it's recorded.
export async function activatePendingPlan(
  subId: string, paidPaise: number, cashDuePaise: number, proof: ProofInput | null, idempotencyKey: string, password: string
): Promise<ActionResult> {
  return sensitive("subscribers.activatePendingPlan", password, { subscriptionId: subId, amountPaise: paidPaise, details: { cash_due: cashDuePaise } }, async (ctx): Promise<ActionResult> => {
    if (![paidPaise, cashDuePaise].every((n) => Number.isInteger(n) && n >= 0 && n <= 20_000_000)) {
      return { ok: false, error: "Amounts must be between ₹0 and ₹2,00,000." }
    }
    const bad = validProof(proof, paidPaise)
    if (bad) return { ok: false, error: bad }
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, status, payment_method, plan_name, plans ( meals_total, base_price )")
      .eq("id", subId)
      .single()
    if (!sub) return { ok: false, error: "Subscription not found." }
    if (sub.status !== "pending") return { ok: false, error: "This plan is already live." }
    const plan = one((sub as any).plans) as { meals_total: number; base_price: number } | null
    if (!plan) return { ok: false, error: "Plan not found." }
    ctx.note({ userId: sub.user_id, details: { plan: sub.plan_name } })

    // The money first, with its proof — the wallet is the plan (079), so the
    // plan's meals come from it.
    if (paidPaise > 0 && proof) {
      const pay = await recordOfficePayment(ctx, {
        userId: sub.user_id, subId, amountPaise: paidPaise, proof, source: "admin_activation",
        reason: `Payment received — ${sub.plan_name ?? "plan"}`, idempotencyKey,
      })
      if (!pay.ok) return pay
    }

    // One live plan per customer (049): close the previous one first; it hands
    // over its meals still to come (079) — same as the payment webhook.
    await supabaseAdmin.rpc("retire_previous_subscriptions", { p_new_sub: subId })

    // Meals left is set by the database from the wallet + cash due (079).
    const { error: actErr } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        payment_method: cashDuePaise > 0 ? "cod" : sub.payment_method,
        cod_due_paise: cashDuePaise,
        cod_on_credit: cashDuePaise > 0,
      })
      .eq("id", subId)
      .eq("status", "pending")
    if (actErr) {
      return {
        ok: false,
        error: actErr.code === "23505"
          ? "This customer already has a live plan with meals left."
          : `Payment recorded, but the plan didn't start: ${actErr.message}`,
      }
    }

    await instantiateOrders(subId)
    const { data: live } = await supabaseAdmin.from("subscriptions").select("deliveries_remaining").eq("id", subId).single()
    await notifyEvent("plan_ready", [await recipient(sub.user_id)], {
      meals: live?.deliveries_remaining ?? plan.meals_total,
      wallet_note: paidPaise > 0 ? ` and ${rupees(paidPaise)} is in your wallet` : "",
    })

    await supabaseAdmin.rpc("notify_next_meal", { p_sub: subId })

    revalidatePath(`/subscribers/${subId}`)
    revalidatePath("/dashboard")
    revalidatePath("/money")
    return { ok: true, message: "Plan is live — meals are being scheduled." }
  })
}

// ── Addresses ─────────────────────────────────────────────────────────────

export type AddressInput = {
  id?: string
  label: string
  type: string
  line1: string
  landmark: string
  pincode: string
  timeWindow: string
}

export async function saveCustomerAddress(subId: string, userId: string, input: AddressInput): Promise<ActionResult> {
  return audited<ActionResult>("subscribers.saveCustomerAddress", { subscriptionId: subId, userId }, async () => {
    await requireAdmin()
    if (!input.line1.trim()) return { ok: false, error: "Enter the address." }
    const fields = {
      label: input.label.trim() || "Home",
      // The table allows home / office / other (the app uses the same three).
      type: input.type === "work" ? "office" : ["home", "office", "other"].includes(input.type) ? input.type : "home",
      line1: input.line1.trim(),
      landmark: input.landmark.trim() || null,
      pincode: input.pincode.trim() || "",
      time_window: input.timeWindow.trim() || null,
    }
    if (input.id) {
      const { error } = await supabaseAdmin.from("addresses").update(fields).eq("id", input.id).eq("user_id", userId)
      if (error) return { ok: false, error: error.message }
    } else {
      const { count } = await supabaseAdmin
        .from("addresses").select("*", { count: "exact", head: true }).eq("user_id", userId).is("archived_at", null)
      const { error } = await supabaseAdmin
        .from("addresses")
        .insert({ ...fields, user_id: userId, city: "Jaipur", is_default: (count ?? 0) === 0 })
      if (error) return { ok: false, error: error.message }
    }
    revalidatePath(`/subscribers/${subId}`)
    revalidatePath("/batches")
    return { ok: true, message: input.id ? "Address saved." : "Address added — give it a batch below." }
  })
}

export async function makeDefaultAddress(subId: string, addressId: string, moveUpcoming: boolean): Promise<ActionResult> {
  return audited<ActionResult>("subscribers.makeDefaultAddress", { subscriptionId: subId, ref: addressId }, async () => {
    await requireAdmin()
    const { data, error } = await supabaseAdmin.rpc("set_default_address", { p_address: addressId, p_move_upcoming: moveUpcoming })
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/subscribers/${subId}`)
    revalidatePath("/operations")
    return { ok: true, message: moveUpcoming ? `Default changed — ${data ?? 0} upcoming meals now go there.` : "Default changed." }
  })
}

export async function removeCustomerAddress(subId: string, addressId: string): Promise<ActionResult> {
  return audited<ActionResult>("subscribers.removeCustomerAddress", { subscriptionId: subId, ref: addressId }, async () => {
    await requireAdmin()
    const { data, error } = await supabaseAdmin.rpc("archive_address", { p_address: addressId })
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/subscribers/${subId}`)
    revalidatePath("/batches")
    return { ok: true, message: data === "archived" ? "Address removed (kept on past orders)." : "Address deleted." }
  })
}
