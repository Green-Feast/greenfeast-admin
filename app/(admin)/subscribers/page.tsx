import { supabaseAdmin } from "@/lib/supabase";
import { SubscribersClient, type Subscriber } from "./subscribers-client";

export const dynamic = "force-dynamic";

export default async function SubscribersPage() {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select(`
      id,
      status,
      plan_id,
      plan_name,
      deliveries_remaining,
      created_at,
      users ( name, phone ),
      batches ( name )
    `)
    .in("status", ["active", "pending", "paused"])
    .order("created_at", { ascending: false });

  const subscribers: Subscriber[] = (data ?? []).map((s) => {
    const user = Array.isArray(s.users) ? s.users[0] : s.users;
    const batch = Array.isArray(s.batches) ? s.batches[0] : s.batches;
    return {
      id: s.id,
      code: `APP/${s.id.slice(0, 6).toUpperCase()}`,
      batch: (batch as any)?.name ?? "Unassigned",
      rc: "C" as const,
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? "",
      address: "",
      meal: "—",
      constraints: "",
      addons: "",
      timing: "",
      notes: "",
      plan: s.plan_name ?? s.plan_id ?? "—",
      status: (s.status.charAt(0).toUpperCase() + s.status.slice(1)) as Subscriber["status"],
      expiry: "",
      deliveriesRemaining: s.deliveries_remaining,
      source: "app" as const,
    };
  });

  return <SubscribersClient initialSubscribers={subscribers} />;
}
