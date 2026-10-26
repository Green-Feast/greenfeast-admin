// The price of one meal on a subscription (paise). A plan bought with a
// coupon keeps its coupon price (subscriptions.meal_price_paise, migration
// 066); otherwise it's the plan's regular price, round(plan price ÷ meals).
// Mirrors subscription_meal_rate() in SQL and _shared/pricing.ts in the
// edge functions — every place that prices a meal goes through one of them.
export function planMealRate(plan: { base_price: number; meals_total: number } | null | undefined): number {
  return plan ? Math.round(plan.base_price / Math.max(plan.meals_total, 1)) : 0
}

export function mealRate(
  sub: { meal_price_paise?: number | null } | null | undefined,
  plan: { base_price: number; meals_total: number } | null | undefined,
): number {
  return sub?.meal_price_paise || planMealRate(plan)
}
