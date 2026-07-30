// The admin app runs on Vercel (UTC) but every delivery-date concept in this
// product is IST. `new Date().toISOString().split('T')[0]` — used all over
// this codebase before this file existed — silently rolls over to
// "tomorrow" between 18:30 and 23:59 IST. Mirrors src/lib/ist.ts's istToday()
// in the mobile app repo (kept separate on purpose — this is a small,
// single-function need on this side, not worth a cross-repo package).
const IST_MS = 5.5 * 60 * 60 * 1000;

export function istToday(): string {
  return new Date(Date.now() + IST_MS).toISOString().split("T")[0];
}

export function istHour(): number {
  return new Date(Date.now() + IST_MS).getUTCHours();
}

// Pure calendar-date arithmetic — safe regardless of timezone, since it
// never touches "now", only a given YYYY-MM-DD string.
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

// Mirrors src/lib/ist.ts's isSlotLocked() in the mobile app repo exactly —
// same cutoffs (lunch 8 AM, dinner 1 PM IST, same day). Used here to gate
// the kitchen/delivery/CRM list downloads and to stamp a PDF
// provisional/final, matching what the mobile app and is_slot_locked()
// (migration 031) already enforce for subscriber-facing edits.
export const SLOT_CUTOFF_HOUR: Record<"lunch" | "dinner", number> = {
  lunch: 8,
  dinner: 13,
};

export function isSlotLocked(dateStr: string, slot: "lunch" | "dinner"): boolean {
  const today = istToday();
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  return istHour() >= SLOT_CUTOFF_HOUR[slot];
}
