import { supabaseAdmin } from "@/lib/supabase-admin"
import BatchesClient from "./batches-client"

export const dynamic = "force-dynamic"

export default async function BatchesPage() {
  const [batchRes, partnersRes, subsRes] = await Promise.all([
    supabaseAdmin
      .from("batches")
      .select(`
        id, name, area, time_window, primary_partner_id, secondary_partner_id,
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
      .select("id, user_id, status, plan_name, batch_id, users!inner ( name, phone )")
      .in("status", ["active", "paused", "pending"])
      .order("created_at"),
  ])

  const batches = (batchRes.data ?? []).map((b: any) => ({
    id: b.id as string,
    name: b.name as string,
    area: b.area as string | null,
    time_window: b.time_window as "morning" | "noon" | "evening",
    primary_partner_id: b.primary_partner_id as string | null,
    secondary_partner_id: b.secondary_partner_id as string | null,
    primaryPartnerName: (Array.isArray(b.primary_partner) ? b.primary_partner[0] : b.primary_partner)?.name ?? null,
    secondaryPartnerName: (Array.isArray(b.secondary_partner) ? b.secondary_partner[0] : b.secondary_partner)?.name ?? null,
  }))

  const partners = (partnersRes.data ?? []) as { id: string; name: string }[]

  // Deduplicate by user_id: one card per user, prefer active > paused > pending
  const STATUS_RANK: Record<string, number> = { active: 0, paused: 1, pending: 2 }
  const bestSub = new Map<string, any>()
  for (const s of (subsRes.data ?? [])) {
    const existing = bestSub.get(s.user_id)
    if (!existing || (STATUS_RANK[s.status] ?? 99) < (STATUS_RANK[existing.status] ?? 99)) {
      bestSub.set(s.user_id, s)
    }
  }

  const subscribers = Array.from(bestSub.values()).map((s: any) => {
    const user = Array.isArray(s.users) ? s.users[0] : s.users
    return {
      subscriptionId: s.id as string,
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? "",
      plan: s.plan_name ?? "—",
      batchId: s.batch_id as string | null,
      city: "",
    }
  })

  return (
    <BatchesClient
      initialBatches={batches}
      allPartners={partners}
      initialSubscribers={subscribers}
    />
  )
}
