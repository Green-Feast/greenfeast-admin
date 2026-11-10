"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"

export type CounterResult = { ok: true; message: string } | { ok: false; error: string }

// Hand a pickup / dine-in over: billed from the wallet like a delivery
// (redeem_pickup → advance_order_delivered). A code works once.
export async function handOver(orderId: string, placeId: string): Promise<CounterResult> {
  await requireAdmin()
  const { data, error } = await supabaseAdmin.rpc("redeem_pickup", { p_order: orderId, p_location: placeId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/counter")
  const result = (data as { result?: string } | null)?.result
  if (result === "billed") return { ok: true, message: "Handed over — paid from their wallet." }
  if (result === "skipped_insufficient") {
    return { ok: false, error: "Their wallet doesn't cover this meal, so it's been cancelled — don't hand it over. They need to renew in the app." }
  }
  return { ok: false, error: "This meal was already settled." }
}

export type PlaceInput = {
  name: string
  address: string
  mapsUrl: string
  offersPickup: boolean
  offersDineIn: boolean
  cooksOwn: boolean
  opensAt: string
  lunchUntil: string
  closesAt: string
  isActive: boolean
}

export async function savePlace(id: string, v: PlaceInput): Promise<CounterResult> {
  await requireAdminStrict()
  const time = /^\d{2}:\d{2}$/
  if (!v.name.trim() || !v.address.trim()) return { ok: false, error: "Name and address are needed." }
  if (![v.opensAt, v.lunchUntil, v.closesAt].every((t) => time.test(t))) return { ok: false, error: "Times look like 11:00." }
  if (!(v.opensAt < v.lunchUntil && v.lunchUntil < v.closesAt)) {
    return { ok: false, error: "Opening must be before the lunch/dinner switch, and that before closing." }
  }
  if (!v.offersPickup && !v.offersDineIn) return { ok: false, error: "Offer takeaway, dine-in or both." }
  const { error } = await supabaseAdmin
    .from("pickup_locations")
    .update({
      name: v.name.trim(),
      address: v.address.trim(),
      maps_url: v.mapsUrl.trim() || null,
      offers_pickup: v.offersPickup,
      offers_dine_in: v.offersDineIn,
      cooks_own: v.cooksOwn,
      opens_at: v.opensAt,
      lunch_until: v.lunchUntil,
      closes_at: v.closesAt,
      is_active: v.isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/counter")
  return { ok: true, message: "Saved." }
}
