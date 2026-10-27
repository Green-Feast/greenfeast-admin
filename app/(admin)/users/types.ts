// Shared types for the Users tab. Kept in a directive-free module so the
// "use server" actions file only exports async functions (an RSC requirement).

export type CreateSubInput = {
  userId: string
  // For auth-only "ghost" users with no public.users row yet:
  name?: string
  phone?: string
  hasPublicRow: boolean
  planId: string
  days: string[] // ['Mon','Wed','Fri']
  mealsLunch: number
  mealsDinner: number
  activation: "active" | "cod"
  // "active" = already paid outside the app (e.g. an existing customer moving
  // over from the spreadsheet): how many meals they still have and how much
  // to put in their wallet to pay for them.
  // "cod" = cash on delivery: walletCredit is what they paid upfront (can be
  // 0) and cashDue what's still to collect; meals run on credit until then.
  startDate?: string // YYYY-MM-DD, first delivery; default tomorrow
  mealsLeft?: number
  walletCredit?: number // paise
  cashDue?: number // paise, cash on delivery only
  addonIds?: string[]
  // A coupon (migration 066): sets the plan's meal price; recorded as used.
  couponId?: string
  address?: {
    label: string
    type: string
    line1: string
    pincode: string
    landmark?: string
  }
}

export type NewCustomer = { id: string; name: string; email: string; phone: string; customerCode: string | null }
