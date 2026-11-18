import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { istToday } from "@/lib/ist"
import { fetchAll } from "@/lib/fetch-all"
import { monthRange } from "@/lib/money-labels"
import { refundablePayments } from "@/lib/money-ops"
import {
  MoneyClient,
  type MoneyData, type LedgerRow, type PaymentRow, type RefundRow, type GiftRow, type ReferralRow,
  type CouponUseRow, type BalanceRow, type DecisionRow, type ArchiveRow, type Check, type Summary,
} from "./money-client"

export const dynamic = "force-dynamic"

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

// The Money tab: one month at a time (IST), every rupee explained — the
// categorised ledger, real money received with its proof, refunds, gifts,
// referrals, coupons, balances, cancelled customers' balances, deleted
// accounts, and the reconciliation checks (migration 092).
export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ month?: string; tab?: string }> }) {
  await requireAdmin()
  const isTest = await isTestMode()
  const params = await searchParams
  const thisMonth = istToday().slice(0, 7)
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "") && params.month! <= thisMonth ? params.month! : thisMonth
  const { from, to } = monthRange(month)
  const fromTs = `${from}T00:00:00+05:30`
  const toTs = `${to}T00:00:00+05:30`

  const [
    { data: summary, error: summaryErr },
    { data: checks, error: checksErr },
    ledgerRaw,
    paymentsRaw,
    { data: refundsRaw },
    { data: giftsRaw },
    { data: referralsRaw },
    { data: couponRaw },
    walletsRaw,
    { data: liveSubs },
    { data: decisionsRaw },
    { data: archivesRaw },
    { data: admins },
  ] = await Promise.all([
    supabaseAdmin.rpc("money_month_summary", { p_from: from, p_to: to, p_test: isTest }),
    supabaseAdmin.rpc("money_checks", { p_test: isTest }),
    fetchAll<any>((a, b) =>
      supabaseAdmin.rpc("money_ledger_rows", { p_from: fromTs, p_to: toTs, p_test: isTest }).order("created_at", { ascending: false }).range(a, b)),
    fetchAll<any>((a, b) =>
      supabaseAdmin.from("payments")
        .select("id, user_id, subscription_id, amount, status, method, source, cash_paise, upi_paise, proof_reference, paid_on, recorded_by, admin_action_id, note, cf_order_id, cf_payment_id, created_at, discount_paise, wallet_credit_paise, wallet_tx_id, proof_added_at, coupons ( code ), users!inner ( name, customer_code, is_test )")
        .eq("users.is_test", isTest)
        .or(`and(paid_on.gte.${from},paid_on.lt.${to}),and(created_at.gte.${fromTs},created_at.lt.${toTs})`)
        .order("created_at", { ascending: false })
        .range(a, b)),
    supabaseAdmin.from("refunds")
      .select("id, user_id, payment_id, kind, amount, reason, status, method, proof_reference, failure_note, created_by, created_at, users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest).gte("created_at", fromTs).lt("created_at", toTs).order("created_at", { ascending: false }),
    supabaseAdmin.from("meal_gifts")
      .select("id, user_id, meals, meal_cost_paise, amount_paise, reason, created_by, created_at, users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest).gte("created_at", fromTs).lt("created_at", toTs).order("created_at", { ascending: false }),
    supabaseAdmin.from("referrals")
      .select("id, status, reject_reason, referrer_credit_paise, created_at, code, referrer:users!referrals_referrer_id_fkey ( name, customer_code, is_test ), referee:users!referrals_referee_id_fkey ( name, customer_code )")
      .gte("created_at", fromTs).lt("created_at", toTs).order("created_at", { ascending: false }),
    supabaseAdmin.from("coupon_redemptions")
      .select("id, kind, meals, meal_price_paise, regular_meal_price_paise, discount_paise, created_at, coupons ( code ), users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest).gte("created_at", fromTs).lt("created_at", toTs).order("created_at", { ascending: false }),
    fetchAll<any>((a, b) =>
      supabaseAdmin.from("wallets").select("user_id, balance, updated_at, users!inner ( name, phone, customer_code, is_test )")
        .eq("users.is_test", isTest).neq("balance", 0).order("balance", { ascending: false }).range(a, b)),
    supabaseAdmin.from("subscriptions").select("user_id, status, plan_name, deliveries_remaining, cod_due_paise, cod_on_credit")
      .in("status", ["active", "paused", "pending"]),
    supabaseAdmin.from("balance_decisions")
      .select("id, user_id, decision, amount_paise, balance_before, reason, admin_id, created_at, users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest).gte("created_at", fromTs).lt("created_at", toTs).order("created_at", { ascending: false }),
    supabaseAdmin.from("money_archives")
      .select("id, customer_code, name, phone, reason, balance_at_close, forfeited_paise, rows_archived, admin_id, archived_at")
      .eq("is_test", isTest).order("archived_at", { ascending: false }).limit(500),
    supabaseAdmin.from("admin_users").select("user_id, email"),
  ])

  const adminEmail = new Map<string, string>((admins ?? []).map((a: any) => [a.user_id, a.email]))
  const who = (id: string | null | undefined) => (id ? adminEmail.get(id) ?? "admin" : null)

  const ledger: LedgerRow[] = ledgerRaw.map((t: any) => ({
    id: t.id, at: t.created_at, code: t.customer_code ?? "", name: t.customer_name ?? "", type: t.type, category: t.category,
    amount: t.amount, reason: t.reason ?? "", reference: t.reference_id ?? "", admin: t.admin_email ?? null, archived: Boolean(t.archived),
  }))

  const payments: PaymentRow[] = paymentsRaw.map((p: any) => {
    const u = one<any>(p.users)
    return {
      id: p.id, userId: p.user_id, code: u?.customer_code ?? "", name: u?.name ?? "", amount: p.amount ?? 0, status: p.status,
      method: p.method ?? null, source: p.source ?? null, cash: p.cash_paise ?? 0, upi: p.upi_paise ?? 0,
      proof: p.proof_reference ?? null, paidOn: p.paid_on ?? null, recordedBy: who(p.recorded_by), note: p.note ?? null,
      cfOrderId: p.cf_order_id ?? null, cfPaymentId: p.cf_payment_id ?? null, createdAt: p.created_at,
      couponCode: one<any>(p.coupons)?.code ?? null, discount: p.discount_paise ?? 0, walletCarry: p.wallet_credit_paise ?? 0,
      credited: Boolean(p.wallet_tx_id), proofAddedAt: p.proof_added_at ?? null,
    }
  })

  const refunds: RefundRow[] = (refundsRaw ?? []).map((r: any) => {
    const u = one<any>(r.users)
    return {
      id: r.id, code: u?.customer_code ?? "", name: u?.name ?? "", kind: r.kind, amount: r.amount, reason: r.reason, status: r.status,
      method: r.method ?? null, proof: r.proof_reference ?? null, failureNote: r.failure_note ?? null, by: who(r.created_by), at: r.created_at,
    }
  })

  const gifts: GiftRow[] = (giftsRaw ?? []).map((g: any) => {
    const u = one<any>(g.users)
    return { id: g.id, code: u?.customer_code ?? "", name: u?.name ?? "", meals: g.meals, mealCost: g.meal_cost_paise, amount: g.amount_paise, reason: g.reason, by: g.created_by ?? null, at: g.created_at }
  })

  const referrals: ReferralRow[] = (referralsRaw ?? [])
    .filter((r: any) => Boolean(one<any>(r.referrer)?.is_test) === isTest)
    .map((r: any) => ({
      id: r.id, referrer: one<any>(r.referrer)?.customer_code ?? "", referrerName: one<any>(r.referrer)?.name ?? "",
      friend: one<any>(r.referee)?.customer_code ?? "", friendName: one<any>(r.referee)?.name ?? "",
      status: r.status, rejectReason: r.reject_reason ?? null, reward: r.referrer_credit_paise ?? 0, at: r.created_at,
    }))

  const couponUses: CouponUseRow[] = (couponRaw ?? []).map((c: any) => {
    const u = one<any>(c.users)
    return {
      id: c.id, code: u?.customer_code ?? "", name: u?.name ?? "", coupon: one<any>(c.coupons)?.code ?? "", kind: c.kind, meals: c.meals,
      price: c.meal_price_paise, regular: c.regular_meal_price_paise, discount: c.discount_paise ?? 0, at: c.created_at,
    }
  })

  const live = new Map<string, any>()
  for (const s of liveSubs ?? []) if (!live.has(s.user_id)) live.set(s.user_id, s)
  const balances: BalanceRow[] = walletsRaw.map((w: any) => {
    const u = one<any>(w.users)
    const s = live.get(w.user_id)
    return {
      userId: w.user_id, code: u?.customer_code ?? "", name: u?.name ?? "", phone: u?.phone ?? "", balance: w.balance,
      plan: s?.plan_name ?? null, planStatus: s?.status ?? null, mealsLeft: s?.deliveries_remaining ?? null,
      cashDue: s?.cod_due_paise ?? 0, onCredit: Boolean(s?.cod_on_credit), updatedAt: w.updated_at,
    }
  })

  const decisions: DecisionRow[] = (decisionsRaw ?? []).map((d: any) => {
    const u = one<any>(d.users)
    return { id: d.id, code: u?.customer_code ?? "", name: u?.name ?? "", decision: d.decision, amount: d.amount_paise, before: d.balance_before, reason: d.reason, by: who(d.admin_id), at: d.created_at }
  })

  const archives: ArchiveRow[] = (archivesRaw ?? []).map((a: any) => ({
    id: a.id, code: a.customer_code ?? "", name: a.name ?? "", phone: a.phone ?? "", reason: a.reason, balance: a.balance_at_close,
    forfeited: a.forfeited_paise, rows: a.rows_archived, by: who(a.admin_id) ?? (a.reason === "account_deleted" ? "customer" : null), at: a.archived_at,
  }))

  // Refundable Cashfree payments for the customers on the "to settle" list.
  const checkList = (checks ?? []) as Check[]
  const toSettle = checkList.find((c) => c.key === "balances_to_settle")?.rows ?? []
  const settleIds = toSettle.map((r: any) => r.user_id as string).filter(Boolean)
  const refundable = Object.fromEntries(await Promise.all(settleIds.map(async (id) => [id, await refundablePayments(id)] as const)))

  const data: MoneyData = {
    month, from, to, isTest,
    summary: (summary ?? null) as Summary | null,
    error: summaryErr?.message ?? checksErr?.message ?? null,
    checks: checkList, ledger, payments, refunds, gifts, referrals, couponUses, balances, decisions, archives, refundable,
  }
  return <MoneyClient data={data} />
}
