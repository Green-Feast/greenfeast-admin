"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Star, MessageSquare, CheckCircle, AlertCircle, RotateCcw, Settings2, Utensils, MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  tagLabel,
  STAR_WORD,
  FEEDBACK_KIND,
  FREQUENCY_OPTIONS,
  type RatingRow,
  type FeedbackRow,
  type RatingSettings,
  type RatingFrequency,
} from "@/lib/feedback"
import { setRatingHandled, setFeedbackHandled, saveRatingSettings } from "./actions"

type Props = {
  period: "7" | "30" | "90" | "all"
  tab: "ratings" | "app"
  focusId: string | null
  ratings: RatingRow[]
  openBad: RatingRow[]
  feedback: FeedbackRow[]
  settings: RatingSettings
  pushOn: boolean
  loadError: string | null
}

const PERIOD_LABEL: Record<Props["period"], string> = { "7": "7 days", "30": "30 days", "90": "90 days", all: "All time" }
const STARS_FILTER = [
  { value: "all", label: "All" },
  { value: "bad", label: "1–2★" },
  { value: "okay", label: "3★" },
  { value: "good", label: "4–5★" },
] as const
type StarsFilter = (typeof STARS_FILTER)[number]["value"]

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
}
function day(date: string) {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
}
function pct(n: number, of: number) {
  return of ? Math.round((n / of) * 100) : 0
}
function waLink(phone: string | null, text: string) {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10)
  return digits.length === 10 ? `https://wa.me/91${digits}?text=${encodeURIComponent(text)}` : null
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size }} className={i <= value ? "fill-amber-400 text-amber-400" : "text-gray-300"} />
      ))}
    </span>
  )
}

export function FeedbackClient(props: Props) {
  const { period, tab, focusId, ratings, openBad, feedback, settings, pushOn, loadError } = props
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const say = (ok: boolean, text: string) => {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 4000)
  }

  const openFeedback = feedback.filter((f) => !f.handledAt).length
  const href = (p: string, t: string) => `/feedback?period=${p}${t === "app" ? "&tab=app" : ""}`

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Star className="w-4 h-4 text-[#1B5E20]" />
        <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">What customers say</span>
      </div>
      <h1 className="text-2xl font-bold text-[#1A1A1A]">Feedback</h1>
      <p className="text-sm text-gray-500 mt-0.5">
        Meal ratings from the app (1–5 stars, chips and comments) and messages from Account → Send feedback. A 1–2★ rating or new feedback alerts every admin.
      </p>

      {loadError && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Couldn&apos;t load everything: {loadError}</p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-white border border-[#e2e8d5] p-1 text-sm font-medium">
          <Link href={href(period, "ratings")} className={cn("px-4 py-1.5 rounded-lg", tab === "ratings" ? "bg-[#1B5E20] text-white" : "text-gray-600 hover:bg-gray-50")}>
            Meal ratings
          </Link>
          <Link href={href(period, "app")} className={cn("px-4 py-1.5 rounded-lg flex items-center gap-1.5", tab === "app" ? "bg-[#1B5E20] text-white" : "text-gray-600 hover:bg-gray-50")}>
            App feedback
            {openFeedback > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">{openFeedback}</span>}
          </Link>
        </div>
        <div className="flex gap-1.5 text-xs font-medium">
          {(Object.keys(PERIOD_LABEL) as Props["period"][]).map((p) => (
            <Link
              key={p}
              href={href(p, tab)}
              className={cn("px-3 py-1.5 rounded-full border", period === p ? "bg-[#1B5E20] border-[#1B5E20] text-white" : "bg-white border-[#e2e8d5] text-gray-600 hover:bg-gray-50")}
            >
              {PERIOD_LABEL[p]}
            </Link>
          ))}
        </div>
      </div>

      {tab === "ratings" ? (
        <RatingsTab ratings={ratings} openBad={openBad} focusId={focusId} settings={settings} pushOn={pushOn} say={say} />
      ) : (
        <AppFeedbackTab feedback={feedback} say={say} />
      )}

      {toast && (
        <div className={cn("fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white", toast.ok ? "bg-[#1B5E20]" : "bg-red-600")}>
          {toast.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.text}
        </div>
      )}
    </div>
  )
}

// ── Meal ratings ──────────────────────────────────────────────────────────────

function RatingsTab({
  ratings,
  openBad,
  focusId,
  settings,
  pushOn,
  say,
}: {
  ratings: RatingRow[]
  openBad: RatingRow[]
  focusId: string | null
  settings: RatingSettings
  pushOn: boolean
  say: (ok: boolean, text: string) => void
}) {
  const [stars, setStars] = useState<StarsFilter>("all")
  const [slot, setSlot] = useState<"all" | "lunch" | "dinner">("all")
  const [dish, setDish] = useState("all")
  const [partner, setPartner] = useState("all")
  const [withComment, setWithComment] = useState(false)

  useEffect(() => {
    if (!focusId) return
    const el = document.getElementById(`followup-${focusId}`) ?? document.getElementById(`rating-${focusId}`)
    el?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [focusId])

  const dishes = useMemo(() => [...new Set(ratings.filter((r) => r.stars).map((r) => r.dishes))].sort(), [ratings])
  const partners = useMemo(() => [...new Set(ratings.map((r) => r.partner).filter((p): p is string => !!p))].sort(), [ratings])

  // Slot / dish / rider narrow everything below; stars and "with comment" only the list.
  const scoped = ratings.filter(
    (r) => (slot === "all" || r.slot === slot) && (dish === "all" || r.dishes === dish) && (partner === "all" || r.partner === partner)
  )
  const rated = scoped.filter((r) => r.stars != null)
  const asked = scoped.filter((r) => r.askedAt)
  const answered = asked.filter((r) => r.stars != null)
  const avg = rated.length ? rated.reduce((n, r) => n + (r.stars ?? 0), 0) / rated.length : 0
  const good = rated.filter((r) => (r.stars ?? 0) >= 4).length
  const bad = rated.filter((r) => (r.stars ?? 0) <= 2).length
  const dist = [5, 4, 3, 2, 1].map((s) => ({ s, n: rated.filter((r) => r.stars === s).length }))
  const maxDist = Math.max(1, ...dist.map((d) => d.n))

  const list = rated.filter((r) => {
    const s = r.stars ?? 0
    if (stars === "bad" && s > 2) return false
    if (stars === "okay" && s !== 3) return false
    if (stars === "good" && s < 4) return false
    if (withComment && !r.comment) return false
    return true
  })

  // By dish (or combination, when a meal had several dishes).
  const byDish = useMemo(() => {
    const map = new Map<string, { dish: string; n: number; sum: number; bad: number; tags: Map<string, number> }>()
    for (const r of ratings) {
      if (r.stars == null || (slot !== "all" && r.slot !== slot) || (partner !== "all" && r.partner !== partner)) continue
      const row = map.get(r.dishes) ?? { dish: r.dishes, n: 0, sum: 0, bad: 0, tags: new Map() }
      row.n += 1
      row.sum += r.stars
      if (r.stars <= 2) row.bad += 1
      if (r.stars <= 3) for (const t of r.tags) row.tags.set(t, (row.tags.get(t) ?? 0) + 1)
      map.set(r.dishes, row)
    }
    return [...map.values()].sort((a, b) => b.n - a.n || a.dish.localeCompare(b.dish))
  }, [ratings, slot, partner])

  return (
    <div className="mt-5 space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Average" value={rated.length ? avg.toFixed(1) + "★" : "—"} sub={`${rated.length} rating${rated.length === 1 ? "" : "s"}`} />
        <Tile label="4–5★" value={rated.length ? pct(good, rated.length) + "%" : "—"} sub={`${good} happy`} tone="green" />
        <Tile label="1–2★" value={rated.length ? pct(bad, rated.length) + "%" : "—"} sub={`${bad} unhappy`} tone={bad ? "red" : undefined} />
        <Tile label="Answered" value={asked.length ? pct(answered.length, asked.length) + "%" : "—"} sub={`${answered.length} of ${asked.length} asked`} />
      </div>

      <div className="rounded-2xl border border-[#e2e8d5] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5 min-w-[220px] flex-1 max-w-sm">
            {dist.map(({ s, n }) => (
              <div key={s} className="flex items-center gap-2 text-xs">
                <span className="w-6 text-gray-500 font-medium">{s}★</span>
                <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className={cn("h-full rounded-full", s >= 4 ? "bg-[#1B5E20]" : s === 3 ? "bg-amber-400" : "bg-red-500")} style={{ width: `${(n / maxDist) * 100}%` }} />
                </div>
                <span className="w-6 text-right text-gray-500">{n}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Select value={slot} onChange={(v) => setSlot(v as typeof slot)} options={[["all", "Lunch + dinner"], ["lunch", "Lunch"], ["dinner", "Dinner"]]} />
            <Select value={dish} onChange={setDish} options={[["all", "All dishes"], ...dishes.map((d) => [d, d] as [string, string])]} />
            <Select value={partner} onChange={setPartner} options={[["all", "All riders"], ...partners.map((p) => [p, p] as [string, string])]} />
          </div>
        </div>
      </div>

      {/* Needs follow-up */}
      {openBad.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-[#1A1A1A] mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" /> Needs follow-up ({openBad.length})
          </h2>
          <div className="space-y-2">
            {openBad.map((r) => (
              <RatingItem key={r.id} r={r} focused={r.id === focusId} say={say} followUp />
            ))}
          </div>
        </section>
      )}

      {/* All ratings */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-[#1A1A1A]">All ratings ({list.length})</h2>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {STARS_FILTER.map((f) => (
              <button
                key={f.value}
                onClick={() => setStars(f.value)}
                className={cn("px-2.5 py-1 rounded-full border", stars === f.value ? "bg-[#1B5E20] border-[#1B5E20] text-white" : "bg-white border-[#e2e8d5] text-gray-600")}
              >
                {f.label}
              </button>
            ))}
            <label className="ml-1 flex items-center gap-1.5 text-gray-600 cursor-pointer">
              <input type="checkbox" checked={withComment} onChange={(e) => setWithComment(e.target.checked)} className="accent-[#1B5E20]" />
              With a comment
            </label>
          </div>
        </div>
        <div className="space-y-2">
          {list.length === 0 && <p className="text-sm text-gray-400 text-center py-10">No ratings here yet.</p>}
          {list.map((r) => (
            <RatingItem key={r.id} r={r} focused={r.id === focusId} say={say} />
          ))}
        </div>
      </section>

      {/* By dish */}
      {byDish.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-[#1A1A1A] mb-2 flex items-center gap-2">
            <Utensils className="w-4 h-4 text-gray-400" /> By dish
          </h2>
          <div className="rounded-2xl border border-[#e2e8d5] bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-[#e2e8d5]">
                  <th className="px-4 py-2.5 font-medium">Dish</th>
                  <th className="px-4 py-2.5 font-medium text-right">Ratings</th>
                  <th className="px-4 py-2.5 font-medium text-right">Average</th>
                  <th className="px-4 py-2.5 font-medium text-right">1–2★</th>
                  <th className="px-4 py-2.5 font-medium">Top complaints</th>
                </tr>
              </thead>
              <tbody>
                {byDish.map((d) => {
                  const top = [...d.tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
                  const a = d.sum / d.n
                  return (
                    <tr key={d.dish} className="border-b border-[#e2e8d5] last:border-0">
                      <td className="px-4 py-2.5 font-medium text-[#1A1A1A]">{d.dish}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{d.n}</td>
                      <td className={cn("px-4 py-2.5 text-right font-semibold", a >= 4 ? "text-[#1B5E20]" : a >= 3 ? "text-amber-600" : "text-red-600")}>{a.toFixed(1)}★</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{pct(d.bad, d.n)}%</td>
                      <td className="px-4 py-2.5 text-gray-500">{top.length ? top.map(([t, n]) => `${tagLabel(t, 1)} ×${n}`).join(", ") : "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ScheduleCard settings={settings} pushOn={pushOn} say={say} />
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-2xl border border-[#e2e8d5] bg-white px-4 py-3 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn("text-2xl font-bold mt-0.5", tone === "green" ? "text-[#1B5E20]" : tone === "red" ? "text-red-600" : "text-[#1A1A1A]")}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border border-[#e2e8d5] bg-white px-2 text-xs text-gray-700 max-w-[200px]"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

function RatingItem({ r, focused, followUp, say }: { r: RatingRow; focused: boolean; followUp?: boolean; say: (ok: boolean, text: string) => void }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState("")
  const s = r.stars ?? 0
  const badRating = s > 0 && s <= 2
  const first = r.name.split(" ")[0]
  const wa = waLink(
    r.phone,
    `Hi ${first}, this is GreenFeast. Thank you for rating your ${r.slot} on ${day(r.date)}. We're sorry it wasn't up to the mark — could you tell us a little more so we can put it right?`
  )

  function setHandled(handled: boolean) {
    start(async () => {
      const res = await setRatingHandled(r.id, handled, note)
      if (!res.ok) return say(false, res.error)
      say(true, handled ? "Marked handled." : "Reopened.")
      setNoting(false)
      setNote("")
      router.refresh()
    })
  }

  return (
    <div
      id={followUp ? `followup-${r.id}` : `rating-${r.id}`}
      className={cn(
        "rounded-xl border bg-white px-4 py-3",
        badRating && !r.handledAt ? "border-red-200" : "border-[#e2e8d5]",
        focused && "ring-2 ring-[#1B5E20]/50"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Stars value={s} />
            <span className={cn("text-xs font-semibold", s >= 4 ? "text-[#1B5E20]" : s === 3 ? "text-amber-600" : "text-red-600")}>{STAR_WORD[s]}</span>
            <span className="text-sm font-semibold text-[#1A1A1A]">{r.dishes}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {r.subscriptionId ? (
              <Link href={`/subscribers/${r.subscriptionId}`} className="font-medium text-[#1B5E20] hover:underline">{r.name}</Link>
            ) : (
              <span className="font-medium text-gray-700">{r.name}</span>
            )}
            {r.code && <span className="text-gray-400"> · {r.code}</span>}
            {" · "}
            {day(r.date)} {r.slot}
            {r.batch && <> · {r.batch}</>}
            {r.partner && <> · rider {r.partner}</>}
          </p>
        </div>
        <span className="text-xs text-gray-400 whitespace-nowrap">{r.ratedAt ? when(r.ratedAt) : ""}{r.source === "history" ? " · from Order history" : ""}</span>
      </div>

      {r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {r.tags.map((t) => (
            <span key={t} className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", s >= 4 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
              {tagLabel(t, s)}
            </span>
          ))}
        </div>
      )}
      {r.comment && <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">&ldquo;{r.comment}&rdquo;</p>}

      {badRating && (
        <div className="mt-3 pt-3 border-t border-[#e2e8d5] flex flex-wrap items-center gap-2">
          {r.handledAt ? (
            <>
              <span className="text-xs text-gray-500">
                <CheckCircle className="inline w-3.5 h-3.5 text-[#1B5E20] -mt-0.5 mr-1" />
                Handled by {r.handledBy ?? "admin"} · {when(r.handledAt)}
                {r.adminNote && <> — {r.adminNote}</>}
              </span>
              <button onClick={() => setHandled(false)} disabled={busy} className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40">
                <RotateCcw className="w-3.5 h-3.5" /> Reopen
              </button>
            </>
          ) : noting ? (
            <>
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setHandled(true)}
                placeholder="What was done? (optional) — e.g. called, refunded a meal"
                className="flex-1 min-w-[220px] h-8 rounded-lg border border-[#e2e8d5] px-2.5 text-sm"
              />
              <button onClick={() => setHandled(true)} disabled={busy} className="h-8 px-3 rounded-lg bg-[#1B5E20] text-white text-xs font-medium disabled:opacity-40">Save</button>
              <button onClick={() => setNoting(false)} disabled={busy} className="h-8 px-3 rounded-lg border border-[#e2e8d5] text-xs text-gray-600">Cancel</button>
            </>
          ) : (
            <>
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#25D366]/40 text-xs font-medium text-[#128C7E] hover:bg-green-50">
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp {first}
                </a>
              )}
              <button onClick={() => setNoting(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#1B5E20] text-white text-xs font-medium hover:bg-[#155116]">
                <CheckCircle className="w-3.5 h-3.5" /> Mark handled
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ScheduleCard({ settings, pushOn, say }: { settings: RatingSettings; pushOn: boolean; say: (ok: boolean, text: string) => void }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [frequency, setFrequency] = useState<RatingFrequency>(settings.frequency)
  const [daily, setDaily] = useState(String(settings.autoDailyAfter))
  const [weekly, setWeekly] = useState(String(settings.autoWeeklyAfter))
  const changed = frequency !== settings.frequency || daily !== String(settings.autoDailyAfter) || weekly !== String(settings.autoWeeklyAfter)

  function save() {
    start(async () => {
      const res = await saveRatingSettings({ frequency, autoDailyAfter: Number(daily), autoWeeklyAfter: Number(weekly) })
      if (!res.ok) return say(false, res.error)
      say(true, "Saved — applies to the next meals delivered.")
      router.refresh()
    })
  }

  return (
    <section className="rounded-2xl border border-[#e2e8d5] bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-[#1A1A1A] flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-gray-400" /> How often customers are asked
      </h2>
      <p className="text-sm text-gray-500 mt-0.5">
        Asking = the rating card on the app&apos;s Home screen after a meal is delivered, or the push reminder. After any 1–2★ rating, that customer&apos;s next 3 meals are always asked.
      </p>
      <div className="mt-4 grid sm:grid-cols-2 gap-2">
        {FREQUENCY_OPTIONS.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer",
              frequency === o.value ? "border-[#1B5E20] bg-green-50/50" : "border-[#e2e8d5] hover:bg-gray-50"
            )}
          >
            <input type="radio" name="frequency" checked={frequency === o.value} onChange={() => setFrequency(o.value)} className="mt-1 accent-[#1B5E20]" />
            <span>
              <span className="block text-sm font-medium text-[#1A1A1A]">{o.label}</span>
              <span className="block text-xs text-gray-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {frequency === "auto" && (
        <p className="mt-3 text-sm text-gray-600 flex flex-wrap items-center gap-1.5">
          Every meal for a customer&apos;s first
          <input type="number" min={0} max={1000} value={daily} onChange={(e) => setDaily(e.target.value)} className="w-16 h-8 rounded-lg border border-[#e2e8d5] px-2 text-sm" />
          meals, then once a day until meal
          <input type="number" min={0} max={1000} value={weekly} onChange={(e) => setWeekly(e.target.value)} className="w-16 h-8 rounded-lg border border-[#e2e8d5] px-2 text-sm" />
          , then once a week.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8d5] pt-3">
        <p className="text-xs text-gray-500">
          Push reminder (3 PM lunch · 9 PM dinner):{" "}
          <span className={cn("font-semibold", pushOn ? "text-[#1B5E20]" : "text-gray-600")}>{pushOn ? "On" : "Off"}</span> — change it, or its text, in{" "}
          <Link href="/notifications" className="text-[#1B5E20] hover:underline">Notifications → Automated messages → Rate your meal</Link>.
          {settings.updatedBy && <> Last changed by {settings.updatedBy}{settings.updatedAt ? `, ${when(settings.updatedAt)}` : ""}.</>}
        </p>
        <button onClick={save} disabled={!changed || busy} className="h-9 px-4 rounded-lg bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] disabled:opacity-40">
          Save
        </button>
      </div>
    </section>
  )
}

// ── App feedback ──────────────────────────────────────────────────────────────

function AppFeedbackTab({ feedback, say }: { feedback: FeedbackRow[]; say: (ok: boolean, text: string) => void }) {
  return (
    <div className="mt-5 space-y-2">
      {feedback.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-10">
          <MessageSquare className="w-6 h-6 mx-auto mb-2 text-gray-300" />
          No feedback in this period. Customers send it from Account → Send feedback.
        </p>
      )}
      {feedback.map((f) => (
        <FeedbackItem key={f.id} f={f} say={say} />
      ))}
    </div>
  )
}

const KIND_TONE: Record<string, string> = {
  problem: "bg-red-100 text-red-700",
  idea: "bg-blue-100 text-blue-700",
  praise: "bg-green-100 text-green-700",
  other: "bg-gray-100 text-gray-600",
}

function FeedbackItem({ f, say }: { f: FeedbackRow; say: (ok: boolean, text: string) => void }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState("")
  const first = f.name.split(" ")[0]
  const wa = waLink(f.phone, `Hi ${first}, this is GreenFeast — thank you for your feedback in the app. `)

  function setHandled(handled: boolean) {
    start(async () => {
      const res = await setFeedbackHandled(f.id, handled, note)
      if (!res.ok) return say(false, res.error)
      say(true, handled ? "Marked handled." : "Reopened.")
      setNoting(false)
      setNote("")
      router.refresh()
    })
  }

  return (
    <div className={cn("rounded-xl border bg-white px-4 py-3", f.handledAt ? "border-[#e2e8d5]" : "border-[#1B5E20]/40")}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold", KIND_TONE[f.kind] ?? KIND_TONE.other)}>{FEEDBACK_KIND[f.kind] ?? "Other"}</span>
          <span className="text-sm font-medium text-gray-700">{f.name}</span>
          {f.code && <span className="text-xs text-gray-400">{f.code}</span>}
        </div>
        <span className="text-xs text-gray-400">
          {when(f.createdAt)}
          {f.appVersion && ` · v${f.appVersion}`}
          {f.platform && ` · ${f.platform}`}
        </span>
      </div>
      <p className="text-sm text-gray-800 mt-2 whitespace-pre-wrap">{f.message}</p>
      <div className="mt-3 pt-3 border-t border-[#e2e8d5] flex flex-wrap items-center gap-2">
        {f.handledAt ? (
          <>
            <span className="text-xs text-gray-500">
              <CheckCircle className="inline w-3.5 h-3.5 text-[#1B5E20] -mt-0.5 mr-1" />
              Handled by {f.handledBy ?? "admin"} · {when(f.handledAt)}
              {f.adminNote && <> — {f.adminNote}</>}
            </span>
            <button onClick={() => setHandled(false)} disabled={busy} className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /> Reopen
            </button>
          </>
        ) : noting ? (
          <>
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setHandled(true)}
              placeholder="What was done? (optional)"
              className="flex-1 min-w-[220px] h-8 rounded-lg border border-[#e2e8d5] px-2.5 text-sm"
            />
            <button onClick={() => setHandled(true)} disabled={busy} className="h-8 px-3 rounded-lg bg-[#1B5E20] text-white text-xs font-medium disabled:opacity-40">Save</button>
            <button onClick={() => setNoting(false)} disabled={busy} className="h-8 px-3 rounded-lg border border-[#e2e8d5] text-xs text-gray-600">Cancel</button>
          </>
        ) : (
          <>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#25D366]/40 text-xs font-medium text-[#128C7E] hover:bg-green-50">
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp {first}
              </a>
            )}
            <button onClick={() => setNoting(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#1B5E20] text-white text-xs font-medium hover:bg-[#155116]">
              <CheckCircle className="w-3.5 h-3.5" /> Mark handled
            </button>
          </>
        )}
      </div>
    </div>
  )
}
