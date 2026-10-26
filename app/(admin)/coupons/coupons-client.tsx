"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  TicketPercent, Plus, Pencil, Pause, Play, Trash2, X, Copy, Check, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Shuffle, Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  audienceText, CODE_PATTERN, couponStatus, daysBetween, mealFromPct, mealFromTotal, normalizeCode, pctOff, pctText, planTotal,
  randomCode, regularMealPrice, rupees, STATUS_LABEL, validMealPrice,
  type CouponCustomer, type CouponPlan, type CouponRow, type CouponStatus, type CouponUse,
} from "@/lib/coupons"
import { saveCoupon, setCouponActive, deleteCoupon } from "./actions"

type Props = {
  coupons: CouponRow[]
  uses: CouponUse[]
  plans: CouponPlan[]
  customers: CouponCustomer[]
  today: string
  loadError: string | null
}

const STATUS_TONE: Record<CouponStatus, string> = {
  active: "bg-green-100 text-green-700",
  scheduled: "bg-blue-100 text-blue-700",
  ended: "bg-gray-100 text-gray-500",
  paused: "bg-amber-100 text-amber-800",
  used_up: "bg-gray-100 text-gray-500",
}

function day(date: string) {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}
function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function CouponsClient({ coupons, uses, plans, customers, today, loadError }: Props) {
  const [editing, setEditing] = useState<CouponRow | "new" | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  // One timer: a new message gets its full 4 s, not the end of the last one's.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const say = (ok: boolean, text: string) => {
    setToast({ ok, text })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <TicketPercent className="w-4 h-4 text-[#1B5E20]" />
        <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">Discounts</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Coupons</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            A coupon lowers the price of one meal on the 15- and 30-meal plans, so the whole plan costs less. Customers enter the code when they buy or renew a plan (never for wallet top-ups).
          </p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116]">
          <Plus className="w-4 h-4" /> New coupon
        </button>
      </div>

      {loadError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Couldn&apos;t load coupons: {loadError}</p>}

      <div className="mt-6 space-y-2">
        {coupons.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#e2e8d5] bg-white py-12 text-center">
            <TicketPercent className="w-7 h-7 mx-auto text-gray-300" />
            <p className="text-sm text-gray-500 mt-2">No coupons yet.</p>
            <button onClick={() => setEditing("new")} className="mt-3 text-sm font-medium text-[#1B5E20] hover:underline">Create the first one</button>
          </div>
        )}
        {coupons.map((c) => (
          <CouponCard
            key={c.id}
            c={c}
            plans={plans}
            uses={uses.filter((u) => u.couponId === c.id)}
            today={today}
            open={open === c.id}
            onToggle={() => setOpen(open === c.id ? null : c.id)}
            onEdit={() => setEditing(c)}
            say={say}
          />
        ))}
      </div>

      {editing && (
        <CouponEditor
          coupon={editing === "new" ? null : editing}
          plans={plans}
          customers={customers}
          today={today}
          onClose={() => setEditing(null)}
          say={say}
        />
      )}

      {toast && (
        <div className={cn("fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white", toast.ok ? "bg-[#1B5E20]" : "bg-red-600")}>
          {toast.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.text}
        </div>
      )}
    </div>
  )
}

// ── One coupon in the list ───────────────────────────────────────────────────

function CouponCard({
  c, plans, uses, today, open, onToggle, onEdit, say,
}: {
  c: CouponRow
  plans: CouponPlan[]
  uses: CouponUse[]
  today: string
  open: boolean
  onToggle: () => void
  onEdit: () => void
  say: (ok: boolean, text: string) => void
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const status = couponStatus(c, today)

  function toggleActive() {
    start(async () => {
      const res = await setCouponActive(c.id, !c.active)
      if (!res.ok) return say(false, res.error)
      say(true, c.active ? "Paused — the code stops working now." : "Resumed.")
      router.refresh()
    })
  }
  function remove() {
    start(async () => {
      const res = await deleteCoupon(c.id)
      if (!res.ok) return say(false, res.error)
      say(true, "Coupon deleted.")
      router.refresh()
    })
  }
  function copy() {
    navigator.clipboard?.writeText(c.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="rounded-xl border border-[#e2e8d5] bg-white">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-3">
        <div className="min-w-[180px]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold tracking-wide text-[#1A1A1A] bg-gray-100 rounded-md px-2 py-0.5">{c.code}</span>
            <button onClick={copy} className="text-gray-400 hover:text-gray-600" aria-label="Copy code">
              {copied ? <Check className="w-3.5 h-3.5 text-[#1B5E20]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold", STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>
          </div>
          {c.name && <p className="text-xs text-gray-500 mt-1">{c.name}</p>}
        </div>
        <div className="text-xs text-gray-600 min-w-[170px]">
          <p>{day(c.startsOn)} → {day(c.endsOn)}</p>
          <p className="text-gray-400">{daysBetween(c.startsOn, c.endsOn)} days · {audienceText(c)}</p>
        </div>
        <div className="text-xs text-gray-600 flex-1 min-w-[200px] space-y-0.5">
          {plans.map((p) => {
            const price = c.prices[p.id]
            if (!price) return null
            return (
              <p key={p.id}>
                <span className="text-gray-400">{p.meals_total} meals:</span>{" "}
                <span className="font-semibold text-[#1A1A1A]">{rupees(price)}</span>/meal{" "}
                <span className="text-[#1B5E20]">(−{pctText(pctOff(p, price))})</span>{" "}
                <span className="text-gray-400">· plan {rupees(planTotal(p, price))}</span>
              </p>
            )
          })}
        </div>
        <div className="text-xs text-gray-600 text-right min-w-[110px]">
          <p className="font-semibold text-[#1A1A1A]">{c.uses}{c.maxTotal ? ` / ${c.maxTotal}` : ""} used</p>
          {c.saved > 0 && <p className="text-gray-400">{rupees(c.saved)} off in total</p>}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <button onClick={onEdit} disabled={busy} className="h-8 px-2.5 rounded-lg border border-[#e2e8d5] text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Edit</button>
          <button onClick={toggleActive} disabled={busy} className="h-8 px-2.5 rounded-lg border border-[#e2e8d5] text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-1 disabled:opacity-40">
            {c.active ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Resume</>}
          </button>
          {c.uses === 0 && (confirmDelete ? (
            <span className="flex items-center gap-1">
              <button onClick={remove} disabled={busy} className="h-8 px-2.5 rounded-lg bg-red-600 text-white text-xs disabled:opacity-40">Delete</button>
              <button onClick={() => setConfirmDelete(false)} className="h-8 px-2 rounded-lg border border-[#e2e8d5] text-xs text-gray-600">Keep</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="h-8 w-8 rounded-lg border border-[#e2e8d5] text-gray-400 hover:text-red-600 flex items-center justify-center" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
          ))}
          <button onClick={onToggle} className="h-8 w-8 rounded-lg text-gray-400 hover:bg-gray-50 flex items-center justify-center" aria-label="Uses">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#e2e8d5] px-4 py-3 text-xs">
          <p className="text-gray-500 mb-2">
            {c.maxPerCustomer ? `${c.maxPerCustomer} use${c.maxPerCustomer === 1 ? "" : "s"} per customer` : "No limit per customer"} ·{" "}
            {c.maxTotal ? `${c.maxTotal} uses in total` : "no total limit"}
            {c.createdBy && <> · made by {c.createdBy}, {when(c.createdAt)}</>}
          </p>
          {uses.length === 0 ? (
            <p className="text-gray-400">Not used yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="py-1.5 font-medium">Customer</th>
                    <th className="py-1.5 font-medium">Plan</th>
                    <th className="py-1.5 font-medium">How</th>
                    <th className="py-1.5 font-medium text-right">Meal price</th>
                    <th className="py-1.5 font-medium text-right">Saved</th>
                    <th className="py-1.5 font-medium text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {uses.map((u) => (
                    <tr key={u.id} className="border-t border-gray-100">
                      <td className="py-1.5 text-gray-700">{u.name} <span className="text-gray-400">{u.code}</span></td>
                      <td className="py-1.5 text-gray-600">{u.meals} meals</td>
                      <td className="py-1.5 text-gray-600">{u.kind === "new" ? "New plan" : u.kind === "renewal" ? "Renewal" : "Set up by admin"}</td>
                      <td className="py-1.5 text-right text-gray-700">{rupees(u.mealPrice)} <span className="text-gray-400 line-through">{rupees(u.regularMealPrice)}</span></td>
                      <td className="py-1.5 text-right text-[#1B5E20] font-medium">{rupees(u.saved)}</td>
                      <td className="py-1.5 text-right text-gray-400">{when(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Create / edit ────────────────────────────────────────────────────────────

type Row = { on: boolean; pct: string; meal: string; total: string; mealPaise: number | null }

function fmtNum(n: number, digits = 2) {
  const r = Math.round(n * 10 ** digits) / 10 ** digits
  return String(r)
}

function rowFromMeal(plan: CouponPlan, mealPaise: number | null, on: boolean): Row {
  if (mealPaise == null) return { on, pct: "", meal: "", total: "", mealPaise: null }
  return {
    on,
    pct: fmtNum(pctOff(plan, mealPaise), 1),
    meal: fmtNum(mealPaise / 100),
    total: fmtNum(planTotal(plan, mealPaise) / 100),
    mealPaise,
  }
}

function CouponEditor({
  coupon, plans, customers, today, onClose, say,
}: {
  coupon: CouponRow | null
  plans: CouponPlan[]
  customers: CouponCustomer[]
  today: string
  onClose: () => void
  say: (ok: boolean, text: string) => void
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [code, setCode] = useState(coupon?.code ?? randomCode())
  const [name, setName] = useState(coupon?.name ?? "")
  const [allPct, setAllPct] = useState("")
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(plans.map((p) => [p.id, rowFromMeal(p, coupon?.prices[p.id] ?? null, coupon ? !!coupon.prices[p.id] : true)]))
  )
  const [forNew, setForNew] = useState(coupon?.forNew ?? false)
  const [forRenewal, setForRenewal] = useState(coupon?.forRenewal ?? false)
  const [forSelected, setForSelected] = useState(coupon?.forSelected ?? false)
  const [picked, setPicked] = useState<Set<string>>(new Set(coupon?.customerIds ?? []))
  const [query, setQuery] = useState("")
  const [startsOn, setStartsOn] = useState(coupon?.startsOn ?? today)
  const [endsOn, setEndsOn] = useState(coupon?.endsOn ?? addDays(today, 6))
  const [perCustomer, setPerCustomer] = useState(coupon ? (coupon.maxPerCustomer == null ? "" : String(coupon.maxPerCustomer)) : "1")
  const [total, setTotal] = useState(coupon?.maxTotal == null ? "" : String(coupon.maxTotal))
  const [error, setError] = useState("")

  // The three boxes of one plan's row follow whichever one was typed in.
  function setRow(plan: CouponPlan, field: "pct" | "meal" | "total", text: string) {
    const value = parseFloat(text)
    let mealPaise: number | null = null
    if (Number.isFinite(value)) {
      if (field === "pct") mealPaise = mealFromPct(plan, value)
      if (field === "meal") mealPaise = Math.round(value * 100)
      if (field === "total") mealPaise = mealFromTotal(plan, Math.round(value * 100))
    }
    const next = rowFromMeal(plan, mealPaise, true)
    next[field] = text // keep exactly what's being typed
    setRows((r) => ({ ...r, [plan.id]: next }))
  }

  function applyAll(text: string) {
    setAllPct(text)
    const value = parseFloat(text)
    setRows((r) => {
      const out = { ...r }
      for (const p of plans) {
        if (!out[p.id].on) continue
        out[p.id] = Number.isFinite(value) ? { ...rowFromMeal(p, mealFromPct(p, value), true), pct: text } : { ...rowFromMeal(p, null, true) }
      }
      return out
    })
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? customers.filter((c) => [c.name, c.code, c.phone ?? ""].some((v) => v.toLowerCase().includes(q)))
      : customers
    // Picked ones first so they're easy to review.
    return [...list].sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id))).slice(0, 300)
  }, [customers, query, picked])

  function toggleCustomer(id: string) {
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const days = startsOn && endsOn && endsOn >= startsOn ? daysBetween(startsOn, endsOn) : 0

  function save() {
    setError("")
    const normalized = normalizeCode(code)
    if (!CODE_PATTERN.test(normalized)) return setError("Codes are 3–24 letters, numbers or dashes.")
    const prices: Record<string, number> = {}
    for (const p of plans) {
      const r = rows[p.id]
      if (!r.on) continue
      if (r.mealPaise == null || !validMealPrice(p, r.mealPaise)) {
        return setError(`${p.name}: the price per meal must be above ₹0 and below the regular ${rupees(regularMealPrice(p))}.`)
      }
      prices[p.id] = r.mealPaise
    }
    if (Object.keys(prices).length === 0) return setError("Tick at least one plan and set its price.")
    if (!forNew && !forRenewal && !forSelected) return setError("Choose who can use it.")
    if (forSelected && picked.size === 0) return setError("Pick at least one customer, or untick Selected customers.")
    if (!days) return setError("The end date must be on or after the start date.")
    const per = perCustomer.trim() === "" ? null : Number(perCustomer)
    const tot = total.trim() === "" ? null : Number(total)
    start(async () => {
      const res = await saveCoupon({
        id: coupon?.id,
        code: normalized,
        name,
        startsOn,
        endsOn,
        forNew,
        forRenewal,
        forSelected,
        customerIds: forSelected ? [...picked] : [],
        maxPerCustomer: per,
        maxTotal: tot,
        prices,
      })
      if (!res.ok) return setError(res.error)
      say(true, coupon ? "Coupon saved." : `Coupon ${normalized} created.`)
      onClose()
      router.refresh()
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e2e8d5] px-6 py-4">
          <h2 className="text-lg font-bold text-[#1A1A1A]">{coupon ? `Edit ${coupon.code}` : "New coupon"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* 1. Code */}
          <section className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Code customers type</span>
              <div className="mt-1 flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(normalizeCode(e.target.value))}
                  className="h-10 flex-1 rounded-lg border border-[#e2e8d5] px-3 font-mono text-sm uppercase tracking-wide"
                  placeholder="e.g. DIWALI15"
                />
                <button type="button" onClick={() => setCode(randomCode())} className="h-10 px-3 rounded-lg border border-[#e2e8d5] text-xs text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <Shuffle className="w-3.5 h-3.5" /> Generate
                </button>
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Name (only the team sees it)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[#e2e8d5] px-3 text-sm" placeholder="e.g. Diwali offer for renewals" />
            </label>
          </section>

          {/* 2. Price */}
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#1A1A1A]">Price</h3>
                <p className="text-xs text-gray-500">Type in any box — the other two follow. Each plan can have its own price.</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                % off for all plans
                <input value={allPct} onChange={(e) => applyAll(e.target.value)} inputMode="decimal" className="h-9 w-20 rounded-lg border border-[#e2e8d5] px-2 text-sm" placeholder="15" />
              </label>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-[#e2e8d5]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 bg-gray-50">
                    <th className="px-3 py-2 font-medium">Plan</th>
                    <th className="px-3 py-2 font-medium">Regular</th>
                    <th className="px-3 py-2 font-medium">% off</th>
                    <th className="px-3 py-2 font-medium">Price per meal (₹)</th>
                    <th className="px-3 py-2 font-medium">Plan total (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => {
                    const r = rows[p.id]
                    const bad = r.on && r.mealPaise != null && !validMealPrice(p, r.mealPaise)
                    const exact = r.mealPaise != null ? planTotal(p, r.mealPaise) : null
                    const typedTotal = Math.round(parseFloat(r.total) * 100)
                    return (
                      <tr key={p.id} className={cn("border-t border-[#e2e8d5]", !r.on && "opacity-50")}>
                        <td className="px-3 py-2">
                          <label className="flex items-center gap-2 font-medium text-[#1A1A1A]">
                            <input type="checkbox" checked={r.on} onChange={(e) => setRows((x) => ({ ...x, [p.id]: { ...x[p.id], on: e.target.checked } }))} className="accent-[#1B5E20]" />
                            {p.meals_total} meals
                          </label>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
                          <span className="line-through">{rupees(regularMealPrice(p))}</span>/meal<br />
                          <span className="line-through">{rupees(p.base_price)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <input disabled={!r.on} value={r.pct} onChange={(e) => setRow(p, "pct", e.target.value)} inputMode="decimal" className="h-9 w-20 rounded-lg border border-[#e2e8d5] px-2" placeholder="%" />
                        </td>
                        <td className="px-3 py-2">
                          <input disabled={!r.on} value={r.meal} onChange={(e) => setRow(p, "meal", e.target.value)} inputMode="decimal" className={cn("h-9 w-28 rounded-lg border px-2", bad ? "border-red-400" : "border-[#e2e8d5]")} placeholder="229" />
                        </td>
                        <td className="px-3 py-2">
                          <input disabled={!r.on} value={r.total} onChange={(e) => setRow(p, "total", e.target.value)} inputMode="decimal" className="h-9 w-32 rounded-lg border border-[#e2e8d5] px-2" placeholder="6870" />
                          {r.on && exact != null && Number.isFinite(typedTotal) && typedTotal !== exact && (
                            <p className="text-[11px] text-gray-400 mt-0.5">Charged: {rupees(exact)} ({rupees(r.mealPaise!)} × {p.meals_total})</p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Add-ons are not discounted. The 5-meal trial can&apos;t take a coupon.</p>
          </section>

          {/* 3. Who */}
          <section>
            <h3 className="text-sm font-semibold text-[#1A1A1A]">Who can use it</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { on: forNew, set: setForNew, label: "New sign-ups", hint: "buying their first plan" },
                { on: forRenewal, set: setForRenewal, label: "Renewers", hint: "anyone who has had a plan" },
                { on: forSelected, set: setForSelected, label: "Selected customers", hint: "pick below" },
              ].map((o) => (
                <label key={o.label} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer", o.on ? "border-[#1B5E20] bg-green-50/50" : "border-[#e2e8d5]")}>
                  <input type="checkbox" checked={o.on} onChange={(e) => o.set(e.target.checked)} className="mt-0.5 accent-[#1B5E20]" />
                  <span>
                    <span className="block text-sm font-medium text-[#1A1A1A]">{o.label}</span>
                    <span className="block text-[11px] text-gray-500">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {forSelected && (
              <div className="mt-3 rounded-xl border border-[#e2e8d5]">
                <div className="flex items-center gap-2 border-b border-[#e2e8d5] px-3 py-2">
                  <Search className="w-4 h-4 text-gray-400" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, GF code or phone" className="flex-1 text-sm outline-none" />
                  <span className="text-xs text-gray-500 whitespace-nowrap">{picked.size} selected</span>
                  {picked.size > 0 && <button type="button" onClick={() => setPicked(new Set())} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>}
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                  {shown.length === 0 && <p className="px-3 py-4 text-xs text-gray-400">No customers match.</p>}
                  {shown.map((c) => (
                    <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggleCustomer(c.id)} className="accent-[#1B5E20]" />
                      <span className="flex-1 min-w-0 truncate text-[#1A1A1A]">{c.name}</span>
                      <span className="text-xs text-gray-400">{c.code}</span>
                      <span className="hidden sm:inline text-xs text-gray-400 w-28 text-right">{c.phone ?? ""}</span>
                      <span className="text-[11px] text-gray-500 w-20 text-right">{c.plan ?? "No plan"}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 4. When */}
          <section>
            <h3 className="text-sm font-semibold text-[#1A1A1A]">When</h3>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-xs text-gray-500">Starts</span>
                <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="mt-1 block h-10 rounded-lg border border-[#e2e8d5] px-3 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Ends (last day it works)</span>
                <input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} className="mt-1 block h-10 rounded-lg border border-[#e2e8d5] px-3 text-sm" />
              </label>
              <p className="text-xs text-gray-500 pb-2.5">{days ? `Works for ${days} day${days === 1 ? "" : "s"}, India time.` : "Pick valid dates."}</p>
            </div>
          </section>

          {/* 5. Limits */}
          <section className="flex flex-wrap gap-4">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Uses per customer</span>
              <input value={perCustomer} onChange={(e) => setPerCustomer(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="mt-1 block h-10 w-28 rounded-lg border border-[#e2e8d5] px-3 text-sm" placeholder="No limit" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Total uses</span>
              <input value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="mt-1 block h-10 w-28 rounded-lg border border-[#e2e8d5] px-3 text-sm" placeholder="No limit" />
            </label>
          </section>

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#e2e8d5] px-6 py-4">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-[#e2e8d5] text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={busy} className="h-10 px-5 rounded-lg bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] disabled:opacity-40">
            {coupon ? "Save coupon" : "Create coupon"}
          </button>
        </div>
      </div>
    </div>
  )
}
