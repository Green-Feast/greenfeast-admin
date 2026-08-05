import { supabaseAdmin } from "@/lib/supabase-admin";
import { isWhatsAppConfigured } from "@/lib/notifications";
import { NotificationsClient, type Audience, type Broadcast } from "./notifications-client";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const [{ data: subs }, { data: broadcasts }] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select(`
        user_id, status, plan_name, plan_id,
        users ( name, phone ),
        batchLunch:batches!subscriptions_batch_id_lunch_fkey ( name ),
        batchDinner:batches!subscriptions_batch_id_dinner_fkey ( name )
      `)
      .in("status", ["active", "paused", "pending"])
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("notification_broadcasts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  // One row per user (a user can only have one non-cancelled subscription in
  // practice, but de-dupe defensively the same way the Subscribers page does).
  const seen = new Set<string>();
  const audience: Audience[] = [];
  for (const s of subs ?? []) {
    if (seen.has(s.user_id)) continue;
    seen.add(s.user_id);
    const user = Array.isArray(s.users) ? s.users[0] : s.users;
    const batchLunch = Array.isArray((s as any).batchLunch) ? (s as any).batchLunch[0] : (s as any).batchLunch;
    const batchDinner = Array.isArray((s as any).batchDinner) ? (s as any).batchDinner[0] : (s as any).batchDinner;
    audience.push({
      userId: s.user_id,
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? null,
      batchLunch: (batchLunch as any)?.name ?? "Unassigned",
      batchDinner: (batchDinner as any)?.name ?? "Unassigned",
      plan: s.plan_name ?? s.plan_id ?? "—",
      status: s.status,
    });
  }

  return (
    <NotificationsClient
      audience={audience}
      initialBroadcasts={(broadcasts ?? []) as Broadcast[]}
      whatsappConfigured={isWhatsAppConfigured()}
    />
  );
}
