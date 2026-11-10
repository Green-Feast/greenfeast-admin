import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { RewardsClient, type RefundRow, type GiftRow, type ReferralRow } from "./rewards-client";
import type { RefundCustomer, RefundablePayment } from "./refund-dialog";

export const dynamic = "force-dynamic";

// Referrals, refunds & gifts (081). Refunds moved here from Money unchanged.
export default async function RewardsPage() {
  await requireAdmin()
  const isTest = await isTestMode()

  // Settle pending bank refunds by asking Cashfree (refund events aren't
  // available on our webhook settings). Only when one is actually pending —
  // calling the edge function on every load cost a second or more.
  const { count: pendingBank } = await supabaseAdmin
    .from("refunds").select("id", { count: "exact", head: true }).eq("kind", "bank").eq("status", "pending");
  if (pendingBank) await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/admin-refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INTERNAL_FN_SECRET}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "sync" }),
    signal: AbortSignal.timeout(6000),
  }).catch(() => {});

  const [
    { data: refundRows },
    { data: paymentRows },
    { data: walletRows },
    { data: userRows },
    { data: giftRows },
    { data: referralRows },
  ] = await Promise.all([
    supabaseAdmin
      .from("refunds")
      .select("id, user_id, payment_id, kind, amount, reason, status, failure_note, created_at, users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest)
      .order("created_at", { ascending: false })
      .limit(300),
    // Paid Cashfree payments — what can still go back to the bank.
    supabaseAdmin
      .from("payments")
      .select("id, user_id, subscription_id, amount, status, cf_order_id, cf_payment_id, created_at, users!inner ( is_test )")
      .eq("users.is_test", isTest)
      .eq("status", "paid")
      .not("cf_payment_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("wallets")
      .select("user_id, balance, users!inner ( is_test )")
      .eq("users.is_test", isTest),
    // Everyone, for the customer pickers.
    supabaseAdmin.from("users").select("id, name, phone, customer_code").eq("is_test", isTest).order("customer_code"),
    supabaseAdmin
      .from("meal_gifts")
      .select("id, meals, amount_paise, meal_cost_paise, reason, created_by, created_at, users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest)
      .order("created_at", { ascending: false })
      .limit(300),
    supabaseAdmin
      .from("referrals")
      .select(`id, code, status, reject_reason, referrer_credit_paise, referee_credit_paise, created_at,
               referrer:users!referrals_referrer_id_fkey ( name, customer_code, is_test ),
               referee:users!referrals_referee_id_fkey ( name, customer_code ),
               subscriptions ( plan_name, plans ( meals_total ) )`)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

  const refunds: RefundRow[] = (refundRows ?? []).map((r: any) => {
    const u = one(r.users) as any;
    return {
      id: r.id,
      name: u?.name ?? "Unknown",
      code: u?.customer_code ?? "",
      kind: r.kind,
      amount: r.amount,
      reason: r.reason,
      status: r.status,
      failureNote: r.failure_note ?? null,
      createdAt: r.created_at,
    };
  });

  // What's still refundable to the bank on each paid Cashfree payment.
  const bankRefunded = new Map<string, number>();
  for (const r of (refundRows ?? []) as any[]) {
    if (r.kind === "bank" && r.payment_id && r.status !== "failed") {
      bankRefunded.set(r.payment_id, (bankRefunded.get(r.payment_id) ?? 0) + r.amount);
    }
  }
  const refundablePayments: RefundablePayment[] = ((paymentRows ?? []) as any[])
    .filter((p) => p.cf_order_id && p.cf_payment_id)
    .map((p) => ({
      id: p.id,
      userId: p.user_id,
      amount: p.amount ?? 0,
      refundable: (p.amount ?? 0) - (bankRefunded.get(p.id) ?? 0),
      kind: p.subscription_id ? "plan" : "top-up",
      createdAt: p.created_at,
      cfPaymentId: p.cf_payment_id,
    }));

  const balanceByUser = new Map(((walletRows ?? []) as any[]).map((w) => [w.user_id as string, (w.balance ?? 0) as number]));
  const customers: RefundCustomer[] = (userRows ?? []).map((u: any) => ({
    id: u.id,
    name: u.name ?? "Unnamed",
    phone: u.phone ?? "",
    code: u.customer_code ?? "",
    balance: balanceByUser.get(u.id) ?? 0,
  }));

  const gifts: GiftRow[] = (giftRows ?? []).map((g: any) => {
    const u = one(g.users) as any;
    return {
      id: g.id,
      name: u?.name ?? "Unknown",
      code: u?.customer_code ?? "",
      meals: g.meals,
      amount: g.amount_paise,
      reason: g.reason,
      by: g.created_by ?? null,
      createdAt: g.created_at,
    };
  });

  const referrals: ReferralRow[] = ((referralRows ?? []) as any[])
    .filter((r) => (one(r.referrer) as any)?.is_test === isTest)
    .map((r) => {
      const a = one(r.referrer) as any;
      const b = one(r.referee) as any;
      const s = one(r.subscriptions) as any;
      const mealsTotal = (one(s?.plans) as any)?.meals_total as number | undefined;
      return {
        id: r.id,
        referrerName: a?.name ?? "Unknown",
        referrerCode: a?.customer_code ?? r.code,
        refereeName: b?.name ?? "Unknown",
        refereeCode: b?.customer_code ?? "",
        plan: s?.plan_name ?? (mealsTotal ? `${mealsTotal} meals` : "—"),
        status: r.status,
        rejectReason: r.reject_reason ?? null,
        referrerCredit: r.referrer_credit_paise ?? 0,
        refereeCredit: r.referee_credit_paise ?? 0,
        createdAt: r.created_at,
      };
    });

  return (
    <RewardsClient
      refunds={refunds}
      gifts={gifts}
      referrals={referrals}
      customers={customers}
      refundablePayments={refundablePayments}
    />
  );
}
