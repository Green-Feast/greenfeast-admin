import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { ProfileClient } from "./profile-client"

export default async function SubscriberProfilePage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = params

  // Core row + the two embeds proven to work elsewhere (users, batches).
  // The fragile embeds (plans, subscription_addons) are fetched separately
  // below so a relationship hiccup can't 404 the whole page.
  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select(`
      id, user_id, status, payment_method, plan_name, plan_id, deliveries_remaining,
      start_date, end_date, pause_from, pause_until, menu_type, meals_lunch, meals_dinner,
      special_notes, meals_per_day, delivery_mode, batch_id, created_at,
      users ( id, name, phone, created_at ),
      batches ( id, name )
    `)
    .eq("id", id)
    .maybeSingle()

  // Surface the real reason instead of a blank 404 — a silent notFound() here
  // is what hid the actual query error in the first place.
  if (error) throw new Error(`Failed to load subscriber ${id}: ${error.message}`)
  if (!sub) notFound()

  const user   = Array.isArray(sub.users)   ? sub.users[0]   : sub.users
  const batch  = Array.isArray(sub.batches) ? sub.batches[0] : sub.batches
  const userId = (user as any).id as string

  const [
    { data: plan },
    { data: subAddons },
    { data: dietary },
    { data: addresses },
    { data: payments },
    { data: allBatches },
    { data: wallet },
  ] = await Promise.all([
    supabaseAdmin.from("plans").select("name, meals_total, days_per_week, base_price").eq("id", sub.plan_id).maybeSingle(),
    supabaseAdmin.from("subscription_addons").select("addons ( id, name, price_per_meal )").eq("subscription_id", id),
    supabaseAdmin.from("dietary_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("addresses").select("*").eq("user_id", userId).order("is_default", { ascending: false }).order("created_at"),
    supabaseAdmin
      .from("payments")
      .select("id, amount, status, created_at, razorpay_payment_id")
      .eq("subscription_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin.from("batches").select("id, name").order("name"),
    supabaseAdmin.from("wallets").select("balance").eq("user_id", userId).maybeSingle(),
  ])

  const userName = (user as any).name ?? "Unknown"

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <nav className="flex items-center gap-1.5 text-sm text-gray-400 mb-6">
        <Link href="/subscribers" className="hover:text-[#1B5E20] transition-colors">
          Subscribers
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-[#1A1A1A] font-medium">{userName}</span>
      </nav>

      <ProfileClient
        subscriptionId={id}
        subscription={{
          status: sub.status,
          paymentMethod: (sub as any).payment_method ?? "online",
          planName: sub.plan_name ?? (plan as any)?.name ?? "—",
          deliveriesRemaining: sub.deliveries_remaining,
          mealsTotal: (plan as any)?.meals_total ?? 0,
          daysPerWeek: (plan as any)?.days_per_week ?? 0,
          basePrice: (plan as any)?.base_price ?? 0,
          startDate: sub.start_date,
          endDate: sub.end_date,
          pauseFrom: sub.pause_from,
          pauseUntil: sub.pause_until,
          specialNotes: sub.special_notes ?? "",
          createdAt: sub.created_at,
          batchId: sub.batch_id,
          batchName: (batch as any)?.name ?? "Unassigned",
          deliveryMode: sub.delivery_mode,
          menuType: (sub as any).menu_type ?? "M1",
          mealsLunch: (sub as any).meals_lunch ?? 1,
          mealsDinner: (sub as any).meals_dinner ?? 0,
        }}
        user={{
          name: userName,
          phone: (user as any).phone ?? "",
          createdAt: (user as any).created_at,
        }}
        dietary={dietary}
        addresses={(addresses ?? []) as any[]}
        payments={(payments ?? []) as any[]}
        allBatches={(allBatches ?? []) as { id: string; name: string }[]}
        addons={((subAddons as any[]) ?? []).map((sa: any) => sa.addons).filter(Boolean)}
        walletBalance={wallet?.balance ?? null}
      />
    </div>
  )
}
