import { supabaseAdmin } from "@/lib/supabase-admin"
import { KitchenClient, type WeeklyMenuRow, type NextMealItem } from "./kitchen-client"

export const dynamic = "force-dynamic"

export default async function KitchenPage() {
  const today = new Date().toISOString().split("T")[0]

  const { data: weeklyMenuRows, error } = await supabaseAdmin
    .from("weekly_menu")
    .select("id, menu_type, day_of_week, meal_slot, meal_template_id, meal_templates ( name )")
    .order("menu_type")
    .order("day_of_week")
    .order("meal_slot")

  const menuRows = (weeklyMenuRows ?? []).map((row: any) => ({
    id: row.id,
    menuType: row.menu_type as "M1" | "M2",
    dayOfWeek: row.day_of_week as number,
    mealSlot: row.meal_slot as "lunch" | "dinner",
    mealTemplateId: row.meal_template_id as string | null,
    mealName: (row.meal_templates?.name ?? null) as string | null,
  })) as WeeklyMenuRow[]

  // Fetch next meal per active subscription (soonest first)
  const { data: nextMeals, error: nextError } = await supabaseAdmin
    .from("orders")
    .select(`
      id,
      subscription_id,
      delivery_date,
      meal_slot,
      subscriptions ( id, menu_type, users ( name ) ),
      meal_templates ( name )
    `)
    .gte("delivery_date", today)
    .in("status", ["scheduled", "confirmed", "preparing"])
    .order("delivery_date")
    .limit(50)

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

  if (error) console.error("[kitchen] load failed:", error)
  if (nextError) console.error("[kitchen] next meals load failed:", nextError)

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <KitchenClient initialRows={menuRows} initialNextMeals={Array.from(nextMealMap.values())} />
    </div>
  )
}
