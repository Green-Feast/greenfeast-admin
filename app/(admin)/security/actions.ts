"use server"

import { createClient } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdminStrict } from "@/lib/auth"
import { audited } from "@/lib/audit"

export type SecurityResult = { ok: true; message: string } | { ok: false; error: string }

// Is this the admin's login password? Checked with a throwaway client that
// keeps no session, then that one session is ended (scope "local": the
// admin's own browser session is untouched).
async function loginPasswordOk(email: string, password: string) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) return false
  await client.auth.signOut({ scope: "local" })
  return true
}

// Set or change the action password. Needs the login password; changing an
// existing one also needs the current action password (it counts as a try —
// 5 wrong ones lock it for 15 minutes).
export async function setActionPassword(
  loginPassword: string,
  currentActionPassword: string,
  newPassword: string
): Promise<SecurityResult> {
  const admin = await requireAdminStrict()
  return audited("security.setActionPassword", { ref: admin.id }, async (): Promise<SecurityResult> => {
    if (!admin.email) return { ok: false, error: "Your admin account has no email." }
    if (!newPassword || newPassword.length < 8) return { ok: false, error: "Use at least 8 characters." }
    if (newPassword === loginPassword) return { ok: false, error: "Use a different password from your login password." }
    if (!(await loginPasswordOk(admin.email, loginPassword))) return { ok: false, error: "Your login password is wrong." }

    const { data: status } = await supabaseAdmin.rpc("admin_action_password_status", { p_admin: admin.id })
    if ((status as { set?: boolean } | null)?.set) {
      const { data: check } = await supabaseAdmin.rpc("admin_check_action_password", {
        p_admin: admin.id, p_password: currentActionPassword ?? "",
      })
      const c = check as { ok?: boolean; error?: string } | null
      if (!c?.ok) return { ok: false, error: c?.error ?? "Your current action password is wrong." }
    }

    const { error } = await supabaseAdmin.rpc("admin_set_action_password", { p_admin: admin.id, p_new: newPassword })
    if (error) return { ok: false, error: error.message }
    revalidatePath("/security")
    return { ok: true, message: "Action password saved." }
  })
}
