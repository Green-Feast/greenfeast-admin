"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Gift, Undo2, Search, X, Loader2, CheckCircle2, AlertCircle, Users, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { RefundDialog, type RefundCustomer, type RefundablePayment } from "./refund-dialog";
import { giftMeals, mealWorth } from "./actions";

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type RefundRow = {
  id: string;
  name: string;
  code: string;
  kind: "wallet" | "bank";
  amount: number;
  reason: string;
  status: "pending" | "completed" | "failed";
  failureNote: string | null;
  createdAt: string;
};

export type GiftRow = {
  id: string;
  name: string;
  code: string;
  meals: number;
  amount: number;
  reason: string;
  by: string | null;
  createdAt: string;
};

export type ReferralRow = {
  id: string;
  referrerName: string;
  referrerCode: string;
  refereeName: string;
  refereeCode: string;
  plan: string;
  status: "rewarded" | "rejected";
  rejectReason: string | null;
  referrerCredit: number;
  refereeCredit: number;
  createdAt: string;
};

type Tab = "refunds" | "gifts" | "referrals";

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  rewarded: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-600",
  rejected: "bg-gray-100 text-gray-600",
};

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

const TH = "text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3 whitespace-nowrap";

/* ─── Page ───────────────────────────────────────────────────────────────── */

export function RewardsClient({
  refunds, gifts, referrals, customers, refundablePayments,
}: {
  refunds: RefundRow[];
  gifts: GiftRow[];
  referrals: ReferralRow[];
  customers: RefundCustomer[];
  refundablePayments: RefundablePayment[];
}) {
  const [tab, setTab] = useState<Tab>("refunds");
  const [showRefund, setShowRefund] = useState(false);
  const [showGift, setShowGift] = useState(false);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();

  const has = (...xs: (string | null)[]) => !q || xs.some((x) => x?.toLowerCase().includes(q));
  const fRefunds = useMemo(() => refunds.filter((r) => has(r.name, r.code, r.reason)), [refunds, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const fGifts = useMemo(() => gifts.filter((g) => has(g.name, g.code, g.reason)), [gifts, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const fReferrals = useMemo(() => referrals.filter((r) => has(r.referrerName, r.referrerCode, r.refereeName, r.refereeCode)), [referrals, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const rewarded = referrals.filter((r) => r.status === "rewarded");
  const topReferrers = useMemo(() => {
    const m = new Map<string, { name: string; code: string; n: number; earned: number }>();
    for (const r of rewarded) {
      const e = m.get(r.referrerCode) ?? { name: r.referrerName, code: r.referrerCode, n: 0, earned: 0 };
      e.n += 1;
      e.earned += r.referrerCredit;
      m.set(r.referrerCode, e);
    }
    return Array.from(m.values()).sort((a, b) => b.n - a.n).slice(0, 5);
  }, [rewarded]);

  const kpis = [
    { label: "Refunded", value: rupees(refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amount, 0)), hint: `${refunds.length} refunds` },
    { label: "Meals gifted", value: String(gifts.reduce((s, g) => s + g.meals, 0)), hint: rupees(gifts.reduce((s, g) => s + g.amount, 0)) },
    { label: "Friends referred", value: String(rewarded.length), hint: `${rupees(rewarded.reduce((s, r) => s + r.referrerCredit + r.refereeCredit, 0))} in free meals` },
  ];

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "refunds", label: "Refunds", count: refunds.length },
    { key: "gifts", label: "Gifts", count: gifts.length },
    { key: "referrals", label: "Referrals", count: referrals.length },
  ];

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      {showRefund && <RefundDialog customers={customers} payments={refundablePayments} onClose={() => setShowRefund(false)} />}
      {showGift && <GiftDialog customers={customers} onClose={() => setShowGift(false)} />}

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Gift className="w-4 h-4 text-[#1B5E20]" />
            <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">Customers</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Referrals, refunds &amp; gifts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Money back, meals on the house, and friends who joined with a customer&apos;s code
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowGift(true)}
            className="h-9 px-4 flex items-center gap-2 rounded-lg border border-[#1B5E20] text-[#1B5E20] text-sm font-medium hover:bg-green-50 transition-colors"
          >
            <Gift className="w-4 h-4" /> Gift meals
          </button>
          <button
            onClick={() => setShowRefund(true)}
            className="h-9 px-4 flex items-center gap-2 rounded-lg bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#0D3F12] transition-colors"
          >
            <Undo2 className="w-4 h-4" /> Refund
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-[#e2e8d5] p-4 shadow-sm">
            <p className="text-2xl font-bold text-[#1A1A1A] mb-0.5">{k.value}</p>
            <p className="text-xs font-medium text-gray-500 mb-2">{k.label}</p>
            <p className="text-xs font-medium px-2 py-0.5 rounded-full inline-block bg-gray-100 text-gray-600">{k.hint}</p>
          </div>
        ))}
      </div>

      {topReferrers.length > 0 && tab === "referrals" && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <Users className="w-4 h-4 text-gray-400" />
          <span className="text-gray-500">Top referrers:</span>
          {topReferrers.map((r) => (
            <span key={r.code} className="px-2 py-1 rounded-lg bg-[#E8F5E9] text-[#1B5E20] text-xs">
              {r.name} <span className="font-mono">{r.code}</span> · {r.n} friend{r.n === 1 ? "" : "s"}
            </span>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e2e8d5] shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8d5] px-4 py-3">
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  tab === t.key ? "bg-[#1B5E20] text-white" : "text-gray-500 hover:bg-gray-100",
                )}
              >
                {t.label} <span className="opacity-70">({t.count})</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or GF-code…"
              className="h-9 w-56 rounded-lg border border-[#e2e8d5] pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          {tab === "refunds" && (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                {["Date", "Customer", "To", "Amount", "Reason", "Status"].map((h) => <th key={h} className={TH}>{h}</th>)}
              </tr></thead>
              <tbody>
                {fRefunds.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No refunds yet.</td></tr>
                ) : fRefunds.map((r, i) => (
                  <tr key={r.id} className={cn("border-b border-[#e2e8d5] last:border-0", i % 2 === 1 && "bg-[#fafcf8]")}>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-500">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="font-medium text-[#1A1A1A]">{r.name}</p>
                      <p className="font-mono text-xs text-gray-400">{r.code}</p>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-600">{r.kind === "bank" ? "Bank / UPI" : "Wallet"}</td>
                    <td className="px-5 py-3 font-semibold text-[#1A1A1A] whitespace-nowrap">{rupees(r.amount)}</td>
                    <td className="px-5 py-3 text-gray-600 max-w-[280px] truncate" title={r.reason}>{r.reason}</td>
                    <td className="px-5 py-3">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-600")} title={r.failureNote ?? undefined}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "gifts" && (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                {["Date", "Customer", "Meals", "Amount", "Reason", "By"].map((h) => <th key={h} className={TH}>{h}</th>)}
              </tr></thead>
              <tbody>
                {fGifts.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No gifts yet. Use &quot;Gift meals&quot; to add a meal&apos;s worth to a customer&apos;s wallet.</td></tr>
                ) : fGifts.map((g, i) => (
                  <tr key={g.id} className={cn("border-b border-[#e2e8d5] last:border-0", i % 2 === 1 && "bg-[#fafcf8]")}>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-500">{fmtDateTime(g.createdAt)}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="font-medium text-[#1A1A1A]">{g.name}</p>
                      <p className="font-mono text-xs text-gray-400">{g.code}</p>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-700">{g.meals}</td>
                    <td className="px-5 py-3 font-semibold text-[#1A1A1A] whitespace-nowrap">{rupees(g.amount)}</td>
                    <td className="px-5 py-3 text-gray-600 max-w-[280px] truncate" title={g.reason}>{g.reason}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">{g.by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "referrals" && (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                {["Date", "Referred by", "Friend", "Plan", "Free meals", "Status"].map((h) => <th key={h} className={TH}>{h}</th>)}
              </tr></thead>
              <tbody>
                {fReferrals.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No referrals yet. Customers share their GF-code from the app (Account → Invite friends).</td></tr>
                ) : fReferrals.map((r, i) => (
                  <tr key={r.id} className={cn("border-b border-[#e2e8d5] last:border-0", i % 2 === 1 && "bg-[#fafcf8]")}>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-500">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="font-medium text-[#1A1A1A]">{r.referrerName}</p>
                      <p className="font-mono text-xs text-gray-400">{r.referrerCode}</p>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="font-medium text-[#1A1A1A]">{r.refereeName}</p>
                      <p className="font-mono text-xs text-gray-400">{r.refereeCode}</p>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-600">{r.plan}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-700">
                      {r.status === "rewarded" ? `${rupees(r.referrerCredit)} + ${rupees(r.refereeCredit)}` : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", STATUS_STYLES[r.status])} title={r.rejectReason ?? undefined}>
                        {r.status === "rejected" ? "not rewarded" : r.status}
                      </span>
                      {r.rejectReason && <p className="text-xs text-gray-400 mt-1 max-w-[220px]">{r.rejectReason}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Gift meals dialog ──────────────────────────────────────────────────── */

const GIFT_REASONS = [
  "sorry about a late delivery",
  "sorry about a meal that wasn't right",
  "thank you for being with us",
  "happy birthday",
];

function GiftDialog({ customers, onClose }: { customers: RefundCustomer[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [meals, setMeals] = useState(1);
  const [reason, setReason] = useState("");
  const [worth, setWorth] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const customer = customers.find((c) => c.id === userId) ?? null;
  const matches = useMemo(() => {
    const qq = query.trim().toLowerCase();
    if (!qq) return [];
    return customers.filter((c) => c.name.toLowerCase().includes(qq) || c.phone.includes(qq) || c.code.toLowerCase().includes(qq)).slice(0, 8);
  }, [customers, query]);

  useEffect(() => {
    setWorth(null);
    if (!userId) return;
    let live = true;
    mealWorth(userId).then((w) => { if (live) setWorth(w); });
    return () => { live = false; };
  }, [userId]);

  const problem = !customer ? "Pick a customer." : !reason.trim() ? "Add a reason — the customer sees it." : null;

  function submit() {
    if (problem || !customer) return;
    setResult(null);
    startTransition(async () => {
      const r = await giftMeals(customer.id, meals, reason);
      setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) setReason("");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e2e8d5] px-5 py-4">
          <h2 className="text-lg font-bold text-[#1A1A1A]">Gift meals</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Customer</p>
            {customer ? (
              <div className="flex items-center justify-between rounded-xl border border-[#e2e8d5] bg-[#F9FBF7] px-3 py-2.5">
                <div>
                  <p className="font-medium text-[#1A1A1A]">{customer.name}</p>
                  <p className="text-xs text-gray-500"><span className="font-mono">{customer.code}</span> · wallet {rupees(customer.balance)}</p>
                </div>
                <button onClick={() => { setUserId(null); setResult(null); }} className="text-xs font-medium text-[#1B5E20] hover:underline">Change</button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, phone or GF-code…"
                  className="h-10 w-full rounded-lg border border-[#e2e8d5] pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                />
                {matches.length > 0 && (
                  <div className="mt-1 overflow-hidden rounded-lg border border-[#e2e8d5]">
                    {matches.map((c) => (
                      <button key={c.id} onClick={() => { setUserId(c.id); setQuery(""); setResult(null); }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-green-50">
                        <span>{c.name}</span>
                        <span className="font-mono text-xs text-gray-400">{c.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Meals</p>
            <div className="flex items-center gap-3">
              <button onClick={() => setMeals((m) => Math.max(1, m - 1))} disabled={meals <= 1}
                className="h-9 w-9 rounded-full border border-[#1B5E20] text-[#1B5E20] flex items-center justify-center disabled:opacity-30">
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-lg font-bold">{meals}</span>
              <button onClick={() => setMeals((m) => Math.min(30, m + 1))} disabled={meals >= 30}
                className="h-9 w-9 rounded-full border border-[#1B5E20] text-[#1B5E20] flex items-center justify-center disabled:opacity-30">
                <Plus className="h-4 w-4" />
              </button>
              <span className="text-sm text-gray-500">
                {customer
                  ? worth == null ? "Working out a meal's worth…" : `= ${rupees(worth * meals)} into their wallet (${rupees(worth)} a meal)`
                  : "One meal = their plan's meal price + default add-ons"}
              </span>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Reason (the customer sees it)</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {GIFT_REASONS.map((r) => (
                <button key={r} onClick={() => setReason(r)}
                  className={cn("px-2.5 py-1 rounded-full text-xs border", reason === r ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "border-[#e2e8d5] text-gray-600 hover:bg-gray-50")}>
                  {r}
                </button>
              ))}
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. sorry about Tuesday's late lunch"
              className="h-10 w-full rounded-lg border border-[#e2e8d5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30" />
            <p className="mt-1 text-xs text-gray-400">Message: &quot;We&apos;ve added {meals} meal{meals === 1 ? "" : "s"} (…) to your wallet — {reason || "…"}. Enjoy!&quot;</p>
          </div>

          {result && (
            <div className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm", result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700")}>
              {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              {result.text}
            </div>
          )}

          <button onClick={submit} disabled={!!problem || pending}
            className="h-10 w-full rounded-lg bg-[#1B5E20] text-sm font-medium text-white hover:bg-[#0D3F12] disabled:opacity-40 flex items-center justify-center gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            {problem ?? `Gift ${meals} meal${meals === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
