"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { monthLabel } from "@/lib/money-labels"

function shift(month: string, n: number) {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

// ?month=YYYY-MM on the current page (keeps the other params).
export function MonthPicker({ month, max }: { month: string; max?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const go = (m: string) => {
    const next = new URLSearchParams(params.toString())
    next.set("month", m)
    router.push(`${pathname}?${next.toString()}`)
  }
  const atMax = max ? month >= max : false
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-[#e2e8d5] bg-white p-1">
      <button onClick={() => go(shift(month, -1))} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="Previous month">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="px-2 text-sm font-semibold text-[#1A1A1A] min-w-[8.5rem] text-center">{monthLabel(month)}</span>
      <button onClick={() => !atMax && go(shift(month, 1))} disabled={atMax} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30" aria-label="Next month">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  // BOM so Excel reads ₹ and names correctly.
  const blob = new Blob(["﻿" + text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
