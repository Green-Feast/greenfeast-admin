import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { UsersClient, type UserRow, type Plan, type AddonOption } from "./users-client"
import { isTestMode } from "@/lib/mode"

export const dynamic = "force-dynamic"

type PublicUser = { id: string; name: string | null; phone: string | null; onboarded: boolean; created_at: string; customer_code: string | null; is_test: boolean }
type SubRow = {
  id: string
  user_id: string
  status: string
  plan_name: string | null
  deliveries_remaining: number | null
  payment_method: string | null
  created_at: string
}

export default async function UsersPage() {
  await requireAdmin()

  // Auth accounts (the superset — everyone who has ever signed in) and the
  // app-side profile, subscription, plan and add-on data, all in parallel.
  const [{ data: authData, error: authErr }, { data: publicUsers }, { data: subs }, { data: plans }, { data: addonRows }] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabaseAdmin.from("users").select("id, name, phone, onboarded, created_at, customer_code, is_test"),
    supabaseAdmin
      .from("subscriptions")
      .select("id, user_id, status, plan_name, deliveries_remaining, payment_method, created_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("plans")
      .select("id, name, meals_total, days_per_week, base_price")
      .eq("is_active", true)
      .order("base_price"),
    supabaseAdmin.from("addons").select("id, name, price_per_meal").eq("is_active", true).order("name"),
  ])

  const publicById = new Map<string, PublicUser>()
  for (const u of (publicUsers ?? []) as PublicUser[]) publicById.set(u.id, u)

  // Most-recent subscription per user (subs already sorted desc by created_at).
  const subByUser = new Map<string, SubRow>()
  for (const s of (subs ?? []) as SubRow[]) {
    if (!subByUser.has(s.user_id)) subByUser.set(s.user_id, s)
  }

  const rows: UserRow[] = (authData?.users ?? []).map((au) => {
    const pub = publicById.get(au.id)
    const sub = subByUser.get(au.id)
    const meta = (au.user_metadata ?? {}) as Record<string, unknown>
    const metaName = (meta.full_name as string) ?? (meta.name as string) ?? null

    return {
      id: au.id,
      email: au.email ?? null,
      name: pub?.name ?? metaName ?? null,
      customerCode: pub?.customer_code ?? null,
      isTest: pub?.is_test ?? false,
      phone: pub?.phone ?? au.phone ?? null,
      provider: (au.app_metadata?.provider as string) ?? "email",
      joinedAt: au.created_at ?? null,
      lastSignIn: au.last_sign_in_at ?? null,
      hasPublicRow: !!pub,
      onboarded: pub?.onboarded ?? false,
      subscriptionId: sub?.id ?? null,
      subStatus: sub?.status ?? null,
      planName: sub?.plan_name ?? null,
      deliveriesRemaining: sub?.deliveries_remaining ?? null,
      paymentMethod: sub?.payment_method ?? null,
    }
  })

  // Live / Test (admin mode, sidebar switch): only this side's accounts.
  const isTest = await isTestMode()
  const modeRows = rows.filter((r) => r.isTest === isTest)

  // Newest sign-ups first.
  modeRows.sort((a, b) => (b.joinedAt ?? "").localeCompare(a.joinedAt ?? ""))

  const planList = (plans ?? []) as Plan[]

  return (
    <UsersClient
      initialUsers={modeRows}
      isTestMode={isTest}
      plans={planList}
      addons={(addonRows ?? []) as AddonOption[]}
      loadError={!!authErr}
    />
  )
}
