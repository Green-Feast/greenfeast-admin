import { supabaseAdmin } from "@/lib/supabase-admin";
import { SubscribersClient, type Subscriber, type DeletedAccount } from "./subscribers-client";

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
      meals_lunch,
      meals_dinner,
      delivery_mode,
      special_notes,
      created_at,
      users ( name, phone, created_at ),
      batchLunch:batches!subscriptions_batch_id_lunch_fkey ( name ),
      batchDinner:batches!subscriptions_batch_id_dinner_fkey ( name ),
      plans ( meals_total )
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
  const rows = Array.from(best.values());

  // Everything below is CRM-export-only data, not shown in the table itself —
  // fetched as separate lookups (same pattern as Operations' dietary_profiles
  // join) rather than deep PostgREST embeds through tables with no direct FK
  // chain to subscriptions.
  const userIds = Array.from(new Set(rows.map((s) => s.user_id)));
  const subIds = rows.map((s) => s.id);

  const [{ data: addressRows }, { data: dietaryRows }, { data: walletRows }, { data: addonRows }] = await Promise.all([
    userIds.length
      ? supabaseAdmin.from("addresses").select("user_id, line1, landmark, pincode, is_default").in("user_id", userIds).order("is_default", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? supabaseAdmin.from("dietary_profiles").select("user_id, dietary_preference, allergens").in("user_id", userIds)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? supabaseAdmin.from("wallets").select("user_id, balance").in("user_id", userIds)
      : Promise.resolve({ data: [] as any[] }),
    subIds.length
      ? supabaseAdmin.from("subscription_addons").select("subscription_id, addons ( name )").in("subscription_id", subIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const addressByUser = new Map<string, any>();
  for (const a of addressRows ?? []) if (!addressByUser.has(a.user_id)) addressByUser.set(a.user_id, a); // first = is_default (ordered above)
  const dietaryByUser = new Map((dietaryRows ?? []).map((d) => [d.user_id, d]));
  const walletByUser = new Map((walletRows ?? []).map((w) => [w.user_id, w.balance as number]));
  const addonsBySub = new Map<string, string[]>();
  for (const a of (addonRows ?? []) as any[]) {
    const name = Array.isArray(a.addons) ? a.addons[0]?.name : a.addons?.name;
    if (!name) continue;
    const list = addonsBySub.get(a.subscription_id) ?? [];
    list.push(name);
    addonsBySub.set(a.subscription_id, list);
  }

  const subscribers: Subscriber[] = rows.map((s) => {
    const user = Array.isArray(s.users) ? s.users[0] : s.users;
    const batchLunch = Array.isArray((s as any).batchLunch) ? (s as any).batchLunch[0] : (s as any).batchLunch;
    const batchDinner = Array.isArray((s as any).batchDinner) ? (s as any).batchDinner[0] : (s as any).batchDinner;
    const plan = Array.isArray(s.plans) ? s.plans[0] : s.plans;
    const expiry = s.end_date
      ? new Date(s.end_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "";

    const addr = addressByUser.get(s.user_id);
    const address = addr ? [addr.line1, addr.landmark, addr.pincode].filter(Boolean).join(", ") : "";
    const dietary = dietaryByUser.get(s.user_id);
    const constraints = [
      dietary?.dietary_preference,
      ...(dietary?.allergens?.length ? [`Allergens: ${dietary.allergens.join(", ")}`] : []),
    ].filter(Boolean).join(" · ");
    const addonNames = (addonsBySub.get(s.id) ?? []).join(", ");

    const mealsTotal: number = (plan as any)?.meals_total ?? 0;
    const mealsPerDay = Math.max((s.meals_lunch ?? 0) + (s.meals_dinner ?? 0), 1);
    // Same "last 5 days of the plan" formula used for the mobile app's renew
    // CTA — end_date is never populated in this schema, so deliveries_remaining
    // ÷ meals/day is the only reliable renewal-timing signal available.
    const renewalDue = s.status === "active" && Math.ceil((s.deliveries_remaining ?? 0) / mealsPerDay) <= 5;

    return {
      id: s.id,
      userId: s.user_id,
      code: `APP/${s.id.slice(0, 6).toUpperCase()}`,
      batchLunch: (batchLunch as any)?.name ?? "Unassigned",
      batchDinner: (batchDinner as any)?.name ?? "Unassigned",
      rc: "C" as const,
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? "",
      address,
      meal: s.menu_type ?? "—",
      constraints,
      addons: addonNames,
      timing: "",
      notes: s.special_notes ?? "",
      plan: s.plan_name ?? s.plan_id ?? "—",
      status: (s.status.charAt(0).toUpperCase() + s.status.slice(1)) as Subscriber["status"],
      expiry,
      deliveriesRemaining: s.deliveries_remaining,
      source: "app" as const,
      mealsTotal,
      mealsLunch: s.meals_lunch ?? 0,
      mealsDinner: s.meals_dinner ?? 0,
      deliveryMode: s.delivery_mode ?? "—",
      walletBalance: walletByUser.get(s.user_id) ?? 0,
      joinedDate: (user as any)?.created_at
        ? new Date((user as any).created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
        : "—",
      renewalDue,
    };
  });

  const { data: deletedRows } = await supabaseAdmin
    .from("deleted_accounts")
    .select("id, original_user_id, name, phone, email, snapshot, deleted_at")
    .order("deleted_at", { ascending: false });

  const deletedAccounts: DeletedAccount[] = (deletedRows ?? []).map((d) => ({
    id: d.id,
    originalUserId: d.original_user_id,
    name: d.name ?? "Unknown",
    phone: d.phone ?? "—",
    email: d.email ?? "—",
    deletedAt: new Date(d.deleted_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    snapshot: d.snapshot,
  }));

  return <SubscribersClient initialSubscribers={subscribers} deletedAccounts={deletedAccounts} />;
}
