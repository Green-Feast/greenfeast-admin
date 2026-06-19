import { supabaseAdmin } from "@/lib/supabase-admin";
import { OperationsClient, type OperationsSubscriber } from "./operations-client";

export const dynamic = "force-dynamic";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const date = searchParams.date ?? new Date().toISOString().split("T")[0];

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(`
      id,
      status,
      subscriptions!inner (
        id,
        batches ( id, name ),
        users!inner ( name, phone )
      ),
      meal_templates ( name ),
      addresses ( line1, landmark, city )
    `)
    .eq("delivery_date", date)
    .not("status", "in", "(cancelled,skipped)");

  if (error) console.error("[operations] load failed:", error);

  const subscribers: OperationsSubscriber[] = (data ?? []).map((o, i) => {
    const sub = Array.isArray(o.subscriptions) ? o.subscriptions[0] : o.subscriptions;
    const user = Array.isArray((sub as any)?.users) ? (sub as any).users[0] : (sub as any)?.users;
    const batch = Array.isArray((sub as any)?.batches) ? (sub as any).batches[0] : (sub as any)?.batches;
    const meal = Array.isArray(o.meal_templates) ? o.meal_templates[0] : o.meal_templates;
    const addr = Array.isArray(o.addresses) ? o.addresses[0] : o.addresses;

    const batchName: string = (batch as any)?.name ?? "Unassigned";
    const address = addr
      ? [(addr as any).line1, (addr as any).landmark, (addr as any).city].filter(Boolean).join(", ")
      : "—";

    return {
      orderId: o.id as string,
      batchId: ((batch as any)?.id ?? null) as string | null,
      status: (o.status as string) ?? "scheduled",
      code: String(i + 1).padStart(2, "0"),
      batch: batchName,
      rc: "C" as const,
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? "",
      address,
      meal: (meal as any)?.name ?? "—",
      constraints: "",
      addons: "",
      timing: "—",
      note: "",
    };
  });

  return <OperationsClient initialSubscribers={subscribers} serverDate={date} />;
}
