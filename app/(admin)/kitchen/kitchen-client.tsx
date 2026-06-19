"use client"

import { useEffect, useState, useTransition } from "react"
import { Loader2, ChevronDown, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { updateWeeklyMenu, propagateMenuChanges } from "./actions"

export type WeeklyMenuRow = {
  id: string
  menuType: "M1" | "M2"
  dayOfWeek: number
  mealSlot: "lunch" | "dinner"
  mealTemplateId: string | null
  mealName: string | null
}

type MealTemplate = {
  id: string
  name: string
  category: string
}

const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const SLOTS = ["lunch", "dinner"] as const

export function KitchenClient({ initialRows }: { initialRows: WeeklyMenuRow[] }) {
  const [rows, setRows] = useState(initialRows)
  const [meals, setMeals] = useState<MealTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [, startTransition] = useTransition()
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const [toast, setToast] = useState("")

  useEffect(() => {
    supabase
      .from("meal_templates")
      .select("id, name, category")
      .eq("is_active", true)
      .order("category")
      .then(({ data }) => setMeals((data as MealTemplate[]) ?? []))
  }, [])

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
    if (existing && existing.mealTemplateId === mealId) return
    setOpenPicker(null)

    const updated = existing
      ? rows.map((r) =>
          r.id === existing.id
            ? { ...r, mealTemplateId: mealId, mealName }
            : r
        )
      : [
          ...rows,
          {
            id: `temp-${Date.now()}`,
            menuType,
            dayOfWeek,
            mealSlot: slot,
            mealTemplateId: mealId,
            mealName,
          } as WeeklyMenuRow,
        ]
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

  const m1Rows = rows.filter((r) => r.menuType === "M1")
  const m2Rows = rows.filter((r) => r.menuType === "M2")

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
                  <Text className="font-semibold text-gray-700 mb-2">{dow}</Text>

                  <div className="space-y-2">
                    {SLOTS.map((slot) => {
                      const row = getRow(menuType, dayOfWeek, slot)
                      const pickerKey = rowKey(menuType, dayOfWeek, slot)
                      const isOpen = openPicker === pickerKey

                      return (
                        <div key={`${dow}-${slot}`} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <Text className="text-sm text-gray-600 capitalize">{slot}</Text>

                          <div className="flex-1 mx-3">
                            {row ? (
                              <Text className="text-sm font-medium text-gray-900">{row.mealName}</Text>
                            ) : (
                              <Text className="text-sm text-gray-400">—</Text>
                            )}
                          </div>

                          <div className="flex gap-1">
                            <button
                              onClick={() => setOpenPicker(isOpen ? null : pickerKey)}
                              className="p-1.5 rounded border border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition"
                            >
                              <ChevronDown size={16} />
                            </button>
                            {row && (
                              <button
                                onClick={() => handleClear(menuType, dayOfWeek, slot)}
                                className="p-1.5 rounded border border-gray-300 hover:border-red-300 text-gray-600 hover:text-red-600 transition"
                              >
                                <X size={16} />
                              </button>
                            )}
                          </div>

                          {isOpen && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded shadow-lg z-20 max-h-48 overflow-y-auto">
                              {meals.map((meal) => (
                                <button
                                  key={meal.id}
                                  onClick={() =>
                                    handleSelectMeal(menuType, dayOfWeek, slot, meal.id, meal.name)
                                  }
                                  className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-blue-50 border-b border-gray-100 last:border-0"
                                >
                                  {meal.name} <span className="text-gray-500 text-xs ml-2">({meal.category})</span>
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

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save menu
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg shadow">
          {toast}
        </div>
      )}
    </>
  )
}

function Text({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>
}
