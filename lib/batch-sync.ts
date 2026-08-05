import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { istToday } from "./ist";

// orders.batch_id is a snapshot taken at instantiate-orders time — it is NOT
// automatically kept in sync when a subscription is later reassigned to a
// different batch. Every batch-status/billing operation (advance_batch_delivered,
// Operations' advanceBatchStatus) filters by orders.batch_id, not the
// subscription's current batch, so a reassigned subscriber's not-yet-delivered
// orders would silently stop appearing under either batch's card — invisible
// to both the old batch (subscriber moved away) and the new one (orders still
// tagged with the old batch_id).
//
// Called by both places a subscription's batch can change: the subscriber
// profile's per-slot picker and the Batches page's drag-and-drop. Batches are
// now slot-specific (a batch is either lunch or dinner), so only the orders
// in the matching slot are touched — a subscriber's lunch and dinner routes
// move independently. Only touches orders that haven't happened yet —
// past/settled orders keep the batch they were actually delivered under,
// which is correct for historical reporting.
export async function syncFutureOrdersBatch(
  subscriptionId: string,
  batchId: string | null,
  slot: "lunch" | "dinner"
) {
  const { error } = await supabaseAdmin
    .from("orders")
    .update({ batch_id: batchId })
    .eq("subscription_id", subscriptionId)
    .eq("meal_slot", slot)
    .gte("delivery_date", istToday())
    .not("status", "in", "(delivered,cancelled,skipped)");
  if (error) console.error("syncFutureOrdersBatch failed:", error.message);
}
