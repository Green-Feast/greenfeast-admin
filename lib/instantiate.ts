import "server-only";

// Create the next 14 days of orders for one subscription by calling the
// instantiate-orders edge function (ingredient snapshot, add-on copy, pause,
// kitchen closures, fixed dishes, meals-left cap — all in one tested place).
// INTERNAL_FN_SECRET (not SUPABASE_SECRET_KEY — see
// app/api/cron/instantiate-orders/route.ts for why that doesn't work from
// outside Supabase's own edge runtime) unlocks any subscription_id.
export async function instantiateOrders(subscriptionId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.INTERNAL_FN_SECRET;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !secret || !anonKey) return;
  try {
    await fetch(`${url}/functions/v1/instantiate-orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subscription_id: subscriptionId }),
    });
  } catch (e) {
    // Non-fatal — the nightly cron will pick the subscription up regardless.
    console.error("instantiate-orders call failed:", e);
  }
}
