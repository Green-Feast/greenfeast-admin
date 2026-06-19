import { supabaseAdmin } from "@/lib/supabase-admin"
import { PartnersClient } from "./partners-client"

export const dynamic = "force-dynamic"

export default async function DeliveryPartnersPage() {
  const { data: partners, error } = await supabaseAdmin
    .from("delivery_partners")
    .select(
      "id, name, phone, alternate_phone, aadhaar_number, aadhaar_doc_url, pan_number, pan_doc_url, dl_number, dl_doc_url, vehicle_rc_number, vehicle_rc_doc_url, notes, status, created_at"
    )
    .order("created_at", { ascending: false })

  // Surface (don't swallow) load failures — e.g. missing service_role grants
  // would otherwise render a misleading empty "no partners" state.
  if (error) console.error("[delivery-partners] load failed:", error)

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <PartnersClient initialPartners={partners ?? []} loadError={error?.message ?? null} />
    </div>
  )
}
