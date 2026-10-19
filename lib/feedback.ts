// Meal ratings and app feedback (migration 064) — labels shared by the
// Feedback page and its actions. The chip keys are fixed in the database
// (rating_tag_keys()); the customer app shows the same words.

// 1–3★ "What went wrong?" / 4–5★ "What did you like?" — taste, portion and
// packaging appear in both, so their meaning depends on the stars.
const BAD_TAG: Record<string, string> = {
  taste: "Taste",
  portion: "Portion size",
  cold: "Cold",
  late: "Late",
  packaging: "Spilled / packaging",
  wrong_item: "Wrong or missing item",
  oily_spicy: "Too oily / spicy",
  not_fresh: "Not fresh",
};
const GOOD_TAG: Record<string, string> = {
  taste: "Taste",
  portion: "Portion size",
  fresh: "Fresh",
  on_time: "On time",
  packaging: "Packaging",
  healthy: "Healthy",
  value: "Value for money",
};

export function tagLabel(tag: string, stars: number | null): string {
  const first = (stars ?? 0) >= 4 ? GOOD_TAG : BAD_TAG;
  return first[tag] ?? GOOD_TAG[tag] ?? BAD_TAG[tag] ?? tag;
}

export const STAR_WORD: Record<number, string> = {
  1: "Terrible",
  2: "Bad",
  3: "Okay",
  4: "Good",
  5: "Loved it",
};

export const FEEDBACK_KIND: Record<string, string> = {
  idea: "Idea",
  problem: "Problem",
  praise: "Compliment",
  other: "Other",
};

export type RatingFrequency = "every_meal" | "daily" | "weekly" | "auto";

export const FREQUENCY_OPTIONS: { value: RatingFrequency; label: string; hint: string }[] = [
  { value: "every_meal", label: "Every meal", hint: "Every delivered lunch and dinner." },
  { value: "daily", label: "Once a day", hint: "At most one meal per delivery day." },
  { value: "weekly", label: "Once a week", hint: "At most one meal in any 7 days." },
  { value: "auto", label: "Automatic", hint: "Every meal for a new customer, then once a day, then once a week." },
];

export type RatingRow = {
  id: string;
  userId: string;
  name: string;
  code: string;
  phone: string | null;
  subscriptionId: string | null;
  date: string;
  slot: "lunch" | "dinner";
  stars: number | null;
  tags: string[];
  comment: string | null;
  dishes: string;
  dishIds: string[];
  batch: string | null;
  partner: string | null;
  source: string;
  askedAt: string | null;
  ratedAt: string | null;
  dismissedAt: string | null;
  handledAt: string | null;
  handledBy: string | null;
  adminNote: string | null;
};

export type FeedbackRow = {
  id: string;
  userId: string;
  name: string;
  code: string;
  phone: string | null;
  kind: string;
  message: string;
  appVersion: string | null;
  platform: string | null;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
  adminNote: string | null;
};

export type RatingSettings = {
  frequency: RatingFrequency;
  autoDailyAfter: number;
  autoWeeklyAfter: number;
  updatedAt: string | null;
  updatedBy: string | null;
};
