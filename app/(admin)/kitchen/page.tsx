import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { istToday, addDaysISO } from "@/lib/ist"
import { KitchenClient, type WeeklyMenuRow, type WeeklyOverviewRow, type CellItem } from "./kitchen-client"

export const dynamic = "force-dynamic"

// Monday of the week containing `day` (weekly_menu.day_of_week is Mon=0..Sun=6).
function mondayOf(day: string): string {
  const d = new Date(day + "T00:00:00Z")
  return addDaysISO(day, -((d.getUTCDay() + 6) % 7))
}

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  await requireAdmin()
  const isTest = await isTestMode()
  const params = await searchParams

  const today = istToday()
  const weekStart = mondayOf(params.week && /^\d{4}-\d{2}-\d{2}$/.test(params.week) ? params.week : today)
  const weekEnd = addDaysISO(weekStart, 6)

  const [
    { data: weeklyMenuRows, error },
    { data: weekOrders },
    { data: liveSubs },
    { data: meals },
    { data: addons },
  ] = await Promise.all([
    // One menu for everyone since migration 052 (the M2 track is gone).
    supabaseAdmin
      .from("weekly_menu")
      .select("id, day_of_week, meal_slot, meal_template_id, meal_templates ( name )")
      .eq("menu_type", "M1")
      .order("day_of_week")
      .order("meal_slot"),
    supabaseAdmin
      .from("orders")
      .select(`
        id, subscription_id, delivery_date, meal_slot, status, skip_reason, is_customized, extra_dish, quantity, slot_seq,
        subscriptions!inner ( id, user_id, users!inner ( name, is_test ) ),
        meal_templates ( name ),
        order_addons ( kind, quantity, unit_price, addons ( name ) )
      `)
      .gte("delivery_date", weekStart)
      .lte("delivery_date", weekEnd)
      .neq("status", "cancelled")
      .eq("subscriptions.users.is_test", isTest)
      .order("delivery_date")
      .order("slot_seq"),
    supabaseAdmin
      .from("subscriptions")
      .select("id, user_id, users!inner ( name, is_test )")
      .in("status", ["active", "paused"])
      .eq("users.is_test", isTest),
    supabaseAdmin
      .from("meal_templates")
      .select("id, name, category")
      .eq("is_active", true)
      .eq("subscription_valid", true)
      .order("category")
      .order("name"),
    supabaseAdmin.from("addons").select("id, name, price_per_meal").eq("is_active", true).order("name"),
  ])

  const menuRows = (weeklyMenuRows ?? []).map((row: any) => ({
    id: row.id,
    dayOfWeek: row.day_of_week as number,
    mealSlot: row.meal_slot as "lunch" | "dinner",
    mealTemplateId: row.meal_template_id as string | null,
    mealName: (row.meal_templates?.name ?? null) as string | null,
  })) as WeeklyMenuRow[]

  // Weekly calendar — one row per subscriber, one cell per date + slot, with
  // every order in it (base meal, extra dishes, skipped, delivered).
  const subMap = new Map<string, WeeklyOverviewRow>()
  const userOf = new Map<string, string>()
  for (const s of (liveSubs ?? []) as any[]) {
    const user = Array.isArray(s.users) ? s.users[0] : s.users
    userOf.set(s.id, s.user_id)
    subMap.set(s.id, { subscriptionId: s.id, userId: s.user_id, userName: user?.name ?? "Unknown", fixed: [], cells: {} })
  }
  for (const order of (weekOrders ?? []) as any[]) {
    const sub = Array.isArray(order.subscriptions) ? order.subscriptions[0] : order.subscriptions
    const user = Array.isArray(sub?.users) ? sub?.users[0] : sub?.users
    const subId = order.subscription_id as string
    if (!subMap.has(subId)) {
      userOf.set(subId, sub?.user_id)
      subMap.set(subId, { subscriptionId: subId, userId: sub?.user_id, userName: user?.name ?? "Unknown", fixed: [], cells: {} })
    }
    const row = subMap.get(subId)!
    const key = `${order.delivery_date}|${order.meal_slot}`
    const addonsOut = ((order.order_addons ?? []) as any[])
      .filter((oa) => oa.kind === "addon" && oa.addons?.name)
      .map((oa) => {
        // A plan add-on is included once per portion.
        const n = (oa.quantity ?? 1) * (oa.unit_price == null && !order.extra_dish ? (order.quantity ?? 1) : 1)
        return n > 1 ? `${oa.addons.name} ×${n}` : oa.addons.name
      })
    const item: CellItem = {
      mealName: order.meal_templates?.name ?? "—",
      quantity: order.quantity ?? 1,
      status: order.status,
      skipReason: order.skip_reason ?? null,
      extra: !!order.extra_dish,
      customized: !!order.is_customized,
      addons: addonsOut,
    }
    ;(row.cells[key] ??= []).push(item)
  }

  // Fixed-dish rules, shown as a pin on the subscriber's row.
  const userIds = Array.from(new Set(Array.from(userOf.values()).filter(Boolean)))
  if (userIds.length) {
    const { data: rules } = await supabaseAdmin
      .from("customer_meal_rules")
      .select("user_id, meal_slot, day_of_week, meal_templates ( name )")
      .in("user_id", userIds)
    const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    for (const row of subMap.values()) {
      row.fixed = ((rules ?? []) as any[])
        .filter((r) => r.user_id === row.userId)
        .map((r) => `${r.meal_slot === "lunch" ? "L" : "D"}${r.day_of_week === null ? "" : ` ${DAY[r.day_of_week]}`}: ${(Array.isArray(r.meal_templates) ? r.meal_templates[0] : r.meal_templates)?.name ?? "?"}`)
    }
  }

  if (error) console.error("[kitchen] load failed:", error)

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <KitchenClient
        initialRows={menuRows}
        weeklyOverview={Array.from(subMap.values()).sort((a, b) => a.userName.localeCompare(b.userName))}
        week={{ start: weekStart, end: weekEnd, today }}
        catalogue={{
          meals: (meals ?? []) as { id: string; name: string; category: string }[],
          addons: (addons ?? []) as { id: string; name: string; price_per_meal: number }[],
        }}
      />
    </div>
  )
}
