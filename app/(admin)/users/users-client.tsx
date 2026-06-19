"use client"

import { useState, useMemo, useEffect, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Search, X, Phone, Mail, Calendar, Plus, Pause, Play, Trash2,
  RotateCcw, Pencil, ExternalLink, ChevronLeft, ChevronRight,
  AlertCircle, CheckCircle, ShieldAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  createSubscription, resetUserData, deleteUser, editUserProfile,
  pauseSub, resumeSub, cancelSub, extendSub,
} from "./actions"
import type { CreateSubInput } from "./types"

// ─── Types ───────────────────────────────────────────────────────────────────

export type UserRow = {
  id: string
  email: string | null
  name: string | null
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

export type Plan = {
  id: string
  name: string
  meals_total: number
  days_per_week: number
  base_price: number
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

const FILTERS = ["All", "Signed in", "Onboarded", "Active", "Paused", "Pending", "Cancelled", "Expired"]

function matchesFilter(u: UserRow, filter: string) {
  if (filter === "All") return true
  if (filter === "Signed in") return !u.hasPublicRow
  if (filter === "Onboarded") return u.hasPublicRow && !u.subStatus
  return u.subStatus === filter.toLowerCase()
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function UsersClient({
  initialUsers, plans, loadError,
}: {
  initialUsers: UserRow[]
  plans: Plan[]
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
  const [pauseOpen, setPauseOpen] = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null)

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3200)
  }

  function closeModals() {
    setCreateOpen(false); setEditOpen(false); setResetOpen(false)
    setDeleteOpen(false); setPauseOpen(false); setExtendOpen(false); setCancelOpen(false)
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
      if (u.subStatus === "active") active++
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
        (u.phone ?? "").includes(q)
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
            placeholder="Search name, email, or phone..."
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
                      <td className="px-4 py-3 font-medium text-[#1A1A1A] whitespace-nowrap">{u.name ?? "—"}</td>
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
          onPause={() => setPauseOpen(true)}
          onResume={() => run(() => resumeSub(selected.subscriptionId!), "Subscription resumed.")}
          onExtend={() => setExtendOpen(true)}
          onCancel={() => setCancelOpen(true)}
        />
      )}

      {/* Modals */}
      {createOpen && selected && (
        <CreateSubModal
          user={selected}
          plans={plans}
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

      {cancelOpen && selected && (
        <ConfirmModal
          title="Cancel subscription?"
          body="All upcoming scheduled orders will be cancelled."
          confirmLabel="Cancel plan"
          danger
          isPending={isPending}
          onClose={() => setCancelOpen(false)}
          onConfirm={() => run(() => cancelSub(selected.subscriptionId!), "Subscription cancelled.")}
        />
      )}

      {pauseOpen && selected && (
        <PauseModal
          isPending={isPending}
          onClose={() => setPauseOpen(false)}
          onSubmit={(from, until) => run(() => pauseSub(selected.subscriptionId!, from, until), "Subscription paused.")}
        />
      )}

      {extendOpen && selected && (
        <ExtendModal
          current={selected.deliveriesRemaining ?? 0}
          isPending={isPending}
          onClose={() => setExtendOpen(false)}
          onSubmit={(meals) => run(() => extendSub(selected.subscriptionId!, meals), `Added ${meals} meals.`)}
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
  user, isPending, onClose, onCreate, onEdit, onReset, onDelete,
  onPause, onResume, onExtend, onCancel,
}: {
  user: UserRow
  isPending: boolean
  onClose: () => void
  onCreate: () => void
  onEdit: () => void
  onReset: () => void
  onDelete: () => void
  onPause: () => void
  onResume: () => void
  onExtend: () => void
  onCancel: () => void
}) {
  const tier = tierOf(user)
  const hasSub = !!user.subStatus && user.subStatus !== "cancelled" && user.subStatus !== "expired"
  const isPaused = user.subStatus === "paused"

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
            <p className="text-xs text-gray-400 mt-0.5">{providerLabel(user.provider)} account</p>
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
                <Row label="Status"><span className="capitalize text-[#1A1A1A]">{user.subStatus}</span></Row>
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
            <>
              {user.subscriptionId && (
                <Link
                  href={`/subscribers/${user.subscriptionId}`}
                  className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium rounded-lg bg-[#1B5E20] text-white hover:bg-[#155116] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Full profile
                </Link>
              )}
              {hasSub && (
                <div className="flex gap-2">
                  {isPaused ? (
                    <PanelBtn color="green" disabled={isPending} onClick={onResume} icon={<Play className="w-3.5 h-3.5" />} label="Resume" />
                  ) : (
                    <PanelBtn color="yellow" disabled={isPending} onClick={onPause} icon={<Pause className="w-3.5 h-3.5" />} label="Pause" />
                  )}
                  <PanelBtn color="blue" disabled={isPending} onClick={onExtend} icon={<Plus className="w-3.5 h-3.5" />} label="Extend" />
                </div>
              )}
              {hasSub && (
                <PanelBtn color="red" disabled={isPending} onClick={onCancel} icon={<X className="w-3.5 h-3.5" />} label="Cancel subscription" full />
              )}
            </>
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
        </div>
      </aside>
    </>
  )
}

// ─── Create subscription modal ─────────────────────────────────────────────────

function CreateSubModal({
  user, plans, isPending, onClose, onSubmit,
}: {
  user: UserRow
  plans: Plan[]
  isPending: boolean
  onClose: () => void
  onSubmit: (input: CreateSubInput) => void
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "")
  const [days, setDays] = useState<string[]>(["Mon", "Wed", "Fri"])
  const [mealsLunch, setMealsLunch] = useState(1)
  const [mealsDinner, setMealsDinner] = useState(0)
  const [deliveryMode, setDeliveryMode] = useState<"opt-in" | "opt-out">("opt-out")
  const [activation, setActivation] = useState<"active" | "cod">("active")

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
      deliveryMode,
      activation,
      address: line1.trim() ? { label: "Home", type: "home", line1, pincode, landmark } : undefined,
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
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={inputCls}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {fmtRupees(p.base_price)} · {p.meals_total} meals
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

        <Field label="Delivery mode">
          <div className="flex gap-2">
            <RadioPill on={deliveryMode === "opt-out"} onClick={() => setDeliveryMode("opt-out")} label="Opt-out (skip anytime)" />
            <RadioPill on={deliveryMode === "opt-in"} onClick={() => setDeliveryMode("opt-in")} label="Opt-in" />
          </div>
        </Field>

        <Field label="Delivery address (optional)">
          <textarea value={line1} onChange={(e) => setLine1(e.target.value)} rows={2} placeholder="Flat / street / area" className={cn(inputCls, "h-auto py-2 resize-none")} />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Landmark" className={inputCls} />
            <input value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="Pincode" className={inputCls} />
          </div>
        </Field>

        <Field label="Activation">
          <div className="flex gap-2">
            <RadioPill on={activation === "active"} onClick={() => setActivation("active")} label="Activate now (mark paid)" />
            <RadioPill on={activation === "cod"} onClick={() => setActivation("cod")} label="Cash on delivery" />
          </div>
        </Field>
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
