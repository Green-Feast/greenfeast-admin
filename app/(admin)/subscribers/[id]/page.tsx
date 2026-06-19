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

  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select(`
      id, status, payment_method, plan_name, plan_id, deliveries_remaining,
      start_date, end_date, pause_from, pause_until,
      special_notes, meals_per_day, delivery_mode, batch_id, created_at,
      users!inner ( id, name, phone, created_at ),
      batches ( id, name ),
      plans ( name, meals_total, days_per_week, base_price )
    `)
    .eq("id", id)
    .single()

  if (error || !sub) notFound()

  const user   = Array.isArray(sub.users)   ? sub.users[0]   : sub.users
  const batch  = Array.isArray(sub.batches) ? sub.batches[0] : sub.batches
  const plan   = Array.isArray(sub.plans)   ? sub.plans[0]   : sub.plans
  const userId = (user as any).id as string

  const [
    { data: dietary },
    { data: address },
    { data: payments },
    { data: allBatches },
  ] = await Promise.all([
    supabaseAdmin.from("dietary_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("addresses").select("*").eq("user_id", userId).order("created_at").limit(1).maybeSingle(),
    supabaseAdmin
      .from("payments")
      .select("id, amount, status, created_at, razorpay_payment_id")
      .eq("subscription_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin.from("batches").select("id, name").order("name"),
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
        }}
        user={{
          name: userName,
          phone: (user as any).phone ?? "",
          createdAt: (user as any).created_at,
        }}
        dietary={dietary}
        address={address}
        payments={(payments ?? []) as any[]}
        allBatches={(allBatches ?? []) as { id: string; name: string }[]}
      />
    </div>
  )
}
