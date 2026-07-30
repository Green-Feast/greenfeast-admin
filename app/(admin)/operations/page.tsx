import { supabaseAdmin } from "@/lib/supabase-admin";
import { istToday } from "@/lib/ist";
import { OperationsClient, type OperationsSubscriber } from "./operations-client";

export const dynamic = "force-dynamic";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const date = params.date ?? istToday();

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(`
      id,
      status,
      meal_slot,
      subscriptions!inner (
        id,
        batches ( id, name ),
        users!inner ( name, phone )
      ),
      meal_templates ( name ),
      addresses ( line1, landmark, city )
    `)
    .eq("delivery_date", date)
    .not("status", "in", "(cancelled,skipped)")
    // Stable order so row codes don't reshuffle between the kitchen's copy
    // and the driver's copy of the same day's lists (there was no .order()
    // at all before — codes came from whatever order Postgres happened to
    // return that request).
    .order("id");

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
      mealSlot: (o.meal_slot as "lunch" | "dinner") ?? "lunch",
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
