"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { Search, X, Phone, Calendar, Utensils, StickyNote, ChevronLeft, ChevronRight, Plus, AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ─── Types ─────────────────────────────────────────────────────────────────── */

export type Subscriber = {
  id: string;
  userId?: string;
  code: string;
  name: string;
  phone: string;
  batch: string;
  plan: string;
  status: "Active" | "Paused" | "Expired" | "Pending";
  meal: string;
  constraints: string;
  addons: string;
  timing: string;
  notes: string;
  address: string;
  rc: "C" | "R";
  expiry: string;
  deliveriesRemaining: number | null;
  source: "legacy" | "app";
};

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function daysUntil(dateStr: string) {
  if (!dateStr) return 999;
  const d = new Date(dateStr);
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

const batchColor: Record<string, string> = {
  Nami:    "bg-sky-100 text-sky-700",
  Rahul:   "bg-violet-100 text-violet-700",
  Yashpal: "bg-orange-100 text-orange-700",
  Santu:   "bg-pink-100 text-pink-700",
  Evening: "bg-amber-100 text-amber-700",
};

/* ─── Sub-components ────────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: Subscriber["status"] }) {
  const map = {
    Active:  "bg-green-100 text-green-700 border-green-200",
    Paused:  "bg-yellow-100 text-yellow-700 border-yellow-200",
    Expired: "bg-red-100 text-red-600 border-red-200",
    Pending: "bg-gray-100 text-gray-600 border-gray-200",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", map[status])}>
      {status}
    </span>
  );
}

function FilterSelect({
  value, onChange, options, label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] transition-colors"
      aria-label={label}
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

/* ─── Detail Panel ──────────────────────────────────────────────────────────── */

function DetailPanel({
  subscriber,
  onClose,
  onAction,
}: {
  subscriber: Subscriber | null;
  onClose: () => void;
  onAction: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [visible, setVisible] = useState(false);
  const prevSub = useRef<Subscriber | null>(null);

  useEffect(() => {
    if (subscriber) {
      prevSub.current = subscriber;
      setNotes("");
      // slight delay lets transform start from off-screen
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [subscriber]);

  const displayed = subscriber ?? prevSub.current;
  if (!displayed) return null;

  const days = daysUntil(displayed.expiry);
  const remaining = displayed.deliveriesRemaining;
  const hasAddOn = displayed.addons.trim().length > 0;

  const constraintList = displayed.constraints
    ? displayed.constraints.split(/,\s*/).filter(Boolean)
    : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/30 z-40 transition-opacity duration-300",
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className={cn(
          "fixed right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out",
          visible ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-[#e2e8d5] bg-[#F9FBF7]">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-[#1A1A1A]">{displayed.name}</h2>
              <StatusBadge status={displayed.status} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{displayed.code}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-2 mt-0.5 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Contact */}
          <Section title="Contact">
            <Row icon={<Phone className="w-3.5 h-3.5" />} label="Phone">
              <a href={`tel:${displayed.phone}`} className="text-[#1B5E20] hover:underline font-medium">
                +91 {displayed.phone}
              </a>
            </Row>
          </Section>

          {/* Subscription */}
          <Section title="Subscription">
            <Row label="Plan">
              <span className="font-medium">{displayed.plan}</span>
            </Row>
            <Row label="Batch">
              <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", batchColor[displayed.batch])}>
                {displayed.batch}
              </span>
            </Row>
            <Row icon={<Calendar className="w-3.5 h-3.5" />} label="Expiry">
              <span className={cn("font-medium", days <= 7 ? "text-red-600" : "text-[#1A1A1A]")}>
                {formatDate(displayed.expiry)}
                {days <= 7 && days >= 0 && (
                  <span className="ml-1.5 text-xs text-red-500">({days}d left)</span>
                )}
                {days < 0 && <span className="ml-1.5 text-xs text-red-500">(expired)</span>}
              </span>
            </Row>
            <Row label="Deliveries left">
              <span className="font-medium">{remaining ?? "—"}</span>
            </Row>
          </Section>

          {/* Today's Meal */}
          <Section title="Today's Meal">
            <Row icon={<Utensils className="w-3.5 h-3.5" />} label="Meal">
              <span className="font-medium">{displayed.meal}</span>
            </Row>
            {constraintList.length > 0 ? (
              <div className="mt-2">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1.5">Constraints</p>
                <ul className="space-y-1">
                  {constraintList.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-sm text-[#1A1A1A]">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#1B5E20] flex-shrink-0" />
                      {c.trim()}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mt-1">No constraints</p>
            )}
          </Section>

          {/* Add-ons */}
          <Section title="Add-ons">
            <p className="text-sm text-[#1A1A1A]">{hasAddOn ? displayed.addons : "None"}</p>
          </Section>

          {/* Timing */}
          {displayed.timing && (
            <Section title="Delivery Timing">
              <p className="text-sm text-[#1A1A1A]">{displayed.timing}</p>
            </Section>
          )}

          {/* Address */}
          {displayed.address && (
            <Section title="Address">
              <p className="text-sm text-gray-600 leading-relaxed">{displayed.address}</p>
            </Section>
          )}

          {/* Notes */}
          {displayed.notes && (
            <Section title="Notes">
              <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 leading-relaxed">{displayed.notes}</p>
            </Section>
          )}

          {/* Admin Notes */}
          <Section title="Admin Notes">
            <div className="relative">
              <StickyNote className="absolute top-2.5 left-2.5 w-3.5 h-3.5 text-gray-300 pointer-events-none" />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add internal notes here..."
                rows={3}
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-[#e2e8d5] bg-[#F9FBF7] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] resize-none transition-colors placeholder:text-gray-300"
              />
            </div>
          </Section>
        </div>

        {/* Quick actions */}
        <div className="px-5 py-4 border-t border-[#e2e8d5] bg-[#F9FBF7] space-y-2.5">
          <Link
            href={`/subscribers/${displayed.id}`}
            className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium rounded-lg bg-[#1B5E20] text-white hover:bg-[#155116] transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Full Profile
          </Link>
          <div className="flex gap-2">
            <button
              onClick={onAction}
              className="flex-1 py-2 text-xs font-medium rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 transition-colors"
            >
              Pause
            </button>
            <button
              onClick={onAction}
              className="flex-1 py-2 text-xs font-medium rounded-lg border border-[#e2e8d5] bg-white text-[#1B5E20] hover:bg-green-50 transition-colors"
            >
              Extend Plan
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  label, children, icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <span className="text-gray-500 flex items-center gap-1.5 shrink-0">
        {icon}
        {label}
      </span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/* ─── Toast ─────────────────────────────────────────────────────────────────── */

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 bg-[#1A1A1A] text-white text-sm px-4 py-2.5 rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
      <AlertCircle className="w-4 h-4 text-[#FDD835] shrink-0" />
      {message}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 15;

export function SubscribersClient({ initialSubscribers }: { initialSubscribers: Subscriber[] }) {
  const [search, setSearch] = useState("");
  const [batchFilter, setBatchFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [planFilter, setPlanFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Subscriber | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const batches = useMemo(() => {
    const seen = new Set<string>();
    initialSubscribers.forEach((s) => seen.add(s.batch));
    return ["All", ...Array.from(seen).sort()];
  }, [initialSubscribers]);

  const activeCount = useMemo(
    () => initialSubscribers.filter((s) => s.status === "Active").length,
    [initialSubscribers]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return initialSubscribers.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q) && !s.phone.includes(q)) return false;
      if (batchFilter !== "All" && s.batch !== batchFilter) return false;
      if (statusFilter !== "All" && s.status !== statusFilter) return false;
      if (planFilter !== "All" && s.plan !== planFilter) return false;
      return true;
    });
  }, [search, batchFilter, statusFilter, planFilter]);

  // Reset to page 1 on filter change
  useEffect(() => { setPage(1); }, [search, batchFilter, statusFilter, planFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function showToast() {
    setToast("Feature available in full version");
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">Subscribers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{activeCount} active subscribers across {batches.length - 1} batches</p>
        </div>
        <Button
          onClick={showToast}
          className="bg-[#1B5E20] hover:bg-[#155116] text-white h-9 px-4 gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Add Subscriber
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#e2e8d5] bg-white text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] transition-colors placeholder:text-gray-400"
          />
        </div>
        <FilterSelect
          value={batchFilter}
          onChange={setBatchFilter}
          options={batches}
          label="Filter by batch"
        />
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={["All", "Active", "Paused", "Expired"]}
          label="Filter by status"
        />
        <FilterSelect
          value={planFilter}
          onChange={setPlanFilter}
          options={["All", "Daily", "5-day"]}
          label="Filter by plan"
        />
        {(search || batchFilter !== "All" || statusFilter !== "All" || planFilter !== "All") && (
          <button
            onClick={() => { setSearch(""); setBatchFilter("All"); setStatusFilter("All"); setPlanFilter("All"); }}
            className="h-9 px-3 text-sm text-gray-500 hover:text-[#1B5E20] flex items-center gap-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-[#e2e8d5] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                {["Code", "Name", "Phone", "Batch", "Plan", "Status", "Meal", "Constraints", "Expiry", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-gray-400 text-sm">
                    No subscribers match your filters.
                  </td>
                </tr>
              ) : (
                paginated.map((s, i) => {
                  const days = daysUntil(s.expiry);
                  const expiryRed = days <= 7;
                  return (
                    <tr
                      key={s.code}
                      className={cn(
                        "border-b border-[#e2e8d5] last:border-0 hover:bg-[#F9FBF7] transition-colors",
                        i % 2 === 1 && "bg-[#fafcf8]"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">{s.code}</td>
                      <td className="px-4 py-3 font-medium text-[#1A1A1A] whitespace-nowrap">{s.name}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{s.phone}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", batchColor[s.batch])}>
                          {s.batch}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{s.plan}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap max-w-[140px] truncate" title={s.meal}>
                        {s.meal}
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        {s.constraints ? (
                          <span
                            className="block truncate text-gray-600 cursor-default"
                            title={s.constraints}
                          >
                            {s.constraints}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className={cn("px-4 py-3 whitespace-nowrap text-sm font-medium", expiryRed ? "text-red-600" : "text-gray-600")}>
                        {formatDate(s.expiry)}
                        {expiryRed && (
                          <span className="ml-1 text-xs text-red-400">
                            {days < 0 ? "(exp)" : `(${days}d)`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => setSelected(s)}
                          className="text-xs font-medium text-[#1B5E20] hover:text-white hover:bg-[#1B5E20] border border-[#1B5E20]/30 hover:border-[#1B5E20] px-3 py-1.5 rounded-lg transition-all duration-150"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8d5] bg-[#F9FBF7]">
            <p className="text-xs text-gray-400">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg text-gray-400 hover:text-[#1B5E20] hover:bg-green-50 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={cn(
                    "w-7 h-7 text-xs rounded-lg transition-colors font-medium",
                    p === page
                      ? "bg-[#1B5E20] text-white"
                      : "text-gray-500 hover:bg-green-50 hover:text-[#1B5E20]"
                  )}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg text-gray-400 hover:text-[#1B5E20] hover:bg-green-50 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail side panel */}
      <DetailPanel
        subscriber={selected}
        onClose={() => setSelected(null)}
        onAction={() => {
          setToast("Feature available in full version");
        }}
      />

      {/* Toast */}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
