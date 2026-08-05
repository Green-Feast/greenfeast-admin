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
      batches ( id, name ),
      subscriptions!inner (
        id,
        user_id,
        special_notes,
        users!inner ( name, phone )
      ),
      meal_templates ( name ),
      addresses ( line1, landmark, city, time_window ),
      order_addons ( kind, addons ( name ) )
    `)
    .eq("delivery_date", date)
    .not("status", "in", "(cancelled,skipped)")
    // Stable order so row codes don't reshuffle between the kitchen's copy
    // and the driver's copy of the same day's lists (there was no .order()
    // at all before — codes came from whatever order Postgres happened to
    // return that request).
    .order("id");

  if (error) console.error("[operations] load failed:", error);

  // dietary_profiles is keyed by user_id, not embeddable through the
  // subscriptions→users chain (no direct FK PostgREST can walk), so it's a
  // second query merged in below.
  const userIds = Array.from(new Set((data ?? []).map((o) => {
    const sub = Array.isArray(o.subscriptions) ? o.subscriptions[0] : o.subscriptions;
    return (sub as any)?.user_id as string | undefined;
  }).filter(Boolean)));

  const { data: dietaryRows } = userIds.length
    ? await supabaseAdmin.from("dietary_profiles").select("user_id, dietary_preference, allergens").in("user_id", userIds)
    : { data: [] as { user_id: string; dietary_preference: string | null; allergens: string[] | null }[] };

  const dietaryByUser = new Map((dietaryRows ?? []).map((r) => [r.user_id, r]));

  const subscribers: OperationsSubscriber[] = (data ?? []).map((o, i) => {
    const sub = Array.isArray(o.subscriptions) ? o.subscriptions[0] : o.subscriptions;
    const user = Array.isArray((sub as any)?.users) ? (sub as any).users[0] : (sub as any)?.users;
    // Batch comes from the order's own batch_id (a per-slot snapshot), not
    // the subscription's — a subscriber can ride a different batch for lunch
    // than for dinner, so the order is the source of truth for which one.
    const batch = Array.isArray(o.batches) ? o.batches[0] : o.batches;
    const meal = Array.isArray(o.meal_templates) ? o.meal_templates[0] : o.meal_templates;
    const addr = Array.isArray(o.addresses) ? o.addresses[0] : o.addresses;
    const addons = (o.order_addons ?? []) as { kind: string; addons: { name: string } | { name: string }[] | null }[];

    const batchName: string = (batch as any)?.name ?? "Unassigned";
    const address = addr
      ? [(addr as any).line1, (addr as any).landmark, (addr as any).city].filter(Boolean).join(", ")
      : "—";

    const dietary = dietaryByUser.get((sub as any)?.user_id);
    const constraintParts = [
      dietary?.dietary_preference,
      ...(dietary?.allergens?.length ? [`Allergens: ${dietary.allergens.join(", ")}`] : []),
    ].filter(Boolean);

    const addonNames = addons
      .filter((a) => a.kind === "addon")
      .map((a) => (Array.isArray(a.addons) ? a.addons[0]?.name : a.addons?.name))
      .filter(Boolean);

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
      constraints: constraintParts.join(" · "),
      addons: addonNames.join(", "),
      timing: (addr as any)?.time_window ?? "—",
      note: (sub as any)?.special_notes ?? "",
    };
  });

  return <OperationsClient initialSubscribers={subscribers} serverDate={date} />;
}
