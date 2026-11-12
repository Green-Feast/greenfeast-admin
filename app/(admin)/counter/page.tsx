import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { istToday } from "@/lib/ist"
import { CounterClient, type CounterOrder, type Place } from "./counter-client"

export const dynamic = "force-dynamic"

// Counter (082, 087): today's walk-ins at one place — what to cook
// (places that cook their own), codes to hand over, and who didn't come.
export default async function CounterPage({
  searchParams,
}: {
  searchParams: Promise<{ loc?: string; slot?: string }>
}) {
  await requireAdmin()
  const params = await searchParams
  const isTest = await isTestMode()
  const today = istToday()

  const { data: placeRows } = await supabaseAdmin
    .from("pickup_locations")
    .select("id, name, address, maps_url, offers_pickup, offers_dine_in, cooks_own, opens_at, lunch_until, closes_at, is_active, sort_order")
    .order("sort_order")
  const places = ((placeRows ?? []) as Place[])
  const place = places.find((p) => p.id === params.loc) ?? places.find((p) => p.is_active) ?? places[0] ?? null

  // The slot running now at this place (lunch until lunch_until), unless picked.
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 16)
  const slot: "lunch" | "dinner" =
    params.slot === "lunch" || params.slot === "dinner"
      ? params.slot
      : place && nowIst >= place.lunch_until.slice(0, 5) ? "dinner" : "lunch"

  let orders: CounterOrder[] = []
  if (place) {
    const { data } = await supabaseAdmin
      .from("orders")
      .select(`
        id, status, meal_slot, quantity, walk_in, fulfilment, pickup_code, collected_at, pickup_missed, created_at, skip_reason,
        meal_templates ( name ),
        order_addons ( kind, quantity, unit_price, sub_option, addons ( name ) ),
        users!inner ( name, phone, customer_code, is_test )
      `)
      .eq("delivery_date", today)
      .eq("pickup_location_id", place.id)
      .eq("users.is_test", isTest)
      .order("created_at")
    orders = ((data ?? []) as any[]).map((o) => {
      const u = Array.isArray(o.users) ? o.users[0] : o.users
      const meal = Array.isArray(o.meal_templates) ? o.meal_templates[0] : o.meal_templates
      const qty = (o.quantity ?? 1) as number
      const addons = ((o.order_addons ?? []) as any[])
        .filter((a) => a.kind === "addon")
        .map((a) => {
          const name = (Array.isArray(a.addons) ? a.addons[0]?.name : a.addons?.name) as string | undefined
          if (!name) return null
          // A plan add-on comes once per portion.
          return { name: a.sub_option ? `${name} (${a.sub_option})` : name, qty: (a.quantity ?? 1) * (a.unit_price == null ? qty : 1) }
        })
        .filter(Boolean) as { name: string; qty: number }[]
      return {
        id: o.id,
        status: o.status,
        slot: o.meal_slot,
        quantity: qty,
        walkIn: !!o.walk_in,
        mode: o.fulfilment as "pickup" | "dine_in",
        code: o.pickup_code ?? "",
        collectedAt: o.collected_at ?? null,
        missed: !!o.pickup_missed,
        skipReason: o.skip_reason ?? null,
        createdAt: o.created_at,
        meal: meal?.name ?? "—",
        addons,
        name: u?.name ?? "Customer",
        phone: u?.phone ?? "",
        customerCode: u?.customer_code ?? "",
      } satisfies CounterOrder
    })
  }

  return <CounterClient places={places} place={place} slot={slot} orders={orders} today={today} />
}
