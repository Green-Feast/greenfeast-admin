// The day's printed lists, in the format the kitchen and riders already use
// (daily_lists_DDMMYY.pdf): one page per batch for the master list, then the
// kitchen sheets, then the delivery sheets.
//   • Codes N/C/01: batch initial / C (has constraints) or R (regular) / number.
//     C rows first (yellow), then R rows (green).
//   • Allergies, gluten-free, vegan and no-paneer print in bold red.
//   • "2 Burrito Bowl" — portions in bold.
//   • Lunch and Evening tallies, "Items to Prepare" per kitchen sheet, and a
//     "Name — COD amount" box for anyone paying cash on that route.
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

export type Slot = "lunch" | "dinner"

export type ListRow = {
  orderId: string
  subscriptionId: string
  batch: string
  mealSlot: Slot
  rc: "C" | "R"
  name: string
  phone: string
  address: string
  meal: string
  quantity: number
  constraints: string
  addons: string
  addonList: { name: string; qty: number }[]
  timing: string
  note?: string
  codDue: number
}

type RGB = [number, number, number]
type Coded = ListRow & { code: string }
type Section = { batch: string; slot: Slot; color: RGB; rows: Coded[] }
type Seg = { text: string; bold?: boolean; red?: boolean }

// Batch colours in order of appearance (lunch batches A–Z, then dinner).
const PALETTE: RGB[] = [
  [220, 230, 241], // blue-grey
  [226, 239, 218], // green
  [252, 228, 214], // peach
  [221, 238, 245], // cyan
  [228, 223, 236], // lavender
  [255, 242, 204], // yellow
  [237, 237, 237], // grey
]
const KITCHEN: RGB = [249, 225, 225]
const C_TINT: RGB = [255, 242, 204]
const R_TINT: RGB = [234, 244, 228]
const RED: RGB = [156, 0, 6]
const BLACK: RGB = [20, 20, 20]
const GRID: RGB = [160, 160, 160]
const COD_FILL: RGB = [255, 242, 204]

const MARGIN = 10
const TOP = 16 // below the page header
const FONT = 9

// Phrases the kitchen must never miss.
const CRITICAL = /(ALLERGIC TO [^,.;]+|GLUTEN[\s-]?FREE|NO PANEER|VEGAN)/gi

function ddmmyy(iso: string) {
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y.slice(2)}`
}

function phone10(p: string) {
  return p.replace(/^\+91/, "")
}

function sectionTitle(batch: string) {
  return /batch$/i.test(batch.trim()) ? batch.trim() : `${batch.trim()} Batch`
}

export function buildSections(rows: ListRow[], slots: Slot[]): Section[] {
  const out: Section[] = []
  let colour = 0
  const byName = (a: ListRow, b: ListRow) => a.name.localeCompare(b.name)
  for (const slot of slots) {
    const names = [...new Set(rows.filter((r) => r.mealSlot === slot).map((r) => r.batch))].sort((a, b) =>
      a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)
    )
    for (const batch of names) {
      const list = rows.filter((r) => r.mealSlot === slot && r.batch === batch)
      const ordered = [...list.filter((r) => r.rc === "C").sort(byName), ...list.filter((r) => r.rc === "R").sort(byName)]
      const prefix = (batch.trim()[0] ?? "X").toUpperCase()
      out.push({
        batch,
        slot,
        color: PALETTE[colour++ % PALETTE.length],
        rows: ordered.map((r, i) => ({ ...r, code: `${prefix}/${r.rc}/${String(i + 1).padStart(2, "0")}` })),
      })
    }
  }
  return out
}

// "Burrito Bowl: 28 | Italian Harvest: 1 | Smoothie: 1" — portions per dish,
// then smoothies (made separately; other add-ons go on the bowl).
function tally(rows: ListRow[]) {
  const meals = new Map<string, number>()
  let smoothies = 0
  for (const r of rows) {
    meals.set(r.meal, (meals.get(r.meal) ?? 0) + (r.quantity || 1))
    for (const a of r.addonList) if (/smoothie/i.test(a.name)) smoothies += a.qty
  }
  const parts = [...meals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([m, n]) => `${m}: ${n}`)
  if (smoothies > 0) parts.push(`Smoothie: ${smoothies}`)
  return parts.join("  |  ")
}

function constraintSegs(text: string): Seg[] {
  if (!text) return []
  const segs: Seg[] = []
  let last = 0
  for (const m of text.matchAll(CRITICAL)) {
    const i = m.index ?? 0
    if (i > last) segs.push({ text: text.slice(last, i) })
    segs.push({ text: m[0], bold: true, red: true })
    last = i + m[0].length
  }
  if (last < text.length) segs.push({ text: text.slice(last) })
  return segs
}

function mealSegs(r: ListRow): Seg[] {
  return r.quantity > 1 ? [{ text: `${r.quantity} `, bold: true }, { text: r.meal }] : [{ text: r.meal }]
}

// Greedy word wrap across segments with different weights.
function layout(doc: jsPDF, segs: Seg[], width: number, size: number): Seg[][] {
  const lines: Seg[][] = [[]]
  let used = 0
  for (const seg of segs) {
    doc.setFont("helvetica", seg.bold ? "bold" : "normal")
    doc.setFontSize(size)
    for (const word of seg.text.split(/(?<=\s)/)) {
      if (!word) continue
      const w = doc.getTextWidth(word)
      if (used + w > width && used > 0 && word.trim()) {
        lines.push([])
        used = 0
      }
      const line = lines[lines.length - 1]
      const text = used === 0 ? word.replace(/^\s+/, "") : word
      const prev = line[line.length - 1]
      if (prev && prev.bold === seg.bold && prev.red === seg.red) prev.text += text
      else line.push({ text, bold: seg.bold, red: seg.red })
      used += doc.getTextWidth(text)
    }
  }
  return lines.filter((l, i) => l.length > 0 || i === 0)
}

type Col = {
  header: string
  width: number
  text?: (r: Coded) => string
  rich?: (r: Coded) => Seg[]
  bold?: boolean
  tint?: boolean
}

function titleBar(doc: jsPDF, y: number, title: string, fill: RGB) {
  const w = doc.internal.pageSize.getWidth() - MARGIN * 2
  doc.setFillColor(...fill)
  doc.setDrawColor(...GRID)
  doc.setLineWidth(0.2)
  doc.rect(MARGIN, y, w, 8, "FD")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(13)
  doc.setTextColor(...BLACK)
  doc.text(title, MARGIN + 2.5, y + 5.6)
  return y + 8
}

function table(doc: jsPDF, startY: number, cols: Col[], rows: Coded[], headFill: RGB): number {
  const rich = new Map<string, Seg[][]>()
  const padding = 1.6
  autoTable(doc, {
    startY,
    margin: { top: TOP + 2, left: MARGIN, right: MARGIN, bottom: 12 },
    head: [cols.map((c) => c.header)],
    body: rows.map((r) => cols.map((c) => (c.text ? c.text(r) : ""))),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: FONT,
      cellPadding: padding,
      lineColor: GRID,
      lineWidth: 0.2,
      textColor: BLACK,
      valign: "top",
      overflow: "linebreak",
    },
    headStyles: { fillColor: headFill, textColor: BLACK, fontStyle: "bold", fontSize: 9.5 },
    columnStyles: Object.fromEntries(cols.map((c, i) => [i, { cellWidth: c.width }])),
    didParseCell: (data: any) => {
      if (data.section !== "body") return
      const col = cols[data.column.index]
      const row = rows[data.row.index]
      if (col.bold) data.cell.styles.fontStyle = "bold"
      if (col.tint) data.cell.styles.fillColor = row.rc === "C" ? C_TINT : R_TINT
      if (col.rich) {
        const lines = layout(doc, col.rich(row), col.width - padding * 2, FONT)
        rich.set(`${data.row.index}:${data.column.index}`, lines)
        data.cell.text = lines.map((l) => l.map((s) => s.text).join(""))
      }
    },
    willDrawCell: (data: any) => {
      if (data.section === "body" && rich.has(`${data.row.index}:${data.column.index}`)) data.cell.text = []
    },
    didDrawCell: (data: any) => {
      if (data.section !== "body") return
      const lines = rich.get(`${data.row.index}:${data.column.index}`)
      if (!lines) return
      const lh = (FONT * doc.getLineHeightFactor()) / doc.internal.scaleFactor
      let y = data.cell.y + data.cell.padding("top")
      for (const line of lines) {
        let x = data.cell.x + data.cell.padding("left")
        for (const s of line) {
          doc.setFont("helvetica", s.bold ? "bold" : "normal")
          doc.setFontSize(FONT)
          doc.setTextColor(...(s.red ? RED : BLACK))
          doc.text(s.text, x, y, { baseline: "top" })
          x += doc.getTextWidth(s.text)
        }
        y += lh
      }
      doc.setTextColor(...BLACK)
    },
  })
  return (doc as any).lastAutoTable.finalY as number
}

function labelLine(doc: jsPDF, y: number, label: string, text: string) {
  if (y > doc.internal.pageSize.getHeight() - 14) {
    doc.addPage()
    y = TOP + 4
  }
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9.5)
  doc.setTextColor(...BLACK)
  doc.text(label, MARGIN, y)
  const w = doc.getTextWidth(label) + 1.8
  doc.setFont("helvetica", "normal")
  doc.text(text, MARGIN + w, y)
  return y + 6
}

const MASTER_COLS: Col[] = [
  { header: "Code", width: 17, text: (r) => r.code, bold: true, tint: true },
  { header: "R/C", width: 8, text: (r) => r.rc, bold: true, tint: true },
  { header: "Name", width: 32, text: (r) => r.name },
  { header: "Phone", width: 25, text: (r) => phone10(r.phone) },
  { header: "Address", width: 52, text: (r) => r.address },
  { header: "Meal", width: 27, rich: mealSegs },
  { header: "Constraints", width: 44, rich: (r) => constraintSegs(r.constraints) },
  { header: "Add-ons", width: 22, text: (r) => r.addons },
  { header: "Timing", width: 19, text: (r) => r.timing, bold: true },
  { header: "Note", width: 31, text: (r) => r.note ?? "" },
]

const KITCHEN_COLS: Col[] = [
  { header: "Code", width: 22, text: (r) => r.code, bold: true, tint: true },
  { header: "R/C", width: 12, text: (r) => r.rc, bold: true, tint: true },
  { header: "Name", width: 48, text: (r) => r.name },
  { header: "Meal", width: 48, rich: mealSegs },
  { header: "Constraints", width: 104, rich: (r) => constraintSegs(r.constraints) },
  { header: "Add-ons", width: 43, text: (r) => r.addons },
]

const DELIVERY_COLS: Col[] = [
  { header: "Code", width: 22, text: (r) => r.code, bold: true, tint: true },
  { header: "Name", width: 48, text: (r) => r.name },
  { header: "Phone", width: 36, text: (r) => phone10(r.phone) },
  { header: "Address", width: 138, text: (r) => r.address },
  { header: "Timing", width: 33, text: (r) => r.timing, bold: true },
]

function codBoxes(doc: jsPDF, y: number, rows: Coded[]) {
  const seen = new Set<string>()
  const w = doc.internal.pageSize.getWidth() - MARGIN * 2
  for (const r of rows) {
    if (r.codDue <= 0 || seen.has(r.subscriptionId)) continue
    seen.add(r.subscriptionId)
    if (y > doc.internal.pageSize.getHeight() - 18) {
      doc.addPage()
      y = TOP + 2
    }
    doc.setFillColor(...COD_FILL)
    doc.setDrawColor(...GRID)
    doc.rect(MARGIN, y, w, 7, "FD")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...BLACK)
    doc.text(`${r.name} — COD ${Math.round(r.codDue / 100)}`, MARGIN + 2.5, y + 4.8)
    y += 7
  }
  return y
}

function masterPages(doc: jsPDF, sections: Section[], first: { value: boolean }) {
  sections.forEach((s, i) => {
    if (!first.value) doc.addPage()
    first.value = false
    let y = titleBar(doc, TOP, sectionTitle(s.batch), s.color)
    y = table(doc, y, MASTER_COLS, s.rows, s.color)
    const lastOfSlot = sections.slice(i + 1).every((n) => n.slot !== s.slot)
    if (lastOfSlot) {
      const slotRows = sections.filter((n) => n.slot === s.slot).flatMap((n) => n.rows)
      labelLine(doc, y + 6, s.slot === "lunch" ? "Lunch Tally:" : "Evening Tally:", tally(slotRows))
    }
  })
}

function kitchenPages(doc: jsPDF, sections: Section[], first: { value: boolean }) {
  for (const s of sections) {
    if (!first.value) doc.addPage()
    first.value = false
    let y = titleBar(doc, TOP, `${s.batch} — Kitchen`, KITCHEN)
    y = table(doc, y, KITCHEN_COLS, s.rows, KITCHEN)
    labelLine(doc, y + 6, "Items to Prepare:", tally(s.rows))
  }
}

function deliveryPages(doc: jsPDF, sections: Section[], first: { value: boolean }) {
  for (const s of sections) {
    if (!first.value) doc.addPage()
    first.value = false
    let y = titleBar(doc, TOP, `${s.batch} — Delivery`, s.color)
    y = table(doc, y, DELIVERY_COLS, s.rows, s.color)
    codBoxes(doc, y + 1, s.rows)
  }
}

// "GreenFeast • Date: 13/10/26 … Page N" on every page.
function stampPages(doc: jsPDF, date: string, provisional: string | null) {
  const n = doc.getNumberOfPages()
  const w = doc.internal.pageSize.getWidth()
  for (let p = 1; p <= n; p++) {
    doc.setPage(p)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...BLACK)
    doc.text(`GreenFeast  •  Date: ${ddmmyy(date)}`, MARGIN, 9)
    doc.setFont("helvetica", "normal")
    doc.text(`Page ${p}`, w - MARGIN, 9, { align: "right" })
    if (provisional) {
      doc.setTextColor(180, 100, 0)
      doc.text(provisional, w / 2, 9, { align: "center" })
      doc.setTextColor(...BLACK)
    }
    doc.setDrawColor(...GRID)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, 11, w - MARGIN, 11)
  }
}

function newDoc() {
  return new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
}

function fileDate(date: string) {
  return ddmmyy(date).replace(/\//g, "")
}

// Everything for the day: master list, kitchen sheets, delivery sheets.
export function generateDailyLists(rows: ListRow[], date: string, provisional: string | null) {
  const sections = buildSections(rows, ["lunch", "dinner"])
  const doc = newDoc()
  const first = { value: true }
  masterPages(doc, sections, first)
  kitchenPages(doc, sections, first)
  deliveryPages(doc, sections, first)
  stampPages(doc, date, provisional)
  doc.save(`daily_lists_${fileDate(date)}.pdf`)
}

export function generateKitchenSheets(rows: ListRow[], date: string, slot: Slot, provisional: string | null) {
  const doc = newDoc()
  // Built for the whole day so colours and codes match the daily lists.
  kitchenPages(doc, buildSections(rows, ["lunch", "dinner"]).filter((s) => s.slot === slot), { value: true })
  stampPages(doc, date, provisional)
  doc.save(`kitchen_${slot}_${fileDate(date)}.pdf`)
}

export function generateDeliverySheet(rows: ListRow[], date: string, slot: Slot, batch: string, provisional: string | null) {
  const section = buildSections(rows, ["lunch", "dinner"]).find((s) => s.slot === slot && s.batch === batch)
  if (!section) return
  const doc = newDoc()
  deliveryPages(doc, [section], { value: true })
  stampPages(doc, date, provisional)
  doc.save(`${batch.replace(/\s+/g, "_")}_delivery_${fileDate(date)}.pdf`)
}
