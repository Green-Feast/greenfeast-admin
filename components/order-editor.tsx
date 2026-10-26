"use client"

// The drawer behind every editable meal cell (Kitchen calendar, subscriber
// profile → Upcoming meals): one customer, one day, one slot — dish,
// portions, add-ons, address, skip / bring back, extra dishes, and the
// "same dish every day" rule. Server side: app/(admin)/kitchen/order-actions.ts.
// Any day up to today also gets Delivery: mark delivered, skip with no
// charge, or undo a wrong "delivered" (068) — for days ops forgot to mark.

import { useEffect, useMemo, useState, useTransition } from "react"
import { X, Loader2, Minus, Plus, AlertTriangle, Pin, Search, Trash2, RotateCcw, MapPin, CheckCircle2, Ban, Undo2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { istToday } from "@/lib/ist"
import {
  getSlotContext,
  adminSetOrderDish,
  adminSetOrderQuantity,
  adminSetOrderAddress,
  adminSetAddonQty,
  adminSkipSlot,
  adminUnskipSlot,
  adminAddExtraDish,
  adminRemoveExtraDish,
  adminDeliverSlot,
  adminSkipUndelivered,
  adminUndoDelivered,
  setFixedDish,
  clearFixedDish,
  type SlotContext,
  type SlotOrder,
  type EditResult,
} from "@/app/(admin)/kitchen/order-actions"

export type EditorTarget = { subscriptionId: string; date: string; slot: "lunch" | "dinner" }
export type EditorMeal = { id: string; name: string; category: string }
export type EditorAddon = { id: string; name: string; price_per_meal: number }

const DOW = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]
const SKIP_REASON: Record<string, string> = {
  user: "skipped by the customer",
  admin: "skipped by GreenFeast",
  insufficient_balance: "skipped — wallet was short",
  plan_finished: "skipped — plan had finished",
  not_delivered: "couldn't be delivered",
}

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}

function dayLabel(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })
}

function dowMon0(date: string) {
  return (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7
}

export function OrderEditor({
  target,
  meals,
  addons,
  onClose,
  onChanged,
}: {
  target: EditorTarget | null
  meals: EditorMeal[]
  addons: EditorAddon[]
  onClose: () => void
  onChanged: () => void
}) {
  const [ctx, setCtx] = useState<SlotContext | null>(null)
  const [loadError, setLoadError] = useState("")
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // Dish picker: which order it changes, or "new" for an extra dish.
  const [picking, setPicking] = useState<string | "new" | null>(null)
  const [query, setQuery] = useState("")
  const [newAddress, setNewAddress] = useState<string>("")
  const [backToMenu, setBackToMenu] = useState(true)

  async function load() {
    if (!target) return
    try {
      const c = await getSlotContext(target.subscriptionId, target.date, target.slot)
      setCtx(c)
      setLoadError("")
      setNewAddress((prev) => prev || c.addresses[0]?.id || "")
    } catch (e: any) {
      setLoadError(e?.message ?? "Could not load this meal.")
    }
  }

  // Parents mount a fresh editor per meal (key), so this only loads.
  useEffect(() => {
    if (!target) return
    let cancelled = false
    getSlotContext(target.subscriptionId, target.date, target.slot)
      .then((c) => {
        if (cancelled) return
        setCtx(c)
        setNewAddress(c.addresses[0]?.id ?? "")
      })
      .catch((e) => { if (!cancelled) setLoadError(e?.message ?? "Could not load this meal.") })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function run(action: () => Promise<EditResult>) {
    setMessage(null)
    startTransition(async () => {
      const res = await action()
      if (!res.ok) {
        setMessage({ ok: false, text: res.error })
        return
      }
      if (res.message) setMessage({ ok: true, text: res.message })
      setPicking(null)
      setQuery("")
      await load()
      onChanged()
    })
  }

  const filteredMeals = useMemo(() => {
    const q = query.trim().toLowerCase()
    return meals.filter((m) => !q || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q))
  }, [meals, query])

  if (!target) return null

  const open = ctx?.orders.filter((o) => ["scheduled", "confirmed"].includes(o.status)) ?? []
  const skipped = ctx?.orders.filter((o) => o.status === "skipped") ?? []
  const settled = ctx?.orders.filter((o) => !["scheduled", "confirmed", "skipped"].includes(o.status)) ?? []
  const dayCost = open.reduce((s, o) => s + (o.cartTotal ?? 0), 0)
  const base = open.find((o) => !o.extraDish) ?? open[0] ?? null
  const weekday = dowMon0(target.date)
  const dayRule = ctx?.rules.find((r) => r.dayOfWeek === weekday) ?? null
  const everyRule = ctx?.rules.find((r) => r.dayOfWeek === null) ?? null
  const slotLabel = target.slot === "lunch" ? "Lunch" : "Dinner"
  // Delivery (068): any day up to today.
  const today = istToday()
  const deliveryDay = target.date <= today
  const pastDay = target.date < today
  const undelivered = ctx?.orders.filter((o) => ["scheduled", "confirmed", "preparing", "out_for_delivery"].includes(o.status)) ?? []
  const undeliveredCost = undelivered.reduce((s, o) => s + (o.cartTotal ?? 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg h-full bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e2e8d5] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#1B5E20] uppercase tracking-wide">{slotLabel} · {dayLabel(target.date)}</p>
            <h2 className="text-lg font-bold text-[#1A1A1A] truncate">{ctx?.customerName ?? "Loading…"}</h2>
            {ctx && (
              <p className="text-xs text-gray-500 mt-0.5">
                Wallet {rupees(ctx.walletBalance)}
                {dayCost > 0 && <> · this {target.slot} costs {rupees(dayCost)}</>}
                {ctx.onCredit && <span className="ml-1 text-amber-700">· cash on delivery (on credit)</span>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}
          {!ctx && !loadError && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-16">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {ctx && (
            <>
              {ctx.locked && open.length > 0 && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                  <span>Past the {target.slot === "lunch" ? "8 AM" : "1 PM"} cutoff — the kitchen sheet may already be printed. Tell the kitchen about any change.</span>
                </div>
              )}
              {!ctx.onCredit && dayCost > ctx.walletBalance && open.length > 0 && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                  <span>The wallet ({rupees(ctx.walletBalance)}) doesn&apos;t cover this {target.slot} ({rupees(dayCost)}) — it gets skipped at cutoff or delivery unless they top up.</span>
                </div>
              )}

              {message && (
                <p className={cn("text-sm px-3 py-2 rounded-lg", message.ok ? "bg-green-50 text-[#1B5E20]" : "bg-red-50 text-red-700")}>{message.text}</p>
              )}

              {/* Delivery — today or an earlier day ops forgot to mark */}
              {deliveryDay && undelivered.length > 0 && (
                <div className={cn("rounded-xl border p-3 space-y-2", pastDay ? "border-amber-300 bg-amber-50/60" : "border-[#1B5E20]/30 bg-green-50/40")}>
                  <p className={cn("text-xs font-semibold uppercase tracking-wide", pastDay ? "text-amber-800" : "text-[#1B5E20]")}>
                    {pastDay ? "Not marked yet" : "Delivery"}
                  </p>
                  <p className="text-xs text-gray-600">
                    {pastDay
                      ? `This ${target.slot} was never marked. If it went out, mark it delivered — the wallet is charged ${rupees(undeliveredCost)} now (no message is sent for an earlier day). If it didn't, skip it — nothing is charged.`
                      : `Marking it delivered charges the wallet ${rupees(undeliveredCost)} and tells the customer.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Mark ${ctx.customerName}'s ${target.slot} on ${dayLabel(target.date)} delivered? ${rupees(undeliveredCost)} is charged to their wallet.`)) return
                        run(() => adminDeliverSlot(target.subscriptionId, target.date, target.slot))
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1B5E20] text-white text-xs font-medium disabled:opacity-40"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Mark delivered
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Skip ${ctx.customerName}'s ${target.slot} on ${dayLabel(target.date)}? Nothing is charged and the meal stays on their plan.`)) return
                        run(() => adminSkipUndelivered(target.subscriptionId, target.date, target.slot))
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e2e8d5] bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      <Ban className="w-3.5 h-3.5" /> {pastDay ? "Didn't go — skip, no charge" : "Skip, no charge"}
                    </button>
                  </div>
                </div>
              )}

              {/* In the kitchen / on its way / delivered */}
              {settled.map((o) => (
                <div key={o.id} className="rounded-xl border border-[#e2e8d5] bg-gray-50 p-3 text-sm">
                  <p className="font-medium text-[#1A1A1A]">{o.mealName} {o.quantity > 1 && <span className="text-gray-500">×{o.quantity}</span>}</p>
                  <p className="text-xs text-gray-500 capitalize mt-0.5">
                    {o.status.replace(/_/g, " ")}{o.status === "delivered" ? "" : " — dish and portions can't be changed now"}
                  </p>
                  {o.status === "delivered" && (
                    <button
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Undo — ${ctx.customerName}'s ${o.mealName} on ${dayLabel(target.date)} wasn't delivered? What it was charged goes back to their wallet, the meal goes back on their plan, and they're told.`)) return
                        run(() => adminUndoDelivered(o.id))
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-red-200 bg-white text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
                    >
                      <Undo2 className="w-3 h-3" /> Undo — it wasn&apos;t delivered
                    </button>
                  )}
                </div>
              ))}

              {/* Editable meals */}
              {open.map((o) => (
                <OrderCard
                  key={o.id}
                  order={o}
                  ctx={ctx}
                  addons={addons}
                  pending={pending}
                  onPickDish={() => { setPicking(o.id); setQuery("") }}
                  run={run}
                />
              ))}

              {/* Skipped */}
              {skipped.length > 0 && open.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm">
                  <p className="font-medium text-[#1A1A1A]">{skipped.map((o) => o.mealName).join(", ")}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{SKIP_REASON[skipped[0].skipReason ?? ""] ?? "skipped"} — nothing is charged.</p>
                  <button
                    disabled={pending}
                    onClick={() => run(() => adminUnskipSlot(target.subscriptionId, target.date, target.slot))}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1B5E20] text-white text-xs font-medium disabled:opacity-40"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Bring this meal back
                  </button>
                </div>
              )}

              {open.length === 0 && skipped.length === 0 && settled.length === 0 && (
                <p className="text-sm text-gray-500">No {target.slot} on this day.</p>
              )}

              {/* Add a dish (extra) */}
              {target.date >= istToday() && (
                <div className="rounded-xl border border-[#e2e8d5] p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {open.length > 0 ? "Add another dish" : `Add a ${target.slot}`}
                  </p>
                  <div className="flex gap-2">
                    <select
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      className="flex-1 h-9 rounded-lg border border-[#e2e8d5] bg-white px-2 text-sm"
                    >
                      {ctx.addresses.map((a) => (
                        <option key={a.id} value={a.id}>{a.label} — {a.line1.slice(0, 40)}</option>
                      ))}
                      {ctx.addresses.length === 0 && <option value="">No address on file</option>}
                    </select>
                    <button
                      onClick={() => { setPicking("new"); setQuery("") }}
                      className="h-9 px-3 rounded-lg border border-[#1B5E20] text-[#1B5E20] text-sm font-medium hover:bg-green-50"
                    >
                      Pick dish
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400">Charged at the plan&apos;s per-meal rate on delivery and counts as one meal. Use it to send a portion to a second address.</p>
                </div>
              )}

              {/* Same dish every day */}
              <div className="rounded-xl border border-[#e2e8d5] p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Pin className="w-3.5 h-3.5" /> Fixed dish ({target.slot})
                </p>
                {ctx.rules.length === 0 && <p className="text-xs text-gray-500">None — they get the weekly menu.</p>}
                {ctx.rules.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="font-medium">{r.mealName}</span>{" "}
                      <span className="text-gray-500">{r.dayOfWeek === null ? "every day" : `on ${DOW[r.dayOfWeek]}`}</span>
                    </span>
                    <button
                      disabled={pending}
                      onClick={() => run(() => clearFixedDish(target.subscriptionId, r.id, backToMenu))}
                      className="text-xs text-red-600 hover:underline disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {ctx.rules.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    <input type="checkbox" checked={backToMenu} onChange={(e) => setBackToMenu(e.target.checked)} className="accent-[#1B5E20]" />
                    When removing, put upcoming meals back on the weekly menu
                  </label>
                )}
                {base && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      disabled={pending || everyRule?.mealTemplateId === base.mealTemplateId}
                      onClick={() => run(() => setFixedDish(target.subscriptionId, target.slot, null, base.mealTemplateId))}
                      className="px-3 py-1.5 rounded-lg border border-[#e2e8d5] text-xs font-medium hover:bg-gray-50 disabled:opacity-40"
                    >
                      {base.mealName} every day
                    </button>
                    <button
                      disabled={pending || dayRule?.mealTemplateId === base.mealTemplateId}
                      onClick={() => run(() => setFixedDish(target.subscriptionId, target.slot, weekday, base.mealTemplateId))}
                      className="px-3 py-1.5 rounded-lg border border-[#e2e8d5] text-xs font-medium hover:bg-gray-50 disabled:opacity-40"
                    >
                      {base.mealName} on {DOW[weekday]}
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-gray-400">Applies to every upcoming open {target.slot} now, and to new ones. The customer can still swap a day in the app.</p>
              </div>
            </>
          )}
        </div>

        {/* Dish picker */}
        {picking && ctx && (
          <div className="absolute inset-0 z-20 bg-white flex flex-col">
            <div className="px-5 py-4 border-b border-[#e2e8d5] flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search dishes…"
                className="flex-1 text-sm outline-none"
              />
              <button onClick={() => setPicking(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {filteredMeals.map((m) => (
                <button
                  key={m.id}
                  disabled={pending}
                  onClick={() => run(() =>
                    picking === "new"
                      ? adminAddExtraDish(target.subscriptionId, target.date, target.slot, m.id, newAddress || null)
                      : adminSetOrderDish(picking, m.id)
                  )}
                  className="w-full text-left px-5 py-2.5 text-sm hover:bg-green-50 disabled:opacity-40 flex items-center justify-between"
                >
                  <span>{m.name} <span className="text-xs text-gray-400">({m.category})</span></span>
                  {pending && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                </button>
              ))}
              {filteredMeals.length === 0 && <p className="p-5 text-sm text-gray-400">No dishes match.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OrderCard({
  order, ctx, addons, pending, onPickDish, run,
}: {
  order: SlotOrder
  ctx: SlotContext
  addons: EditorAddon[]
  pending: boolean
  onPickDish: () => void
  run: (action: () => Promise<EditResult>) => void
}) {
  const lines = new Map(order.addons.map((l) => [l.addonId, l]))
  // The live catalogue, plus anything on this meal that's since been switched off.
  const shown: EditorAddon[] = [
    ...addons,
    ...order.addons
      .filter((l) => !addons.some((a) => a.id === l.addonId))
      .map((l) => ({ id: l.addonId, name: l.name, price_per_meal: l.unitPrice ?? 0 })),
  ]
  const batchFor = (a: SlotContext["addresses"][number]) => (ctx.slot === "lunch" ? a.batchLunch : a.batchDinner)

  return (
    <div className="rounded-xl border border-[#e2e8d5] p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1A1A1A]">
            {order.mealName}
            {order.extraDish && <span className="ml-1.5 text-[10px] font-bold uppercase text-violet-600">extra</span>}
            {order.isCustomized && !order.extraDish && <span className="ml-1.5 text-[10px] font-bold uppercase text-amber-600">changed</span>}
          </p>
          <p className="text-xs text-gray-500">{order.cartTotal != null ? rupees(order.cartTotal) : "—"} on delivery</p>
        </div>
        <button onClick={onPickDish} disabled={pending} className="text-xs font-medium text-[#1B5E20] hover:underline disabled:opacity-40 shrink-0">
          Change dish
        </button>
      </div>

      {/* Portions */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Portions</span>
        <div className="flex items-center gap-2">
          <button
            disabled={pending}
            onClick={() => {
              if (order.quantity > 1) return run(() => adminSetOrderQuantity(order.id, order.quantity - 1))
              if (order.extraDish) {
                if (window.confirm("Remove this extra dish?")) run(() => adminRemoveExtraDish(order.id))
                return
              }
              if (window.confirm(`Skip this ${ctx.slot}? Nothing is charged and the meal stays on the plan.`)) {
                run(() => adminSkipSlot(ctx.subscriptionId, ctx.date, ctx.slot))
              }
            }}
            className="w-7 h-7 rounded-lg border border-[#e2e8d5] flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="w-6 text-center text-sm font-semibold">{order.quantity}</span>
          <button
            disabled={pending}
            onClick={() => run(() => adminSetOrderQuantity(order.id, order.quantity + 1))}
            className="w-7 h-7 rounded-lg border border-[#e2e8d5] flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Add-ons */}
      {shown.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs text-gray-500">Add-ons</span>
          {shown.map((a) => {
            const line = lines.get(a.id)
            const qty = line?.quantity ?? 0
            return (
              <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <span className={cn(qty > 0 ? "text-[#1A1A1A]" : "text-gray-400")}>
                  {a.name}
                  {line?.included && <span className="ml-1 text-[10px] text-[#1B5E20] font-semibold">with plan</span>}
                  <span className="ml-1 text-xs text-gray-400">{rupees(a.price_per_meal)}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={pending || qty === 0}
                    onClick={() => run(() => adminSetAddonQty(order.id, a.id, qty - 1))}
                    className="w-6 h-6 rounded-md border border-[#e2e8d5] flex items-center justify-center disabled:opacity-30"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-5 text-center text-xs font-semibold">{qty}</span>
                  <button
                    disabled={pending}
                    onClick={() => run(() => adminSetAddonQty(order.id, a.id, qty + 1))}
                    className="w-6 h-6 rounded-md border border-[#e2e8d5] flex items-center justify-center disabled:opacity-30"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Address */}
      <div className="space-y-1">
        <span className="text-xs text-gray-500 flex items-center gap-1"><MapPin className="w-3 h-3" /> Deliver to</span>
        <select
          value={order.addressId ?? ""}
          disabled={pending}
          onChange={(e) => e.target.value && run(() => adminSetOrderAddress(order.id, e.target.value))}
          className="w-full h-9 rounded-lg border border-[#e2e8d5] bg-white px-2 text-sm"
        >
          {!order.addressId && <option value="">No address</option>}
          {ctx.addresses.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} — {a.line1.slice(0, 36)} · {batchFor(a) ?? "no batch yet"}
            </option>
          ))}
        </select>
        {!order.batchName && (
          <p className="text-[11px] text-red-600">This address has no {ctx.slot} batch yet — assign one in Batches or Operations.</p>
        )}
      </div>

      {order.extraDish && (
        <button
          disabled={pending}
          onClick={() => window.confirm("Remove this extra dish?") && run(() => adminRemoveExtraDish(order.id))}
          className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" /> Remove extra dish
        </button>
      )}
    </div>
  )
}
