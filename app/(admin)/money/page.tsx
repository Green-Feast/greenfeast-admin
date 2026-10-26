import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/auth"
import { isTestMode } from "@/lib/mode"
import { istToday } from "@/lib/ist";
import { MoneyClient, type PaymentRow, type TxRow, type BalanceRow, type RefundRow } from "./money-client";
import type { RefundCustomer, RefundablePayment } from "./refund-dialog";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
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

  const today = istToday();
  const monthStart = today.slice(0, 8) + "01";

  const [
    { data: paymentRows },
    { data: txRows },
    { data: walletRows },
    { data: subRows },
    { data: refundRows },
    { data: userRows },
  ] = await Promise.all([
    supabaseAdmin
      .from("payments")
      .select("id, user_id, subscription_id, amount, status, cf_order_id, cf_payment_id, created_at, discount_paise, coupons ( code ), users!inner ( name, phone, customer_code, is_test )")
      .eq("users.is_test", isTest)
      .order("created_at", { ascending: false })
      .limit(300),
    supabaseAdmin
      .from("wallet_transactions")
      .select("id, user_id, type, amount, reason, reference_id, created_at, users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("wallets")
      .select("user_id, balance, updated_at, users!inner ( name, phone, customer_code, is_test )")
      .eq("users.is_test", isTest)
      .order("balance", { ascending: false }),
    // Deliveries still owed against prepaid balance — the operational side of
    // the wallet liability below.
    supabaseAdmin
      .from("subscriptions")
      .select("user_id, deliveries_remaining, plan_name, status")
      .in("status", ["active", "paused", "pending"]),
    supabaseAdmin
      .from("refunds")
      .select("id, user_id, payment_id, kind, amount, reason, status, failure_note, created_at, users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest)
      .order("created_at", { ascending: false })
      .limit(300),
    // Everyone, for the refund dialog's customer picker.
    supabaseAdmin.from("users").select("id, name, phone, customer_code").eq("is_test", isTest).order("customer_code"),
  ]);

  const payments: PaymentRow[] = (paymentRows ?? []).map((p: any) => {
    const u = Array.isArray(p.users) ? p.users[0] : p.users;
    return {
      id: p.id,
      userId: p.user_id,
      name: u?.name ?? "Unknown",
      code: u?.customer_code ?? "",
      phone: u?.phone ?? "",
      amount: p.amount ?? 0,
      status: p.status ?? "created",
      kind: p.subscription_id ? "plan" : "top-up",
      cfOrderId: p.cf_order_id ?? null,
      cfPaymentId: p.cf_payment_id ?? null,
      createdAt: p.created_at,
      // Bought with a coupon (migration 066).
      couponCode: (Array.isArray(p.coupons) ? p.coupons[0] : p.coupons)?.code ?? null,
      discount: p.discount_paise ?? 0,
    };
  });

  const transactions: TxRow[] = (txRows ?? []).map((t: any) => {
    const u = Array.isArray(t.users) ? t.users[0] : t.users;
    return {
      id: t.id,
      userId: t.user_id,
      name: u?.name ?? "Unknown",
      code: u?.customer_code ?? "",
      type: t.type as "credit" | "debit",
      amount: t.amount ?? 0,
      reason: t.reason ?? "",
      referenceId: t.reference_id ?? null,
      createdAt: t.created_at,
    };
  });

  const deliveriesByUser = new Map<string, number>();
  for (const s of (subRows ?? []) as any[]) {
    deliveriesByUser.set(s.user_id, (deliveriesByUser.get(s.user_id) ?? 0) + (s.deliveries_remaining ?? 0));
  }

  const balances: BalanceRow[] = (walletRows ?? []).map((w: any) => {
    const u = Array.isArray(w.users) ? w.users[0] : w.users;
    return {
      userId: w.user_id,
      name: u?.name ?? "Unknown",
      code: u?.customer_code ?? "",
      phone: u?.phone ?? "",
      balance: w.balance ?? 0,
      deliveriesRemaining: deliveriesByUser.get(w.user_id) ?? 0,
      updatedAt: w.updated_at,
    };
  });

  const refunds: RefundRow[] = (refundRows ?? []).map((r: any) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
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
  const refundablePayments: RefundablePayment[] = payments
    .filter((p) => p.status === "paid" && p.cfOrderId && p.cfPaymentId)
    .map((p) => ({
      id: p.id,
      userId: p.userId,
      amount: p.amount,
      refundable: p.amount - (bankRefunded.get(p.id) ?? 0),
      kind: p.kind,
      createdAt: p.createdAt,
      cfPaymentId: p.cfPaymentId,
    }));

  const balanceByUser = new Map(balances.map((b) => [b.userId, b.balance]));
  const customers: RefundCustomer[] = (userRows ?? []).map((u: any) => ({
    id: u.id,
    name: u.name ?? "Unnamed",
    phone: u.phone ?? "",
    code: u.customer_code ?? "",
    balance: balanceByUser.get(u.id) ?? 0,
  }));

  return (
    <MoneyClient
      payments={payments}
      transactions={transactions}
      balances={balances}
      refunds={refunds}
      customers={customers}
      refundablePayments={refundablePayments}
      monthStart={monthStart}
    />
  );
}
