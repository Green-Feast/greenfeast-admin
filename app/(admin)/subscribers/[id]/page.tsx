import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { istToday, addDaysISO } from "@/lib/ist"
import { ProfileClient } from "./profile-client"

export default async function SubscriberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()

  const { id } = await params

  // Core row + the embed proven to work elsewhere (users). The fragile embeds
  // (plans, subscription_addons) are fetched separately below so a
  // relationship hiccup can't 404 the whole page.
  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select(`
      id, user_id, status, payment_method, plan_name, plan_id, deliveries_remaining,
      start_date, end_date, pause_from, pause_until, meals_lunch, meals_dinner,
      special_notes, meals_per_day, delivery_mode, created_at, cod_due_paise, cod_on_credit,
      users ( id, name, phone, created_at, customer_code, is_test )
    `)
    .eq("id", id)
    .maybeSingle()

  // Surface the real reason instead of a blank 404 — a silent notFound() here
  // is what hid the actual query error in the first place.
  if (error) throw new Error(`Failed to load subscriber ${id}: ${error.message}`)
  if (!sub) notFound()

  const user = Array.isArray(sub.users) ? sub.users[0] : sub.users
  const userId = (user as any).id as string
  const today = istToday()

  const [
    { data: plan },
    { data: subAddons },
    { data: dietary },
    { data: addresses },
    { data: payments },
    { data: allBatches },
    { data: wallet },
    { data: schedule },
    { data: weeklyMenu },
    { data: walletTx },
    { data: upcoming },
    { data: rules },
    { data: meals },
    { data: addons },
    { data: plans },
    { data: authUser },
    { data: cashReportRows },
  ] = await Promise.all([
    supabaseAdmin.from("plans").select("name, meals_total, days_per_week, base_price").eq("id", sub.plan_id).maybeSingle(),
    supabaseAdmin.from("subscription_addons").select("addons ( id, name, price_per_meal )").eq("subscription_id", id),
    supabaseAdmin.from("dietary_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("addresses")
      .select("id, label, type, line1, landmark, city, pincode, time_window, is_default, batch_id_lunch, batch_id_dinner, created_at")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .order("created_at"),
    supabaseAdmin
      .from("payments")
      .select("id, amount, status, created_at, cf_payment_id, cf_order_id")
      .eq("subscription_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin.from("batches").select("id, name, meal_slot").order("name"),
    supabaseAdmin.from("wallets").select("balance").eq("user_id", userId).maybeSingle(),
    // Opt-in subscribers have one row per day they actually take delivery;
    // opt-out subscribers have none here (they get every day and skip
    // individually from the app instead) — see instantiate-orders' hasScheduleDays.
    supabaseAdmin.from("subscription_schedule").select("day_of_week").eq("subscription_id", id),
    // The one weekly menu (Mon=0..Sun=6, the Kitchen admin's convention).
    supabaseAdmin
      .from("weekly_menu")
      .select("day_of_week, meal_slot, meal_templates ( name, kcal, protein )")
      .eq("menu_type", "M1"),
    supabaseAdmin
      .from("wallet_transactions")
      .select("id, type, amount, reason, reference_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("orders")
      .select("id, delivery_date, meal_slot, status, skip_reason, quantity, extra_dish, cart_total, address_id, meal_templates ( name ), order_addons ( kind, quantity, unit_price, addons ( name ) )")
      .eq("subscription_id", id)
      .gte("delivery_date", today)
      .lte("delivery_date", addDaysISO(today, 14))
      .neq("status", "cancelled")
      .order("delivery_date")
      .order("meal_slot")
      .order("slot_seq"),
    supabaseAdmin
      .from("customer_meal_rules")
      .select("id, meal_slot, day_of_week, meal_template_id, meal_templates ( name )")
      .eq("user_id", userId)
      .order("meal_slot"),
    supabaseAdmin
      .from("meal_templates")
      .select("id, name, category")
      .eq("is_active", true)
      .eq("subscription_valid", true)
      .order("category")
      .order("name"),
    supabaseAdmin.from("addons").select("id, name, price_per_meal").eq("is_active", true).order("name"),
    supabaseAdmin.from("plans").select("id, name, base_price, meals_total").eq("is_active", true).order("base_price"),
    supabaseAdmin.auth.admin.getUserById(userId),
    // Cash a delivery partner reported collecting — recorded by the office.
    supabaseAdmin
      .from("cash_reports")
      .select("id, amount_paise, note, reported_at, delivery_partners ( name )")
      .eq("subscription_id", id)
      .is("recorded_at", null)
      .is("dismissed_at", null)
      .order("reported_at"),
  ])

  const userName = (user as any).name ?? "Unknown"
  const addrLabel = new Map(((addresses ?? []) as any[]).map((a) => [a.id, a.label || a.type || "Address"]))

  return (
    <div className="p-6 md:p-8 max-w-6xl">
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
          planId: sub.plan_id,
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
          deliveryMode: sub.delivery_mode,
          mealsLunch: (sub as any).meals_lunch ?? 1,
          mealsDinner: (sub as any).meals_dinner ?? 0,
          deliveryDays: (schedule ?? []).map((r: any) => r.day_of_week as string),
          codDue: (sub as any).cod_due_paise ?? 0,
          onCredit: !!(sub as any).cod_on_credit,
          cashReports: ((cashReportRows ?? []) as any[]).map((r) => ({
            id: r.id as string,
            amount: r.amount_paise as number,
            note: (r.note ?? null) as string | null,
            reportedAt: r.reported_at as string,
            partner: ((Array.isArray(r.delivery_partners) ? r.delivery_partners[0] : r.delivery_partners)?.name ?? "Partner") as string,
          })),
        }}
        user={{
          id: userId,
          name: userName,
          code: (user as any).customer_code ?? "",
          isTest: !!(user as any).is_test,
          phone: (user as any).phone ?? "",
          email: authUser?.user?.email ?? "",
          createdAt: (user as any).created_at,
        }}
        dietary={dietary}
        addresses={(addresses ?? []) as any[]}
        payments={(payments ?? []) as any[]}
        allBatches={(allBatches ?? []) as { id: string; name: string; meal_slot: "lunch" | "dinner" }[]}
        addons={((subAddons as any[]) ?? []).map((sa: any) => sa.addons).filter(Boolean)}
        walletBalance={wallet?.balance ?? null}
        weeklyMenu={((weeklyMenu as any[]) ?? []).map((w: any) => {
          const m = Array.isArray(w.meal_templates) ? w.meal_templates[0] : w.meal_templates
          return {
            dayOfWeek: w.day_of_week as number,
            slot: w.meal_slot as "lunch" | "dinner",
            mealName: m?.name ?? null,
            kcal: m?.kcal ?? null,
            protein: m?.protein ?? null,
          }
        })}
        walletTransactions={((walletTx as any[]) ?? []) as any}
        upcoming={((upcoming as any[]) ?? []).map((o) => ({
          id: o.id as string,
          date: o.delivery_date as string,
          slot: o.meal_slot as "lunch" | "dinner",
          status: o.status as string,
          skipReason: (o.skip_reason ?? null) as string | null,
          quantity: (o.quantity ?? 1) as number,
          extra: !!o.extra_dish,
          cartTotal: (o.cart_total ?? null) as number | null,
          mealName: (Array.isArray(o.meal_templates) ? o.meal_templates[0] : o.meal_templates)?.name ?? "—",
          addressLabel: o.address_id ? addrLabel.get(o.address_id) ?? "Old address" : "No address",
          addons: ((o.order_addons ?? []) as any[])
            .filter((l) => l.kind === "addon" && l.addons?.name)
            .map((l) => {
              const n = (l.quantity ?? 1) * (l.unit_price == null && !o.extra_dish ? (o.quantity ?? 1) : 1)
              return n > 1 ? `${l.addons.name} ×${n}` : l.addons.name
            }),
        }))}
        rules={((rules as any[]) ?? []).map((r) => ({
          id: r.id as string,
          slot: r.meal_slot as "lunch" | "dinner",
          dayOfWeek: r.day_of_week as number | null,
          mealName: (Array.isArray(r.meal_templates) ? r.meal_templates[0] : r.meal_templates)?.name ?? r.meal_template_id,
        }))}
        catalogue={{
          meals: (meals ?? []) as { id: string; name: string; category: string }[],
          addons: (addons ?? []) as { id: string; name: string; price_per_meal: number }[],
          plans: (plans ?? []) as { id: string; name: string; base_price: number; meals_total: number }[],
        }}
      />
    </div>
  )
}
