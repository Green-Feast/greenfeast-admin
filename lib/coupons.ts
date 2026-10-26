// Coupons (migration 066) — shared by the Coupons page, its actions and the
// Create subscription picker. A coupon sets its own price for one meal on each
// plan it covers (15- and 30-meal plans only); the plan costs that × meals.
import { planMealRate } from "./pricing"

export type CouponPlan = { id: string; name: string; meals_total: number; base_price: number }

export type CouponRow = {
  id: string
  code: string
  name: string | null
  startsOn: string
  endsOn: string
  forNew: boolean
  forRenewal: boolean
  forSelected: boolean
  maxPerCustomer: number | null
  maxTotal: number | null
  active: boolean
  createdBy: string | null
  createdAt: string
  prices: Record<string, number> // plan id → meal price (paise)
  customerIds: string[]
  uses: number
  saved: number // paise, across all uses
}

export type CouponUse = {
  id: string
  couponId: string
  userId: string
  name: string
  code: string // customer code
  planId: string
  kind: "new" | "renewal" | "admin"
  mealPrice: number
  regularMealPrice: number
  meals: number
  saved: number
  createdAt: string
}

export type CouponCustomer = { id: string; name: string; code: string; phone: string | null; plan: string | null }

export type CouponInput = {
  id?: string
  code: string
  name: string
  startsOn: string
  endsOn: string
  forNew: boolean
  forRenewal: boolean
  forSelected: boolean
  customerIds: string[]
  maxPerCustomer: number | null
  maxTotal: number | null
  prices: Record<string, number>
}

export type CouponStatus = "active" | "scheduled" | "ended" | "paused" | "used_up"

export function couponStatus(c: Pick<CouponRow, "active" | "startsOn" | "endsOn" | "maxTotal" | "uses">, today: string): CouponStatus {
  if (!c.active) return "paused"
  if (today < c.startsOn) return "scheduled"
  if (today > c.endsOn) return "ended"
  if (c.maxTotal != null && c.uses >= c.maxTotal) return "used_up"
  return "active"
}

export const STATUS_LABEL: Record<CouponStatus, string> = {
  active: "Active",
  scheduled: "Scheduled",
  ended: "Ended",
  paused: "Paused",
  used_up: "Used up",
}

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,23}$/

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24)
}

// e.g. GF-7KQ2M9 — no 0/O/1/I so it reads cleanly when typed from a message.
export function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let s = ""
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `GF-${s}`
}

// ── Calculator: % off ⇄ price per meal ⇄ plan total, for one plan ───────────
export const regularMealPrice = planMealRate

export function mealFromPct(plan: CouponPlan, pct: number): number {
  return Math.round(regularMealPrice(plan) * (1 - pct / 100))
}

export function mealFromTotal(plan: CouponPlan, totalPaise: number): number {
  return Math.round(totalPaise / Math.max(plan.meals_total, 1))
}

export function pctOff(plan: CouponPlan, mealPaise: number): number {
  const regular = regularMealPrice(plan)
  return regular > 0 ? (1 - mealPaise / regular) * 100 : 0
}

export function planTotal(plan: CouponPlan, mealPaise: number): number {
  return mealPaise * plan.meals_total
}

// A meal price the database accepts: above zero and below the regular price.
export function validMealPrice(plan: CouponPlan, mealPaise: number): boolean {
  return Number.isInteger(mealPaise) && mealPaise > 0 && mealPaise < regularMealPrice(plan)
}

// "₹229" or "₹249.97" — paise only when there are some.
export function rupees(paise: number): string {
  const r = paise / 100
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`
}

export function pctText(pct: number): string {
  const r = Math.round(pct * 10) / 10
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`
}

export function audienceText(c: Pick<CouponRow, "forNew" | "forRenewal" | "forSelected" | "customerIds">): string {
  const parts: string[] = []
  if (c.forNew) parts.push("New sign-ups")
  if (c.forRenewal) parts.push("Renewers")
  if (c.forSelected) parts.push(`${c.customerIds.length} selected customer${c.customerIds.length === 1 ? "" : "s"}`)
  return parts.join(" · ")
}

// Inclusive day count between two YYYY-MM-DD dates.
export function daysBetween(start: string, end: string): number {
  const ms = new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime()
  return Math.floor(ms / 86400000) + 1
}
