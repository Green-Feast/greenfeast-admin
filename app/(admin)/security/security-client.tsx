"use client"

import { useMemo, useState, useTransition } from "react"
import { Download, KeyRound, Lock, Search, ShieldCheck } from "lucide-react"
import { MonthPicker, downloadText } from "@/components/month-picker"
import { fmtDateTime, rupees, toCsv, paiseToRupeesNumber } from "@/lib/money-labels"
import { istToday } from "@/lib/ist"
import { setActionPassword } from "./actions"

export type LogRow = {
  id: string
  at: string
  admin: string
  action: string
  sensitive: boolean
  outcome: "ok" | "error" | "denied"
  error: string | null
  customer: string | null
  ref: string | null
  amount: number | null
  details: Record<string, unknown>
}

const inputCls = "w-full h-10 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"

const OUTCOME = {
  ok: "bg-green-50 text-green-700",
  error: "bg-amber-50 text-amber-700",
  denied: "bg-red-50 text-red-700",
} as const

function detailsText(d: Record<string, unknown>) {
  return Object.entries(d)
    .filter(([k]) => k !== "ip" && k !== "user_agent")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
}

export function SecurityClient({ month, passwordSet, passwordSetAt, lockedUntil, log }: {
  month: string
  passwordSet: boolean
  passwordSetAt: string | null
  lockedUntil: string | null
  log: LogRow[]
}) {
  const [login, setLogin] = useState("")
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const [q, setQ] = useState("")
  const [only, setOnly] = useState<"all" | "sensitive" | "problems">("all")

  const save = () => {
    if (next !== confirm) { setMsg({ ok: false, text: "The new passwords don't match." }); return }
    start(async () => {
      const res = await setActionPassword(login, current, next)
      setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error })
      if (res.ok) { setLogin(""); setCurrent(""); setNext(""); setConfirm("") }
    })
  }

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return log.filter((r) =>
      (only === "all" || (only === "sensitive" ? r.sensitive : r.outcome !== "ok")) &&
      (!s || [r.admin, r.action, r.customer, r.ref, r.error, detailsText(r.details)].some((x) => x?.toLowerCase().includes(s)))
    )
  }, [log, q, only])

  const exportCsv = () => {
    downloadText(`greenfeast-admin-log-${month}.csv`, toCsv(
      ["Time (IST)", "Admin", "Action", "Sensitive", "Password checked", "Outcome", "Error", "Customer", "Reference", "Amount (₹)", "Details", "IP"],
      rows.map((r) => [fmtDateTime(r.at), r.admin, r.action, r.sensitive ? "yes" : "", r.sensitive && r.outcome !== "denied" ? "yes" : "",
        r.outcome, r.error, r.customer, r.ref, r.amount === null ? "" : paiseToRupeesNumber(r.amount), detailsText(r.details), String(r.details.ip ?? "")])
    ))
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Security & admin log</h1>
        <p className="text-sm text-gray-500 mt-1">
          Every admin action is recorded here permanently. Money and account actions ask for your action password first.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#e2e8d5] p-5 space-y-4 max-w-xl">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[#1B5E20]" />
          <h2 className="text-sm font-semibold">Your action password</h2>
          <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${passwordSet ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
            {passwordSet ? `Set ${passwordSetAt ? fmtDateTime(passwordSetAt) : ""}` : "Not set — sensitive actions are blocked"}
          </span>
        </div>
        {lockedUntil && (
          <p className="text-xs text-red-600 flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Locked after wrong tries until {fmtDateTime(lockedUntil)}.</p>
        )}
        <p className="text-xs text-gray-500">
          A second password, different from your login, asked before: recording payments and cash on delivery, activating or onboarding a plan with money,
          gifts, refunds, settling a cancelled customer&apos;s balance, undoing a delivery, and resetting or deleting a customer. 5 wrong tries lock it for 15 minutes.
        </p>
        <div className="grid gap-3">
          <input type="password" autoComplete="current-password" placeholder="Your login password" value={login} onChange={(e) => setLogin(e.target.value)} className={inputCls} />
          {passwordSet && (
            <input type="password" autoComplete="off" placeholder="Current action password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} />
          )}
          <input type="password" autoComplete="new-password" placeholder="New action password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} />
          <input type="password" autoComplete="new-password" placeholder="Repeat the new action password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>}
        <button
          onClick={save}
          disabled={pending || !login || !next || !confirm || (passwordSet && !current)}
          className="h-10 px-5 rounded-xl bg-[#1B5E20] text-sm font-medium text-white hover:bg-[#155116] disabled:opacity-40"
        >
          {pending ? "Saving…" : passwordSet ? "Change action password" : "Set action password"}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#1B5E20]" /> Admin log</h2>
          <MonthPicker month={month} max={istToday().slice(0, 7)} />
          <div className="inline-flex rounded-xl border border-[#e2e8d5] bg-white p-1 text-xs">
            {(["all", "sensitive", "problems"] as const).map((k) => (
              <button key={k} onClick={() => setOnly(k)} className={`px-3 py-1.5 rounded-lg font-medium ${only === k ? "bg-[#1B5E20] text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                {k === "all" ? "All" : k === "sensitive" ? "Sensitive" : "Denied / failed"}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search admin, action, customer…" className={`${inputCls} pl-9 w-64`} />
          </div>
          <button onClick={exportCsv} className="h-10 px-4 rounded-xl border border-[#e2e8d5] bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
        <div className="bg-white rounded-2xl border border-[#e2e8d5] overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F9FBF7] text-xs text-gray-500">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">Time</th>
                <th className="text-left font-medium px-4 py-2.5">Admin</th>
                <th className="text-left font-medium px-4 py-2.5">Action</th>
                <th className="text-left font-medium px-4 py-2.5">Customer</th>
                <th className="text-right font-medium px-4 py-2.5">Amount</th>
                <th className="text-left font-medium px-4 py-2.5">Result</th>
                <th className="text-left font-medium px-4 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Nothing logged in this view.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[#eef2e8] align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">{fmtDateTime(r.at)}</td>
                  <td className="px-4 py-2.5 text-gray-700">{r.admin}</td>
                  <td className="px-4 py-2.5 font-medium text-[#1A1A1A] whitespace-nowrap">
                    {r.action}
                    {r.sensitive && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#1B5E20] bg-green-50 px-1.5 py-0.5 rounded">sensitive</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{r.customer ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{r.amount === null ? "—" : rupees(r.amount)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${OUTCOME[r.outcome]}`}>{r.outcome}</span>
                    {r.error && <p className="text-xs text-gray-500 mt-1 max-w-[16rem]">{r.error}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[22rem] break-words">{detailsText(r.details) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
