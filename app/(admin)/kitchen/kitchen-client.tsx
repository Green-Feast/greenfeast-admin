"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ChevronDown, X, ChevronLeft, ChevronRight, Pin, Plus } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { istToday, addDaysISO } from "@/lib/ist"
import { cn } from "@/lib/utils"
import { OrderEditor, type EditorTarget } from "@/components/order-editor"
import {
  updateWeeklyMenu,
  propagateMenuChanges,
  saveDailyAvailability,
  saveDailySpecials,
} from "./actions"

// One weekly menu for everyone (the M1/M2 tracks merged in migration 052).
export type WeeklyMenuRow = {
  id: string
  dayOfWeek: number
  mealSlot: "lunch" | "dinner"
  mealTemplateId: string | null
  mealName: string | null
}

export type CellItem = {
  mealName: string
  quantity: number
  status: string
  skipReason: string | null
  extra: boolean
  customized: boolean
  addons: string[]
}

export type WeeklyOverviewRow = {
  subscriptionId: string
  userId: string
  userName: string
  fixed: string[]
  // "YYYY-MM-DD|lunch" → every order in that slot (base, extras, skipped…)
  cells: Record<string, CellItem[]>
}

type MealTemplate = {
  id: string
  name: string
  category: string
  subscriptionValid: boolean
}

type AddonTemplate = {
  id: string
  name: string
}

// day_of_week convention: 0=Mon, 1=Tue, ..., 6=Sun (matches propagateMenuChanges + instantiate-orders)
const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const GRIDS = [
  { slot: "lunch" as const, label: "Lunch" },
  { slot: "dinner" as const, label: "Dinner" },
]

function shortDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })
}

export function KitchenClient({
  initialRows,
  weeklyOverview,
  week,
  catalogue,
}: {
  initialRows: WeeklyMenuRow[]
  weeklyOverview: WeeklyOverviewRow[]
  week: { start: string; end: string; today: string }
  catalogue: { meals: { id: string; name: string; category: string }[]; addons: { id: string; name: string; price_per_meal: number }[] }
}) {
  const router = useRouter()
  const [rows, setRows] = useState(initialRows)
  const [meals, setMeals] = useState<MealTemplate[]>([])
  const [addons, setAddons] = useState<AddonTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const [toast, setToast] = useState("")
  const [editing, setEditing] = useState<EditorTarget | null>(null)

  // "Today's kitchen" — per-date availability + specials
  const [availDate, setAvailDate] = useState(istToday)
  const [mealAvail, setMealAvail] = useState<Record<string, boolean>>({})
  const [addonAvail, setAddonAvail] = useState<Record<string, boolean>>({})
  const [specials, setSpecials] = useState<(string | null)[]>([null, null])
  const [availLoading, setAvailLoading] = useState(true)
  const [availSaving, setAvailSaving] = useState(false)

  useEffect(() => {
    // Unfiltered on subscription_valid — this same list also powers the
    // "Meals available" per-date checklist below, which must still cover
    // menu-visible-but-takeaway-only dishes too (meal_availability also
    // drives their greying in the app's Menu tab). Filtered separately at
    // each subscription-only picker (weekly menu, specials) instead.
    supabase
      .from("meal_templates")
      .select("id, name, category, subscription_valid")
      .eq("is_active", true)
      .order("category")
      .then(({ data }) =>
        setMeals(
          ((data ?? []) as { id: string; name: string; category: string; subscription_valid: boolean }[])
            .map((m) => ({ id: m.id, name: m.name, category: m.category, subscriptionValid: m.subscription_valid }))
        )
      )

    supabase
      .from("addons")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setAddons((data as AddonTemplate[]) ?? []))
  }, [])

  // Refetch whenever the admin picks a different date. Public-read policies
  // on all three tables (038_daily_availability.sql) mean the anon client
  // can read them directly, same as the meal_templates/addons catalogue
  // fetches above.
  useEffect(() => {
    let cancelled = false

    async function load() {
      setAvailLoading(true)
      const [mealRes, addonRes, specialRes] = await Promise.all([
        supabase.from("meal_availability").select("meal_template_id, is_available").eq("for_date", availDate),
        supabase.from("addon_availability").select("addon_id, is_available").eq("for_date", availDate),
        supabase.from("daily_specials").select("sort_order, meal_template_id").eq("for_date", availDate).order("sort_order"),
      ])
      if (cancelled) return

      const mealMap: Record<string, boolean> = {}
      for (const r of (mealRes.data ?? []) as { meal_template_id: string; is_available: boolean }[]) {
        mealMap[r.meal_template_id] = r.is_available
      }
      setMealAvail(mealMap)

      const addonMap: Record<string, boolean> = {}
      for (const r of (addonRes.data ?? []) as { addon_id: string; is_available: boolean }[]) {
        addonMap[r.addon_id] = r.is_available
      }
      setAddonAvail(addonMap)

      const specialRows = (specialRes.data ?? []) as { sort_order: number; meal_template_id: string }[]
      setSpecials([
        specialRows.find((r) => r.sort_order === 1)?.meal_template_id ?? null,
        specialRows.find((r) => r.sort_order === 2)?.meal_template_id ?? null,
      ])
      setAvailLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [availDate])

  // Close picker on outside click
  useEffect(() => {
    if (!openPicker) return
    const handler = () => setOpenPicker(null)
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [openPicker])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(""), 3000)
  }

  function rowKey(dayOfWeek: number, slot: "lunch" | "dinner") {
    return `${dayOfWeek}-${slot}`
  }

  function getRow(dayOfWeek: number, slot: "lunch" | "dinner") {
    return rows.find((r) => r.dayOfWeek === dayOfWeek && r.mealSlot === slot)
  }

  function handleSelectMeal(dayOfWeek: number, slot: "lunch" | "dinner", mealId: string, mealName: string) {
    const existing = getRow(dayOfWeek, slot)
    if (existing && existing.mealTemplateId === mealId) { setOpenPicker(null); return }
    setOpenPicker(null)
    const updated = existing
      ? rows.map((r) => r.id === existing.id ? { ...r, mealTemplateId: mealId, mealName } : r)
      : [...rows, { id: `temp-${Date.now()}`, dayOfWeek, mealSlot: slot, mealTemplateId: mealId, mealName } as WeeklyMenuRow]
    setRows(updated)
  }

  // Kept in the list with no dish so Save deletes it (it used to vanish from
  // state and never reach the server).
  function handleClear(dayOfWeek: number, slot: "lunch" | "dinner") {
    const existing = getRow(dayOfWeek, slot)
    if (!existing) return
    setRows(rows.map((r) => r.id === existing.id ? { ...r, mealTemplateId: null, mealName: null } : r))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateWeeklyMenu(rows)
      const { frozen } = await propagateMenuChanges(rows)
      setRows((prev) => prev.filter((r) => r.mealTemplateId))
      router.refresh()
      showToast(
        frozen > 0
          ? `Menu saved. ${frozen} of today's orders already past cutoff — left unchanged.`
          : "Menu saved & applied to future orders"
      )
    } catch (e: any) {
      showToast("Save failed. Try again.")
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  // Absence of an entry in the map means available — mirrors the DB's
  // "row absent OR is_available=true" rule exactly.
  function isMealAvail(id: string) {
    return mealAvail[id] !== false
  }
  function isAddonAvail(id: string) {
    return addonAvail[id] !== false
  }
  function toggleMealAvail(id: string) {
    setMealAvail({ ...mealAvail, [id]: !isMealAvail(id) })
  }
  function toggleAddonAvail(id: string) {
    setAddonAvail({ ...addonAvail, [id]: !isAddonAvail(id) })
  }

  function handleSelectSpecial(index: 0 | 1, mealId: string) {
    setOpenPicker(null)
    setSpecials((prev) => {
      const next = [...prev]
      next[index] = mealId
      return next
    })
  }
  function handleClearSpecial(index: 0 | 1) {
    setSpecials((prev) => {
      const next = [...prev]
      next[index] = null
      return next
    })
  }

  async function handleSaveAvailability() {
    setAvailSaving(true)
    try {
      await saveDailyAvailability(availDate, mealAvail, addonAvail)
      await saveDailySpecials(availDate, specials)
      showToast("Today's kitchen saved")
    } catch (e: any) {
      showToast("Save failed. Try again.")
      console.error(e)
    } finally {
      setAvailSaving(false)
    }
  }

  const days = DOW_NAMES.map((_, i) => addDaysISO(week.start, i))

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Kitchen Menu</h1>
        <p className="text-gray-600">One weekly menu for every subscriber. Changes apply to future meals nobody has changed.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {GRIDS.map(({ slot, label }) => (
          <div key={slot} className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-bold text-gray-900 mb-4">{label}</h2>

            <div className="space-y-1.5">
              {DOW_NAMES.map((dow, dayOfWeek) => {
                const row = getRow(dayOfWeek, slot)
                const pickerKey = rowKey(dayOfWeek, slot)
                const isOpen = openPicker === pickerKey

                return (
                  <div key={dow} className="relative flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 bg-gray-50">
                    <span className="w-8 shrink-0 text-xs font-semibold text-gray-600">{dow}</span>

                    <div className="flex-1 min-w-0">
                      {row?.mealTemplateId ? (
                        <span className="text-sm font-medium text-gray-900 truncate block">{row.mealName}</span>
                      ) : (
                        <span className="text-sm text-gray-400">— not set —</span>
                      )}
                    </div>

                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenPicker(isOpen ? null : pickerKey) }}
                        className="p-1.5 rounded border border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition"
                      >
                        <ChevronDown size={13} />
                      </button>
                      {row?.mealTemplateId && (
                        <button
                          onClick={() => handleClear(dayOfWeek, slot)}
                          className="p-1.5 rounded border border-gray-300 hover:border-red-300 text-gray-600 hover:text-red-600 transition"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    {isOpen && (
                      <div
                        className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-52 overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {meals.filter((m) => m.subscriptionValid).map((meal) => (
                          <button
                            key={meal.id}
                            onClick={() => handleSelectMeal(dayOfWeek, slot, meal.id, meal.name)}
                            className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-green-50 border-b border-gray-100 last:border-0"
                          >
                            {meal.name}{" "}
                            <span className="text-gray-400 text-xs">({meal.category})</span>
                          </button>
                        ))}
                        {meals.length === 0 && (
                          <div className="px-3 py-2 text-sm text-gray-400">No meal templates found</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 rounded-lg bg-[#1B5E20] text-white font-medium hover:bg-[#0D3F12] disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save menu
        </button>
      </div>

      {/* Today's kitchen — per-date availability + specials. Separate from
          the weekly Save above on purpose: that one runs propagateMenuChanges
          across every subscription and fires instantiate-orders — coupling a
          2-second toggle to that would be slow and risky. */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Today's kitchen</h2>
            <p className="text-sm text-gray-500 mt-0.5 max-w-md">
              Existing orders keep their meal — this only hides items from subscribers choosing for this date.
            </p>
          </div>
          <input
            type="date"
            value={availDate}
            min={istToday()}
            onChange={(e) => setAvailDate(e.target.value)}
            className="h-9 px-3 rounded-lg border border-gray-300 text-sm text-gray-900"
          />
        </div>

        {availLoading ? (
          <div className="flex items-center justify-center gap-2 text-gray-400 text-sm py-10">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Today's Special */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-3">Today's Special (pick 2)</h3>
              <div className="space-y-1.5">
                {([0, 1] as const).map((i) => {
                  const mealId = specials[i]
                  const meal = meals.find((m) => m.id === mealId)
                  const pickerKey = `special-${i}`
                  const isOpen = openPicker === pickerKey
                  return (
                    <div
                      key={i}
                      className="relative flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 bg-gray-50"
                    >
                      <span className="w-4 shrink-0 text-xs font-semibold text-gray-400">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        {meal ? (
                          <span className="text-sm font-medium text-gray-900 truncate block">{meal.name}</span>
                        ) : (
                          <span className="text-sm text-gray-400">— not set —</span>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenPicker(isOpen ? null : pickerKey) }}
                          className="p-1.5 rounded border border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition"
                        >
                          <ChevronDown size={13} />
                        </button>
                        {meal && (
                          <button
                            onClick={() => handleClearSpecial(i)}
                            className="p-1.5 rounded border border-gray-300 hover:border-red-300 text-gray-600 hover:text-red-600 transition"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      {isOpen && (
                        <div
                          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-52 overflow-y-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {meals.filter((m) => m.subscriptionValid).map((m) => (
                            <button
                              key={m.id}
                              onClick={() => handleSelectSpecial(i, m.id)}
                              className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-green-50 border-b border-gray-100 last:border-0"
                            >
                              {m.name} <span className="text-gray-400 text-xs">({m.category})</span>
                            </button>
                          ))}
                          {meals.length === 0 && (
                            <div className="px-3 py-2 text-sm text-gray-400">No meal templates found</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Meals available */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-3">Meals available</h3>
              <div className="space-y-0.5 max-h-72 overflow-y-auto rounded-lg border border-gray-100">
                {meals.map((meal) => (
                  <label
                    key={meal.id}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={isMealAvail(meal.id)}
                      onChange={() => toggleMealAvail(meal.id)}
                      className="accent-[#1B5E20]"
                    />
                    <span className={isMealAvail(meal.id) ? "text-gray-900" : "text-gray-400 line-through"}>
                      {meal.name}
                    </span>
                  </label>
                ))}
                {meals.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">No meal templates found</div>}
              </div>
            </div>

            {/* Add-ons available */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-3">Add-ons available</h3>
              <div className="space-y-0.5 max-h-72 overflow-y-auto rounded-lg border border-gray-100">
                {addons.map((addon) => (
                  <label
                    key={addon.id}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={isAddonAvail(addon.id)}
                      onChange={() => toggleAddonAvail(addon.id)}
                      className="accent-[#1B5E20]"
                    />
                    <span className={isAddonAvail(addon.id) ? "text-gray-900" : "text-gray-400 line-through"}>
                      {addon.name}
                    </span>
                  </label>
                ))}
                {addons.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">No add-ons found</div>}
              </div>
            </div>
          </div>
        )}

        <div className="mt-5">
          <button
            onClick={handleSaveAvailability}
            disabled={availSaving || availLoading}
            className="px-6 py-2 rounded-lg bg-[#1B5E20] text-white font-medium hover:bg-[#0D3F12] disabled:opacity-50 flex items-center gap-2"
          >
            {availSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save today's kitchen
          </button>
        </div>
      </div>

      {/* Weekly calendar — every subscriber's meals, editable cell by cell */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Subscriber calendar</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {shortDate(week.start)} – {shortDate(week.end)} · click any meal to change the dish, portions, add-ons,
              address, skip it, or set a dish for every day.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push(`/kitchen?week=${addDaysISO(week.start, -7)}`)}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
              title="Previous week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => router.push("/kitchen")}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50"
            >
              This week
            </button>
            <button
              onClick={() => router.push(`/kitchen?week=${addDaysISO(week.start, 7)}`)}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
              title="Next week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E8F5E9] text-[#1B5E20] text-sm font-semibold">
              {weeklyOverview.length} subscriber{weeklyOverview.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {weeklyOverview.length === 0 ? (
          <p className="text-gray-500 text-sm">No subscribers this week.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-xs border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left font-semibold text-gray-600 py-2.5 px-3 whitespace-nowrap w-40">Subscriber</th>
                  {days.map((d, i) => (
                    <th key={d} className={cn("text-center font-semibold py-2.5 px-1 w-[12%]", d === week.today ? "text-[#1B5E20]" : "text-gray-600")}>
                      {DOW_NAMES[i]} <span className="font-normal text-gray-400">{shortDate(d)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeklyOverview.map((sub, idx) => (
                  <tr key={sub.subscriptionId} className={`border-b border-gray-100 last:border-0 ${idx % 2 === 1 ? "bg-gray-50/40" : ""}`}>
                    <td className="py-2.5 px-3 align-top">
                      <div className="font-semibold text-gray-900 truncate max-w-[9rem]">{sub.userName}</div>
                      {sub.fixed.map((f) => (
                        <div key={f} className="mt-1 flex items-center gap-1 text-[10px] text-[#1B5E20]" title="Fixed dish">
                          <Pin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[8rem]">{f}</span>
                        </div>
                      ))}
                    </td>
                    {days.map((d) => (
                      <td key={d} className="py-1.5 px-1 align-top">
                        {(["lunch", "dinner"] as const).map((slot) => (
                          <SlotCell
                            key={slot}
                            slot={slot}
                            items={sub.cells[`${d}|${slot}`] ?? []}
                            past={d < week.today}
                            onOpen={() => setEditing({ subscriptionId: sub.subscriptionId, date: d, slot })}
                          />
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 px-3 pb-3 text-[11px] text-gray-400">
              ✦ changed from the menu · + extra dish · struck through = skipped · ✓ delivered · <Pin className="inline w-3 h-3" /> fixed dish
            </p>
          </div>
        )}
      </div>

      <OrderEditor
        key={editing ? `${editing.subscriptionId}|${editing.date}|${editing.slot}` : "closed"}
        target={editing}
        meals={catalogue.meals}
        addons={catalogue.addons}
        onClose={() => setEditing(null)}
        onChanged={() => router.refresh()}
      />

      {toast && (
        <div className="fixed bottom-4 right-4 md:w-80 bg-[#E8F5E9] border border-[#1B5E20]/30 text-[#1B5E20] px-4 py-3 rounded-lg shadow-lg text-sm font-medium z-50">
          {toast}
        </div>
      )}
    </>
  )
}

function SlotCell({
  slot, items, past, onOpen,
}: {
  slot: "lunch" | "dinner"
  items: CellItem[]
  past: boolean
  onOpen: () => void
}) {
  const label = slot === "lunch" ? "L" : "D"
  if (items.length === 0) {
    if (past) return null
    return (
      <button
        onClick={onOpen}
        className="w-full mb-1 flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-gray-300 hover:text-[#1B5E20] hover:bg-green-50"
        title={`Add a ${slot}`}
      >
        <span className="font-medium uppercase">{label}</span><Plus className="w-3 h-3" />
      </button>
    )
  }
  return (
    <button
      onClick={onOpen}
      className="w-full mb-1 text-left px-1.5 py-1 rounded hover:bg-green-50 hover:ring-1 hover:ring-[#1B5E20]/20 transition"
    >
      <span className="font-medium text-[10px] uppercase text-gray-400 block">{label}</span>
      {items.map((it, i) => {
        const skipped = it.status === "skipped"
        const delivered = it.status === "delivered"
        return (
          <span key={i} className={cn("block leading-tight", skipped ? "text-gray-400 line-through" : it.customized ? "text-amber-700" : "text-gray-700")}>
            {it.extra && <span className="text-violet-600 font-bold">+ </span>}
            {it.mealName}
            {it.customized && !it.extra && <span className="ml-1 text-amber-500" title="Changed from the menu">✦</span>}
            {it.quantity > 1 && <span className="ml-1 text-gray-400">×{it.quantity}</span>}
            {delivered && <span className="ml-1 text-[#1B5E20]">✓</span>}
            {it.addons.length > 0 && !skipped && (
              <span className="block text-[10px] text-gray-400 leading-tight">{it.addons.join(", ")}</span>
            )}
          </span>
        )
      })}
    </button>
  )
}
