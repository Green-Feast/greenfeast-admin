import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth"
import { istToday } from "@/lib/ist";
import { isTestMode } from "@/lib/mode";
import { OperationsClient, type OperationsSubscriber, type CashReportRow } from "./operations-client";
import type { KitchenClosure } from "./kitchen-closure";

export const dynamic = "force-dynamic";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdmin()

  const params = await searchParams;
  const date = params.date ?? istToday();
  const isTest = await isTestMode();

  // Kitchen closures from today on (banner for the selected date + the
  // "Close kitchen" dialog's list).
  const closuresQuery = supabaseAdmin
    .from("kitchen_closures")
    .select("closed_on, meal_slot, reason")
    .gte("closed_on", istToday())
    .order("closed_on")
    .order("meal_slot");

  const ordersQuery = supabaseAdmin
    .from("orders")
    .select(`
      id,
      status,
      meal_slot,
      quantity,
      extra_dish,
      address_id,
      out_for_delivery_at,
      delivered_at,
      delivery_issue,
      delivery_photo_path,
      delivery_partners ( name ),
      batches ( id, name ),
      subscriptions!inner (
        id,
        user_id,
        special_notes,
        cod_due_paise,
        users!inner ( name, phone, is_test )
      ),
      meal_templates ( name ),
      addresses ( label, type, line1, landmark, city, time_window ),
      order_addons ( kind, quantity, unit_price, addons ( name ) )
    `)
    .eq("delivery_date", date)
    .not("status", "in", "(cancelled,skipped)")
    .eq("subscriptions.users.is_test", isTest)
    // Stable order so row codes don't reshuffle between the kitchen's copy
    // and the driver's copy of the same day's lists (there was no .order()
    // at all before — codes came from whatever order Postgres happened to
    // return that request).
    .order("id");

  // Cash delivery partners say they collected, not yet recorded (any day) —
  // the office records it when the cash is handed over.
  const cashQuery = supabaseAdmin
    .from("cash_reports")
    .select("id, subscription_id, amount_paise, note, reported_at, delivery_partners ( name ), users!inner ( name, is_test )")
    .is("recorded_at", null)
    .is("dismissed_at", null)
    .eq("users.is_test", isTest)
    .order("reported_at");

  // All in one round trip.
  const [{ data: closureRows }, { data, error }, { data: cashRows }] = await Promise.all([closuresQuery, ordersQuery, cashQuery]);

  const cashReports: CashReportRow[] = ((cashRows ?? []) as any[]).map((r) => ({
    id: r.id,
    subscriptionId: r.subscription_id,
    amount: r.amount_paise,
    note: r.note ?? null,
    reportedAt: r.reported_at,
    partner: (Array.isArray(r.delivery_partners) ? r.delivery_partners[0] : r.delivery_partners)?.name ?? "Partner",
    customer: (Array.isArray(r.users) ? r.users[0] : r.users)?.name ?? "Customer",
  }));
  const cashBySub = new Map(cashReports.map((r) => [r.subscriptionId, r]));

  if (error) console.error("[operations] load failed:", error);

  // dietary_profiles is keyed by user_id, not embeddable through the
  // subscriptions→users chain (no direct FK PostgREST can walk), so it's a
  // second query merged in below.
  const userIds = Array.from(new Set((data ?? []).map((o) => {
    const sub = Array.isArray(o.subscriptions) ? o.subscriptions[0] : o.subscriptions;
    return (sub as any)?.user_id as string | undefined;
  }).filter(Boolean)));

  type DietRow = {
    user_id: string; dietary_preference: string | null; allergens: string[] | null
    base_avoidance: string[] | null; veggie_avoidance: string[] | null; spice_preference: string | null
    dressing_preference: string | null; free_text: string | null; protein_preference: string[] | null
  };
  const [{ data: dietaryRows }, { data: batchRows }] = await Promise.all([
    userIds.length
      ? supabaseAdmin
          .from("dietary_profiles")
          .select("user_id, dietary_preference, allergens, base_avoidance, veggie_avoidance, spice_preference, dressing_preference, free_text, protein_preference")
          .in("user_id", userIds)
      : Promise.resolve({ data: [] as DietRow[] }),
    supabaseAdmin.from("batches").select("id, name, meal_slot").order("name"),
  ]);

  const dietaryByUser = new Map(((dietaryRows ?? []) as DietRow[]).map((r) => [r.user_id, r]));

  const subscribers: OperationsSubscriber[] = (data ?? []).map((o) => {
    const sub = Array.isArray(o.subscriptions) ? o.subscriptions[0] : o.subscriptions;
    const user = Array.isArray((sub as any)?.users) ? (sub as any).users[0] : (sub as any)?.users;
    // Batch comes from the order's own batch_id (a per-slot snapshot), not
    // the subscription's — a subscriber can ride a different batch for lunch
    // than for dinner, so the order is the source of truth for which one.
    const batch = Array.isArray(o.batches) ? o.batches[0] : o.batches;
    const meal = Array.isArray(o.meal_templates) ? o.meal_templates[0] : o.meal_templates;
    const addr = Array.isArray(o.addresses) ? o.addresses[0] : o.addresses;
    const addons = (o.order_addons ?? []) as { kind: string; quantity: number | null; unit_price: number | null; addons: { name: string } | { name: string }[] | null }[];
    const qty = ((o as any).quantity ?? 1) as number;

    const batchName: string = (batch as any)?.name ?? "Unassigned";
    // Jaipur is implied on the sheets — street address and landmark.
    const address = addr ? [(addr as any).line1, (addr as any).landmark].filter(Boolean).join(", ") : "—";

    // Everything the customer told us (app or admin → Food preferences), in
    // the kitchen's own wording. Allergies / vegan / no paneer print in red.
    const dietary = dietaryByUser.get((sub as any)?.user_id);
    const avoid = [...(dietary?.base_avoidance ?? []), ...(dietary?.veggie_avoidance ?? [])];
    const proteins = dietary?.protein_preference ?? [];
    const constraintParts = [
      ...(dietary?.allergens ?? []).map((a) => `ALLERGIC TO ${a.toUpperCase()}`),
      dietary?.dietary_preference === "vegan" ? "VEGAN" : null,
      proteins.length === 1 ? `Only ${proteins[0].toLowerCase()}` : null,
      ...avoid.map((a) => `no ${a.toLowerCase()}`),
      dietary?.spice_preference === "Mild" ? "less spicy" : dietary?.spice_preference === "Spicy" ? "extra spicy" : null,
      dietary?.dressing_preference === "on-the-side" ? "dressing outside" : null,
      dietary?.free_text?.trim() || null,
    ].filter(Boolean) as string[];

    // A plan add-on is included once per portion; others carry their own count.
    const addonList = addons
      .filter((a) => a.kind === "addon")
      .map((a) => {
        const name = Array.isArray(a.addons) ? a.addons[0]?.name : a.addons?.name;
        if (!name) return null;
        return { name, qty: (a.quantity ?? 1) * (a.unit_price == null && !(o as any).extra_dish ? qty : 1) };
      })
      .filter(Boolean) as { name: string; qty: number }[];

    return {
      orderId: o.id as string,
      subscriptionId: (sub as any)?.id as string,
      addressId: ((o as any).address_id ?? null) as string | null,
      addressLabel: addr ? ((addr as any).label || (addr as any).type || "Address") : "No address",
      quantity: qty,
      codDue: ((sub as any)?.cod_due_paise ?? 0) as number,
      batchId: ((batch as any)?.id ?? null) as string | null,
      status: (o.status as string) ?? "scheduled",
      mealSlot: (o.meal_slot as "lunch" | "dinner") ?? "lunch",
      batch: batchName,
      // C = has constraints, R = regular (codes like N/C/01 on the sheets).
      rc: (constraintParts.length > 0 ? "C" : "R") as "C" | "R",
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? "",
      address,
      meal: (meal as any)?.name ?? "—",
      constraints: constraintParts.join(", "),
      addons: addonList.map((a) => (a.qty > 1 ? `${a.name} ×${a.qty}` : a.name)).join(", "),
      addonList,
      timing: (addr as any)?.time_window ?? "",
      note: (sub as any)?.special_notes ?? "",
      // Delivery partner app (057): who took it, when, problems, photo.
      outAt: ((o as any).out_for_delivery_at ?? null) as string | null,
      deliveredAt: ((o as any).delivered_at ?? null) as string | null,
      issue: ((o as any).delivery_issue ?? null) as string | null,
      hasPhoto: !!(o as any).delivery_photo_path,
      partnerName: ((Array.isArray((o as any).delivery_partners) ? (o as any).delivery_partners[0] : (o as any).delivery_partners)?.name ?? null) as string | null,
      cashReport: cashBySub.get((sub as any)?.id) ?? null,
    };
  });

  return (
    <OperationsClient
      initialSubscribers={subscribers}
      serverDate={date}
      closures={(closureRows ?? []) as KitchenClosure[]}
      batches={(batchRows ?? []) as { id: string; name: string; meal_slot: "lunch" | "dinner" }[]}
      cashReports={cashReports}
      isToday={date === istToday()}
    />
  );
}
