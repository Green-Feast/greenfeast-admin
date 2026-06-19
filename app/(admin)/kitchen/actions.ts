"use server"

import { supabaseAdmin } from "@/lib/supabase-admin"
import type { WeeklyMenuRow } from "./kitchen-client"

export async function updateWeeklyMenu(rows: WeeklyMenuRow[]) {
  const today = new Date().toISOString().split("T")[0]

  for (const row of rows) {
    // Skip temp rows (not yet saved)
    if (row.id.startsWith("temp-")) {
      const { error } = await supabaseAdmin
        .from("weekly_menu")
        .insert({
          menu_type: row.menuType,
          day_of_week: row.dayOfWeek,
          meal_slot: row.mealSlot,
          meal_template_id: row.mealTemplateId,
        })
      if (error) throw error
    } else if (row.mealTemplateId) {
      // Update existing
      const { error } = await supabaseAdmin
        .from("weekly_menu")
        .update({
          meal_template_id: row.mealTemplateId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
      if (error) throw error
    } else {
      // Delete if meal was cleared
      const { error } = await supabaseAdmin
        .from("weekly_menu")
        .delete()
        .eq("id", row.id)
      if (error) throw error
    }
  }
}

export async function propagateMenuChanges(rows: WeeklyMenuRow[]) {
  const today = new Date().toISOString().split("T")[0]

  // Build a map of (menu_type, day_of_week, meal_slot) → meal_template_id for quick lookup
  const menuMap: Record<string, string | null> = {}
  for (const row of rows) {
    const key = `${row.menuType}-${row.dayOfWeek}-${row.mealSlot}`
    menuMap[key] = row.mealTemplateId
  }

  // For each modified entry, find future un-swapped orders that match and update them
  for (const row of rows) {
    if (!row.mealTemplateId) continue // Skip cleared entries

    // Fetch all active/paused subscriptions with this menu_type
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("id, user_id")
      .in("status", ["active", "paused"])
      .eq("menu_type", row.menuType)

    for (const sub of (subs ?? [])) {
      // Find future un-swapped orders for this subscription matching the day_of_week and meal_slot
      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("id, delivery_date")
        .eq("subscription_id", sub.id)
        .eq("meal_slot", row.mealSlot)
        .eq("is_customized", false)
        .gte("delivery_date", today)
        .in("status", ["scheduled", "confirmed"])

      // For each order, check if its delivery_date matches the menu day_of_week
      for (const order of (orders ?? []) as Array<{ id: string; delivery_date: string }>) {
        const deliveryDate = new Date(order.delivery_date + "T00:00:00")
        const orderDow = (deliveryDate.getUTCDay() + 6) % 7 // Convert Sunday=0 to Mon=0
        if (orderDow === row.dayOfWeek) {
          // This order matches; update it
          await supabaseAdmin
            .from("orders")
            .update({ meal_template_id: row.mealTemplateId })
            .eq("id", order.id)
        }
      }
    }
  }
}
