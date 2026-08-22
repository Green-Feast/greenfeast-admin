"use client"

import { useState, useTransition, useRef, useMemo } from "react"
import {
  Plus, X, Pencil, CheckCircle, AlertCircle, Archive, RotateCcw,
  Image as ImageIcon, Upload, Trash2, Tag, UtensilsCrossed,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import {
  upsertDish, archiveDish, restoreDish,
  createDishImageUploadUrls, saveDishImage, deleteDishImage,
  upsertCategory, deleteCategory, createCategoryImageUploadUrl, saveCategoryImage,
  type DishInput, type CategoryInput,
} from "./actions"

// ── Types ────────────────────────────────────────────────────────────────

export type Dish = {
  id: string
  name: string
  category: string
  shortDescription: string | null
  description: string | null
  priceRupees: number
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  tags: string[]
  imageUrl: string | null
  thumbUrl: string | null
  blurDataUrl: string | null
  isActive: boolean
  menuVisible: boolean
  subscriptionValid: boolean
}

export type Category = {
  id: string
  name: string
  sortOrder: number
  emoji: string | null
  imageUrl: string | null
  isActive: boolean
}

// ── Client-side image pipeline ──────────────────────────────────────────
// Supabase Storage image transformation is a paid feature, so conversion
// happens here: draw onto a canvas, export WebP at two sizes plus a tiny
// blurred placeholder — matches the quality/method convention the repo's
// Python scripts already use (quality=82).

function fitDims(w: number, h: number, maxDim: number) {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h }
  const scale = maxDim / Math.max(w, h)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

function drawToCanvas(bitmap: ImageBitmap, maxDim: number): HTMLCanvasElement {
  const { width, height } = fitDims(bitmap.width, bitmap.height, maxDim)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0, width, height)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/webp", quality)
  })
}

async function processDishImage(file: File) {
  const bitmap = await createImageBitmap(file)
  const [full, thumb] = await Promise.all([
    canvasToBlob(drawToCanvas(bitmap, 900), 0.82),
    canvasToBlob(drawToCanvas(bitmap, 400), 0.82),
  ])
  const blurDataUrl = drawToCanvas(bitmap, 24).toDataURL("image/webp", 0.4)
  return { full, thumb, blurDataUrl }
}

async function processCategoryImage(file: File) {
  // Category icons are square with transparency preserved — pad, never
  // crop, matching scripts/compress_category_images.py.
  const bitmap = await createImageBitmap(file)
  const size = Math.max(bitmap.width, bitmap.height)
  const canvas = document.createElement("canvas")
  canvas.width = 480
  canvas.height = 480
  const ctx = canvas.getContext("2d")!
  const scale = 480 / size
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  ctx.drawImage(bitmap, (480 - w) / 2, (480 - h) / 2, w, h)
  return canvasToBlob(canvas, 0.82)
}

// ── Shared presentational primitives (this repo has no components/ui form
//    kit — every admin page hand-writes these; matches partners-client.tsx) ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
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
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-9 rounded-lg border border-[#e2e8d5] px-3 text-sm text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] placeholder:text-gray-300 transition-colors"
    />
  )
}

function Toggle({ checked, onChange, label, sublabel }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; sublabel: string
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "w-full flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
        checked ? "border-[#1B5E20]/30 bg-green-50" : "border-[#e2e8d5] bg-white"
      )}
    >
      <div>
        <p className="text-sm font-medium text-[#1A1A1A]">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{sublabel}</p>
      </div>
      <span className={cn(
        "shrink-0 w-10 h-6 rounded-full relative transition-colors",
        checked ? "bg-[#1B5E20]" : "bg-gray-300"
      )}>
        <span className={cn(
          "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4.5 left-0.5" : "translate-x-0 left-0.5"
        )} />
      </span>
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────

const EMPTY_DISH: DishInput = {
  name: "", category: "", short_description: "", description: "",
  price_rupees: 0, kcal: null, protein: null, carbs: null, fat: null,
  tags: [], menu_visible: true, subscription_valid: true,
}

export function MenuClient({ initialDishes, initialCategories }: { initialDishes: Dish[]; initialCategories: Category[] }) {
  const [dishes, setDishes] = useState(initialDishes)
  const [categories, setCategories] = useState(initialCategories)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null)

  const [panelOpen, setPanelOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null) // null = create mode
  const [form, setForm] = useState<DishInput>(EMPTY_DISH)
  const [uploadingImage, setUploadingImage] = useState(false)

  const [categoryFilter, setCategoryFilter] = useState("All")
  const [showArchived, setShowArchived] = useState(false)

  const [catPanelOpen, setCatPanelOpen] = useState(false)
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [catForm, setCatForm] = useState({ name: "", sortOrder: 0, emoji: "" })
  const [uploadingCatImage, setUploadingCatImage] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const catFileRef = useRef<HTMLInputElement>(null)

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Dish panel ──────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null)
    setForm({ ...EMPTY_DISH, category: categories[0]?.id ?? "" })
    setPanelOpen(true)
  }

  function openEdit(d: Dish) {
    setEditingId(d.id)
    setForm({
      id: d.id, name: d.name, category: d.category,
      short_description: d.shortDescription, description: d.description,
      price_rupees: d.priceRupees, kcal: d.kcal, protein: d.protein, carbs: d.carbs, fat: d.fat,
      tags: d.tags, menu_visible: d.menuVisible, subscription_valid: d.subscriptionValid,
    })
    setPanelOpen(true)
  }

  function closePanel() { setPanelOpen(false); setEditingId(null) }

  function handleSaveDish() {
    if (!form.name.trim() || !form.category) return
    startTransition(async () => {
      try {
        const saved = await upsertDish({ ...form, id: editingId ?? undefined })
        if (editingId) {
          setDishes((prev) => prev.map((d) => d.id === editingId ? mapDishRow(saved) : d))
          showToast("success", "Dish updated.")
        } else {
          setDishes((prev) => [...prev, mapDishRow(saved)])
          // Stay open, now in edit mode, so the photo can be uploaded —
          // upload is keyed by dish id, which only exists after this save.
          setEditingId(saved.id)
          showToast("success", "Dish created — now add a photo below.")
          return
        }
        closePanel()
      } catch (e) {
        showToast("error", e instanceof Error ? e.message : "Could not save. Try again.")
      }
    })
  }

  async function handleArchive(id: string) {
    try {
      await archiveDish(id)
      setDishes((prev) => prev.map((d) => d.id === id ? { ...d, isActive: false } : d))
      showToast("success", "Dish archived.")
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Could not archive.")
    }
  }

  async function handleRestore(id: string) {
    try {
      await restoreDish(id)
      setDishes((prev) => prev.map((d) => d.id === id ? { ...d, isActive: true } : d))
      showToast("success", "Dish restored.")
    } catch {
      showToast("error", "Could not restore.")
    }
  }

  async function handleImagePick(file: File) {
    if (!editingId) return
    setUploadingImage(true)
    try {
      const { full, thumb, blurDataUrl } = await processDishImage(file)
      const { full: fullSlot, thumb: thumbSlot } = await createDishImageUploadUrls(editingId)
      const [fullRes, thumbRes] = await Promise.all([
        supabase.storage.from("meal-images").uploadToSignedUrl(fullSlot.path, fullSlot.token, full, { contentType: "image/webp" }),
        supabase.storage.from("meal-images").uploadToSignedUrl(thumbSlot.path, thumbSlot.token, thumb, { contentType: "image/webp" }),
      ])
      if (fullRes.error) throw fullRes.error
      if (thumbRes.error) throw thumbRes.error
      const saved = await saveDishImage(editingId, fullSlot.path, thumbSlot.path, blurDataUrl)
      setDishes((prev) => prev.map((d) => d.id === editingId
        ? { ...d, imageUrl: saved?.image_url ?? d.imageUrl, thumbUrl: saved?.thumb_url ?? d.thumbUrl, blurDataUrl: saved?.blur_data_url ?? d.blurDataUrl }
        : d))
      showToast("success", "Photo uploaded.")
    } catch {
      showToast("error", "Upload failed. Try again.")
    }
    setUploadingImage(false)
  }

  async function handleImageRemove() {
    if (!editingId) return
    try {
      await deleteDishImage(editingId)
      setDishes((prev) => prev.map((d) => d.id === editingId ? { ...d, imageUrl: null, thumbUrl: null, blurDataUrl: null } : d))
      showToast("success", "Photo removed.")
    } catch {
      showToast("error", "Could not remove photo.")
    }
  }

  // ── Category panel ──────────────────────────────────────────────────

  function openCreateCategory() {
    setEditingCatId(null)
    setCatForm({ name: "", sortOrder: (categories.at(-1)?.sortOrder ?? 0) + 1, emoji: "" })
    setCatPanelOpen(true)
  }

  function openEditCategory(c: Category) {
    setEditingCatId(c.id)
    setCatForm({ name: c.name, sortOrder: c.sortOrder, emoji: c.emoji ?? "" })
    setCatPanelOpen(true)
  }

  function handleSaveCategory() {
    if (!catForm.name.trim()) return
    startTransition(async () => {
      try {
        const input: CategoryInput = {
          id: editingCatId ?? undefined,
          name: catForm.name.trim(), sortOrder: catForm.sortOrder, emoji: catForm.emoji.trim() || null,
        }
        await upsertCategory(input)
        if (editingCatId) {
          setCategories((prev) => prev.map((c) => c.id === editingCatId
            ? { ...c, name: input.name, sortOrder: input.sortOrder, emoji: input.emoji } : c)
            .sort((a, b) => a.sortOrder - b.sortOrder))
          showToast("success", "Category updated.")
          setCatPanelOpen(false); setEditingCatId(null)
        } else {
          // New category's slug/id is server-derived — reload just the list
          // to pick it up (small page, cheap; matches the create-dish flow
          // less because there's no image-first-then-upload dependency).
          window.location.reload()
        }
      } catch (e) {
        showToast("error", e instanceof Error ? e.message : "Could not save category.")
      }
    })
  }

  async function handleDeleteCategory(id: string) {
    try {
      await deleteCategory(id)
      setCategories((prev) => prev.filter((c) => c.id !== id))
      showToast("success", "Category deleted.")
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Could not delete category.")
    }
  }

  async function handleCategoryImagePick(file: File) {
    if (!editingCatId) return
    setUploadingCatImage(true)
    try {
      const blob = await processCategoryImage(file)
      const { token, path } = await createCategoryImageUploadUrl(editingCatId)
      const { error } = await supabase.storage.from("category-images").uploadToSignedUrl(path, token, blob, { contentType: "image/webp" })
      if (error) throw error
      const saved = await saveCategoryImage(editingCatId, path)
      setCategories((prev) => prev.map((c) => c.id === editingCatId ? { ...c, imageUrl: saved?.image_url ?? c.imageUrl } : c))
      showToast("success", "Icon uploaded.")
    } catch {
      showToast("error", "Upload failed. Try again.")
    }
    setUploadingCatImage(false)
  }

  // ── Derived ──────────────────────────────────────────────────────────

  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])
  const filtered = useMemo(() => dishes.filter((d) => {
    if (!showArchived && !d.isActive) return false
    if (categoryFilter !== "All" && d.category !== categoryFilter) return false
    return true
  }), [dishes, categoryFilter, showArchived])

  const editingDish = editingId ? dishes.find((d) => d.id === editingId) : null

  return (
    <div className="p-6 md:p-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <UtensilsCrossed className="w-4 h-4 text-[#1B5E20]" />
            <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">Catalogue</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Menu</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {dishes.filter((d) => d.isActive).length} active dishes · {categories.length} categories
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openCreateCategory}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-[#1B5E20]/30 text-[#1B5E20] text-sm font-medium hover:bg-green-50 transition-colors"
          >
            <Tag className="w-4 h-4" /> Categories
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Dish
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          onClick={() => setCategoryFilter("All")}
          className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            categoryFilter === "All" ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "bg-white text-gray-500 border-[#e2e8d5] hover:bg-gray-50")}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryFilter(c.id)}
            className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              categoryFilter === c.id ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "bg-white text-gray-500 border-[#e2e8d5] hover:bg-gray-50")}
          >
            {c.emoji ? `${c.emoji} ` : ""}{c.name}
          </button>
        ))}
        <label className="flex items-center gap-1.5 ml-auto text-xs text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[#1B5E20]" />
          Show archived
        </label>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#e2e8d5] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e2e8d5] bg-[#F9FBF7]">
                {["Photo", "Name", "Category", "Price", "Visibility", "Actions"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400 text-sm">No dishes match.</td></tr>
              ) : (
                filtered.map((d, i) => (
                  <tr key={d.id} className={cn("border-b border-[#e2e8d5] last:border-0 hover:bg-[#F9FBF7] transition-colors", i % 2 === 1 && "bg-[#fafcf8]", !d.isActive && "opacity-50")}>
                    <td className="px-4 py-3">
                      {d.thumbUrl || d.imageUrl ? (
                        <img src={d.thumbUrl ?? d.imageUrl ?? ""} alt="" className="w-10 h-10 rounded-lg object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-[#F9FBF7] border border-[#e2e8d5] flex items-center justify-center text-lg">
                          {categories.find((c) => c.id === d.category)?.emoji ?? "🍽️"}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#1A1A1A] whitespace-nowrap">{d.name}{!d.isActive && <span className="ml-2 text-xs text-gray-400 font-normal">Archived</span>}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{categoryNames.get(d.category) ?? d.category}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">₹{d.priceRupees}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex gap-1.5">
                        <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", d.menuVisible ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400")}>
                          {d.menuVisible ? "In menu" : "Hidden"}
                        </span>
                        <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", d.subscriptionValid ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400")}>
                          {d.subscriptionValid ? "Orderable" : "Takeaway only"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openEdit(d)} className="flex items-center gap-1 text-xs font-medium text-[#1B5E20] hover:text-white hover:bg-[#1B5E20] border border-[#1B5E20]/30 hover:border-[#1B5E20] px-2.5 py-1.5 rounded-lg transition-all">
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                        {d.isActive ? (
                          <button onClick={() => handleArchive(d.id)} className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-white hover:bg-red-600 border border-red-200 px-2.5 py-1.5 rounded-lg transition-all">
                            <Archive className="w-3 h-3" /> Archive
                          </button>
                        ) : (
                          <button onClick={() => handleRestore(d.id)} className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-white hover:bg-gray-600 border border-gray-300 px-2.5 py-1.5 rounded-lg transition-all">
                            <RotateCcw className="w-3 h-3" /> Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Dish slide-in panel ── */}
      <div className={cn("fixed inset-0 bg-black/30 z-40 transition-opacity duration-300", panelOpen ? "opacity-100" : "opacity-0 pointer-events-none")} onClick={closePanel} />
      <aside className={cn("fixed right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out", panelOpen ? "translate-x-0" : "translate-x-full")}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e2e8d5] bg-[#F9FBF7]">
          <h2 className="text-base font-semibold text-[#1A1A1A]">{editingId ? `Edit: ${form.name}` : "Add Dish"}</h2>
          <button onClick={closePanel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <Section title="Basics">
            <Field label="Name *"><Input value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Thai Zen Bowl" /></Field>
            <Field label="Category *">
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full h-9 rounded-lg border border-[#e2e8d5] px-3 text-sm text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
              >
                <option value="" disabled>Select a category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Price (₹) *" hint="This drives the Menu-tab price. An add-on/extra dish in a subscription is still billed at the plan's rate, not this price.">
              <Input type="number" value={String(form.price_rupees || "")} onChange={(v) => setForm((f) => ({ ...f, price_rupees: Number(v) || 0 }))} placeholder="329" />
            </Field>
          </Section>

          <Section title="Description">
            <Field label="Card description (short)"><Input value={form.short_description ?? ""} onChange={(v) => setForm((f) => ({ ...f, short_description: v }))} placeholder="Shown on the Menu grid" /></Field>
            <Field label="Full description">
              <textarea value={form.description ?? ""} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Shown in the detail view"
                className="w-full text-sm rounded-lg border border-[#e2e8d5] px-3 py-2.5 bg-[#F9FBF7] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20] resize-none placeholder:text-gray-300" />
            </Field>
          </Section>

          <Section title="Macros (optional)">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Calories"><Input type="number" value={form.kcal?.toString() ?? ""} onChange={(v) => setForm((f) => ({ ...f, kcal: v ? Number(v) : null }))} /></Field>
              <Field label="Protein (g)"><Input type="number" value={form.protein?.toString() ?? ""} onChange={(v) => setForm((f) => ({ ...f, protein: v ? Number(v) : null }))} /></Field>
              <Field label="Carbs (g)"><Input type="number" value={form.carbs?.toString() ?? ""} onChange={(v) => setForm((f) => ({ ...f, carbs: v ? Number(v) : null }))} /></Field>
              <Field label="Fat (g)"><Input type="number" value={form.fat?.toString() ?? ""} onChange={(v) => setForm((f) => ({ ...f, fat: v ? Number(v) : null }))} /></Field>
            </div>
          </Section>

          <Section title="Where this dish appears">
            <Toggle checked={form.menu_visible} onChange={(v) => setForm((f) => ({ ...f, menu_visible: v }))}
              label="Show in Menu tab" sublabel="Subscribers can browse and see it" />
            <Toggle checked={form.subscription_valid} onChange={(v) => setForm((f) => ({ ...f, subscription_valid: v }))}
              label="Available in subscription" sublabel="Can be set in the weekly menu and added to cart" />
            {form.menu_visible && !form.subscription_valid && (
              <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                Visible but not orderable — subscribers will see a Swiggy/Zomato link instead of an add-to-cart button.
              </p>
            )}
            {!form.menu_visible && form.subscription_valid && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Plan-only — not browsable in Menu, but still assignable in the weekly menu for existing subscribers.
              </p>
            )}
          </Section>

          <Section title="Photo">
            {editingId ? (
              <>
                {editingDish?.imageUrl ? (
                  <div className="relative">
                    <img src={editingDish.imageUrl} alt="" className="w-full h-36 rounded-xl object-cover" />
                    <button onClick={handleImageRemove} className="absolute top-2 right-2 bg-white/90 hover:bg-white text-red-600 p-1.5 rounded-lg shadow">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="w-full h-36 rounded-xl bg-[#F9FBF7] border border-dashed border-[#e2e8d5] flex items-center justify-center">
                    <ImageIcon className="w-6 h-6 text-gray-300" />
                  </div>
                )}
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingImage}
                  className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-[#e2e8d5] text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {uploadingImage ? "Processing & uploading…" : editingDish?.imageUrl ? "Replace photo" : "Upload photo"}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImagePick(f); e.target.value = "" }} />
                <p className="text-[11px] text-gray-400">Auto-converted to WebP at two sizes. PNG/JPG accepted.</p>
              </>
            ) : (
              <p className="text-xs text-gray-400 border border-dashed border-[#e2e8d5] rounded-lg p-3 text-center">
                Save the dish first, then upload a photo.
              </p>
            )}
          </Section>
        </div>

        <div className="px-5 py-4 border-t border-[#e2e8d5] bg-[#F9FBF7]">
          <button
            onClick={handleSaveDish}
            disabled={isPending || !form.name.trim() || !form.category}
            className="w-full h-10 rounded-xl bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] disabled:opacity-40 transition-colors"
          >
            {isPending ? "Saving…" : editingId ? "Save Changes" : "Create Dish"}
          </button>
        </div>
      </aside>

      {/* ── Category slide-in panel ── */}
      <div className={cn("fixed inset-0 bg-black/30 z-40 transition-opacity duration-300", catPanelOpen ? "opacity-100" : "opacity-0 pointer-events-none")} onClick={() => setCatPanelOpen(false)} />
      <aside className={cn("fixed right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out", catPanelOpen ? "translate-x-0" : "translate-x-full")}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e2e8d5] bg-[#F9FBF7]">
          <h2 className="text-base font-semibold text-[#1A1A1A]">Categories</h2>
          <button onClick={() => setCatPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <Section title={editingCatId ? "Edit category" : "New category"}>
            <Field label="Name *"><Input value={catForm.name} onChange={(v) => setCatForm((f) => ({ ...f, name: v }))} placeholder="Soup" /></Field>
            <Field label="Sort order"><Input type="number" value={String(catForm.sortOrder)} onChange={(v) => setCatForm((f) => ({ ...f, sortOrder: Number(v) || 0 }))} /></Field>
            <Field label="Emoji fallback"><Input value={catForm.emoji} onChange={(v) => setCatForm((f) => ({ ...f, emoji: v }))} placeholder="🍲" /></Field>
            {editingCatId && (
              <>
                {categories.find((c) => c.id === editingCatId)?.imageUrl && (
                  <img src={categories.find((c) => c.id === editingCatId)?.imageUrl ?? ""} alt="" className="w-16 h-16 rounded-xl object-cover" />
                )}
                <button
                  onClick={() => catFileRef.current?.click()}
                  disabled={uploadingCatImage}
                  className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-[#e2e8d5] text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" /> {uploadingCatImage ? "Uploading…" : "Upload icon"}
                </button>
                <input ref={catFileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCategoryImagePick(f); e.target.value = "" }} />
              </>
            )}
            <button
              onClick={handleSaveCategory}
              disabled={isPending || !catForm.name.trim()}
              className="w-full h-10 rounded-xl bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] disabled:opacity-40 transition-colors"
            >
              {editingCatId ? "Save Changes" : "Create Category"}
            </button>
            {editingCatId && (
              <button onClick={() => { setEditingCatId(null); setCatForm({ name: "", sortOrder: 0, emoji: "" }) }}
                className="w-full h-9 rounded-xl border border-[#e2e8d5] text-gray-500 text-sm hover:bg-gray-50 transition-colors">
                Cancel edit
              </button>
            )}
          </Section>

          <Section title="All categories">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-7 h-7 rounded-full object-cover" /> : <span className="text-lg">{c.emoji ?? "🍽️"}</span>}
                  <span className="text-sm text-[#1A1A1A] truncate">{c.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEditCategory(c)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#1B5E20] hover:bg-green-50"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDeleteCategory(c.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </Section>
        </div>
      </aside>

      {/* Toast */}
      {toast && (
        <div className={cn("fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white", toast.type === "success" ? "bg-[#1B5E20]" : "bg-red-600")}>
          {toast.type === "success" ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function mapDishRow(row: any): Dish {
  return {
    id: row.id, name: row.name, category: row.category,
    shortDescription: row.short_description, description: row.description,
    priceRupees: row.price / 100, kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat,
    tags: row.tags ?? [], imageUrl: row.image_url, thumbUrl: row.thumb_url, blurDataUrl: row.blur_data_url,
    isActive: row.is_active, menuVisible: row.menu_visible, subscriptionValid: row.subscription_valid,
  }
}
