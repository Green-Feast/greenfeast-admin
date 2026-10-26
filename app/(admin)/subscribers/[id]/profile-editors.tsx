"use client"

// Edit dialogs for the subscriber profile — everything a customer can tell
// us on WhatsApp, the admin can now set here: details, plan, food
// preferences, addresses, wallet, cash-on-delivery, fixed dishes.

import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

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

export type PlanFormValue = {
  planId: string
  mealsLunch: number
  mealsDinner: number
  days: string[]
  addonIds: string[]
  startDate: string | null
  mealsLeft: number
  deliveryMode: "opt-in" | "opt-out"
}

export function PlanModal({ initial, plans, addons, pending, onClose, onSave }: {
  initial: PlanFormValue
  plans: { id: string; name: string; base_price: number; meals_total: number }[]
  addons: { id: string; name: string; price_per_meal: number }[]
  pending: boolean
  onClose: () => void
  onSave: (v: PlanFormValue) => void
}) {
  const [v, setV] = useState<PlanFormValue>({ ...initial, days: initial.days.length ? initial.days : [...DAYS] })
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
                    {p.name} · {p.meals_total} meals · ₹{(Math.round(p.base_price / Math.max(p.meals_total, 1)) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/meal
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Meals left" hint="What the plan still owes them.">
              <input type="number" min={0} value={v.mealsLeft} onChange={(e) => set("mealsLeft", Math.max(0, parseInt(e.target.value || "0", 10)))} className={inputCls} />
            </Field>
          </div>
          <Field label="Delivery days">
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="First delivery date" hint="Nothing is scheduled before it.">
              <input type="date" value={v.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} className={inputCls} />
            </Field>
            <Field label="Delivery mode">
              <select value={v.deliveryMode} onChange={(e) => set("deliveryMode", e.target.value as PlanFormValue["deliveryMode"])} className={inputCls}>
                <option value="opt-out">Opt-out (skip anytime)</option>
                <option value="opt-in">Opt-in</option>
              </select>
            </Field>
          </div>
          <p className="text-xs text-gray-500 bg-[#F9FBF7] border border-[#e2e8d5] rounded-lg p-3">
            Upcoming meals follow these settings straight away. Days or slots taken off are removed, portions and add-ons
            change, and new days are scheduled. Meals the customer changed for a particular day stay as they set them.
            The wallet isn&apos;t touched — adjust it separately if the price changes.
          </p>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending || v.days.length === 0 || v.mealsLunch + v.mealsDinner < 1} onClick={() => onSave(v)}>
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

export type AddressFormValue = { id?: string; label: string; type: string; line1: string; landmark: string; pincode: string; timeWindow: string }

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
                <option value="work">Work</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <Field label="Address">
            <textarea value={v.line1} onChange={(e) => set("line1", e.target.value)} rows={2} className={cn(inputCls, "h-auto py-2 resize-none")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Landmark"><input value={v.landmark} onChange={(e) => set("landmark", e.target.value)} className={inputCls} /></Field>
            <Field label="Pincode"><input value={v.pincode} onChange={(e) => set("pincode", e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Delivery time window"><input value={v.timeWindow} onChange={(e) => set("timeWindow", e.target.value)} placeholder="e.g. 12:30–1:30" className={inputCls} /></Field>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending || !v.line1.trim()} onClick={() => onSave(v)}>{pending ? "Saving…" : "Save address"}</PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Wallet ────────────────────────────────────────────────────────────────

export function WalletModal({ balance, pending, onClose, onSave }: {
  balance: number | null
  pending: boolean
  onClose: () => void
  onSave: (amountPaise: number, direction: "credit" | "debit", reason: string) => void
}) {
  const [direction, setDirection] = useState<"credit" | "debit">("credit")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const paise = rupeesToPaise(amount)
  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard title="Adjust wallet" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Balance now: <span className="font-semibold text-[#1A1A1A]">{balance !== null ? fmtRupees(balance) : "—"}</span></p>
          <div className="flex gap-2">
            {(["credit", "debit"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={cn("flex-1 h-9 rounded-lg border text-sm font-medium", direction === d ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "border-[#e2e8d5] text-gray-600")}
              >
                {d === "credit" ? "Add money" : "Take money"}
              </button>
            ))}
          </div>
          <Field label="Amount (₹)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={inputCls} /></Field>
          <Field label="Reason (the customer sees it)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. goodwill credit for a late delivery" className={inputCls} /></Field>
          <p className="text-xs text-gray-400">For a refund of a paid order use Money → Refund, so it&apos;s tracked as a refund.</p>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending || paise <= 0 || !reason.trim()} onClick={() => onSave(paise, direction, reason)}>
            {direction === "credit" ? `Add ${paise > 0 ? fmtRupees(paise) : ""}` : `Take ${paise > 0 ? fmtRupees(paise) : ""}`}
          </PrimaryBtn>
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  )
}

// ── Cash on delivery ──────────────────────────────────────────────────────

export function CashModal({ due, pending, onClose, onRecord, onSetDue }: {
  due: number
  pending: boolean
  onClose: () => void
  onRecord: (amountPaise: number) => void
  onSetDue: (duePaise: number, onCredit: boolean) => void
}) {
  const [amount, setAmount] = useState(due > 0 ? String(due / 100) : "")
  const [newDue, setNewDue] = useState(String(due / 100))
  const [onCredit, setOnCredit] = useState(true)
  const paise = rupeesToPaise(amount)
  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard title="Cash on delivery" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Still to collect: <span className="font-semibold text-[#1A1A1A]">{fmtRupees(due)}</span></p>
          <Field label="Cash received (₹)" hint="Part payments are fine — it goes into their wallet and lowers what's due.">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={inputCls} />
          </Field>
          <PrimaryBtn disabled={pending || paise <= 0} onClick={() => onRecord(paise)}>Record {paise > 0 ? fmtRupees(paise) : "cash"} received</PrimaryBtn>
          <div className="pt-3 border-t border-[#e2e8d5] space-y-2">
            <Field label="Or change what's due (₹)">
              <input inputMode="decimal" value={newDue} onChange={(e) => setNewDue(e.target.value.replace(/[^\d.]/g, ""))} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={onCredit} onChange={(e) => setOnCredit(e.target.checked)} className="accent-[#1B5E20]" />
              Keep delivering on credit until it&apos;s paid (the wallet may go negative)
            </label>
            <button
              disabled={pending}
              onClick={() => onSetDue(rupeesToPaise(newDue), onCredit)}
              className="w-full h-9 rounded-lg border border-[#e2e8d5] text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Save amount due
            </button>
          </div>
        </div>
      </ModalCard>
    </ModalOverlay>
  )
}

export function ActivateModal({ total, pending, onClose, onSave }: {
  total: number
  pending: boolean
  onClose: () => void
  onSave: (paidPaise: number, cashDuePaise: number) => void
}) {
  const [paid, setPaid] = useState("")
  const [due, setDue] = useState("")
  const paidPaise = rupeesToPaise(paid)
  const duePaise = due.trim() ? rupeesToPaise(due) : Math.max(total - paidPaise, 0)
  return (
    <ModalOverlay onClose={onClose}>
      <ModalCard title="Activate plan" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Plan price: <span className="font-semibold">{fmtRupees(total)}</span></p>
          <Field label="Paid so far (₹)" hint="Cash, UPI or bank transfer you've received — it goes into the wallet. 0 is fine.">
            <input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
          </Field>
          <Field label="Cash still to collect (₹)" hint="Meals run on credit until it's recorded.">
            <input inputMode="decimal" value={due} onChange={(e) => setDue(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(Math.max(total - paidPaise, 0) / 100)} className={inputCls} />
          </Field>
        </div>
        <ModalFooter>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={pending} onClick={() => onSave(paidPaise, duePaise)}>Activate</PrimaryBtn>
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
