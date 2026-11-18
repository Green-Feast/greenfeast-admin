"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle, CheckCircle2, Download, FileText, Gift, Landmark, ListChecks, Receipt, Scale, Search,
  ShieldCheck, TicketPercent, Trash2, Users, Wallet, X, XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MonthPicker, downloadText } from "@/components/month-picker"
import { useActionPassword } from "@/components/action-password"
import { PaymentProofFields, emptyProof, proofProblem, type ProofInput } from "@/components/payment-proof"
import { SettleBalanceFields, emptySettle, settleProblem, toSettleInput, type RefundablePayment, type SettleValue } from "@/components/settle-balance"
import {
  CATEGORY, categoryLabel, fmtDate, fmtDateTime, methodLabel, monthLabel, paiseToRupeesNumber, rupees, sourceLabel, toCsv,
} from "@/lib/money-labels"
import { istToday } from "@/lib/ist"
import { addPaymentProof, settleCustomerBalance } from "./actions"

// ── Types (built by page.tsx) ───────────────────────────────────────────────

export type Summary = {
  from: string; to: string
  opening_balance: number; credits: number; debits: number; closing_balance: number; wallets_now: number
  by_category: { type: "credit" | "debit"; category: string; count: number; amount: number }[]
  payments: { method: string | null; source: string | null; count: number; amount: number; cash: number; upi: number }[]
  refunds: { kind: string; status: string; count: number; amount: number }[]
  coupons: { count: number; discount: number }
  cod_outstanding: { count: number; amount: number }
  archived_accounts: number
}
export type Check = { key: string; label: string; ok: boolean; count: number; amount: number; rows: Record<string, any>[] }
export type LedgerRow = { id: string; at: string; code: string; name: string; type: "credit" | "debit"; category: string; amount: number; reason: string; reference: string; admin: string | null; archived: boolean }
export type PaymentRow = {
  id: string; userId: string; code: string; name: string; amount: number; status: string; method: string | null; source: string | null
  cash: number; upi: number; proof: string | null; paidOn: string | null; recordedBy: string | null; note: string | null
  cfOrderId: string | null; cfPaymentId: string | null; createdAt: string; couponCode: string | null; discount: number; walletCarry: number
  credited: boolean; proofAddedAt: string | null
}
export type RefundRow = { id: string; code: string; name: string; kind: string; amount: number; reason: string; status: string; method: string | null; proof: string | null; failureNote: string | null; by: string | null; at: string }
export type GiftRow = { id: string; code: string; name: string; meals: number; mealCost: number; amount: number; reason: string; by: string | null; at: string }
export type ReferralRow = { id: string; referrer: string; referrerName: string; friend: string; friendName: string; status: string; rejectReason: string | null; reward: number; at: string }
export type CouponUseRow = { id: string; code: string; name: string; coupon: string; kind: string; meals: number; price: number; regular: number; discount: number; at: string }
export type BalanceRow = { userId: string; code: string; name: string; phone: string; balance: number; plan: string | null; planStatus: string | null; mealsLeft: number | null; cashDue: number; onCredit: boolean; updatedAt: string }
export type DecisionRow = { id: string; code: string; name: string; decision: string; amount: number; before: number; reason: string; by: string | null; at: string }
export type ArchiveRow = { id: string; code: string; name: string; phone: string; reason: string; balance: number; forfeited: number; rows: number; by: string | null; at: string }

export type MoneyData = {
  month: string; from: string; to: string; isTest: boolean
  summary: Summary | null; error: string | null
  checks: Check[]; ledger: LedgerRow[]; payments: PaymentRow[]; refunds: RefundRow[]; gifts: GiftRow[]; referrals: ReferralRow[]
  couponUses: CouponUseRow[]; balances: BalanceRow[]; decisions: DecisionRow[]; archives: ArchiveRow[]
  refundable: Record<string, RefundablePayment[]>
}

type Tab = "summary" | "checks" | "ledger" | "payments" | "refunds" | "rewards" | "coupons" | "balances" | "archive"

const TABS: { key: Tab; label: string; icon: typeof Wallet }[] = [
  { key: "summary", label: "Summary", icon: Scale },
  { key: "checks", label: "Checks", icon: ListChecks },
  { key: "ledger", label: "Ledger", icon: Receipt },
  { key: "payments", label: "Payments in", icon: Landmark },
  { key: "refunds", label: "Refunds", icon: Wallet },
  { key: "rewards", label: "Gifts & referrals", icon: Gift },
  { key: "coupons", label: "Coupons", icon: TicketPercent },
  { key: "balances", label: "Balances", icon: Users },
  { key: "archive", label: "Deleted accounts", icon: Trash2 },
]

const DECISION: Record<string, string> = { keep: "Kept as credit", forfeit: "Forfeited", refund_bank: "Refunded (Cashfree)", refund_offline: "Refunded (outside Cashfree)" }
const ARCHIVE_REASON: Record<string, string> = { account_deleted: "Customer deleted account", admin_deleted: "Deleted by admin", admin_reset: "Reset by admin" }
const inputCls = "h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"

const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0)

// ── Page ────────────────────────────────────────────────────────────────────

export function MoneyClient({ data }: { data: MoneyData }) {
  const router = useRouter()
  const askPassword = useActionPassword()
  const [tab, setTab] = useState<Tab>("summary")
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [proofFor, setProofFor] = useState<PaymentRow | { id: string; amount: number; code: string; name: string } | null>(null)
  const [settleFor, setSettleFor] = useState<{ userId: string; code: string; name: string; balance: number } | null>(null)
  const [pending, start] = useTransition()

  const s = data.summary
  const isCurrent = data.month === istToday().slice(0, 7)
  const failing = data.checks.filter((c) => !c.ok)
  const fileBase = `greenfeast-${data.isTest ? "TEST-" : ""}money-${data.month}`

  function say(ok: boolean, text: string) {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 4500)
  }

  function secure(what: string, fn: (pw: string) => Promise<{ ok: true; message: string } | { ok: false; error: string }>, done: () => void) {
    askPassword(what).then((pw) => {
      if (pw === null) return
      start(async () => {
        const r = await fn(pw)
        if (!r.ok) return say(false, r.error)
        say(true, r.message)
        done()
        router.refresh()
      })
    })
  }

  const byCat = (type: "credit" | "debit", group?: string) =>
    (s?.by_category ?? []).filter((c) => c.type === type && (!group || CATEGORY[c.category]?.group === group))
  const moneyIn = sumBy(byCat("credit", "money_in"), (c) => c.amount)
  const otherCredits = sumBy(byCat("credit"), (c) => c.amount) - moneyIn
  const mealsCharged = sumBy(byCat("debit", "spend"), (c) => c.amount)
  const refundsOut = sumBy(byCat("debit", "out"), (c) => c.amount)
  const income = sumBy(byCat("debit", "income"), (c) => c.amount)

  // ── Exports ──
  const csv = {
    ledger: () => toCsv(
      ["Date (IST)", "Customer code", "Customer", "Type", "Category", "Amount (₹)", "Reason", "Reference", "Admin", "Archived"],
      data.ledger.map((r) => [fmtDateTime(r.at), r.code, r.name, r.type, categoryLabel(r.category), paiseToRupeesNumber(r.type === "credit" ? r.amount : -r.amount), r.reason, r.reference, r.admin ?? "", r.archived ? "yes" : ""])),
    payments: () => toCsv(
      ["Paid on", "Created (IST)", "Customer code", "Customer", "Amount (₹)", "Status", "Method", "Cash (₹)", "UPI (₹)", "Source", "Proof reference", "Recorded by", "Cashfree order", "Cashfree payment", "Coupon", "Discount (₹)", "Wallet credit used (₹)", "Credited to wallet", "Note"],
      data.payments.map((p) => [p.paidOn ?? "", fmtDateTime(p.createdAt), p.code, p.name, paiseToRupeesNumber(p.amount), p.status, methodLabel(p.method), paiseToRupeesNumber(p.cash), paiseToRupeesNumber(p.upi), sourceLabel(p.source), p.proof ?? "", p.recordedBy ?? "", p.cfOrderId ?? "", p.cfPaymentId ?? "", p.couponCode ?? "", paiseToRupeesNumber(p.discount), paiseToRupeesNumber(p.walletCarry), p.credited ? "yes" : "no", p.note ?? ""])),
    refunds: () => toCsv(
      ["Date (IST)", "Customer code", "Customer", "Kind", "Amount (₹)", "Status", "Method", "Reference", "Reason", "Failure", "By"],
      data.refunds.map((r) => [fmtDateTime(r.at), r.code, r.name, r.kind, paiseToRupeesNumber(r.amount), r.status, r.method ?? "", r.proof ?? "", r.reason, r.failureNote ?? "", r.by ?? ""])),
    gifts: () => toCsv(
      ["Date (IST)", "Customer code", "Customer", "Meals", "Meal worth (₹)", "Amount (₹)", "Reason", "By"],
      data.gifts.map((g) => [fmtDateTime(g.at), g.code, g.name, g.meals, paiseToRupeesNumber(g.mealCost), paiseToRupeesNumber(g.amount), g.reason, g.by ?? ""])),
    referrals: () => toCsv(
      ["Date (IST)", "Referrer code", "Referrer", "Friend code", "Friend", "Status", "Reward (₹)", "Rejected because"],
      data.referrals.map((r) => [fmtDateTime(r.at), r.referrer, r.referrerName, r.friend, r.friendName, r.status, paiseToRupeesNumber(r.reward), r.rejectReason ?? ""])),
    coupons: () => toCsv(
      ["Date (IST)", "Customer code", "Customer", "Coupon", "Kind", "Meals", "Coupon meal price (₹)", "Regular meal price (₹)", "Discount (₹)"],
      data.couponUses.map((c) => [fmtDateTime(c.at), c.code, c.name, c.coupon, c.kind, c.meals, paiseToRupeesNumber(c.price), paiseToRupeesNumber(c.regular), paiseToRupeesNumber(c.discount)])),
    balances: () => toCsv(
      ["Customer code", "Customer", "Phone", "Wallet (₹)", "Plan", "Plan status", "Meals left", "Cash due (₹)", "On credit", "Last change (IST)"],
      data.balances.map((b) => [b.code, b.name, b.phone, paiseToRupeesNumber(b.balance), b.plan ?? "no live plan", b.planStatus ?? "", b.mealsLeft ?? "", paiseToRupeesNumber(b.cashDue), b.onCredit ? "yes" : "", fmtDateTime(b.updatedAt)])),
    decisions: () => toCsv(
      ["Date (IST)", "Customer code", "Customer", "Decision", "Amount (₹)", "Balance before (₹)", "Reason", "By"],
      data.decisions.map((d) => [fmtDateTime(d.at), d.code, d.name, DECISION[d.decision] ?? d.decision, paiseToRupeesNumber(d.amount), paiseToRupeesNumber(d.before), d.reason, d.by ?? ""])),
    archive: () => toCsv(
      ["Archived (IST)", "Customer code", "Name", "Phone", "Why", "Balance at close (₹)", "Recorded as closed (₹)", "Records kept", "By"],
      data.archives.map((a) => [fmtDateTime(a.at), a.code, a.name, a.phone, ARCHIVE_REASON[a.reason] ?? a.reason, paiseToRupeesNumber(a.balance), paiseToRupeesNumber(a.forfeited), a.rows, a.by ?? ""])),
    checks: () => toCsv(
      ["Check", "Result", "Rows", "Amount (₹)", "Details"],
      data.checks.map((c) => [c.label, c.ok ? "OK" : "NEEDS ATTENTION", c.count, paiseToRupeesNumber(c.amount), c.rows.slice(0, 50).map((r) => Object.values(r).join(" ")).join(" | ")])),
  }

  async function summaryPdf() {
    if (!s) return
    const { default: jsPDF } = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")
    const doc = new jsPDF({ unit: "pt", format: "a4" })
    const rs = (p: number) => `Rs. ${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    doc.setFontSize(16)
    doc.text(`GreenFeast — money summary, ${monthLabel(data.month)}${data.isTest ? " (TEST data)" : ""}`, 40, 50)
    doc.setFontSize(9)
    doc.text(`Period ${data.from} to ${data.to} (exclusive), IST. Generated ${fmtDateTime(new Date().toISOString())}. Amounts in rupees.`, 40, 66)
    let y = 84
    const table = (title: string, head: string[], body: (string | number)[][]) => {
      doc.setFontSize(11)
      doc.text(title, 40, y + 12)
      autoTable(doc, { startY: y + 18, head: [head], body: body.map((r) => r.map(String)), styles: { fontSize: 8 }, headStyles: { fillColor: [27, 94, 32] }, margin: { left: 40, right: 40 } })
      y = (doc as any).lastAutoTable.finalY + 14
    }
    table("Customer wallets (prepaid balances owed to customers)", ["", "Amount"], [
      ["Opening balance", rs(s.opening_balance)],
      ["+ Credits in the month", rs(s.credits)],
      ["− Debits in the month", rs(s.debits)],
      ["= Closing balance", rs(s.closing_balance)],
      ...(isCurrent ? [["Wallets right now (live)", rs(s.wallets_now)]] : []),
    ])
    table("Ledger by category", ["Type", "Category", "Entries", "Amount"],
      s.by_category.map((c) => [c.type, categoryLabel(c.category), c.count, rs(c.amount)]))
    table("Money received (by day paid)", ["Method", "Source", "Payments", "Amount", "Cash", "UPI"],
      s.payments.map((p) => [methodLabel(p.method), sourceLabel(p.source), p.count, rs(p.amount), rs(p.cash), rs(p.upi)]))
    table("Refunds", ["Kind", "Status", "Count", "Amount"], s.refunds.map((r) => [r.kind, r.status, r.count, rs(r.amount)]))
    table("Other", ["", "Value"], [
      ["Coupons used / discount given", `${s.coupons.count} / ${rs(s.coupons.discount)}`],
      ["Cash on delivery still to collect (now)", `${s.cod_outstanding.count} plans / ${rs(s.cod_outstanding.amount)}`],
      ["Accounts archived in the month", String(s.archived_accounts)],
    ])
    table("Reconciliation checks (now)", ["Check", "Result", "Rows", "Amount"],
      data.checks.map((c) => [c.label, c.ok ? "OK" : "NEEDS ATTENTION", c.count, rs(c.amount)]))
    doc.save(`${fileBase}-summary.pdf`)
  }

  async function monthPack() {
    await summaryPdf()
    const files: [string, string][] = [
      ["ledger", csv.ledger()], ["payments", csv.payments()], ["refunds", csv.refunds()], ["gifts", csv.gifts()],
      ["referrals", csv.referrals()], ["coupons", csv.coupons()], ["balances", csv.balances()],
      ["balance-decisions", csv.decisions()], ["deleted-accounts", csv.archive()], ["checks", csv.checks()],
    ]
    for (const [name, text] of files) {
      downloadText(`${fileBase}-${name}.csv`, text)
      await new Promise((r) => setTimeout(r, 350))
    }
    say(true, "Month-end pack downloaded — allow multiple downloads if the browser asks. The admin log is on Security & admin log.")
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Money</h1>
          <p className="text-sm text-gray-500 mt-1">Every rupee in and out for the month, with its proof. Records here are permanent.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker month={data.month} max={istToday().slice(0, 7)} />
          <button onClick={summaryPdf} disabled={!s} className="h-10 px-4 rounded-xl border border-[#e2e8d5] bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2 disabled:opacity-40">
            <FileText className="w-4 h-4" /> Summary PDF
          </button>
          <button onClick={monthPack} disabled={!s} className="h-10 px-4 rounded-xl bg-[#1B5E20] text-sm font-medium text-white hover:bg-[#155116] inline-flex items-center gap-2 disabled:opacity-40">
            <Download className="w-4 h-4" /> Month-end pack
          </button>
          <Link href={`/security?month=${data.month}`} className="h-10 px-4 rounded-xl border border-[#e2e8d5] bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Admin log
          </Link>
        </div>
      </div>

      {data.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          The money reports couldn&apos;t load: {data.error}
        </div>
      )}

      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          <Kpi label="Opening wallets" value={rupees(s.opening_balance)} hint={`owed on ${fmtDate(data.from)}`} />
          <Kpi label="Money received" value={rupees(moneyIn)} hint="Cashfree, cash, UPI, opening balances" tone="green" />
          <Kpi label="Other credits" value={rupees(otherCredits)} hint="gifts, referrals, refunds to wallet" tone="amber" />
          <Kpi label="Meals charged" value={rupees(mealsCharged)} hint="delivered meals" />
          <Kpi label="Refunded out" value={rupees(refundsOut)} hint="bank + outside Cashfree" />
          <Kpi label="Kept by GreenFeast" value={rupees(income)} hint="rounding, forfeits, closed accounts" />
          <Kpi label="Closing wallets" value={rupees(s.closing_balance)} hint={isCurrent ? `wallets now ${rupees(s.wallets_now)}` : "owed at month end"}
            tone={isCurrent && s.closing_balance !== s.wallets_now ? "red" : undefined} />
        </div>
      )}

      <button onClick={() => setTab("checks")} className={cn("w-full text-left rounded-xl border px-4 py-3 text-sm flex items-center gap-2",
        failing.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-800")}>
        {failing.length ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
        {failing.length
          ? <span><strong>{failing.length} check{failing.length === 1 ? "" : "s"} need attention:</strong> {failing.map((c) => `${c.label} (${c.count})`).join(" · ")}</span>
          : "All reconciliation checks pass."}
      </button>

      <div className="flex gap-1 overflow-x-auto border-b border-[#e2e8d5]">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn("flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px",
              tab === key ? "border-[#1B5E20] text-[#1B5E20]" : "border-transparent text-gray-500 hover:text-gray-800")}>
            <Icon className="w-4 h-4" /> {label}
            {key === "checks" && failing.length > 0 && <span className="ml-1 rounded-full bg-amber-500 text-white text-[10px] px-1.5">{failing.length}</span>}
          </button>
        ))}
      </div>

      {tab === "summary" && s && <SummaryTab s={s} isCurrent={isCurrent} decisions={data.decisions} onCsv={() => downloadText(`${fileBase}-balance-decisions.csv`, csv.decisions())} />}
      {tab === "checks" && (
        <ChecksTab checks={data.checks} onCsv={() => downloadText(`${fileBase}-checks.csv`, csv.checks())}
          onProof={(r) => setProofFor({ id: r.payment_id, amount: r.amount, code: r.customer, name: r.name })}
          onSettle={(r) => setSettleFor({ userId: r.user_id, code: r.customer, name: r.name, balance: r.balance })} />
      )}
      {tab === "ledger" && <LedgerTab rows={data.ledger} onCsv={() => downloadText(`${fileBase}-ledger.csv`, csv.ledger())} />}
      {tab === "payments" && <PaymentsTab rows={data.payments} onCsv={() => downloadText(`${fileBase}-payments.csv`, csv.payments())} onProof={(p) => setProofFor(p)} />}
      {tab === "refunds" && <RefundsTab rows={data.refunds} onCsv={() => downloadText(`${fileBase}-refunds.csv`, csv.refunds())} />}
      {tab === "rewards" && (
        <RewardsTab gifts={data.gifts} referrals={data.referrals}
          onGiftsCsv={() => downloadText(`${fileBase}-gifts.csv`, csv.gifts())}
          onReferralsCsv={() => downloadText(`${fileBase}-referrals.csv`, csv.referrals())} />
      )}
      {tab === "coupons" && <CouponsTab rows={data.couponUses} onCsv={() => downloadText(`${fileBase}-coupons.csv`, csv.coupons())} />}
      {tab === "balances" && <BalancesTab rows={data.balances} onCsv={() => downloadText(`${fileBase}-balances.csv`, csv.balances())} />}
      {tab === "archive" && <ArchiveTab rows={data.archives} onCsv={() => downloadText(`${fileBase}-deleted-accounts.csv`, csv.archive())} />}

      {proofFor && (
        <ProofDialog
          target={proofFor}
          pending={pending}
          onClose={() => setProofFor(null)}
          onSave={(proof) => secure(`Add proof to ${proofFor.code}'s ${rupees(proofFor.amount)} payment.`, (pw) => addPaymentProof(proofFor.id, proof, pw), () => setProofFor(null))}
        />
      )}
      {settleFor && (
        <SettleDialog
          target={settleFor}
          payments={data.refundable[settleFor.userId] ?? []}
          pending={pending}
          onClose={() => setSettleFor(null)}
          onSave={(v) => secure(`Settle ${settleFor.code}'s ${rupees(settleFor.balance)} balance: ${DECISION[v.decision] ?? v.decision}.`,
            (pw) => settleCustomerBalance(settleFor.userId, toSettleInput(v), pw), () => setSettleFor(null))}
        />
      )}

      {toast && (
        <div className={cn("fixed bottom-6 right-6 z-[60] max-w-sm rounded-xl px-4 py-3 text-sm shadow-lg flex items-start gap-2",
          toast.ok ? "bg-[#1B5E20] text-white" : "bg-red-600 text-white")}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />} {toast.text}
        </div>
      )}
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "amber" | "red" }) {
  return (
    <div className="rounded-2xl border border-[#e2e8d5] bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={cn("text-lg font-bold mt-1", tone === "green" ? "text-[#1B5E20]" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-600" : "text-[#1A1A1A]")}>{value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

function Toolbar({ children, onCsv, count }: { children?: React.ReactNode; onCsv: () => void; count: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <span className="text-xs text-gray-400 ml-auto">{count} row{count === 1 ? "" : "s"}</span>
      <button onClick={onCsv} className="h-9 px-3 rounded-lg border border-[#e2e8d5] bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5">
        <Download className="w-4 h-4" /> CSV
      </button>
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search…" className={`${inputCls} pl-9 w-56`} />
    </div>
  )
}

function Table({ head, children, empty }: { head: (string | { label: string; right?: boolean })[]; children: React.ReactNode; empty: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e2e8d5] overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[#F9FBF7] text-xs text-gray-500">
          <tr>
            {head.map((h, i) => {
              const label = typeof h === "string" ? h : h.label
              const right = typeof h !== "string" && h.right
              return <th key={i} className={cn("font-medium px-4 py-2.5 whitespace-nowrap", right ? "text-right" : "text-left")}>{label}</th>
            })}
          </tr>
        </thead>
        <tbody>
          {empty ? <tr><td colSpan={head.length} className="px-4 py-10 text-center text-gray-400">Nothing here for this month.</td></tr> : children}
        </tbody>
      </table>
    </div>
  )
}

const Td = ({ children, right, muted, wrap }: { children: React.ReactNode; right?: boolean; muted?: boolean; wrap?: boolean }) => (
  <td className={cn("px-4 py-2.5 border-t border-[#eef2e8] align-top", right && "text-right", muted && "text-gray-500", !wrap && "whitespace-nowrap")}>{children}</td>
)

const Who = ({ code, name }: { code: string; name: string }) => (
  <span><span className="font-mono text-xs text-gray-500">{code}</span> {name}</span>
)

const match = (q: string, ...xs: (string | number | null | undefined)[]) => {
  const s = q.trim().toLowerCase()
  return !s || xs.some((x) => x !== null && x !== undefined && String(x).toLowerCase().includes(s))
}

function SummaryTab({ s, isCurrent, decisions, onCsv }: { s: Summary; isCurrent: boolean; decisions: DecisionRow[]; onCsv: () => void }) {
  const ties = s.opening_balance + s.credits - s.debits === s.closing_balance
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Wallet movement</h3>
        <Table head={["", { label: "Amount", right: true }]} empty={false}>
          <tr><Td>Opening balance (owed to customers)</Td><Td right>{rupees(s.opening_balance)}</Td></tr>
          <tr><Td>+ Credits</Td><Td right>{rupees(s.credits)}</Td></tr>
          <tr><Td>− Debits</Td><Td right>{rupees(s.debits)}</Td></tr>
          <tr><Td><strong>= Closing balance</strong></Td><Td right><strong>{rupees(s.closing_balance)}</strong></Td></tr>
          {isCurrent && <tr><Td muted>Wallets right now</Td><Td right muted>{rupees(s.wallets_now)} {s.wallets_now === s.closing_balance ? "✓" : "≠"}</Td></tr>}
        </Table>
        {!ties && <p className="text-xs text-red-600">Opening + credits − debits doesn&apos;t equal closing — see Checks.</p>}

        <h3 className="text-sm font-semibold pt-2">Money received (by the day it was paid)</h3>
        <Table head={["Method", "Source", { label: "Payments", right: true }, { label: "Amount", right: true }, { label: "Cash", right: true }, { label: "UPI", right: true }]} empty={s.payments.length === 0}>
          {s.payments.map((p, i) => (
            <tr key={i}><Td>{methodLabel(p.method)}</Td><Td>{sourceLabel(p.source)}</Td><Td right>{p.count}</Td><Td right>{rupees(p.amount)}</Td><Td right muted>{rupees(p.cash)}</Td><Td right muted>{rupees(p.upi)}</Td></tr>
          ))}
        </Table>
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Ledger by category</h3>
        <Table head={["Category", { label: "Entries", right: true }, { label: "Amount", right: true }]} empty={s.by_category.length === 0}>
          {s.by_category.map((c) => (
            <tr key={c.type + c.category}>
              <Td><span className={cn("mr-2 text-[10px] font-semibold uppercase", c.type === "credit" ? "text-[#1B5E20]" : "text-red-600")}>{c.type === "credit" ? "in" : "out"}</span>{categoryLabel(c.category)}</Td>
              <Td right>{c.count}</Td><Td right>{rupees(c.amount)}</Td>
            </tr>
          ))}
        </Table>
        <Table head={["", { label: "Value", right: true }]} empty={false}>
          {s.refunds.map((r, i) => <tr key={i}><Td>Refunds — {r.kind}, {r.status}</Td><Td right>{r.count} · {rupees(r.amount)}</Td></tr>)}
          <tr><Td>Coupons used · discount given</Td><Td right>{s.coupons.count} · {rupees(s.coupons.discount)}</Td></tr>
          <tr><Td>Cash on delivery still to collect (now)</Td><Td right>{s.cod_outstanding.count} · {rupees(s.cod_outstanding.amount)}</Td></tr>
          <tr><Td>Accounts archived this month</Td><Td right>{s.archived_accounts}</Td></tr>
        </Table>
        <div className="flex items-center justify-between pt-2">
          <h3 className="text-sm font-semibold">Cancelled customers&apos; balances decided</h3>
          <button onClick={onCsv} className="text-xs text-[#1B5E20] hover:underline">CSV</button>
        </div>
        <Table head={["Date", "Customer", "Decision", { label: "Amount", right: true }, "Reason", "By"]} empty={decisions.length === 0}>
          {decisions.map((d) => (
            <tr key={d.id}><Td muted>{fmtDate(d.at)}</Td><Td><Who code={d.code} name={d.name} /></Td><Td>{DECISION[d.decision] ?? d.decision}</Td><Td right>{rupees(d.amount)}</Td><Td wrap>{d.reason}</Td><Td muted>{d.by ?? "—"}</Td></tr>
          ))}
        </Table>
      </div>
    </div>
  )
}

function ChecksTab({ checks, onCsv, onProof, onSettle }: {
  checks: Check[]; onCsv: () => void
  onProof: (r: Record<string, any>) => void; onSettle: (r: Record<string, any>) => void
}) {
  return (
    <div className="space-y-4">
      <Toolbar onCsv={onCsv} count={checks.length}>
        <p className="text-sm text-gray-500">Run on every load, over all records (not only this month).</p>
      </Toolbar>
      {checks.map((c) => (
        <div key={c.key} className={cn("rounded-2xl border bg-white", c.ok ? "border-[#e2e8d5]" : "border-amber-200")}>
          <div className="flex items-center gap-2 px-4 py-3">
            {c.ok ? <CheckCircle2 className="w-4 h-4 text-[#1B5E20]" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
            <span className="text-sm font-semibold">{c.label}</span>
            <span className="ml-auto text-xs text-gray-500">{c.ok ? "OK" : `${c.count} · ${rupees(c.amount)}`}</span>
          </div>
          {!c.ok && c.rows.length > 0 && (
            <div className="border-t border-[#eef2e8] overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {c.rows.map((r, i) => (
                    <tr key={i} className="border-t border-[#f2f5ee] first:border-t-0">
                      <td className="px-4 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{r.customer}</td>
                      <td className="px-4 py-2">{r.name ?? ""}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{rupees(r.amount ?? r.balance ?? 0)}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {[r.method && methodLabel(r.method), r.source && sourceLabel(r.source), r.status, r.problem, r.reason,
                          r.date && fmtDate(String(r.date)), r.since && `since ${fmtDate(String(r.since))}`, r.ledger !== undefined && `ledger ${rupees(r.ledger)}`,
                          r.reported && `reported ${fmtDateTime(String(r.reported))}`].filter(Boolean).join(" · ")}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {c.key === "missing_proof" && r.payment_id && (
                          <button onClick={() => onProof(r)} className="px-2.5 py-1 rounded-md bg-[#1B5E20] text-white text-xs font-medium hover:bg-[#155116]">Add proof</button>
                        )}
                        {c.key === "balances_to_settle" && r.user_id && (
                          <button onClick={() => onSettle(r)} className="px-2.5 py-1 rounded-md bg-[#1B5E20] text-white text-xs font-medium hover:bg-[#155116]">Settle</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {c.count > c.rows.length && <p className="px-4 py-2 text-xs text-gray-400">Showing {c.rows.length} of {c.count}.</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function LedgerTab({ rows, onCsv }: { rows: LedgerRow[]; onCsv: () => void }) {
  const [q, setQ] = useState("")
  const [cat, setCat] = useState("")
  const shown = useMemo(() => rows.filter((r) => (!cat || r.category === cat) && match(q, r.code, r.name, r.reason, r.reference, r.admin)), [rows, q, cat])
  const cats = [...new Set(rows.map((r) => r.category))]
  return (
    <div className="space-y-3">
      <Toolbar onCsv={onCsv} count={shown.length}>
        <SearchBox value={q} onChange={setQ} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
        <span className="text-xs text-gray-500">In {rupees(sumBy(shown.filter((r) => r.type === "credit"), (r) => r.amount))} · Out {rupees(sumBy(shown.filter((r) => r.type === "debit"), (r) => r.amount))}</span>
      </Toolbar>
      <Table head={["Date", "Customer", "Category", { label: "Amount", right: true }, "Reason", "Reference", "Admin"]} empty={shown.length === 0}>
        {shown.map((r) => (
          <tr key={r.id}>
            <Td muted>{fmtDateTime(r.at)}</Td>
            <Td><Who code={r.code} name={r.name} />{r.archived && <span className="ml-1.5 text-[10px] uppercase text-gray-400">archived</span>}</Td>
            <Td>{categoryLabel(r.category)}</Td>
            <Td right><span className={r.type === "credit" ? "text-[#1B5E20]" : "text-red-600"}>{r.type === "credit" ? "+" : "−"}{rupees(r.amount)}</span></Td>
            <Td wrap>{r.reason}</Td>
            <Td muted><span className="font-mono text-[11px]">{r.reference.length > 20 ? `${r.reference.slice(0, 20)}…` : r.reference}</span></Td>
            <Td muted>{r.admin ?? "—"}</Td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function PaymentsTab({ rows, onCsv, onProof }: { rows: PaymentRow[]; onCsv: () => void; onProof: (p: PaymentRow) => void }) {
  const [q, setQ] = useState("")
  const [source, setSource] = useState("")
  const [status, setStatus] = useState("received")
  const shown = useMemo(() => rows.filter((p) =>
    (status === "all" || (status === "received" ? ["paid", "refunded"].includes(p.status) : p.status === status)) &&
    (!source || p.source === source) && match(q, p.code, p.name, p.proof, p.cfOrderId, p.cfPaymentId, p.recordedBy)), [rows, q, source, status])
  const sources = [...new Set(rows.map((p) => p.source).filter(Boolean))] as string[]
  return (
    <div className="space-y-3">
      <Toolbar onCsv={onCsv} count={shown.length}>
        <SearchBox value={q} onChange={setQ} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          <option value="received">Received (paid / refunded)</option>
          <option value="created">Started, not paid</option>
          <option value="failed">Failed</option>
          <option value="all">All</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
          <option value="">Every source</option>
          {sources.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
        </select>
        <span className="text-xs text-gray-500">Total {rupees(sumBy(shown, (p) => p.amount))}</span>
      </Toolbar>
      <Table head={["Paid on", "Customer", { label: "Amount", right: true }, "How", "Source", "Proof", "Recorded by", "Status", ""]} empty={shown.length === 0}>
        {shown.map((p) => (
          <tr key={p.id}>
            <Td muted>{p.paidOn ? fmtDate(p.paidOn) : fmtDate(p.createdAt)}</Td>
            <Td><Who code={p.code} name={p.name} /></Td>
            <Td right>
              {rupees(p.amount)}
              {p.couponCode && <span className="block text-[11px] text-gray-400">{p.couponCode} −{rupees(p.discount)}</span>}
              {p.walletCarry > 0 && <span className="block text-[11px] text-gray-400">+{rupees(p.walletCarry)} wallet carried</span>}
            </Td>
            <Td>
              {methodLabel(p.method)}
              {p.method === "cash_upi" && <span className="block text-[11px] text-gray-400">cash {rupees(p.cash)} · UPI {rupees(p.upi)}</span>}
            </Td>
            <Td>
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full",
                p.source?.startsWith("app") ? "bg-blue-50 text-blue-700" : p.source?.includes("cod") ? "bg-amber-50 text-amber-800" : "bg-purple-50 text-purple-700")}>
                {sourceLabel(p.source)}
              </span>
            </Td>
            <Td muted wrap>
              {p.method === "cashfree" ? <span className="font-mono text-[11px]">{p.cfPaymentId ?? p.cfOrderId}</span>
                : p.method === "unrecorded" ? <span className="text-red-600 text-xs">No proof</span>
                : <span className="text-xs">{p.proof}{p.proofAddedAt && <span className="block text-[10px] text-gray-400">added {fmtDate(p.proofAddedAt)}</span>}</span>}
              {p.note && <span className="block text-[11px] text-gray-400">{p.note}</span>}
            </Td>
            <Td muted>{p.recordedBy ?? (p.method === "cashfree" ? "Cashfree" : "—")}</Td>
            <Td>
              <span className="text-xs">{p.status}</span>
              {["paid", "refunded"].includes(p.status) && !p.credited && <span className="block text-[11px] text-red-600">not in wallet</span>}
            </Td>
            <Td>{p.method === "unrecorded" && <button onClick={() => onProof(p)} className="px-2.5 py-1 rounded-md bg-[#1B5E20] text-white text-xs font-medium hover:bg-[#155116]">Add proof</button>}</Td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function RefundsTab({ rows, onCsv }: { rows: RefundRow[]; onCsv: () => void }) {
  const [q, setQ] = useState("")
  const shown = rows.filter((r) => match(q, r.code, r.name, r.reason, r.proof, r.by))
  return (
    <div className="space-y-3">
      <Toolbar onCsv={onCsv} count={shown.length}>
        <SearchBox value={q} onChange={setQ} />
        <Link href="/rewards" className="text-sm text-[#1B5E20] hover:underline">Make a refund →</Link>
      </Toolbar>
      <Table head={["Date", "Customer", "Kind", { label: "Amount", right: true }, "Status", "Reason", "Reference", "By"]} empty={shown.length === 0}>
        {shown.map((r) => (
          <tr key={r.id}>
            <Td muted>{fmtDateTime(r.at)}</Td><Td><Who code={r.code} name={r.name} /></Td>
            <Td>{r.kind === "wallet" ? "To wallet" : r.kind === "bank" ? "To bank (Cashfree)" : `Outside Cashfree${r.method ? ` — ${methodLabel(r.method)}` : ""}`}</Td>
            <Td right>{rupees(r.amount)}</Td>
            <Td>{r.status}{r.failureNote && <span className="block text-[11px] text-red-600">{r.failureNote}</span>}</Td>
            <Td wrap>{r.reason}</Td><Td muted>{r.proof ?? "—"}</Td><Td muted>{r.by ?? "—"}</Td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function RewardsTab({ gifts, referrals, onGiftsCsv, onReferralsCsv }: { gifts: GiftRow[]; referrals: ReferralRow[]; onGiftsCsv: () => void; onReferralsCsv: () => void }) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Toolbar onCsv={onGiftsCsv} count={gifts.length}>
          <h3 className="text-sm font-semibold">Gift meals — {rupees(sumBy(gifts, (g) => g.amount))}</h3>
          <Link href="/rewards" className="text-sm text-[#1B5E20] hover:underline">Gift meals →</Link>
        </Toolbar>
        <Table head={["Date", "Customer", { label: "Meals", right: true }, { label: "Meal worth", right: true }, { label: "Amount", right: true }, "Reason", "By"]} empty={gifts.length === 0}>
          {gifts.map((g) => (
            <tr key={g.id}><Td muted>{fmtDateTime(g.at)}</Td><Td><Who code={g.code} name={g.name} /></Td><Td right>{g.meals}</Td><Td right muted>{rupees(g.mealCost)}</Td><Td right>{rupees(g.amount)}</Td><Td wrap>{g.reason}</Td><Td muted>{g.by ?? "—"}</Td></tr>
          ))}
        </Table>
      </div>
      <div className="space-y-3">
        <Toolbar onCsv={onReferralsCsv} count={referrals.length}>
          <h3 className="text-sm font-semibold">Referral rewards — {rupees(sumBy(referrals, (r) => r.reward))}</h3>
        </Toolbar>
        <Table head={["Date", "Referrer", "Friend", "Status", { label: "Reward", right: true }]} empty={referrals.length === 0}>
          {referrals.map((r) => (
            <tr key={r.id}><Td muted>{fmtDateTime(r.at)}</Td><Td><Who code={r.referrer} name={r.referrerName} /></Td><Td><Who code={r.friend} name={r.friendName} /></Td>
              <Td>{r.status}{r.rejectReason && <span className="block text-[11px] text-gray-400">{r.rejectReason}</span>}</Td><Td right>{rupees(r.reward)}</Td></tr>
          ))}
        </Table>
      </div>
    </div>
  )
}

function CouponsTab({ rows, onCsv }: { rows: CouponUseRow[]; onCsv: () => void }) {
  return (
    <div className="space-y-3">
      <Toolbar onCsv={onCsv} count={rows.length}>
        <h3 className="text-sm font-semibold">Discount given — {rupees(sumBy(rows, (r) => r.discount))}</h3>
        <Link href="/coupons" className="text-sm text-[#1B5E20] hover:underline">Coupons →</Link>
      </Toolbar>
      <Table head={["Date", "Customer", "Coupon", "Where", { label: "Meals", right: true }, { label: "Meal price", right: true }, { label: "Regular", right: true }, { label: "Discount", right: true }]} empty={rows.length === 0}>
        {rows.map((c) => (
          <tr key={c.id}><Td muted>{fmtDateTime(c.at)}</Td><Td><Who code={c.code} name={c.name} /></Td><Td><span className="font-mono text-xs">{c.coupon}</span></Td><Td muted>{c.kind}</Td>
            <Td right>{c.meals}</Td><Td right>{rupees(c.price)}</Td><Td right muted>{rupees(c.regular)}</Td><Td right>{rupees(c.discount)}</Td></tr>
        ))}
      </Table>
    </div>
  )
}

function BalancesTab({ rows, onCsv }: { rows: BalanceRow[]; onCsv: () => void }) {
  const [q, setQ] = useState("")
  const [only, setOnly] = useState<"all" | "no_plan" | "cash_due" | "negative">("all")
  const shown = rows.filter((b) =>
    (only === "all" || (only === "no_plan" ? !b.plan : only === "cash_due" ? b.cashDue > 0 : b.balance < 0)) && match(q, b.code, b.name, b.phone))
  return (
    <div className="space-y-3">
      <Toolbar onCsv={onCsv} count={shown.length}>
        <SearchBox value={q} onChange={setQ} />
        <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} className={inputCls}>
          <option value="all">Every wallet with money</option>
          <option value="no_plan">No live plan (held for them)</option>
          <option value="cash_due">Cash still due</option>
          <option value="negative">Below zero</option>
        </select>
        <span className="text-xs text-gray-500">Total {rupees(sumBy(shown, (b) => b.balance))} · as of now</span>
      </Toolbar>
      <Table head={["Customer", "Phone", { label: "Wallet", right: true }, "Plan", { label: "Meals left", right: true }, { label: "Cash due", right: true }, "Last change"]} empty={shown.length === 0}>
        {shown.map((b) => (
          <tr key={b.userId}>
            <Td><Who code={b.code} name={b.name} /></Td>
            <Td muted>{b.phone}</Td>
            <Td right><span className={b.balance < 0 ? "text-red-600" : ""}>{rupees(b.balance)}</span></Td>
            <Td>{b.plan ? `${b.plan} · ${b.planStatus}` : <span className="text-amber-700 text-xs">No live plan</span>}</Td>
            <Td right muted>{b.mealsLeft ?? "—"}</Td>
            <Td right>{b.cashDue > 0 ? <>{rupees(b.cashDue)}{b.onCredit && <span className="block text-[10px] text-gray-400">on credit</span>}</> : "—"}</Td>
            <Td muted>{fmtDateTime(b.updatedAt)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function ArchiveTab({ rows, onCsv }: { rows: ArchiveRow[]; onCsv: () => void }) {
  return (
    <div className="space-y-3">
      <Toolbar onCsv={onCsv} count={rows.length}>
        <p className="text-sm text-gray-500">Deleted or reset accounts. Their payments and ledger are kept in the archive and still count in the month&apos;s totals.</p>
      </Toolbar>
      <Table head={["Archived", "Customer", "Phone", "Why", { label: "Balance at close", right: true }, { label: "Closed", right: true }, { label: "Records", right: true }, "By"]} empty={rows.length === 0}>
        {rows.map((a) => (
          <tr key={a.id}><Td muted>{fmtDateTime(a.at)}</Td><Td><Who code={a.code} name={a.name} /></Td><Td muted>{a.phone}</Td><Td>{ARCHIVE_REASON[a.reason] ?? a.reason}</Td>
            <Td right>{rupees(a.balance)}</Td><Td right>{rupees(a.forfeited)}</Td><Td right muted>{a.rows}</Td><Td muted>{a.by ?? "—"}</Td></tr>
        ))}
      </Table>
    </div>
  )
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ProofDialog({ target, pending, onClose, onSave }: {
  target: { id: string; amount: number; code: string; name: string }
  pending: boolean
  onClose: () => void
  onSave: (p: ProofInput) => void
}) {
  const [proof, setProof] = useState<ProofInput>(emptyProof)
  const problem = proof.method === "cash_upi" ? "For an older cash + UPI payment, pick the main method and write the split in the reference." : proofProblem(proof, target.amount)
  return (
    <DialogShell title="Add proof to a payment" onClose={onClose}>
      <p className="text-sm text-gray-600">{target.code} {target.name} · {rupees(target.amount)} — recorded before the audit without proof. This can be done once; the amount can&apos;t change.</p>
      <PaymentProofFields value={proof} onChange={setProof} amountPaise={target.amount} />
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-[#e2e8d5] text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
        <button disabled={pending || !!problem} onClick={() => onSave(proof)} className="flex-1 h-10 rounded-xl bg-[#1B5E20] text-sm font-medium text-white hover:bg-[#155116] disabled:opacity-40">Save proof</button>
      </div>
      {problem && proof.method === "cash_upi" && <p className="text-xs text-amber-700">{problem}</p>}
    </DialogShell>
  )
}

function SettleDialog({ target, payments, pending, onClose, onSave }: {
  target: { userId: string; code: string; name: string; balance: number }
  payments: RefundablePayment[]
  pending: boolean
  onClose: () => void
  onSave: (v: SettleValue) => void
}) {
  const [v, setV] = useState<SettleValue>(emptySettle)
  const problem = settleProblem(v, target.balance, payments)
  return (
    <DialogShell title={`Settle ${target.code}'s balance`} onClose={onClose}>
      <p className="text-sm text-gray-600">{target.name} has no live plan.</p>
      <SettleBalanceFields value={v} onChange={setV} balance={target.balance} payments={payments} />
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-[#e2e8d5] text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
        <button disabled={pending || !!problem} onClick={() => onSave(v)} className="flex-1 h-10 rounded-xl bg-[#1B5E20] text-sm font-medium text-white hover:bg-[#155116] disabled:opacity-40">Save decision</button>
      </div>
    </DialogShell>
  )
}
