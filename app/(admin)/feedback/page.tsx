import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { istToday, addDaysISO } from "@/lib/ist"
import type { FeedbackRow, RatingRow, RatingSettings, RatingFrequency } from "@/lib/feedback"
import { FeedbackClient } from "./feedback-client"

export const dynamic = "force-dynamic"

const PERIODS = ["7", "30", "90", "all"] as const
type Period = (typeof PERIODS)[number]

const RATING_SELECT = `
  id, user_id, subscription_id, delivery_date, meal_slot, stars, tags, comment, dish_ids, dish_names,
  source, asked_at, rated_at, dismissed_at, handled_at, handled_by, admin_note,
  users!inner ( name, phone, customer_code, is_test ),
  batches ( name ),
  delivery_partners ( name )
`

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRating(r: any): RatingRow {
  const u = one<{ name: string | null; phone: string | null; customer_code: string | null }>(r.users)
  return {
    id: r.id,
    userId: r.user_id,
    name: u?.name?.trim() || u?.customer_code || "Customer",
    code: u?.customer_code ?? "",
    phone: u?.phone ?? null,
    subscriptionId: r.subscription_id,
    date: r.delivery_date,
    slot: r.meal_slot,
    stars: r.stars,
    tags: r.tags ?? [],
    comment: r.comment,
    dishes: r.dish_names || "Meal",
    dishIds: r.dish_ids ?? [],
    batch: one<{ name: string }>(r.batches)?.name ?? null,
    partner: one<{ name: string }>(r.delivery_partners)?.name ?? null,
    source: r.source,
    askedAt: r.asked_at,
    ratedAt: r.rated_at,
    dismissedAt: r.dismissed_at,
    handledAt: r.handled_at,
    handledBy: r.handled_by,
    adminNote: r.admin_note,
  }
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; tab?: string; rating?: string }>
}) {
  await requireAdmin()
  const params = await searchParams
  const period: Period = (PERIODS as readonly string[]).includes(params.period ?? "") ? (params.period as Period) : "30"
  const tab = params.tab === "app" ? "app" : "ratings"
  const isTest = await isTestMode()
  const since = period === "all" ? null : addDaysISO(istToday(), -Number(period) + 1)

  let ratingsQuery = supabaseAdmin
    .from("meal_ratings")
    .select(RATING_SELECT)
    .eq("users.is_test", isTest)
    .order("delivery_date", { ascending: false })
    .order("meal_slot", { ascending: true }) // 'dinner' < 'lunch': a day's dinner above its lunch
    .limit(2000)
  if (since) ratingsQuery = ratingsQuery.gte("delivery_date", since)

  let feedbackQuery = supabaseAdmin
    .from("app_feedback")
    .select("id, user_id, kind, message, app_version, platform, created_at, handled_at, handled_by, admin_note, users!inner ( name, phone, customer_code, is_test )")
    .eq("users.is_test", isTest)
    .order("created_at", { ascending: false })
    .limit(500)
  if (since) feedbackQuery = feedbackQuery.gte("created_at", since + "T00:00:00+05:30")

  // 1–2★ still waiting for a follow-up are listed whatever the period.
  const openBadQuery = supabaseAdmin
    .from("meal_ratings")
    .select(RATING_SELECT)
    .eq("users.is_test", isTest)
    .lte("stars", 2)
    .is("handled_at", null)
    .order("rated_at", { ascending: false })
    .limit(200)

  const [
    { data: ratingRows, error: ratingsError },
    { data: feedbackRows, error: feedbackError },
    { data: openBadRows },
    { data: settingsRow },
    { data: template },
    focusRes,
  ] = await Promise.all([
    ratingsQuery,
    feedbackQuery,
    openBadQuery,
    supabaseAdmin.from("feedback_settings").select("frequency, auto_daily_after, auto_weekly_after, updated_at, updated_by").eq("id", true).maybeSingle(),
    supabaseAdmin.from("notification_templates").select("enabled").eq("key", "rate_meal").maybeSingle(),
    params.rating && /^[0-9a-f-]{36}$/i.test(params.rating)
      ? supabaseAdmin.from("meal_ratings").select(RATING_SELECT).eq("id", params.rating).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const ratings = (ratingRows ?? []).map(toRating)
  const openBad = (openBadRows ?? []).map(toRating)
  // A rating opened from an alert shows even when it's outside the period.
  const focus = focusRes.data ? toRating(focusRes.data) : null
  if (focus && !ratings.some((r) => r.id === focus.id)) ratings.unshift(focus)

  const feedback: FeedbackRow[] = (feedbackRows ?? []).map((f) => {
    const u = one<{ name: string | null; phone: string | null; customer_code: string | null }>(f.users)
    return {
      id: f.id,
      userId: f.user_id,
      name: u?.name?.trim() || u?.customer_code || "Customer",
      code: u?.customer_code ?? "",
      phone: u?.phone ?? null,
      kind: f.kind,
      message: f.message,
      appVersion: f.app_version,
      platform: f.platform,
      createdAt: f.created_at,
      handledAt: f.handled_at,
      handledBy: f.handled_by,
      adminNote: f.admin_note,
    }
  })

  const settings: RatingSettings = {
    frequency: (settingsRow?.frequency as RatingFrequency) ?? "every_meal",
    autoDailyAfter: settingsRow?.auto_daily_after ?? 10,
    autoWeeklyAfter: settingsRow?.auto_weekly_after ?? 30,
    updatedAt: settingsRow?.updated_at ?? null,
    updatedBy: settingsRow?.updated_by ?? null,
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <FeedbackClient
        key={`${period}-${tab}-${isTest}`}
        period={period}
        tab={tab}
        focusId={focus?.id ?? null}
        ratings={ratings}
        openBad={openBad}
        feedback={feedback}
        settings={settings}
        pushOn={!!template?.enabled}
        loadError={ratingsError?.message ?? feedbackError?.message ?? null}
      />
    </div>
  )
}
