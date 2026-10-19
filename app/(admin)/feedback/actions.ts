"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"

// Feedback page (migration 064): following up 1–2★ ratings and app feedback,
// and how often customers are asked to rate.
// (No type re-exports in this file — see operations/actions.ts.)

type Result = { ok: true } | { ok: false; error: string }

function done(): Result {
  revalidatePath("/feedback")
  revalidatePath("/", "layout") // sidebar badge
  return { ok: true }
}

export async function setRatingHandled(id: string, handled: boolean, note: string): Promise<Result> {
  const admin = await requireAdmin()
  const { error } = await supabaseAdmin
    .from("meal_ratings")
    .update(
      handled
        ? { handled_at: new Date().toISOString(), handled_by: admin.email ?? "admin", admin_note: note.trim().slice(0, 1000) || null }
        : { handled_at: null, handled_by: null }
    )
    .eq("id", id)
  if (error) return { ok: false, error: error.message }
  return done()
}

export async function setFeedbackHandled(id: string, handled: boolean, note: string): Promise<Result> {
  const admin = await requireAdmin()
  const { error } = await supabaseAdmin
    .from("app_feedback")
    .update(
      handled
        ? { handled_at: new Date().toISOString(), handled_by: admin.email ?? "admin", admin_note: note.trim().slice(0, 1000) || null }
        : { handled_at: null, handled_by: null }
    )
    .eq("id", id)
  if (error) return { ok: false, error: error.message }
  return done()
}

export async function saveRatingSettings(input: { frequency: string; autoDailyAfter: number; autoWeeklyAfter: number }): Promise<Result> {
  const admin = await requireAdmin()
  if (!["every_meal", "daily", "weekly", "auto"].includes(input.frequency)) return { ok: false, error: "Unknown setting." }
  const daily = Math.round(Number(input.autoDailyAfter))
  const weekly = Math.round(Number(input.autoWeeklyAfter))
  if (!Number.isFinite(daily) || !Number.isFinite(weekly) || daily < 0 || weekly > 1000 || weekly < daily) {
    return { ok: false, error: "Automatic: the second number must be at least the first (0–1000)." }
  }
  const { error } = await supabaseAdmin
    .from("feedback_settings")
    .update({
      frequency: input.frequency,
      auto_daily_after: daily,
      auto_weekly_after: weekly,
      updated_at: new Date().toISOString(),
      updated_by: admin.email ?? "admin",
    })
    .eq("id", true)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/feedback")
  return { ok: true }
}
