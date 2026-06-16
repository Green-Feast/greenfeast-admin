import { supabaseAdmin } from "@/lib/supabase";
import { OperationsClient, type OperationsSubscriber } from "./operations-client";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const date = searchParams.date ?? new Date().toISOString().split("T")[0];

  const { data } = await supabaseAdmin
    .from("orders")
    .select(`
      id,
      subscriptions!inner (
        id,
        batches ( name ),
        users!inner ( name, phone )
      ),
      meal_templates ( name ),
      addresses ( line1, line2, city )
    `)
    .eq("delivery_date", date)
    .not("status", "in", "(cancelled,skipped)");

  const subscribers: OperationsSubscriber[] = (data ?? []).map((o, i) => {
    const sub = Array.isArray(o.subscriptions) ? o.subscriptions[0] : o.subscriptions;
    const user = Array.isArray((sub as any)?.users) ? (sub as any).users[0] : (sub as any)?.users;
    const batch = Array.isArray((sub as any)?.batches) ? (sub as any).batches[0] : (sub as any)?.batches;
    const meal = Array.isArray(o.meal_templates) ? o.meal_templates[0] : o.meal_templates;
    const addr = Array.isArray(o.addresses) ? o.addresses[0] : o.addresses;

    const batchName: string = (batch as any)?.name ?? "Unassigned";
    const address = addr
      ? [(addr as any).line1, (addr as any).line2, (addr as any).city].filter(Boolean).join(", ")
      : "—";

    return {
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
