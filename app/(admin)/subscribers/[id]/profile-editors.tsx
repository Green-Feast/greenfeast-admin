"use client"

// Edit dialogs for the subscriber profile — everything a customer can tell
// us on WhatsApp, the admin can now set here: details, plan, food
// preferences, addresses, wallet, cash-on-delivery, fixed dishes. (Wallet money only moves through payments,
// gifts, referrals and refunds — no manual wallet adjustment. Add paid meals
// (099) is a payment with proof, always meals × the plan's meal price.)

import { planMealRate } from "@/lib/pricing"
import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { istToday } from "@/lib/ist"
import { PaymentProofFields, emptyProof, proofProblem, type ProofInput } from "@/components/payment-proof"

// ── Shared UI ─────────────────────────────────────────────────────────────

export const inputCls = "w-full h-10 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] transition-colors"

export function ModalOverlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn("relative z-10 w-full max-h-[90vh] overflow-y-auto rounded-2xl", wide ? "max-w-2xl" : "max-w-md")}>{children}</div>
    </div>
  )
}

export function ModalCard({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="bg-white rounded-2xl shadow-2xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[#1A1A1A]">{title}</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  )
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-3 pt-1">{children}</div>
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

export function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex-1 h-10 rounded-xl border border-[#e2e8d5] text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
      {children}
    </button>
  )
}

export function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex-1 h-10 rounded-xl bg-[#1B5E20] text-sm font-medium text-white hover:bg-[#155116] disabled:opacity-40 transition-colors">
      {children}
    </button>
  )
}

export function DangerBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex-1 h-10 rounded-xl bg-red-600 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 transition-colors">
      {children}
    </button>
  )
}

function Chips({ options, value, onChange, single }: {
  options: { value: string; label: string }[]
  value: string[]
  onChange: (v: string[]) => void
  single?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(single ? (on ? [] : [o.value]) : on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            className={cn(
              "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
              on ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "bg-white text-gray-600 border-[#e2e8d5] hover:bg-gray-50"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Stepper({ value, setValue, min = 0, max = 10 }: { value: number; setValue: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => setValue(Math.max(min, value - 1))} className="w-9 h-9 rounded-lg border border-[#e2e8d5] hover:bg-gray-50">−</button>
      <span className="w-8 text-center text-sm font-semibold">{value}</span>
      <button type="button" onClick={() => setValue(Math.min(max, value + 1))} className="w-9 h-9 rounded-lg border border-[#e2e8d5] hover:bg-gray-50">+</button>
    </div>
  )
}

const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }))
const rupeesToPaise = (s: string) => Math.round((parseFloat(s) || 0) * 100)
export const fmtRupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

// ── Customer details ──────────────────────────────────────────────────────

export function IdentityModal({ initial, pending, onClose, onSave }: {
  initial: { name: string; phone: string; email: string }
  pending: boolean
  onClose: () => void
  onSave: (v: { name: string; phone: string; email: string }) => void
}) {
  const [name, setName] = useState(initial.name)
  const [phone, setPhone] = useState(initial.phone.replace(/^\+91/, ""))
  const [email, setEmail] = useState(initial.email)
  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard title="Customer details" onClose={onClose}>
        <div className="space-y-4">
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
          <Field label="Mobile"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="10 digits" /></Field>
          <Field label="Email (login)" hint="Changing it changes how they sign in with email and password.">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending || !name.trim()} onClick={() => onSave({ name, phone, email })}>Save</PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Plan ──────────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
// A plan with no saved days means every day the kitchen cooks — Mon to Sat.
// Sunday is the day off; the office ticks it only on purpose (083).
const WEEKDAYS: string[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export type PlanFormValue = {
  planId: string
  mealsLunch: number
  mealsDinner: number
  days: string[]
  addonIds: string[]
  startDate: string | null
  mealsLeft: number
}

export function PlanModal({ initial, noDeliveryDays, plans, addons, pending, onClose, onSave }: {
  initial: PlanFormValue
  // The plan has chosen no delivery days (089): no days selected, instead of
  // the every-day display an empty schedule gets.
  noDeliveryDays: boolean
  plans: { id: string; name: string; base_price: number; meals_total: number }[]
  addons: { id: string; name: string; price_per_meal: number }[]
  pending: boolean
  onClose: () => void
  onSave: (v: PlanFormValue) => void
}) {
  const [v, setV] = useState<PlanFormValue>({ ...initial, days: initial.days.length || noDeliveryDays ? initial.days : [...WEEKDAYS] })
  const set = <K extends keyof PlanFormValue>(k: K, val: PlanFormValue[K]) => setV((p) => ({ ...p, [k]: val }))
  return (
    <ModalOverlay onClose={onClose} wide>
      <ModalCard title="Plan settings" onClose={onClose}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan">
              <select value={v.planId} onChange={(e) => set("planId", e.target.value)} className={inputCls}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.meals_total} meals · ₹{(planMealRate(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/meal
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Meals left" hint="Follows their wallet — use Add meals to give more.">
              <p className="px-3 py-2 text-sm text-gray-600">about {v.mealsLeft}</p>
            </Field>
          </div>
          <Field
            label="Delivery days"
            hint={v.days.length === 0
              ? "No delivery days: upcoming deliveries are removed and none are scheduled. The customer can still walk in or add a meal on any day."
              : undefined}
          >
            <Chips options={opts(DAYS)} value={v.days} onChange={(d) => set("days", DAYS.filter((x) => d.includes(x)))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lunches per day"><Stepper value={v.mealsLunch} setValue={(n) => set("mealsLunch", n)} /></Field>
            <Field label="Dinners per day"><Stepper value={v.mealsDinner} setValue={(n) => set("mealsDinner", n)} /></Field>
          </div>
          <Field label="Add-ons with every meal">
            <Chips
              options={addons.map((a) => ({ value: a.id, label: `${a.name} +${fmtRupees(a.price_per_meal)}` }))}
              value={v.addonIds}
              onChange={(ids) => set("addonIds", ids)}
            />
          </Field>
          <Field label="First delivery date" hint="Nothing is scheduled before it.">
            <input type="date" value={v.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} className={inputCls} />
          </Field>
          <p className="text-xs text-gray-500 bg-[#F9FBF7] border border-[#e2e8d5] rounded-lg p-3">
            Upcoming meals follow these settings straight away. Days or slots taken off are removed, portions and add-ons
            change, and new days are scheduled. Meals the customer changed for a particular day stay as they set them.
            The wallet isn&apos;t touched — adjust it separately if the price changes.
          </p>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending || v.mealsLunch + v.mealsDinner < 1} onClick={() => onSave(v)}>
            {pending ? "Saving…" : "Save plan"}
          </PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Food preferences ──────────────────────────────────────────────────────

const ALLERGENS = ["Peanuts", "Shellfish", "Dairy", "Sesame", "Soy", "Nuts", "Gluten", "Egg"] as const
const PROTEINS = ["Paneer", "Tofu"] as const
const BASES = ["Quinoa", "Couscous", "Rice", "Pasta", "Soba noodles"] as const
const VEGGIES = ["Bell pepper", "Mushroom", "Broccoli", "Onion"] as const
const GOALS = [
  { value: "build-muscle", label: "Muscle building" },
  { value: "lose-weight", label: "Weight loss" },
  { value: "improve-wellness", label: "Wellness" },
  { value: "boost-energy", label: "Energy" },
]

export type DietaryValue = {
  dietary_preference: string | null
  health_goal: string | null
  allergens: string[]
  protein_preference: string[]
  base_avoidance: string[]
  veggie_avoidance: string[]
  spice_preference: string | null
  dressing_preference: string | null
  free_text: string | null
}

// Lists are open-ended: anything already on the profile (or typed in "Other")
// shows as a chip too.
function withExtras(base: readonly string[], current: string[]) {
  return [...base, ...current.filter((c) => !base.includes(c))]
}

export function DietaryModal({ initial, pending, onClose, onSave }: {
  initial: DietaryValue
  pending: boolean
  onClose: () => void
  onSave: (v: DietaryValue) => void
}) {
  const [v, setV] = useState<DietaryValue>(initial)
  const [otherAvoid, setOtherAvoid] = useState("")
  const set = <K extends keyof DietaryValue>(k: K, val: DietaryValue[K]) => setV((p) => ({ ...p, [k]: val }))
  return (
    <ModalOverlay onClose={onClose} wide>
      <ModalCard title="Food preferences & constraints" onClose={onClose}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Diet">
              <select value={v.dietary_preference ?? "none"} onChange={(e) => set("dietary_preference", e.target.value)} className={inputCls}>
                <option value="none">No restriction</option>
                <option value="vegetarian">Vegetarian</option>
                <option value="vegan">Vegan</option>
              </select>
            </Field>
            <Field label="Goal">
              <select value={v.health_goal ?? ""} onChange={(e) => set("health_goal", e.target.value || null)} className={inputCls}>
                <option value="">—</option>
                {GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Allergies">
            <Chips options={opts(withExtras(ALLERGENS, v.allergens))} value={v.allergens} onChange={(x) => set("allergens", x)} />
          </Field>
          <Field label="Preferred protein">
            <Chips options={opts(withExtras(PROTEINS, v.protein_preference))} value={v.protein_preference} onChange={(x) => set("protein_preference", x)} />
          </Field>
          <Field label="Bases to avoid">
            <Chips options={opts(withExtras(BASES, v.base_avoidance))} value={v.base_avoidance} onChange={(x) => set("base_avoidance", x)} />
          </Field>
          <Field label="Veggies / ingredients to avoid">
            <Chips options={opts(withExtras(VEGGIES, v.veggie_avoidance))} value={v.veggie_avoidance} onChange={(x) => set("veggie_avoidance", x)} />
            <div className="flex gap-2 mt-2">
              <input value={otherAvoid} onChange={(e) => setOtherAvoid(e.target.value)} placeholder="Other (e.g. garlic)" className={inputCls} />
              <button
                type="button"
                onClick={() => {
                  const x = otherAvoid.trim()
                  if (x && !v.veggie_avoidance.includes(x)) set("veggie_avoidance", [...v.veggie_avoidance, x])
                  setOtherAvoid("")
                }}
                className="px-3 rounded-lg border border-[#e2e8d5] text-sm hover:bg-gray-50"
              >
                Add
              </button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Spice">
              <Chips single options={opts(["Mild", "Medium", "Spicy"])} value={v.spice_preference ? [v.spice_preference] : []} onChange={(x) => set("spice_preference", x[0] ?? null)} />
            </Field>
            <Field label="Dressing">
              <Chips
                single
                options={[{ value: "mixed-in", label: "Mixed in" }, { value: "on-the-side", label: "On the side" }]}
                value={v.dressing_preference ? [v.dressing_preference] : []}
                onChange={(x) => set("dressing_preference", x[0] ?? null)}
              />
            </Field>
          </div>
          <Field label="Anything else the kitchen should know">
            <textarea
              value={v.free_text ?? ""}
              onChange={(e) => set("free_text", e.target.value)}
              rows={3}
              placeholder="e.g. no raw onion, extra sauce, less salt"
              className={cn(inputCls, "h-auto py-2 resize-none")}
            />
          </Field>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending} onClick={() => onSave(v)}>{pending ? "Saving…" : "Save"}</PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Address ───────────────────────────────────────────────────────────────

export type AddressFormValue = { id?: string; label: string; type: string; line1: string; line2: string; landmark: string; pincode: string; timeWindow: string }

export function AddressModal({ initial, pending, onClose, onSave }: {
  initial: AddressFormValue
  pending: boolean
  onClose: () => void
  onSave: (v: AddressFormValue) => void
}) {
  const [v, setV] = useState(initial)
  const set = <K extends keyof AddressFormValue>(k: K, val: AddressFormValue[K]) => setV((p) => ({ ...p, [k]: val }))
  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard title={initial.id ? "Edit address" : "Add address"} onClose={onClose}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label"><input value={v.label} onChange={(e) => set("label", e.target.value)} placeholder="Home / Office" className={inputCls} /></Field>
            <Field label="Type">
              <select value={v.type} onChange={(e) => set("type", e.target.value)} className={inputCls}>
                <option value="home">Home</option>
                <option value="office">Office / Work</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <Field label="Address line 1">
            <textarea value={v.line1} onChange={(e) => set("line1", e.target.value)} rows={2} placeholder="House / flat no., building, street" className={cn(inputCls, "h-auto py-2 resize-none")} />
          </Field>
          <Field label="Address line 2"><input value={v.line2} onChange={(e) => set("line2", e.target.value)} placeholder="Area, colony, sector" className={inputCls} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Landmark"><input value={v.landmark} onChange={(e) => set("landmark", e.target.value)} className={inputCls} /></Field>
            <Field label="Pincode"><input value={v.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="302…" className={inputCls} /></Field>
            <Field label="City"><input value="Jaipur" disabled className={cn(inputCls, "bg-gray-50 text-gray-500")} /></Field>
          </div>
          <Field label="Delivery time window"><input value={v.timeWindow} onChange={(e) => set("timeWindow", e.target.value)} placeholder="e.g. 12:30–1:30" className={inputCls} /></Field>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending || !v.line1.trim() || !/^\d{6}$/.test(v.pincode)} onClick={() => onSave(v)}>{pending ? "Saving…" : "Save address"}</PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Cash on delivery ──────────────────────────────────────────────────────
// The money a cash-on-delivery customer hands over: some in cash, some by
// UPI on our QR. The two must add up exactly to what's due (migration 092),
// and the UPI part needs its reference (UTR).

export type CodValue = { cashPaise: number; upiPaise: number; upiReference: string; paidOn: string; note: string; idempotencyKey: string }

export function CashModal({ due, report, pending, onClose, onRecord, onSetDue }: {
  due: number
  /** A partner's report being recorded: prefills the cash part. */
  report?: { amount: number; partner: string } | null
  pending: boolean
  onClose: () => void
  onRecord: (v: CodValue) => void
  onSetDue: (duePaise: number, onCredit: boolean, reason: string) => void
}) {
  const startCash = report ? Math.min(report.amount, due) : due
  const [cash, setCash] = useState(String(startCash / 100))
  const [upi, setUpi] = useState(due - startCash > 0 ? String((due - startCash) / 100) : "")
  const [upiRef, setUpiRef] = useState("")
  const [paidOn, setPaidOn] = useState(istToday())
  const [note, setNote] = useState(report ? `Collected by ${report.partner}` : "")
  const [key] = useState(() => crypto.randomUUID())
  const [newDue, setNewDue] = useState(String(due / 100))
  const [onCredit, setOnCredit] = useState(true)
  const [dueReason, setDueReason] = useState("")
  const cashPaise = rupeesToPaise(cash)
  const upiPaise = rupeesToPaise(upi)
  const sum = cashPaise + upiPaise
  const problem =
    sum !== due ? `Cash ${fmtRupees(cashPaise)} + UPI ${fmtRupees(upiPaise)} = ${fmtRupees(sum)} — it must be exactly ${fmtRupees(due)}.`
    : upiPaise > 0 && upiRef.trim().length < 3 ? "Add the UPI reference (UTR) for the UPI part."
    : !paidOn || paidOn > istToday() ? "Give the day it was paid."
    : null
  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard title={report ? `Record ${report.partner}'s collection` : "Cash on delivery"} onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Due: <span className="font-semibold text-[#1A1A1A]">{fmtRupees(due)}</span>
            {report && <> · partner reported <span className="font-semibold">{fmtRupees(report.amount)}</span></>}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cash (₹)">
              <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))} className={inputCls} />
            </Field>
            <Field label="UPI to our QR (₹)">
              <input inputMode="decimal" value={upi} onChange={(e) => setUpi(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
            </Field>
          </div>
          {upiPaise > 0 && (
            <Field label="UPI reference (UTR)">
              <input value={upiRef} onChange={(e) => setUpiRef(e.target.value)} placeholder="12-digit UTR from the payment" className={inputCls} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid on"><input type="date" max={istToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputCls} /></Field>
            <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></Field>
          </div>
          {problem && <p className="text-xs text-amber-700">{problem}</p>}
          <PrimaryBtn disabled={pending || !!problem} onClick={() => onRecord({ cashPaise, upiPaise, upiReference: upiRef.trim(), paidOn, note: note.trim(), idempotencyKey: key })}>
            Record {fmtRupees(sum)} received
          </PrimaryBtn>
          {!report && (
            <div className="pt-3 border-t border-[#e2e8d5] space-y-2">
              <Field label="Or change what's due (₹)" hint="Lowering it without a payment writes money off — it's logged with your reason.">
                <input inputMode="decimal" value={newDue} onChange={(e) => setNewDue(e.target.value.replace(/[^\d.]/g, ""))} className={inputCls} />
              </Field>
              <input value={dueReason} onChange={(e) => setDueReason(e.target.value)} placeholder="Reason for the change" className={inputCls} />
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={onCredit} onChange={(e) => setOnCredit(e.target.checked)} className="accent-[#1B5E20]" />
                Keep delivering on credit until it&apos;s paid (the wallet may go negative)
              </label>
              <button
                disabled={pending || !dueReason.trim()}
                onClick={() => onSetDue(rupeesToPaise(newDue), onCredit, dueReason.trim())}
                className="w-full h-9 rounded-lg border border-[#e2e8d5] text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
              >
                Save amount due
              </button>
            </div>
          )}
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}

export function ActivateModal({ total, pending, onClose, onSave }: {
  total: number
  pending: boolean
  onClose: () => void
  onSave: (paidPaise: number, cashDuePaise: number, proof: ProofInput | null, idempotencyKey: string) => void
}) {
  const [paid, setPaid] = useState("")
  const [due, setDue] = useState("")
  const [proof, setProof] = useState<ProofInput>(emptyProof)
  const [key] = useState(() => crypto.randomUUID())
  const paidPaise = rupeesToPaise(paid)
  const duePaise = due.trim() ? rupeesToPaise(due) : Math.max(total - paidPaise, 0)
  const problem = paidPaise > 0 ? proofProblem(proof, paidPaise) : null
  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard title="Activate plan" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Plan price: <span className="font-semibold">{fmtRupees(total)}</span></p>
          <Field label="Paid so far (₹)" hint="Money you've received outside the app — it goes into the wallet with its proof. 0 is fine.">
            <input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
          </Field>
          {paidPaise > 0 && <PaymentProofFields value={proof} onChange={setProof} amountPaise={paidPaise} />}
          <Field label="Cash still to collect (₹)" hint="Meals run on credit until it's recorded.">
            <input inputMode="decimal" value={due} onChange={(e) => setDue(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(Math.max(total - paidPaise, 0) / 100)} className={inputCls} />
          </Field>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending || !!problem} onClick={() => onSave(paidPaise, duePaise, paidPaise > 0 ? proof : null, key)}>Activate</PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Fixed dish ────────────────────────────────────────────────────────────

const DAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]

export function FixedDishModal({ meals, pending, onClose, onSave }: {
  meals: { id: string; name: string; category: string }[]
  pending: boolean
  onClose: () => void
  onSave: (slot: "lunch" | "dinner", dayOfWeek: number | null, mealId: string) => void
}) {
  const [slot, setSlot] = useState<"lunch" | "dinner">("lunch")
  const [day, setDay] = useState<string>("every")
  const [meal, setMeal] = useState(meals[0]?.id ?? "")
  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard title="Same dish every day" onClose={onClose}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Meal">
              <select value={slot} onChange={(e) => setSlot(e.target.value as "lunch" | "dinner")} className={inputCls}>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
              </select>
            </Field>
            <Field label="Days">
              <select value={day} onChange={(e) => setDay(e.target.value)} className={inputCls}>
                <option value="every">Every day</option>
                {DAY_NAMES.map((d, i) => <option key={d} value={String(i)}>{d} only</option>)}
              </select>
            </Field>
          </div>
          <Field label="Dish">
            <select value={meal} onChange={(e) => setMeal(e.target.value)} className={inputCls}>
              {meals.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.category})</option>)}
            </select>
          </Field>
          <p className="text-xs text-gray-500">Every upcoming open meal changes now, and new ones are scheduled with this dish instead of the weekly menu.</p>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending || !meal} onClick={() => onSave(slot, day === "every" ? null : Number(day), meal)}>Save</PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Add paid meals (099) ──────────────────────────────────────────────────

export function AddPaidMealsModal({ mealUnit, pending, onClose, onSave }: {
  /** One meal of "meals left": the plan's meal with its add-ons and drink share. */
  mealUnit: number
  pending: boolean
  onClose: () => void
  onSave: (meals: number, collect: boolean, proof: ProofInput | null, reason: string, idempotencyKey: string, amountPaise: number | null) => void
}) {
  const [meals, setMeals] = useState(1)
  // Meals × the plan's meal price, or an amount — meals left follows the wallet (104).
  const [by, setBy] = useState<"meals" | "amount">("meals")
  const [amountText, setAmountText] = useState("")
  const [reason, setReason] = useState("")
  const [collect, setCollect] = useState(false)
  const [proof, setProof] = useState<ProofInput>(emptyProof)
  const [key] = useState(() => crypto.randomUUID())
  const amount = by === "amount" ? rupeesToPaise(amountText) : mealUnit * meals
  const problem =
    mealUnit <= 0 ? "This plan has no meal price." :
    by === "amount" && amount < 100 ? "Enter an amount." :
    reason.trim().length < 3 ? "Write why these meals are being added." :
    collect ? null : proofProblem(proof, amount)
  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard title="Add paid meals or money" onClose={onClose}>
        <div className="space-y-4">
          <Field label="Add">
            <Chips
              single
              options={[{ value: "meals", label: "Meals" }, { value: "amount", label: "Amount (₹)" }]}
              value={[by]}
              onChange={(v) => setBy(v[0] === "amount" ? "amount" : "meals")}
            />
          </Field>
          {by === "meals" ? (
            <>
              <Field label="Meals">
                <Stepper value={meals} setValue={setMeals} min={1} max={90} />
              </Field>
              <div className="rounded-xl bg-[#F9FBF7] border border-[#e2e8d5] px-3 py-2.5 text-sm">
                <p>
                  {meals} × {fmtRupees(mealUnit)} = <span className="font-semibold">{fmtRupees(amount)}</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">The plan&apos;s meal price, with its add-ons and drink.</p>
              </div>
            </>
          ) : (
            <>
              <Field label="Amount (₹)">
                <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ""))} placeholder="₹" className={inputCls} />
              </Field>
              <div className="rounded-xl bg-[#F9FBF7] border border-[#e2e8d5] px-3 py-2.5 text-sm">
                <p>≈ {mealUnit > 0 ? Math.floor(amount / mealUnit) : 0} meals at {fmtRupees(mealUnit)} a meal</p>
                <p className="text-xs text-gray-500 mt-0.5">Meals left follows the wallet — the rest stays in it for add-ons and extras.</p>
              </div>
            </>
          )}
          <Field label="Payment">
            <Chips
              single
              options={[{ value: "received", label: "Received" }, { value: "collect", label: "Cash to collect" }]}
              value={[collect ? "collect" : "received"]}
              onChange={(v) => setCollect(v[0] === "collect")}
            />
          </Field>
          {collect ? (
            <p className="text-xs text-gray-500">Added to the cash to collect — the meals run on credit until you record the cash.</p>
          ) : (
            <PaymentProofFields value={proof} onChange={setProof} amountPaise={amount} />
          )}
          <Field label="Reason (required)" hint="Kept in the admin log and on the wallet entry.">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Paid ₹1,296 on WhatsApp for 4 more meals before renewing"
              className="w-full rounded-lg border border-[#e2e8d5] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
          </Field>
          {reason.trim().length < 3 && <p className="text-xs text-amber-700">Write why these meals are being added.</p>}
          <p className="text-xs text-gray-400">Free meals (a trial, a goodwill gesture) go through Gift meals in Rewards instead. You'll be asked for your action password.</p>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending || !!problem} onClick={() => onSave(meals, collect, collect ? null : proof, reason.trim(), key, by === "amount" ? amount : null)}>
            {by === "amount" ? `Add ${fmtRupees(amount)}` : `Add ${meals} meal${meals === 1 ? "" : "s"}`}
          </PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Record a delivery (099) ───────────────────────────────────────────────

type RecordRow = { kind: "meal" | "drink"; dish: string; qty: number; addons: Record<string, number> }

export type RecordDeliveryValue = {
  date: string
  slot: "lunch" | "dinner"
  mode: "delivery" | "dine_in" | "pickup"
  addressId: string | null
  locationId: string | null
  reason: string
  items: { kind: "meal" | "drink"; dish: string; qty: number; addons: { id: string; qty: number }[] }[]
}

export function RecordDeliveryModal({
  meals, drinks, addons, addresses, locations, mealRate, drinkPrice, premium, walletBalance, pending, onClose, onSave,
}: {
  meals: { id: string; name: string; category: string }[]
  drinks: { id: string; name: string; category: string }[]
  addons: { id: string; name: string; price_per_meal: number }[]
  addresses: { id: string; label: string | null; type: string | null; line1: string | null; is_default: boolean }[]
  locations: { id: string; name: string }[]
  mealRate: number
  drinkPrice: number
  premium: Record<string, number>
  walletBalance: number
  pending: boolean
  onClose: () => void
  onSave: (v: RecordDeliveryValue) => void
}) {
  const today = istToday()
  const [date, setDate] = useState(today)
  const [slot, setSlot] = useState<"lunch" | "dinner">("lunch")
  const [mode, setMode] = useState<"delivery" | "dine_in" | "pickup">("delivery")
  const [addressId, setAddressId] = useState(addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? "")
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "")
  const [reason, setReason] = useState("")
  const [rows, setRows] = useState<RecordRow[]>([{ kind: "meal", dish: meals[0]?.id ?? "", qty: 1, addons: {} }])

  const setRow = (i: number, patch: Partial<RecordRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const rowCost = (r: RecordRow) =>
    r.kind === "drink"
      ? drinkPrice * r.qty
      : (mealRate + (premium[r.dish] ?? 0)) * r.qty +
        Object.entries(r.addons).reduce((n, [id, q]) => n + (addons.find((a) => a.id === id)?.price_per_meal ?? 0) * q, 0)
  const total = rows.reduce((n, r) => n + rowCost(r), 0)

  const problem =
    !date || date > today ? "Only today or an earlier day." :
    rows.length === 0 || rows.some((r) => !r.dish) ? "Add what was delivered." :
    mode === "delivery" && !addressId ? "Pick the address it went to." :
    mode !== "delivery" && !locationId ? "Pick the counter." :
    reason.trim().length < 3 ? "Say why it wasn't in the app." :
    total > walletBalance ? `The wallet has ${fmtRupees(walletBalance)} — this costs ${fmtRupees(total)}. Add paid meals first.` :
    null

  return (
    <ModalOverlay onClose={onClose} wide>
      <ModalCard title="Record a delivery" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            For a meal that went out but isn&apos;t in the app — it was skipped, had no batch, or the customer called.
            It&apos;s charged to the wallet like any delivery and shows in their order history. If the meal is still
            in the app, use Mark delivered in the day editor instead.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Day">
              <input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Meal">
              <select value={slot} onChange={(e) => setSlot(e.target.value as "lunch" | "dinner")} className={inputCls}>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="How">
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className={inputCls}>
                <option value="delivery">Delivered</option>
                <option value="dine_in">Dine-in at a counter</option>
                <option value="pickup">Takeaway from a counter</option>
              </select>
            </Field>
            {mode === "delivery" ? (
              <Field label="Address">
                <select value={addressId} onChange={(e) => setAddressId(e.target.value)} className={inputCls}>
                  {addresses.length === 0 && <option value="">No address on file</option>}
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>{a.label || a.type || "Address"} — {a.line1 ?? ""}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Counter">
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-[#1A1A1A]">What went out</p>
            {rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-[#e2e8d5] p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select value={r.dish} onChange={(e) => setRow(i, { dish: e.target.value })} className={cn(inputCls, "flex-1")}>
                    {(r.kind === "meal" ? meals : drinks).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.category}){premium[m.id] ? ` +${fmtRupees(premium[m.id])}` : ""}
                      </option>
                    ))}
                  </select>
                  <Stepper value={r.qty} setValue={(n) => setRow(i, { qty: n })} min={1} max={10} />
                  <button
                    type="button"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    className="w-9 h-9 rounded-lg border border-[#e2e8d5] text-gray-400 hover:bg-gray-50"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
                {r.kind === "meal" && addons.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {addons.map((a) => (
                      <label key={a.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                        {a.name} +{fmtRupees(a.price_per_meal)}
                        <input
                          type="number" min={0} max={20} value={r.addons[a.id] ?? 0}
                          onChange={(e) => {
                            const q = Math.max(0, Math.min(20, parseInt(e.target.value) || 0))
                            const next = { ...r.addons }
                            if (q > 0) next[a.id] = q
                            else delete next[a.id]
                            setRow(i, { addons: next })
                          }}
                          className="w-14 h-8 rounded-md border border-[#e2e8d5] px-2 text-xs"
                        />
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-500 text-right">
                  {r.kind === "drink" ? "Drink" : "Meal"} · {fmtRupees(rowCost(r))}
                </p>
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRows((rs) => [...rs, { kind: "meal", dish: meals[0]?.id ?? "", qty: 1, addons: {} }])}
                className="px-3 py-1.5 rounded-lg border border-[#e2e8d5] text-xs font-medium hover:bg-gray-50"
              >
                + Meal
              </button>
              {drinks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRows((rs) => [...rs, { kind: "drink", dish: drinks[0].id, qty: 1, addons: {} }])}
                  className="px-3 py-1.5 rounded-lg border border-[#e2e8d5] text-xs font-medium hover:bg-gray-50"
                >
                  + Drink
                </button>
              )}
            </div>
          </div>

          <Field label="Reason (required) — why it wasn't in the app" hint="Kept in the admin log and on the order. You'll be asked for your action password.">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Customer called at 1 PM — the lunch was skipped but they wanted it"
              className="w-full rounded-lg border border-[#e2e8d5] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
          </Field>

          <div className="flex items-center justify-between rounded-xl bg-[#F9FBF7] border border-[#e2e8d5] px-3 py-2.5 text-sm">
            <span>Charged to the wallet <span className="text-xs text-gray-500">(has {fmtRupees(walletBalance)})</span></span>
            <span className="font-semibold">{fmtRupees(total)}</span>
          </div>
          {problem && <p className="text-xs text-amber-700">{problem}</p>}
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn
            disabled={pending || !!problem}
            onClick={() => onSave({
              date, slot, mode,
              addressId: mode === "delivery" ? addressId : null,
              locationId: mode === "delivery" ? null : locationId,
              reason: reason.trim(),
              items: rows.map((r) => ({
                kind: r.kind, dish: r.dish, qty: r.qty,
                addons: r.kind === "meal" ? Object.entries(r.addons).map(([id, qty]) => ({ id, qty })) : [],
              })),
            })}
          >
            Record and charge {fmtRupees(total)}
          </PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Renew plan (office) ───────────────────────────────────────────────────

export type RenewFormValue = {
  planId: string
  mealsLunch: number
  mealsDinner: number
  days: string[]
  addonIds: string[]
  paidPaise: number
  cashDuePaise: number
  proof: ProofInput | null
  reason: string
  idempotencyKey: string
  couponId: string | null
}

export function RenewModal({ initial, noDeliveryDays, walletBalance, plans, addons, coupons, pending, onClose, onSave }: {
  initial: { planId: string; mealsLunch: number; mealsDinner: number; days: string[]; addonIds: string[] }
  noDeliveryDays: boolean
  walletBalance: number
  plans: { id: string; name: string; base_price: number; meals_total: number }[]
  addons: { id: string; name: string; price_per_meal: number }[]
  /** Coupons that work today; only those with a price for the chosen plan are offered. */
  coupons: { id: string; code: string; name: string | null; prices: Record<string, number> }[]
  pending: boolean
  onClose: () => void
  onSave: (v: RenewFormValue) => void
}) {
  const [couponId, setCouponId] = useState("")
  const [planId, setPlanId] = useState(plans.some((p) => p.id === initial.planId) ? initial.planId : (plans[0]?.id ?? ""))
  const [mealsLunch, setMealsLunch] = useState(initial.mealsLunch)
  const [mealsDinner, setMealsDinner] = useState(initial.mealsDinner)
  const [days, setDays] = useState<string[]>(initial.days.length || noDeliveryDays ? initial.days : [...WEEKDAYS])
  const [addonIds, setAddonIds] = useState<string[]>(initial.addonIds)
  const [paid, setPaid] = useState("")
  const [due, setDue] = useState("")
  const [proof, setProof] = useState<ProofInput>(emptyProof)
  const [reason, setReason] = useState("")
  const [key] = useState(() => crypto.randomUUID())

  const plan = plans.find((p) => p.id === planId)
  const addonPerMeal = addons.filter((a) => addonIds.includes(a.id)).reduce((n, a) => n + a.price_per_meal, 0)
  const planCoupons = coupons.filter((c) => c.prices[planId])
  const coupon = planCoupons.find((c) => c.id === couponId) ?? null
  const regularMeal = plan ? planMealRate(plan) : 0
  const mealPrice = coupon ? coupon.prices[planId] : regularMeal
  // Same as the app: the plan price, or the coupon's meal price × meals; add-ons per meal on top.
  const total = plan ? (coupon ? mealPrice * plan.meals_total : plan.base_price) + addonPerMeal * plan.meals_total : 0
  const paidPaise = rupeesToPaise(paid)
  const duePaise = due.trim() ? rupeesToPaise(due) : Math.max(total - paidPaise, 0)

  const problem =
    !plan ? "Pick a plan." :
    mealsLunch + mealsDinner < 1 ? "Set at least one meal per day." :
    paidPaise + duePaise <= 0 ? "Enter what was paid or what's still to collect." :
    paidPaise > 0 && proofProblem(proof, paidPaise) ? proofProblem(proof, paidPaise) :
    reason.trim().length < 3 ? "Write why the office is renewing this plan." :
    null

  return (
    <ModalOverlay onClose={onClose} wide>
      <ModalCard title="Renew plan" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-xs text-gray-500 bg-[#F9FBF7] border border-[#e2e8d5] rounded-lg p-3">
            For a customer who can&apos;t renew in the app. Their details, addresses and food preferences stay as they are —
            only the plan is set again. The current plan closes and anything left in the wallet
            ({fmtRupees(walletBalance)}) carries on into the new one.
          </p>
          <Field label="Plan">
            <select
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value)
                if (couponId && !coupons.find((c) => c.id === couponId)?.prices[e.target.value]) setCouponId("")
              }}
              className={inputCls}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.meals_total} meals · ₹{(planMealRate(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/meal
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lunches per day"><Stepper value={mealsLunch} setValue={setMealsLunch} max={3} /></Field>
            <Field label="Dinners per day"><Stepper value={mealsDinner} setValue={setMealsDinner} max={3} /></Field>
          </div>
          <Field
            label="Delivery days"
            hint={days.length === 0 ? "No delivery days: nothing is delivered; they can still walk in or add a meal any day." : undefined}
          >
            <Chips options={opts(DAYS)} value={days} onChange={(d) => setDays(DAYS.filter((x) => d.includes(x)))} />
          </Field>
          <Field label="Add-ons with every meal">
            <Chips
              options={addons.map((a) => ({ value: a.id, label: `${a.name} +${fmtRupees(a.price_per_meal)}` }))}
              value={addonIds}
              onChange={setAddonIds}
            />
          </Field>

          {planCoupons.length > 0 ? (
            <Field label="Coupon (optional)">
              <select value={couponId} onChange={(e) => setCouponId(e.target.value)} className={inputCls}>
                <option value="">No coupon — {fmtRupees(regularMeal)} per meal</option>
                {planCoupons.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {fmtRupees(c.prices[planId])} per meal{c.name ? ` · ${c.name}` : ""}
                  </option>
                ))}
              </select>
              {coupon && plan && (
                <p className="mt-1 text-xs text-[#1B5E20]">
                  {fmtRupees(mealPrice)} per meal instead of {fmtRupees(regularMeal)} — saves {fmtRupees((regularMeal - mealPrice) * plan.meals_total)} on {plan.meals_total} meals.
                </p>
              )}
            </Field>
          ) : (
            <p className="text-xs text-gray-400">No coupon that works today has a price for this plan.</p>
          )}

          <div className="rounded-xl bg-[#F9FBF7] border border-[#e2e8d5] px-3 py-2.5 text-sm flex items-center justify-between">
            <span>Plan price{coupon ? ` (${coupon.code})` : ""}</span>
            <span className="font-semibold">{fmtRupees(total)}</span>
          </div>
          <Field label="Paid (₹)" hint="Money received outside the app — it goes into the wallet with its proof.">
            <input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
          </Field>
          {paidPaise > 0 && <PaymentProofFields value={proof} onChange={setProof} amountPaise={paidPaise} />}
          <Field label="Cash still to collect (₹)" hint="Meals run on credit until it's recorded.">
            <input inputMode="decimal" value={due} onChange={(e) => setDue(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(Math.max(total - paidPaise, 0) / 100)} className={inputCls} />
          </Field>

          <Field label="Reason (required)" hint="Kept in the admin log. You'll be asked for your action password.">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Customer paid by UPI on WhatsApp — the app's checkout kept failing"
              className="w-full rounded-lg border border-[#e2e8d5] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
          </Field>
          {problem && <p className="text-xs text-amber-700">{problem}</p>}
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn
            disabled={pending || !!problem}
            onClick={() => onSave({
              planId, mealsLunch, mealsDinner, days, addonIds,
              paidPaise, cashDuePaise: duePaise, proof: paidPaise > 0 ? proof : null,
              reason: reason.trim(), idempotencyKey: key, couponId: coupon?.id ?? null,
            })}
          >
            Renew plan
          </PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}
