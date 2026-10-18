"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download, FileText, ChefHat, Truck, CheckCircle2, DoorClosed, AlertTriangle, Banknote, Camera } from "lucide-react";
import { KitchenClosureDialog, ClosedBanner, type KitchenClosure } from "./kitchen-closure";
import { cn } from "@/lib/utils";
import { generateDailyLists, generateKitchenSheets, generateDeliverySheet } from "./daily-lists";
import {
  advanceBatchStatus,
  advanceOrderStatus,
  resolveFailedDrop,
  recordCashReport,
  dismissCashReport,
  deliveryPhotoUrl,
} from "./actions";
import type { DeliveryStatus, MealSlot } from "@/lib/delivery";
import { setAddressBatch } from "@/app/(admin)/batches/actions";
import { recordCashPayment } from "@/app/(admin)/subscribers/[id]/actions";
import { istHour, isSlotLocked, SLOT_CUTOFF_HOUR } from "@/lib/ist";

/* ─── Types ──────────────────────────────────────────────────────────────────── */

export type OperationsSubscriber = {
  orderId: string;
  subscriptionId: string;
  addressId: string | null;
  addressLabel: string;
  quantity: number;
  codDue: number;
  batchId: string | null;
  status: string;
  mealSlot: MealSlot;
  batch: string;
  // C = has constraints, R = regular — the sheets' N/C/01-style codes.
  rc: "C" | "R";
  name: string;
  phone: string;
  address: string;
  meal: string;
  constraints: string;
  addons: string;
  addonList: { name: string; qty: number }[];
  timing: string;
  note?: string;
  // Delivery partner app (057)
  outAt: string | null;
  deliveredAt: string | null;
  issue: string | null;
  hasPhoto: boolean;
  partnerName: string | null;
  cashReport: CashReportRow | null;
};

// Cash a delivery partner says they collected — recorded by the office.
export type CashReportRow = {
  id: string;
  subscriptionId: string;
  amount: number;
  note: string | null;
  reportedAt: string;
  partner: string;
  customer: string;
};

const BATCH_COLORS: Record<string, { light: [number, number, number]; dark: [number, number, number] }> = {
  Nami:    { light: [200, 220, 245], dark: [30, 144, 255] },
  Rahul:   { light: [220, 195, 245], dark: [100, 50, 200] },
  Yashpal: { light: [255, 220, 180], dark: [255, 140, 0] },
  Santu:   { light: [255, 200, 220], dark: [220, 20, 60] },
  Evening: { light: [255, 235, 180], dark: [255, 165, 0] },
};

function getBatchColors(batch: string) {
  return BATCH_COLORS[batch] ?? { light: [230, 230, 230] as [number,number,number], dark: [100, 100, 100] as [number,number,number] };
}

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  preparing: "In Kitchen",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
};

// Collapse raw order statuses into the 4 display buckets, in delivery order.
function statusCounts(subs: OperationsSubscriber[]) {
  const c = { scheduled: 0, preparing: 0, out_for_delivery: 0, delivered: 0 };
  for (const s of subs) {
    if (s.status === "preparing") c.preparing++;
    else if (s.status === "out_for_delivery") c.out_for_delivery++;
    else if (s.status === "delivered") c.delivered++;
    else c.scheduled++; // scheduled / confirmed
  }
  return c;
}

// Returns the most-advanced active status for a batch (for button highlight).
function batchCurrentStage(counts: ReturnType<typeof statusCounts>): DeliveryStatus | null {
  if (counts.out_for_delivery > 0) return "out_for_delivery";
  if (counts.preparing > 0) return "preparing";
  return null;
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function clock(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
}

/* ─── Components ────────────────────────────────────────────────────────────── */

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
      ✓ {message}
    </div>
  );
}

type LoadingState = {
  all: boolean;
  kitchen: Record<string, boolean> & { standalone?: boolean };
  delivery: Record<string, boolean>;
};

export function OperationsClient({
  initialSubscribers,
  serverDate,
  closures,
  batches,
  cashReports,
  isToday,
}: {
  initialSubscribers: OperationsSubscriber[];
  serverDate: string; // YYYY-MM-DD from URL/server
  closures: KitchenClosure[];
  batches: { id: string; name: string; meal_slot: MealSlot }[];
  cashReports: CashReportRow[];
  isToday: boolean;
}) {
  const [showClosure, setShowClosure] = useState(false);
  const router = useRouter();
  // Display format for PDFs: DD/MM/YYYY
  const [y, m, d] = serverDate.split("-");
  const displayDate = `${d}/${m}/${y}`;

  // Default to whichever slot is still "current" — before dinner's cutoff,
  // that's lunch; after, dinner. Matches the mobile app's own default.
  const [slot, setSlot] = useState<MealSlot>(istHour() < SLOT_CUTOFF_HOUR.dinner ? "lunch" : "dinner");
  const slotSubs = initialSubscribers.filter((s) => s.mealSlot === slot);
  // Provisional = before this slot's cutoff, so the menu/orders could still
  // change (see kitchen/actions.ts's propagateMenuChanges cutoff guard) —
  // any list generated now is a preview, not the frozen final version.
  const provisional = !isSlotLocked(serverDate, slot);

  const [loading, setLoading] = useState<LoadingState>({
    all: false,
    kitchen: {},
    delivery: {},
  });
  const [toast, setToast] = useState("");
  const [, startTransition] = useTransition();
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [advancingOrder, setAdvancingOrder] = useState<string | null>(null);

  const batchNames = [...new Set(slotSubs.map((s) => s.batch))].sort((a, b) =>
    a === "Unassigned" ? -1 : b === "Unassigned" ? 1 : a.localeCompare(b)
  );
  const totalDeliveries = slotSubs.length;
  const unassigned = slotSubs.filter((s) => !s.batchId && s.status !== "delivered").length;
  const slotBatches = batches.filter((b) => b.meal_slot === slot);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  // Partners mark deliveries from their app — keep today's view live.
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [isToday, router]);

  function handleResolve(s: OperationsSubscriber, outcome: "deliver" | "skip") {
    const ask = outcome === "deliver"
      ? `Mark ${s.name}'s meal delivered? It's billed like any delivery.`
      : `Skip ${s.name}'s meal? Not charged — the meal stays on their plan.`;
    if (!window.confirm(ask)) return;
    setBusyRow(s.orderId);
    startTransition(async () => {
      const res = await resolveFailedDrop(s.orderId, outcome);
      setBusyRow(null);
      showToast(res.ok ? res.message ?? "Done." : res.error);
      if (res.ok) router.refresh();
    });
  }

  function handleCashReport(r: CashReportRow, action: "record" | "dismiss") {
    if (action === "record") {
      const answer = window.prompt(`Cash received from ${r.partner} for ${r.customer} (₹):`, String(r.amount / 100));
      if (!answer) return;
      const paise = Math.round((parseFloat(answer) || 0) * 100);
      if (paise <= 0) return;
      setBusyRow(r.id);
      startTransition(async () => {
        const res = await recordCashReport(r.id, paise);
        setBusyRow(null);
        showToast(res.ok ? res.message ?? "Recorded." : res.error);
        if (res.ok) router.refresh();
      });
      return;
    }
    if (!window.confirm(`Dismiss ${r.partner}'s report of ${rupees(r.amount)} from ${r.customer}? Nothing is recorded.`)) return;
    setBusyRow(r.id);
    startTransition(async () => {
      const res = await dismissCashReport(r.id);
      setBusyRow(null);
      showToast(res.ok ? res.message ?? "Dismissed." : res.error);
      if (res.ok) router.refresh();
    });
  }

  async function handlePhoto(orderId: string) {
    const url = await deliveryPhotoUrl(orderId);
    if (url) window.open(url, "_blank");
    else showToast("Couldn't open the photo.");
  }

  // An address's batch, set from here: every upcoming meal going there
  // follows (migration 052), so this fixes today's sheet and future days.
  function handleAssign(s: OperationsSubscriber, batchId: string) {
    if (!s.addressId || !batchId) return;
    setBusyRow(s.orderId);
    startTransition(async () => {
      try {
        await setAddressBatch(s.addressId!, slot, batchId);
        router.refresh();
        showToast(`${s.name} (${s.addressLabel}) → ${batches.find((b) => b.id === batchId)?.name ?? "batch"}`);
      } catch (e: any) {
        showToast(e?.message ?? "Could not assign the batch.");
      } finally {
        setBusyRow(null);
      }
    });
  }

  function handleCollect(s: OperationsSubscriber) {
    const answer = window.prompt(`Cash collected from ${s.name} (₹). Still due: ${rupees(s.codDue)}`, String(s.codDue / 100));
    if (!answer) return;
    const paise = Math.round((parseFloat(answer) || 0) * 100);
    if (paise <= 0) return;
    setBusyRow(s.orderId);
    startTransition(async () => {
      const res = await recordCashPayment(s.subscriptionId, paise);
      setBusyRow(null);
      showToast(res.ok ? res.message ?? "Cash recorded." : res.error);
      if (res.ok) router.refresh();
    });
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  // Before a cutoff the lists can still change — the PDF says so.
  function provisionalNote(slots: MealSlot[]) {
    const open = slots.filter((x) => !isSlotLocked(serverDate, x));
    if (open.length === 0) return null;
    return `PROVISIONAL — ${open.join(" & ")} can still change (cutoff ${open.map((x) => (x === "lunch" ? "8 AM" : "1 PM")).join(" / ")})`;
  }

  // The whole day in one PDF, in the kitchen's daily_lists format: master
  // list per batch, then kitchen sheets, then delivery sheets.
  async function handleGenerateAll() {
    setLoading((l) => ({ ...l, all: true }));
    try {
      generateDailyLists(initialSubscribers, serverDate, provisionalNote(["lunch", "dinner"]));
      showToast("Daily lists downloaded");
    } finally {
      setLoading((l) => ({ ...l, all: false }));
    }
  }

  async function handleGenerateKitchen() {
    setLoading((l) => ({ ...l, kitchen: { ...l.kitchen, standalone: true } }));
    try {
      generateKitchenSheets(initialSubscribers, serverDate, slot, provisionalNote([slot]));
      showToast("Kitchen sheets downloaded");
    } finally {
      setLoading((l) => ({ ...l, kitchen: { ...l.kitchen, standalone: false } }));
    }
  }

  async function handleGenerateDelivery(batch: string) {
    setLoading((l) => ({ ...l, delivery: { ...l.delivery, [batch]: true } }));
    try {
      generateDeliverySheet(initialSubscribers, serverDate, slot, batch, provisionalNote([slot]));
      showToast(`${batch} delivery sheet downloaded`);
    } finally {
      setLoading((l) => ({ ...l, delivery: { ...l.delivery, [batch]: false } }));
    }
  }

  function handleAdvance(batch: string, batchId: string, status: DeliveryStatus) {
    setAdvancing(`${batch}:${status}`);
    startTransition(async () => {
      try {
        const summary = await advanceBatchStatus(batchId, serverDate, status, slot);
        router.refresh();
        const suffix = summary && summary.skipped_insufficient > 0
          ? ` — ${summary.skipped_insufficient} skipped (low wallet balance)`
          : "";
        showToast(`${batch} (${slot}) → ${STATUS_LABEL[status]}${suffix}`);
      } catch {
        showToast("Could not update status. Try again.");
      } finally {
        setAdvancing(null);
      }
    });
  }

  // Per-subscriber status advance — the delivered path is the one that
  // actually matters end-to-end: it runs advance_order_delivered (mirrors
  // advance_batch_delivered's billing/counter logic) so marking one person
  // delivered debits their wallet and burns exactly one delivery, the same
  // as the batch-level bulk button does.
  function handleAdvanceOrder(orderId: string, name: string, status: DeliveryStatus) {
    setAdvancingOrder(`${orderId}:${status}`);
    startTransition(async () => {
      try {
        const result = await advanceOrderStatus(orderId, status, slot);
        router.refresh();
        const suffix =
          result === "skipped_insufficient" ? " — skipped (low wallet balance)" :
          result === "already_settled" ? " — already settled" : "";
        showToast(`${name} → ${STATUS_LABEL[status]}${suffix}`);
      } catch {
        showToast("Could not update status. Try again.");
      } finally {
        setAdvancingOrder(null);
      }
    });
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">Operations</h1>
          <p className="text-sm text-gray-500 mt-0.5">Daily sheet generation — {displayDate} · {slot === "lunch" ? "Lunch" : "Dinner"}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowClosure(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-700 hover:bg-red-50"
          >
            <DoorClosed className="w-4 h-4" /> Close kitchen
          </button>
          <div className="flex rounded-lg border border-[#e2e8d5] overflow-hidden">
            {(["lunch", "dinner"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSlot(s)}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-colors",
                  slot === s ? "bg-[#1B5E20] text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                )}
              >
                {s === "lunch" ? "Lunch" : "Dinner"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-600">Date:</label>
            <input
              type="date"
              value={serverDate}
              onChange={(e) => router.push(`?date=${e.target.value}`)}
              className="text-sm border border-[#e2e8d5] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
          </div>
        </div>
      </div>

      {closures
        .filter((c) => c.closed_on === serverDate && c.meal_slot === slot)
        .map((c) => (
          <ClosedBanner
            key={c.closed_on + c.meal_slot}
            closure={c}
            onReopened={(msg) => { showToast(msg); router.refresh(); }}
          />
        ))}

      {showClosure && (
        <KitchenClosureDialog
          defaultDate={serverDate}
          defaultSlot={slot}
          closures={closures}
          onClose={() => setShowClosure(false)}
          onDone={(msg) => { setShowClosure(false); showToast(msg); router.refresh(); }}
        />
      )}

      {unassigned > 0 && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <span className="font-semibold">{unassigned} {slot} meal{unassigned === 1 ? "" : "s"} with no batch</span>
            {" "}— a new or changed address. Pick a batch on the Unassigned card below; it applies to every meal going to that address.
          </span>
        </div>
      )}

      {cashReports.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <Banknote className="w-4 h-4" /> Cash collected by partners — record it when they hand it over
          </p>
          <p className="text-xs text-amber-800/80 mt-0.5">Until it&apos;s recorded the customer&apos;s wallet doesn&apos;t have it, so their next meal can skip at cutoff.</p>
          <div className="mt-3 space-y-2">
            {cashReports.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-white border border-amber-200 px-3 py-2">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-[#1A1A1A] truncate">{rupees(r.amount)} · {r.customer}</p>
                  <p className="text-xs text-gray-500 truncate">
                    by {r.partner} · {new Date(r.reportedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => handleCashReport(r, "record")}
                    disabled={busyRow === r.id}
                    className="px-3 py-1.5 rounded-md bg-[#1B5E20] text-white text-xs font-semibold hover:bg-[#155116] disabled:opacity-40"
                  >
                    Record
                  </button>
                  <button
                    onClick={() => handleCashReport(r, "dismiss")}
                    disabled={busyRow === r.id}
                    className="px-2.5 py-1.5 rounded-md border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {provisional && (
        <div className="mb-6 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <span className="font-semibold">Provisional</span>
          <span>
            — {slot} for {displayDate} locks at {slot === "lunch" ? "8:00 AM" : "1:00 PM"}. Menu/order changes are
            still possible until then; sheets generated now may not match what's finally cooked.
          </span>
        </div>
      )}

      {/* Generate All card */}
      <div className="bg-gradient-to-r from-[#1B5E20] to-[#2E7D32] text-white rounded-2xl p-8 mb-8 shadow-lg">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold mb-2">Daily Lists</h2>
            <p className="text-white/80 text-sm mb-4">
              Lunch and dinner for {displayDate} · {initialSubscribers.length} deliveries · {new Set(initialSubscribers.map((x) => `${x.mealSlot}|${x.batch}`)).size} batches
            </p>
            <p className="text-xs text-white/60">One PDF: master list per batch with tallies · kitchen sheets · delivery sheets with cash to collect</p>
          </div>
          <div className="flex gap-3 flex-wrap flex-shrink-0">
            <button
              onClick={handleGenerateKitchen}
              disabled={loading.kitchen.standalone}
              className="flex items-center gap-2 px-5 py-3 rounded-lg bg-white/20 text-white font-semibold hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-white/30"
            >
              {loading.kitchen.standalone ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Kitchen...</>
              ) : (
                <><FileText className="w-4 h-4" />Kitchen Sheet</>
              )}
            </button>
            <button
              onClick={handleGenerateAll}
              disabled={loading.all}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-[#FDD835] text-[#1A1A1A] font-semibold hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading.all ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Generating...</>
              ) : (
                <><Download className="w-4 h-4" />Download daily lists</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Batch cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {batchNames.map((batch) => {
          const batchSubs = slotSubs.filter((s) => s.batch === batch);
          const colors = getBatchColors(batch);
          const batchId = batchSubs.find((s) => s.batchId)?.batchId ?? null;
          const counts = statusCounts(batchSubs);
          const allDelivered = batchSubs.length > 0 && counts.delivered === batchSubs.length;
          const stage = batchCurrentStage(counts);
          return (
            <div key={batch} className="bg-white rounded-xl border border-[#e2e8d5] shadow-sm overflow-hidden hover:shadow-md transition-shadow">
              {/* Batch header */}
              <div
                className="px-5 py-4 border-b border-[#e2e8d5]"
                style={{ backgroundColor: `rgb(${colors.light.join(",")})` }}
              >
                <h3 className="text-lg font-bold text-[#1A1A1A]">{batch}</h3>
                <p className="text-sm font-semibold text-[#1B5E20] mt-1">
                  {batchSubs.length} deliveries · {batchSubs.reduce((n, s) => n + (s.quantity || 1), 0)} meals
                </p>
              </div>

              {/* Status pipeline */}
              <div className="px-4 pt-4">
                <div className="flex items-center gap-1.5 flex-wrap text-xs mb-3">
                  {counts.scheduled > 0 && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{counts.scheduled} scheduled</span>}
                  {counts.preparing > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{counts.preparing} in kitchen</span>}
                  {counts.out_for_delivery > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{counts.out_for_delivery} out</span>}
                  {counts.delivered > 0 && <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700">{counts.delivered} delivered</span>}
                </div>

                {batchId ? (
                  allDelivered ? (
                    <div className="flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-[#1B5E20] bg-green-50 rounded-lg">
                      <CheckCircle2 className="w-4 h-4" /> All delivered
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        { status: "preparing" as const, label: "In Kitchen", Icon: ChefHat },
                        { status: "out_for_delivery" as const, label: "Out", Icon: Truck },
                        { status: "delivered" as const, label: "Delivered", Icon: CheckCircle2 },
                      ]).map(({ status, label, Icon }) => {
                        const busy = advancing === `${batch}:${status}`;
                        const isActive = stage === status;
                        return (
                          <button
                            key={status}
                            onClick={() => handleAdvance(batch, batchId, status)}
                            disabled={!!advancing}
                            className={cn(
                              "flex flex-col items-center justify-center gap-1 px-1 py-2 rounded-lg border text-[11px] font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                              isActive
                                ? "border-[#1B5E20] bg-[#E8F5E9] text-[#1B5E20] font-semibold"
                                : "border-[#e2e8d5] text-gray-600 hover:border-[#1B5E20] hover:text-[#1B5E20] hover:bg-green-50"
                            )}
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <p className="text-xs text-gray-400 text-center py-1.5">Assign this batch a route to manage status.</p>
                )}
              </div>

              {/* Individual subscribers — status can be advanced one person
                  at a time as well as in bulk above; this is what actually
                  needs to work reliably, since "delivered" is what drives
                  deliveries_remaining and wallet billing per subscriber. */}
              <div className="px-4 pt-3 space-y-0.5">
                {batchSubs.map((s) => {
                  const terminal = s.status === "cancelled" || s.status === "skipped";
                  return (
                    <div key={s.orderId} className="flex items-center justify-between gap-2 py-2 border-b border-[#e2e8d5] last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#1A1A1A] truncate">
                          {s.name}
                          {s.quantity > 1 && <span className="ml-1 text-xs font-semibold text-[#1B5E20]">×{s.quantity}</span>}
                        </p>
                        <p className="text-xs text-gray-400 truncate"><span className="font-medium text-gray-500">{s.addressLabel}</span> · {s.address}</p>
                        {!s.batchId && s.addressId && (
                          <select
                            defaultValue=""
                            disabled={busyRow === s.orderId}
                            onChange={(e) => handleAssign(s, e.target.value)}
                            className="mt-1 h-7 w-full rounded-md border border-red-300 bg-white px-1.5 text-xs text-red-700"
                          >
                            <option value="">Assign a {slot} batch…</option>
                            {slotBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        )}
                        {(s.status === "out_for_delivery" || s.status === "delivered") && (s.outAt || s.deliveredAt) && (
                          <p className="mt-0.5 text-[11px] text-gray-500 flex items-center gap-1 flex-wrap">
                            {s.status === "delivered" ? `Delivered ${clock(s.deliveredAt)}` : `On the way ${clock(s.outAt)}`}
                            {s.partnerName && <span>· {s.partnerName}</span>}
                            {s.hasPhoto && (
                              <button onClick={() => handlePhoto(s.orderId)} className="inline-flex items-center gap-0.5 text-[#1B5E20] font-medium hover:underline">
                                · <Camera className="w-3 h-3" /> photo
                              </button>
                            )}
                          </p>
                        )}
                        {s.issue && s.status !== "delivered" && (
                          <div className="mt-1 rounded-md bg-red-50 border border-red-200 px-2 py-1.5">
                            <p className="text-[11px] font-medium text-red-800 flex items-start gap-1">
                              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                              Couldn&apos;t deliver — {s.issue}{s.partnerName ? ` (${s.partnerName})` : ""}
                            </p>
                            <div className="mt-1 flex gap-1.5">
                              <button
                                onClick={() => handleResolve(s, "deliver")}
                                disabled={busyRow === s.orderId}
                                className="px-2 py-0.5 rounded bg-white border border-red-200 text-[11px] font-medium text-[#1B5E20] hover:bg-green-50 disabled:opacity-40"
                              >
                                Mark delivered
                              </button>
                              <button
                                onClick={() => handleResolve(s, "skip")}
                                disabled={busyRow === s.orderId}
                                className="px-2 py-0.5 rounded bg-white border border-red-200 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
                              >
                                Skip, no charge
                              </button>
                            </div>
                          </div>
                        )}
                        {s.cashReport && (
                          <p className="mt-1 text-[11px] font-medium text-amber-800">
                            {rupees(s.cashReport.amount)} cash reported by {s.cashReport.partner} — record it above
                          </p>
                        )}
                        {s.codDue > 0 && (
                          <button
                            onClick={() => handleCollect(s)}
                            disabled={busyRow === s.orderId}
                            className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                          >
                            <Banknote className="w-3 h-3" /> Collect {rupees(s.codDue)}
                          </button>
                        )}
                      </div>
                      {s.status === "delivered" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#1B5E20] bg-green-50 px-2 py-1 rounded-md shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />Delivered
                        </span>
                      ) : terminal ? (
                        <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded-md shrink-0 capitalize">
                          {s.status}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          {([
                            { status: "preparing" as const, Icon: ChefHat, title: "In Kitchen" },
                            { status: "out_for_delivery" as const, Icon: Truck, title: "Out for Delivery" },
                            { status: "delivered" as const, Icon: CheckCircle2, title: "Delivered" },
                          ]).map(({ status, Icon, title }) => {
                            const busy = advancingOrder === `${s.orderId}:${status}`;
                            const isActive = s.status === status;
                            return (
                              <button
                                key={status}
                                title={title}
                                onClick={() => handleAdvanceOrder(s.orderId, s.name, status)}
                                disabled={!!advancingOrder}
                                className={cn(
                                  "flex items-center justify-center w-7 h-7 rounded-md border transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                                  isActive
                                    ? "border-[#1B5E20] bg-[#E8F5E9] text-[#1B5E20]"
                                    : "border-[#e2e8d5] text-gray-400 hover:border-[#1B5E20] hover:text-[#1B5E20] hover:bg-green-50"
                                )}
                              >
                                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Buttons */}
              <div className="p-4 space-y-2.5">
                <button
                  onClick={() => handleGenerateDelivery(batch)}
                  disabled={loading.delivery[batch]}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#1B5E20] bg-white text-[#1B5E20] font-medium hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading.delivery[batch] ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" />Delivery...</>
                  ) : (
                    <><FileText className="w-3.5 h-3.5" />Delivery Sheet</>
                  )}
                </button>
                <p className="text-xs text-gray-400 text-center mt-2 py-2 border-t border-[#e2e8d5]">
                  Master list & kitchen sheets: "Download daily lists" above
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toast */}
      {toast && <Toast message={toast} />}
    </div>
  );
}
