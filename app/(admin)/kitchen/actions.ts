"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { audited } from "@/lib/audit"
import { istToday, isSlotLocked } from "@/lib/ist"
import { DRINK_CATEGORIES, DRINK_AS_MEAL_ERROR, isDrinkCategory } from "@/lib/drinks"
import type { WeeklyMenuRow } from "./kitchen-client"

export async function updateWeeklyMenu(rows: WeeklyMenuRow[]) {
  return audited("kitchen.updateWeeklyMenu", {
    details: { rows: rows.length, meals: rows.filter((r) => r.mealTemplateId).length, drinks: rows.filter((r) => r.drinkTemplateId).length },
  }, async () => {
    // Server actions are independently-callable POST endpoints — the
    // (admin)/layout.tsx gate only protects page navigation, not these.
    await requireAdmin()
    // The slot's dish is a meal; a drink goes in its own drink field (088). A
    // drink already saved as a slot's dish stays until someone changes it, so
    // saving the rest of the grid isn't blocked by it.
    const { data: saved, error: savedError } = await supabaseAdmin
      .from("weekly_menu").select("day_of_week, meal_slot, meal_template_id").eq("menu_type", "M1")
    if (savedError) throw savedError
    const savedMeal = new Map(
      ((saved ?? []) as { day_of_week: number; meal_slot: string; meal_template_id: string | null }[])
        .map((r) => [`${r.day_of_week}|${r.meal_slot}`, r.meal_template_id])
    )
    const changedMealIds = [...new Set(
      rows
        .filter((r) => r.mealTemplateId && savedMeal.get(`${r.dayOfWeek}|${r.mealSlot}`) !== r.mealTemplateId)
        .map((r) => r.mealTemplateId!)
    )]
    if (changedMealIds.length) {
      const { data: dishes, error } = await supabaseAdmin.from("meal_templates").select("category").in("id", changedMealIds)
      if (error) throw error
      if ((dishes ?? []).some((d: { category: string }) => isDrinkCategory(d.category))) throw new Error(DRINK_AS_MEAL_ERROR)
    }
    // Independent rows, so run them concurrently rather than one round trip each.
    await Promise.all(
      rows.map(async (row) => {
        // A slot row carries a dish AND a drink (drink_template_id, 088), and
        // either can be empty on its own. The row only goes away when both are.
        const mealTemplateId = row.mealTemplateId || null
        const drinkTemplateId = row.drinkTemplateId || null
        const empty = !mealTemplateId && !drinkTemplateId

        if (row.id.startsWith("temp-")) {
          // Not yet saved. The page keeps these temp ids after a save, so this is
          // an upsert on the slot's unique key (a second save must not collide)
          // and clearing one deletes by that key (a no-op if it was never saved).
          if (empty) {
            const { error } = await supabaseAdmin
              .from("weekly_menu")
              .delete()
              .eq("menu_type", "M1")
              .eq("day_of_week", row.dayOfWeek)
              .eq("meal_slot", row.mealSlot)
            if (error) throw error
            return
          }
          const { error } = await supabaseAdmin
            .from("weekly_menu")
            .upsert(
              {
                menu_type: "M1", // one menu for everyone since migration 052
                day_of_week: row.dayOfWeek,
                meal_slot: row.mealSlot,
                meal_template_id: mealTemplateId,
                drink_template_id: drinkTemplateId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "menu_type,day_of_week,meal_slot" }
            )
          if (error) throw error
        } else if (!empty) {
          // Update existing
          const { error } = await supabaseAdmin
            .from("weekly_menu")
            .update({
              meal_template_id: mealTemplateId,
              drink_template_id: drinkTemplateId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id)
          if (error) throw error
        } else {
          // Delete once both the dish and the drink were cleared
          const { error } = await supabaseAdmin
            .from("weekly_menu")
            .delete()
            .eq("id", row.id)
          if (error) throw error
        }
      })
    )
  })
}

const ID_CHUNK = 200

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// The weekly drink goes to future drink items (097: a drink is its own order
// row, item_kind 'drink'), the same way the dish does: scheduled/confirmed
// only, today's slot frozen past its cutoff, and nothing touched once the
// customer or office picked that day's drink themselves (is_customized). A
// weekly drink that can't be delivered (inactive or dine-in only) leaves the
// drink items as they are. Walk-ins are never the weekly menu's to set.
async function propagateDrinks(
  rows: WeeklyMenuRow[],
  today: string,
  subIds: string[],
  frozenIds: Set<string>
) {
  const drinkRows = rows.filter((r) => r.drinkTemplateId)
  if (drinkRows.length === 0) return

  type Dish = { id: string; category: string; is_active: boolean; subscription_valid: boolean }
  const { data: dishes, error: dishErr } = await supabaseAdmin
    .from("meal_templates")
    .select("id, category, is_active, subscription_valid")
    .in("id", [...new Set(drinkRows.map((r) => r.drinkTemplateId!))])
  if (dishErr) throw dishErr
  const dishById = new Map(((dishes ?? []) as Dish[]).map((d) => [d.id, d]))
  const deliverable = (id: string) => {
    const d = dishById.get(id)
    return !!d && d.is_active && d.subscription_valid && DRINK_CATEGORIES.includes(d.category)
  }

  type DrinkItem = { id: string; delivery_date: string; meal_template_id: string | null }
  const itemsBySlot = new Map<string, DrinkItem[]>()
  await Promise.all(
    [...new Set(drinkRows.map((r) => r.mealSlot))].map(async (slot) => {
      const batches = await Promise.all(
        chunk(subIds, ID_CHUNK).map(async (ids) => {
          const { data, error } = await supabaseAdmin
            .from("orders")
            .select("id, delivery_date, meal_template_id")
            .in("subscription_id", ids)
            .eq("meal_slot", slot)
            .eq("item_kind", "drink")
            .eq("walk_in", false)
            .eq("is_customized", false)
            .gte("delivery_date", today)
            .in("status", ["scheduled", "confirmed"])
          if (error) throw error
          return (data ?? []) as DrinkItem[]
        })
      )
      itemsBySlot.set(slot, batches.flat())
    })
  )

  const byDrink = new Map<string, string[]>()
  for (const row of drinkRows) {
    if (!deliverable(row.drinkTemplateId!)) continue
    const todayFrozen = isSlotLocked(today, row.mealSlot)
    for (const item of itemsBySlot.get(row.mealSlot) ?? []) {
      const dow = (new Date(item.delivery_date + "T00:00:00Z").getUTCDay() + 6) % 7
      if (dow !== row.dayOfWeek || item.meal_template_id === row.drinkTemplateId) continue
      if (item.delivery_date === today && todayFrozen) {
        frozenIds.add(item.id)
        continue
      }
      byDrink.set(row.drinkTemplateId!, [...(byDrink.get(row.drinkTemplateId!) ?? []), item.id])
    }
  }

  await Promise.all(
    [...byDrink.entries()].flatMap(([drinkId, ids]) =>
      chunk(ids, ID_CHUNK).map(async (part) => {
        const { error } = await supabaseAdmin.from("orders").update({ meal_template_id: drinkId }).in("id", part)
        if (error) throw error
        for (const id of part) await supabaseAdmin.rpc("snapshot_order_ingredients", { p_order: id })
      })
    )
  )
}

export async function propagateMenuChanges(rows: WeeklyMenuRow[]) {
  return audited("kitchen.propagateMenuChanges", { details: { rows: rows.length } }, async () => {
    await requireAdmin()
    const today = istToday()
    // Order ids left alone because today's slot is past its cutoff (dish or drink).
    const frozenIds = new Set<string>()

    const menuRows = rows.filter((r) => r.mealTemplateId) // Skip cleared entries

    // Every live plan is on the one menu (migration 052).
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .in("status", ["active", "paused"])
    const subIds = (subs ?? []).map((s: { id: string }) => s.id)

    // Future un-swapped orders per slot, fetched once and then matched to each
    // menu row by weekday in memory.
    type Order = { id: string; delivery_date: string; meal_template_id: string }
    const ordersBySlot = new Map<string, Order[]>()
    const slots = new Set(menuRows.map((r) => r.mealSlot))
    await Promise.all(
      [...slots].map(async (slot) => {
        const batches = await Promise.all(
          chunk(subIds, ID_CHUNK).map(async (ids) => {
            const { data } = await supabaseAdmin
              .from("orders")
              .select("id, delivery_date, meal_template_id")
              .in("subscription_id", ids)
              .eq("meal_slot", slot)
              .eq("is_customized", false)
              .eq("extra_dish", false)
              .gte("delivery_date", today)
              .in("status", ["scheduled", "confirmed"])
            return (data ?? []) as Order[]
          })
        )
        ordersBySlot.set(slot, batches.flat())
      })
    )

    // Group the order ids to rewrite by target meal so each meal is one update.
    const idsByTemplate = new Map<string, string[]>()
    for (const row of menuRows) {
      // Today's cutoff for this slot may already be behind us (same check the
      // mobile app and is_slot_locked enforce for subscriber edits) — if so,
      // today's already-printed/committed orders for this slot must not be
      // silently rewritten out from under the kitchen. Every other future date
      // is unaffected; only "today, this slot, past its cutoff" is frozen.
      const todayFrozen = isSlotLocked(today, row.mealSlot)
      for (const order of ordersBySlot.get(row.mealSlot) ?? []) {
        const deliveryDate = new Date(order.delivery_date + "T00:00:00Z")
        const orderDow = (deliveryDate.getUTCDay() + 6) % 7 // Convert Sunday=0 to Mon=0
        if (orderDow !== row.dayOfWeek) continue
        if (order.meal_template_id === row.mealTemplateId) continue // already on it

        if (order.delivery_date === today && todayFrozen) {
          frozenIds.add(order.id)
          continue
        }
        const list = idsByTemplate.get(row.mealTemplateId!) ?? []
        list.push(order.id)
        idsByTemplate.set(row.mealTemplateId!, list)
      }
    }

    await Promise.all(
      [...idsByTemplate].flatMap(([templateId, ids]) =>
        chunk(ids, ID_CHUNK).map(async (part) => {
          const { error } = await supabaseAdmin
            .from("orders")
            .update({ meal_template_id: templateId })
            .in("id", part)
          if (error) throw error
          // The kitchen's ingredient list follows the dish.
          await Promise.all(part.map((id) => supabaseAdmin.rpc("snapshot_order_ingredients", { p_order: id })))
        })
      )
    )

    await propagateDrinks(rows, today, subIds, frozenIds)

    // Kick off order creation for any active subscriptions that have no future
    // orders yet (e.g. menu was empty when they signed up). Fire-and-forget so
    // the admin Save button doesn't block waiting for 14 days of inserts.
    fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/instantiate-orders`,
      {
        method: "POST",
        headers: {
          // INTERNAL_FN_SECRET, not SUPABASE_SECRET_KEY — see
          // app/api/cron/instantiate-orders/route.ts for why.
          Authorization: `Bearer ${process.env.INTERNAL_FN_SECRET}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    ).catch(() => {})

    return { frozen: frozenIds.size }
  })
}

// Per-date availability only hides an item from subscribers choosing NEW
// meals/add-ons for that date — it never touches orders already scheduled
// with that item. Row absent (or is_available=true) means available, so
// this is a plain upsert of whatever the admin actually touched; anything
// left untouched simply keeps reading as available via absence.
export async function saveDailyAvailability(
  forDate: string,
  meals: Record<string, boolean>,
  addons: Record<string, boolean>
) {
  return audited("kitchen.saveDailyAvailability", {
    ref: forDate,
    details: { forDate, meals: Object.keys(meals).length, addons: Object.keys(addons).length, mealsOff: Object.values(meals).filter((v) => !v).length, addonsOff: Object.values(addons).filter((v) => !v).length },
  }, async () => {
    await requireAdmin()
    if (forDate < istToday()) throw new Error("Cannot edit availability for a past date")

    const now = new Date().toISOString()

    const mealRows = Object.entries(meals).map(([meal_template_id, is_available]) => ({
      for_date: forDate,
      meal_template_id,
      is_available,
      updated_at: now,
    }))
    if (mealRows.length > 0) {
      const { error } = await supabaseAdmin
        .from("meal_availability")
        .upsert(mealRows, { onConflict: "for_date,meal_template_id" })
      if (error) throw error
    }

    const addonRows = Object.entries(addons).map(([addon_id, is_available]) => ({
      for_date: forDate,
      addon_id,
      is_available,
      updated_at: now,
    }))
    if (addonRows.length > 0) {
      const { error } = await supabaseAdmin
        .from("addon_availability")
        .upsert(addonRows, { onConflict: "for_date,addon_id" })
      if (error) throw error
    }

    revalidatePath("/kitchen")
  })
}

// Delete-then-insert for the date — handles clearing a special back to null,
// and is race-free enough for a single-admin tool.
export async function saveDailySpecials(forDate: string, mealTemplateIds: (string | null)[]) {
  return audited("kitchen.saveDailySpecials", {
    ref: forDate,
    details: { forDate, count: mealTemplateIds.filter(Boolean).length, mealTemplateIds: mealTemplateIds.filter(Boolean).slice(0, 10) },
  }, async () => {
    await requireAdmin()
    if (forDate < istToday()) throw new Error("Cannot edit specials for a past date")

    const { error: deleteError } = await supabaseAdmin
      .from("daily_specials")
      .delete()
      .eq("for_date", forDate)
    if (deleteError) throw deleteError

    const rows = mealTemplateIds
      .map((id, i) => (id ? { for_date: forDate, sort_order: i + 1, meal_template_id: id } : null))
      .filter((r): r is { for_date: string; sort_order: number; meal_template_id: string } => r !== null)

    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("daily_specials").insert(rows)
      if (error) throw error
    }

    revalidatePath("/kitchen")
  })
}

