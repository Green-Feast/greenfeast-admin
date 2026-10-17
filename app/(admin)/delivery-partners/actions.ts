"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"
import { tempPassword } from "@/lib/temp-password"

// ─────────────────────────────────────────────────────────────────────────────
// Partner app logins (migration 057). The login ID is the partner's phone;
// the Supabase account behind it has an internal email they never see, and
// user_metadata.gf_account = 'partner' so it isn't made a customer (058).
// Resetting the password replaces the account, which also signs out every
// phone the old password was used on.
// ─────────────────────────────────────────────────────────────────────────────

export type LoginResult =
  | { ok: true; loginId: string; password: string; appUrl: string; name: string }
  | { ok: false; error: string }

async function appUrl() {
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "greenfeast-admin.vercel.app"
  const proto = h.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}/partner`
}

async function newLogin(partnerId: string): Promise<LoginResult> {
  const { data: p } = await supabaseAdmin
    .from("delivery_partners")
    .select("id, name, phone, user_id")
    .eq("id", partnerId)
    .maybeSingle()
  if (!p) return { ok: false, error: "Partner not found." }
  const digits = (p.phone ?? "").replace(/\D/g, "").slice(-10)
  if (digits.length !== 10) return { ok: false, error: "Save a 10-digit phone number first — it's their login ID." }

  // Same phone on another partner's login would make the ID ambiguous.
  const { data: others } = await supabaseAdmin
    .from("delivery_partners")
    .select("id, name, phone")
    .not("user_id", "is", null)
    .neq("id", p.id)
  const clash = (others ?? []).find((o: { phone: string | null }) => (o.phone ?? "").replace(/\D/g, "").slice(-10) === digits)
  if (clash) return { ok: false, error: `${clash.name} already logs in with this phone number.` }

  if (p.user_id) await supabaseAdmin.auth.admin.deleteUser(p.user_id)

  const password = tempPassword()
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: `partner-${p.id}-${Date.now()}@partners.greenfeast.test`,
    password,
    email_confirm: true,
    app_metadata: { role: "partner" },
    user_metadata: { gf_account: "partner", partner_id: p.id },
  })
  if (error || !created.user) return { ok: false, error: `Couldn't create the login: ${error?.message ?? "unknown error"}` }

  // Safety net: a staff account must never show up as a customer.
  await supabaseAdmin.from("users").delete().eq("id", created.user.id)

  const { error: linkErr } = await supabaseAdmin
    .from("delivery_partners")
    .update({ user_id: created.user.id })
    .eq("id", p.id)
  if (linkErr) {
    await supabaseAdmin.auth.admin.deleteUser(created.user.id)
    return { ok: false, error: `Couldn't link the login: ${linkErr.message}` }
  }

  revalidatePath("/delivery-partners")
  return { ok: true, loginId: digits, password, appUrl: await appUrl(), name: p.name }
}

export async function createPartnerLogin(partnerId: string): Promise<LoginResult> {
  await requireAdminStrict()
  return newLogin(partnerId)
}

export async function resetPartnerPassword(partnerId: string): Promise<LoginResult> {
  await requireAdminStrict()
  return newLogin(partnerId)
}

export async function removePartnerLogin(partnerId: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdminStrict()
  const { data: p } = await supabaseAdmin.from("delivery_partners").select("user_id").eq("id", partnerId).maybeSingle()
  if (!p?.user_id) return { ok: true }
  await supabaseAdmin.from("delivery_partners").update({ user_id: null }).eq("id", partnerId)
  const { error } = await supabaseAdmin.auth.admin.deleteUser(p.user_id)
  revalidatePath("/delivery-partners")
  return error ? { ok: false, error: error.message } : { ok: true }
}

// A test partner sees only test customers' meals (Test mode in the admin).
export async function setPartnerTest(partnerId: string, isTest: boolean) {
  await requireAdmin()
  const { error } = await supabaseAdmin.from("delivery_partners").update({ is_test: isTest }).eq("id", partnerId)
  if (error) throw error
  revalidatePath("/delivery-partners")
}

export async function upsertPartner(data: {
  id?: string
  name: string
  phone: string
  alternate_phone?: string
  aadhaar_number?: string
  pan_number?: string
  dl_number?: string
  vehicle_rc_number?: string
  notes?: string
  status: "active" | "inactive"
}) {
  await requireAdmin()
  const { id, ...rest } = data
  if (id) {
    const { error } = await supabaseAdmin.from("delivery_partners").update(rest).eq("id", id)
    if (error) throw error
  } else {
    const { error } = await supabaseAdmin.from("delivery_partners").insert(rest)
    if (error) throw error
  }
  revalidatePath("/delivery-partners")
}

export async function createSignedUploadUrl(partnerId: string, docType: string, fileName: string) {
  await requireAdmin()
  const ext = fileName.split(".").pop() ?? "pdf"
  const path = `${partnerId}/${docType}.${ext}`
  const { data, error } = await supabaseAdmin.storage
    .from("partner-docs")
    .createSignedUploadUrl(path, { upsert: true })
  if (error) throw error
  return { token: data.token, path }
}

export async function saveDocUrl(partnerId: string, docType: string, path: string) {
  await requireAdmin()
  const field = `${docType}_doc_url`
  const { error } = await supabaseAdmin.from("delivery_partners")
    .update({ [field]: path })
    .eq("id", partnerId)
  if (error) throw error
  revalidatePath("/delivery-partners")
}

export async function getSignedViewUrl(path: string) {
  await requireAdmin()
  const { data } = await supabaseAdmin.storage
    .from("partner-docs")
    .createSignedUrl(path, 60)
  return data?.signedUrl ?? null
}
