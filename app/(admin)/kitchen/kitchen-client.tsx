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

type MealTemplate = {
  id: string
  name: string
  category: string
}

// day_of_week convention: 0=Mon, 1=Tue, ..., 6=Sun (matches propagateMenuChanges + instantiate-orders)
const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const SLOTS = ["lunch", "dinner"] as const

export function KitchenClient({ initialRows, initialNextMeals }: { initialRows: WeeklyMenuRow[]; initialNextMeals: NextMealItem[] }) {
  const [rows, setRows] = useState(initialRows)
  const [nextMeals, setNextMeals] = useState(initialNextMeals)
  const [meals, setMeals] = useState<MealTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const [swappingOrder, setSwappingOrder] = useState<string | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [toast, setToast] = useState("")

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
        <p className="text-gray-600">Edit M1 and M2 weekly menus. Changes apply to future un-swapped orders.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {(["M1", "M2"] as const).map((menuType) => (
          <div key={menuType} className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">{menuType} Menu</h2>

            <div className="space-y-3">
              {DOW_NAMES.map((dow, dayOfWeek) => (
                <div key={dow} className="border border-gray-100 rounded p-3">
                  <div className="font-semibold text-gray-700 mb-2 text-sm">{dow}</div>

                  <div className="space-y-2">
                    {SLOTS.map((slot) => {
                      const row = getRow(menuType, dayOfWeek, slot)
                      const pickerKey = rowKey(menuType, dayOfWeek, slot)
                      const isOpen = openPicker === pickerKey

                      return (
                        // relative here so the absolute dropdown is scoped to this cell
                        <div key={`${dow}-${slot}`} className="relative flex items-center justify-between p-2 bg-gray-50 rounded">
                          <div className="text-sm text-gray-600 capitalize w-12 shrink-0">{slot}</div>

                          <div className="flex-1 mx-3 min-w-0">
                            {row ? (
                              <div className="text-sm font-medium text-gray-900 truncate">{row.mealName}</div>
                            ) : (
                              <div className="text-sm text-gray-400">—</div>
                            )}
                          </div>

                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenPicker(isOpen ? null : pickerKey) }}
                              className="p-1.5 rounded border border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition"
                            >
                              <ChevronDown size={14} />
                            </button>
                            {row && (
                              <button
                                onClick={() => handleClear(menuType, dayOfWeek, slot)}
                                className="p-1.5 rounded border border-gray-300 hover:border-red-300 text-gray-600 hover:text-red-600 transition"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>

                          {isOpen && (
                            <div
                              className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded shadow-lg z-20 max-h-52 overflow-y-auto"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {meals.map((meal) => (
                                <button
                                  key={meal.id}
                                  onClick={() => handleSelectMeal(menuType, dayOfWeek, slot, meal.id, meal.name)}
                                  className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-green-50 border-b border-gray-100 last:border-0"
                                >
                                  {meal.name} <span className="text-gray-400 text-xs">({meal.category})</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
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
      <div className="bg-white rounded-lg border border-gray-200 p-6">
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
                <div key={item.orderId} className="flex items-center justify-between p-3 border border-gray-100 rounded bg-gray-50">
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

      {/* Swap picker — fixed full-screen overlay so it always renders correctly */}
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
