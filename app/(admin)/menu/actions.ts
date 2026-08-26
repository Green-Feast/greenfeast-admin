"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"

const MEAL_BUCKET = "meal-images"
const CATEGORY_BUCKET = "category-images"

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

function publicUrl(bucket: string, path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

function pathFromPublicUrl(bucket: string, url: string | null) {
  if (!url) return null
  const marker = `/${bucket}/`
  const i = url.indexOf(marker)
  return i === -1 ? null : url.slice(i + marker.length)
}

// ── Dishes ───────────────────────────────────────────────────────────────

export type DishInput = {
  id?: string
  name: string
  category: string
  short_description: string | null
  description: string | null
  price_rupees: number
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  fibre: number | null
  tags: string[]
  menu_visible: boolean
  subscription_valid: boolean
}

export async function upsertDish(input: DishInput) {
  await requireAdmin()
  const price = Math.round(input.price_rupees * 100)
  const common = {
    name: input.name,
    category: input.category,
    short_description: input.short_description,
    description: input.description,
    price,
    kcal: input.kcal,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    fibre: input.fibre,
    tags: input.tags,
    menu_visible: input.menu_visible,
    subscription_valid: input.subscription_valid,
  }

  if (input.id) {
    const { data, error } = await supabaseAdmin
      .from("meal_templates").update(common).eq("id", input.id).select().single()
    if (error) throw error
    revalidatePath("/menu")
    return data
  }

  // id is a hand-authored slug (also the storage-path prefix) — derive from
  // name, disambiguate on collision rather than fail.
  let slug = slugify(input.name) || `dish-${Date.now()}`
  const { data: clash } = await supabaseAdmin.from("meal_templates").select("id").eq("id", slug).maybeSingle()
  if (clash) slug = `${slug}-${Date.now().toString(36)}`

  const { data, error } = await supabaseAdmin
    .from("meal_templates").insert({ id: slug, is_active: true, ...common }).select().single()
  if (error) throw error
  revalidatePath("/menu")
  return data
}

// Never a hard delete — orders.meal_template_id and subscription_schedule
// have no ON DELETE clause (NO ACTION), so Postgres would refuse anyway for
// any dish that's ever been ordered. Archiving is the only safe path.
export async function archiveDish(id: string) {
  await requireAdmin()

  const { data: weeklyRows } = await supabaseAdmin
    .from("weekly_menu").select("menu_type, day_of_week, meal_slot").eq("meal_template_id", id)
  if (weeklyRows && weeklyRows.length > 0) {
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    const slots = weeklyRows.map((r) => `${r.menu_type} ${DAYS[r.day_of_week]} ${r.meal_slot}`).join(", ")
    throw new Error(`This dish is in the weekly menu (${slots}). Clear it there first.`)
  }

  // daily_specials cascades on delete, but that's silent — clear future
  // rows ourselves first so "Today's Special" doesn't quietly go blank.
  // Past dates are history; leave them.
  const today = new Date().toISOString().slice(0, 10)
  await supabaseAdmin.from("daily_specials").delete().eq("meal_template_id", id).gte("for_date", today)

  const { error } = await supabaseAdmin.from("meal_templates").update({ is_active: false }).eq("id", id)
  if (error) throw error
  revalidatePath("/menu")
}

export async function restoreDish(id: string) {
  await requireAdmin()
  const { error } = await supabaseAdmin.from("meal_templates").update({ is_active: true }).eq("id", id)
  if (error) throw error
  revalidatePath("/menu")
}

// ── Dish images ──────────────────────────────────────────────────────────
// Filenames are content-addressed (timestamped) on every upload — the bucket
// uses a 1-year cache-control, so a re-upload at the SAME path would serve
// stale bytes to every device that already cached it. A new path is a new
// URL, so this makes that long cache correct instead of a bug.

export async function createDishImageUploadUrls(dishId: string) {
  await requireAdmin()
  const stamp = Date.now()
  const fullPath = `${dishId}/${stamp}-full.webp`
  const thumbPath = `${dishId}/${stamp}-thumb.webp`
  const [full, thumb] = await Promise.all([
    supabaseAdmin.storage.from(MEAL_BUCKET).createSignedUploadUrl(fullPath),
    supabaseAdmin.storage.from(MEAL_BUCKET).createSignedUploadUrl(thumbPath),
  ])
  if (full.error) throw full.error
  if (thumb.error) throw thumb.error
  return {
    full: { token: full.data.token, path: fullPath },
    thumb: { token: thumb.data.token, path: thumbPath },
  }
}

// Called after both objects finish uploading. Old objects are deleted LAST
// — only once the row points at the new ones — so a failed upload can never
// destroy the currently-live photo.
export async function saveDishImage(dishId: string, fullPath: string, thumbPath: string, blurDataUrl: string) {
  await requireAdmin()

  const { data: existing } = await supabaseAdmin
    .from("meal_templates").select("image_url, thumb_url").eq("id", dishId).single()

  const { data, error } = await supabaseAdmin.from("meal_templates").update({
    image_url: publicUrl(MEAL_BUCKET, fullPath),
    thumb_url: publicUrl(MEAL_BUCKET, thumbPath),
    blur_data_url: blurDataUrl,
  }).eq("id", dishId).select("image_url, thumb_url, blur_data_url").single()
  if (error) throw error

  const oldPaths = [
    pathFromPublicUrl(MEAL_BUCKET, existing?.image_url ?? null),
    pathFromPublicUrl(MEAL_BUCKET, existing?.thumb_url ?? null),
  ].filter((p): p is string => !!p && p !== fullPath && p !== thumbPath)
  if (oldPaths.length > 0) {
    await supabaseAdmin.storage.from(MEAL_BUCKET).remove(oldPaths)
  }

  revalidatePath("/menu")
  return data
}

export async function deleteDishImage(dishId: string) {
  await requireAdmin()
  const { data: existing } = await supabaseAdmin
    .from("meal_templates").select("image_url, thumb_url").eq("id", dishId).single()

  const paths = [
    pathFromPublicUrl(MEAL_BUCKET, existing?.image_url ?? null),
    pathFromPublicUrl(MEAL_BUCKET, existing?.thumb_url ?? null),
  ].filter((p): p is string => !!p)
  if (paths.length > 0) {
    await supabaseAdmin.storage.from(MEAL_BUCKET).remove(paths)
  }

  const { error } = await supabaseAdmin
    .from("meal_templates").update({ image_url: null, thumb_url: null, blur_data_url: null }).eq("id", dishId)
  if (error) throw error
  revalidatePath("/menu")
}

// ── Categories ───────────────────────────────────────────────────────────

export type CategoryInput = {
  id?: string
  name: string
  sortOrder: number
  emoji: string | null
}

export async function upsertCategory(input: CategoryInput) {
  await requireAdmin()
  if (input.id) {
    const { error } = await supabaseAdmin.from("categories")
      .update({ name: input.name, sort_order: input.sortOrder, emoji: input.emoji }).eq("id", input.id)
    if (error) throw error
  } else {
    let slug = slugify(input.name) || `category-${Date.now()}`
    const { data: clash } = await supabaseAdmin.from("categories").select("id").eq("id", slug).maybeSingle()
    if (clash) slug = `${slug}-${Date.now().toString(36)}`
    const { error } = await supabaseAdmin.from("categories")
      .insert({ id: slug, name: input.name, sort_order: input.sortOrder, emoji: input.emoji })
    if (error) throw error
  }
  revalidatePath("/menu")
}

export async function createCategoryImageUploadUrl(categoryId: string) {
  await requireAdmin()
  const path = `${categoryId}-${Date.now()}.webp`
  const { data, error } = await supabaseAdmin.storage.from(CATEGORY_BUCKET).createSignedUploadUrl(path)
  if (error) throw error
  return { token: data.token, path }
}

export async function saveCategoryImage(categoryId: string, path: string) {
  await requireAdmin()
  const { data: existing } = await supabaseAdmin.from("categories").select("image_url").eq("id", categoryId).single()
  const { data, error } = await supabaseAdmin.from("categories")
    .update({ image_url: publicUrl(CATEGORY_BUCKET, path) }).eq("id", categoryId)
    .select("image_url").single()
  if (error) throw error
  const oldPath = pathFromPublicUrl(CATEGORY_BUCKET, existing?.image_url ?? null)
  if (oldPath && oldPath !== path) {
    await supabaseAdmin.storage.from(CATEGORY_BUCKET).remove([oldPath])
  }
  revalidatePath("/menu")
  return data
}

// Real delete (not archive) — categories carry no order history of their
// own, only meal_templates.category → categories(id) ON DELETE RESTRICT
// references them, which Postgres already enforces. This just turns that
// into a readable message instead of a raw 23503.
export async function deleteCategory(id: string) {
  await requireAdmin()
  const { count } = await supabaseAdmin
    .from("meal_templates").select("*", { count: "exact", head: true }).eq("category", id)
  if ((count ?? 0) > 0) throw new Error(`${count} dish(es) still use this category. Move or archive them first.`)
  const { error } = await supabaseAdmin.from("categories").delete().eq("id", id)
  if (error) throw error
  revalidatePath("/menu")
}
