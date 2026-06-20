"use client"

import { useState, useTransition } from "react"
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import {
  Plus, Pencil, Trash2, GripVertical, Sun, Moon, Sunset,
  CheckCircle, AlertCircle, X, Package,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createBatch, updateBatch, deleteBatch, moveSubscriberToBatch } from "./actions"

// ── Types ──────────────────────────────────────────────────────────────────

type Batch = {
  id: string
  name: string
  area: string | null
  time_window: "morning" | "noon" | "evening"
  primary_partner_id: string | null
  secondary_partner_id: string | null
  primaryPartnerName: string | null
  secondaryPartnerName: string | null
}

type SubscriberCard = {
  subscriptionId: string
  name: string
  phone: string
  plan: string
  batchId: string | null
  city: string
}

type Partner = { id: string; name: string }

const BATCH_CAPACITY = 25

const TIME_ICONS = {
  morning: Sun,
  noon: Package,
  evening: Sunset,
}

const TIME_COLORS = {
  morning: "bg-amber-50 text-amber-700 border-amber-200",
  noon:    "bg-blue-50 text-blue-700 border-blue-200",
  evening: "bg-violet-50 text-violet-700 border-violet-200",
}

// ── Draggable subscriber card ───────────────────────────────────────────────

function DraggableCard({ sub, isDragOverlay = false }: { sub: SubscriberCard; isDragOverlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: sub.subscriptionId,
    data: { sub },
    disabled: isDragOverlay,
  })

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-white rounded-xl border border-[#e2e8d5] p-3 shadow-sm select-none group",
        isDragging ? "opacity-30" : "hover:border-[#1B5E20]/30 hover:shadow-md",
        isDragOverlay && "rotate-1 shadow-xl border-[#1B5E20]/40"
      )}
    >
      <div className="flex items-start gap-2">
        <div
          {...listeners}
          {...attributes}
          className="mt-0.5 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 transition-colors shrink-0"
        >
          <GripVertical className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1A1A1A] truncate">{sub.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{sub.phone}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-xs bg-[#1B5E20]/10 text-[#1B5E20] px-1.5 py-0.5 rounded-md font-medium">{sub.plan}</span>
            {sub.city && <span className="text-xs text-gray-400">{sub.city}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Droppable kanban column ────────────────────────────────────────────────

function KanbanColumn({ id, title, subtitle, subscribers, isUnassigned = false }: {
  id: string
  title: string
  subtitle?: string
  subscribers: SubscriberCard[]
  isUnassigned?: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border-2 transition-colors w-56 flex-shrink-0",
        isOver ? "border-[#1B5E20] bg-[#1B5E20]/5" : isUnassigned ? "border-dashed border-gray-200 bg-gray-50" : "border-[#e2e8d5] bg-[#F9FBF7]"
      )}
    >
      <div className={cn("px-3 py-2.5 border-b flex items-center justify-between", isOver ? "border-[#1B5E20]/20" : "border-[#e2e8d5]")}>
        <div>
          <p className={cn("text-xs font-semibold", isUnassigned ? "text-gray-400" : "text-[#1A1A1A]")}>{title}</p>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
        <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded-md", isUnassigned ? "bg-gray-200 text-gray-500" : "bg-[#1B5E20]/10 text-[#1B5E20]")}>
          {subscribers.length}
        </span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[160px] max-h-[520px]">
        {subscribers.map(sub => (
          <DraggableCard key={sub.subscriptionId} sub={sub} />
        ))}
        {subscribers.length === 0 && (
          <div className="flex items-center justify-center h-24 text-xs text-gray-300">
            {isOver ? "Drop here" : "Empty"}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Batch form ─────────────────────────────────────────────────────────────

function BatchForm({
  initial,
  allPartners,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: Batch
  allPartners: Partner[]
  onSave: (data: {
    name: string; area: string; time_window: "morning" | "noon" | "evening"
    primary_partner_id: string; secondary_partner_id: string
  }) => void
  onCancel: () => void
  isPending: boolean
}) {
  const [name, setName]                   = useState(initial?.name ?? "")
  const [area, setArea]                   = useState(initial?.area ?? "")
  const [tw, setTw]                       = useState<"morning" | "noon" | "evening">(initial?.time_window ?? "morning")
  const [primaryId, setPrimaryId]         = useState(initial?.primary_partner_id ?? "")
  const [secondaryId, setSecondaryId]     = useState(initial?.secondary_partner_id ?? "")

  const inputCls = "w-full h-9 rounded-lg border border-[#e2e8d5] px-3 text-sm text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] transition-colors"

  return (
    <div className="p-4 bg-white rounded-xl border border-[#e2e8d5] space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        {initial ? "Edit Batch" : "New Batch"}
      </p>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sector 21 Morning" className={inputCls} />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Area</label>
        <input value={area} onChange={e => setArea(e.target.value)} placeholder="Locality / area" className={inputCls} />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Time window</label>
        <div className="flex gap-2">
          {(["morning", "noon", "evening"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTw(t)}
              className={cn(
                "flex-1 py-1.5 text-xs font-medium rounded-lg border capitalize transition-colors",
                tw === t ? TIME_COLORS[t] : "border-[#e2e8d5] text-gray-400 hover:bg-gray-50"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Primary partner</label>
        <select value={primaryId} onChange={e => setPrimaryId(e.target.value)} className={inputCls}>
          <option value="">— None —</option>
          {allPartners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Secondary partner (optional)</label>
        <select value={secondaryId} onChange={e => setSecondaryId(e.target.value)} className={inputCls}>
          <option value="">— None —</option>
          {allPartners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 h-9 rounded-lg border border-[#e2e8d5] text-sm text-gray-500 hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button
          onClick={() => onSave({ name, area, time_window: tw, primary_partner_id: primaryId, secondary_partner_id: secondaryId })}
          disabled={isPending || !name.trim()}
          className="flex-1 h-9 rounded-lg bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] disabled:opacity-40 transition-colors"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function BatchesClient({
  initialBatches,
  allPartners,
  initialSubscribers,
}: {
  initialBatches: Batch[]
  allPartners: Partner[]
  initialSubscribers: SubscriberCard[]
}) {
  const [batches, setBatches]       = useState(initialBatches)
  const [subs, setSubs]             = useState(initialSubscribers)
  const [isPending, startTransition] = useTransition()

  const [formMode, setFormMode]     = useState<"none" | "create" | "edit">("none")
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [activeId, setActiveId]     = useState<string | null>(null)
  const [toast, setToast]           = useState<{ type: "success" | "error"; msg: string } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg }); setTimeout(() => setToast(null), 3000)
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const subscriptionId = active.id as string
    const newBatchId = over.id === "unassigned" ? null : (over.id as string)
    const sub = subs.find(s => s.subscriptionId === subscriptionId)
    if (!sub || sub.batchId === newBatchId) return

    const oldBatchId = sub.batchId
    setSubs(prev => prev.map(s => s.subscriptionId === subscriptionId ? { ...s, batchId: newBatchId } : s))

    startTransition(async () => {
      try {
        await moveSubscriberToBatch(subscriptionId, newBatchId)
      } catch {
        setSubs(prev => prev.map(s => s.subscriptionId === subscriptionId ? { ...s, batchId: oldBatchId } : s))
        showToast("error", "Could not move subscriber. Try again.")
      }
    })
  }

  function handleCreate(data: Parameters<typeof createBatch>[0]) {
    startTransition(async () => {
      try {
        await createBatch(data)
        window.location.reload()
      } catch {
        showToast("error", "Could not create batch.")
      }
    })
  }

  function handleUpdate(data: Parameters<typeof updateBatch>[1]) {
    if (!editingBatch) return
    startTransition(async () => {
      try {
        await updateBatch(editingBatch.id, data)
        setBatches(prev => prev.map(b => b.id === editingBatch.id
          ? {
              ...b, ...data,
              primaryPartnerName: allPartners.find(p => p.id === data.primary_partner_id)?.name ?? null,
              secondaryPartnerName: allPartners.find(p => p.id === data.secondary_partner_id)?.name ?? null,
            }
          : b
        ))
        setFormMode("none"); setEditingBatch(null)
        showToast("success", "Batch updated.")
      } catch {
        showToast("error", "Could not update batch.")
      }
    })
  }

  async function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteBatch(id)
        setBatches(prev => prev.filter(b => b.id !== id))
        setDeletingId(null)
        showToast("success", "Batch deleted.")
      } catch (err: any) {
        showToast("error", err?.message ?? "Could not delete batch.")
        setDeletingId(null)
      }
    })
  }

  const activeSub = activeId ? subs.find(s => s.subscriptionId === activeId) : null

  return (
    <div className="flex h-[calc(100vh-3.5rem)] md:h-screen overflow-hidden">

      {/* ── Left panel: batch list ── */}
      <div className="w-72 flex-shrink-0 border-r border-[#e2e8d5] flex flex-col bg-white overflow-y-auto">
        <div className="px-5 py-5 border-b border-[#e2e8d5]">
          <h1 className="text-lg font-bold text-[#1A1A1A]">Batches</h1>
          <p className="text-xs text-gray-400 mt-0.5">{batches.length} delivery routes</p>
        </div>

        <div className="flex-1 p-3 space-y-1.5 overflow-y-auto">
          {batches.map(batch => {
            const subCount = subs.filter(s => s.batchId === batch.id).length
            const TimeIcon = TIME_ICONS[batch.time_window]
            return (
              <div key={batch.id} className="bg-[#F9FBF7] rounded-xl border border-[#e2e8d5] p-3">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1A1A1A] truncate">{batch.name}</p>
                    {batch.area && <p className="text-xs text-gray-400 truncate">{batch.area}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditingBatch(batch); setFormMode("edit") }}
                      className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-[#1B5E20] transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingId(batch.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border capitalize", TIME_COLORS[batch.time_window])}>
                    <TimeIcon className="w-3 h-3" />{batch.time_window}
                  </span>
                  {batch.primaryPartnerName && (
                    <span className="text-xs text-gray-400 truncate">{batch.primaryPartnerName}</span>
                  )}
                </div>
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{subCount} / {BATCH_CAPACITY}</span>
                    <span>{Math.min(100, Math.round((subCount / BATCH_CAPACITY) * 100))}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        subCount / BATCH_CAPACITY >= 0.8 ? "bg-orange-400" : "bg-[#1B5E20]"
                      )}
                      style={{ width: `${Math.min(100, (subCount / BATCH_CAPACITY) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}

          {batches.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No batches yet.</p>
          )}
        </div>

        {/* Form or add button */}
        <div className="p-3 border-t border-[#e2e8d5]">
          {formMode === "none" && (
            <button
              onClick={() => { setFormMode("create"); setEditingBatch(null) }}
              className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg border border-dashed border-[#1B5E20]/40 text-sm text-[#1B5E20] hover:bg-[#1B5E20]/5 transition-colors"
            >
              <Plus className="w-4 h-4" /> New Batch
            </button>
          )}
          {formMode === "create" && (
            <BatchForm
              allPartners={allPartners}
              onSave={handleCreate}
              onCancel={() => setFormMode("none")}
              isPending={isPending}
            />
          )}
          {formMode === "edit" && editingBatch && (
            <BatchForm
              initial={editingBatch}
              allPartners={allPartners}
              onSave={handleUpdate}
              onCancel={() => { setFormMode("none"); setEditingBatch(null) }}
              isPending={isPending}
            />
          )}
        </div>
      </div>

      {/* ── Right panel: kanban ── */}
      <div className="flex-1 overflow-x-auto bg-[#F9FBF7] p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-[#1A1A1A]">Subscriber Assignment</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Drag subscribers between batches · {subs.length} total · {subs.filter(s => !s.batchId).length} unassigned
            </p>
          </div>
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-full pb-4">
            {/* Unassigned column */}
            <KanbanColumn
              id="unassigned"
              title="Unassigned"
              subscribers={subs.filter(s => !s.batchId)}
              isUnassigned
            />

            {/* One column per batch */}
            {batches.map(batch => (
              <KanbanColumn
                key={batch.id}
                id={batch.id}
                title={batch.name}
                subtitle={batch.area ?? undefined}
                subscribers={subs.filter(s => s.batchId === batch.id)}
              />
            ))}
          </div>

          {/* Drag overlay — shows a floating card while dragging */}
          <DragOverlay dropAnimation={null}>
            {activeSub ? <DraggableCard sub={activeSub} isDragOverlay /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* ── Delete confirm modal ── */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeletingId(null)} />
          <div className="relative z-10 bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[#1A1A1A]">Delete batch?</h3>
              <button onClick={() => setDeletingId(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-gray-600">
              Only possible if no subscribers are assigned. Subscribers must be moved to other batches first.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeletingId(null)} className="flex-1 h-10 rounded-xl border border-[#e2e8d5] text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deletingId)}
                disabled={isPending}
                className="flex-1 h-10 rounded-xl bg-red-600 text-sm text-white font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white",
          toast.type === "success" ? "bg-[#1B5E20]" : "bg-red-600"
        )}>
          {toast.type === "success" ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
