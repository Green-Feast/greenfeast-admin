import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Vercel Cron, Sundays 13:30 UTC = 7:00 PM IST (see vercel.json) — migration 094.
// The kitchen has until 6 PM to set next week's weekly menu (anything not
// changed stays as this week's). This run:
//   1. publishes next week (order_publishing.published_until → next Sunday),
//   2. makes every plan's meals up to it (instantiate-orders, all plans),
//   3. tells each customer who got meals that next week is ready.
// Same CRON_SECRET auth as the other cron routes; INTERNAL_FN_SECRET for the
// edge function (see /api/cron/instantiate-orders for why).
function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: until, error: pubErr } = await supabaseAdmin.rpc("publish_next_week");
  if (pubErr || !until) {
    return NextResponse.json({ error: "publish_next_week failed", detail: pubErr?.message }, { status: 500 });
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/instantiate-orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INTERNAL_FN_SECRET}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const made = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: "instantiate-orders failed", published_until: until, detail: made }, { status: 502 });
  }

  // The new week: the Monday after this Sunday through the published Sunday.
  const to = until as string;
  const from = new Date(new Date(to + "T00:00:00Z").getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const { data: told, error: notifyErr } = await supabaseAdmin.rpc("notify_weekly_menu", { p_from: from, p_to: to });

  return NextResponse.json({
    published_until: until,
    orders_created: (made as { orders_created?: number }).orders_created ?? 0,
    customers_told: told ?? 0,
    notify_error: notifyErr?.message ?? null,
  });
}
