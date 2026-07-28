import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notifyUsers, logBroadcast } from "@/lib/notifications";

// Vercel Cron hits this daily (see vercel.json). Vercel automatically sends
// `Authorization: Bearer $CRON_SECRET` on cron-triggered requests when that
// env var is set — this check is what stops anyone else from hitting the
// (otherwise public, by URL) route and spamming every subscriber on demand.
function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// deliveries_remaining is the reliable renewal-timing signal in this schema —
// subscriptions.end_date exists but nothing actually populates it (see the
// audit that led to this feature). Remind once when a subscriber drops to 2
// or fewer meals left, then not again for 3 days (last_renewal_reminder_sent_at
// guards this) so they aren't pinged daily while they decide whether to renew.
const LOW_DELIVERIES_THRESHOLD = 2;
const REMINDER_COOLDOWN_DAYS = 3;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: subs, error } = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, deliveries_remaining, last_renewal_reminder_sent_at, users ( name, phone )")
    .eq("status", "active")
    .lte("deliveries_remaining", LOW_DELIVERIES_THRESHOLD)
    .or(`last_renewal_reminder_sent_at.is.null,last_renewal_reminder_sent_at.lt.${cutoff}`);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, notified: 0 });
  }

  const recipients = subs.map((s) => {
    const user = Array.isArray(s.users) ? s.users[0] : s.users;
    return { user_id: s.user_id, name: (user as any)?.name ?? "Unknown", phone: (user as any)?.phone ?? null };
  });

  const title = "Your plan is running low";
  const body = "You have only a couple of meals left on your plan — renew now to keep your deliveries going without a gap.";

  const results = await notifyUsers(recipients, title, body, "renewal_reminder", ["push"]);

  await supabaseAdmin
    .from("subscriptions")
    .update({ last_renewal_reminder_sent_at: new Date().toISOString() })
    .in("id", subs.map((s) => s.id));

  await logBroadcast({
    type: "renewal_reminder",
    title,
    body,
    channels: ["push"],
    audience: { description: `deliveries_remaining <= ${LOW_DELIVERIES_THRESHOLD}`, count: recipients.length },
    results,
  });

  return NextResponse.json({ ok: true, notified: results.length });
}
