"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download, FileText, ChefHat, Truck, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { advanceBatchStatus, type DeliveryStatus } from "./actions";

/* ─── Types ──────────────────────────────────────────────────────────────────── */

export type OperationsSubscriber = {
  orderId: string;
  batchId: string | null;
  status: string;
  code: string;
  batch: string;
  rc: "C" | "R";
  name: string;
  phone: string;
  address: string;
  meal: string;
  constraints: string;
  addons: string;
  timing: string;
  note?: string;
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

function countMeals(subs: OperationsSubscriber[]) {
  const counts: Record<string, number> = {};
  subs.forEach((s) => {
    counts[s.meal] = (counts[s.meal] || 0) + 1;
  });
  return counts;
}

function mealCountsText(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([meal, count]) => `${meal}: ${count}`)
    .join(" | ");
}

/* ─── PDF Generators ────────────────────────────────────────────────────────── */

function generateMasterListPDF(subs: OperationsSubscriber[], date: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let pageNum = 1;

  function addHeader() {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("GreenFeast", 10, 8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("MASTER LIST", pageWidth / 2, 14, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Date: ${date}`, pageWidth - 20, 8, { align: "right" });
    doc.text(`Page ${pageNum} of ?`, pageWidth - 20, 14, { align: "right" });
  }

  function addFooter(allCounts: Record<string, number>) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Items to Prepare (Grand Total):", 10, pageHeight - 8);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(mealCountsText(allCounts), 10, pageHeight - 4);
  }

  // Group by batch and add table
  let currentY = 22;
  let allMealCounts: Record<string, number> = {};

  const batchNames = [...new Set(subs.map((s) => s.batch))].sort();
  batchNames.forEach((batch) => {
    const batchSubs = subs.filter((s) => s.batch === batch);
    if (batchSubs.length === 0) return;

    // Batch header row
    if (currentY > pageHeight - 40) {
      addFooter(allMealCounts);
      doc.addPage();
      pageNum++;
      currentY = 22;
      addHeader();
    }

    doc.setFillColor(...getBatchColors(batch).light);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.rect(10, currentY - 3, pageWidth - 20, 6, "F");
    doc.text(batch, 12, currentY + 0.5);
    currentY += 8;

    // Table data
    const tableData = batchSubs.map((s) => [
      s.code,
      s.rc,
      s.name,
      s.phone,
      s.address.substring(0, 30),
      s.meal,
      s.constraints.substring(0, 25),
      s.addons,
      s.timing,
      s.note || "",
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["Code", "R/C", "Name", "Phone", "Address", "Meal", "Constraints", "Add-ons", "Timing", "Note"]],
      body: tableData,
      columnStyles: {
        0: { cellWidth: 12 },
        1: { cellWidth: 8 },
        2: { cellWidth: 20 },
        3: { cellWidth: 16 },
        4: { cellWidth: 32 },
        5: { cellWidth: 18 },
        6: { cellWidth: 25 },
        7: { cellWidth: 12 },
        8: { cellWidth: 14 },
        9: { cellWidth: 15 },
      },
      headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [249, 251, 247] },
      margin: { top: currentY, bottom: 15 },
      didDrawPage: () => {},
    });

    currentY = (doc as any).lastAutoTable.finalY + 4;

    // Count meals
    const batchCounts = countMeals(batchSubs);
    Object.entries(batchCounts).forEach(([meal, count]) => {
      allMealCounts[meal] = (allMealCounts[meal] || 0) + count;
    });
  });

  addFooter(allMealCounts);
  doc.save(`GreenFeast-Master-List-${date.replace(/\//g, "-")}.pdf`);
}

function generateKitchenSheetPDF(subs: OperationsSubscriber[], date: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Header
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("GreenFeast", 10, 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Kitchen Sheet", pageWidth / 2, 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Date: ${date}`, pageWidth - 15, 8, { align: "right" });

  let currentY = 22;
  let allMealCounts: Record<string, number> = {};

  const batchNames = [...new Set(subs.map((s) => s.batch))].sort();
  batchNames.forEach((batch) => {
    const batchSubs = subs.filter((s) => s.batch === batch);
    if (batchSubs.length === 0) return;

    // Batch section header
    if (currentY > pageHeight - 50) {
      doc.addPage();
      currentY = 15;
    }

    doc.setFillColor(...getBatchColors(batch).light);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.rect(10, currentY - 3, pageWidth - 20, 6, "F");
    doc.text(batch, 12, currentY + 0.5);
    currentY += 8;

    // Table for this batch
    const tableData = batchSubs.map((s) => [
      s.code,
      s.rc,
      s.name,
      s.meal,
      s.constraints,
      s.addons,
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["Code", "R/C", "Name", "Meal", "Constraints", "Add-ons"]],
      body: tableData,
      columnStyles: {
        0: { cellWidth: 15 },
        1: { cellWidth: 10 },
        2: { cellWidth: 40 },
        3: { cellWidth: 30 },
        4: { cellWidth: 50 },
        5: { cellWidth: 20 },
      },
      headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [249, 251, 247] },
      margin: { bottom: 4 },
      didDrawPage: () => {},
    });

    currentY = (doc as any).lastAutoTable.finalY + 2;

    // Batch subtotal footer
    const batchCounts = countMeals(batchSubs);
    const batchSubtotal = mealCountsText(batchCounts);

    if (currentY > pageHeight - 15) {
      doc.addPage();
      currentY = 15;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`${batch} — Items to Prepare:`, 12, currentY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(batchSubtotal, 12, currentY + 4);

    currentY += 8;

    // Accumulate totals
    Object.entries(batchCounts).forEach(([meal, count]) => {
      allMealCounts[meal] = (allMealCounts[meal] || 0) + count;
    });
  });

  // Grand total footer at the end
  if (currentY > pageHeight - 15) {
    doc.addPage();
    currentY = 15;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Items to Prepare (Grand Total):", 10, currentY + 3);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(mealCountsText(allMealCounts), 10, currentY + 8);

  doc.save(`GreenFeast-Kitchen-${date.replace(/\//g, "-")}.pdf`);
}

function generateDeliverySheetPDF(batch: string, subs: OperationsSubscriber[], date: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("GreenFeast", 10, 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`${batch} — Delivery`, pageWidth / 2, 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Date: ${date}`, pageWidth - 15, 8, { align: "right" });

  // Table
  const tableData = subs.map((s) => [
    s.code,
    s.name,
    s.phone,
    s.address,
    s.timing,
  ]);

  autoTable(doc, {
    startY: 22,
    head: [["Code", "Name", "Phone", "Address", "Timing"]],
    body: tableData,
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 35 },
      2: { cellWidth: 25 },
      3: { cellWidth: 60 },
      4: { cellWidth: 20 },
    },
    headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontSize: 9, fontStyle: "bold" },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [249, 251, 247] },
    margin: { bottom: 15 },
  });

  doc.save(`GreenFeast-${batch}-Delivery-${date.replace(/\//g, "-")}.pdf`);
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
}: {
  initialSubscribers: OperationsSubscriber[];
  serverDate: string; // YYYY-MM-DD from URL/server
}) {
  const router = useRouter();
  // Display format for PDFs: DD/MM/YYYY
  const [y, m, d] = serverDate.split("-");
  const displayDate = `${d}/${m}/${y}`;

  const [loading, setLoading] = useState<LoadingState>({
    all: false,
    kitchen: {},
    delivery: {},
  });
  const [toast, setToast] = useState("");
  const [, startTransition] = useTransition();
  const [advancing, setAdvancing] = useState<string | null>(null);

  const batchNames = [...new Set(initialSubscribers.map((s) => s.batch))].sort();
  const totalDeliveries = initialSubscribers.length;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleGenerateAll() {
    setLoading((l) => ({ ...l, all: true }));
    try {
      generateMasterListPDF(initialSubscribers, displayDate);
      await new Promise((r) => setTimeout(r, 300));

      generateKitchenSheetPDF(initialSubscribers, displayDate);
      await new Promise((r) => setTimeout(r, 300));

      for (const batch of batchNames) {
        const batchSubs = initialSubscribers.filter((s) => s.batch === batch);
        generateDeliverySheetPDF(batch, batchSubs, displayDate);
        await new Promise((r) => setTimeout(r, 300));
      }

      showToast("Sheets generated successfully");
    } finally {
      setLoading((l) => ({ ...l, all: false }));
    }
  }

  async function handleGenerateKitchen() {
    setLoading((l) => ({ ...l, kitchen: { ...l.kitchen, standalone: true } }));
    try {
      generateKitchenSheetPDF(initialSubscribers, displayDate);
      showToast("Kitchen sheet generated");
    } finally {
      setLoading((l) => ({ ...l, kitchen: { ...l.kitchen, standalone: false } }));
    }
  }

  async function handleGenerateDelivery(batch: string) {
    setLoading((l) => ({ ...l, delivery: { ...l.delivery, [batch]: true } }));
    try {
      const batchSubs = initialSubscribers.filter((s) => s.batch === batch);
      generateDeliverySheetPDF(batch, batchSubs, displayDate);
      showToast(`${batch} delivery sheet generated`);
    } finally {
      setLoading((l) => ({ ...l, delivery: { ...l.delivery, [batch]: false } }));
    }
  }

  function handleAdvance(batch: string, batchId: string, status: DeliveryStatus) {
    setAdvancing(`${batch}:${status}`);
    startTransition(async () => {
      try {
        await advanceBatchStatus(batchId, serverDate, status);
        router.refresh();
        showToast(`${batch} → ${STATUS_LABEL[status]}`);
      } catch {
        showToast("Could not update status. Try again.");
      } finally {
        setAdvancing(null);
      }
    });
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">Operations</h1>
          <p className="text-sm text-gray-500 mt-0.5">Daily sheet generation — {displayDate}</p>
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

      {/* Generate All card */}
      <div className="bg-gradient-to-r from-[#1B5E20] to-[#2E7D32] text-white rounded-2xl p-8 mb-8 shadow-lg">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold mb-2">Generate All Sheets</h2>
            <p className="text-white/80 text-sm mb-4">{batchNames.length} batches · {totalDeliveries} deliveries · 3 sheet types</p>
            <p className="text-xs text-white/60">1 Master List · 1 Kitchen Sheet · {batchNames.length} Delivery Sheets</p>
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
                <><Download className="w-4 h-4" />Generate All</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Batch cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {batchNames.map((batch) => {
          const batchSubs = initialSubscribers.filter((s) => s.batch === batch);
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
                <p className="text-sm font-semibold text-[#1B5E20] mt-1">{batchSubs.length} deliveries</p>
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
                  Master List & Kitchen Sheet via "Generate All"
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
