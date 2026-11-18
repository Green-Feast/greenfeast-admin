"use client"

// How a payment the office took was made, with its proof — required by the
// database for every payment outside Cashfree (migration 092). Used when
// onboarding a customer with money, activating a pending plan, and adding
// proof to a payment recorded before the audit.

import { istToday } from "@/lib/ist"
import { OFFLINE_METHODS, rupees } from "@/lib/money-labels"

export type ProofInput = {
  method: "" | "cash" | "upi" | "cash_upi" | "bank_transfer" | "previous_records"
  cashPaise: number
  upiPaise: number
  reference: string
  paidOn: string
  note: string
}

export const emptyProof = (): ProofInput => ({ method: "", cashPaise: 0, upiPaise: 0, reference: "", paidOn: istToday(), note: "" })

/** null = fine; otherwise what's missing. */
export function proofProblem(p: ProofInput, amountPaise: number): string | null {
  if (amountPaise <= 0) return null
  if (!p.method) return "Pick how it was paid."
  if (!p.paidOn || p.paidOn > istToday()) return "Give the day it was paid (not in the future)."
  if (p.method === "cash_upi") {
    if (p.cashPaise <= 0 || p.upiPaise <= 0) return "Enter both the cash and the UPI part."
    if (p.cashPaise + p.upiPaise !== amountPaise) return `Cash ${rupees(p.cashPaise)} + UPI ${rupees(p.upiPaise)} must equal ${rupees(amountPaise)}.`
  }
  if (p.method !== "cash" && p.reference.trim().length < 3) {
    return p.method === "previous_records"
      ? "Add the earlier record's reference (receipt no., sheet row, invoice)."
      : "Add the proof reference (UPI UTR / transfer reference)."
  }
  return null
}

const inputCls = "w-full h-10 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
const toPaise = (s: string) => Math.round((parseFloat(s) || 0) * 100)

export function PaymentProofFields({ value, onChange, amountPaise, title = "How was it paid?" }: {
  value: ProofInput
  onChange: (p: ProofInput) => void
  amountPaise: number
  title?: string
}) {
  const set = (patch: Partial<ProofInput>) => onChange({ ...value, ...patch })
  const problem = proofProblem(value, amountPaise)
  const refLabel =
    value.method === "previous_records" ? "Earlier record reference" :
    value.method === "bank_transfer" ? "Transfer reference (UTR)" :
    value.method === "cash" ? "Receipt no. / who collected (optional)" : "UPI reference (UTR)"

  return (
    <div className="rounded-xl border border-[#e2e8d5] bg-[#F9FBF7] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[#1A1A1A]">{title}</p>
        <span className="text-xs text-gray-500">{rupees(amountPaise)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={value.method} onChange={(e) => set({ method: e.target.value as ProofInput["method"] })} className={`${inputCls} col-span-2`}>
          <option value="">Pick how it was paid…</option>
          {OFFLINE_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        {value.method === "cash_upi" && (
          <>
            <input inputMode="decimal" placeholder="Cash ₹" defaultValue={value.cashPaise ? value.cashPaise / 100 : ""} onChange={(e) => set({ cashPaise: toPaise(e.target.value) })} className={inputCls} />
            <input inputMode="decimal" placeholder="UPI ₹" defaultValue={value.upiPaise ? value.upiPaise / 100 : ""} onChange={(e) => set({ upiPaise: toPaise(e.target.value) })} className={inputCls} />
          </>
        )}
        <input placeholder={refLabel} value={value.reference} onChange={(e) => set({ reference: e.target.value })} className={`${inputCls} col-span-2`} />
        <label className="col-span-2 text-xs text-gray-500 -mb-1">Paid on</label>
        <input type="date" max={istToday()} value={value.paidOn} onChange={(e) => set({ paidOn: e.target.value })} className={inputCls} />
        <input placeholder="Note (optional)" value={value.note} onChange={(e) => set({ note: e.target.value })} className={inputCls} />
      </div>
      {problem && <p className="text-xs text-amber-700">{problem}</p>}
    </div>
  )
}
