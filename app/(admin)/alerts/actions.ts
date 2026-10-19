"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"

// Alerts for the admins (migration 063): this device's push subscription, a
// test alert, and "seen up to now" for the sidebar badge.
// (No type re-exports in this file — see operations/actions.ts.)

export async function savePushSubscription(sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }, userAgent: string) {
  const admin = await requireAdmin()
  const endpoint = sub.endpoint ?? ""
  const p256dh = sub.keys?.p256dh ?? ""
  const auth = sub.keys?.auth ?? ""
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return { ok: false as const, error: "This browser gave an incomplete subscription." }
  const { error } = await supabaseAdmin
    .from("admin_push_subscriptions")
    .upsert({ admin_id: admin.id, endpoint, p256dh, auth, user_agent: userAgent.slice(0, 300) }, { onConflict: "endpoint" })
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const }
}

export async function removePushSubscription(endpoint: string) {
  const admin = await requireAdmin()
  await supabaseAdmin.from("admin_push_subscriptions").delete().eq("endpoint", endpoint).eq("admin_id", admin.id)
  return { ok: true as const }
}

export async function sendTestAlert() {
  await requireAdmin()
  const { error } = await supabaseAdmin.rpc("notify_admins", {
    p_kind: "test",
    p_title: "Test alert",
    p_body: "Alerts work on this device. You'll get reminders to mark meals out for delivery and delivered, and updates like cash collected.",
    p_url: "/alerts",
  })
  if (error) return { ok: false as const, error: error.message }
  revalidatePath("/alerts")
  return { ok: true as const }
}

export async function markAlertsRead() {
  const admin = await requireAdmin()
  await supabaseAdmin.from("admin_users").update({ alerts_read_at: new Date().toISOString() }).eq("user_id", admin.id)
  revalidatePath("/", "layout")
}
