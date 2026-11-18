"use client"

// What happens to a customer's wallet when their plan ends without a new one
// (migration 092, admin_settle_balance): keep it as credit, refund it, or
// forfeit it. Used by the subscriber's Cancel dialog and Money → Checks.

import { fmtDate, rupees } from "@/lib/money-labels"

export type RefundablePayment = { id: string; amount: number; refundable: number; createdAt: string }

export type SettleValue = {
  decision: "" | "keep" | "forfeit" | "refund_offline" | "refund_bank"
  amountPaise: number
  reason: string
  method: "" | "cash" | "upi" | "bank_transfer"
  reference: string
  paymentId: string
}

export const emptySettle = (): SettleValue => ({ decision: "", amountPaise: 0, reason: "", method: "", reference: "", paymentId: "" })

export function settleProblem(v: SettleValue, balance: number, payments: RefundablePayment[]): string | null {
  if (!v.decision) return "Choose what happens to the balance."
  if (!v.reason.trim()) return "Add a reason."
  if (v.decision === "keep") return null
  if (v.amountPaise <= 0) return "Enter the amount."
  if (v.amountPaise > balance) return `The wallet only has ${rupees(balance)}.`
  if (v.decision === "refund_offline") {
    if (!v.method) return "Pick how it was refunded."
    if (v.method !== "cash" && v.reference.trim().length < 3) return "Add the UPI / transfer reference."
  }
  if (v.decision === "refund_bank") {
    const p = payments.find((x) => x.id === v.paymentId)
    if (!p) return "Pick the Cashfree payment to refund."
    if (v.amountPaise > p.refundable) return `At most ${rupees(p.refundable)} can be refunded on that payment.`
  }
  return null
}

/** Shape the server action takes (lib/money-ops SettleInput). */
export function toSettleInput(v: SettleValue) {
  return {
    decision: v.decision as "keep" | "forfeit" | "refund_offline" | "refund_bank",
    amountPaise: v.decision === "keep" ? 0 : v.amountPaise,
    reason: v.reason.trim(),
    method: v.method || undefined,
    reference: v.reference.trim() || undefined,
    paymentId: v.paymentId || undefined,
  } as const
}

const inputCls = "w-full h-10 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"

const OPTIONS: { value: SettleValue["decision"]; label: string; hint: string }[] = [
  { value: "keep", label: "Keep as credit", hint: "Stays in their wallet for a future plan — still owed to them." },
  { value: "refund_bank", label: "Refund to their bank (Cashfree)", hint: "Back to the UPI / card they paid with." },
  { value: "refund_offline", label: "Refunded outside Cashfree", hint: "You paid it back in cash, UPI or a bank transfer." },
  { value: "forfeit", label: "Forfeit", hint: "GreenFeast keeps it (per policy) — needs a reason." },
]

export function SettleBalanceFields({ value, onChange, balance, payments }: {
  value: SettleValue
  onChange: (v: SettleValue) => void
  balance: number
  payments: RefundablePayment[]
}) {
  const set = (patch: Partial<SettleValue>) => onChange({ ...value, ...patch })
  const problem = settleProblem(value, balance, payments)
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-3">
      <p className="text-sm text-amber-900">
        The wallet has <strong>{rupees(balance)}</strong>. Decide what happens to it — this is recorded for the accounts.
      </p>
      <div className="space-y-1.5">
        {OPTIONS.filter((o) => o.value !== "refund_bank" || payments.length > 0).map((o) => (
          <label key={o.value} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${value.decision === o.value ? "border-[#1B5E20] bg-white" : "border-transparent hover:bg-white/70"}`}>
            <input
              type="radio"
              name="settle"
              className="mt-1"
              checked={value.decision === o.value}
              onChange={() => set({ decision: o.value, amountPaise: o.value === "keep" ? 0 : value.amountPaise || balance, paymentId: o.value === "refund_bank" ? (payments[0]?.id ?? "") : value.paymentId })}
            />
            <span>
              <span className="block text-sm font-medium text-[#1A1A1A]">{o.label}</span>
              <span className="block text-xs text-gray-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {value.decision && value.decision !== "keep" && (
        <input
          inputMode="decimal"
          defaultValue={(value.amountPaise || balance) / 100}
          onChange={(e) => set({ amountPaise: Math.round((parseFloat(e.target.value) || 0) * 100) })}
          placeholder="Amount ₹"
          className={inputCls}
        />
      )}
      {value.decision === "refund_bank" && (
        <select value={value.paymentId} onChange={(e) => set({ paymentId: e.target.value })} className={inputCls}>
          {payments.map((p) => (
            <option key={p.id} value={p.id}>{fmtDate(p.createdAt)} · paid {rupees(p.amount)} · up to {rupees(p.refundable)}</option>
          ))}
        </select>
      )}
      {value.decision === "refund_offline" && (
        <div className="grid grid-cols-2 gap-2">
          <select value={value.method} onChange={(e) => set({ method: e.target.value as SettleValue["method"] })} className={inputCls}>
            <option value="">How?</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank_transfer">Bank transfer</option>
          </select>
          <input value={value.reference} onChange={(e) => set({ reference: e.target.value })} placeholder={value.method === "cash" ? "Receipt / note (optional)" : "UTR / reference"} className={inputCls} />
        </div>
      )}
      {value.decision && (
        <input value={value.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="Reason (kept in the records)" className={inputCls} />
      )}
      {problem && value.decision && <p className="text-xs text-amber-700">{problem}</p>}
    </div>
  )
}
