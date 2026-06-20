"use client"

import { useEffect, useState } from "react"
import { Loader2, ChevronDown, X, ArrowRight } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { updateWeeklyMenu, propagateMenuChanges, swapMealForOrder } from "./actions"

export type WeeklyMenuRow = {
  id: string
  menuType: "M1" | "M2"
  dayOfWeek: number
  mealSlot: "lunch" | "dinner"
  mealTemplateId: string | null
  mealName: string | null
}

export type NextMealItem = {
  orderId: string
  subscriptionId: string
  menuType: "M1" | "M2"
  userName: string
  mealName: string
  deliveryDate: string
  mealSlot: "lunch" | "dinner"
}

export type WeeklyOverviewCell = {
  mealName: string
  slot: string
  dow: string
  dowNum: number
  quantity: number
  isCustomized: boolean
  addons: string[]
}

export type WeeklyOverviewRow = {
  subscriptionId: string
  userName: string
  menuType: string
  days: Record<string, WeeklyOverviewCell>
}

type MealTemplate = {
  id: string
  name: string
  category: string
}

// day_of_week convention: 0=Mon, 1=Tue, ..., 6=Sun (matches propagateMenuChanges + instantiate-orders)
const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

// Today's day-of-week in Mon=0 convention (used to grey out past days)
function todayDow(): number {
  return (new Date().getDay() + 6) % 7
}

const GRIDS = [
  { menuType: "M1" as const, slot: "lunch" as const, label: "M1 — Lunch" },
  { menuType: "M1" as const, slot: "dinner" as const, label: "M1 — Dinner" },
  { menuType: "M2" as const, slot: "lunch" as const, label: "M2 — Lunch" },
  { menuType: "M2" as const, slot: "dinner" as const, label: "M2 — Dinner" },
]

export function KitchenClient({
  initialRows,
  initialNextMeals,
  weeklyOverview,
  weekDates,
}: {
  initialRows: WeeklyMenuRow[]
  initialNextMeals: NextMealItem[]
  weeklyOverview: WeeklyOverviewRow[]
  weekDates: { weekStart: string; weekEnd: string }
}) {
  const [rows, setRows] = useState(initialRows)
  const [nextMeals, setNextMeals] = useState(initialNextMeals)
  const [meals, setMeals] = useState<MealTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const [swappingOrder, setSwappingOrder] = useState<string | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [toast, setToast] = useState("")
  const [currentDow] = useState(todayDow)

  useEffect(() => {
    supabase
      .from("meal_templates")
      .select("id, name, category")
      .eq("is_active", true)
      .order("category")
      .then(({ data }) => setMeals((data as MealTemplate[]) ?? []))
  }, [])

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

  function rowKey(menuType: "M1" | "M2", dayOfWeek: number, slot: "lunch" | "dinner") {
    return `${menuType}-${dayOfWeek}-${slot}`
  }

  function getRow(menuType: "M1" | "M2", dayOfWeek: number, slot: "lunch" | "dinner") {
    return rows.find(
      (r) => r.menuType === menuType && r.dayOfWeek === dayOfWeek && r.mealSlot === slot
    )
  }

  function handleSelectMeal(
    menuType: "M1" | "M2",
    dayOfWeek: number,
    slot: "lunch" | "dinner",
    mealId: string,
    mealName: string
  ) {
    const existing = getRow(menuType, dayOfWeek, slot)
    if (existing && existing.mealTemplateId === mealId) { setOpenPicker(null); return }
    setOpenPicker(null)
    const updated = existing
      ? rows.map((r) => r.id === existing.id ? { ...r, mealTemplateId: mealId, mealName } : r)
      : [...rows, { id: `temp-${Date.now()}`, menuType, dayOfWeek, mealSlot: slot, mealTemplateId: mealId, mealName } as WeeklyMenuRow]
    setRows(updated)
  }

  function handleClear(menuType: "M1" | "M2", dayOfWeek: number, slot: "lunch" | "dinner") {
    const existing = getRow(menuType, dayOfWeek, slot)
    if (!existing) return
    setRows(rows.filter((r) => r.id !== existing.id))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateWeeklyMenu(rows)
      await propagateMenuChanges(rows)
      showToast("Menu saved & applied to future orders")
    } catch (e: any) {
      showToast("Save failed. Try again.")
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  async function handleSwapMeal(orderId: string, mealId: string, mealName: string) {
    setSwapping(true)
    try {
      await swapMealForOrder(orderId, mealId)
      setNextMeals(nextMeals.map(m => m.orderId === orderId ? { ...m, mealName } : m))
      setSwappingOrder(null)
      showToast("Meal swapped")
    } catch (e: any) {
      showToast("Swap failed. Try again.")
      console.error(e)
    } finally {
      setSwapping(false)
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Kitchen Menu</h1>
        <p className="text-gray-600">Set M1 and M2 menus for each day. Changes apply to future un-swapped orders.</p>
      </div>

      {/* 4 grids: M1 Lunch, M1 Dinner, M2 Lunch, M2 Dinner */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {GRIDS.map(({ menuType, slot, label }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded bg-[#E8F5E9] text-[#1B5E20] text-xs font-bold">
                {menuType}
              </span>
              <span className="capitalize text-gray-700">{slot}</span>
            </h2>

            <div className="space-y-1.5">
              {DOW_NAMES.map((dow, dayOfWeek) => {
                const isPast = dayOfWeek < currentDow
                const row = getRow(menuType, dayOfWeek, slot)
                const pickerKey = rowKey(menuType, dayOfWeek, slot)
                const isOpen = openPicker === pickerKey

                return (
                  <div
                    key={dow}
                    className={`relative flex items-center gap-3 p-2.5 rounded-lg border ${
                      isPast ? "border-gray-100 bg-gray-50/50 opacity-50" : "border-gray-100 bg-gray-50"
                    }`}
                  >
                    <span className={`w-8 shrink-0 text-xs font-semibold ${isPast ? "text-gray-400" : "text-gray-600"}`}>
                      {dow}
                    </span>

                    <div className="flex-1 min-w-0">
                      {row ? (
                        <span className="text-sm font-medium text-gray-900 truncate block">{row.mealName}</span>
                      ) : (
                        <span className="text-sm text-gray-400">— not set —</span>
                      )}
                    </div>

                    <div className="flex gap-1 shrink-0">
                      <button
                        disabled={isPast}
                        onClick={(e) => { e.stopPropagation(); setOpenPicker(isOpen ? null : pickerKey) }}
                        className="p-1.5 rounded border border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition disabled:cursor-not-allowed"
                      >
                        <ChevronDown size={13} />
                      </button>
                      {row && !isPast && (
                        <button
                          onClick={() => handleClear(menuType, dayOfWeek, slot)}
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
                        {meals.map((meal) => (
                          <button
                            key={meal.id}
                            onClick={() => handleSelectMeal(menuType, dayOfWeek, slot, meal.id, meal.name)}
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

      {/* Next meal per user */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Next meal per user</h2>

        {nextMeals.length === 0 ? (
          <p className="text-gray-500 text-sm">No upcoming orders</p>
        ) : (
          <div className="space-y-2">
            {nextMeals.map((item) => {
              const fmtDate = new Date(item.deliveryDate + "T00:00:00").toLocaleDateString("en-IN", {
                weekday: "short", month: "short", day: "numeric",
              })
              return (
                <div key={item.orderId} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#E8F5E9] text-[#1B5E20] text-xs font-bold shrink-0">
                        {item.menuType}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 text-sm truncate">{item.userName}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {item.mealName} · <span className="capitalize">{item.mealSlot}</span> · {fmtDate}
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setSwappingOrder(item.orderId)}
                    className="ml-3 px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:border-[#1B5E20] hover:text-[#1B5E20] text-sm font-medium transition flex items-center gap-1 shrink-0"
                  >
                    Swap <ArrowRight size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Weekly subscriber meal overview */}
      <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-900">This week's orders</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {new Date(weekDates.weekStart + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              {" – "}
              {new Date(weekDates.weekEnd + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E8F5E9] text-[#1B5E20] text-sm font-semibold">
              {weeklyOverview.length} subscriber{weeklyOverview.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {weeklyOverview.length === 0 ? (
          <p className="text-gray-500 text-sm">No orders found for this week.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-xs border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left font-semibold text-gray-600 py-2.5 px-3 whitespace-nowrap w-36">Subscriber</th>
                  {DOW_NAMES.map((d) => (
                    <th key={d} className="text-center font-semibold text-gray-600 py-2.5 px-1 w-[13%]">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeklyOverview.map((sub, idx) => (
                  <tr key={sub.subscriptionId} className={`border-b border-gray-100 last:border-0 hover:bg-green-50/30 transition-colors ${idx % 2 === 1 ? "bg-gray-50/40" : ""}`}>
                    <td className="py-2.5 px-3 align-top">
                      <div className="font-semibold text-gray-900 truncate max-w-[8rem]">{sub.userName}</div>
                      <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-[#E8F5E9] text-[#1B5E20] text-[10px] font-bold mt-1">
                        {sub.menuType}
                      </span>
                    </td>
                    {DOW_NAMES.map((_, dowNum) => {
                      const lunch = sub.days[`${dowNum}-lunch`]
                      const dinner = sub.days[`${dowNum}-dinner`]
                      return (
                        <td key={dowNum} className="py-2.5 px-1.5 align-top">
                          {lunch && (
                            <div className={`mb-1 ${lunch.isCustomized ? "text-amber-700" : "text-gray-700"}`}>
                              <span className="font-medium text-[10px] uppercase text-gray-400 block">L</span>
                              <span className="block leading-tight">
                                {lunch.mealName}
                                {lunch.isCustomized && <span className="ml-1 text-amber-500" title="Switched">✦</span>}
                                {lunch.quantity > 1 && <span className="ml-1 text-gray-400">×{lunch.quantity}</span>}
                              </span>
                              {lunch.addons.length > 0 && (
                                <span className="block text-[10px] text-gray-400 leading-tight">{lunch.addons.join(", ")}</span>
                              )}
                            </div>
                          )}
                          {dinner && (
                            <div className={dinner.isCustomized ? "text-amber-700" : "text-gray-700"}>
                              <span className="font-medium text-[10px] uppercase text-gray-400 block">D</span>
                              <span className="block leading-tight">
                                {dinner.mealName}
                                {dinner.isCustomized && <span className="ml-1 text-amber-500" title="Switched">✦</span>}
                                {dinner.quantity > 1 && <span className="ml-1 text-gray-400">×{dinner.quantity}</span>}
                              </span>
                              {dinner.addons.length > 0 && (
                                <span className="block text-[10px] text-gray-400 leading-tight">{dinner.addons.join(", ")}</span>
                              )}
                            </div>
                          )}
                          {!lunch && !dinner && (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-gray-400">✦ = subscriber-switched meal</p>
          </div>
        )}
      </div>

      {/* Swap picker overlay */}
      {swappingOrder && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setSwappingOrder(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-5 w-80 max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <div className="font-bold text-gray-900">Swap meal</div>
              <button onClick={() => setSwappingOrder(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto space-y-1">
              {meals.map((meal) => (
                <button
                  key={meal.id}
                  onClick={() => handleSwapMeal(swappingOrder, meal.id, meal.name)}
                  disabled={swapping}
                  className="w-full text-left px-3 py-2 rounded text-sm text-gray-900 hover:bg-[#E8F5E9] border border-transparent hover:border-[#1B5E20]/20 transition disabled:opacity-50 flex items-center justify-between"
                >
                  <span>
                    {meal.name} <span className="text-gray-400 text-xs">({meal.category})</span>
                  </span>
                  {swapping && <Loader2 className="w-3 h-3 animate-spin text-gray-400 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 md:w-80 bg-[#E8F5E9] border border-[#1B5E20]/30 text-[#1B5E20] px-4 py-3 rounded-lg shadow-lg text-sm font-medium z-50">
          {toast}
        </div>
      )}
    </>
  )
}
