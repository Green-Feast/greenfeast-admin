import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { istToday, isSlotLocked } from "./ist";
import { instantiateOrders } from "./instantiate";
import { planMealRate } from "./pricing";

// When the admin edits a plan (subscriber profile → Plan), the upcoming meals
// already scheduled follow the new settings — in place, so anything the
// customer changed for a particular day (another dish, extra portions, a
// different address, an extra add-on) stays as they set it:
//   • a slot or weekday taken off the plan → its open meals are removed
//   • a later first-delivery date → open meals before it are removed
//   • lunches/dinners per day → open meals still at the old default portions
//   • plan add-ons added/removed → added to / taken off each open meal (price too)
//   • another plan (per-meal rate) → each open meal's rate
//   • fewer meals left than are scheduled → the latest untouched meals go
// and then the order job fills in whatever the new settings add.

export type PlanShape = {
  planId: string;
  mealsLunch: number;
  mealsDinner: number;
  days: string[]; // Mon..Sun; empty = every day, unless noDeliveryDays
  noDeliveryDays: boolean; // 089: empty days = nothing is delivered
  addonIds: string[];
  startDate: string | null;
  mealsLeft: number;
};

type Slot = "lunch" | "dinner";
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekday(date: string) {
  return DOW[(new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7];
}

async function rateOf(planId: string) {
  const { data } = await supabaseAdmin.from("plans").select("base_price, meals_total").eq("id", planId).maybeSingle();
  return planMealRate(data);
}

// What one meal costs before and after the change. A plan bought with a
// coupon (migration 066) keeps the coupon's price for the new plan when the
// coupon has one; otherwise it goes back to the regular price and the coupon
// comes off the plan.
async function mealRates(subscriptionId: string, before: PlanShape, after: PlanShape): Promise<[number, number, number | null]> {
  const [{ data: sub }, oldPlanRate, newPlanRate] = await Promise.all([
    supabaseAdmin.from("subscriptions").select("meal_price_paise, coupon_id").eq("id", subscriptionId).maybeSingle(),
    rateOf(before.planId),
    rateOf(after.planId),
  ]);
  const oldRate = sub?.meal_price_paise || oldPlanRate;
  if (before.planId === after.planId) return [oldRate, oldRate, null];
  let couponPrice: number | null = null;
  if (sub?.coupon_id) {
    const { data: cp } = await supabaseAdmin
      .from("coupon_plans").select("meal_price_paise").eq("coupon_id", sub.coupon_id).eq("plan_id", after.planId).maybeSingle();
    couponPrice = cp?.meal_price_paise ?? null;
  }
  if (sub?.meal_price_paise || sub?.coupon_id) {
    await supabaseAdmin
      .from("subscriptions")
      .update({ meal_price_paise: couponPrice, coupon_id: couponPrice ? sub.coupon_id : null })
      .eq("id", subscriptionId);
  }
  // A coupon with no price for the new plan comes off: say so (third value =
  // the coupon meal price that was dropped), so the office can set it right.
  const dropped = (sub?.meal_price_paise && couponPrice == null) ? sub.meal_price_paise : null;
  return [oldRate, couponPrice ?? newPlanRate, dropped];
}

// Since 097 a cart is items (meals, drinks, priced add-on lines) and the
// database owns the rules: resync_plan_orders remakes every upcoming slot
// nobody changed by hand from the plan's defaults (dish, portions, drinks,
// add-ons) and cancels slots that are now off; the order run then fills new
// days up to the published Sunday. Slots changed by hand stay as they are.
export async function syncUpcomingOrders(subscriptionId: string, before: PlanShape, after: PlanShape) {
  // Plan change: the coupon price follows (or comes off) first (066).
  const [, newRate, couponDropped] = await mealRates(subscriptionId, before, after);

  const { data: kept } = await supabaseAdmin
    .from("orders")
    .select("delivery_date, meal_slot")
    .eq("subscription_id", subscriptionId)
    .eq("cart_edited", true)
    .eq("walk_in", false)
    .gte("delivery_date", istToday())
    .in("status", ["scheduled", "confirmed"]);
  const keptSlots = new Set(((kept ?? []) as { delivery_date: string; meal_slot: string }[]).map((o) => `${o.delivery_date}|${o.meal_slot}`));

  const { data: res, error } = await supabaseAdmin.rpc("resync_plan_orders", { p_sub: subscriptionId });
  if (error) throw new Error(`Could not update upcoming meals: ${error.message}`);
  await instantiateOrders(subscriptionId);

  const r = (res ?? {}) as { updated?: number; cancelled?: number };
  return { removed: r.cancelled ?? 0, updated: r.updated ?? 0, kept: keptSlots.size, couponDropped, newRate };
}
