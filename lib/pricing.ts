// The price of one meal on a subscription (paise). A plan bought with a
// coupon keeps its coupon price (subscriptions.meal_price_paise, migration
// 066); otherwise it's the plan's regular price: plan price ÷ meals, rounded
// DOWN to the whole rupee (092 — ₹7,499 / 30 → ₹249; the ₹29 left over is
// booked as GreenFeast's rounding income when the plan is fully paid).
// Mirrors subscription_meal_rate() in SQL and _shared/pricing.ts in the
// edge functions — every place that prices a meal goes through one of them.
export function planMealRate(plan: { base_price: number; meals_total: number } | null | undefined): number {
  return plan ? Math.floor(plan.base_price / Math.max(plan.meals_total, 1) / 100) * 100 : 0
}

export function mealRate(
  sub: { meal_price_paise?: number | null } | null | undefined,
  plan: { base_price: number; meals_total: number } | null | undefined,
): number {
  return sub?.meal_price_paise || planMealRate(plan)
}
