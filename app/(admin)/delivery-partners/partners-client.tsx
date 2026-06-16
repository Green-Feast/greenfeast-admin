"use client"

import { useState, useTransition, useRef, useEffect } from "react"
import { Plus, X, Pencil, CheckCircle, AlertCircle, Eye, Upload, Phone, Bike } from "lucide-react"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import {
  upsertPartner,
  createSignedUploadUrl,
  saveDocUrl,
  getSignedViewUrl,
} from "./actions"

// ── Types ──────────────────────────────────────────────────────────────────

export type Partner = {
  id?: string
  name: string
  phone: string
  alternate_phone?: string
  aadhaar_number?: string
  aadhaar_doc_url?: string
  pan_number?: string
  pan_doc_url?: string
  dl_number?: string
  dl_doc_url?: string
  vehicle_rc_number?: string
  vehicle_rc_doc_url?: string
  notes?: string
  status: "active" | "inactive"
}

const DOCS = [
  { key: "aadhaar",    label: "Aadhaar",          numberKey: "aadhaar_number",    urlKey: "aadhaar_doc_url" },
  { key: "pan",        label: "PAN Card",          numberKey: "pan_number",        urlKey: "pan_doc_url" },
  { key: "dl",         label: "Driving Licence",   numberKey: "dl_number",         urlKey: "dl_doc_url" },
  { key: "vehicle_rc", label: "Vehicle RC",        numberKey: "vehicle_rc_number", urlKey: "vehicle_rc_doc_url" },
] as const

type DocKey = typeof DOCS[number]["key"]

// ── Main component ─────────────────────────────────────────────────────────

export function PartnersClient({ initialPartners }: { initialPartners: Partner[] }) {
  const [partners, setPartners] = useState(initialPartners)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Partner | null>(null) // null = create mode
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState<DocKey | null>(null)

  // Form fields
  const [name, setName]                   = useState("")
  const [phone, setPhone]                 = useState("")
  const [altPhone, setAltPhone]           = useState("")
  const [notes, setNotes]                 = useState("")
  const [status, setStatus]               = useState<"active" | "inactive">("active")
  const [aadhaarNum, setAadhaarNum]       = useState("")
  const [panNum, setPanNum]               = useState("")
  const [dlNum, setDlNum]                 = useState("")
  const [rcNum, setRcNum]                 = useState("")

  function openCreate() {
    setEditing(null)
    setName(""); setPhone(""); setAltPhone(""); setNotes(""); setStatus("active")
    setAadhaarNum(""); setPanNum(""); setDlNum(""); setRcNum("")
    setPanelOpen(true)
  }

  function openEdit(p: Partner) {
    setEditing(p)
    setName(p.name); setPhone(p.phone); setAltPhone(p.alternate_phone ?? "")
    setNotes(p.notes ?? ""); setStatus(p.status)
    setAadhaarNum(p.aadhaar_number ?? ""); setPanNum(p.pan_number ?? "")
    setDlNum(p.dl_number ?? ""); setRcNum(p.vehicle_rc_number ?? "")
    setPanelOpen(true)
  }

  function closePanel() { setPanelOpen(false); setEditing(null) }

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg }); setTimeout(() => setToast(null), 3000)
  }

  function handleSave() {
    if (!name.trim() || !phone.trim()) return
    startTransition(async () => {
      try {
        await upsertPartner({
          id: editing?.id,
          name: name.trim(),
          phone: phone.trim(),
          alternate_phone: altPhone.trim() || undefined,
          aadhaar_number: aadhaarNum.trim() || undefined,
          pan_number: panNum.trim() || undefined,
          dl_number: dlNum.trim() || undefined,
          vehicle_rc_number: rcNum.trim() || undefined,
          notes: notes.trim() || undefined,
          status,
        })
        // Update local state
        if (editing?.id) {
          setPartners(prev => prev.map(p => p.id === editing.id
            ? { ...p, name, phone, alternate_phone: altPhone, notes, status, aadhaar_number: aadhaarNum, pan_number: panNum, dl_number: dlNum, vehicle_rc_number: rcNum }
            : p
          ))
        } else {
          // Refresh page to get new partner with ID (simple approach)
          window.location.reload()
        }
        showToast("success", editing?.id ? "Partner updated." : "Partner created.")
        closePanel()
      } catch {
        showToast("error", "Could not save. Try again.")
      }
    })
  }

  async function handleDocUpload(docKey: DocKey, file: File, partnerId: string) {
    setUploadingDoc(docKey)
    try {
      const { token, path } = await createSignedUploadUrl(partnerId, docKey, file.name)
      const { error: uploadErr } = await supabase.storage
        .from("partner-docs")
        .uploadToSignedUrl(path, token, file, { contentType: file.type, upsert: true })
      if (uploadErr) throw uploadErr
      await saveDocUrl(partnerId, docKey, path)
      const docType = DOCS.find(d => d.key === docKey)!
      setPartners(prev => prev.map(p => p.id === partnerId ? { ...p, [docType.urlKey]: path } : p))
      if (editing?.id === partnerId) {
        setEditing(prev => prev ? { ...prev, [docType.urlKey]: path } : prev)
      }
      showToast("success", "Document uploaded.")
    } catch {
      showToast("error", "Upload failed. Try again.")
    }
    setUploadingDoc(null)
  }

  async function handleViewDoc(path: string) {
    try {
      const url = await getSignedViewUrl(path)
      if (url) window.open(url, "_blank")
      else showToast("error", "Could not generate link.")
    } catch {
      showToast("error", "Could not generate link.")
    }
  }

  const activeCount   = partners.filter(p => p.status === "active").length
  const inactiveCount = partners.filter(p => p.status === "inactive").length

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bike className="w-4 h-4 text-[#1B5E20]" />
            <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">Team</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Delivery Partners</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeCount} active · {inactiveCount} inactive
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Partner
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#e2e8d5] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                {["Name", "Phone", "Alt. Phone", "Status", "Documents", "Notes", "Actions"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partners.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                    No delivery partners yet. Add one to get started.
                  </td>
                </tr>
              ) : (
                partners.map((p, i) => {
                  const docCount = DOCS.filter(d => p[d.urlKey as keyof Partner]).length
                  return (
                    <tr key={p.id} className={cn("border-b border-[#e2e8d5] last:border-0 hover:bg-[#F9FBF7] transition-colors", i % 2 === 1 && "bg-[#fafcf8]")}>
                      <td className="px-5 py-3.5 font-medium text-[#1A1A1A] whitespace-nowrap">{p.name}</td>
                      <td className="px-5 py-3.5 text-gray-600 whitespace-nowrap">
                        <a href={`tel:+91${p.phone}`} className="flex items-center gap-1.5 hover:text-[#1B5E20]">
                          <Phone className="w-3.5 h-3.5" />{p.phone}
                        </a>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500">{p.alternate_phone ?? "—"}</td>
                      <td className="px-5 py-3.5">
                        <span className={cn(
                          "px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
                          p.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        )}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500">
                        <span className="text-xs">{docCount}/{DOCS.length} uploaded</span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500 max-w-[180px] truncate" title={p.notes ?? ""}>
                        {p.notes ?? "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => openEdit(p)}
                          className="flex items-center gap-1 text-xs font-medium text-[#1B5E20] hover:text-white hover:bg-[#1B5E20] border border-[#1B5E20]/30 hover:border-[#1B5E20] px-3 py-1.5 rounded-lg transition-all"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-in panel */}
      <>
        <div
          className={cn("fixed inset-0 bg-black/30 z-40 transition-opacity duration-300", panelOpen ? "opacity-100" : "opacity-0 pointer-events-none")}
          onClick={closePanel}
        />
        <aside className={cn(
          "fixed right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out",
          panelOpen ? "translate-x-0" : "translate-x-full"
        )}>
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e2e8d5] bg-[#F9FBF7]">
            <h2 className="text-base font-semibold text-[#1A1A1A]">
              {editing ? `Edit: ${editing.name}` : "Add Delivery Partner"}
            </h2>
            <button onClick={closePanel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

            {/* Basic Info */}
            <Section title="Basic Info">
              <Field label="Name *">
                <Input value={name} onChange={setName} placeholder="Full name" />
              </Field>
              <Field label="Phone *">
                <Input value={phone} onChange={setPhone} placeholder="10-digit number" type="tel" />
              </Field>
              <Field label="Alternate Phone">
                <Input value={altPhone} onChange={setAltPhone} placeholder="Optional" type="tel" />
              </Field>
              <Field label="Status">
                <div className="flex gap-2">
                  {(["active", "inactive"] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize",
                        status === s
                          ? s === "active" ? "bg-green-100 text-green-700 border-green-300" : "bg-gray-100 text-gray-600 border-gray-300"
                          : "bg-white text-gray-400 border-[#e2e8d5] hover:bg-gray-50"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Internal notes (optional)"
                  rows={3}
                  className="w-full text-sm rounded-lg border border-[#e2e8d5] px-3 py-2.5 bg-[#F9FBF7] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] resize-none placeholder:text-gray-300"
                />
              </Field>
            </Section>

            {/* Document numbers (always shown) */}
            <Section title="Document Numbers">
              <Field label="Aadhaar Number">
                <Input value={aadhaarNum} onChange={setAadhaarNum} placeholder="12-digit number" />
              </Field>
              <Field label="PAN Number">
                <Input value={panNum} onChange={setPanNum} placeholder="ABCDE1234F" />
              </Field>
              <Field label="Driving Licence No.">
                <Input value={dlNum} onChange={setDlNum} placeholder="DL number" />
              </Field>
              <Field label="Vehicle RC Number">
                <Input value={rcNum} onChange={setRcNum} placeholder="RJ14 CA 1234" />
              </Field>
            </Section>

            {/* Document upload — only when editing existing partner */}
            {editing?.id && (
              <Section title="Document Files">
                {DOCS.map(doc => {
                  const hasDoc = !!(editing[doc.urlKey as keyof Partner])
                  const isUploading = uploadingDoc === doc.key
                  return (
                    <DocRow
                      key={doc.key}
                      label={doc.label}
                      hasDoc={hasDoc}
                      isUploading={isUploading}
                      onUpload={file => handleDocUpload(doc.key, file, editing.id!)}
                      onView={() => handleViewDoc(editing[doc.urlKey as keyof Partner] as string)}
                    />
                  )
                })}
                <p className="text-xs text-gray-400 mt-2">
                  All documents are private. View links expire in 60 seconds.
                </p>
              </Section>
            )}
            {!editing?.id && (
              <p className="text-xs text-gray-400 border border-dashed border-[#e2e8d5] rounded-lg p-3 text-center">
                Save basic info first, then upload documents.
              </p>
            )}
          </div>

          {/* Panel footer */}
          <div className="px-5 py-4 border-t border-[#e2e8d5] bg-[#F9FBF7]">
            <button
              onClick={handleSave}
              disabled={isPending || !name.trim() || !phone.trim()}
              className="w-full h-10 rounded-xl bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] disabled:opacity-40 transition-colors"
            >
              {isPending ? "Saving…" : editing ? "Save Changes" : "Create Partner"}
            </button>
          </div>
        </aside>
      </>

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

// ── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, type = "text" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-9 rounded-lg border border-[#e2e8d5] px-3 text-sm text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] placeholder:text-gray-300 transition-colors"
    />
  )
}

function DocRow({ label, hasDoc, isUploading, onUpload, onView }: {
  label: string
  hasDoc: boolean
  isUploading: boolean
  onUpload: (file: File) => void
  onView: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-[#1A1A1A] flex-1">{label}</span>
      <div className="flex items-center gap-1.5">
        {hasDoc && (
          <button
            onClick={onView}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-[#1B5E20]/30 text-[#1B5E20] hover:bg-green-50 transition-colors"
          >
            <Eye className="w-3 h-3" /> View
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-[#e2e8d5] text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          <Upload className="w-3 h-3" />
          {isUploading ? "Uploading…" : hasDoc ? "Replace" : "Upload"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = "" }}
        />
      </div>
    </div>
  )
}
