// A plan whose meals are used up stays 'active' (or 'paused') until it's
// renewed — the app only loads live plans, and needs this one to offer Renew.
// The admin shows it as Finished.
export function isPlanFinished(status: string | null | undefined, mealsLeft: number | null | undefined) {
  return (status === "active" || status === "paused") && (mealsLeft ?? 0) <= 0
}
