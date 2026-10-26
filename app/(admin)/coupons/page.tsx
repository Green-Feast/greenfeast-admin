/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows with embedded joins, mapped to typed rows below */
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { istToday } from "@/lib/ist"
import type { CouponCustomer, CouponPlan, CouponRow, CouponUse } from "@/lib/coupons"
import { CouponsClient } from "./coupons-client"

export const dynamic = "force-dynamic"

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

export default async function CouponsPage() {
  await requireAdmin()
  const isTest = await isTestMode()

  const [
    { data: couponRows, error: couponsErr },
    { data: priceRows },
    { data: customerRows },
    { data: useRows },
    { data: planRows },
    { data: userRows },
  ] = await Promise.all([
    supabaseAdmin.from("coupons").select("*").order("created_at", { ascending: false }),
    supabaseAdmin.from("coupon_plans").select("coupon_id, plan_id, meal_price_paise"),
    supabaseAdmin.from("coupon_customers").select("coupon_id, user_id"),
    supabaseAdmin
      .from("coupon_redemptions")
      .select("id, coupon_id, user_id, plan_id, kind, meal_price_paise, regular_meal_price_paise, meals, discount_paise, created_at, users ( name, customer_code, is_test )")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabaseAdmin.from("plans").select("id, name, meals_total, base_price").eq("allow_coupons", true).eq("is_active", true).order("meals_total"),
    // The Selected customers checklist: this Live/Test world's customers.
    supabaseAdmin
      .from("users")
      .select("id, name, customer_code, phone, subscriptions ( status )")
      .eq("is_test", isTest)
      .order("customer_code", { ascending: false })
      .limit(3000),
  ])

  const uses: CouponUse[] = ((useRows ?? []) as any[]).map((r) => {
    const u = one<{ name: string | null; customer_code: string | null }>(r.users)
    return {
      id: r.id,
      couponId: r.coupon_id,
      userId: r.user_id,
      name: u?.name?.trim() || u?.customer_code || "Customer",
      code: u?.customer_code ?? "",
      planId: r.plan_id,
      kind: r.kind,
      mealPrice: r.meal_price_paise,
      regularMealPrice: r.regular_meal_price_paise,
      meals: r.meals,
      saved: r.discount_paise,
      createdAt: r.created_at,
    }
  })

  const coupons: CouponRow[] = ((couponRows ?? []) as any[]).map((c) => {
    const mine = uses.filter((u) => u.couponId === c.id)
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      startsOn: c.starts_on,
      endsOn: c.ends_on,
      forNew: c.for_new,
      forRenewal: c.for_renewal,
      forSelected: c.for_selected,
      maxPerCustomer: c.max_per_customer,
      maxTotal: c.max_total,
      active: c.active,
      createdBy: c.created_by,
      createdAt: c.created_at,
      prices: Object.fromEntries(((priceRows ?? []) as any[]).filter((p) => p.coupon_id === c.id).map((p) => [p.plan_id, p.meal_price_paise])),
      customerIds: ((customerRows ?? []) as any[]).filter((p) => p.coupon_id === c.id).map((p) => p.user_id),
      uses: mine.length,
      saved: mine.reduce((n, u) => n + (u.saved ?? 0), 0),
    }
  })

  const customers: CouponCustomer[] = ((userRows ?? []) as any[]).map((u) => {
    const statuses = ((u.subscriptions ?? []) as { status: string }[]).map((s) => s.status)
    return {
      id: u.id,
      name: u.name?.trim() || "—",
      code: u.customer_code ?? "",
      phone: u.phone,
      plan: statuses.includes("active") ? "Active plan" : statuses.includes("paused") ? "Paused" : statuses.includes("expired") ? "Plan ended" : null,
    }
  })

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <CouponsClient
        coupons={coupons}
        uses={uses}
        plans={(planRows ?? []) as CouponPlan[]}
        customers={customers}
        today={istToday()}
        loadError={couponsErr?.message ?? null}
      />
    </div>
  )
}
