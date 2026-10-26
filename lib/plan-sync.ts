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
  days: string[]; // Mon..Sun; empty = every day
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
async function mealRates(subscriptionId: string, before: PlanShape, after: PlanShape): Promise<[number, number]> {
  const [{ data: sub }, oldPlanRate, newPlanRate] = await Promise.all([
    supabaseAdmin.from("subscriptions").select("meal_price_paise, coupon_id").eq("id", subscriptionId).maybeSingle(),
    rateOf(before.planId),
    rateOf(after.planId),
  ]);
  const oldRate = sub?.meal_price_paise || oldPlanRate;
  if (before.planId === after.planId) return [oldRate, oldRate];
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
  return [oldRate, couponPrice ?? newPlanRate];
}

export async function syncUpcomingOrders(subscriptionId: string, before: PlanShape, after: PlanShape) {
  const today = istToday();
  const { data: rows } = await supabaseAdmin
    .from("orders")
    .select("id, delivery_date, meal_slot, quantity, unit_price, extra_dish, is_customized, status, order_addons ( id, addon_id, kind, unit_price )")
    .eq("subscription_id", subscriptionId)
    .gte("delivery_date", today)
    .in("status", ["scheduled", "confirmed"])
    .order("delivery_date")
    .order("meal_slot");
  const open = ((rows ?? []) as any[]).filter((o) => !isSlotLocked(o.delivery_date, o.meal_slot as Slot));

  const removed: string[] = [];
  const touched = new Set<string>();
  let kept = 0;

  const perDay = (shape: PlanShape, slot: Slot) => (slot === "lunch" ? shape.mealsLunch : shape.mealsDinner);
  const takesDay = (shape: PlanShape, date: string) => shape.days.length === 0 || shape.days.includes(weekday(date));

  // 1. Slots / days / start date no longer on the plan.
  for (const o of open) {
    if (o.extra_dish) continue;
    const slot = o.meal_slot as Slot;
    if (perDay(after, slot) <= 0 || !takesDay(after, o.delivery_date) || (after.startDate && o.delivery_date < after.startDate)) {
      removed.push(o.id);
    }
  }
  if (removed.length) await supabaseAdmin.from("orders").delete().in("id", removed);
  const remaining = open.filter((o) => !removed.includes(o.id));

  // 2. Portions per slot.
  for (const slot of ["lunch", "dinner"] as Slot[]) {
    const from = perDay(before, slot);
    const to = perDay(after, slot);
    if (from === to || to <= 0) continue;
    const ids = remaining.filter((o) => !o.extra_dish && o.meal_slot === slot && (o.quantity ?? 1) === from).map((o) => o.id);
    kept += remaining.filter((o) => !o.extra_dish && o.meal_slot === slot && (o.quantity ?? 1) !== from).length;
    if (ids.length) {
      await supabaseAdmin.from("orders").update({ quantity: to }).in("id", ids);
      ids.forEach((id) => touched.add(id));
    }
  }

  // 3. Per-meal rate (plan change) and plan add-ons.
  const [oldRate, newRate] = await mealRates(subscriptionId, before, after);
  const addedAddons = after.addonIds.filter((id) => !before.addonIds.includes(id));
  const droppedAddons = before.addonIds.filter((id) => !after.addonIds.includes(id));
  const prices = new Map<string, number>();
  if (addedAddons.length || droppedAddons.length) {
    const { data } = await supabaseAdmin.from("addons").select("id, price_per_meal").in("id", [...addedAddons, ...droppedAddons]);
    for (const a of (data ?? []) as { id: string; price_per_meal: number }[]) prices.set(a.id, a.price_per_meal);
  }

  for (const o of remaining) {
    let price = o.unit_price ?? oldRate;
    let changed = false;
    if (newRate !== oldRate) {
      price += newRate - oldRate;
      changed = true;
    }
    if (!o.extra_dish) {
      const lines = (o.order_addons ?? []) as { id: string; addon_id: string | null; kind: string; unit_price: number | null }[];
      for (const id of droppedAddons) {
        // Only the plan's own (included) line goes; one the customer added
        // for that day themselves stays.
        const line = lines.find((l) => l.kind === "addon" && l.addon_id === id && l.unit_price == null);
        if (!line) continue;
        await supabaseAdmin.from("order_addons").delete().eq("id", line.id);
        price -= Math.min(prices.get(id) ?? 0, Math.max(price - newRate, 0));
        changed = true;
      }
      for (const id of addedAddons) {
        if (lines.some((l) => l.kind === "addon" && l.addon_id === id)) continue;
        await supabaseAdmin.from("order_addons").insert({ order_id: o.id, addon_id: id, kind: "addon", quantity: 1 });
        price += prices.get(id) ?? 0;
        changed = true;
      }
    }
    if (changed) {
      await supabaseAdmin.from("orders").update({ unit_price: Math.max(price, 0) }).eq("id", o.id);
      touched.add(o.id);
    }
  }

  // 4. Meals left: never more scheduled than the plan has.
  const { data: live } = await supabaseAdmin
    .from("orders")
    .select("id, delivery_date, meal_slot, quantity, extra_dish, is_customized, status")
    .eq("subscription_id", subscriptionId)
    .gte("delivery_date", today)
    .in("status", ["scheduled", "confirmed", "preparing", "out_for_delivery"])
    .order("delivery_date", { ascending: false })
    .order("meal_slot", { ascending: false });
  let over = ((live ?? []) as any[]).reduce((n, o) => n + (o.quantity ?? 1), 0) - after.mealsLeft;
  const trimmed: string[] = [];
  for (const o of (live ?? []) as any[]) {
    if (over <= 0) break;
    if (o.status !== "scheduled" || o.extra_dish || isSlotLocked(o.delivery_date, o.meal_slot)) continue;
    trimmed.push(o.id);
    over -= o.quantity ?? 1;
  }
  if (trimmed.length) await supabaseAdmin.from("orders").delete().in("id", trimmed);

  for (const id of touched) {
    if (!trimmed.includes(id)) await supabaseAdmin.rpc("recompute_order_cart", { p_order: id });
  }

  // 5. New days / slots / meals from the new settings.
  await instantiateOrders(subscriptionId);

  return { removed: removed.length + trimmed.length, updated: touched.size, kept };
}
