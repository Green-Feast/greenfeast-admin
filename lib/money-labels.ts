// Names for the money system's codes (migration 092), shared by the Money tab,
// the Security page and the exports. Client-safe: no server imports.

export const rupees = (paise: number | null | undefined) =>
  `₹${((paise ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

export const CATEGORY: Record<string, { label: string; group: "money_in" | "credit" | "spend" | "out" | "income" | "legacy" }> = {
  payment_cashfree:     { label: "Paid online (Cashfree)", group: "money_in" },
  payment_offline:      { label: "Paid to the office (cash / UPI)", group: "money_in" },
  opening_balance:      { label: "Opening balance (earlier records)", group: "money_in" },
  gift:                 { label: "Gift meals", group: "credit" },
  referral_reward:      { label: "Referral reward", group: "credit" },
  refund_to_wallet:     { label: "Refund to wallet", group: "credit" },
  delivery_reversal:    { label: "Delivery undone", group: "credit" },
  bank_refund_reversed: { label: "Bank refund failed — returned", group: "credit" },
  rounding_credit:      { label: "Rounding credit (old)", group: "credit" },
  meal_charge:          { label: "Meal charged", group: "spend" },
  bank_refund:          { label: "Refund to bank (Cashfree)", group: "out" },
  refund_offline:       { label: "Refund outside Cashfree", group: "out" },
  forfeit:              { label: "Balance forfeited", group: "income" },
  account_closed:       { label: "Account closed — balance", group: "income" },
  rounding_income:      { label: "Plan rounding (kept)", group: "income" },
  legacy_adjustment:    { label: "Old manual adjustment / added meals", group: "legacy" },
}

export const categoryLabel = (c: string | null | undefined) => (c ? CATEGORY[c]?.label ?? c : "—")

export const METHOD: Record<string, string> = {
  cashfree: "Cashfree",
  cash: "Cash",
  upi: "UPI (our QR)",
  cash_upi: "Cash + UPI",
  bank_transfer: "Bank transfer",
  previous_records: "Earlier records",
  unrecorded: "No proof (before audit)",
}
export const methodLabel = (m: string | null | undefined) => (m ? METHOD[m] ?? m : "—")

export const SOURCE: Record<string, string> = {
  app_plan: "App — plan",
  app_topup: "App — top-up",
  admin_onboarding: "Onboarded by admin",
  admin_activation: "Activated by admin",
  cod_collection: "Cash on delivery",
  partner_cod: "Cash on delivery (partner)",
  admin_paid_meals: "Paid meals (admin)",
}
export const sourceLabel = (s: string | null | undefined) => (s ? SOURCE[s] ?? s : "—")

/** Ways an admin can say a payment was made. */
export const OFFLINE_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI (our QR)" },
  { value: "cash_upi", label: "Cash + UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "previous_records", label: "Earlier records (paid before the app)" },
] as const

/** "2026-11" → IST month bounds as dates, [from, to). */
export function monthRange(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  const y = m ? Number(m[1]) : 2026
  const mo = m ? Number(m[2]) : 1
  const from = `${y}-${String(mo).padStart(2, "0")}-01`
  const ny = mo === 12 ? y + 1 : y
  const nm = mo === 12 ? 1 : mo + 1
  const to = `${ny}-${String(nm).padStart(2, "0")}-01`
  return { from, to }
}

export const monthLabel = (month: string) => {
  const { from } = monthRange(month)
  return new Date(`${from}T00:00:00+05:30`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" })
}

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—"

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—"

/** CSV text; amounts should already be rupees. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n")
}

export const paiseToRupeesNumber = (p: number | null | undefined) => ((p ?? 0) / 100).toFixed(2)
