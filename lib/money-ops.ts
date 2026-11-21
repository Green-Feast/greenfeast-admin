import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import { notifyEvent } from "./notifications";
import { background } from "./background";
import { dbError, type SensitiveCtx } from "./audit";
import { rupees } from "./money-labels";
import type { ProofInput } from "@/components/payment-proof";

// Money moves the admin makes, each one database function (migration 092)
// that records the payment / refund / decision, moves the wallet and stamps
// the admin and the action id on every row. Callers wrap these in
// sensitive(), which checks the action password and writes the admin log.

export type MoneyResult = { ok: true; message: string; paymentId?: string } | { ok: false; error: string };

async function recipient(userId: string) {
  const { data } = await supabaseAdmin.from("users").select("name, phone").eq("id", userId).maybeSingle();
  return { user_id: userId, name: data?.name ?? "Customer", phone: data?.phone ?? null };
}

export function validProof(p: ProofInput | null | undefined, amountPaise: number): string | null {
  if (amountPaise <= 0) return null;
  if (!p || !p.method) return "Say how the money was paid.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn ?? "")) return "Give the day it was paid.";
  if (p.method === "cash_upi" && (p.cashPaise ?? 0) + (p.upiPaise ?? 0) !== amountPaise) return "Cash + UPI must add up to the amount.";
  if (p.method !== "cash" && (p.reference ?? "").trim().length < 3) return "Add the proof reference.";
  return null;
}

/** Money the office received (onboarding / activation), into the wallet. */
export async function recordOfficePayment(ctx: SensitiveCtx, args: {
  userId: string;
  subId: string | null;
  amountPaise: number;
  proof: ProofInput;
  source: "admin_onboarding" | "admin_activation";
  reason: string;
  idempotencyKey: string | null;
}): Promise<{ ok: true; paymentId: string } | { ok: false; error: string }> {
  const bad = validProof(args.proof, args.amountPaise);
  if (bad) return { ok: false, error: bad };
  const { data, error } = await supabaseAdmin.rpc("admin_record_payment", {
    p_user: args.userId,
    p_sub: args.subId,
    p_amount: args.amountPaise,
    p_method: args.proof.method,
    p_cash: args.proof.method === "cash_upi" ? args.proof.cashPaise : null,
    p_upi: args.proof.method === "cash_upi" ? args.proof.upiPaise : null,
    p_reference: args.proof.reference,
    p_paid_on: args.proof.paidOn,
    p_source: args.source,
    p_note: args.proof.note || null,
    p_reason: args.reason,
    p_admin: ctx.admin.id,
    p_action: ctx.actionId,
    p_idem: args.idempotencyKey,
  });
  if (error) return { ok: false, error: dbError(error, "Could not record the payment.") };
  const paymentId = (data as { payment_id: string }).payment_id;
  ctx.note({ userId: args.userId, subscriptionId: args.subId, amountPaise: args.amountPaise, ref: paymentId,
    details: { method: args.proof.method, source: args.source, proof: args.proof.reference, paid_on: args.proof.paidOn } });
  return { ok: true, paymentId };
}

export type CodInput = {
  cashPaise: number;
  upiPaise: number;
  upiReference: string;
  paidOn: string;
  note: string;
  idempotencyKey: string | null;
};

/** Cash-on-delivery money: cash + UPI must equal what's due, exactly. */
export async function recordCod(ctx: SensitiveCtx, subId: string, input: CodInput, cashReportId: string | null): Promise<MoneyResult> {
  const { data, error } = await supabaseAdmin.rpc("admin_record_cod", {
    p_sub: subId,
    p_cash: input.cashPaise,
    p_upi: input.upiPaise,
    p_upi_reference: input.upiReference || null,
    p_paid_on: input.paidOn,
    p_note: input.note || null,
    p_cash_report: cashReportId,
    p_admin: ctx.admin.id,
    p_action: ctx.actionId,
    p_idem: input.idempotencyKey,
  });
  if (error) return { ok: false, error: dbError(error, "Could not record the payment.") };
  const res = data as { payment_id: string; duplicate: boolean; user_id?: string; amount?: number };
  ctx.note({ subscriptionId: subId, userId: res.user_id ?? null, amountPaise: res.amount ?? input.cashPaise + input.upiPaise, ref: res.payment_id,
    details: { cash: input.cashPaise, upi: input.upiPaise, upi_reference: input.upiReference, paid_on: input.paidOn, cash_report: cashReportId, duplicate: res.duplicate } });
  if (res.duplicate) return { ok: true, message: "Already recorded.", paymentId: res.payment_id };
  if (res.user_id) {
    const uid = res.user_id;
    background(async () => notifyEvent("cash_received", [await recipient(uid)], { amount: rupees(res.amount ?? 0), cash_due: rupees(0) }));
  }
  const parts = [input.cashPaise > 0 ? `${rupees(input.cashPaise)} cash` : null, input.upiPaise > 0 ? `${rupees(input.upiPaise)} UPI` : null].filter(Boolean);
  return { ok: true, message: `${parts.join(" + ")} recorded — all cash collected.`, paymentId: res.payment_id };
}

/** Money back to the bank through Cashfree (admin-refund edge function). */
export async function bankRefund(ctx: SensitiveCtx, paymentId: string, amountPaise: number, reason: string):
  Promise<{ ok: true; refundId: string; userId: string; status: string } | { ok: false; error: string }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/admin-refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INTERNAL_FN_SECRET}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payment_id: paymentId, amount_paise: amountPaise, reason: reason.trim(), admin_user_id: ctx.admin.id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) return { ok: false, error: body?.error ?? `Refund failed (${res.status}).` };
  ctx.note({ userId: body.user_id, amountPaise, ref: body.refund_id, details: { payment_id: paymentId, status: body.status, reason } });
  return { ok: true, refundId: body.refund_id, userId: body.user_id, status: body.status };
}

export type SettleInput = {
  decision: "keep" | "forfeit" | "refund_offline" | "refund_bank";
  amountPaise: number;
  reason: string;
  /** refund_offline */
  method?: "cash" | "upi" | "bank_transfer";
  reference?: string;
  /** refund_bank: the Cashfree payment to refund against */
  paymentId?: string;
  /** One-time key from the dialog (107): a repeated submit changes nothing. */
  idempotencyKey?: string;
};

/**
 * What happens to a customer's wallet when their plan ends without a new one:
 * keep it as credit (still owed to them), refund it (Cashfree or outside it,
 * with proof) or forfeit it (GreenFeast's, with a reason). Always recorded in
 * balance_decisions.
 */
export async function settleBalance(ctx: SensitiveCtx, userId: string, subId: string | null, input: SettleInput): Promise<MoneyResult> {
  const reason = (input.reason ?? "").trim();
  if (!reason) return { ok: false, error: "Add a reason." };
  ctx.note({ userId, subscriptionId: subId, amountPaise: input.amountPaise, details: { decision: input.decision, reason, method: input.method, reference: input.reference } });

  let refundId: string | null = null;
  if (input.decision === "refund_offline") {
    const { data, error } = await supabaseAdmin.rpc("admin_refund_offline", {
      p_user: userId, p_amount: input.amountPaise, p_method: input.method ?? "", p_reference: input.reference ?? "",
      p_reason: reason, p_admin: ctx.admin.id, p_action: ctx.actionId,
      p_idem: input.idempotencyKey ? `${input.idempotencyKey}:refund` : null,
    });
    if (error) return { ok: false, error: dbError(error, "Could not record the refund.") };
    refundId = data as string;
  } else if (input.decision === "refund_bank") {
    if (!input.paymentId) return { ok: false, error: "Pick the Cashfree payment to refund." };
    const r = await bankRefund(ctx, input.paymentId, input.amountPaise, reason);
    if (!r.ok) return r;
    refundId = r.refundId;
  }

  const { error } = await supabaseAdmin.rpc("admin_settle_balance", {
    p_user: userId, p_sub: subId, p_decision: input.decision, p_amount: input.amountPaise, p_reason: reason,
    p_refund: refundId, p_admin: ctx.admin.id, p_action: ctx.actionId,
    p_idem: input.idempotencyKey ? `${input.idempotencyKey}:settle` : null,
  });
  if (error) return { ok: false, error: dbError(error, "Could not record the decision.") };

  const who = [await recipient(userId)];
  if (input.decision === "refund_bank") await notifyEvent("refund_bank_started", who, { amount: rupees(input.amountPaise) });
  return {
    ok: true,
    message:
      input.decision === "keep" ? "Kept in the wallet as credit for their next plan."
      : input.decision === "forfeit" ? `${rupees(input.amountPaise)} forfeited and recorded.`
      : input.decision === "refund_offline" ? `${rupees(input.amountPaise)} refund recorded.`
      : `${rupees(input.amountPaise)} refund sent to Cashfree.`,
  };
}

/** Cashfree payments of this customer that can still be refunded. */
export async function refundablePayments(userId: string) {
  const [{ data: pays }, { data: refunds }] = await Promise.all([
    supabaseAdmin.from("payments").select("id, amount, created_at, cf_order_id")
      .eq("user_id", userId).eq("status", "paid").not("cf_payment_id", "is", null).order("created_at", { ascending: false }),
    supabaseAdmin.from("refunds").select("payment_id, amount, status").eq("user_id", userId).eq("kind", "bank"),
  ]);
  return (pays ?? []).map((p) => {
    const done = (refunds ?? []).filter((r) => r.payment_id === p.id && r.status !== "failed").reduce((s, r) => s + r.amount, 0);
    return { id: p.id as string, amount: p.amount as number, refundable: Math.max(p.amount - done, 0), createdAt: p.created_at as string };
  }).filter((p) => p.refundable > 0);
}
