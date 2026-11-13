import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { UsersClient, type UserRow, type OnboardingData, type Plan, type AddonOption, type CouponOption } from "./users-client"
import { istToday } from "@/lib/ist"
import { isTestMode } from "@/lib/mode"

export const dynamic = "force-dynamic"

type Draft = { planId?: string | null; planName?: string | null; addonIds?: string[]; days?: string[]; mealsLunch?: number; mealsDinner?: number; updatedAt?: string }
type PublicUser = { id: string; name: string | null; phone: string | null; onboarded: boolean; created_at: string; customer_code: string | null; is_test: boolean; onboarding_draft: Draft | null }
type SubRow = {
  id: string
  user_id: string
  status: string
  plan_name: string | null
  deliveries_remaining: number | null
  payment_method: string | null
  created_at: string
}

type DietRow = {
  user_id: string
  health_goal: string | null
  weight: number | null
  height: number | null
  exercise_type: string | null
  exercise_frequency: string | null
  occupation: string | null
  protein_target: number | null
  fibre_target: number | null
  allergens: string[] | null
  free_text: string | null
}
type QuizRow = { user_id: string; derived_menu: string | null; derived_addons: string[] | null }
type AddrRow = { user_id: string; line1: string | null; landmark: string | null; pincode: string | null; city: string | null }

function onboardingOf(d?: DietRow, q?: QuizRow, a?: AddrRow, draft?: Draft | null): OnboardingData | null {
  if (!d && !q && !a && !draft) return null
  return {
    healthGoal: d?.health_goal ?? null,
    weightKg: d?.weight ?? null,
    heightCm: d?.height ?? null,
    exercise: [d?.exercise_type, d?.exercise_frequency].filter(Boolean).join(" · ") || null,
    occupation: d?.occupation ?? null,
    proteinTarget: d?.protein_target ?? null,
    fibreTarget: d?.fibre_target ?? null,
    allergens: d?.allergens ?? [],
    dietNotes: d?.free_text ?? null,
    menu: q?.derived_menu ?? null,
    addonIds: q?.derived_addons ?? [],
    address: a?.line1 ? { line1: a.line1, landmark: a.landmark, pincode: a.pincode, city: a.city } : null,
    // What they actually chose on the plan / add-on / days screens (090).
    choices: draft?.planId
      ? {
          planId: draft.planId,
          planName: draft.planName ?? null,
          addonIds: draft.addonIds ?? [],
          days: draft.days ?? [],
          mealsLunch: draft.mealsLunch ?? 1,
          mealsDinner: draft.mealsDinner ?? 0,
          updatedAt: draft.updatedAt ?? null,
        }
      : null,
  }
}

export default async function UsersPage() {
  await requireAdmin()

  // Auth accounts (the superset — everyone who has ever signed in) and the
  // app-side profile, subscription, plan and add-on data, all in parallel.
  const today = istToday()
  const [{ data: authData, error: authErr }, { data: publicUsers }, { data: subs }, { data: plans }, { data: addonRows }, { data: couponRows }, { data: dietRows }, { data: quizRows }, { data: addrRows }] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabaseAdmin.from("users").select("id, name, phone, onboarded, created_at, customer_code, is_test, onboarding_draft"),
    supabaseAdmin
      .from("subscriptions")
      .select("id, user_id, status, plan_name, deliveries_remaining, payment_method, created_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("plans")
      .select("id, name, meals_total, days_per_week, base_price, allow_cod")
      .eq("is_active", true)
      .order("base_price"),
    supabaseAdmin.from("addons").select("id, name, price_per_meal").eq("is_active", true).order("name"),
    // Coupons that work today, for Create subscription (migration 066).
    supabaseAdmin
      .from("coupons")
      .select("id, code, name, coupon_plans ( plan_id, meal_price_paise )")
      .eq("active", true)
      .lte("starts_on", today)
      .gte("ends_on", today)
      .order("code"),
    // What a user entered in app onboarding before paying, so the admin can
    // see it and pick up from there (Create subscription prefills from it).
    supabaseAdmin
      .from("dietary_profiles")
      .select("user_id, health_goal, weight, height, exercise_type, exercise_frequency, occupation, protein_target, fibre_target, allergens, free_text"),
    supabaseAdmin.from("questionnaire_responses").select("user_id, derived_menu, derived_addons"),
    supabaseAdmin
      .from("addresses")
      .select("user_id, line1, landmark, pincode, city")
      .eq("is_default", true)
      .is("archived_at", null),
  ])

  const dietByUser = new Map<string, DietRow>()
  for (const d of (dietRows ?? []) as DietRow[]) dietByUser.set(d.user_id, d)
  const quizByUser = new Map<string, QuizRow>()
  for (const q of (quizRows ?? []) as QuizRow[]) quizByUser.set(q.user_id, q)
  const addrByUser = new Map<string, AddrRow>()
  for (const a of (addrRows ?? []) as AddrRow[]) addrByUser.set(a.user_id, a)

  const publicById = new Map<string, PublicUser>()
  for (const u of (publicUsers ?? []) as PublicUser[]) publicById.set(u.id, u)

  // One plan per user: the live one if there is one — an unpaid renewal must
  // not hide a plan that's still running — else the most recent (subs are
  // already sorted newest first).
  const LIVE_RANK: Record<string, number> = { active: 0, paused: 1 }
  const subByUser = new Map<string, SubRow>()
  for (const s of (subs ?? []) as SubRow[]) {
    const current = subByUser.get(s.user_id)
    if (!current || (LIVE_RANK[s.status] ?? 9) < (LIVE_RANK[current.status] ?? 9)) subByUser.set(s.user_id, s)
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
      onboarding: onboardingOf(dietByUser.get(au.id), quizByUser.get(au.id), addrByUser.get(au.id), pub?.onboarding_draft),
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
      coupons={((couponRows ?? []) as { id: string; code: string; name: string | null; coupon_plans: { plan_id: string; meal_price_paise: number }[] }[]).map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        prices: Object.fromEntries((c.coupon_plans ?? []).map((p) => [p.plan_id, p.meal_price_paise])),
      }))}
      loadError={!!authErr}
    />
  )
}
