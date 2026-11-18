import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { istToday } from "@/lib/ist"
import { fetchAll } from "@/lib/fetch-all"
import { monthRange } from "@/lib/money-labels"
import { SecurityClient, type LogRow } from "./security-client"

export const dynamic = "force-dynamic"

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const admin = await requireAdmin()
  const params = await searchParams
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "") ? params.month! : istToday().slice(0, 7)
  const { from, to } = monthRange(month)

  const [{ data: status }, rows] = await Promise.all([
    supabaseAdmin.rpc("admin_action_password_status", { p_admin: admin.id }),
    fetchAll<Record<string, unknown>>((a, b) =>
      supabaseAdmin
        .from("admin_audit_log")
        .select("id, created_at, admin_email, action, sensitive, password_checked, outcome, error, target_user, target_subscription, target_ref, amount_paise, details")
        .gte("created_at", `${from}T00:00:00+05:30`)
        .lt("created_at", `${to}T00:00:00+05:30`)
        .order("created_at", { ascending: false })
        .range(a, b)
    ),
  ])

  // Customer codes for the rows that name a customer.
  const userIds = [...new Set(rows.map((r) => r.target_user as string | null).filter(Boolean))] as string[]
  const codes = new Map<string, { code: string; name: string | null }>()
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await supabaseAdmin.from("users").select("id, customer_code, name").in("id", userIds.slice(i, i + 200))
    for (const u of data ?? []) codes.set(u.id, { code: u.customer_code, name: u.name })
  }

  const log: LogRow[] = rows.map((r) => {
    const who = codes.get(r.target_user as string)
    return {
      id: r.id as string,
      at: r.created_at as string,
      admin: (r.admin_email as string | null) ?? "—",
      action: r.action as string,
      sensitive: Boolean(r.sensitive),
      outcome: r.outcome as LogRow["outcome"],
      error: (r.error as string | null) ?? null,
      customer: who ? `${who.code}${who.name ? ` · ${who.name}` : ""}` : null,
      ref: (r.target_ref as string | null) ?? null,
      amount: (r.amount_paise as number | null) ?? null,
      details: (r.details as Record<string, unknown>) ?? {},
    }
  })

  const s = status as { set?: boolean; set_at?: string | null; locked_until?: string | null } | null
  return (
    <SecurityClient
      month={month}
      passwordSet={Boolean(s?.set)}
      passwordSetAt={s?.set_at ?? null}
      lockedUntil={s?.locked_until ?? null}
      log={log}
    />
  )
}
