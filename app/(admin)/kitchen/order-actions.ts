"use server"

// Admin edits to individual meals — the Kitchen calendar's cell drawer and
// the subscriber profile's "Upcoming meals" both use these, for whatever a
// customer asks for over WhatsApp: another dish, fewer or more portions,
// add-ons, a different address, skip / bring back, an extra dish, or the
// same dish every day (customer_meal_rules, migration 052).
//
// Nothing here moves money: meals are billed from the wallet on delivery
// (advance_*_delivered recompute the cart), so every edit just re-snapshots
// cart_total. Orders stay editable until the kitchen starts on them
// ('preparing'); past the slot's cutoff the drawer warns instead of blocking.

import { revalidatePath } from "next/cache"
import { audited, sensitive } from "@/lib/audit"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { mealRate } from "@/lib/pricing"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"
import { istToday, isSlotLocked } from "@/lib/ist"
import { deliverOrders, skipUndelivered } from "@/lib/delivery"
import { DRINK_CATEGORIES, DRINK_AS_MEAL_ERROR, DRINK_NOT_PICKED, isDrinkCategory } from "@/lib/drinks"
import { addressText } from "@/lib/address"

export type Slot = "lunch" | "dinner"

export type SlotOrderAddon = {
  lineId: string
  addonId: string
  name: string
  // What goes out: a plan add-on is included once per portion.
  quantity: number
  unitPrice: number | null
  included: boolean
}

// The order's drink (088): the add-on line whose addon is a drink, plus the
// dish it stands for. templateId null = none picked yet (an old order).
export type SlotOrderDrink = {
  lineId: string
  templateId: string | null
  name: string
  edited: boolean
}

// A drink dish the editor can offer. deliverable = active + subscription_valid;
// anything else is dine-in / pickup only.
export type SlotDrinkOption = { id: string; name: string; category: string; deliverable: boolean }

export type SlotOrder = {
  id: string
  status: string
  skipReason: string | null
  quantity: number
  unitPrice: number | null
  cartTotal: number | null
  extraDish: boolean
  isCustomized: boolean
  mealTemplateId: string
  mealName: string
  addressId: string | null
  batchName: string | null
  fulfilment: string
  addons: SlotOrderAddon[]
  drink: SlotOrderDrink | null
}

export type SlotAddress = {
  id: string
  label: string
  line1: string
  isDefault: boolean
  batchLunch: string | null
  batchDinner: string | null
}

export type FixedRule = { id: string; dayOfWeek: number | null; mealTemplateId: string; mealName: string }

export type SlotContext = {
  subscriptionId: string
  userId: string
  customerName: string
  date: string
  slot: Slot
  locked: boolean
  orders: SlotOrder[]
  addresses: SlotAddress[]
  walletBalance: number
  onCredit: boolean
  baseRate: number
  planAddonIds: string[]
  // Which add-ons are the drink (addons.is_drink), and the drink dishes to pick from.
  drinkAddonIds: string[]
  drinks: SlotDrinkOption[]
  rules: FixedRule[]
}

export type EditResult = { ok: true; message?: string } | { ok: false; error: string }

const EDITABLE = ["scheduled", "confirmed"]

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

// A drink (smoothie / coffee) comes with the meal; it is never the meal itself.
async function isDrinkDish(mealTemplateId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("meal_templates").select("category").eq("id", mealTemplateId).maybeSingle()
  return isDrinkCategory(data?.category)
}

function dowMon0(date: string) {
  return (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7
}

function refresh(subscriptionId?: string) {
  revalidatePath("/kitchen")
  revalidatePath("/operations")
  if (subscriptionId) revalidatePath(`/subscribers/${subscriptionId}`)
}

async function baseRateFor(subscriptionId: string) {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("meal_price_paise, plans ( base_price, meals_total )")
    .eq("id", subscriptionId)
    .maybeSingle()
  const plan = one((data as any)?.plans) as { base_price: number; meals_total: number } | null
  return mealRate(data as any, plan)
}

type OrderRow = {
  id: string
  user_id: string
  subscription_id: string
  status: string
  delivery_date: string
  meal_slot: Slot
  quantity: number | null
  unit_price: number | null
  extra_dish: boolean
}

async function editableOrder(orderId: string): Promise<OrderRow | string> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id, user_id, subscription_id, status, delivery_date, meal_slot, quantity, unit_price, extra_dish, item_kind")
    .eq("id", orderId)
    .maybeSingle()
  if (!data) return "Meal not found."
  if (!EDITABLE.includes(data.status)) {
    return data.status === "skipped"
      ? "This meal is skipped — bring it back first."
      : "The kitchen has already started on this meal."
  }
  return data as OrderRow
}

// The cart minimum (097) — the office follows it too: a slot the plan delivers
// keeps the plan's meals, drinks and plan add-ons; less than that is a skip.
// delta = what the change takes away. Returns why not, or null.
async function minimumProblem(
  order: { subscription_id: string; delivery_date: string; meal_slot: string },
  delta: { meals?: number; drinks?: number; addonId?: string; addonBy?: number },
): Promise<string | null> {
  const { data: st } = await supabaseAdmin.rpc("slot_cart_state", {
    p_sub: order.subscription_id, p_date: order.delivery_date, p_slot: order.meal_slot,
  })
  if (!st?.applies) return null
  if (delta.meals && st.meals - delta.meals < st.need_meals) {
    return `Their plan has ${st.need_meals} meal${st.need_meals === 1 ? "" : "s"} here — swap a dish instead, or skip the meal. (Fewer meals every day is a plan change.)`
  }
  if (delta.drinks && st.drinks - delta.drinks < st.need_drinks) {
    return `Their plan has ${st.need_drinks} drink${st.need_drinks === 1 ? "" : "s"} here — pick another drink instead, or skip the meal.`
  }
  if (delta.addonId && delta.addonBy) {
    const pa = ((st.plan_addons ?? []) as { id: string; have: number }[]).find((x) => x.id === delta.addonId)
    if (pa && pa.have - delta.addonBy < st.need_meals) return "That add-on comes with their plan's meals — it stays (removing it is a plan change)."
  }
  return null
}

async function recompute(orderId: string) {
  await supabaseAdmin.rpc("recompute_order_cart", { p_order: orderId })
}

// ── Read ──────────────────────────────────────────────────────────────────

export async function getSlotContext(subscriptionId: string, date: string, slot: Slot): Promise<SlotContext> {
  await requireAdmin()
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, cod_on_credit, status, meal_price_paise, users ( name ), plans ( base_price, meals_total )")
    .eq("id", subscriptionId)
    .single()
  if (!sub) throw new Error("Subscription not found.")
  const userId = sub.user_id as string
  const plan = one((sub as any).plans) as { base_price: number; meals_total: number } | null

  const [
    { data: orders }, { data: addrs }, { data: wallet }, { data: subAddons }, { data: rules },
    { data: drinkDishes }, { data: drinkAddons },
  ] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select(`
        id, status, skip_reason, quantity, unit_price, cart_total, extra_dish, is_customized,
        meal_template_id, address_id, slot_seq, fulfilment, drink_template_id, drink_edited,
        meal_templates ( name ), batches ( name ),
        order_addons ( id, addon_id, kind, quantity, unit_price, sub_option, addons ( name, is_drink ) )
      `)
      .eq("subscription_id", subscriptionId)
      .eq("delivery_date", date)
      .eq("meal_slot", slot)
      .neq("status", "cancelled")
      .order("slot_seq"),
    supabaseAdmin
      .from("addresses")
      .select("id, label, type, line1, line2, is_default, batch_id_lunch, batch_id_dinner")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .order("created_at"),
    supabaseAdmin.from("wallets").select("balance").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("subscription_addons").select("addon_id").eq("subscription_id", subscriptionId),
    supabaseAdmin
      .from("customer_meal_rules")
      .select("id, day_of_week, meal_template_id, meal_templates ( name )")
      .eq("user_id", userId)
      .eq("meal_slot", slot),
    // Drinks are meal_templates rows. orders.drink_template_id has no FK (088),
    // so the dish can't be embedded: fetch the drink dishes and map by id.
    supabaseAdmin
      .from("meal_templates")
      .select("id, name, category, is_active, subscription_valid")
      .in("category", DRINK_CATEGORIES)
      .order("category")
      .order("name"),
    supabaseAdmin.from("addons").select("id").eq("is_drink", true),
  ])

  type DrinkDish = { id: string; name: string; category: string; is_active: boolean; subscription_valid: boolean }
  const drinkById = new Map(((drinkDishes ?? []) as DrinkDish[]).map((d) => [d.id, d]))
  const drinkAddonIds = ((drinkAddons ?? []) as { id: string }[]).map((a) => a.id)

  const planAddonIds = ((subAddons ?? []) as { addon_id: string }[]).map((a) => a.addon_id)
  const { data: batches } = await supabaseAdmin.from("batches").select("id, name")
  const batchName = new Map(((batches ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]))

  return {
    subscriptionId,
    userId,
    customerName: (one((sub as any).users) as any)?.name ?? "Customer",
    date,
    slot,
    locked: isSlotLocked(date, slot),
    orders: ((orders ?? []) as any[]).map((o) => ({
      id: o.id,
      status: o.status,
      skipReason: o.skip_reason ?? null,
      quantity: o.quantity ?? 1,
      unitPrice: o.unit_price ?? null,
      cartTotal: o.cart_total ?? null,
      extraDish: !!o.extra_dish,
      isCustomized: !!o.is_customized,
      mealTemplateId: o.meal_template_id,
      mealName: (one(o.meal_templates) as any)?.name ?? "—",
      addressId: o.address_id ?? null,
      batchName: (one(o.batches) as any)?.name ?? null,
      fulfilment: (o.fulfilment ?? "delivery") as string,
      drink: (() => {
        type Ref = { is_drink: boolean | null }
        const line = ((o.order_addons ?? []) as { id: string; kind: string; sub_option: string | null; addons: Ref | Ref[] | null }[])
          .find((l) => l.kind === "addon" && one(l.addons)?.is_drink)
        if (!line) return null
        const templateId = (o.drink_template_id ?? null) as string | null
        return {
          lineId: line.id as string,
          templateId,
          // The dish's own name first; the line's sub_option (the same name) is what name-only readers print.
          name: (templateId ? drinkById.get(templateId)?.name : undefined) ?? line.sub_option ?? DRINK_NOT_PICKED,
          edited: !!o.drink_edited,
        }
      })(),
      addons: ((o.order_addons ?? []) as any[])
        .filter((l) => l.kind === "addon" && l.addon_id)
        .map((l) => {
          const included = l.unit_price == null && !o.extra_dish && planAddonIds.includes(l.addon_id)
          return {
            lineId: l.id,
            addonId: l.addon_id,
            name: (one(l.addons) as any)?.name ?? l.addon_id,
            quantity: (l.quantity ?? 1) * (included ? (o.quantity ?? 1) : 1),
            unitPrice: l.unit_price ?? null,
            included,
          }
        }),
    })),
    addresses: ((addrs ?? []) as any[]).map((a) => ({
      id: a.id,
      label: a.label || a.type || "Address",
      line1: addressText(a),
      isDefault: !!a.is_default,
      batchLunch: a.batch_id_lunch ? batchName.get(a.batch_id_lunch) ?? null : null,
      batchDinner: a.batch_id_dinner ? batchName.get(a.batch_id_dinner) ?? null : null,
    })),
    walletBalance: wallet?.balance ?? 0,
    onCredit: !!(sub as any).cod_on_credit,
    baseRate: mealRate(sub as any, plan),
    planAddonIds,
    drinkAddonIds,
    drinks: [...drinkById.values()]
      .filter((d) => d.is_active)
      .map((d) => ({ id: d.id, name: d.name, category: d.category, deliverable: d.subscription_valid })),
    rules: ((rules ?? []) as any[]).map((r) => ({
      id: r.id,
      dayOfWeek: r.day_of_week,
      mealTemplateId: r.meal_template_id,
      mealName: (one(r.meal_templates) as any)?.name ?? r.meal_template_id,
    })),
  }
}

// ── Dish, portions, address ───────────────────────────────────────────────

export async function adminSetOrderDish(orderId: string, mealTemplateId: string): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminSetOrderDish", { ref: orderId, details: { mealTemplateId } }, async () => {
    await requireAdmin()
    const order = await editableOrder(orderId)
    if (typeof order === "string") return { ok: false, error: order }
    if (await isDrinkDish(mealTemplateId)) return { ok: false, error: DRINK_AS_MEAL_ERROR }
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ meal_template_id: mealTemplateId, is_customized: true, cart_edited: true, updated_at: new Date().toISOString() })
      .eq("id", orderId)
    if (error) return { ok: false, error: error.message }
    await supabaseAdmin.from("order_addons").delete().eq("order_id", orderId).eq("kind", "fee")
    await supabaseAdmin.rpc("snapshot_order_ingredients", { p_order: orderId })
    await recompute(orderId)
    refresh(order.subscription_id)
    return { ok: true }
  })
}

export async function adminSetOrderQuantity(orderId: string, quantity: number): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminSetOrderQuantity", { ref: orderId, details: { quantity } }, async () => {
    await requireAdmin()
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return { ok: false, error: "Portions must be between 1 and 20 (skip the meal for none)." }
    }
    const order = await editableOrder(orderId)
    if (typeof order === "string") return { ok: false, error: order }
    const fewer = (order.quantity ?? 1) - quantity
    if (fewer > 0) {
      const problem = await minimumProblem(order, (order as any).item_kind === "drink" ? { drinks: fewer } : { meals: fewer })
      if (problem) return { ok: false, error: problem }
    }
    const { error } = await supabaseAdmin
      .from("orders").update({ quantity, cart_edited: true, updated_at: new Date().toISOString() }).eq("id", orderId)
    if (error) return { ok: false, error: error.message }
    await recompute(orderId)
    refresh(order.subscription_id)
    return { ok: true }
  })
}

export async function adminSetOrderAddress(orderId: string, addressId: string): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminSetOrderAddress", { ref: orderId, details: { addressId } }, async () => {
    await requireAdmin()
    const order = await editableOrder(orderId)
    if (typeof order === "string") return { ok: false, error: order }
    const { data: addr } = await supabaseAdmin
      .from("addresses").select("id").eq("id", addressId).eq("user_id", order.user_id).is("archived_at", null).maybeSingle()
    if (!addr) return { ok: false, error: "That address isn't on this customer's account." }
    // The order's batch follows the address (orders_batch_from_address).
    const { error } = await supabaseAdmin
      .from("orders").update({ address_id: addressId, updated_at: new Date().toISOString() }).eq("id", orderId)
    if (error) return { ok: false, error: error.message }
    refresh(order.subscription_id)
    return { ok: true }
  })
}

// ── Drink (088) ───────────────────────────────────────────────────────────

// Names the drink on one meal: orders.drink_template_id plus the drink add-on
// line's sub_option, which is what name-only readers print (Operations, the
// partner app, the Counter). A meal with no drink line gets one, priced like
// any add-on put on a single meal (the same as the Drink "+" in the editor),
// so adding a drink is one step. There is no "chef's choice": a drink is always
// a named dish. drink_edited keeps the weekly menu's drink from overwriting it;
// cart_edited keeps the customer's plan-default changes off this day (080).
async function attachDrink(orderId: string, drinkTemplateId: string): Promise<{ ok: true; name: string; added: boolean } | { ok: false; error: string }> {
  const [{ data: row }, { data: drinkAddons }, { data: dish }] = await Promise.all([
    supabaseAdmin.from("orders").select("fulfilment").eq("id", orderId).maybeSingle(),
    supabaseAdmin.from("addons").select("id, price_per_meal, is_active").eq("is_drink", true).order("id"),
    supabaseAdmin
      .from("meal_templates")
      .select("id, name, category, is_active, subscription_valid")
      .eq("id", drinkTemplateId)
      .maybeSingle(),
  ])
  if (!dish || !dish.is_active || !DRINK_CATEGORIES.includes(dish.category)) {
    return { ok: false, error: "That isn't an active smoothie or coffee." }
  }
  // Delivery only carries deliverable drinks; a pickup / dine-in booking can take a coffee.
  if ((row?.fulfilment ?? "delivery") === "delivery" && !dish.subscription_valid) {
    return { ok: false, error: `${dish.name} is dine-in only, so it can't go out on a delivery. Pick another drink.` }
  }

  type DrinkAddon = { id: string; price_per_meal: number; is_active: boolean }
  const addonRows = (drinkAddons ?? []) as DrinkAddon[]
  const { data: lines } = addonRows.length
    ? await supabaseAdmin
        .from("order_addons").select("id")
        .eq("order_id", orderId).eq("kind", "addon").in("addon_id", addonRows.map((a) => a.id))
    : { data: [] as { id: string }[] }

  let added = false
  if (lines?.length) {
    const { error } = await supabaseAdmin
      .from("order_addons")
      .update({ sub_option: dish.name })
      .in("id", (lines as { id: string }[]).map((l) => l.id))
    if (error) return { ok: false, error: error.message }
  } else {
    const addon = addonRows.find((a) => a.is_active) ?? addonRows[0]
    if (!addon) return { ok: false, error: "There's no drink add-on set up. Add one under Menu first." }
    const { error } = await supabaseAdmin.from("order_addons").insert({
      order_id: orderId, addon_id: addon.id, kind: "addon", quantity: 1, unit_price: addon.price_per_meal, sub_option: dish.name,
    })
    if (error) return { ok: false, error: error.message }
    added = true
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({ drink_template_id: dish.id, drink_edited: true, cart_edited: true, updated_at: new Date().toISOString() })
    .eq("id", orderId)
  if (error) return { ok: false, error: error.message }
  if (added) await recompute(orderId)
  return { ok: true, name: dish.name, added }
}

// Picks (or swaps) the drink on one meal; adds the drink if the meal has none.
// Like the other edits here, past the slot's cutoff it still goes through but
// says so, since the kitchen sheet may be printed.
export async function adminSetOrderDrink(orderId: string, drinkTemplateId: string): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminSetOrderDrink", { ref: orderId, details: { drinkTemplateId } }, async () => {
    await requireAdmin()
    if (!drinkTemplateId) return { ok: false, error: "Pick a drink." }
    const order = await editableOrder(orderId)
    if (typeof order === "string") return { ok: false, error: order }

    const res = await attachDrink(orderId, drinkTemplateId)
    if (!res.ok) return res

    refresh(order.subscription_id)
    const what = res.added ? `${res.name} added` : `Drink is now ${res.name}`
    if (isSlotLocked(order.delivery_date, order.meal_slot)) {
      return { ok: true, message: `${what}. Past the ${order.meal_slot === "lunch" ? "9 AM" : "2 PM"} cutoff, so tell the kitchen.` }
    }
    return { ok: true, message: `${what}.` }
  })
}

// ── Add-ons ───────────────────────────────────────────────────────────────

// quantity = how many go out with this meal. A plan add-on is normally
// included in the meal's price (one per portion); changing or removing it for
// one meal turns it into its own priced line and takes it out of the meal
// price, so the bill matches exactly what's sent.
export async function adminSetAddonQty(orderId: string, addonId: string, quantity: number): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminSetAddonQty", { ref: orderId, details: { quantity, addonId } }, async () => {
    await requireAdmin()
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 20) return { ok: false, error: "Pick 0–20." }
    const order = await editableOrder(orderId)
    if (typeof order === "string") return { ok: false, error: order }

    const [{ data: addon }, { data: line }] = await Promise.all([
      supabaseAdmin.from("addons").select("id, price_per_meal, is_drink").eq("id", addonId).maybeSingle(),
      supabaseAdmin
        .from("order_addons").select("id, quantity, unit_price")
        .eq("order_id", orderId).eq("addon_id", addonId).eq("kind", "addon").maybeSingle(),
    ])
    const lower = (line?.quantity ?? 0) - quantity
    if (lower > 0) {
      const problem = await minimumProblem(order, { addonId, addonBy: lower })
      if (problem) return { ok: false, error: problem }
    }
    if (!addon) return { ok: false, error: "Add-on not found." }

    if (line && line.unit_price == null && !order.extra_dish) {
      // Included plan add-on → take its share out of the meal price.
      const baseRate = await baseRateFor(order.subscription_id)
      const includedPart = Math.max((order.unit_price ?? 0) - baseRate, 0)
      const share = Math.min(addon.price_per_meal, includedPart)
      await supabaseAdmin
        .from("orders").update({ unit_price: (order.unit_price ?? 0) - share }).eq("id", orderId)
      if (quantity === 0) {
        await supabaseAdmin.from("order_addons").delete().eq("id", line.id)
      } else {
        await supabaseAdmin.from("order_addons")
          .update({ quantity, unit_price: share > 0 ? share : addon.price_per_meal }).eq("id", line.id)
      }
    } else if (quantity === 0) {
      if (line) await supabaseAdmin.from("order_addons").delete().eq("id", line.id)
    } else if (line) {
      await supabaseAdmin.from("order_addons")
        .update({ quantity, unit_price: line.unit_price ?? addon.price_per_meal }).eq("id", line.id)
    } else {
      // A drink put back on a meal keeps that meal's drink: name it on the line,
      // since the line's sub_option is what name-only readers print.
      let subOption: string | null = null
      if (addon.is_drink) {
        const { data: o } = await supabaseAdmin.from("orders").select("drink_template_id").eq("id", orderId).maybeSingle()
        if (o?.drink_template_id) {
          const { data: dish } = await supabaseAdmin.from("meal_templates").select("name").eq("id", o.drink_template_id).maybeSingle()
          subOption = dish?.name ?? null
        }
      }
      const { error } = await supabaseAdmin.from("order_addons").insert({
        order_id: orderId, addon_id: addonId, kind: "addon", quantity, unit_price: addon.price_per_meal, sub_option: subOption,
      })
      if (error) return { ok: false, error: error.message }
    }

    // Changed by hand: the customer's plan-default changes leave this day alone (080).
    await supabaseAdmin.from("orders").update({ cart_edited: true }).eq("id", orderId)
    await recompute(orderId)
    refresh(order.subscription_id)
    return { ok: true }
  })
}

// ── Delivery: settle a slot on any day up to today (068) ─────────────────
// Ops sometimes forget to mark a day delivered — these work for earlier days
// too. Delivered = billed like Operations (an earlier day gets no delivery
// time and no "delivered" message); skip = not charged, meal stays on the
// plan; undo = a wrong "delivered" refunded and put back on the plan.

const UNDELIVERED = ["scheduled", "confirmed", "preparing", "out_for_delivery"]

async function undeliveredIds(subscriptionId: string, date: string, slot: Slot): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .eq("delivery_date", date)
    .eq("meal_slot", slot)
    .in("status", UNDELIVERED)
  return ((data ?? []) as { id: string }[]).map((o) => o.id)
}

function rupeesText(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}

export async function adminDeliverSlot(subscriptionId: string, date: string, slot: Slot): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminDeliverSlot", { subscriptionId, details: { date, slot } }, async () => {
    await requireAdminStrict()
    if (date > istToday()) return { ok: false, error: "That day hasn't come yet." }
    const ids = await undeliveredIds(subscriptionId, date, slot)
    if (ids.length === 0) return { ok: false, error: "Nothing left to deliver here." }
    const results = Object.values(await deliverOrders(ids, slot))
    const billed = results.filter((r) => r === "billed").length
    const short = results.filter((r) => r === "skipped_insufficient").length
    refresh(subscriptionId)
    revalidatePath("/operations")
    if (short > 0) {
      return { ok: true, message: `${billed} delivered and charged; ${short} skipped — the wallet was short (the customer was told).` }
    }
    return {
      ok: true,
      message: date < istToday()
        ? "Marked delivered and charged to the wallet (an earlier day — no message is sent)."
        : "Marked delivered and charged to the wallet.",
    }
  })
}

export async function adminSkipUndelivered(subscriptionId: string, date: string, slot: Slot): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminSkipUndelivered", { subscriptionId, details: { date, slot } }, async () => {
    await requireAdminStrict()
    const n = await skipUndelivered(await undeliveredIds(subscriptionId, date, slot))
    if (n === 0) return { ok: false, error: "Nothing to skip here." }
    refresh(subscriptionId)
    revalidatePath("/operations")
    return { ok: true, message: "Skipped — not charged, and the meal stays on the plan." }
  })
}


// ── Skip / bring back ─────────────────────────────────────────────────────

export async function adminSkipSlot(subscriptionId: string, date: string, slot: Slot): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminSkipSlot", { subscriptionId, details: { date, slot } }, async () => {
    await requireAdmin()
    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status: "skipped", skip_reason: "admin", updated_at: new Date().toISOString() })
      .eq("subscription_id", subscriptionId)
      .eq("delivery_date", date)
      .eq("meal_slot", slot)
      .in("status", EDITABLE)
      .select("id")
    if (error) return { ok: false, error: error.message }
    if (!data?.length) return { ok: false, error: "Nothing to skip here." }
    refresh(subscriptionId)
    return { ok: true, message: "Skipped — nothing is charged and the meal stays on the plan." }
  })
}

// Brings back skipped meals in a slot (any reason — e.g. a low-wallet skip
// after the customer paid). If the plan's meals are all scheduled already,
// the latest untouched meal at the end of the window gives its place back.
export async function adminUnskipSlot(subscriptionId: string, date: string, slot: Slot): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminUnskipSlot", { subscriptionId, details: { date, slot } }, async () => {
    await requireAdmin()
    const { data: allSkipped } = await supabaseAdmin
      .from("orders")
      .select("id, quantity, updated_at")
      .eq("subscription_id", subscriptionId)
      .eq("delivery_date", date)
      .eq("meal_slot", slot)
      .eq("walk_in", false)
      .eq("status", "skipped")
    if (!allSkipped?.length) return { ok: false, error: "Nothing skipped here." }
    // Never two meals in one slot (107): if this lunch / dinner already has a
    // meal, there's nothing to bring back.
    const { data: live } = await supabaseAdmin
      .from("orders").select("id")
      .eq("subscription_id", subscriptionId).eq("delivery_date", date).eq("meal_slot", slot)
      .eq("walk_in", false)
      .in("status", ["scheduled", "confirmed", "preparing", "out_for_delivery", "delivered"])
      .limit(1)
    if (live?.length) return { ok: false, error: "This meal already has an order — edit that instead." }
    // Only the most recent skip comes back, not every meal ever skipped here.
    const latest = Math.max(...(allSkipped as any[]).map((o) => new Date(o.updated_at).getTime()))
    const skipped = (allSkipped as any[]).filter((o) => latest - new Date(o.updated_at).getTime() < 2 * 60 * 1000)
    const need = skipped.reduce((n, o: any) => n + (o.quantity ?? 1), 0)

    const { data: sub } = await supabaseAdmin
      .from("subscriptions").select("deliveries_remaining").eq("id", subscriptionId).single()
    const { data: upcoming } = await supabaseAdmin
      .from("orders")
      .select("id, delivery_date, meal_slot, quantity, extra_dish, is_customized, status")
      .eq("subscription_id", subscriptionId)
      .gte("delivery_date", istToday())
      .in("status", ["scheduled", "confirmed", "preparing", "out_for_delivery"])
      .order("delivery_date", { ascending: false })
      .order("meal_slot", { ascending: false })
    let room = (sub?.deliveries_remaining ?? 0) - (upcoming ?? []).reduce((n, o: any) => n + (o.quantity ?? 1), 0)
    if (room < need) {
      const drop: string[] = []
      for (const o of (upcoming ?? []) as any[]) {
        if (room >= need) break
        if (o.status !== "scheduled" || o.extra_dish || o.is_customized || o.delivery_date <= date) continue
        drop.push(o.id)
        room += o.quantity ?? 1
      }
      if (room < need) return { ok: false, error: "The plan has no meals left for this. Extend it or set meals left first." }
      if (drop.length) await supabaseAdmin.from("orders").delete().in("id", drop)
    }

    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status: "scheduled", skip_reason: null, updated_at: new Date().toISOString() })
      .in("id", skipped.map((o: any) => o.id))
    if (error) return { ok: false, error: error.message }
    for (const o of skipped as any[]) await recompute(o.id)
    refresh(subscriptionId)
    return { ok: true, message: "Meal is back on." }
  })
}

// ── Extra dishes ──────────────────────────────────────────────────────────

export async function adminAddExtraDish(
  subscriptionId: string, date: string, slot: Slot, mealTemplateId: string, addressId: string | null,
  drinkTemplateId: string | null = null
): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminAddExtraDish", { subscriptionId, details: { date, slot, mealTemplateId, addressId, drinkTemplateId } }, async () => {
    await requireAdmin()
    if (date < istToday()) return { ok: false, error: "That day has passed." }
    if (await isDrinkDish(mealTemplateId)) return { ok: false, error: DRINK_AS_MEAL_ERROR }
    const { data: sub } = await supabaseAdmin
      .from("subscriptions").select("id, user_id, status, batch_id_lunch, batch_id_dinner").eq("id", subscriptionId).single()
    if (!sub || !["active", "paused"].includes(sub.status)) return { ok: false, error: "The plan isn't active." }

    let address = addressId
    if (address) {
      const { data: own } = await supabaseAdmin
        .from("addresses").select("id").eq("id", address).eq("user_id", sub.user_id).is("archived_at", null).maybeSingle()
      if (!own) return { ok: false, error: "That address isn't on this customer's account." }
    } else {
      const { data: def } = await supabaseAdmin
        .from("addresses").select("id").eq("user_id", sub.user_id).is("archived_at", null)
        .order("is_default", { ascending: false }).limit(1).maybeSingle()
      address = def?.id ?? null
    }

    const { data: last } = await supabaseAdmin
      .from("orders").select("slot_seq")
      .eq("subscription_id", subscriptionId).eq("delivery_date", date).eq("meal_slot", slot)
      .order("slot_seq", { ascending: false }).limit(1).maybeSingle()

    const { data: created, error } = await supabaseAdmin
      .from("orders")
      .insert({
        user_id: sub.user_id,
        subscription_id: subscriptionId,
        meal_template_id: mealTemplateId,
        batch_id: (slot === "lunch" ? sub.batch_id_lunch : sub.batch_id_dinner) ?? null,
        address_id: address,
        delivery_date: date,
        meal_slot: slot,
        status: "scheduled",
        is_customized: true,
        extra_dish: true,
        quantity: 1,
        unit_price: await baseRateFor(subscriptionId),
        slot_seq: (last?.slot_seq ?? 0) + 1,
      })
      .select("id")
      .single()
    if (error || !created) return { ok: false, error: error?.message ?? "Could not add the dish." }
    await supabaseAdmin.rpc("snapshot_order_ingredients", { p_order: created.id })
    await recompute(created.id)
    if (drinkTemplateId) {
      const res = await attachDrink(created.id, drinkTemplateId)
      refresh(subscriptionId)
      if (!res.ok) return { ok: true, message: `Dish added, but the drink wasn't: ${res.error}` }
      return { ok: true, message: `Dish added with ${res.name}.` }
    }
    refresh(subscriptionId)
    return { ok: true, message: "Dish added." }
  })
}

export async function adminRemoveExtraDish(orderId: string): Promise<EditResult> {
  return audited<EditResult>("kitchen.adminRemoveExtraDish", { ref: orderId }, async () => {
    await requireAdmin()
    const order = await editableOrder(orderId)
    if (typeof order === "string") return { ok: false, error: order }
    if (!order.extra_dish) return { ok: false, error: "Only an extra dish can be removed — skip the meal instead." }
    const q = order.quantity ?? 1
    const problem = await minimumProblem(order, (order as any).item_kind === "drink" ? { drinks: q } : { meals: q })
    if (problem) return { ok: false, error: problem }
    const { error } = await supabaseAdmin
      .from("orders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", orderId)
    if (error) return { ok: false, error: error.message }
    refresh(order.subscription_id)
    return { ok: true, message: "Dish removed." }
  })
}

// ── Same dish every day ───────────────────────────────────────────────────

// dayOfWeek null = every delivery day. Applies to every upcoming open meal in
// that slot now, and the order job uses it for new ones.
export async function setFixedDish(
  subscriptionId: string, slot: Slot, dayOfWeek: number | null, mealTemplateId: string
): Promise<EditResult> {
  return audited<EditResult>("kitchen.setFixedDish", { subscriptionId, details: { slot, mealTemplateId } }, async () => {
    const admin = await requireAdmin()
    if (await isDrinkDish(mealTemplateId)) return { ok: false, error: DRINK_AS_MEAL_ERROR }
    const { data: sub } = await supabaseAdmin.from("subscriptions").select("user_id").eq("id", subscriptionId).single()
    if (!sub) return { ok: false, error: "Subscription not found." }
    const userId = sub.user_id as string

    let del = supabaseAdmin.from("customer_meal_rules").delete().eq("user_id", userId).eq("meal_slot", slot)
    del = dayOfWeek === null ? del.is("day_of_week", null) : del.eq("day_of_week", dayOfWeek)
    await del
    // The office's dish wins: the customer's own picks for this slot go (080),
    // and the app shows the slot as set by GreenFeast while this rule exists.
    await supabaseAdmin.from("customer_meal_rules").delete().eq("user_id", userId).eq("meal_slot", slot).eq("set_by", "customer")
    const { error } = await supabaseAdmin.from("customer_meal_rules").insert({
      user_id: userId, meal_slot: slot, day_of_week: dayOfWeek, meal_template_id: mealTemplateId, created_by: admin.email, set_by: "admin",
    })
    if (error) return { ok: false, error: error.message }

    const { data: upcoming } = await supabaseAdmin
      .from("orders")
      .select("id, delivery_date, meal_template_id")
      .eq("user_id", userId)
      .eq("meal_slot", slot)
      .eq("extra_dish", false)
      .gte("delivery_date", istToday())
      .in("status", EDITABLE)
    // A weekday rule wins over an every-day one, so an every-day rule leaves
    // weekdays that have their own rule alone.
    const { data: weekdayRules } = await supabaseAdmin
      .from("customer_meal_rules").select("day_of_week").eq("user_id", userId).eq("meal_slot", slot).not("day_of_week", "is", null)
    const ownDays = new Set(((weekdayRules ?? []) as { day_of_week: number }[]).map((r) => r.day_of_week))
    const ids = ((upcoming ?? []) as any[])
      .filter((o) => !isSlotLocked(o.delivery_date, slot))
      .filter((o) => (dayOfWeek === null ? !ownDays.has(dowMon0(o.delivery_date)) : dowMon0(o.delivery_date) === dayOfWeek))
      .map((o) => o.id as string)
    if (ids.length) {
      await supabaseAdmin
        .from("orders")
        .update({ meal_template_id: mealTemplateId, is_customized: true, updated_at: new Date().toISOString() })
        .in("id", ids)
      for (const id of ids) {
        await supabaseAdmin.rpc("snapshot_order_ingredients", { p_order: id })
        await recompute(id)
      }
    }
    refresh(subscriptionId)
    return { ok: true, message: `Fixed dish saved — ${ids.length} upcoming meal${ids.length === 1 ? "" : "s"} updated.` }
  })
}

// Removes a rule. With backToMenu, upcoming open meals it set go back to the
// weekly menu's dish for their day.
export async function clearFixedDish(subscriptionId: string, ruleId: string, backToMenu: boolean): Promise<EditResult> {
  return audited<EditResult>("kitchen.clearFixedDish", { subscriptionId, ref: ruleId, details: { backToMenu } }, async () => {
    await requireAdmin()
    const { data: rule } = await supabaseAdmin
      .from("customer_meal_rules").select("id, user_id, meal_slot, day_of_week, meal_template_id").eq("id", ruleId).maybeSingle()
    if (!rule) return { ok: false, error: "Already removed." }
    await supabaseAdmin.from("customer_meal_rules").delete().eq("id", ruleId)

    let moved = 0
    if (backToMenu) {
      const [{ data: upcoming }, { data: menu }] = await Promise.all([
        supabaseAdmin
          .from("orders")
          .select("id, delivery_date")
          .eq("user_id", rule.user_id)
          .eq("meal_slot", rule.meal_slot)
          .eq("meal_template_id", rule.meal_template_id)
          .eq("extra_dish", false)
          .gte("delivery_date", istToday())
          .in("status", EDITABLE),
        supabaseAdmin.from("weekly_menu").select("day_of_week, meal_template_id").eq("menu_type", "M1").eq("meal_slot", rule.meal_slot),
      ])
      const byDay = new Map(((menu ?? []) as any[]).map((m) => [m.day_of_week as number, m.meal_template_id as string]))
      for (const o of (upcoming ?? []) as any[]) {
        const dow = dowMon0(o.delivery_date)
        if (rule.day_of_week !== null && dow !== rule.day_of_week) continue
        if (isSlotLocked(o.delivery_date, rule.meal_slot)) continue
        const dish = byDay.get(dow)
        if (!dish) continue
        await supabaseAdmin.from("orders")
          .update({ meal_template_id: dish, is_customized: false, updated_at: new Date().toISOString() }).eq("id", o.id)
        await supabaseAdmin.rpc("snapshot_order_ingredients", { p_order: o.id })
        moved++
      }
    }
    refresh(subscriptionId)
    return { ok: true, message: backToMenu ? `Rule removed — ${moved} meal${moved === 1 ? "" : "s"} back on the menu.` : "Rule removed." }
  })
}
