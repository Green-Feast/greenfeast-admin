import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { istToday } from "@/lib/ist"
import BatchesClient from "./batches-client"

export const dynamic = "force-dynamic"

const NEW_DAYS = 7

export default async function BatchesPage() {
  await requireAdmin()
  const isTest = await isTestMode()
  const today = istToday()

  const [batchRes, partnersRes, subsRes] = await Promise.all([
    supabaseAdmin
      .from("batches")
      .select(`
        id, name, area, time_window, meal_slot, primary_partner_id, secondary_partner_id,
        primary_partner:delivery_partners!batches_primary_partner_id_fkey ( id, name ),
        secondary_partner:delivery_partners!batches_secondary_partner_id_fkey ( id, name )
      `)
      .order("name"),
    supabaseAdmin
      .from("delivery_partners")
      .select("id, name")
      .eq("status", "active")
      .order("name"),
    supabaseAdmin
      .from("subscriptions")
      .select("id, user_id, status, plan_name, meals_lunch, meals_dinner, users!inner ( name, phone, is_test )")
      .in("status", ["active", "paused", "pending"])
      .eq("users.is_test", isTest)
      .order("created_at"),
  ])

  const batches = (batchRes.data ?? []).map((b: any) => ({
    id: b.id as string,
    name: b.name as string,
    area: b.area as string | null,
    time_window: b.time_window as "morning" | "noon" | "evening",
    meal_slot: b.meal_slot as "lunch" | "dinner",
    primary_partner_id: b.primary_partner_id as string | null,
    secondary_partner_id: b.secondary_partner_id as string | null,
    primaryPartnerName: (Array.isArray(b.primary_partner) ? b.primary_partner[0] : b.primary_partner)?.name ?? null,
    secondaryPartnerName: (Array.isArray(b.secondary_partner) ? b.secondary_partner[0] : b.secondary_partner)?.name ?? null,
  }))

  const partners = (partnersRes.data ?? []) as { id: string; name: string }[]

  // One plan per customer: prefer active > paused > pending.
  const STATUS_RANK: Record<string, number> = { active: 0, paused: 1, pending: 2 }
  const bestSub = new Map<string, any>()
  for (const s of (subsRes.data ?? [])) {
    const existing = bestSub.get(s.user_id)
    if (!existing || (STATUS_RANK[s.status] ?? 99) < (STATUS_RANK[existing.status] ?? 99)) {
      bestSub.set(s.user_id, s)
    }
  }
  const userIds = Array.from(bestSub.keys())

  // Batches belong to addresses (migration 052): every saved address of these
  // customers is a card, and the meals going to it ride its batch.
  const [{ data: addrRows }, { data: upcoming }] = userIds.length
    ? await Promise.all([
        supabaseAdmin
          .from("addresses")
          .select("id, user_id, label, type, line1, landmark, pincode, is_default, batch_id_lunch, batch_id_dinner, created_at")
          .in("user_id", userIds)
          .is("archived_at", null)
          .order("created_at"),
        supabaseAdmin
          .from("orders")
          .select("address_id, meal_slot")
          .in("user_id", userIds)
          .gte("delivery_date", today)
          .in("status", ["scheduled", "confirmed", "preparing", "out_for_delivery"]),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }]

  const usedFor = new Map<string, Set<string>>()
  for (const o of (upcoming ?? []) as { address_id: string | null; meal_slot: string }[]) {
    if (!o.address_id) continue
    if (!usedFor.has(o.address_id)) usedFor.set(o.address_id, new Set())
    usedFor.get(o.address_id)!.add(o.meal_slot)
  }

  const newSince = new Date(Date.now() - NEW_DAYS * 24 * 3600 * 1000).toISOString()
  const addresses = ((addrRows ?? []) as any[]).map((a) => {
    const s = bestSub.get(a.user_id)
    const user = Array.isArray(s?.users) ? s.users[0] : s?.users
    const used = usedFor.get(a.id) ?? new Set<string>()
    return {
      addressId: a.id as string,
      subscriptionId: s?.id as string,
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? "",
      plan: s?.plan_name ?? "—",
      label: (a.label || a.type || "Address") as string,
      line1: [a.line1, a.landmark].filter(Boolean).join(", "),
      isDefault: !!a.is_default,
      isNew: a.created_at >= newSince,
      batchIdLunch: a.batch_id_lunch as string | null,
      batchIdDinner: a.batch_id_dinner as string | null,
      mealsLunch: (s?.meals_lunch ?? 0) as number,
      mealsDinner: (s?.meals_dinner ?? 0) as number,
      // Meals actually going here soon (or the default, where new ones go).
      usedLunch: used.has("lunch") || (!!a.is_default && (s?.meals_lunch ?? 0) > 0),
      usedDinner: used.has("dinner") || (!!a.is_default && (s?.meals_dinner ?? 0) > 0),
    }
  })

  return (
    <BatchesClient
      initialBatches={batches}
      allPartners={partners}
      initialAddresses={addresses}
    />
  )
}
