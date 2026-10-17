import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import type { MealSlot } from "./delivery";

// What the delivery partner app shows: the partner's batches, and each
// batch's stops for a day — one stop per address, with everything going
// there (portions, add-ons, extra dishes), cash to collect and status.

export type PartnerBatch = {
  id: string;
  name: string;
  area: string | null;
  slot: MealSlot;
  timeWindow: string | null;
  role: "primary" | "secondary";
};

export type StopItem = {
  orderId: string;
  meal: string;
  qty: number;
  extra: boolean;
  addons: string[];
  status: string;
  deliveredAt: string | null;
  outAt: string | null;
  issue: string | null;
  hasPhoto: boolean;
};

export type Stop = {
  key: string;
  addressId: string | null;
  seq: number | null;
  name: string;
  phone: string;
  label: string;
  address: string;
  pincode: string | null;
  timing: string | null;
  lat: number | null;
  lng: number | null;
  subscriptionId: string;
  userId: string;
  codDue: number;
  cashReport: { id: string; amount: number } | null;
  note: string | null;
  items: StopItem[];
  state: "pending" | "on_the_way" | "delivered" | "issue" | "closed";
};

// Customers see 12–2 / 5–7 in the app (onboarding "days" screen).
export const SLOT_HOURS: Record<MealSlot, string> = { lunch: "12–2 PM", dinner: "5–7 PM" };
export const RUN_LABEL: Record<string, string> = { morning: "Morning run", noon: "Noon run", evening: "Evening run" };

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export async function partnerBatches(partnerId: string): Promise<PartnerBatch[]> {
  const { data } = await supabaseAdmin
    .from("batches")
    .select("id, name, area, meal_slot, time_window, primary_partner_id, secondary_partner_id")
    .or(`primary_partner_id.eq.${partnerId},secondary_partner_id.eq.${partnerId}`)
    .order("name");
  return (data ?? []).map((b: any) => ({
    id: b.id,
    name: b.name,
    area: b.area ?? null,
    slot: b.meal_slot as MealSlot,
    timeWindow: b.time_window ?? null,
    role: b.primary_partner_id === partnerId ? "primary" : "secondary",
  }));
}

const ORDER_SELECT = `
  id, status, quantity, extra_dish, meal_slot, delivery_date, batch_id, address_id, user_id,
  delivered_at, out_for_delivery_at, delivery_issue, delivery_photo_path,
  meal_templates ( name ),
  addresses ( id, label, type, line1, landmark, city, pincode, time_window, lat, lng ),
  order_addons ( kind, quantity, unit_price, addons ( name ) ),
  subscriptions!inner ( id, user_id, special_notes, cod_due_paise, users!inner ( name, phone, is_test ) )
`;

/**
 * A batch's stops for one date and slot, in the partner's saved order
 * (route_stops), new addresses last. Only the partner's own Live/Test world.
 */
export async function batchStops(batchId: string, date: string, slot: MealSlot, isTest: boolean): Promise<Stop[]> {
  const [{ data: orders, error }, { data: seqRows }] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select(ORDER_SELECT)
      .eq("batch_id", batchId)
      .eq("delivery_date", date)
      .eq("meal_slot", slot)
      .not("status", "in", "(cancelled,skipped)")
      .eq("subscriptions.users.is_test", isTest)
      .order("created_at"),
    supabaseAdmin.from("route_stops").select("address_id, seq").eq("batch_id", batchId),
  ]);
  if (error) throw error;

  const seqByAddress = new Map((seqRows ?? []).map((r: { address_id: string; seq: number }) => [r.address_id, r.seq]));
  const subIds = Array.from(new Set((orders ?? []).map((o: any) => one<any>(o.subscriptions)?.id).filter(Boolean)));
  const { data: reports } = subIds.length
    ? await supabaseAdmin
        .from("cash_reports")
        .select("id, subscription_id, amount_paise")
        .in("subscription_id", subIds)
        .is("recorded_at", null)
        .is("dismissed_at", null)
        .order("reported_at", { ascending: false })
    : { data: [] as any[] };
  const reportBySub = new Map<string, { id: string; amount: number }>();
  for (const r of (reports ?? []) as { id: string; subscription_id: string; amount_paise: number }[]) {
    if (!reportBySub.has(r.subscription_id)) reportBySub.set(r.subscription_id, { id: r.id, amount: r.amount_paise });
  }

  const stops = new Map<string, Stop>();
  for (const o of (orders ?? []) as any[]) {
    const sub = one<any>(o.subscriptions);
    const user = one<any>(sub?.users);
    const addr = one<any>(o.addresses);
    const meal = one<any>(o.meal_templates);
    const qty = (o.quantity ?? 1) as number;
    const key = o.address_id ?? o.id;

    // Same counting as Operations: a plan add-on comes once per portion;
    // anything else carries its own count.
    const addons = ((o.order_addons ?? []) as any[])
      .filter((a) => a.kind === "addon")
      .map((a) => {
        const name = one<any>(a.addons)?.name;
        if (!name) return null;
        const n = (a.quantity ?? 1) * (a.unit_price == null && !o.extra_dish ? qty : 1);
        return n > 1 ? `${name} ×${n}` : name;
      })
      .filter(Boolean) as string[];

    const item: StopItem = {
      orderId: o.id,
      meal: meal?.name ?? "Meal",
      qty,
      extra: !!o.extra_dish,
      addons,
      status: o.status,
      deliveredAt: o.delivered_at ?? null,
      outAt: o.out_for_delivery_at ?? null,
      issue: o.delivery_issue ?? null,
      hasPhoto: !!o.delivery_photo_path,
    };

    const existing = stops.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    stops.set(key, {
      key,
      addressId: o.address_id ?? null,
      seq: o.address_id ? (seqByAddress.get(o.address_id) ?? null) : null,
      name: user?.name ?? "Customer",
      phone: user?.phone ?? "",
      label: addr ? addr.label || addr.type || "Address" : "No address",
      // Jaipur is implied — street address and landmark, like the sheets.
      address: addr ? [addr.line1, addr.landmark].filter(Boolean).join(", ") : "No address saved — call the customer",
      pincode: addr?.pincode ?? null,
      timing: addr?.time_window ?? null,
      lat: typeof addr?.lat === "number" ? addr.lat : null,
      lng: typeof addr?.lng === "number" ? addr.lng : null,
      subscriptionId: sub?.id,
      userId: sub?.user_id,
      codDue: sub?.cod_due_paise ?? 0,
      cashReport: reportBySub.get(sub?.id) ?? null,
      note: sub?.special_notes?.trim() || null,
      items: [item],
      state: "pending",
    });
  }

  const list = Array.from(stops.values());
  for (const s of list) s.state = stopState(s.items);
  list.sort((a, b) => {
    if (a.seq != null && b.seq != null) return a.seq - b.seq;
    if (a.seq != null) return -1;
    if (b.seq != null) return 1;
    return a.name.localeCompare(b.name);
  });
  return list;
}

export function stopState(items: { status: string; issue: string | null }[]): Stop["state"] {
  const open = items.filter((i) => !["delivered", "cancelled", "skipped"].includes(i.status));
  if (open.length === 0) return items.some((i) => i.status === "delivered") ? "delivered" : "closed";
  if (open.some((i) => i.issue)) return "issue";
  if (open.some((i) => i.status === "out_for_delivery")) return "on_the_way";
  return "pending";
}

export type BatchDay = { stops: number; meals: number; done: number; issues: number; open: number; cash: number };

/** Per batch and date: stops, meals, how many are done, problems, cash to collect. */
export async function batchDays(batchIds: string[], dates: string[], isTest: boolean): Promise<Map<string, BatchDay>> {
  const out = new Map<string, BatchDay>();
  if (batchIds.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id, batch_id, delivery_date, status, quantity, address_id, delivery_issue, subscriptions!inner ( id, cod_due_paise, users!inner ( is_test ) )")
    .in("batch_id", batchIds)
    .in("delivery_date", dates)
    .not("status", "in", "(cancelled,skipped)")
    .eq("subscriptions.users.is_test", isTest);

  const groups = new Map<string, Map<string, { items: { status: string; issue: string | null }[]; sub: string; cod: number }>>();
  const meals = new Map<string, number>();
  for (const o of (data ?? []) as any[]) {
    const k = `${o.batch_id}|${o.delivery_date}`;
    const sub = one<any>(o.subscriptions);
    if (!groups.has(k)) groups.set(k, new Map());
    const stopKey = o.address_id ?? o.id;
    const g = groups.get(k)!;
    if (!g.has(stopKey)) g.set(stopKey, { items: [], sub: sub?.id, cod: sub?.cod_due_paise ?? 0 });
    g.get(stopKey)!.items.push({ status: o.status, issue: o.delivery_issue ?? null });
    meals.set(k, (meals.get(k) ?? 0) + (o.quantity ?? 1));
  }
  for (const [k, g] of groups) {
    const day: BatchDay = { stops: g.size, meals: meals.get(k) ?? 0, done: 0, issues: 0, open: 0, cash: 0 };
    const cashSubs = new Set<string>();
    for (const s of g.values()) {
      const state = stopState(s.items);
      if (state === "delivered" || state === "closed") day.done++;
      else day.open++;
      if (state === "issue") day.issues++;
      if (s.cod > 0 && !cashSubs.has(s.sub)) {
        cashSubs.add(s.sub);
        day.cash += s.cod;
      }
    }
    out.set(k, day);
  }
  return out;
}
