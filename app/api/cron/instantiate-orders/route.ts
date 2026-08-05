import { NextRequest, NextResponse } from "next/server";

// Vercel Cron hits this daily (19:30 UTC = 1:00 AM IST — see vercel.json).
// Same CRON_SECRET auth pattern as /api/cron/renewal-reminders.
function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Every subscription only ever gets orders for the *next 14 days* at the
// moment instantiate-orders is called (subscription creation, resume, or a
// one-time client-side check when the app's My Plan screen loads with zero
// upcoming orders) — nothing re-invokes it on an ongoing basis. A subscriber
// who doesn't happen to reopen the app at the right moment can end up with
// no deliveries scheduled at all. instantiate-orders already has a built-in
// "nightly cron mode" (called with no subscription_id, service-role auth,
// processes every active subscription) — it just never had a caller. This
// route is that caller.
//
// Auth note: instantiate-orders does NOT accept this app's
// SUPABASE_SERVICE_ROLE_KEY as a bearer token — that env var holds the
// legacy long-form JWT-style key, but Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
// *inside* an Edge Function resolves to Supabase's newer short-form secret
// key, which is a different string. Other edge functions calling
// instantiate-orders (manage-subscription, cashfree-webhook) read that same
// reserved var on their own side, so they match each other fine — but any
// caller outside Supabase's edge runtime never could. INTERNAL_FN_SECRET is
// a dedicated shared secret for exactly this (external → edge function)
// case; instantiate-orders accepts either.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/instantiate-orders`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INTERNAL_FN_SECRET}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json({ error: "instantiate-orders failed", detail: data }, { status: 502 });
  }

  return NextResponse.json(data);
}
