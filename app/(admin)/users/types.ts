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
  address?: {
    label: string
    type: string
    line1: string
    pincode: string
    landmark?: string
  }
}
