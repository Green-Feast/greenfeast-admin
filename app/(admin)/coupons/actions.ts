"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { CODE_PATTERN, normalizeCode, type CouponInput } from "@/lib/coupons"

// Coupons page (migration 066). The database re-checks the rules too: unique
// code, at least one "who", end ≥ start, and a price below the regular one
// only on plans that allow coupons (coupon_plans_check).
// (No type re-exports in this file — see operations/actions.ts.)

type Result = { ok: true; id?: string } | { ok: false; error: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/

function friendly(message: string): string {
  if (message.includes("coupons_code_key")) return "That code is already used by another coupon."
  if (message.includes("coupons_code_check")) return "Codes are 3–24 letters, numbers or dashes."
  return message
}

export async function saveCoupon(input: CouponInput): Promise<Result> {
  const admin = await requireAdmin()
  const code = normalizeCode(input.code ?? "")
  if (!CODE_PATTERN.test(code)) return { ok: false, error: "Codes are 3–24 letters, numbers or dashes." }
  if (!DATE.test(input.startsOn) || !DATE.test(input.endsOn)) return { ok: false, error: "Pick a start and an end date." }
  if (input.endsOn < input.startsOn) return { ok: false, error: "The end date is before the start date." }
  if (!input.forNew && !input.forRenewal && !input.forSelected) return { ok: false, error: "Choose who can use it." }
  if (input.forSelected && input.customerIds.length === 0) return { ok: false, error: "Pick at least one customer, or untick Selected customers." }
  const prices = Object.entries(input.prices ?? {}).filter(([, p]) => Number.isInteger(p) && p > 0)
  if (prices.length === 0) return { ok: false, error: "Set a price for at least one plan." }
  const perCustomer = input.maxPerCustomer == null ? null : Math.round(input.maxPerCustomer)
  const total = input.maxTotal == null ? null : Math.round(input.maxTotal)
  if ((perCustomer != null && perCustomer < 1) || (total != null && total < 1)) return { ok: false, error: "Limits must be 1 or more (or blank)." }

  const row = {
    code,
    name: input.name.trim().slice(0, 120) || null,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    for_new: input.forNew,
    for_renewal: input.forRenewal,
    for_selected: input.forSelected,
    max_per_customer: perCustomer,
    max_total: total,
  }
  let id = input.id
  if (id) {
    const { error } = await supabaseAdmin.from("coupons").update(row).eq("id", id)
    if (error) return { ok: false, error: friendly(error.message) }
  } else {
    const { data, error } = await supabaseAdmin.from("coupons").insert({ ...row, created_by: admin.email ?? "admin" }).select("id").single()
    if (error) return { ok: false, error: friendly(error.message) }
    id = data.id as string
  }

  // Prices: replace. A customer who already bought keeps the price they paid
  // (it's on their plan), so changing these only affects new purchases.
  const { error: delPlansErr } = await supabaseAdmin.from("coupon_plans").delete().eq("coupon_id", id)
  if (delPlansErr) return { ok: false, error: delPlansErr.message }
  const { error: plansErr } = await supabaseAdmin
    .from("coupon_plans")
    .insert(prices.map(([plan_id, meal_price_paise]) => ({ coupon_id: id, plan_id, meal_price_paise })))
  if (plansErr) return { ok: false, error: plansErr.message }

  // Selected customers: the checklist only shows the current Live/Test world,
  // so only that world's picks are replaced — the other world's stay.
  const isTest = await isTestMode()
  const { data: existing } = await supabaseAdmin
    .from("coupon_customers")
    .select("user_id, users!inner ( is_test )")
    .eq("coupon_id", id)
    .eq("users.is_test", isTest)
  const keep = new Set(input.forSelected ? input.customerIds : [])
  const current = new Set(((existing ?? []) as { user_id: string }[]).map((r) => r.user_id))
  const drop = [...current].filter((u) => !keep.has(u))
  const add = [...keep].filter((u) => !current.has(u))
  if (drop.length) await supabaseAdmin.from("coupon_customers").delete().eq("coupon_id", id).in("user_id", drop)
  if (add.length) {
    const { error } = await supabaseAdmin.from("coupon_customers").insert(add.map((user_id) => ({ coupon_id: id, user_id })))
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath("/coupons")
  return { ok: true, id }
}

export async function setCouponActive(id: string, active: boolean): Promise<Result> {
  await requireAdmin()
  const { error } = await supabaseAdmin.from("coupons").update({ active }).eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/coupons")
  return { ok: true }
}

// Only a coupon nobody has used; a used one can be paused or ended instead.
export async function deleteCoupon(id: string): Promise<Result> {
  await requireAdmin()
  const { count } = await supabaseAdmin.from("coupon_redemptions").select("id", { count: "exact", head: true }).eq("coupon_id", id)
  if ((count ?? 0) > 0) return { ok: false, error: "This coupon has been used, so it can't be deleted. Pause it instead." }
  const { error } = await supabaseAdmin.from("coupons").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/coupons")
  return { ok: true }
}
