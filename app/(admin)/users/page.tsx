import { supabaseAdmin } from "@/lib/supabase"
import { UsersClient, type UserRow, type Plan } from "./users-client"

export const dynamic = "force-dynamic"

type PublicUser = { id: string; name: string | null; phone: string | null; onboarded: boolean; created_at: string }
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
  // 1. Auth accounts (the superset — everyone who has ever signed in).
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  // 2. App-side profile + subscription data + plan catalogue (for create form).
  const [{ data: publicUsers }, { data: subs }, { data: plans }] = await Promise.all([
    supabaseAdmin.from("users").select("id, name, phone, onboarded, created_at"),
    supabaseAdmin
      .from("subscriptions")
      .select("id, user_id, status, plan_name, deliveries_remaining, payment_method, created_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("plans")
      .select("id, name, meals_total, days_per_week, base_price")
      .eq("is_active", true)
      .order("base_price"),
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

  // Newest sign-ups first.
  rows.sort((a, b) => (b.joinedAt ?? "").localeCompare(a.joinedAt ?? ""))

  const planList = (plans ?? []) as Plan[]

  return <UsersClient initialUsers={rows} plans={planList} loadError={!!authErr} />
}
