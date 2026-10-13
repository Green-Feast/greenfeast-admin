import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { isWhatsAppConfigured } from "@/lib/notifications";
import { NotificationsClient, type Audience, type Broadcast, type TemplateRow } from "./notifications-client";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireAdmin()
  const isTest = await isTestMode()

  const [{ data: subs }, { data: broadcasts }, { count: everyone }, { data: templates }, { data: batches }] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select(`user_id, status, plan_name, plan_id, users!inner ( name, phone, is_test )`)
      .in("status", ["active", "paused", "pending"])
      .eq("users.is_test", isTest)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("notification_broadcasts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30),
    supabaseAdmin.from("users").select("id", { count: "exact", head: true }).eq("is_test", isTest),
    supabaseAdmin.from("notification_templates").select("*").order("kind").order("sort_order").order("label"),
    supabaseAdmin.from("batches").select("id, name"),
  ]);

  // One row per user (a user can only have one non-cancelled subscription in
  // practice, but de-dupe defensively the same way the Subscribers page does).
  const seen = new Set<string>();
  const rows: any[] = [];
  for (const s of subs ?? []) {
    if (seen.has(s.user_id)) continue;
    seen.add(s.user_id);
    rows.push(s);
  }

  // Batches belong to addresses now (migration 052): use the default address's.
  const batchName = new Map(((batches ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const userIds = rows.map((s) => s.user_id);
  const { data: addrs } = userIds.length
    ? await supabaseAdmin
        .from("addresses")
        .select("user_id, batch_id_lunch, batch_id_dinner")
        .in("user_id", userIds)
        .eq("is_default", true)
        .is("archived_at", null)
    : { data: [] as any[] };
  const addrByUser = new Map(((addrs ?? []) as any[]).map((a) => [a.user_id, a]));

  const audience: Audience[] = rows.map((s) => {
    const user = Array.isArray(s.users) ? s.users[0] : s.users;
    const a = addrByUser.get(s.user_id);
    return {
      userId: s.user_id,
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? null,
      batchLunch: (a?.batch_id_lunch && batchName.get(a.batch_id_lunch)) || "Unassigned",
      batchDinner: (a?.batch_id_dinner && batchName.get(a.batch_id_dinner)) || "Unassigned",
      plan: s.plan_name ?? s.plan_id ?? "—",
      status: s.status,
    };
  });

  return (
    <NotificationsClient
      audience={audience}
      everyoneCount={everyone ?? 0}
      initialBroadcasts={(broadcasts ?? []) as Broadcast[]}
      templates={(templates ?? []) as TemplateRow[]}
      whatsappConfigured={isWhatsAppConfigured()}
    />
  );
}
