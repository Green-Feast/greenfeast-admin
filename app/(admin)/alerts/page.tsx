import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { AlertsClient } from "./alerts-client"

export const dynamic = "force-dynamic"

export default async function AlertsPage() {
  const admin = await requireAdmin()
  const [{ data: alerts }, { data: me }, { count: devices }] = await Promise.all([
    supabaseAdmin.from("admin_alerts").select("id, kind, title, body, url, created_at").order("created_at", { ascending: false }).limit(100),
    supabaseAdmin.from("admin_users").select("alerts_read_at").eq("user_id", admin.id).maybeSingle(),
    supabaseAdmin.from("admin_push_subscriptions").select("*", { count: "exact", head: true }).eq("admin_id", admin.id),
  ])
  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <AlertsClient
        alerts={(alerts ?? []) as { id: string; kind: string; title: string; body: string; url: string; created_at: string }[]}
        readAt={me?.alerts_read_at ?? null}
        deviceCount={devices ?? 0}
      />
    </div>
  )
}
