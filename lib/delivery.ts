import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { notifyEvent, logBroadcast } from "./notifications";

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

/** One order to "preparing" or "out for delivery" (admin's per-customer buttons). */
export async function advanceOrder(orderId: string, status: "preparing" | "out_for_delivery", slot: MealSlot): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ status })
    .eq("id", orderId)
    .in("status", PRIOR[status])
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
    await notifyStatus(billed, "delivered", slot, opts.rider ?? null, `Orders ${billed.join(", ")}`);
  }
  return results;
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
