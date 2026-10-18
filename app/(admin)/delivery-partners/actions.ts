"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin, requireAdminStrict } from "@/lib/auth"
import { tempPassword } from "@/lib/temp-password"

// ─────────────────────────────────────────────────────────────────────────────
// Logins for the GreenFeast Partner app (greenfeast-delivery-partner repo —
// Android/iOS and web). The login ID is the partner's phone: the app signs
// in to the Supabase account p<10 digits>@partners.greenfeast.test, which
// has user_metadata.gf_account = 'partner' so it isn't made a customer
// (migration 058). Everything the app does goes through the database's
// partner_* functions (060). Resetting the password replaces the account,
// which also signs out every phone the old password was used on.
// ─────────────────────────────────────────────────────────────────────────────

export type LoginResult =
  | { ok: true; loginId: string; password: string; appUrl: string; name: string }
  | { ok: false; error: string }

// Where partners open the app (its web version) — set PARTNER_APP_URL in
// Vercel if the partner app's project lives at another address.
function appUrl() {
  return process.env.PARTNER_APP_URL ?? "https://greenfeast-delivery-partner.vercel.app"
}

function partnerEmail(digits: string) {
  return `p${digits}@partners.greenfeast.test`
}

// An account left over with this login's email (e.g. the phone used to be
// another partner's): found through the Auth admin list.
async function staleAccountId(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data) return null
    const hit = data.users.find((u) => u.email?.toLowerCase() === email)
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
  return null
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
  const email = partnerEmail(digits)
  const create = () =>
    supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: "partner" },
      user_metadata: { gf_account: "partner", partner_id: p.id },
    })
  let { data: created, error } = await create()
  if (error && /already|registered|exists/i.test(error.message)) {
    // Not linked to any partner (checked above) — safe to replace.
    const stale = await staleAccountId(email)
    if (stale) {
      await supabaseAdmin.auth.admin.deleteUser(stale)
      ;({ data: created, error } = await create())
    }
  }
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
  return { ok: true, loginId: digits, password, appUrl: appUrl(), name: p.name }
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

// A message from the office to one partner or every active partner with a
// login — a push on their phone plus the app's bell. Sent as typed; the title
// ("Message from the office") is in each partner's language (migration 062).
export async function sendPartnerMessage(target: "all" | string, message: string): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
  await requireAdminStrict()
  const text = message.trim()
  if (!text) return { ok: false, error: "Type a message." }
  if (text.length > 500) return { ok: false, error: "Keep it under 500 characters." }
  let q = supabaseAdmin.from("delivery_partners").select("id").eq("status", "active").not("user_id", "is", null)
  if (target !== "all") q = q.eq("id", target)
  const { data: partners, error } = await q
  if (error) return { ok: false, error: error.message }
  if (!partners?.length) return { ok: false, error: "No active partner with a login to send to." }
  for (const p of partners) {
    const { error: sendErr } = await supabaseAdmin.rpc("notify_partner", {
      p_partner: p.id,
      p_key: "office_message",
      p_vars: { message: text },
      p_data: {},
    })
    if (sendErr) return { ok: false, error: sendErr.message }
  }
  return { ok: true, sent: partners.length }
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
