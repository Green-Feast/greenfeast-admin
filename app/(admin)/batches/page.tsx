import { supabaseAdmin } from "@/lib/supabase"
import BatchesClient from "./batches-client"

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
      .select("id, plan_name, batch_id, users!inner ( name, phone ), addresses ( city )")
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

  const subscribers = (subsRes.data ?? []).map((s: any) => {
    const user = Array.isArray(s.users) ? s.users[0] : s.users
    const addr = Array.isArray(s.addresses) ? s.addresses[0] : s.addresses
    return {
      subscriptionId: s.id as string,
      name: (user as any)?.name ?? "Unknown",
      phone: (user as any)?.phone ?? "",
      plan: s.plan_name ?? "—",
      batchId: s.batch_id as string | null,
      city: (addr as any)?.city ?? "",
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
