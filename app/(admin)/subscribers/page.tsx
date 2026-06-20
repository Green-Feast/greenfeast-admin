import { supabaseAdmin } from "@/lib/supabase-admin";
import { SubscribersClient, type Subscriber } from "./subscribers-client";

export const dynamic = "force-dynamic";

const STATUS_RANK: Record<string, number> = { active: 0, paused: 1, pending: 2 };

export default async function SubscribersPage() {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select(`
      id,
      user_id,
      status,
      plan_id,
      plan_name,
      deliveries_remaining,
      end_date,
      menu_type,
      created_at,
      users ( name, phone ),
      batches ( name )
    `)
    .in("status", ["active", "pending", "paused"])
    .order("created_at", { ascending: false });

  // Deduplicate: one row per user, preferring active > paused > pending then most recent.
  const best = new Map<string, any>()
  for (const s of (data ?? [])) {
    const existing = best.get(s.user_id);
    if (!existing) { best.set(s.user_id, s); continue; }
    const newRank = STATUS_RANK[s.status] ?? 99;
    const existingRank = STATUS_RANK[existing.status] ?? 99;
    if (newRank < existingRank) best.set(s.user_id, s);
  }

  const subscribers: Subscriber[] = Array.from(best.values()).map((s) => {
    const user = Array.isArray(s.users) ? s.users[0] : s.users;
    const batch = Array.isArray(s.batches) ? s.batches[0] : s.batches;
    const expiry = s.end_date
      ? new Date(s.end_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "";
    return {
      id: s.id,
      userId: s.user_id,
      code: `APP/${s.id.slice(0, 6).toUpperCase()}`,
      batch: (batch as any)?.name ?? "Unassigned",
      rc: "C" as const,
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? "",
      address: "",
      meal: s.menu_type ?? "—",
      constraints: "",
      addons: "",
      timing: "",
      notes: "",
      plan: s.plan_name ?? s.plan_id ?? "—",
      status: (s.status.charAt(0).toUpperCase() + s.status.slice(1)) as Subscriber["status"],
      expiry,
      deliveriesRemaining: s.deliveries_remaining,
      source: "app" as const,
    };
  });

  return <SubscribersClient initialSubscribers={subscribers} />;
}
