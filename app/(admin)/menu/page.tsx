import { supabaseAdmin } from "@/lib/supabase-admin"
import { MenuClient, type Dish, type Category } from "./menu-client"

export const dynamic = "force-dynamic"

export default async function MenuPage() {
  // supabaseAdmin (service role), not the anon client — this page needs
  // archived (is_active=false) rows too, and the anon key has no write
  // policy on meal_templates/categories at all (002_rls.sql / 041).
  const [{ data: dishRows }, { data: categoryRows }] = await Promise.all([
    supabaseAdmin
      .from("meal_templates")
      .select("id, name, category, short_description, description, price, kcal, protein, carbs, fat, tags, image_url, thumb_url, blur_data_url, is_active, menu_visible, subscription_valid")
      .order("category")
      .order("name"),
    supabaseAdmin
      .from("categories")
      .select("id, name, sort_order, emoji, image_url, is_active")
      .order("sort_order"),
  ])

  const dishes: Dish[] = (dishRows ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    shortDescription: d.short_description,
    description: d.description,
    priceRupees: d.price / 100,
    kcal: d.kcal,
    protein: d.protein,
    carbs: d.carbs,
    fat: d.fat,
    tags: d.tags ?? [],
    imageUrl: d.image_url,
    thumbUrl: d.thumb_url,
    blurDataUrl: d.blur_data_url,
    isActive: d.is_active,
    menuVisible: d.menu_visible,
    subscriptionValid: d.subscription_valid,
  }))

  const categories: Category[] = (categoryRows ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sort_order,
    emoji: c.emoji,
    imageUrl: c.image_url,
    isActive: c.is_active,
  }))

  return <MenuClient initialDishes={dishes} initialCategories={categories} />
}
