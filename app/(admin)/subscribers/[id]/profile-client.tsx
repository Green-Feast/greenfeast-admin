"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Phone, Calendar, MapPin, Utensils, StickyNote,
  Pause, Play, X, Plus, CheckCircle, AlertCircle,
  Truck, Clock, Banknote,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  saveNotes,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  extendSubscription,
  changeBatch,
  markCodPaid,
} from "./actions"

// ── Types ──────────────────────────────────────────────────────────────────

type Subscription = {
  status: string
  paymentMethod: string
  planName: string
  deliveriesRemaining: number
  mealsTotal: number
  daysPerWeek: number
  basePrice: number
  startDate: string | null
  endDate: string | null
  pauseFrom: string | null
  pauseUntil: string | null
  specialNotes: string
  createdAt: string
  batchId: string | null
  batchName: string
  deliveryMode: string
  menuType: string
  mealsLunch: number
  mealsDinner: number
}

type User = { name: string; phone: string; createdAt: string }

type Payment = {
  id: string
  amount: number
  status: string
  created_at: string
  razorpay_payment_id: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return "—"
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

function fmtRupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`
}

function today() {
  return new Date().toISOString().split("T")[0]
}

const STATUS_STYLES: Record<string, string> = {
  active:    "bg-green-100 text-green-700 border-green-200",
  paused:    "bg-yellow-100 text-yellow-700 border-yellow-200",
  cancelled: "bg-red-100 text-red-600 border-red-200",
  pending:   "bg-gray-100 text-gray-600 border-gray-200",
  expired:   "bg-red-100 text-red-600 border-red-200",
}

const PAY_STATUS_STYLES: Record<string, string> = {
  paid:     "bg-green-100 text-green-700",
  created:  "bg-yellow-100 text-yellow-700",
  failed:   "bg-red-100 text-red-600",
  refunded: "bg-blue-100 text-blue-700",
}

// ── Main component ─────────────────────────────────────────────────────────

export function ProfileClient({
  subscriptionId,
  subscription,
  user,
  dietary,
  addresses,
  payments,
  allBatches,
  addons,
  walletBalance,
}: {
  subscriptionId: string
  subscription: Subscription
  user: User
  dietary: any
  addresses: any[]
  payments: Payment[]
  allBatches: { id: string; name: string }[]
  addons: { id: string; name: string; price_per_meal: number }[]
  walletBalance: number | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [pauseOpen, setPauseOpen]   = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const [pauseFrom, setPauseFrom]   = useState(today())
  const [pauseUntil, setPauseUntil] = useState("")
  const [extendMeals, setExtendMeals] = useState(15)
  const [notes, setNotes] = useState(subscription.specialNotes)
  const [selectedBatch, setSelectedBatch] = useState(subscription.batchId ?? "")

  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null)

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3000)
  }

  function run(action: () => Promise<void>, successMsg: string, onSuccess?: () => void) {
    startTransition(async () => {
      try {
        await action()
        router.refresh()
        showToast("success", successMsg)
        onSuccess?.()
      } catch {
        showToast("error", "Something went wrong. Try again.")
      }
    })
  }

  const isPaused      = subscription.status === "paused"
  const isCancelled   = subscription.status === "cancelled"
  const isCodPending  = subscription.status === "pending" && subscription.paymentMethod === "cod"
  const progress    = subscription.mealsTotal > 0
    ? Math.min(100, Math.round((subscription.deliveriesRemaining / subscription.mealsTotal) * 100))
    : 0

  const slotsPerDay = (subscription.mealsLunch ?? 0) + (subscription.mealsDinner ?? 0)
  const baseMealRate = subscription.mealsTotal > 0
    ? Math.round(subscription.basePrice / Math.max(subscription.mealsTotal, 1))
    : 0
  const addonTotalPerSlot = addons.reduce((s, a) => s + a.price_per_meal, 0)
  const perDayCost = (baseMealRate + addonTotalPerSlot) * Math.max(slotsPerDay, 1)

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-[#1A1A1A]">{user.name}</h1>
            <span className={cn(
              "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize",
              STATUS_STYLES[subscription.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
            )}>
              {subscription.status}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-sm text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              <a href={`tel:+91${user.phone}`} className="hover:text-[#1B5E20] transition-colors">
                +91 {user.phone}
              </a>
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Joined {fmtDate(user.createdAt)}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        {!isCancelled && (
          <div className="flex items-center gap-2 flex-wrap">
            {isCodPending ? (
              // CoD sub awaiting cash on first delivery — only payment + cancel apply
              <ActionBtn
                icon={<Banknote className="w-3.5 h-3.5" />}
                label="Mark payment received"
                color="green"
                disabled={isPending}
                onClick={() => run(() => markCodPaid(subscriptionId), "Payment confirmed — plan activated.")}
              />
            ) : (
              <>
                {isPaused ? (
                  <ActionBtn
                    icon={<Play className="w-3.5 h-3.5" />}
                    label="Resume"
                    color="green"
                    disabled={isPending}
                    onClick={() => run(() => resumeSubscription(subscriptionId), "Subscription resumed.")}
                  />
                ) : (
                  <ActionBtn
                    icon={<Pause className="w-3.5 h-3.5" />}
                    label="Pause"
                    color="yellow"
                    disabled={isPending}
                    onClick={() => setPauseOpen(true)}
                  />
                )}
                <ActionBtn
                  icon={<Plus className="w-3.5 h-3.5" />}
                  label="Extend"
                  color="blue"
                  disabled={isPending}
                  onClick={() => setExtendOpen(true)}
                />
              </>
            )}
            <ActionBtn
              icon={<X className="w-3.5 h-3.5" />}
              label="Cancel"
              color="red"
              disabled={isPending}
              onClick={() => setCancelOpen(true)}
            />
          </div>
        )}
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ─── Left col (3/5) ─── */}
        <div className="lg:col-span-3 space-y-6">

          {/* Subscription card */}
          <Card>
            <CardHeader title="Subscription" />
            <div className="px-5 pb-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-[#1A1A1A]">{subscription.planName}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {subscription.mealsTotal} meals · {subscription.daysPerWeek} days/week
                    {subscription.basePrice > 0 && ` · ${fmtRupees(subscription.basePrice)}`}
                  </p>
                  {isCodPending && (
                    <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-2 py-1 mt-2 inline-flex items-center gap-1.5">
                      <Banknote className="w-3.5 h-3.5" />
                      Cash on delivery — awaiting payment on first delivery
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold text-[#1B5E20]">{subscription.deliveriesRemaining}</p>
                  <p className="text-xs text-gray-400">deliveries left</p>
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#1B5E20] rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Plan composition */}
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#E8F5E9] text-[#1B5E20] font-semibold text-xs">
                  {subscription.menuType}
                </span>
                {subscription.mealsLunch > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs">
                    {subscription.mealsLunch} lunch{subscription.mealsLunch > 1 ? "es" : ""}
                  </span>
                )}
                {subscription.mealsDinner > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs">
                    {subscription.mealsDinner} dinner{subscription.mealsDinner > 1 ? "s" : ""}
                  </span>
                )}
                {addons.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs">
                    {a.name} +₹{(a.price_per_meal / 100).toLocaleString("en-IN")}/meal
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 pt-1">
                <InfoRow label="Start date"     value={fmtDate(subscription.startDate)} />
                <InfoRow label="End date"       value={fmtDate(subscription.endDate)} />
                <InfoRow label="Delivery mode"  value={subscription.deliveryMode === "opt-in" ? "Opt-in" : "Opt-out"} />
                <InfoRow label="Batch"          value={subscription.batchName} />
                <InfoRow
                  label="Wallet balance"
                  value={walletBalance !== null ? fmtRupees(walletBalance) : "—"}
                />
                {perDayCost > 0 && (
                  <InfoRow label="Default cart/day" value={fmtRupees(perDayCost)} />
                )}
                {isPaused && (
                  <>
                    <InfoRow label="Paused from"  value={fmtDate(subscription.pauseFrom)} />
                    <InfoRow label="Paused until" value={fmtDate(subscription.pauseUntil)} highlight />
                  </>
                )}
              </div>

              {/* Batch selector */}
              <div className="pt-1 border-t border-[#e2e8d5]">
                <label className="text-xs text-gray-400 uppercase tracking-wide block mb-2">
                  Reassign batch
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedBatch}
                    onChange={(e) => setSelectedBatch(e.target.value)}
                    className="flex-1 h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
                  >
                    <option value="">Unassigned</option>
                    {allBatches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => run(
                      () => changeBatch(subscriptionId, selectedBatch || null),
                      "Batch updated."
                    )}
                    disabled={isPending || selectedBatch === (subscription.batchId ?? "")}
                    className="h-9 px-4 text-sm font-medium rounded-lg bg-[#1B5E20] text-white hover:bg-[#155116] disabled:opacity-40 transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </Card>

          {/* Payment History */}
          <Card>
            <CardHeader title="Payment History" />
            {payments.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-gray-400">No payments recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e2e8d5]">
                      {["Date", "Amount", "Status", "Razorpay ID"].map((h) => (
                        <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-2.5 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, i) => (
                      <tr key={p.id} className={cn("border-b border-[#e2e8d5] last:border-0", i % 2 === 1 && "bg-[#fafcf8]")}>
                        <td className="px-5 py-3 whitespace-nowrap text-gray-600">
                          {fmtDate(p.created_at)}
                        </td>
                        <td className="px-5 py-3 font-semibold text-[#1A1A1A]">
                          {fmtRupees(p.amount)}
                        </td>
                        <td className="px-5 py-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                            PAY_STATUS_STYLES[p.status] ?? "bg-gray-100 text-gray-600"
                          )}>
                            {p.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-gray-400 truncate max-w-[160px]" title={p.razorpay_payment_id ?? ""}>
                          {p.razorpay_payment_id ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ─── Right col (2/5) ─── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Addresses */}
          <Card>
            <CardHeader title="Delivery Addresses" icon={<MapPin className="w-3.5 h-3.5" />} />
            <div className="px-5 pb-5 space-y-3">
              {addresses.length === 0 ? (
                <p className="text-sm text-gray-400">No address on file.</p>
              ) : addresses.map((addr: any) => (
                <div key={addr.id} className="text-sm border border-[#e2e8d5] rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-[#1A1A1A]">{addr.label ?? addr.type}</span>
                    {addr.is_default && (
                      <span className="text-xs bg-[#E8F5E9] text-[#1B5E20] px-1.5 py-0.5 rounded-full font-medium">Default</span>
                    )}
                  </div>
                  <p className="text-gray-600">{addr.line1}</p>
                  {addr.landmark && <p className="text-gray-500 text-xs">Near: {addr.landmark}</p>}
                  <p className="text-gray-500 text-xs">{[addr.city, addr.pincode].filter(Boolean).join(" — ")}</p>
                  {addr.time_window && (
                    <p className="text-gray-500 text-xs flex items-center gap-1 mt-1">
                      <Clock className="w-3 h-3" />{addr.time_window}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Dietary Profile */}
          <Card>
            <CardHeader title="Dietary Profile" icon={<Utensils className="w-3.5 h-3.5" />} />
            <div className="px-5 pb-5">
              {dietary ? (
                <div className="space-y-3 text-sm">
                  {dietary.dietary_preference && (
                    <InfoRow label="Preference" value={dietary.dietary_preference} />
                  )}
                  {dietary.health_goal && (
                    <InfoRow label="Health goal" value={dietary.health_goal} />
                  )}
                  {dietary.allergens?.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1.5">Allergens</p>
                      <div className="flex flex-wrap gap-1.5">
                        {dietary.allergens.map((a: string) => (
                          <span key={a} className="px-2 py-0.5 bg-red-50 text-red-600 text-xs rounded-full font-medium">
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {dietary.free_text && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Notes</p>
                      <p className="text-gray-600 leading-relaxed">{dietary.free_text}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No dietary profile on file.</p>
              )}
            </div>
          </Card>

          {/* Admin Notes */}
          <Card>
            <CardHeader title="Admin Notes" icon={<StickyNote className="w-3.5 h-3.5" />} />
            <div className="px-5 pb-5 space-y-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes, delivery instructions, follow-ups..."
                rows={4}
                className="w-full text-sm rounded-lg border border-[#e2e8d5] bg-[#F9FBF7] px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] resize-none transition-colors placeholder:text-gray-300"
              />
              <button
                onClick={() => run(() => saveNotes(subscriptionId, notes), "Notes saved.")}
                disabled={isPending || notes === subscription.specialNotes}
                className="w-full h-9 text-sm font-medium rounded-lg bg-[#1B5E20] text-white hover:bg-[#155116] disabled:opacity-40 transition-colors"
              >
                Save notes
              </button>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Modals ── */}

      {/* Pause */}
      {pauseOpen && (
        <ModalOverlay onClose={() => setPauseOpen(false)}>
          <ModalCard title="Pause subscription" onClose={() => setPauseOpen(false)}>
            <div className="space-y-4">
              <Field label="Pause from">
                <input
                  type="date"
                  min={today()}
                  value={pauseFrom}
                  onChange={(e) => setPauseFrom(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Pause until">
                <input
                  type="date"
                  min={pauseFrom || today()}
                  value={pauseUntil}
                  onChange={(e) => setPauseUntil(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <p className="text-xs text-gray-400">
                All scheduled orders in this range will be cancelled.
              </p>
            </div>
            <ModalFooter>
              <GhostBtn onClick={() => setPauseOpen(false)}>Cancel</GhostBtn>
              <PrimaryBtn
                disabled={!pauseFrom || !pauseUntil || isPending}
                onClick={() => run(
                  () => pauseSubscription(subscriptionId, pauseFrom, pauseUntil),
                  "Subscription paused.",
                  () => setPauseOpen(false)
                )}
              >
                Confirm Pause
              </PrimaryBtn>
            </ModalFooter>
          </ModalCard>
        </ModalOverlay>
      )}

      {/* Extend */}
      {extendOpen && (
        <ModalOverlay onClose={() => setExtendOpen(false)}>
          <ModalCard title="Extend plan" onClose={() => setExtendOpen(false)}>
            <div className="space-y-4">
              <Field label="Meals to add">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={extendMeals}
                  onChange={(e) => setExtendMeals(Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
              <p className="text-sm text-gray-500">
                Current: <strong>{subscription.deliveriesRemaining}</strong> → New total:{" "}
                <strong>{subscription.deliveriesRemaining + extendMeals}</strong>
              </p>
            </div>
            <ModalFooter>
              <GhostBtn onClick={() => setExtendOpen(false)}>Cancel</GhostBtn>
              <PrimaryBtn
                disabled={extendMeals < 1 || isPending}
                onClick={() => run(
                  () => extendSubscription(subscriptionId, extendMeals),
                  `Added ${extendMeals} meals.`,
                  () => setExtendOpen(false)
                )}
              >
                Confirm Extension
              </PrimaryBtn>
            </ModalFooter>
          </ModalCard>
        </ModalOverlay>
      )}

      {/* Cancel */}
      {cancelOpen && (
        <ModalOverlay onClose={() => setCancelOpen(false)}>
          <ModalCard title="Cancel subscription?" onClose={() => setCancelOpen(false)}>
            <p className="text-sm text-gray-600 leading-relaxed">
              All upcoming scheduled orders will be cancelled. This cannot be undone from the app.
            </p>
            <ModalFooter>
              <GhostBtn onClick={() => setCancelOpen(false)}>Keep it</GhostBtn>
              <DangerBtn
                disabled={isPending}
                onClick={() => run(
                  () => cancelSubscription(subscriptionId),
                  "Subscription cancelled.",
                  () => setCancelOpen(false)
                )}
              >
                Cancel Plan
              </DangerBtn>
            </ModalFooter>
          </ModalCard>
        </ModalOverlay>
      )}

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white",
          toast.type === "success" ? "bg-[#1B5E20]" : "bg-red-600"
        )}>
          {toast.type === "success"
            ? <CheckCircle className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-[#e2e8d5] shadow-sm overflow-hidden">
      {children}
    </div>
  )
}

function CardHeader({ title, icon }: { title: string; icon?: React.ReactNode }) {
  return (
    <div className="px-5 py-3.5 border-b border-[#e2e8d5] bg-[#F9FBF7] flex items-center gap-2">
      {icon && <span className="text-gray-400">{icon}</span>}
      <h2 className="font-semibold text-[#1A1A1A] text-sm">{title}</h2>
    </div>
  )
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className={cn("font-medium text-right", highlight ? "text-yellow-600" : "text-[#1A1A1A]")}>
        {value}
      </span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function ActionBtn({
  icon, label, color, disabled, onClick,
}: {
  icon: React.ReactNode; label: string; color: "green" | "yellow" | "blue" | "red"; disabled?: boolean; onClick: () => void
}) {
  const cls = {
    green:  "border-green-300  bg-green-50  text-green-700  hover:bg-green-100",
    yellow: "border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100",
    blue:   "border-blue-300   bg-blue-50   text-blue-700   hover:bg-blue-100",
    red:    "border-red-300    bg-red-50    text-red-700    hover:bg-red-100",
  }[color]

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40", cls)}
    >
      {icon} {label}
    </button>
  )
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  )
}

function ModalCard({
  title, children, onClose,
}: {
  title: string; children: React.ReactNode; onClose: () => void
}) {
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

function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-3 pt-1">{children}</div>
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 h-10 rounded-xl border border-[#e2e8d5] text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
    >
      {children}
    </button>
  )
}

function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 h-10 rounded-xl bg-[#1B5E20] text-sm font-medium text-white hover:bg-[#155116] disabled:opacity-40 transition-colors"
    >
      {children}
    </button>
  )
}

function DangerBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 h-10 rounded-xl bg-red-600 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
    >
      {children}
    </button>
  )
}

const inputCls = "w-full h-10 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] transition-colors"
