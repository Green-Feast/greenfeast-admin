"use client"

import { useState, useMemo, useEffect, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Search, X, Phone, Mail, Calendar, Plus, Trash2,
  RotateCcw, Pencil, ExternalLink, ChevronLeft, ChevronRight,
  AlertCircle, CheckCircle, ShieldAlert, UserPlus, Copy, FlaskConical, BadgeCheck, KeyRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { isPlanFinished } from "@/lib/plan-status"
import { istToday, istHour, addDaysISO, SLOT_CUTOFF_HOUR } from "@/lib/ist"
import {
  createSubscription, resetUserData, deleteUser, editUserProfile,
  setUserTestFlag, createCustomerAccount, generateCustomerPassword,
} from "./actions"
import type { CreateSubInput, NewCustomer } from "./types"

// ─── Types ───────────────────────────────────────────────────────────────────

export type UserRow = {
  id: string
  email: string | null
  name: string | null
  customerCode: string | null
  isTest: boolean
  phone: string | null
  provider: string
  joinedAt: string | null
  lastSignIn: string | null
  hasPublicRow: boolean
  onboarded: boolean
  subscriptionId: string | null
  subStatus: string | null
  planName: string | null
  deliveriesRemaining: number | null
  paymentMethod: string | null
}

export type AddonOption = { id: string; name: string; price_per_meal: number }
export type CouponOption = { id: string; code: string; name: string | null; prices: Record<string, number> }

export type Plan = {
  id: string
  name: string
  meals_total: number
  days_per_week: number
  base_price: number
  allow_cod?: boolean // false = the app doesn't offer cash on delivery (067)
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const PAGE_SIZE = 15

function fmtDate(s: string | null) {
  if (!s) return "—"
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

function fmtRupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`
}

const SUB_STATUS_CLS: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  paused: "bg-yellow-100 text-yellow-700 border-yellow-200",
  pending: "bg-orange-100 text-orange-700 border-orange-200",
  cancelled: "bg-red-100 text-red-600 border-red-200",
  expired: "bg-red-100 text-red-600 border-red-200",
}

function tierOf(u: UserRow): { key: string; label: string; cls: string } {
  if (isPlanFinished(u.subStatus, u.deliveriesRemaining)) {
    return { key: "finished", label: "Finished", cls: "bg-slate-100 text-slate-600 border-slate-200" }
  }
  if (u.subStatus) {
    return {
      key: u.subStatus,
      label: u.subStatus.charAt(0).toUpperCase() + u.subStatus.slice(1),
      cls: SUB_STATUS_CLS[u.subStatus] ?? "bg-gray-100 text-gray-600 border-gray-200",
    }
  }
  if (u.hasPublicRow) return { key: "onboarded", label: "Onboarded", cls: "bg-blue-50 text-blue-700 border-blue-200" }
  return { key: "signed_in", label: "Signed in", cls: "bg-gray-100 text-gray-500 border-gray-200" }
}

function providerLabel(p: string) {
  if (p === "google") return "Google"
  if (p === "phone") return "Phone"
  return p.charAt(0).toUpperCase() + p.slice(1)
}

const FILTERS = ["All", "Signed in", "Onboarded", "Active", "Paused", "Finished", "Pending", "Cancelled", "Expired"]

function matchesFilter(u: UserRow, filter: string) {
  if (filter === "All") return true
  if (filter === "Signed in") return !u.hasPublicRow
  if (filter === "Onboarded") return u.hasPublicRow && !u.subStatus
  return tierOf(u).key === filter.toLowerCase()
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function UsersClient({
  initialUsers, plans, addons, coupons, loadError, isTestMode,
}: {
  isTestMode: boolean
  initialUsers: UserRow[]
  plans: Plan[]
  addons: AddonOption[]
  coupons: CouponOption[]
  loadError: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("All")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<UserRow | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newPassword, setNewPassword] = useState<NewPassword | null>(null)

  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null)

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3200)
  }

  function closeModals() {
    setCreateOpen(false); setEditOpen(false); setResetOpen(false); setDeleteOpen(false)
  }

  // Run a server action, surface its result, refresh the table.
  function run(
    fn: () => Promise<{ ok: boolean; error?: string } | void>,
    successMsg: string,
    opts: { closePanel?: boolean } = {}
  ) {
    startTransition(async () => {
      const res = await fn()
      if (res && res.ok === false) {
        showToast("error", res.error ?? "Something went wrong.")
        return
      }
      router.refresh()
      showToast("success", successMsg)
      closeModals()
      if (opts.closePanel) setSelected(null)
    })
  }

  const counts = useMemo(() => {
    let signedIn = 0, onboarded = 0, active = 0
    for (const u of initialUsers) {
      if (!u.hasPublicRow) signedIn++
      else if (!u.subStatus) onboarded++
      if (tierOf(u).key === "active") active++
    }
    return { total: initialUsers.length, signedIn, onboarded, active }
  }, [initialUsers])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return initialUsers.filter((u) => {
      if (!matchesFilter(u, filter)) return false
      if (!q) return true
      return (
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.phone ?? "").includes(q) ||
        (u.customerCode ?? "").toLowerCase().includes(q)
      )
    })
  }, [initialUsers, search, filter])

  useEffect(() => { setPage(1) }, [search, filter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {counts.total} total · {counts.active} active · {counts.onboarded} onboarded · {counts.signedIn} signed-in only
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 h-9 px-4 rounded-lg bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Add customer
        </button>
      </div>

      {loadError && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          Couldn&apos;t load auth accounts — check the service-role key. Showing app data only.
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search name, email, phone or GF-code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#e2e8d5] bg-white text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] transition-colors placeholder:text-gray-400"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
        >
          {FILTERS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        {(search || filter !== "All") && (
          <button
            onClick={() => { setSearch(""); setFilter("All") }}
            className="h-9 px-3 text-sm text-gray-500 hover:text-[#1B5E20] flex items-center gap-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#e2e8d5] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                {["Name", "Contact", "Provider", "Status", "Plan", "Joined", ""].map((h, i) => (
                  <th key={i} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                    No users match your filters.
                  </td>
                </tr>
              ) : (
                paginated.map((u, i) => {
                  const tier = tierOf(u)
                  return (
                    <tr
                      key={u.id}
                      className={cn(
                        "border-b border-[#e2e8d5] last:border-0 hover:bg-[#F9FBF7] transition-colors cursor-pointer",
                        i % 2 === 1 && "bg-[#fafcf8]"
                      )}
                      onClick={() => setSelected(u)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="font-medium text-[#1A1A1A]">{u.name ?? "—"}</p>
                        {u.customerCode && <p className="font-mono text-xs text-gray-400">{u.customerCode}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {u.email ?? (u.phone ? `+91 ${u.phone}` : "—")}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{providerLabel(u.provider)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", tier.cls)}>
                          {tier.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.planName ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(u.joinedAt)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <span className="text-xs font-medium text-[#1B5E20]">View →</span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

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
              <span className="text-xs text-gray-500 px-2">{page} / {totalPages}</span>
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

      {/* Detail slide-over */}
      {selected && (
        <DetailPanel
          user={selected}
          isPending={isPending}
          onClose={() => setSelected(null)}
          onCreate={() => setCreateOpen(true)}
          onEdit={() => setEditOpen(true)}
          onReset={() => setResetOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onNewPassword={() => {
            if (!window.confirm(`Give ${selected.name ?? "this customer"} a new password? Their old password stops working; Google / Apple sign-in still works. You'll see the new one once, to send them.`)) return
            startTransition(async () => {
              const res = await generateCustomerPassword(selected.id)
              if (!res.ok) return showToast("error", res.error)
              setNewPassword(res)
            })
          }}
          onToggleTest={() => {
            const toTest = !selected.isTest
            if (!window.confirm(toTest
              ? `Move ${selected.name ?? "this account"} to Test? It disappears from Live — kitchen sheets, deliveries, money and broadcasts.`
              : `Move ${selected.name ?? "this account"} to Live? It becomes a real customer${selected.customerCode?.startsWith("GT-") ? " and gets a GF- customer ID" : ""}.`)) return
            run(() => setUserTestFlag(selected.id, toTest), toTest ? "Moved to Test." : "Moved to Live.", { closePanel: true })
          }}
        />
      )}

      {newPassword && <NewPasswordModal result={newPassword} onClose={() => setNewPassword(null)} />}

      {addOpen && (
        <AddCustomerModal
          isTestMode={isTestMode}
          onClose={() => setAddOpen(false)}
          onSetUpPlan={(c) => {
            setAddOpen(false)
            setSelected({
              id: c.id, email: c.email, name: c.name, customerCode: c.customerCode, isTest: isTestMode,
              phone: c.phone, provider: "email", joinedAt: new Date().toISOString(), lastSignIn: null,
              hasPublicRow: true, onboarded: false, subscriptionId: null, subStatus: null, planName: null,
              deliveriesRemaining: null, paymentMethod: null,
            } as UserRow)
            setCreateOpen(true)
            router.refresh()
          }}
        />
      )}

      {/* Modals */}
      {createOpen && selected && (
        <CreateSubModal
          user={selected}
          plans={plans}
          addons={addons}
          coupons={coupons}
          isPending={isPending}
          onClose={() => setCreateOpen(false)}
          onSubmit={(input) => run(() => createSubscription(input), "Subscription created.", { closePanel: true })}
        />
      )}

      {editOpen && selected && (
        <EditProfileModal
          user={selected}
          isPending={isPending}
          onClose={() => setEditOpen(false)}
          onSubmit={(name, phone) => run(() => editUserProfile(selected.id, name, phone), "Profile updated.")}
        />
      )}

      {resetOpen && selected && (
        <ConfirmModal
          title="Reset this user's data?"
          body="Their subscription, orders, dietary profile, address and wallet will be deleted, and onboarding reset. Their login stays intact so you can re-test flows."
          confirmLabel="Reset data"
          danger
          isPending={isPending}
          onClose={() => setResetOpen(false)}
          onConfirm={() => run(() => resetUserData(selected.id), "User data reset.", { closePanel: true })}
        />
      )}

      {deleteOpen && selected && (
        <ConfirmModal
          title="Delete this user completely?"
          body="This permanently removes their login and ALL their data. This cannot be undone."
          confirmLabel="Delete user"
          danger
          isPending={isPending}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => run(() => deleteUser(selected.id), "User deleted.", { closePanel: true })}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white",
          toast.type === "success" ? "bg-[#1B5E20]" : "bg-red-600"
        )}>
          {toast.type === "success" ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ─── Detail slide-over ─────────────────────────────────────────────────────────

function DetailPanel({
  user, isPending, onClose, onCreate, onEdit, onReset, onDelete, onToggleTest, onNewPassword,
}: {
  user: UserRow
  isPending: boolean
  onClose: () => void
  onCreate: () => void
  onEdit: () => void
  onReset: () => void
  onDelete: () => void
  onToggleTest: () => void
  onNewPassword: () => void
}) {
  const tier = tierOf(user)

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-[#e2e8d5] bg-[#F9FBF7]">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-[#1A1A1A]">{user.name ?? "Unnamed user"}</h2>
              <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", tier.cls)}>
                {tier.label}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {providerLabel(user.provider)} account{user.customerCode ? ` · ${user.customerCode}` : ""}
              {user.isTest && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[#FDD835] text-[#1A1A1A] text-[10px] font-bold">TEST</span>}
            </p>
          </div>
          <button onClick={onClose} className="ml-2 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <Section title="Identity">
            {user.email && (
              <Row icon={<Mail className="w-3.5 h-3.5" />} label="Email">
                <span className="text-[#1A1A1A]">{user.email}</span>
              </Row>
            )}
            <Row icon={<Phone className="w-3.5 h-3.5" />} label="Phone">
              {user.phone ? (
                <a href={`tel:+91${user.phone}`} className="text-[#1B5E20] hover:underline font-medium">+91 {user.phone}</a>
              ) : <span className="text-gray-400">—</span>}
            </Row>
            <Row icon={<Calendar className="w-3.5 h-3.5" />} label="Joined">
              <span className="text-[#1A1A1A]">{fmtDate(user.joinedAt)}</span>
            </Row>
            <Row label="Last sign-in"><span className="text-gray-600">{fmtDate(user.lastSignIn)}</span></Row>
            <Row label="Onboarded"><span className="text-gray-600">{user.onboarded ? "Yes" : "No"}</span></Row>
          </Section>

          <Section title="Subscription">
            {user.subStatus ? (
              <>
                <Row label="Plan"><span className="font-medium text-[#1A1A1A]">{user.planName ?? "—"}</span></Row>
                <Row label="Status"><span className="capitalize text-[#1A1A1A]">{isPlanFinished(user.subStatus, user.deliveriesRemaining) ? "finished" : user.subStatus}</span></Row>
                <Row label="Deliveries left"><span className="font-medium">{user.deliveriesRemaining ?? "—"}</span></Row>
                {user.paymentMethod && <Row label="Payment"><span className="uppercase text-gray-600">{user.paymentMethod}</span></Row>}
              </>
            ) : (
              <p className="text-sm text-gray-400">No subscription yet.</p>
            )}
          </Section>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-[#e2e8d5] bg-[#F9FBF7] space-y-2.5">
          {user.subStatus ? (
            user.subscriptionId && (
              <Link
                href={`/subscribers/${user.subscriptionId}`}
                className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium rounded-lg bg-[#1B5E20] text-white hover:bg-[#155116] transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Full profile
              </Link>
            )
          ) : (
            <button
              onClick={onCreate}
              disabled={isPending}
              className="flex items-center justify-center gap-1.5 w-full py-2.5 text-sm font-medium rounded-lg bg-[#1B5E20] text-white hover:bg-[#155116] disabled:opacity-40 transition-colors"
            >
              <Plus className="w-4 h-4" /> Create subscription
            </button>
          )}

          <div className="flex gap-2 pt-1">
            <PanelBtn color="gray" disabled={isPending} onClick={onEdit} icon={<Pencil className="w-3.5 h-3.5" />} label="Edit" />
            <PanelBtn color="gray" disabled={isPending} onClick={onReset} icon={<RotateCcw className="w-3.5 h-3.5" />} label="Reset" />
            <PanelBtn color="red" disabled={isPending} onClick={onDelete} icon={<Trash2 className="w-3.5 h-3.5" />} label="Delete" />
          </div>
          {user.email && (
            <button
              onClick={onNewPassword}
              disabled={isPending}
              className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium rounded-lg border border-[#1B5E20]/30 text-[#1B5E20] hover:bg-green-50 disabled:opacity-40 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" /> New password
            </button>
          )}
          <button
            onClick={onToggleTest}
            disabled={isPending}
            className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium rounded-lg border border-[#e2e8d5] text-gray-600 hover:bg-white disabled:opacity-40 transition-colors"
          >
            {user.isTest
              ? <><BadgeCheck className="w-3.5 h-3.5" /> Move to Live (real customer)</>
              : <><FlaskConical className="w-3.5 h-3.5" /> Move to Test</>}
          </button>
        </div>
      </aside>
    </>
  )
}

// ─── New password for an existing customer ─────────────────────────────────────

type NewPassword = { password: string; email: string; name: string; phone: string | null; provider: string }

function NewPasswordModal({ result, onClose }: { result: NewPassword; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const also =
    result.provider === "google" ? `\n"Continue with Google" still works too.` :
    result.provider === "apple" ? `\n"Continue with Apple" still works too.` : ""
  const message =
    `Hi ${result.name}! Here's a new password for the GreenFeast app 🌿\n\n` +
    `Log in with Email & Password:\nEmail: ${result.email}\nTemporary password: ${result.password}\n\n` +
    `You'll be asked to set your own password after signing in.${also}`
  const digits = (result.phone ?? "").replace(/\D/g, "").slice(-10)

  return (
    <ModalShell title="New password" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg bg-[#F9FBF7] border border-[#e2e8d5] p-3 text-sm">
          <p className="font-medium text-[#1A1A1A]">{result.name}</p>
          <p className="text-gray-600 mt-1">Email: <span className="font-mono">{result.email}</span></p>
          <p className="text-gray-600">Temporary password: <span className="font-mono font-semibold text-[#1A1A1A]">{result.password}</span></p>
          <p className="text-xs text-amber-700 mt-2">Shown only once — send it now. The app asks them to set their own after signing in.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { navigator.clipboard.writeText(message); setCopied(true) }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg border border-[#e2e8d5] hover:bg-gray-50"
          >
            <Copy className="w-4 h-4" /> {copied ? "Copied" : "Copy message"}
          </button>
          {digits.length === 10 && (
            <a
              href={`https://wa.me/91${digits}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg bg-[#25D366] text-white hover:opacity-90"
            >
              Send on WhatsApp
            </a>
          )}
        </div>
      </div>
      <ModalFooter>
        <GhostBtn onClick={onClose}>Done</GhostBtn>
      </ModalFooter>
    </ModalShell>
  )
}

// ─── Add customer (create their login) ──────────────────────────────────────────

const APP_STORE_URL = "https://apps.apple.com/in/app/id6805608220"

function AddCustomerModal({
  isTestMode, onClose, onSetUpPlan,
}: {
  isTestMode: boolean
  onClose: () => void
  onSetUpPlan: (c: NewCustomer) => void
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [error, setError] = useState("")
  const [pending, start] = useTransition()
  const [done, setDone] = useState<{ customer: NewCustomer; tempPassword: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const message = done
    ? `Hi ${done.customer.name}! Your GreenFeast app is ready 🌿\n\n` +
      `Download it — iPhone: ${APP_STORE_URL}\nAndroid: we'll send you the link.\n\n` +
      `Log in with Email & Password:\nEmail: ${done.customer.email}\nTemporary password: ${done.tempPassword}\n\n` +
      `You'll be asked to set your own password. If that's your Gmail address, "Continue with Google" works too.`
    : ""

  function submit() {
    setError("")
    start(async () => {
      const r = await createCustomerAccount({ name, email, phone })
      if (r.ok) setDone({ customer: r.customer, tempPassword: r.tempPassword })
      else setError(r.error)
    })
  }

  return (
    <ModalShell title={done ? "Login created" : "Add customer"} onClose={onClose}>
      {!done ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Creates an email + password login for someone who hasn&apos;t signed up — e.g. an existing customer moving
            over. You&apos;ll get a temporary password to send them; the app asks them to change it.
            {isTestMode && <span className="block mt-1 font-medium text-amber-700">You&apos;re in Test mode — this will be a test account.</span>}
          </p>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Full name" />
          </Field>
          <Field label="Email (their login)">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="name@gmail.com" />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="10-digit mobile" />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-[#F9FBF7] border border-[#e2e8d5] p-3 text-sm">
            <p className="font-medium text-[#1A1A1A]">{done.customer.name} {done.customer.customerCode && <span className="font-mono text-gray-400">· {done.customer.customerCode}</span>}</p>
            <p className="text-gray-600 mt-1">Email: <span className="font-mono">{done.customer.email}</span></p>
            <p className="text-gray-600">Temporary password: <span className="font-mono font-semibold text-[#1A1A1A]">{done.tempPassword}</span></p>
            <p className="text-xs text-amber-700 mt-2">Shown only once — send it now.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { navigator.clipboard.writeText(message); setCopied(true) }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg border border-[#e2e8d5] hover:bg-gray-50"
            >
              <Copy className="w-4 h-4" /> {copied ? "Copied" : "Copy message"}
            </button>
            <a
              href={`https://wa.me/91${done.customer.phone.slice(-10)}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg bg-[#25D366] text-white hover:opacity-90"
            >
              Send on WhatsApp
            </a>
          </div>
        </div>
      )}

      <ModalFooter>
        <GhostBtn onClick={onClose}>{done ? "Done" : "Cancel"}</GhostBtn>
        {!done ? (
          <PrimaryBtn disabled={pending || !name.trim() || !email.trim() || !phone.trim()} onClick={submit}>
            {pending ? "Creating…" : "Create login"}
          </PrimaryBtn>
        ) : (
          <PrimaryBtn onClick={() => onSetUpPlan(done.customer)}>Set up their plan →</PrimaryBtn>
        )}
      </ModalFooter>
    </ModalShell>
  )
}

// ─── Create subscription modal ─────────────────────────────────────────────────

function CreateSubModal({
  user, plans, addons, coupons, isPending, onClose, onSubmit,
}: {
  user: UserRow
  plans: Plan[]
  addons: AddonOption[]
  coupons: CouponOption[]
  isPending: boolean
  onClose: () => void
  onSubmit: (input: CreateSubInput) => void
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "")
  const [days, setDays] = useState<string[]>(["Mon", "Wed", "Fri"])
  const [mealsLunch, setMealsLunch] = useState(1)
  const [mealsDinner, setMealsDinner] = useState(0)
  const [activation, setActivation] = useState<"active" | "cod">("active")
  // First delivery: the next morning's meals by default — today until the
  // 8 AM lunch cutoff (a plan set up after midnight starts that same day),
  // else tomorrow.
  const [startDate, setStartDate] = useState(() =>
    istHour() < SLOT_CUTOFF_HOUR.lunch ? istToday() : addDaysISO(istToday(), 1))
  const startDay = new Date(startDate + "T00:00:00Z")
  const plan = plans.find((p) => p.id === planId)
  const [mealsLeft, setMealsLeft] = useState(plans[0]?.meals_total ?? 1)
  const [addonIds, setAddonIds] = useState<string[]>([])
  const [credit, setCredit] = useState("") // ₹, empty = suggested
  // A coupon (admin → Coupons) sets the plan's meal price; only coupons with
  // a price for this plan are offered.
  const [couponId, setCouponId] = useState("")
  const planCoupons = coupons.filter((c) => c.prices[planId])
  const coupon = planCoupons.find((c) => c.id === couponId) ?? null
  const regularMeal = plan ? Math.round(plan.base_price / Math.max(plan.meals_total, 1)) : 0
  const mealPrice = coupon ? coupon.prices[planId] : regularMeal
  // Billing is per delivered meal: the plan's meal price, plus add-ons per meal.
  const perMeal = plan
    ? mealPrice + addonIds.reduce((s, id) => s + (addons.find((a) => a.id === id)?.price_per_meal ?? 0), 0)
    : 0
  const suggestedCredit = perMeal * mealsLeft
  const creditPaise = credit.trim() ? Math.round((parseFloat(credit) || 0) * 100) : suggestedCredit
  // Cash on delivery: paid upfront (0 is fine) + cash still to collect.
  const [upfront, setUpfront] = useState("")
  const [cashDue, setCashDue] = useState("")
  const upfrontPaise = Math.round((parseFloat(upfront) || 0) * 100)
  const cashDuePaise = cashDue.trim() ? Math.round((parseFloat(cashDue) || 0) * 100) : Math.max(suggestedCredit - upfrontPaise, 0)

  const [name, setName] = useState(user.name ?? "")
  const [phone, setPhone] = useState(user.phone ?? "")

  const [line1, setLine1] = useState("")
  const [landmark, setLandmark] = useState("")
  const [pincode, setPincode] = useState("")

  function toggleDay(d: string) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  const needsProfile = !user.hasPublicRow
  const valid = planId && days.length > 0 && mealsLunch + mealsDinner >= 1 && (!needsProfile || phone.trim())
    && mealsLeft >= 1 && (activation === "cod" ? upfrontPaise >= 0 : creditPaise >= 0)

  function submit() {
    onSubmit({
      userId: user.id,
      name: needsProfile ? name : undefined,
      phone: needsProfile ? phone : undefined,
      hasPublicRow: user.hasPublicRow,
      planId,
      days,
      mealsLunch,
      mealsDinner,
      activation,
      address: line1.trim() ? { label: "Home", type: "home", line1, pincode, landmark } : undefined,
      startDate,
      mealsLeft,
      walletCredit: activation === "active" ? creditPaise : upfrontPaise,
      cashDue: activation === "cod" ? cashDuePaise : undefined,
      addonIds,
      couponId: coupon?.id,
    })
  }

  return (
    <ModalShell title="Create subscription" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          For <span className="font-medium text-[#1A1A1A]">{user.name ?? user.email ?? "this user"}</span>
        </p>

        {needsProfile && (
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[#F9FBF7] border border-[#e2e8d5]">
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Full name" />
            </Field>
            <Field label="Phone *">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="10-digit" />
            </Field>
            <p className="col-span-2 text-xs text-gray-400">This user has no profile yet — a phone number is required to create one.</p>
          </div>
        )}

        <Field label="Plan">
          <select
            value={planId}
            onChange={(e) => {
              setPlanId(e.target.value)
              setMealsLeft(plans.find((p) => p.id === e.target.value)?.meals_total ?? 1)
              if (couponId && !coupons.find((c) => c.id === couponId)?.prices[e.target.value]) setCouponId("")
            }}
            className={inputCls}
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {fmtRupees(p.base_price)} · {p.meals_total} meals · {fmtRupees(Math.round(p.base_price / Math.max(p.meals_total, 1)))}/meal
              </option>
            ))}
          </select>
        </Field>

        <Field label="Delivery days">
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => {
              const on = days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    on ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "bg-white text-gray-600 border-[#e2e8d5] hover:bg-gray-50"
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Lunches / day"><Stepper value={mealsLunch} setValue={setMealsLunch} /></Field>
          <Field label="Dinners / day"><Stepper value={mealsDinner} setValue={setMealsDinner} /></Field>
        </div>

        <Field label="First delivery date">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
          {!Number.isNaN(startDay.getTime()) && (
            <p className={cn("mt-1 text-xs", startDay.getUTCDay() === 0 ? "text-amber-700" : "text-gray-500")}>
              {startDay.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}
              {startDay.getUTCDay() === 0 ? " — Sunday is our day off, so meals start on Monday" : ""}
            </p>
          )}
        </Field>

        <Field label="Delivery address (optional)">
          <textarea value={line1} onChange={(e) => setLine1(e.target.value)} rows={2} placeholder="Flat / street / area" className={cn(inputCls, "h-auto py-2 resize-none")} />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Landmark" className={inputCls} />
            <input value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="Pincode" className={inputCls} />
          </div>
        </Field>

        {addons.length > 0 && (
          <Field label="Add-ons (every meal)">
            <div className="flex flex-wrap gap-2">
              {addons.map((a) => {
                const on = addonIds.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAddonIds((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id]))}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      on ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "bg-white text-gray-600 border-[#e2e8d5] hover:bg-gray-50"
                    )}
                  >
                    {a.name} +{fmtRupees(a.price_per_meal)}
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        {planCoupons.length > 0 && (
          <Field label="Coupon (optional)">
            <select value={couponId} onChange={(e) => setCouponId(e.target.value)} className={inputCls}>
              <option value="">No coupon — {fmtRupees(regularMeal)} per meal</option>
              {planCoupons.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {fmtRupees(c.prices[planId])} per meal{c.name ? ` · ${c.name}` : ""}
                </option>
              ))}
            </select>
            {coupon && (
              <p className="mt-1 text-xs text-[#1B5E20]">
                {fmtRupees(mealPrice)} per meal instead of {fmtRupees(regularMeal)} — saves {fmtRupees((regularMeal - mealPrice) * mealsLeft)} on {mealsLeft} meals.
              </p>
            )}
          </Field>
        )}

        <Field label="Payment">
          <div className="flex gap-2">
            <RadioPill on={activation === "active"} onClick={() => setActivation("active")} label="Already paid (existing customer)" />
            <RadioPill on={activation === "cod"} onClick={() => setActivation("cod")} label="Cash on delivery" />
          </div>
        </Field>

        {activation === "cod" && plan?.allow_cod === false && (
          <p className="-mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            The app doesn&apos;t offer cash on delivery for the {plan.name} — make sure the rider can collect{" "}
            {fmtRupees(Math.max(suggestedCredit - upfrontPaise, 0))} in cash.
          </p>
        )}
        {activation === "cod" && (
          <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-[#F9FBF7] border border-[#e2e8d5]">
            <Field label="Meals">
              <input
                type="number"
                min={1}
                value={mealsLeft}
                onChange={(e) => setMealsLeft(Math.max(0, parseInt(e.target.value || "0", 10)))}
                className={inputCls}
              />
            </Field>
            <Field label="Paid upfront (₹)">
              <input
                inputMode="decimal"
                value={upfront}
                onChange={(e) => setUpfront(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0"
                className={inputCls}
              />
            </Field>
            <Field label="Cash to collect (₹)">
              <input
                inputMode="decimal"
                value={cashDue}
                onChange={(e) => setCashDue(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder={(Math.max(suggestedCredit - upfrontPaise, 0) / 100).toFixed(2)}
                className={inputCls}
              />
            </Field>
            <p className="col-span-3 text-xs text-gray-500">
              {mealsLeft} meals at {fmtRupees(perMeal)} = <span className="font-medium text-[#1A1A1A]">{fmtRupees(suggestedCredit)}</span>.
              Anything paid upfront goes into their wallet; meals then run on credit (the wallet can go negative) until you
              record the cash on their profile or from Operations.
            </p>
          </div>
        )}

        {activation === "active" && (
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[#F9FBF7] border border-[#e2e8d5]">
            <Field label="Meals left">
              <input
                type="number"
                min={1}
                value={mealsLeft}
                onChange={(e) => setMealsLeft(Math.max(0, parseInt(e.target.value || "0", 10)))}
                className={inputCls}
              />
            </Field>
            <Field label="Wallet credit (₹)">
              <input
                inputMode="decimal"
                value={credit}
                onChange={(e) => setCredit(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder={(suggestedCredit / 100).toFixed(2)}
                className={inputCls}
              />
            </Field>
            <p className="col-span-2 text-xs text-gray-500">
              Meals are paid from the wallet when delivered: {fmtRupees(perMeal)} per meal here, so {mealsLeft} meals need{" "}
              <span className="font-medium text-[#1A1A1A]">{fmtRupees(suggestedCredit)}</span>. Leave it blank to use that.
              {creditPaise < suggestedCredit && (
                <span className="block mt-1 text-amber-700">
                  Less than that covers only about {perMeal > 0 ? Math.floor(creditPaise / perMeal) : 0} meals — the rest would be skipped
                  for low balance. If they got a discount, still credit the full {fmtRupees(suggestedCredit)}.
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      <ModalFooter>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={!valid || isPending} onClick={submit}>Create subscription</PrimaryBtn>
      </ModalFooter>
    </ModalShell>
  )
}

// ─── Edit profile modal ────────────────────────────────────────────────────────

function EditProfileModal({
  user, isPending, onClose, onSubmit,
}: {
  user: UserRow
  isPending: boolean
  onClose: () => void
  onSubmit: (name: string, phone: string) => void
}) {
  const [name, setName] = useState(user.name ?? "")
  const [phone, setPhone] = useState(user.phone ?? "")

  return (
    <ModalShell title="Edit profile" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Full name" />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="10-digit" />
        </Field>
      </div>
      <ModalFooter>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={isPending || !phone.trim()} onClick={() => onSubmit(name, phone)}>Save</PrimaryBtn>
      </ModalFooter>
    </ModalShell>
  )
}

// ─── Pause / Extend modals ─────────────────────────────────────────────────────

function PauseModal({
  isPending, onClose, onSubmit,
}: {
  isPending: boolean
  onClose: () => void
  onSubmit: (from: string, until: string) => void
}) {
  const today = new Date().toISOString().split("T")[0]
  const [from, setFrom] = useState(today)
  const [until, setUntil] = useState("")
  return (
    <ModalShell title="Pause subscription" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Pause from">
          <input type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Pause until">
          <input type="date" min={from || today} value={until} onChange={(e) => setUntil(e.target.value)} className={inputCls} />
        </Field>
        <p className="text-xs text-gray-400">Scheduled orders in this range will be cancelled.</p>
      </div>
      <ModalFooter>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={!from || !until || isPending} onClick={() => onSubmit(from, until)}>Confirm pause</PrimaryBtn>
      </ModalFooter>
    </ModalShell>
  )
}

function ExtendModal({
  current, isPending, onClose, onSubmit,
}: {
  current: number
  isPending: boolean
  onClose: () => void
  onSubmit: (meals: number) => void
}) {
  const [meals, setMeals] = useState(15)
  return (
    <ModalShell title="Extend plan" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Meals to add">
          <input type="number" min={1} max={90} value={meals} onChange={(e) => setMeals(Number(e.target.value))} className={inputCls} />
        </Field>
        <p className="text-sm text-gray-500">
          Current: <strong>{current}</strong> → New total: <strong>{current + (meals || 0)}</strong>
        </p>
      </div>
      <ModalFooter>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn disabled={meals < 1 || isPending} onClick={() => onSubmit(meals)}>Confirm extension</PrimaryBtn>
      </ModalFooter>
    </ModalShell>
  )
}

// ─── Generic confirm modal ─────────────────────────────────────────────────────

function ConfirmModal({
  title, body, confirmLabel, danger, isPending, onClose, onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="text-sm text-gray-600 leading-relaxed">{body}</p>
      <ModalFooter>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        {danger ? (
          <DangerBtn disabled={isPending} onClick={onConfirm}>{confirmLabel}</DangerBtn>
        ) : (
          <PrimaryBtn disabled={isPending} onClick={onConfirm}>{confirmLabel}</PrimaryBtn>
        )}
      </ModalFooter>
    </ModalShell>
  )
}

// ─── Shared bits ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Row({ label, children, icon }: { label: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm gap-2">
      <span className="text-gray-500 flex items-center gap-1.5 shrink-0">{icon}{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Stepper({ value, setValue }: { value: number; setValue: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => setValue(Math.max(0, value - 1))} className="w-8 h-8 rounded-lg border border-[#e2e8d5] text-gray-600 hover:bg-gray-50">−</button>
      <span className="w-8 text-center text-sm font-medium text-[#1A1A1A]">{value}</span>
      <button type="button" onClick={() => setValue(Math.min(3, value + 1))} className="w-8 h-8 rounded-lg border border-[#e2e8d5] text-gray-600 hover:bg-gray-50">+</button>
    </div>
  )
}

function RadioPill({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
        on ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "bg-white text-gray-600 border-[#e2e8d5] hover:bg-gray-50"
      )}
    >
      {label}
    </button>
  )
}

function PanelBtn({
  color, icon, label, disabled, onClick, full,
}: {
  color: "green" | "yellow" | "blue" | "red" | "gray"
  icon: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
  full?: boolean
}) {
  const cls = {
    green: "border-green-300 bg-green-50 text-green-700 hover:bg-green-100",
    yellow: "border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100",
    blue: "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100",
    red: "border-red-300 bg-red-50 text-red-700 hover:bg-red-100",
    gray: "border-[#e2e8d5] bg-white text-gray-600 hover:bg-gray-50",
  }[color]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40",
        full ? "w-full" : "flex-1",
        cls
      )}
    >
      {icon} {label}
    </button>
  )
}

function ModalShell({
  title, children, onClose, wide,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn("relative z-10 w-full", wide ? "max-w-lg" : "max-w-md")}>
        <div className="bg-white rounded-2xl shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-[#1A1A1A]">{title}</h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-3 pt-1">{children}</div>
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex-1 h-10 rounded-xl border border-[#e2e8d5] text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
      {children}
    </button>
  )
}

function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex-1 h-10 rounded-xl bg-[#1B5E20] text-sm font-medium text-white hover:bg-[#155116] disabled:opacity-40 transition-colors">
      {children}
    </button>
  )
}

function DangerBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex-1 h-10 rounded-xl bg-red-600 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 transition-colors">
      {children}
    </button>
  )
}

const inputCls = "w-full h-10 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] transition-colors"
