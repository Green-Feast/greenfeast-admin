import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { notifyEvent, logBroadcast } from "./notifications";
import { istToday } from "./ist";

// The admin's delivery path (Operations batch and per-customer buttons). The
// GreenFeast Partner app does the same through the database's partner_*
// functions (migration 060): both bill with advance_order_delivered and send
// the same Automated messages — keep the two in step.

export type DeliveryStatus = "preparing" | "out_for_delivery" | "delivered";
export type MealSlot = "lunch" | "dinner";
export type DeliverResult = "billed" | "skipped_insufficient" | "already_settled";
export type Rider = { id: string; name: string } | null;

// Statuses allowed to advance INTO the target, so re-clicking or going
// backwards is a no-op rather than an error.
export const PRIOR: Record<Exclude<DeliveryStatus, "delivered">, string[]> = {
  preparing: ["scheduled", "confirmed"],
  out_for_delivery: ["scheduled", "confirmed", "preparing"],
};

// {rider} in the "out for delivery" message: the partner's first name, or
// this when the office marked it.
export const OFFICE_RIDER = "our delivery partner";

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Moves a batch's open orders for one date and slot to "preparing" or "out
 * for delivery", only for the given customers (one Live/Test world — a
 * batch can hold both). Out for delivery records the partner carrying them
 * and messages those customers. Returns the ids that actually moved, so a
 * re-click messages nobody twice.
 */
export async function advanceBatch(opts: {
  batchId: string;
  date: string;
  slot: MealSlot;
  status: "preparing" | "out_for_delivery";
  userIds: string[];
  rider?: Rider;
}): Promise<string[]> {
  if (opts.userIds.length === 0) return [];
  const patch: Record<string, unknown> = { status: opts.status };
  if (opts.status === "out_for_delivery" && opts.rider) patch.delivery_partner_id = opts.rider.id;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update(patch)
    .eq("batch_id", opts.batchId)
    .eq("delivery_date", opts.date)
    .eq("meal_slot", opts.slot)
    .in("status", PRIOR[opts.status])
    .in("user_id", opts.userIds)
    .select("id");
  if (error) throw error;
  const moved = (data ?? []).map((o: { id: string }) => o.id);

  if (opts.status === "out_for_delivery" && moved.length > 0) {
    await notifyStatus(moved, "out_for_delivery", opts.slot, opts.rider ?? null, `Batch ${opts.batchId}, ${opts.date} ${opts.slot}`);
  }
  return moved;
}

/**
 * One order to "preparing" or "out for delivery" (admin's per-customer
 * buttons). Not on an earlier day — it's only delivered or skipped then (068).
 */
export async function advanceOrder(orderId: string, status: "preparing" | "out_for_delivery", slot: MealSlot): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ status })
    .eq("id", orderId)
    .in("status", PRIOR[status])
    .gte("delivery_date", istToday())
    .select("id");
  if (error) throw error;
  const moved = (data ?? []).length > 0;
  if (moved && status === "out_for_delivery") {
    await notifyStatus([orderId], "out_for_delivery", slot, null, `Order ${orderId}`);
  }
  return moved;
}

/**
 * Hands orders over: advance_order_delivered bills each one (wallet debit,
 * one meal off the plan; a wallet that's short skips it and tells the
 * customer — migration 036/052), idempotently. The partner who handed them
 * over and the optional photo are stored; billed customers get one
 * "Delivered" message each.
 *
 * An earlier day settled late (068): billed the same, but the delivery time
 * is left empty (it isn't known — the trigger would stamp "now") and no
 * "Today's lunch has been delivered" message goes out days later.
 */
export async function deliverOrders(
  orderIds: string[],
  slot: MealSlot,
  opts: { rider?: Rider; photoPath?: string | null } = {}
): Promise<Record<string, DeliverResult>> {
  const results: Record<string, DeliverResult> = {};
  for (const id of orderIds) {
    const { data, error } = await supabaseAdmin.rpc("advance_order_delivered", { p_order: id });
    if (error) throw error;
    results[id] = (data?.result ?? "already_settled") as DeliverResult;
  }

  const billed = orderIds.filter((id) => results[id] === "billed");
  if (billed.length > 0 && (opts.rider || opts.photoPath)) {
    const patch: Record<string, unknown> = {};
    if (opts.rider) patch.delivery_partner_id = opts.rider.id;
    if (opts.photoPath) patch.delivery_photo_path = opts.photoPath;
    await supabaseAdmin.from("orders").update(patch).in("id", billed);
  }
  if (billed.length > 0) {
    const { past, current } = await splitPastDays(billed);
    if (past.length > 0) await clearDeliveryTime(past);
    if (current.length > 0) await notifyStatus(current, "delivered", slot, opts.rider ?? null, `Orders ${current.join(", ")}`);
  }
  return results;
}

// Orders for an earlier day vs today (or later).
export async function splitPastDays(orderIds: string[]): Promise<{ past: string[]; current: string[] }> {
  if (orderIds.length === 0) return { past: [], current: [] };
  const today = istToday();
  const { data } = await supabaseAdmin.from("orders").select("id, delivery_date").in("id", orderIds);
  const past = ((data ?? []) as { id: string; delivery_date: string }[]).filter((o) => o.delivery_date < today).map((o) => o.id);
  return { past, current: orderIds.filter((id) => !past.includes(id)) };
}

export async function clearDeliveryTime(orderIds: string[]) {
  if (orderIds.length === 0) return;
  await supabaseAdmin.from("orders").update({ delivered_at: null }).in("id", orderIds).eq("status", "delivered");
}

/**
 * Meals that didn't go out: skipped, nothing charged, the meal stays on the
 * plan. An earlier day reads "couldn't be delivered" in the customer's
 * history (not_delivered); today or later "skipped by GreenFeast" (admin).
 * Only meals not yet delivered / skipped / cancelled.
 */
export async function skipUndelivered(orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const { past, current } = await splitPastDays(orderIds);
  let n = 0;
  for (const [ids, reason] of [[past, "not_delivered"], [current, "admin"]] as [string[], string][]) {
    if (ids.length === 0) continue;
    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status: "skipped", skip_reason: reason, updated_at: new Date().toISOString() })
      .in("id", ids)
      .not("status", "in", "(delivered,cancelled,skipped)")
      .select("id");
    if (error) throw error;
    n += (data ?? []).length;
  }
  return n;
}

/**
 * A meal marked delivered that wasn't (068, undo_order_delivered): refunds
 * exactly what it was charged, puts it back on the plan, tells the customer.
 */
export async function undoDelivered(orderId: string): Promise<{ refunded: number; mealsBack: number }> {
  const { data, error } = await supabaseAdmin.rpc("undo_order_delivered", { p_order: orderId });
  if (error) throw new Error(error.message);
  return { refunded: data?.refunded ?? 0, mealsBack: data?.meals_back ?? 0 };
}

/**
 * The "on its way" / "delivered" messages (Notifications → Automated
 * messages), one per customer however many of their orders moved. Only
 * orders that are at that status now — a wallet-short skip doesn't get a
 * "Delivered!". Best-effort: a failed message never undoes the status change.
 */
export async function notifyStatus(
  orderIds: string[],
  status: "out_for_delivery" | "delivered",
  slot: MealSlot,
  rider: Rider,
  audience: string
) {
  try {
    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("user_id")
      .in("id", orderIds)
      .eq("status", status);
    const userIds = Array.from(new Set((orders ?? []).map((o: { user_id: string }) => o.user_id)));
    if (userIds.length === 0) return;

    const { data: users } = await supabaseAdmin.from("users").select("id, name, phone").in("id", userIds);
    const recipients = (users ?? []).map((u: { id: string; name: string | null; phone: string | null }) => ({
      user_id: u.id,
      name: u.name ?? "Customer",
      phone: u.phone ?? null,
    }));
    if (recipients.length === 0) return;

    const sent = await notifyEvent(
      status,
      recipients,
      { slot, rider: rider ? firstName(rider.name) : OFFICE_RIDER },
      "delivery_status"
    );
    if (!sent) return;
    await logBroadcast({
      type: "delivery_status",
      title: sent.title,
      body: sent.body,
      channels: ["push"],
      audience: {
        description: `${audience}, status=${status}${rider ? ` by ${rider.name}` : ""}`,
        count: recipients.length,
      },
      results: sent.results,
    });
  } catch {
    // best-effort — see above
  }
}
