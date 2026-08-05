"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet, TrendingUp, TrendingDown, AlertCircle, Download, Search, X, IndianRupee,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type PaymentRow = {
  id: string;
  userId: string;
  name: string;
  phone: string;
  amount: number;
  status: string;
  kind: "plan" | "top-up";
  cfOrderId: string | null;
  cfPaymentId: string | null;
  createdAt: string;
};

export type TxRow = {
  id: string;
  userId: string;
  name: string;
  type: "credit" | "debit";
  amount: number;
  reason: string;
  referenceId: string | null;
  createdAt: string;
};

export type BalanceRow = {
  userId: string;
  name: string;
  phone: string;
  balance: number;
  deliveriesRemaining: number;
  updatedAt: string;
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const PAY_STATUS_STYLES: Record<string, string> = {
  paid: "bg-green-100 text-green-700",
  created: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-600",
  refunded: "bg-blue-100 text-blue-700",
};

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Component ──────────────────────────────────────────────────────────── */

type Tab = "payments" | "transactions" | "balances";

export function MoneyClient({
  payments,
  transactions,
  balances,
  monthStart,
}: {
  payments: PaymentRow[];
  transactions: TxRow[];
  balances: BalanceRow[];
  monthStart: string;
}) {
  const [tab, setTab] = useState<Tab>("transactions");
  const [search, setSearch] = useState("");
  const [payStatus, setPayStatus] = useState("All");
  const [txType, setTxType] = useState("All");

  const totals = useMemo(() => {
    const credited = transactions.filter((t) => t.type === "credit").reduce((s, t) => s + t.amount, 0);
    const debited = transactions.filter((t) => t.type === "debit").reduce((s, t) => s + t.amount, 0);
    const liability = balances.reduce((s, b) => s + b.balance, 0);

    const inMonth = (iso: string) => iso.slice(0, 10) >= monthStart;
    const creditedMonth = transactions.filter((t) => t.type === "credit" && inMonth(t.createdAt)).reduce((s, t) => s + t.amount, 0);
    const debitedMonth = transactions.filter((t) => t.type === "debit" && inMonth(t.createdAt)).reduce((s, t) => s + t.amount, 0);

    const paidPayments = payments.filter((p) => p.status === "paid");
    const paidTotal = paidPayments.reduce((s, p) => s + p.amount, 0);
    const unreconciled = payments.filter((p) => p.status === "created");
    const unreconciledTotal = unreconciled.reduce((s, p) => s + p.amount, 0);

    return {
      credited, debited, liability, creditedMonth, debitedMonth,
      paidCount: paidPayments.length, paidTotal,
      unreconciledCount: unreconciled.length, unreconciledTotal,
    };
  }, [payments, transactions, balances, monthStart]);

  // The payments table records the gateway side; wallet credits record money
  // actually made available to customers. These should track each other — when
  // they don't, one of the two paths is silently failing and that needs to be
  // visible here rather than discovered weeks later from a customer complaint.
  const reconciliationGap = totals.credited > 0 && totals.paidTotal === 0;

  const q = search.trim().toLowerCase();

  const filteredPayments = useMemo(() => payments.filter((p) => {
    if (payStatus !== "All" && p.status !== payStatus) return false;
    if (q && !p.name.toLowerCase().includes(q) && !p.phone.includes(q)) return false;
    return true;
  }), [payments, payStatus, q]);

  const filteredTx = useMemo(() => transactions.filter((t) => {
    if (txType !== "All" && t.type !== txType) return false;
    if (q && !t.name.toLowerCase().includes(q) && !t.reason.toLowerCase().includes(q)) return false;
    return true;
  }), [transactions, txType, q]);

  const filteredBalances = useMemo(() => balances.filter((b) => {
    if (q && !b.name.toLowerCase().includes(q) && !b.phone.includes(q)) return false;
    return true;
  }), [balances, q]);

  const kpis = [
    {
      label: "Wallet Liability",
      value: rupees(totals.liability),
      hint: "Prepaid money customers still hold",
      icon: Wallet,
      iconBg: "bg-amber-100",
      iconColor: "text-amber-700",
      pill: "bg-amber-50 text-amber-700",
    },
    {
      label: "Earned (meals delivered)",
      value: rupees(totals.debited),
      hint: `${rupees(totals.debitedMonth)} this month`,
      icon: TrendingUp,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-700",
      pill: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Money In (wallet credits)",
      value: rupees(totals.credited),
      hint: `${rupees(totals.creditedMonth)} this month`,
      icon: IndianRupee,
      iconBg: "bg-blue-100",
      iconColor: "text-blue-700",
      pill: "bg-blue-50 text-blue-700",
    },
    {
      label: "Unreconciled Payments",
      value: String(totals.unreconciledCount),
      hint: totals.unreconciledCount > 0 ? `${rupees(totals.unreconciledTotal)} never confirmed` : "All clear",
      icon: AlertCircle,
      iconBg: totals.unreconciledCount > 0 ? "bg-red-100" : "bg-gray-100",
      iconColor: totals.unreconciledCount > 0 ? "text-red-700" : "text-gray-500",
      pill: totals.unreconciledCount > 0 ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-500",
    },
  ];

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "transactions", label: "Wallet Transactions", count: transactions.length },
    { key: "payments", label: "Payments", count: payments.length },
    { key: "balances", label: "Customer Balances", count: balances.length },
  ];

  function exportCurrent() {
    if (tab === "payments") {
      downloadCsv("greenfeast-payments.csv",
        ["Date", "Name", "Phone", "Type", "Amount", "Status", "Cashfree Order", "Cashfree Payment"],
        filteredPayments.map((p) => [
          fmtDateTime(p.createdAt), p.name, p.phone, p.kind,
          (p.amount / 100).toFixed(2), p.status, p.cfOrderId ?? "", p.cfPaymentId ?? "",
        ]));
    } else if (tab === "transactions") {
      downloadCsv("greenfeast-wallet-transactions.csv",
        ["Date", "Name", "Type", "Amount", "Reason", "Reference"],
        filteredTx.map((t) => [
          fmtDateTime(t.createdAt), t.name, t.type,
          (t.amount / 100).toFixed(2), t.reason, t.referenceId ?? "",
        ]));
    } else {
      downloadCsv("greenfeast-wallet-balances.csv",
        ["Name", "Phone", "Balance", "Deliveries Remaining", "Last Activity"],
        filteredBalances.map((b) => [
          b.name, b.phone, (b.balance / 100).toFixed(2),
          String(b.deliveriesRemaining), fmtDate(b.updatedAt),
        ]));
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <IndianRupee className="w-4 h-4 text-[#1B5E20]" />
          <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">Finance</span>
        </div>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Money</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Payments, wallet ledger, and outstanding customer balances
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="bg-white rounded-xl border border-[#e2e8d5] p-4 shadow-sm">
              <div className={cn("p-2 rounded-lg w-fit mb-3", k.iconBg)}>
                <Icon className={cn("w-4 h-4", k.iconColor)} />
              </div>
              <p className="text-2xl font-bold text-[#1A1A1A] mb-0.5 break-words">{k.value}</p>
              <p className="text-xs font-medium text-gray-500 mb-2">{k.label}</p>
              <p className={cn("text-xs font-medium px-2 py-0.5 rounded-full inline-block", k.pill)}>
                {k.hint}
              </p>
            </div>
          );
        })}
      </div>

      {/* How to read these numbers — the wallet model isn't obvious, and
          misreading "Money In" as profit would be an expensive mistake. */}
      <div className="mb-6 rounded-xl border border-[#e2e8d5] bg-[#F9FBF7] p-4 text-sm text-gray-600">
        <p className="font-semibold text-[#1A1A1A] mb-1.5">How to read this</p>
        <p className="leading-relaxed">
          Customers pay up front and that money sits in their wallet.{" "}
          <span className="font-medium text-[#1A1A1A]">Money In</span> is what they've paid you.{" "}
          <span className="font-medium text-[#1A1A1A]">Earned</span> is the portion you've actually
          worked for — each delivered meal deducts its cost from their wallet.{" "}
          <span className="font-medium text-[#1A1A1A]">Wallet Liability</span> is what's left over:
          money you're holding but still owe meals against. It is not profit.
        </p>
      </div>

      {reconciliationGap && (
        <div className="mb-6 flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Payments aren't being confirmed</p>
            <p className="mt-0.5 leading-relaxed">
              {rupees(totals.credited)} has been credited to wallets, but not a single payment row is
              marked paid ({totals.unreconciledCount} stuck at "created"). That means the payment
              gateway's confirmation isn't reaching the system — wallets are being funded by the app
              directly instead. Worth fixing before this scales.
            </p>
          </div>
        </div>
      )}

      {/* Tabs + controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex rounded-lg border border-[#e2e8d5] overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                tab === t.key ? "bg-[#1B5E20] text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              )}
            >
              {t.label} <span className="opacity-60">({t.count})</span>
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, reason..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#e2e8d5] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          />
        </div>

        {tab === "payments" && (
          <select
            value={payStatus}
            onChange={(e) => setPayStatus(e.target.value)}
            className="h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          >
            {["All", "paid", "created", "failed", "refunded"].map((s) => (
              <option key={s} value={s}>{s === "All" ? "All statuses" : s}</option>
            ))}
          </select>
        )}

        {tab === "transactions" && (
          <select
            value={txType}
            onChange={(e) => setTxType(e.target.value)}
            className="h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
          >
            {["All", "credit", "debit"].map((s) => (
              <option key={s} value={s}>{s === "All" ? "All types" : s}</option>
            ))}
          </select>
        )}

        {search && (
          <button
            onClick={() => setSearch("")}
            className="h-9 px-3 text-sm text-gray-500 hover:text-[#1B5E20] flex items-center gap-1.5 rounded-lg hover:bg-gray-100"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}

        <button
          onClick={exportCurrent}
          className="h-9 px-4 flex items-center gap-2 rounded-lg border border-[#1B5E20] bg-white text-[#1B5E20] text-sm font-medium hover:bg-green-50 transition-colors ml-auto"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#e2e8d5] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {tab === "transactions" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                  {["Date", "Customer", "Type", "Amount", "Reason"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTx.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-gray-400">No transactions match.</td></tr>
                ) : filteredTx.map((t, i) => (
                  <tr key={t.id} className={cn("border-b border-[#e2e8d5] last:border-0", i % 2 === 1 && "bg-[#fafcf8]")}>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-500">{fmtDateTime(t.createdAt)}</td>
                    <td className="px-5 py-3 font-medium text-[#1A1A1A] whitespace-nowrap">{t.name}</td>
                    <td className="px-5 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                        t.type === "credit" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      )}>
                        {t.type === "credit" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {t.type}
                      </span>
                    </td>
                    <td className={cn("px-5 py-3 font-semibold whitespace-nowrap", t.type === "credit" ? "text-green-700" : "text-[#1A1A1A]")}>
                      {t.type === "credit" ? "+" : "−"}{rupees(t.amount)}
                    </td>
                    <td className="px-5 py-3 text-gray-600 max-w-[280px] truncate" title={t.reason}>{t.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "payments" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                  {["Date", "Customer", "For", "Amount", "Status", "Cashfree ID"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No payments match.</td></tr>
                ) : filteredPayments.map((p, i) => (
                  <tr key={p.id} className={cn("border-b border-[#e2e8d5] last:border-0", i % 2 === 1 && "bg-[#fafcf8]")}>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-500">{fmtDateTime(p.createdAt)}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="font-medium text-[#1A1A1A]">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.phone}</p>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-600 capitalize">{p.kind}</td>
                    <td className="px-5 py-3 font-semibold text-[#1A1A1A] whitespace-nowrap">{rupees(p.amount)}</td>
                    <td className="px-5 py-3">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", PAY_STATUS_STYLES[p.status] ?? "bg-gray-100 text-gray-600")}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-400 truncate max-w-[180px]" title={p.cfPaymentId ?? p.cfOrderId ?? ""}>
                      {p.cfPaymentId ?? p.cfOrderId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "balances" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                  {["Customer", "Phone", "Wallet Balance", "Meals Left", "Cover", "Last Activity"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBalances.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No customers match.</td></tr>
                ) : filteredBalances.map((b, i) => {
                  // Roughly how much wallet money is available per remaining
                  // meal — a low number means they'll run dry before the plan
                  // ends and deliveries will start getting skipped.
                  const perMeal = b.deliveriesRemaining > 0 ? b.balance / b.deliveriesRemaining : null;
                  const low = perMeal !== null && perMeal < 20000; // < ₹200/meal
                  return (
                    <tr key={b.userId} className={cn("border-b border-[#e2e8d5] last:border-0", i % 2 === 1 && "bg-[#fafcf8]")}>
                      <td className="px-5 py-3 font-medium text-[#1A1A1A] whitespace-nowrap">
                        <Link href={`/subscribers`} className="hover:text-[#1B5E20] hover:underline">{b.name}</Link>
                      </td>
                      <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{b.phone}</td>
                      <td className="px-5 py-3 font-semibold text-[#1A1A1A] whitespace-nowrap">{rupees(b.balance)}</td>
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{b.deliveriesRemaining}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {perMeal === null ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : (
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium",
                            low ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                          )}>
                            {rupees(perMeal)}/meal
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-400 whitespace-nowrap text-xs">{fmtDate(b.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
