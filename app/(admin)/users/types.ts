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
  deliveryMode: "opt-in" | "opt-out"
  activation: "active" | "cod"
  // "active" = already paid outside the app (e.g. an existing customer moving
  // over from the spreadsheet): how many meals they still have and how much
  // to put in their wallet to pay for them.
  startDate?: string // YYYY-MM-DD, first delivery; default tomorrow
  mealsLeft?: number
  walletCredit?: number // paise
  addonIds?: string[]
  address?: {
    label: string
    type: string
    line1: string
    pincode: string
    landmark?: string
  }
}
