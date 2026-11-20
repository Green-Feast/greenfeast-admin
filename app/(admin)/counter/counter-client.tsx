"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Store, ChefHat, CheckCircle2, AlertCircle, Loader2, Settings, X, Footprints, UtensilsCrossed, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useActionPassword } from "@/components/action-password"
import { handOver, savePlace, chargeMissedWalkIn, dismissMissedWalkIn, type PlaceInput } from "./actions"

export type Place = {
  id: string
  name: string
  address: string
  maps_url: string | null
  offers_pickup: boolean
  offers_dine_in: boolean
  cooks_own: boolean
  opens_at: string
  lunch_until: string
  closes_at: string
  is_active: boolean
  sort_order: number
}

export type CounterOrder = {
  id: string
  date: string
  /** The cart's total (paise). */
  cost: number
  status: string
  slot: "lunch" | "dinner"
  quantity: number
  walkIn: boolean
  mode: "pickup" | "dine_in"
  code: string
  collectedAt: string | null
  missed: boolean
  skipReason: string | null
  createdAt: string
  /** Everything under the code, as one line ("Burrito Bowl ×2 + Drink: Avo Clarity"). */
  meal: string
  /** The cart's items (102); a pre-102 walk-in or booked pickup is one item. */
  items: { name: string; qty: number; drink: boolean }[]
  addons: { name: string; qty: number }[]
  name: string
  phone: string
  customerCode: string
}

const OPEN = ["scheduled", "confirmed", "preparing"]
const hhmm = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  const ampm = h >= 12 ? "PM" : "AM"
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${ampm}`
}
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })

export function CounterClient({ places, place, slot, orders, missedWalkIns, today }: {
  places: Place[]
  place: Place | null
  slot: "lunch" | "dinner"
  orders: CounterOrder[]
  /** Codes nobody handed over within an hour, last 7 days (103). */
  missedWalkIns: CounterOrder[]
  today: string
}) {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  // Keep the counter live: walk-ins appear as customers start them.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh()
    }, 20000)
    return () => clearInterval(id)
  }, [router])

  function go(loc: string, s: string) {
    setMsg(null)
    router.push(`/counter?loc=${loc}&slot=${s}`)
  }

  const slotOrders = orders.filter((o) => o.slot === slot)
  const walkIns = slotOrders.filter((o) => OPEN.includes(o.status) && o.walkIn)
  const collected = slotOrders.filter((o) => o.status === "delivered" && !o.missed)
  const missed = slotOrders.filter((o) => o.missed || o.skipReason === "walk_in_expired")
  const askPassword = useActionPassword()
  const [serving, setServing] = useState<string | null>(null) // missed walk-in being marked served
  const [reason, setReason] = useState("")

  // Served: charged as ordered (action password + what happened).
  async function markServed(o: CounterOrder) {
    if (reason.trim().length < 3) { setMsg({ ok: false, text: "Say what happened — e.g. who handed it over." }); return }
    const pw = await askPassword(`Charge ${o.name}'s walk-in of ${dayOf(o.date)} (${rupees(o.cost)}) — ${reason.trim()}`)
    if (pw === null) return
    start(async () => {
      const r = await chargeMissedWalkIn(o.id, reason.trim(), pw)
      setMsg(r.ok ? { ok: true, text: `${o.name}: ${r.message}` } : { ok: false, text: r.error })
      if (r.ok) { setServing(null); setReason("") }
      router.refresh()
    })
  }
  function markNotServed(o: CounterOrder) {
    if (!window.confirm(`${o.name}'s walk-in of ${dayOf(o.date)} wasn't served? It comes off the list, uncharged.`)) return
    start(async () => {
      const r = await dismissMissedWalkIn(o.id)
      setMsg(r.ok ? { ok: true, text: `${o.name}: ${r.message}` } : { ok: false, text: r.error })
      router.refresh()
    })
  }

  // What this place has to cook for the slot (only places that cook their own).
  const toCook = useMemo(() => {
    const dishes = new Map<string, number>()
    const addons = new Map<string, number>()
    for (const o of slotOrders.filter((x) => OPEN.includes(x.status))) {
      for (const i of o.items) dishes.set(i.drink ? `Drink: ${i.name}` : i.name, (dishes.get(i.drink ? `Drink: ${i.name}` : i.name) ?? 0) + i.qty)
      for (const a of o.addons) addons.set(a.name, (addons.get(a.name) ?? 0) + a.qty)
    }
    return { dishes: [...dishes.entries()].sort((a, b) => b[1] - a[1]), addons: [...addons.entries()] }
  }, [slotOrders])

  // The code is looked up across the whole day at this place.
  const match = code.length === 6 ? orders.find((o) => o.code === code) ?? null : null

  function doHandOver(o: CounterOrder) {
    if (!place) return
    setMsg(null)
    start(async () => {
      const r = await handOver(o.id, place.id)
      setMsg(r.ok ? { ok: true, text: `${o.name}: ${r.message}` } : { ok: false, text: r.error })
      if (r.ok) setCode("")
      router.refresh()
      codeRef.current?.focus()
    })
  }

  if (!place) {
    return <div className="p-8 text-gray-500">No pickup places set up.</div>
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      {editing && <PlaceEditor place={place} onClose={() => setEditing(false)} />}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Store className="w-4 h-4 text-[#1B5E20]" />
            <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">Walk-in</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Counter</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {place.address} · open {hhmm(place.opens_at)}–{hhmm(place.closes_at)} · lunch until {hhmm(place.lunch_until)}
            {" · "}{[place.offers_pickup && "takeaway", place.offers_dine_in && "dine-in"].filter(Boolean).join(" & ")}
            {!place.is_active && <span className="ml-2 text-red-600 font-medium">· switched off</span>}
          </p>
        </div>
        <button onClick={() => setEditing(true)} className="h-9 px-3 flex items-center gap-2 rounded-lg border border-[#e2e8d5] text-sm text-gray-600 hover:bg-gray-50">
          <Settings className="w-4 h-4" /> Edit place
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {places.map((p) => (
          <button key={p.id} onClick={() => go(p.id, slot)}
            className={cn("px-3 py-1.5 rounded-lg text-sm font-medium border", p.id === place.id ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "border-[#e2e8d5] text-gray-600 hover:bg-gray-50")}>
            {p.name}
          </button>
        ))}
        <span className="mx-2 w-px bg-[#e2e8d5]" />
        {(["lunch", "dinner"] as const).map((s) => (
          <button key={s} onClick={() => go(place.id, s)}
            className={cn("px-3 py-1.5 rounded-lg text-sm font-medium border capitalize", s === slot ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "border-[#e2e8d5] text-gray-600 hover:bg-gray-50")}>
            {s}
          </button>
        ))}
        <span className="self-center text-xs text-gray-400 ml-1">{today}</span>
      </div>

      {/* Code box */}
      <div className="mb-6 rounded-xl border border-[#e2e8d5] bg-white p-5 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Customer&apos;s code</p>
        <input
          ref={codeRef}
          autoFocus
          inputMode="numeric"
          value={code}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setMsg(null) }}
          placeholder="6 digits"
          className="h-14 w-56 rounded-lg border border-[#e2e8d5] px-4 font-mono text-3xl tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
        />
        {code.length === 6 && !match && <p className="mt-3 text-sm text-red-600">No meal with that code here today. Check the place and the code.</p>}
        {match && (
          <div className="mt-4 rounded-xl border border-[#1B5E20]/30 bg-[#F4FAF4] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-[#1A1A1A]">{match.name} <span className="font-mono text-sm font-normal text-gray-500">{match.customerCode}</span></p>
                <p className="text-sm text-gray-700 mt-1">
                  <b>{match.meal}</b>
                  {match.addons.length > 0 && ` + ${match.addons.map((a) => (a.qty > 1 ? `${a.name} ×${a.qty}` : a.name)).join(", ")}`}
                </p>
                <p className="text-xs text-gray-500 mt-1 capitalize">
                  {match.slot} · {match.mode === "dine_in" ? "dine-in" : "takeaway"}{match.walkIn ? " · walk-in" : " · booked before walk-in"}
                </p>
              </div>
              {OPEN.includes(match.status) ? (
                <button onClick={() => doHandOver(match)} disabled={pending}
                  className="h-11 px-6 rounded-lg bg-[#1B5E20] text-white font-semibold hover:bg-[#0D3F12] disabled:opacity-50 flex items-center gap-2">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Hand over
                </button>
              ) : (
                <span className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600">
                  {match.status === "delivered"
                    ? `Already handed over${match.collectedAt ? ` at ${timeOf(match.collectedAt)}` : ""}`
                    : match.skipReason === "walk_in_missed" ? "Over an hour old — it's in Missed walk-ins below" : "Cancelled"}
                </span>
              )}
            </div>
          </div>
        )}
        {msg && (
          <div className={cn("mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm", msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700")}>
            {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            {msg.text}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {place.cooks_own && (
          <Panel title={`To cook — ${slot}`} icon={<ChefHat className="w-4 h-4" />} count={toCook.dishes.reduce((n, [, q]) => n + q, 0)}>
            {toCook.dishes.length === 0 ? <Empty text="No walk-ins yet." /> : (
              <div className="space-y-1.5 text-sm">
                {toCook.dishes.map(([d, q]) => (
                  <div key={d} className="flex justify-between"><span>{d}</span><b>{q}</b></div>
                ))}
                {toCook.addons.length > 0 && (
                  <div className="mt-3 border-t border-[#e2e8d5] pt-2 text-xs text-gray-600">
                    {toCook.addons.map(([a, q]) => `${a} ×${q}`).join(" · ")}
                  </div>
                )}
                <p className="pt-2 text-xs text-gray-400">Walk-ins started so far. Customers can walk in until {hhmm(place.closes_at)}.</p>
              </div>
            )}
          </Panel>
        )}
        <Panel title="Walk-ins waiting" icon={<Footprints className="w-4 h-4" />} count={walkIns.length}>
          <OrderList orders={walkIns} onPick={(o) => setCode(o.code)} />
        </Panel>
        <Panel title="Handed over" icon={<CheckCircle2 className="w-4 h-4" />} count={collected.length}>
          <OrderList orders={collected} done />
        </Panel>
        <Panel title="Didn't come" icon={<UtensilsCrossed className="w-4 h-4" />} count={missed.length}>
          {missed.length === 0 ? <Empty text="Walk-ins marked not served, and older ones nobody answered." /> : (
            <OrderList orders={missed} done />
          )}
        </Panel>
      </div>

      {/* Missed walk-ins (103): codes nobody handed over within an hour */}
      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/40 p-5">
        <div className="mb-1 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#1A1A1A]"><Clock className="w-4 h-4" />Missed walk-ins</p>
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">{missedWalkIns.length}</span>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Codes nobody handed over within an hour, last 7 days. If the meal was served anyway, mark it served — it&apos;s
          charged as ordered. If it wasn&apos;t, mark it not served or leave it; after 7 days it drops off, uncharged.
        </p>
        {missedWalkIns.length === 0 ? <Empty text="None." /> : (
          <div className="divide-y divide-amber-200">
            {missedWalkIns.map((o) => (
              <div key={o.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium text-[#1A1A1A]">
                      {o.name} <span className="font-mono text-xs font-normal text-gray-500">{o.customerCode}</span>
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {dayOf(o.date)} · {o.slot} · {timeOf(o.createdAt)} · {o.mode === "dine_in" ? "dine-in" : "takeaway"} · code <span className="font-mono">{o.code}</span>
                    </p>
                    <p className="text-xs text-gray-700 mt-0.5">
                      {o.meal}{o.addons.length > 0 ? ` + ${o.addons.map((a) => (a.qty > 1 ? `${a.name} ×${a.qty}` : a.name)).join(", ")}` : ""} · <b>{rupees(o.cost)}</b>
                    </p>
                  </div>
                  {serving !== o.id && (
                    <div className="flex gap-2">
                      <button disabled={pending} onClick={() => { setServing(o.id); setReason(""); setMsg(null) }}
                        className="h-9 px-3 rounded-lg bg-[#1B5E20] text-white text-xs font-semibold hover:bg-[#0D3F12] disabled:opacity-50">
                        Served — charge it
                      </button>
                      <button disabled={pending} onClick={() => markNotServed(o)}
                        className="h-9 px-3 rounded-lg border border-[#e2e8d5] bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        Not served
                      </button>
                    </div>
                  )}
                </div>
                {serving === o.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="What happened (required) — e.g. counter handed it over, no admin around"
                      className="h-9 flex-1 min-w-[260px] rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                    />
                    <button disabled={pending || reason.trim().length < 3} onClick={() => markServed(o)}
                      className="h-9 px-3 rounded-lg bg-[#1B5E20] text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5">
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Charge {rupees(o.cost)}
                    </button>
                    <button onClick={() => setServing(null)} className="h-9 px-3 text-xs text-gray-500">Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
const dayOf = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })

function Panel({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e2e8d5] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#1A1A1A]">{icon}{title}</p>
        <span className="rounded-md bg-[#1B5E20]/10 px-1.5 py-0.5 text-xs font-bold text-[#1B5E20]">{count}</span>
      </div>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-400">{text}</p>
}

function OrderList({ orders, onPick, done }: { orders: CounterOrder[]; onPick?: (o: CounterOrder) => void; done?: boolean }) {
  if (orders.length === 0) return <Empty text="None." />
  return (
    <div className="divide-y divide-[#e2e8d5]">
      {orders.map((o) => (
        <button key={o.id} disabled={!onPick} onClick={() => onPick?.(o)}
          className={cn("flex w-full items-center justify-between gap-2 py-2 text-left text-sm", onPick && "hover:bg-green-50")}>
          <span>
            <span className="font-medium text-[#1A1A1A]">{o.name}</span>
            <span className="block text-xs text-gray-500">
              {o.meal} · {o.mode === "dine_in" ? "dine-in" : "takeaway"}
              {done && o.collectedAt ? ` · ${timeOf(o.collectedAt)}` : ""}
              {o.missed ? " · charged" : o.skipReason === "walk_in_expired" ? " · walk-in not used" : ""}
            </span>
          </span>
          {!done && <span className="font-mono text-xs text-gray-400">{o.code}</span>}
        </button>
      ))}
    </div>
  )
}

function PlaceEditor({ place, onClose }: { place: Place; onClose: () => void }) {
  const router = useRouter()
  const [v, setV] = useState<PlaceInput>({
    name: place.name,
    address: place.address,
    mapsUrl: place.maps_url ?? "",
    offersPickup: place.offers_pickup,
    offersDineIn: place.offers_dine_in,
    cooksOwn: place.cooks_own,
    opensAt: place.opens_at.slice(0, 5),
    lunchUntil: place.lunch_until.slice(0, 5),
    closesAt: place.closes_at.slice(0, 5),
    isActive: place.is_active,
  })
  const [err, setErr] = useState("")
  const [pending, start] = useTransition()
  const set = <K extends keyof PlaceInput>(k: K, x: PlaceInput[K]) => setV((p) => ({ ...p, [k]: x }))
  const input = "h-9 w-full rounded-lg border border-[#e2e8d5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"

  function save() {
    setErr("")
    start(async () => {
      const r = await savePlace(place.id, v)
      if (!r.ok) return setErr(r.error)
      router.refresh()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e2e8d5] px-5 py-4">
          <h2 className="text-lg font-bold">Edit place</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-5 py-5 text-sm">
          <label className="block">Name<input className={input} value={v.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="block">Address (customers see it)<input className={input} value={v.address} onChange={(e) => set("address", e.target.value)} /></label>
          <label className="block">Google Maps link<input className={input} value={v.mapsUrl} onChange={(e) => set("mapsUrl", e.target.value)} placeholder="https://maps.app.goo.gl/…" /></label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">Opens<input type="time" className={input} value={v.opensAt} onChange={(e) => set("opensAt", e.target.value)} /></label>
            <label className="block">Lunch until<input type="time" className={input} value={v.lunchUntil} onChange={(e) => set("lunchUntil", e.target.value)} /></label>
            <label className="block">Closes<input type="time" className={input} value={v.closesAt} onChange={(e) => set("closesAt", e.target.value)} /></label>
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.offersPickup} onChange={(e) => set("offersPickup", e.target.checked)} /> Takeaway</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.offersDineIn} onChange={(e) => set("offersDineIn", e.target.checked)} /> Dine-in</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.cooksOwn} onChange={(e) => set("cooksOwn", e.target.checked)} /> Cooks its own meals</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Open to customers</label>
          </div>
          <p className="text-xs text-gray-400">Walk-ins made before &quot;Lunch until&quot; count as lunch, after as dinner. A walk-in code works until &quot;Closes&quot;; unused ones are cancelled, uncharged.</p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button onClick={save} disabled={pending} className="h-10 w-full rounded-lg bg-[#1B5E20] text-white font-medium disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
