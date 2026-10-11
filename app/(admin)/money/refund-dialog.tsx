"use client";

import { useMemo, useState, useTransition } from "react";
import { X, Search, Wallet, Landmark, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { refundToWallet, refundToBank } from "./actions";

export type RefundCustomer = { id: string; name: string; phone: string; code: string; balance: number };
export type RefundablePayment = {
  id: string;
  userId: string;
  amount: number;
  refundable: number;
  kind: "plan" | "top-up";
  createdAt: string;
  cfPaymentId: string | null;
};

const REASONS = [
  "Meal not delivered",
  "Major quality issue",
  "Wrong item delivered",
  "Item missing",
  "Duplicate payment",
  "Plan cancelled",
];

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function RefundDialog({
  customers,
  payments,
  onClose,
}: {
  customers: RefundCustomer[];
  payments: RefundablePayment[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [kind, setKind] = useState<"wallet" | "bank">("wallet");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const customer = customers.find((c) => c.id === userId) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.code.toLowerCase().includes(q))
      .slice(0, 8);
  }, [customers, query]);

  const userPayments = payments.filter((p) => p.userId === userId && p.refundable > 0);
  const selectedPayment = userPayments.find((p) => p.id === paymentId) ?? null;
  const amountPaise = Math.round((parseFloat(amount) || 0) * 100);
  // Bank refunds come out of unspent wallet money, and never exceed what's
  // left to refund on that payment.
  const maxBank = selectedPayment ? Math.min(selectedPayment.refundable, Math.max(customer?.balance ?? 0, 0)) : 0;

  const problem =
    !customer ? "Pick a customer."
    : amountPaise <= 0 ? "Enter an amount."
    : !reason.trim() ? "Add a reason — the customer sees it."
    : kind === "bank" && !selectedPayment ? "Pick the payment to refund."
    : kind === "bank" && amountPaise > maxBank ? `At most ${rupees(maxBank)} can go back to the bank.`
    : null;

  function pickCustomer(id: string) {
    setUserId(id);
    setQuery("");
    setPaymentId(null);
    setResult(null);
  }

  function submit() {
    if (problem || !customer) return;
    if (kind === "bank" && !window.confirm(
      `Refund ${rupees(amountPaise)} to ${customer.name}'s original payment method through Cashfree?\n\nThe same amount is deducted from their wallet.`
    )) return;
    setResult(null);
    startTransition(async () => {
      const r = kind === "wallet"
        ? await refundToWallet(customer.id, amountPaise, reason)
        : await refundToBank(selectedPayment!.id, amountPaise, reason);
      setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) {
        setAmount("");
        setReason("");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e2e8d5] px-5 py-4">
          <h2 className="text-lg font-bold text-[#1A1A1A]">Refund a customer</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* Customer */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Customer</p>
            {customer ? (
              <div className="flex items-center justify-between rounded-xl border border-[#e2e8d5] bg-[#F9FBF7] px-3 py-2.5">
                <div>
                  <p className="font-medium text-[#1A1A1A]">{customer.name}</p>
                  <p className="text-xs text-gray-500">
                    <span className="font-mono">{customer.code}</span> · {customer.phone || "no phone"} · wallet {rupees(customer.balance)}
                  </p>
                </div>
                <button onClick={() => setUserId(null)} className="text-xs font-medium text-[#1B5E20] hover:underline">
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, phone or GF-code…"
                  className="h-10 w-full rounded-lg border border-[#e2e8d5] pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                />
                {matches.length > 0 && (
                  <div className="mt-1 overflow-hidden rounded-lg border border-[#e2e8d5]">
                    {matches.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => pickCustomer(c.id)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-green-50"
                      >
                        <span>
                          <span className="font-medium text-[#1A1A1A]">{c.name}</span>{" "}
                          <span className="text-xs text-gray-400">{c.phone}</span>
                        </span>
                        <span className="font-mono text-xs text-gray-500">{c.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Where to */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Refund to</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["wallet", Wallet, "Wallet", "Store credit, instant"],
                ["bank", Landmark, "Bank / UPI", "Via Cashfree, 5–7 days"],
              ] as const).map(([k, Icon, label, hint]) => (
                <button
                  key={k}
                  onClick={() => { setKind(k); setResult(null); }}
                  className={cn(
                    "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left",
                    kind === k ? "border-[#1B5E20] bg-green-50" : "border-[#e2e8d5] hover:bg-gray-50"
                  )}
                >
                  <Icon className={cn("mt-0.5 h-4 w-4", kind === k ? "text-[#1B5E20]" : "text-gray-400")} />
                  <span>
                    <span className="block text-sm font-medium text-[#1A1A1A]">{label}</span>
                    <span className="block text-xs text-gray-500">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Payment (bank only) */}
          {kind === "bank" && customer && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Payment to refund</p>
              {userPayments.length === 0 ? (
                <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
                  No Cashfree payments left to refund for this customer. Cash payments can't go back through Cashfree —
                  use a wallet refund, or return the cash and deduct it by hand.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {userPayments.map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        "flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm",
                        paymentId === p.id ? "border-[#1B5E20] bg-green-50" : "border-[#e2e8d5] hover:bg-gray-50"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="refund-payment"
                          checked={paymentId === p.id}
                          onChange={() => setPaymentId(p.id)}
                          className="accent-[#1B5E20]"
                        />
                        <span>
                          <span className="font-medium capitalize text-[#1A1A1A]">{p.kind}</span>{" "}
                          {rupees(p.amount)} · {fmtDate(p.createdAt)}
                        </span>
                      </span>
                      <span className="text-xs text-gray-500">{rupees(p.refundable)} refundable</span>
                    </label>
                  ))}
                  {selectedPayment && (
                    <p className="text-xs text-gray-500">
                      Up to {rupees(maxBank)} — limited by what's left on this payment and the {rupees(customer.balance)} still in
                      the wallet.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Amount + reason */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Amount (₹)</p>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0"
              className="h-10 w-full rounded-lg border border-[#e2e8d5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Reason (shown to the customer)</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs",
                    reason === r ? "border-[#1B5E20] bg-green-50 text-[#1B5E20]" : "border-[#e2e8d5] text-gray-600 hover:bg-gray-50"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder="e.g. Lunch on 12 Oct not delivered"
              className="w-full rounded-lg border border-[#e2e8d5] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
          </div>

          {result && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
              result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
            )}>
              {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              {result.text}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#e2e8d5] px-5 py-4">
          <p className="text-xs text-gray-400">{problem ?? "The customer gets a push and an in-app notification."}</p>
          <button
            onClick={submit}
            disabled={!!problem || pending}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-[#1B5E20] px-4 py-2 text-sm font-medium text-white hover:bg-[#0D3F12] disabled:opacity-40"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {amountPaise > 0 ? `Refund ${rupees(amountPaise)}` : "Refund"}
          </button>
        </div>
      </div>
    </div>
  );
}
