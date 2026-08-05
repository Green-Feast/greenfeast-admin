import { supabaseAdmin } from "@/lib/supabase-admin";
import { istToday } from "@/lib/ist";
import { MoneyClient, type PaymentRow, type TxRow, type BalanceRow } from "./money-client";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const today = istToday();
  const monthStart = today.slice(0, 8) + "01";

  const [
    { data: paymentRows },
    { data: txRows },
    { data: walletRows },
    { data: subRows },
  ] = await Promise.all([
    supabaseAdmin
      .from("payments")
      .select("id, user_id, subscription_id, amount, status, cf_order_id, cf_payment_id, created_at, users ( name, phone )")
      .order("created_at", { ascending: false })
      .limit(300),
    supabaseAdmin
      .from("wallet_transactions")
      .select("id, user_id, type, amount, reason, reference_id, created_at, users ( name )")
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("wallets")
      .select("user_id, balance, updated_at, users ( name, phone )")
      .order("balance", { ascending: false }),
    // Deliveries still owed against prepaid balance — the operational side of
    // the wallet liability below.
    supabaseAdmin
      .from("subscriptions")
      .select("user_id, deliveries_remaining, plan_name, status")
      .in("status", ["active", "paused", "pending"]),
  ]);

  const payments: PaymentRow[] = (paymentRows ?? []).map((p: any) => {
    const u = Array.isArray(p.users) ? p.users[0] : p.users;
    return {
      id: p.id,
      userId: p.user_id,
      name: u?.name ?? "Unknown",
      phone: u?.phone ?? "",
      amount: p.amount ?? 0,
      status: p.status ?? "created",
      kind: p.subscription_id ? "plan" : "top-up",
      cfOrderId: p.cf_order_id ?? null,
      cfPaymentId: p.cf_payment_id ?? null,
      createdAt: p.created_at,
    };
  });

  const transactions: TxRow[] = (txRows ?? []).map((t: any) => {
    const u = Array.isArray(t.users) ? t.users[0] : t.users;
    return {
      id: t.id,
      userId: t.user_id,
      name: u?.name ?? "Unknown",
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
      phone: u?.phone ?? "",
      balance: w.balance ?? 0,
      deliveriesRemaining: deliveriesByUser.get(w.user_id) ?? 0,
      updatedAt: w.updated_at,
    };
  });

  return (
    <MoneyClient
      payments={payments}
      transactions={transactions}
      balances={balances}
      monthStart={monthStart}
    />
  );
}
