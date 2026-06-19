import { supabaseAdmin } from "@/lib/supabase-admin"
import { KitchenClient, type WeeklyMenuRow } from "./kitchen-client"

export const dynamic = "force-dynamic"

export default async function KitchenPage() {
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

  if (error) console.error("[kitchen] load failed:", error)

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <KitchenClient initialRows={menuRows} />
    </div>
  )
}
