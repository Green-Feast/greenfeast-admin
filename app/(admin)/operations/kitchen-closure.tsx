"use client";

import { useEffect, useState, useTransition } from "react";
import { X, Loader2, DoorClosed, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { closeKitchen, reopenKitchen, previewKitchenClosure, type MealSlot } from "./actions";

export type KitchenClosure = { closed_on: string; meal_slot: MealSlot; reason: string | null };

function fmtDay(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

// Banner on the Operations page when the selected date/slot is closed.
export function ClosedBanner({
  closure,
  onReopened,
}: {
  closure: KitchenClosure;
  onReopened: (msg: string) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
      <DoorClosed className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        <span className="font-semibold">Kitchen closed</span> for {closure.meal_slot} on {fmtDay(closure.closed_on)}
        {closure.reason ? ` — ${closure.reason}` : ""}. Those orders were cancelled without charge and stay on each plan.
      </span>
      <button
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Reopen the kitchen for ${closure.meal_slot} on ${fmtDay(closure.closed_on)}? Customers' meals come back and they're told.`)) return;
          start(async () => {
            const r = await reopenKitchen(closure.closed_on, closure.meal_slot, true);
            onReopened(r.note ? "Reopened — the slot is past its cutoff, so meals weren't restored." : `Reopened — ${r.revived} meals restored.`);
          });
        }}
        className="px-3 py-1.5 rounded-lg bg-white border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-100 disabled:opacity-50"
      >
        {pending ? "Reopening…" : "Reopen"}
      </button>
    </div>
  );
}

export function KitchenClosureDialog({
  defaultDate,
  defaultSlot,
  closures,
  onClose,
  onDone,
}: {
  defaultDate: string;
  defaultSlot: MealSlot;
  closures: KitchenClosure[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [slots, setSlots] = useState<MealSlot[]>([defaultSlot]);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [preview, setPreview] = useState<{ orders: number; customers: number } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    setPreview(null);
    if (!date || slots.length === 0) return;
    let live = true;
    previewKitchenClosure(date, slots).then((p) => { if (live) setPreview(p); }).catch(() => {});
    return () => { live = false; };
  }, [date, slots]);

  function toggle(s: MealSlot) {
    setSlots((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function submit() {
    setError("");
    start(async () => {
      try {
        const r = await closeKitchen(date, slots, reason, notify);
        onDone(`Kitchen closed — ${r.cancelled} meals cancelled${notify ? `, ${r.customers} customers notified` : ""}.`);
      } catch (e: any) {
        setError(e?.message ?? "Could not close the kitchen.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e2e8d5] px-5 py-4">
          <h2 className="text-lg font-bold text-[#1A1A1A]">Close the kitchen</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="text-sm text-gray-500">
            Cancels every meal for that slot — Live and Test — without charging anyone. The meals stay on each plan and get
            scheduled on later days.
          </p>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Date</p>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 w-full rounded-lg border border-[#e2e8d5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Closed for</p>
            <div className="flex gap-2">
              {(["lunch", "dinner"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => toggle(s)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-sm font-medium",
                    slots.includes(s) ? "border-[#1B5E20] bg-green-50 text-[#1B5E20]" : "border-[#e2e8d5] text-gray-600 hover:bg-gray-50"
                  )}
                >
                  {s === "lunch" ? "Lunch" : "Dinner"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Reason (customers see it)</p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={60}
              placeholder="e.g. Diwali"
              className="h-10 w-full rounded-lg border border-[#e2e8d5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-[#1B5E20]" />
            Notify affected customers (push + in-app)
          </label>

          {preview && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {preview.orders === 0
                ? "No meals scheduled for that slot yet — new orders just won't be created."
                : `${preview.orders} meals for ${preview.customers} customers will be cancelled.`}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {closures.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Already closed</p>
              <ul className="space-y-1 text-sm text-gray-600">
                {closures.map((c) => (
                  <li key={c.closed_on + c.meal_slot}>
                    {fmtDay(c.closed_on)} · {c.meal_slot}
                    {c.reason ? ` — ${c.reason}` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-gray-400">Pick that date on the Operations page to reopen it.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#e2e8d5] px-5 py-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={pending || slots.length === 0 || !date}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Close kitchen
          </button>
        </div>
      </div>
    </div>
  );
}
