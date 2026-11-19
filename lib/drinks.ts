// Drinks (migration 088). A drink is a meal_templates row whose category is
// 'smoothie' or 'coffee'; it comes with the meal (the plan's drink add-on) and
// is never the meal itself, so every place that picks THE MEAL leaves them out.
// Plain constants only: client components import this too.
export const DRINK_CATEGORIES: string[] = ["smoothie", "coffee"]

export function isDrinkCategory(category: string | null | undefined): boolean {
  return !!category && DRINK_CATEGORIES.includes(category)
}

// PostgREST list for `.not("category", "in", DRINK_CATEGORY_LIST)`.
export const DRINK_CATEGORY_LIST = `(${DRINK_CATEGORIES.join(",")})`

export const DRINK_AS_MEAL_ERROR = "A drink can't be the meal. Pick a dish; the drink comes with it."

// A drink line with no drink dish on it (orders.drink_template_id null and no
// name on the line): nobody has picked one yet. There is no "chef's choice";
// this shows up so the office picks one.
// It must still read as a drink that is owed — "Drink not picked" was read as
// "no drink" on the sheets and a paid smoothie wasn't made (Ashok Jagwani, 19 Nov).
export const DRINK_NOT_PICKED = "Drink due — flavour not picked"
// With the add-on's own name: "Smoothie — flavour not picked".
export const drinkNotPicked = (addonName?: string | null) =>
  addonName ? `${addonName} — flavour not picked` : DRINK_NOT_PICKED
