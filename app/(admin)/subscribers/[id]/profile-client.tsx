"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Phone, Calendar, MapPin, Utensils, StickyNote, Pencil, Mail,
  Pause, Play, X, Plus, CheckCircle, AlertCircle, Pin,
  Clock, Banknote, Wallet, Star, Trash2, CalendarDays, AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { OrderEditor, type EditorTarget } from "@/components/order-editor"
import { setFixedDish, clearFixedDish } from "@/app/(admin)/kitchen/order-actions"
import { setAddressBatch } from "@/app/(admin)/batches/actions"
import { recordCashReport, dismissCashReport } from "@/app/(admin)/operations/actions"
import {
  saveNotes,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  extendSubscription,
  updateCustomerIdentity,
  saveDietaryProfile,
  updatePlanSettings,
  recordCashPayment,
  setCashDue,
  activatePendingPlan,
  adjustWallet,
  saveCustomerAddress,
  makeDefaultAddress,
  removeCustomerAddress,
  type ActionResult,
} from "./actions"
import {
  ModalOverlay, ModalCard, ModalFooter, Field, GhostBtn, PrimaryBtn, DangerBtn, inputCls, fmtRupees,
  IdentityModal, PlanModal, DietaryModal, AddressModal, WalletModal, CashModal, ActivateModal, FixedDishModal,
  type DietaryValue, type AddressFormValue,
} from "./profile-editors"

// ── Types ──────────────────────────────────────────────────────────────────

type Subscription = {
  status: string
  paymentMethod: string
  planId: string
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
  deliveryMode: string
  mealsLunch: number
  mealsDinner: number
  // Empty = opt-out (every day, skipped individually from the app). Non-empty
  // = opt-in — delivery only happens on these days. See instantiate-orders'
  // hasScheduleDays for the exact rule this mirrors.
  deliveryDays: string[]
  codDue: number
  onCredit: boolean
  couponMealPrice: number | null
  couponCode: string | null
  // Delivery partner app: cash a partner says they collected.
  cashReports: { id: string; amount: number; note: string | null; reportedAt: string; partner: string }[]
}

type User = { id: string; name: string; code: string; isTest: boolean; phone: string; email: string; createdAt: string }

type Payment = {
  id: string
  amount: number
  status: string
  created_at: string
  cf_payment_id: string | null
  cf_order_id: string | null
}

type Upcoming = {
  id: string
  date: string
  slot: "lunch" | "dinner"
  status: string
  skipReason: string | null
  quantity: number
  extra: boolean
  cartTotal: number | null
  mealName: string
  addressLabel: string
  addons: string[]
}

type Rule = { id: string; slot: "lunch" | "dinner"; dayOfWeek: number | null; mealName: string }

type Catalogue = {
  meals: { id: string; name: string; category: string }[]
  addons: { id: string; name: string; price_per_meal: number }[]
  plans: { id: string; name: string; base_price: number; meals_total: number }[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return "—"
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

function fmtDay(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
}

function today() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split("T")[0]
}

// Matches subscription_schedule.day_of_week's CHECK constraint order.
const DOW_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const DAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]

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

const ORDER_STATUS: Record<string, string> = {
  scheduled: "text-gray-500",
  confirmed: "text-gray-500",
  preparing: "text-amber-700",
  out_for_delivery: "text-blue-700",
  delivered: "text-[#1B5E20]",
  skipped: "text-gray-400 line-through",
}

export type WeeklyMenuEntry = {
  dayOfWeek: number   // Mon=0 .. Sun=6 (weekly_menu's convention, not JS's)
  slot: "lunch" | "dinner"
  mealName: string | null
  kcal: number | null
  protein: number | null
}

export type WalletTx = {
  id: string
  type: "credit" | "debit"
  amount: number
  reason: string | null
  reference_id: string | null
  created_at: string
}

type Modal =
  | "pause" | "extend" | "cancel" | "identity" | "plan" | "dietary" | "address"
  | "wallet" | "cash" | "activate" | "fixed" | null

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
  weeklyMenu,
  walletTransactions,
  upcoming,
  unmarked,
  rules,
  catalogue,
}: {
  subscriptionId: string
  subscription: Subscription
  user: User
  dietary: any
  addresses: any[]
  payments: Payment[]
  allBatches: { id: string; name: string; meal_slot: "lunch" | "dinner" }[]
  addons: { id: string; name: string; price_per_meal: number }[]
  walletBalance: number | null
  weeklyMenu: WeeklyMenuEntry[]
  walletTransactions: WalletTx[]
  upcoming: Upcoming[]
  unmarked: { id: string; date: string; slot: "lunch" | "dinner"; status: string; quantity: number; extra: boolean; mealName: string }[]
  rules: Rule[]
  catalogue: Catalogue
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [modal, setModal] = useState<Modal>(null)
  const [editingAddress, setEditingAddress] = useState<AddressFormValue | null>(null)
  const [editing, setEditing] = useState<EditorTarget | null>(null)

  const [pauseFrom, setPauseFrom]   = useState(today())
  const [pauseUntil, setPauseUntil] = useState("")
  const [extendMeals, setExtendMeals] = useState(15)
  const [notes, setNotes] = useState(subscription.specialNotes)
  const lunchBatches = allBatches.filter(b => b.meal_slot === "lunch")
  const dinnerBatches = allBatches.filter(b => b.meal_slot === "dinner")

  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null)

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  // In production Next replaces a server error's message with a generic one;
  // the digest is what Vercel's logs print next to the real error.
  function failure(e: unknown) {
    const { message, digest } = (e ?? {}) as { message?: unknown; digest?: unknown }
    const msg = String(message ?? "")
    if (/was not found on the server/i.test(msg)) {
      return "The admin was updated since this page opened — refresh the page (Ctrl+R) and save again."
    }
    if (/Server Components render/i.test(msg)) {
      return `Server error${digest ? ` (code ${digest})` : ""} — the Vercel logs have the details.`
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      return "Couldn't reach the server — check the connection and try again."
    }
    return msg || "Something went wrong. Try again."
  }

  // Old-style actions that throw on failure.
  function run(action: () => Promise<void>, successMsg: string, onSuccess?: () => void) {
    startTransition(async () => {
      try {
        await action()
        router.refresh()
        showToast("success", successMsg)
        onSuccess?.()
      } catch (e) {
        showToast("error", failure(e))
      }
    })
  }

  // Actions that return { ok, message | error }.
  function act(action: () => Promise<ActionResult | { ok: true; message?: string } | { ok: false; error: string }>, close = true) {
    startTransition(async () => {
      try {
        const res = await action()
        if (!res.ok) return showToast("error", res.error)
        router.refresh()
        showToast("success", res.message ?? "Saved.")
        if (close) { setModal(null); setEditingAddress(null) }
      } catch (e) {
        showToast("error", failure(e))
      }
    })
  }

  const isPaused      = subscription.status === "paused"
  const isCancelled   = subscription.status === "cancelled"
  const isPendingPlan = subscription.status === "pending"
  const progress    = subscription.mealsTotal > 0
    ? Math.min(100, Math.round((subscription.deliveriesRemaining / subscription.mealsTotal) * 100))
    : 0

  const slotsPerDay = (subscription.mealsLunch ?? 0) + (subscription.mealsDinner ?? 0)
  const regularMealRate = subscription.mealsTotal > 0
    ? Math.round(subscription.basePrice / Math.max(subscription.mealsTotal, 1))
    : 0
  // A plan bought with a coupon is billed at its coupon price (migration 066).
  const baseMealRate = subscription.couponMealPrice ?? regularMealRate
  const addonTotalPerSlot = addons.reduce((s, a) => s + a.price_per_meal, 0)
  const planPrice = (subscription.couponMealPrice ? subscription.couponMealPrice * subscription.mealsTotal : subscription.basePrice)
    + addonTotalPerSlot * subscription.mealsTotal
  const perDayCost = (baseMealRate + addonTotalPerSlot) * Math.max(slotsPerDay, 1)

  // Weekly rotation, indexed by weekly_menu's Mon=0..Sun=6 convention so it
  // lines up with DOW_ORDER without any remapping.
  const menuByDay = new Map<number, { lunch?: WeeklyMenuEntry; dinner?: WeeklyMenuEntry }>()
  for (const e of weeklyMenu) {
    const day = menuByDay.get(e.dayOfWeek) ?? {}
    day[e.slot] = e
    menuByDay.set(e.dayOfWeek, day)
  }
  const takesEveryDay = subscription.deliveryDays.length === 0
  const takesDelivery = (dayIdx: number) => takesEveryDay || subscription.deliveryDays.includes(DOW_ORDER[dayIdx])

  const walletCredited = walletTransactions.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0)
  const walletDebited = walletTransactions.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0)

  // Upcoming meals grouped by date + slot.
  const slots = new Map<string, Upcoming[]>()
  for (const o of upcoming) {
    const k = `${o.date}|${o.slot}`
    if (!slots.has(k)) slots.set(k, [])
    slots.get(k)!.push(o)
  }

  const dietaryValue: DietaryValue = {
    dietary_preference: dietary?.dietary_preference ?? "none",
    health_goal: dietary?.health_goal ?? null,
    allergens: dietary?.allergens ?? [],
    protein_preference: dietary?.protein_preference ?? [],
    base_avoidance: dietary?.base_avoidance ?? [],
    veggie_avoidance: dietary?.veggie_avoidance ?? [],
    spice_preference: dietary?.spice_preference ?? null,
    dressing_preference: dietary?.dressing_preference ?? null,
    free_text: dietary?.free_text ?? null,
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-[#1A1A1A]">{user.name}</h1>
            {user.code && <span className="font-mono text-sm text-gray-400">{user.code}</span>}
            {user.isTest && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FDD835] text-[#1A1A1A]">TEST ACCOUNT</span>
            )}
            <span className={cn(
              "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize",
              STATUS_STYLES[subscription.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
            )}>
              {subscription.status}
            </span>
            <button onClick={() => setModal("identity")} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-[#1B5E20]" title="Edit details">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-sm text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              <a href={`tel:${user.phone}`} className="hover:text-[#1B5E20] transition-colors">{user.phone || "—"}</a>
            </span>
            {user.email && (
              <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{user.email}</span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Joined {fmtDate(user.createdAt)}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        {!isCancelled && (
          <div className="flex items-center gap-2 flex-wrap">
            {isPendingPlan ? (
              <ActionBtn
                icon={<Play className="w-3.5 h-3.5" />}
                label="Activate plan"
                color="green"
                disabled={isPending}
                onClick={() => setModal("activate")}
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
                    onClick={() => setModal("pause")}
                  />
                )}
                <ActionBtn
                  icon={<Plus className="w-3.5 h-3.5" />}
                  label="Extend"
                  color="blue"
                  disabled={isPending}
                  onClick={() => setModal("extend")}
                />
              </>
            )}
            <ActionBtn
              icon={<X className="w-3.5 h-3.5" />}
              label="Cancel"
              color="red"
              disabled={isPending}
              onClick={() => setModal("cancel")}
            />
          </div>
        )}
      </div>

      {/* Cash on delivery */}
      {subscription.codDue > 0 && !isPendingPlan && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2 text-sm text-amber-900">
            <Banknote className="w-4 h-4" />
            <span>
              <span className="font-semibold">{fmtRupees(subscription.codDue)} cash to collect</span>
              {subscription.onCredit
                ? " — meals continue on credit until it's recorded."
                : " — first day was paid online; record the cash the day it's collected or the next meals are skipped for low balance."}
            </span>
          </div>
          <button
            onClick={() => setModal("cash")}
            className="px-3 py-1.5 rounded-lg bg-[#1B5E20] text-white text-xs font-medium hover:bg-[#155116]"
          >
            Record cash received
          </button>
          {subscription.cashReports.map((r) => (
            <div key={r.id} className="basis-full flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white border border-amber-200 px-3 py-2 text-sm">
              <span className="text-amber-900">
                <span className="font-semibold">{fmtRupees(r.amount)}</span> collected by {r.partner} ·{" "}
                {new Date(r.reportedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                {r.note ? ` · ${r.note}` : ""}
              </span>
              <span className="flex gap-1.5">
                <button
                  disabled={isPending}
                  onClick={() => act(() => recordCashReport(r.id), false)}
                  className="px-2.5 py-1 rounded-md bg-[#1B5E20] text-white text-xs font-medium hover:bg-[#155116] disabled:opacity-40"
                >
                  Record {fmtRupees(r.amount)}
                </button>
                <button
                  disabled={isPending}
                  onClick={() => { if (window.confirm("Dismiss this report? Nothing is recorded.")) act(() => dismissCashReport(r.id), false) }}
                  className="px-2.5 py-1 rounded-md border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  Dismiss
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ─── Left col (3/5) ─── */}
        <div className="lg:col-span-3 space-y-6">

          {/* Subscription card */}
          <Card>
            <CardHeader title="Subscription" action={!isCancelled ? { label: "Edit plan", onClick: () => setModal("plan") } : undefined} />
            <div className="px-5 pb-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-[#1A1A1A]">{subscription.planName}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {subscription.mealsTotal} meals · {fmtRupees(planPrice)}
                    {subscription.paymentMethod === "cod" && " · cash on delivery"}
                  </p>
                  {subscription.couponMealPrice != null && (
                    <p className="text-xs text-[#1B5E20] mt-0.5">
                      Coupon {subscription.couponCode ?? ""} · {fmtRupees(subscription.couponMealPrice)}/meal
                      <span className="text-gray-400"> (regular {fmtRupees(regularMealRate)})</span>
                    </p>
                  )}
                  {isPendingPlan && (
                    <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 mt-2 inline-flex items-center gap-1.5">
                      Not paid yet — no meals are scheduled. Use &quot;Activate plan&quot; once they&apos;ve paid or agreed cash on delivery.
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold text-[#1B5E20]">{subscription.deliveriesRemaining}</p>
                  <p className="text-xs text-gray-400">meals left</p>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#1B5E20] rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-sm">
                {subscription.mealsLunch > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs">
                    {subscription.mealsLunch} lunch{subscription.mealsLunch > 1 ? "es" : ""} / day
                  </span>
                )}
                {subscription.mealsDinner > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs">
                    {subscription.mealsDinner} dinner{subscription.mealsDinner > 1 ? "s" : ""} / day
                  </span>
                )}
                {addons.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs">
                    {a.name} +{fmtRupees(a.price_per_meal)}/meal
                  </span>
                ))}
              </div>

              <div className="pt-1">
                <label className="text-xs text-gray-400 uppercase tracking-wide block mb-2">Delivery Days</label>
                {takesEveryDay ? (
                  <span className="text-sm text-[#1A1A1A]">All days <span className="text-xs text-gray-400">(no fixed schedule set)</span></span>
                ) : (
                  <div className="flex gap-1.5">
                    {DOW_ORDER.map((d) => {
                      const active = subscription.deliveryDays.includes(d)
                      return (
                        <span key={d} className={cn("w-9 h-9 flex items-center justify-center rounded-lg text-xs font-semibold", active ? "bg-[#1B5E20] text-white" : "bg-gray-100 text-gray-300")}>
                          {d}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 pt-1">
                <InfoRow label="First delivery" value={fmtDate(subscription.startDate)} />
                <InfoRow label="Delivery mode"  value={subscription.deliveryMode === "opt-in" ? "Opt-in" : "Opt-out"} />
                <InfoRow label="Wallet balance" value={walletBalance !== null ? fmtRupees(walletBalance) : "—"} />
                {perDayCost > 0 && <InfoRow label="Default cart/day" value={fmtRupees(perDayCost)} />}
                {isPaused && (
                  <>
                    <InfoRow label="Paused from"  value={fmtDate(subscription.pauseFrom)} />
                    <InfoRow label="Paused until" value={fmtDate(subscription.pauseUntil)} highlight />
                  </>
                )}
              </div>
            </div>
          </Card>

          {/* Earlier days never marked (068) — open one to mark delivered or skip */}
          {unmarked.length > 0 && (
            <Card>
              <CardHeader title={`Not marked yet — earlier days (${unmarked.length})`} icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-600" />} />
              <div className="px-5 pb-5">
                <p className="text-xs text-gray-500 mb-2">
                  These were never marked delivered, so the wallet wasn&apos;t charged. Open one to mark it delivered, or skip it if it didn&apos;t go.
                </p>
                <div className="divide-y divide-amber-200 border border-amber-200 rounded-lg bg-amber-50/40">
                  {Array.from(new Set(unmarked.map((o) => `${o.date}|${o.slot}`))).map((key) => {
                    const [date, slot] = key.split("|") as [string, "lunch" | "dinner"]
                    const items = unmarked.filter((o) => o.date === date && o.slot === slot)
                    return (
                      <button
                        key={key}
                        onClick={() => setEditing({ subscriptionId, date, slot })}
                        className="w-full text-left px-3 py-2.5 hover:bg-amber-50 flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-amber-800">{fmtDay(date)} · {slot === "lunch" ? "Lunch" : "Dinner"}</p>
                          <p className="text-sm text-[#1A1A1A] truncate">
                            {items.map((o) => `${o.extra ? "+ " : ""}${o.mealName}${o.quantity > 1 ? ` ×${o.quantity}` : ""}`).join(", ")}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-amber-800 shrink-0">Settle</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </Card>
          )}

          {/* Upcoming meals — every one editable */}
          <Card>
            <CardHeader title="Upcoming meals (next 2 weeks)" icon={<CalendarDays className="w-3.5 h-3.5" />} />
            <div className="px-5 pb-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400 uppercase tracking-wide">Fixed dishes</span>
                {rules.length === 0 && <span className="text-xs text-gray-400">none — weekly menu</span>}
                {rules.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#E8F5E9] text-[#1B5E20] text-xs">
                    <Pin className="w-3 h-3" />
                    {r.slot === "lunch" ? "Lunch" : "Dinner"} {r.dayOfWeek === null ? "every day" : `on ${DAY_NAMES[r.dayOfWeek]}`}: <b>{r.mealName}</b>
                    <button
                      disabled={isPending}
                      title="Remove (upcoming meals go back to the weekly menu)"
                      onClick={() => act(() => clearFixedDish(subscriptionId, r.id, true), false)}
                      className="ml-0.5 text-[#1B5E20]/60 hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <button onClick={() => setModal("fixed")} className="text-xs font-medium text-[#1B5E20] hover:underline">+ Fixed dish</button>
              </div>

              {slots.size === 0 ? (
                <p className="text-sm text-gray-400">Nothing scheduled in the next 2 weeks.</p>
              ) : (
                <div className="divide-y divide-[#e2e8d5] border border-[#e2e8d5] rounded-lg">
                  {Array.from(slots.entries()).map(([key, items]) => {
                    const [date, slot] = key.split("|") as [string, "lunch" | "dinner"]
                    return (
                      <button
                        key={key}
                        onClick={() => setEditing({ subscriptionId, date, slot })}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#F9FBF7] flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-500">{fmtDay(date)} · {slot === "lunch" ? "Lunch" : "Dinner"}</p>
                          {items.map((o) => (
                            <p key={o.id} className={cn("text-sm", ORDER_STATUS[o.status] ?? "text-gray-600")}>
                              <span className="text-[#1A1A1A]">{o.extra && "+ "}{o.mealName}</span>
                              {o.quantity > 1 && <span className="text-gray-400"> ×{o.quantity}</span>}
                              {o.addons.length > 0 && <span className="text-xs text-gray-400"> · {o.addons.join(", ")}</span>}
                              <span className="text-xs text-gray-400"> → {o.addressLabel}</span>
                              {o.status !== "scheduled" && o.status !== "confirmed" && (
                                <span className="ml-1.5 text-[10px] uppercase font-semibold">{o.status === "skipped" ? `skipped${o.skipReason === "user" ? " by them" : ""}` : o.status.replace(/_/g, " ")}</span>
                              )}
                            </p>
                          ))}
                        </div>
                        <span className="text-xs font-medium text-[#1B5E20] shrink-0">Edit</span>
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-gray-400">Click a meal to change the dish, portions, add-ons, address, skip it or bring it back. The Kitchen page has the same editor for everyone.</p>
            </div>
          </Card>

          {/* Weekly menu */}
          <Card>
            <CardHeader title="Weekly menu" icon={<Utensils className="w-3.5 h-3.5" />} />
            <div className="px-5 pb-5">
              {weeklyMenu.length === 0 ? (
                <p className="text-sm text-gray-400">No weekly menu set yet — set it on the Kitchen page.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#e2e8d5]">
                        {["Day", "Lunch", "Dinner"].map((h) => (
                          <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide py-2.5 pr-4 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DOW_ORDER.map((dow, idx) => {
                        const day = menuByDay.get(idx) ?? {}
                        const active = takesDelivery(idx)
                        const cell = (entry: WeeklyMenuEntry | undefined, qty: number) => {
                          if (qty <= 0) return <span className="text-xs text-gray-300">Not on plan</span>
                          if (!entry?.mealName) return <span className="text-xs text-gray-300">—</span>
                          return (
                            <div>
                              <span className="text-[#1A1A1A]">{entry.mealName}</span>
                              {qty > 1 && <span className="ml-1.5 text-xs font-semibold text-[#1B5E20]">×{qty}</span>}
                            </div>
                          )
                        }
                        return (
                          <tr key={dow} className={cn("border-b border-[#e2e8d5] last:border-0", !active && "opacity-40")}>
                            <td className="py-2.5 pr-4 whitespace-nowrap align-top">
                              <span className="font-medium text-[#1A1A1A]">{dow}</span>
                              {!active && <p className="text-xs text-gray-400">No delivery</p>}
                            </td>
                            <td className="py-2.5 pr-4 align-top">{cell(day.lunch, subscription.mealsLunch)}</td>
                            <td className="py-2.5 pr-4 align-top">{cell(day.dinner, subscription.mealsDinner)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          {/* Wallet ledger */}
          <Card>
            <CardHeader title="Wallet History" icon={<Wallet className="w-3.5 h-3.5" />} action={{ label: "Adjust wallet", onClick: () => setModal("wallet") }} />
            <div className="px-5 pb-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
              <div>
                <span className="text-gray-400">Balance </span>
                <span className="font-semibold text-[#1A1A1A]">{walletBalance !== null ? fmtRupees(walletBalance) : "—"}</span>
              </div>
              <div>
                <span className="text-gray-400">Credited </span>
                <span className="font-semibold text-green-700">{fmtRupees(walletCredited)}</span>
              </div>
              <div>
                <span className="text-gray-400">Spent </span>
                <span className="font-semibold text-[#1A1A1A]">{fmtRupees(walletDebited)}</span>
              </div>
            </div>
            {walletTransactions.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-gray-400">No wallet activity yet.</p>
            ) : (
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-[#e2e8d5]">
                      {["Date", "Type", "Amount", "Reason"].map((h) => (
                        <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-2.5 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {walletTransactions.map((t, i) => (
                      <tr key={t.id} className={cn("border-b border-[#e2e8d5] last:border-0", i % 2 === 1 && "bg-[#fafcf8]")}>
                        <td className="px-5 py-3 whitespace-nowrap text-gray-500">
                          {new Date(t.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                        </td>
                        <td className="px-5 py-3">
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", t.type === "credit" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                            {t.type}
                          </span>
                        </td>
                        <td className={cn("px-5 py-3 font-semibold whitespace-nowrap", t.type === "credit" ? "text-green-700" : "text-[#1A1A1A]")}>
                          {t.type === "credit" ? "+" : "−"}{fmtRupees(t.amount)}
                        </td>
                        <td className="px-5 py-3 text-gray-600">{t.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                      {["Date", "Amount", "Status", "How"].map((h) => (
                        <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-2.5 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, i) => (
                      <tr key={p.id} className={cn("border-b border-[#e2e8d5] last:border-0", i % 2 === 1 && "bg-[#fafcf8]")}>
                        <td className="px-5 py-3 whitespace-nowrap text-gray-600">{fmtDate(p.created_at)}</td>
                        <td className="px-5 py-3 font-semibold text-[#1A1A1A]">{fmtRupees(p.amount)}</td>
                        <td className="px-5 py-3">
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", PAY_STATUS_STYLES[p.status] ?? "bg-gray-100 text-gray-600")}>
                            {p.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-gray-400 truncate max-w-[160px]" title={p.cf_payment_id ?? ""}>
                          {p.cf_order_id ? (p.cf_payment_id ?? "Cashfree") : "Cash / recorded by admin"}
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

          {/* Addresses + their batches */}
          <Card>
            <CardHeader
              title="Delivery Addresses"
              icon={<MapPin className="w-3.5 h-3.5" />}
              action={{ label: "Add", onClick: () => { setEditingAddress({ label: "", type: "home", line1: "", landmark: "", pincode: "", timeWindow: "" }); setModal("address") } }}
            />
            <div className="px-5 pb-5 space-y-3">
              {addresses.length === 0 ? (
                <p className="text-sm text-gray-400">No address on file — meals can&apos;t be delivered.</p>
              ) : addresses.map((addr: any) => {
                const missing = (subscription.mealsLunch > 0 && !addr.batch_id_lunch) || (subscription.mealsDinner > 0 && !addr.batch_id_dinner)
                return (
                  <div key={addr.id} className={cn("text-sm border rounded-lg p-3 space-y-2", missing && addr.is_default ? "border-red-300 bg-red-50/40" : "border-[#e2e8d5]")}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#1A1A1A]">{addr.label || addr.type}</span>
                        {addr.is_default && (
                          <span className="text-xs bg-[#E8F5E9] text-[#1B5E20] px-1.5 py-0.5 rounded-full font-medium">Default</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {!addr.is_default && (
                          <button
                            title="Make default"
                            disabled={isPending}
                            onClick={() => {
                              const move = window.confirm("Send all upcoming meals to this address too?\n\nOK = yes, move them · Cancel = only new meals")
                              act(() => makeDefaultAddress(subscriptionId, addr.id, move), false)
                            }}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-[#1B5E20]"
                          >
                            <Star className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          title="Edit"
                          onClick={() => {
                            setEditingAddress({ id: addr.id, label: addr.label ?? "", type: addr.type ?? "home", line1: addr.line1 ?? "", landmark: addr.landmark ?? "", pincode: addr.pincode ?? "", timeWindow: addr.time_window ?? "" })
                            setModal("address")
                          }}
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-[#1B5E20]"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Remove"
                          disabled={isPending}
                          onClick={() => window.confirm("Remove this address? Upcoming meals going there move to their other address.") && act(() => removeCustomerAddress(subscriptionId, addr.id), false)}
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-gray-600">{addr.line1}</p>
                    {addr.landmark && <p className="text-gray-500 text-xs">Near: {addr.landmark}</p>}
                    {addr.time_window && (
                      <p className="text-gray-500 text-xs flex items-center gap-1"><Clock className="w-3 h-3" />{addr.time_window}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {([["lunch", lunchBatches, addr.batch_id_lunch], ["dinner", dinnerBatches, addr.batch_id_dinner]] as const).map(([slot, list, current]) => (
                        <label key={slot} className="text-xs text-gray-500">
                          <span className="capitalize">{slot} batch</span>
                          <select
                            value={current ?? ""}
                            disabled={isPending}
                            onChange={(e) => act(async () => {
                              await setAddressBatch(addr.id, slot, e.target.value || null)
                              return { ok: true as const, message: `${slot === "lunch" ? "Lunch" : "Dinner"} batch saved — upcoming meals to this address moved.` }
                            }, false)}
                            className={cn("mt-1 w-full h-8 rounded-lg border bg-white px-2 text-xs", !current ? "border-red-300 text-red-700" : "border-[#e2e8d5] text-[#1A1A1A]")}
                          >
                            <option value="">Needs a batch</option>
                            {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Food preferences */}
          <Card>
            <CardHeader title="Food Preferences" icon={<Utensils className="w-3.5 h-3.5" />} action={{ label: "Edit", onClick: () => setModal("dietary") }} />
            <div className="px-5 pb-5 space-y-3 text-sm">
              <InfoRow label="Diet" value={dietaryValue.dietary_preference && dietaryValue.dietary_preference !== "none" ? dietaryValue.dietary_preference : "No restriction"} />
              {dietaryValue.health_goal && <InfoRow label="Goal" value={dietaryValue.health_goal} />}
              <TagList label="Allergies" items={dietaryValue.allergens} tone="red" />
              <TagList label="Avoid" items={[...dietaryValue.base_avoidance, ...dietaryValue.veggie_avoidance]} tone="amber" />
              <TagList label="Preferred protein" items={dietaryValue.protein_preference} tone="green" />
              {(dietaryValue.spice_preference || dietaryValue.dressing_preference) && (
                <InfoRow
                  label="Spice / dressing"
                  value={[dietaryValue.spice_preference, dietaryValue.dressing_preference?.replace(/-/g, " ")].filter(Boolean).join(" · ")}
                />
              )}
              {dietaryValue.free_text && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Notes for the kitchen</p>
                  <p className="text-gray-600 leading-relaxed">{dietaryValue.free_text}</p>
                </div>
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
                placeholder="Internal notes, delivery instructions, follow-ups... (shows as Note on the Operations sheets)"
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

      {modal === "pause" && (
        <ModalOverlay onClose={() => setModal(null)}>
          <ModalCard title="Pause subscription" onClose={() => setModal(null)}>
            <div className="space-y-4">
              <Field label="Pause from">
                <input type="date" min={today()} value={pauseFrom} onChange={(e) => setPauseFrom(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Pause until">
                <input type="date" min={pauseFrom || today()} value={pauseUntil} onChange={(e) => setPauseUntil(e.target.value)} className={inputCls} />
              </Field>
              <p className="text-xs text-gray-400">All scheduled orders in this range will be cancelled.</p>
            </div>
            <ModalFooter>
              <GhostBtn onClick={() => setModal(null)}>Cancel</GhostBtn>
              <PrimaryBtn
                disabled={!pauseFrom || !pauseUntil || isPending}
                onClick={() => run(() => pauseSubscription(subscriptionId, pauseFrom, pauseUntil), "Subscription paused.", () => setModal(null))}
              >
                Confirm Pause
              </PrimaryBtn>
            </ModalFooter>
          </ModalCard>
        </ModalOverlay>
      )}

      {modal === "extend" && (
        <ModalOverlay onClose={() => setModal(null)}>
          <ModalCard title="Extend plan" onClose={() => setModal(null)}>
            <div className="space-y-4">
              <Field label="Meals to add">
                <input type="number" min={1} max={90} value={extendMeals} onChange={(e) => setExtendMeals(Number(e.target.value))} className={inputCls} />
              </Field>
              <p className="text-sm text-gray-500">
                Current: <strong>{subscription.deliveriesRemaining}</strong> → New total:{" "}
                <strong>{subscription.deliveriesRemaining + extendMeals}</strong>
              </p>
            </div>
            <ModalFooter>
              <GhostBtn onClick={() => setModal(null)}>Cancel</GhostBtn>
              <PrimaryBtn
                disabled={extendMeals < 1 || isPending}
                onClick={() => run(() => extendSubscription(subscriptionId, extendMeals), `Added ${extendMeals} meals.`, () => setModal(null))}
              >
                Confirm Extension
              </PrimaryBtn>
            </ModalFooter>
          </ModalCard>
        </ModalOverlay>
      )}

      {modal === "cancel" && (
        <ModalOverlay onClose={() => setModal(null)}>
          <ModalCard title="Cancel subscription?" onClose={() => setModal(null)}>
            <p className="text-sm text-gray-600 leading-relaxed">
              All upcoming scheduled orders will be cancelled. This cannot be undone from the app.
            </p>
            <ModalFooter>
              <GhostBtn onClick={() => setModal(null)}>Keep it</GhostBtn>
              <DangerBtn
                disabled={isPending}
                onClick={() => run(() => cancelSubscription(subscriptionId), "Subscription cancelled.", () => setModal(null))}
              >
                Cancel Plan
              </DangerBtn>
            </ModalFooter>
          </ModalCard>
        </ModalOverlay>
      )}

      {modal === "identity" && (
        <IdentityModal
          initial={{ name: user.name, phone: user.phone, email: user.email }}
          pending={isPending}
          onClose={() => setModal(null)}
          onSave={(v) => act(() => updateCustomerIdentity(subscriptionId, user.id, v))}
        />
      )}

      {modal === "plan" && (
        <PlanModal
          initial={{
            planId: subscription.planId,
            mealsLunch: subscription.mealsLunch,
            mealsDinner: subscription.mealsDinner,
            days: subscription.deliveryDays,
            addonIds: addons.map((a) => a.id),
            startDate: subscription.startDate,
            mealsLeft: subscription.deliveriesRemaining,
            deliveryMode: subscription.deliveryMode === "opt-in" ? "opt-in" : "opt-out",
          }}
          plans={catalogue.plans}
          addons={catalogue.addons}
          pending={isPending}
          onClose={() => setModal(null)}
          onSave={(v) => act(() => updatePlanSettings(subscriptionId, v))}
        />
      )}

      {modal === "dietary" && (
        <DietaryModal
          initial={dietaryValue}
          pending={isPending}
          onClose={() => setModal(null)}
          onSave={(v) => act(() => saveDietaryProfile(subscriptionId, user.id, v))}
        />
      )}

      {modal === "address" && editingAddress && (
        <AddressModal
          initial={editingAddress}
          pending={isPending}
          onClose={() => { setModal(null); setEditingAddress(null) }}
          onSave={(v) => act(() => saveCustomerAddress(subscriptionId, user.id, v))}
        />
      )}

      {modal === "wallet" && (
        <WalletModal
          balance={walletBalance}
          pending={isPending}
          onClose={() => setModal(null)}
          onSave={(amount, direction, reason) => act(() => adjustWallet(subscriptionId, user.id, amount, direction, reason))}
        />
      )}

      {modal === "cash" && (
        <CashModal
          due={subscription.codDue}
          pending={isPending}
          onClose={() => setModal(null)}
          onRecord={(amount) => act(() => recordCashPayment(subscriptionId, amount))}
          onSetDue={(due, onCredit) => act(() => setCashDue(subscriptionId, due, onCredit))}
        />
      )}

      {modal === "activate" && (
        <ActivateModal
          total={planPrice}
          pending={isPending}
          onClose={() => setModal(null)}
          onSave={(paid, due) => act(() => activatePendingPlan(subscriptionId, paid, due))}
        />
      )}

      {modal === "fixed" && (
        <FixedDishModal
          meals={catalogue.meals}
          pending={isPending}
          onClose={() => setModal(null)}
          onSave={(slot, day, meal) => act(() => setFixedDish(subscriptionId, slot, day, meal))}
        />
      )}

      <OrderEditor
        key={editing ? `${editing.subscriptionId}|${editing.date}|${editing.slot}` : "closed"}
        target={editing}
        meals={catalogue.meals}
        addons={catalogue.addons}
        onClose={() => setEditing(null)}
        onChanged={() => router.refresh()}
      />

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white max-w-[90vw]",
          toast.type === "success" ? "bg-[#1B5E20]" : "bg-red-600"
        )}>
          {toast.type === "success" ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
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

function CardHeader({ title, icon, action }: { title: string; icon?: React.ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="px-5 py-3.5 border-b border-[#e2e8d5] bg-[#F9FBF7] flex items-center gap-2 mb-4">
      {icon && <span className="text-gray-400">{icon}</span>}
      <h2 className="font-semibold text-[#1A1A1A] text-sm">{title}</h2>
      {action && (
        <button onClick={action.onClick} className="ml-auto text-xs font-medium text-[#1B5E20] hover:underline">
          {action.label}
        </button>
      )}
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

function TagList({ label, items, tone }: { label: string; items: string[]; tone: "red" | "amber" | "green" }) {
  if (!items.length) return null
  const cls = { red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-700", green: "bg-[#E8F5E9] text-[#1B5E20]" }[tone]
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((a) => <span key={a} className={cn("px-2 py-0.5 text-xs rounded-full font-medium", cls)}>{a}</span>)}
      </div>
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
