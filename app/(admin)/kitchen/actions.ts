"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { istToday, isSlotLocked } from "@/lib/ist"
import type { WeeklyMenuRow } from "./kitchen-client"

export async function updateWeeklyMenu(rows: WeeklyMenuRow[]) {
  // Server actions are independently-callable POST endpoints — the
  // (admin)/layout.tsx gate only protects page navigation, not these.
  await requireAdmin()
  // Independent rows, so run them concurrently rather than one round trip each.
  await Promise.all(
    rows.map(async (row) => {
      if (row.id.startsWith("temp-")) {
        // Not yet saved (and set then cleared again before saving: nothing to do)
        if (!row.mealTemplateId) return
        const { error } = await supabaseAdmin
          .from("weekly_menu")
          .insert({
            menu_type: "M1", // one menu for everyone since migration 052
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
    })
  )
}

const ID_CHUNK = 200

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function propagateMenuChanges(rows: WeeklyMenuRow[]) {
  await requireAdmin()
  const today = istToday()
  let frozen = 0

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
        frozen++
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

  return { frozen }
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
}

// Delete-then-insert for the date — handles clearing a special back to null,
// and is race-free enough for a single-admin tool.
export async function saveDailySpecials(forDate: string, mealTemplateIds: (string | null)[]) {
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
}

