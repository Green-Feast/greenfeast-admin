"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Search, X, Phone, Calendar, Utensils, StickyNote, ChevronLeft, ChevronRight, Plus, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ─── Data ─────────────────────────────────────────────────────────────────── */

type Subscriber = {
  code: string;
  name: string;
  phone: string;
  batch: string;
  plan: string;
  status: "Active" | "Paused" | "Expired";
  meal: string;
  constraints: string;
  expiry: string;
};

const subscribers: Subscriber[] = [
  { code: "N/C/01", name: "Nitika Shilp Sangam", phone: "7610030677", batch: "Nami", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "Extra Paneer", expiry: "2026-06-15" },
  { code: "N/C/02", name: "Aanchal", phone: "9782212557", batch: "Nami", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "No tofu, No Buddha Avo protein", expiry: "2026-06-10" },
  { code: "N/C/03", name: "Hiya", phone: "9571660678", batch: "Nami", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "No peanut, No Pesto, No mushroom", expiry: "2026-06-08" },
  { code: "N/C/04", name: "Dr. Nisha", phone: "8080475554", batch: "Nami", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "No Bell pepper, No Mushroom, No chilli tofu", expiry: "2026-06-20" },
  { code: "N/C/05", name: "Dr. Ishika Nanda", phone: "8171675992", batch: "Nami", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "No Bell pepper, extra Lettuce", expiry: "2026-06-20" },
  { code: "N/C/06", name: "Jasleen", phone: "9815406442", batch: "Nami", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "No pasta, add quinoa", expiry: "2026-06-12" },
  { code: "N/C/07", name: "Dr. Muskan Jindal", phone: "9971414065", batch: "Nami", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "ALLERGIC TO QUINOA", expiry: "2026-06-18" },
  { code: "N/C/08", name: "Karan Dutt", phone: "8628072700", batch: "Nami", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "Use quinoa", expiry: "2026-06-05" },
  { code: "N/C/09", name: "Dr. Gurusha Kausal", phone: "8955652679", batch: "Nami", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "NO PANEER, Add tofu", expiry: "2026-06-22" },
  { code: "N/R/10", name: "Pallavi Bhadu", phone: "9782946260", batch: "Nami", plan: "Daily", status: "Paused", meal: "Asian Bowl", constraints: "", expiry: "2026-06-01" },
  { code: "N/R/11", name: "Shweta Khari", phone: "7290929167", batch: "Nami", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "", expiry: "2026-06-03" },
  { code: "N/R/12", name: "Abhimanyu Sinha", phone: "9172220043", batch: "Nami", plan: "Daily", status: "Active", meal: "Thai Zen Bowl", constraints: "Mexican, Soya panini alternating", expiry: "2026-06-14" },
  { code: "R/C/01", name: "Ankit Chitlangiya", phone: "9829005037", batch: "Rahul", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "Dressing Outside, Extra protein", expiry: "2026-06-19" },
  { code: "R/C/02", name: "Deepanshu Sarda", phone: "9460102650", batch: "Rahul", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "No Mushrooms, Gluten Free", expiry: "2026-06-11" },
  { code: "R/C/03", name: "Vandana Chandana", phone: "9829648888", batch: "Rahul", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "GLUTEN FREE, 2 dressings", expiry: "2026-06-17" },
  { code: "R/C/04", name: "Gunjan Khandelwal", phone: "9829993434", batch: "Rahul", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "No Mushroom, No Tofu", expiry: "2026-06-09" },
  { code: "R/R/05", name: "Muskan Karnawat", phone: "9828899959", batch: "Rahul", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "", expiry: "2026-06-04" },
  { code: "R/R/06", name: "Arvind Gupta", phone: "9829050571", batch: "Rahul", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "2 Meals", expiry: "2026-06-16" },
  { code: "Y/C/01", name: "Sonal Mendiratta", phone: "9829722323", batch: "Yashpal", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "EXTRA PROTEIN", expiry: "2026-06-21" },
  { code: "Y/C/02", name: "Rahul Janani", phone: "9829160415", batch: "Yashpal", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "No salt, no cheese, no butter", expiry: "2026-06-13" },
  { code: "Y/C/03", name: "Rohit Thawrani", phone: "9509508345", batch: "Yashpal", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "No carbs, No Quinoa, No wraps", expiry: "2026-06-07" },
  { code: "Y/C/04", name: "Pratyush Agarwal", phone: "9929407481", batch: "Yashpal", plan: "5-day", status: "Active", meal: "Peri Peri Panini", constraints: "Thursdays only panini", expiry: "2026-06-23" },
  { code: "Y/C/05", name: "Dr. Charul", phone: "9001024212", batch: "Yashpal", plan: "Daily", status: "Active", meal: "Umami Soba Bowl", constraints: "No lettuce, add other veggies", expiry: "2026-06-18" },
  { code: "Y/C/06", name: "Dr. Sanjana Somani", phone: "9873848847", batch: "Yashpal", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "Less quinoa, more panini", expiry: "2026-06-10" },
  { code: "Y/C/07", name: "Utsav Sharma", phone: "8302648202", batch: "Yashpal", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "NO Quinoa", expiry: "2026-06-15" },
  { code: "Y/C/08", name: "Puru", phone: "8955708287", batch: "Yashpal", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "NO mushroom", expiry: "2026-06-06" },
  { code: "S/C/01", name: "Aditii Sisodiya", phone: "9820415361", batch: "Santu", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "Less carbs, no beetroot, no chickpeas, no tofu", expiry: "2026-06-20" },
  { code: "S/C/02", name: "Dr. Shivam", phone: "9992787315", batch: "Santu", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "No Papaya, No corn", expiry: "2026-06-14" },
  { code: "S/C/03", name: "Dr. Sidhant", phone: "8225000777", batch: "Santu", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "Gluten Free", expiry: "2026-06-11" },
  { code: "S/C/04", name: "Dr. Ashray Jain", phone: "6387668569", batch: "Santu", plan: "Daily", status: "Active", meal: "Tropical Fruit Salad", constraints: "Extra spicy smoothie Thursdays", expiry: "2026-06-19" },
  { code: "S/C/05", name: "Anant", phone: "8619957997", batch: "Santu", plan: "Daily", status: "Active", meal: "Mexican Fiesta Bowl", constraints: "More dressing", expiry: "2026-06-16" },
  { code: "S/C/06", name: "Surabhi Pannu", phone: "9636456512", batch: "Santu", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "DAIRY FREE ALLERGEN", expiry: "2026-06-08" },
  { code: "S/C/07", name: "Ashwin Ji", phone: "7021139318", batch: "Santu", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "Less Carbs, No tofu, No Quinoa", expiry: "2026-06-22" },
  { code: "S/C/08", name: "Akash Chauhan", phone: "8233186472", batch: "Santu", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "No Pasta, No Mushroom, No Noodles", expiry: "2026-06-17" },
  { code: "S/C/09", name: "Giri Raj", phone: "7568387373", batch: "Santu", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "Extra Paneer, Extra Corn", expiry: "2026-06-12" },
  { code: "E/C/01", name: "Praveen Vijayvegiya", phone: "9982613131", batch: "Evening", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "EXTRA Protein", expiry: "2026-06-20" },
  { code: "E/C/02", name: "Shubham Gangwal", phone: "9597445822", batch: "Evening", plan: "5-day", status: "Active", meal: "Asian Bowl", constraints: "NO AVOCADO, 2 Egg alternating", expiry: "2026-06-13" },
  { code: "E/C/03", name: "Shivani Puri", phone: "9982511715", batch: "Evening", plan: "Daily", status: "Active", meal: "Asian Bowl", constraints: "Chipotle + Peanut dressing, No avo protein", expiry: "2026-06-09" },
  { code: "E/C/04", name: "Aman Dua", phone: "7597092777", batch: "Evening", plan: "Daily", status: "Active", meal: "Quinoa Buddha Bowl", constraints: "No beetroot, No sweet potato, add paneer", expiry: "2026-06-18" },
];

/* Hardcoded remaining deliveries per subscriber code */
const deliveriesRemaining: Record<string, number> = {
  "N/C/01": 12, "N/C/02": 8,  "N/C/03": 6,  "N/C/04": 18, "N/C/05": 18,
  "N/C/06": 10, "N/C/07": 15, "N/C/08": 4,  "N/C/09": 20, "N/R/10": 0,
  "N/R/11": 2,  "N/R/12": 11, "R/C/01": 17, "R/C/02": 9,  "R/C/03": 14,
  "R/C/04": 7,  "R/R/05": 3,  "R/R/06": 13, "Y/C/01": 19, "Y/C/02": 11,
  "Y/C/03": 5,  "Y/C/04": 21, "Y/C/05": 16, "Y/C/06": 8,  "Y/C/07": 12,
  "Y/C/08": 4,  "S/C/01": 18, "S/C/02": 11, "S/C/03": 9,  "S/C/04": 17,
  "S/C/05": 13, "S/C/06": 6,  "S/C/07": 20, "S/C/08": 14, "S/C/09": 10,
  "E/C/01": 18, "E/C/02": 11, "E/C/03": 7,  "E/C/04": 16,
};

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

const TODAY = new Date("2026-05-30");

function daysUntil(dateStr: string) {
  const d = new Date(dateStr);
  return Math.ceil((d.getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string) {
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
  const remaining = deliveriesRemaining[displayed.code] ?? 10;
  const hasAddOn = displayed.code === "N/C/08"; // Karan Dutt

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
              <span className="font-medium">{remaining}</span>
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
            <p className="text-sm text-[#1A1A1A]">{hasAddOn ? "🥤 Smoothie" : "None"}</p>
          </Section>

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
        <div className="px-5 py-4 border-t border-[#e2e8d5] bg-[#F9FBF7]">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2.5">Quick Actions</p>
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
            <button
              onClick={onAction}
              className="flex-1 py-2 text-xs font-medium rounded-lg border border-[#e2e8d5] bg-white text-[#1A1A1A] hover:bg-gray-50 transition-colors"
            >
              Change Batch
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

export function SubscribersClient() {
  const [search, setSearch] = useState("");
  const [batchFilter, setBatchFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [planFilter, setPlanFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Subscriber | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return subscribers.filter((s) => {
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
          <p className="text-sm text-gray-500 mt-0.5">58 active subscribers across 5 batches</p>
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
          options={["All", "Nami", "Rahul", "Yashpal", "Santu", "Evening"]}
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
