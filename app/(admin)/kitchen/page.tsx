import { supabaseAdmin } from "@/lib/supabase-admin"
import { KitchenClient, type WeeklyMenuRow, type NextMealItem, type WeeklyOverviewRow } from "./kitchen-client"

export const dynamic = "force-dynamic"

function getWeekBounds(): { weekStart: string; weekEnd: string } {
  const now = new Date()
  const dow = now.getUTCDay() // 0=Sun
  const diffToMon = dow === 0 ? -6 : 1 - dow
  const monday = new Date(now)
  monday.setUTCDate(now.getUTCDate() + diffToMon)
  monday.setUTCHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return {
    weekStart: monday.toISOString().split("T")[0],
    weekEnd: sunday.toISOString().split("T")[0],
  }
}

export default async function KitchenPage() {
  const today = new Date().toISOString().split("T")[0]
  const { weekStart, weekEnd } = getWeekBounds()

  const [
    { data: weeklyMenuRows, error },
    { data: nextMeals, error: nextError },
    { data: weekOrders },
  ] = await Promise.all([
    supabaseAdmin
      .from("weekly_menu")
      .select("id, menu_type, day_of_week, meal_slot, meal_template_id, meal_templates ( name )")
      .order("menu_type")
      .order("day_of_week")
      .order("meal_slot"),
    supabaseAdmin
      .from("orders")
      .select(`
        id, subscription_id, delivery_date, meal_slot,
        subscriptions ( id, menu_type, users ( name ) ),
        meal_templates ( name )
      `)
      .gte("delivery_date", today)
      .in("status", ["scheduled", "confirmed", "preparing"])
      .order("delivery_date")
      .limit(50),
    supabaseAdmin
      .from("orders")
      .select(`
        id, subscription_id, delivery_date, meal_slot, is_customized, quantity,
        subscriptions ( id, menu_type, user_id, users ( name ) ),
        meal_templates ( name ),
        order_addons ( addons ( name ) )
      `)
      .gte("delivery_date", weekStart)
      .lte("delivery_date", weekEnd)
      .in("status", ["scheduled", "confirmed", "preparing", "out_for_delivery"])
      .order("delivery_date"),
  ])

  const menuRows = (weeklyMenuRows ?? []).map((row: any) => ({
    id: row.id,
    menuType: row.menu_type as "M1" | "M2",
    dayOfWeek: row.day_of_week as number,
    mealSlot: row.meal_slot as "lunch" | "dinner",
    mealTemplateId: row.meal_template_id as string | null,
    mealName: (row.meal_templates?.name ?? null) as string | null,
  })) as WeeklyMenuRow[]

  // Next meal per subscription
  const nextMealMap = new Map<string, NextMealItem>()
  for (const order of (nextMeals ?? []) as any[]) {
    const subId = order.subscription_id
    if (!nextMealMap.has(subId)) {
      const sub = Array.isArray(order.subscriptions) ? order.subscriptions[0] : order.subscriptions
      const user = Array.isArray(sub?.users) ? sub?.users[0] : sub?.users
      nextMealMap.set(subId, {
        orderId: order.id,
        subscriptionId: subId,
        menuType: (sub?.menu_type ?? "M1") as "M1" | "M2",
        userName: (user?.name ?? "Unknown") as string,
        mealName: (order.meal_templates?.name ?? "—") as string,
        deliveryDate: order.delivery_date as string,
        mealSlot: order.meal_slot as "lunch" | "dinner",
      })
    }
  }

  // Weekly overview — group orders by subscription, then by date+slot
  const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const subMap = new Map<string, WeeklyOverviewRow>()
  for (const order of (weekOrders ?? []) as any[]) {
    const sub = Array.isArray(order.subscriptions) ? order.subscriptions[0] : order.subscriptions
    const user = Array.isArray(sub?.users) ? sub?.users[0] : sub?.users
    const subId = order.subscription_id as string
    if (!subMap.has(subId)) {
      subMap.set(subId, {
        subscriptionId: subId,
        userName: (user?.name ?? "Unknown") as string,
        menuType: (sub?.menu_type ?? "M1") as string,
        days: {},
      })
    }
    const row = subMap.get(subId)!
    const deliveryDate = new Date(order.delivery_date + "T00:00:00Z")
    const dowNum = (deliveryDate.getUTCDay() + 6) % 7
    const key = `${dowNum}-${order.meal_slot}`
    const addons = ((order.order_addons ?? []) as any[])
      .map((oa: any) => oa.addons?.name).filter(Boolean)
    row.days[key] = {
      mealName: (order.meal_templates?.name ?? "—") as string,
      slot: order.meal_slot as string,
      dow: DOW_NAMES[dowNum],
      dowNum,
      quantity: (order.quantity ?? 1) as number,
      isCustomized: (order.is_customized ?? false) as boolean,
      addons,
    }
  }

  if (error) console.error("[kitchen] load failed:", error)
  if (nextError) console.error("[kitchen] next meals load failed:", nextError)

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <KitchenClient
        initialRows={menuRows}
        initialNextMeals={Array.from(nextMealMap.values())}
        weeklyOverview={Array.from(subMap.values())}
        weekDates={{ weekStart, weekEnd }}
      />
    </div>
  )
}
