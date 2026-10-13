"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, Send, Bell, MessageCircle, Check, Users, UserCheck, ListChecks, Zap, RotateCcw, Bookmark, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendBroadcast, saveTemplate, resetTemplate, saveMessage, deleteMessage, type AudienceMode } from "./actions";

export type Audience = {
  userId: string;
  name: string;
  phone: string | null;
  batchLunch: string;
  batchDinner: string;
  plan: string;
  status: string;
};

export type Broadcast = {
  id: string;
  type: string;
  title: string;
  body: string;
  channels: string[];
  recipient_count: number;
  push_sent_count: number;
  whatsapp_sent_count: number;
  created_by: string | null;
  created_at: string;
};

export type TemplateRow = {
  key: string;
  kind: "event" | "saved";
  label: string;
  description: string | null;
  title: string;
  body: string;
  enabled: boolean;
  placeholders: string[];
  default_title: string | null;
  default_body: string | null;
  updated_at: string;
  updated_by: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  promotional: "Promotional",
  custom: "General",
  delivery_status: "Delivery status (auto)",
  renewal_reminder: "Renewal reminder (auto)",
};

// Example values for the preview of each placeholder.
const SAMPLE: Record<string, string> = {
  name: "Riya",
  slot: "lunch",
  date: "Wed 15 Oct",
  day: "Wednesday, 15 Oct",
  need: "₹520",
  balance: "₹180",
  reason: " (Diwali)",
  meals_left: "2",
  amount: "₹7,200",
  cash_due: "₹0",
  meals: "30",
  wallet_note: " and ₹7,499 is in your wallet",
};

function render(text: string) {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => SAMPLE[key] ?? whole);
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function NotificationsClient({
  audience,
  everyoneCount,
  initialBroadcasts,
  templates,
  whatsappConfigured,
}: {
  audience: Audience[];
  everyoneCount: number;
  initialBroadcasts: Broadcast[];
  templates: TemplateRow[];
  whatsappConfigured: boolean;
}) {
  const [tab, setTab] = useState<"send" | "auto">("send");

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-6">
      <div>
        <p className="text-sm text-[#1B5E20] font-medium flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5" /> COMMUNICATIONS
        </p>
        <h1 className="text-3xl font-bold text-[#1A1A1A] mt-1">Notifications</h1>
        <p className="text-gray-500 mt-1">
          Send a message to everyone or to chosen customers, and edit the messages the app sends on its own
          (out for delivery, delivered, low wallet, kitchen closed…).
        </p>
      </div>

      <div className="flex rounded-lg border border-[#e2e8d5] overflow-hidden w-fit">
        {([["send", "Send a message", Send], ["auto", "Automated messages", Zap]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn("flex items-center gap-1.5 px-4 py-2 text-sm font-medium", tab === key ? "bg-[#1B5E20] text-white" : "bg-white text-gray-600 hover:bg-gray-50")}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "send" ? (
        <Composer
          audience={audience}
          everyoneCount={everyoneCount}
          initialBroadcasts={initialBroadcasts}
          saved={templates.filter((t) => t.kind === "saved")}
          whatsappConfigured={whatsappConfigured}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Words in <code className="px-1 rounded bg-gray-100">{"{curly brackets}"}</code> are filled in for each customer —
            click one to add it. Switch a message off to stop sending it.
          </p>
          {templates.filter((t) => t.kind === "event").map((t) => <TemplateCard key={t.key} template={t} />)}
        </div>
      )}
    </div>
  );
}

// ── Broadcast composer ────────────────────────────────────────────────────

function Composer({
  audience, everyoneCount, initialBroadcasts, saved, whatsappConfigured,
}: {
  audience: Audience[];
  everyoneCount: number;
  initialBroadcasts: Broadcast[];
  saved: TemplateRow[];
  whatsappConfigured: boolean;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<"promotional" | "custom">("custom");
  const [pushOn, setPushOn] = useState(true);
  const [waOn, setWaOn] = useState(false);
  const [mode, setMode] = useState<AudienceMode>("all");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [batchFilter, setBatchFilter] = useState("All");
  const [planFilter, setPlanFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [broadcasts, setBroadcasts] = useState(initialBroadcasts);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState("");

  const batches = useMemo(() => ["All", ...Array.from(new Set(audience.flatMap((a) => [a.batchLunch, a.batchDinner])))], [audience]);
  const plans = useMemo(() => ["All", ...Array.from(new Set(audience.map((a) => a.plan)))], [audience]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audience.filter((a) => {
      if (statusFilter !== "All" && a.status !== statusFilter) return false;
      if (batchFilter !== "All" && a.batchLunch !== batchFilter && a.batchDinner !== batchFilter) return false;
      if (planFilter !== "All" && a.plan !== planFilter) return false;
      if (q && !a.name.toLowerCase().includes(q) && !(a.phone ?? "").includes(q)) return false;
      return true;
    });
  }, [audience, search, statusFilter, batchFilter, planFilter]);

  const count = mode === "all" ? everyoneCount : mode === "subscribers" ? audience.length : selected.size;

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function applySaved(key: string) {
    setSavedKey(key);
    const t = saved.find((s) => s.key === key);
    if (t) {
      setTitle(t.title);
      setBody(t.body);
      setType("promotional");
    }
  }

  function handleSaveMessage() {
    const existing = saved.find((s) => s.key === savedKey);
    const label = window.prompt("Name for this saved message", existing?.label ?? title);
    if (!label) return;
    setError(null);
    startTransition(async () => {
      try {
        await saveMessage({ key: existing && existing.label === label ? existing.key : undefined, label, title, body });
        setResult(`Saved "${label}" — pick it from Saved messages next time.`);
      } catch (e: any) {
        setError(e?.message ?? "Could not save.");
      }
    });
  }

  function handleDeleteSaved() {
    const t = saved.find((s) => s.key === savedKey);
    if (!t || !window.confirm(`Delete the saved message "${t.label}"?`)) return;
    startTransition(async () => {
      try {
        await deleteMessage(t.key);
        setSavedKey("");
      } catch (e: any) {
        setError(e?.message ?? "Could not delete.");
      }
    });
  }

  function handleSend() {
    setError(null);
    setResult(null);
    if (mode !== "selected" && !window.confirm(`Send "${title.trim()}" to ${count} ${mode === "all" ? "customers (everyone)" : "subscribers"}?`)) return;

    const channels: ("push" | "whatsapp")[] = [
      ...(pushOn ? (["push"] as const) : []),
      ...(waOn ? (["whatsapp"] as const) : []),
    ];

    startTransition(async () => {
      try {
        const summary = await sendBroadcast({
          title,
          body,
          channels,
          type,
          audience: mode,
          userIds: mode === "selected" ? Array.from(selected) : undefined,
          audienceDescription:
            mode === "all" ? "Everyone"
            : mode === "subscribers" ? "All subscribers"
            : `${selected.size} selected (status=${statusFilter}, batch=${batchFilter}, plan=${planFilter})`,
        });
        setResult(
          `Sent to ${summary.sent} recipient${summary.sent === 1 ? "" : "s"} — ${summary.pushSent} push delivered${waOn ? `, ${summary.whatsappSent} WhatsApp delivered` : ""}.`
        );
        setBroadcasts((prev) => [
          {
            id: crypto.randomUUID(),
            type,
            title,
            body,
            channels,
            recipient_count: summary.sent,
            push_sent_count: summary.pushSent,
            whatsapp_sent_count: summary.whatsappSent,
            created_by: null,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        setTitle("");
        setBody("");
        setSavedKey("");
        setSelected(new Set());
      } catch (e: any) {
        setError(e?.message ?? "Could not send. Try again.");
      }
    });
  }

  const canSend = title.trim() && body.trim() && count > 0 && (pushOn || waOn) && !pending;

  return (
    <>
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 space-y-5">
        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Bookmark className="w-4 h-4 text-[#1B5E20]" />
            <select
              value={savedKey}
              onChange={(e) => applySaved(e.target.value)}
              className="h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm"
            >
              <option value="">Saved messages…</option>
              {saved.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {savedKey && (
              <button onClick={handleDeleteSaved} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Delete saved
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 20% off your next top-up"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "promotional" | "custom")}
              className="h-9 w-full rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
            >
              <option value="custom">General</option>
              <option value="promotional">Promotional</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-neutral-700">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What should it say? {name} becomes each person's first name."
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20] resize-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Tip: <code className="px-1 rounded bg-gray-100">{"{name}"}</code> → &quot;Hi Riya&quot;</p>
            <button
              type="button"
              disabled={!title.trim() || !body.trim() || pending}
              onClick={handleSaveMessage}
              className="text-xs font-medium text-[#1B5E20] hover:underline disabled:opacity-40 flex items-center gap-1"
            >
              <Bookmark className="w-3 h-3" /> Save as saved message
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setPushOn((v) => !v)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
              pushOn ? "bg-[#1B5E20] text-white border-[#1B5E20]" : "bg-white text-neutral-600 border-black/10"
            )}
          >
            {pushOn && <Check className="w-3.5 h-3.5" />}
            <Bell className="w-3.5 h-3.5" /> App push
          </button>
          <button
            type="button"
            disabled={!whatsappConfigured}
            onClick={() => setWaOn((v) => !v)}
            title={whatsappConfigured ? undefined : "No WhatsApp provider configured yet"}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors",
              !whatsappConfigured
                ? "bg-neutral-50 text-neutral-400 border-black/5 cursor-not-allowed"
                : waOn
                ? "bg-[#25D366] text-white border-[#25D366]"
                : "bg-white text-neutral-600 border-black/10"
            )}
          >
            {waOn && whatsappConfigured && <Check className="w-3.5 h-3.5" />}
            <MessageCircle className="w-3.5 h-3.5" />
            WhatsApp {!whatsappConfigured && "(not configured)"}
          </button>
        </div>

        {/* Audience */}
        <div className="pt-2 border-t border-black/5 space-y-3">
          <p className="text-sm font-medium text-neutral-700">Send to</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {([
              ["all", "Everyone", `${everyoneCount} customers, with or without a plan`, Users],
              ["subscribers", "All subscribers", `${audience.length} with an active, paused or pending plan`, UserCheck],
              ["selected", "Pick people", `${selected.size} selected`, ListChecks],
            ] as const).map(([key, label, sub, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={cn(
                  "text-left p-3 rounded-xl border transition-colors",
                  mode === key ? "border-[#1B5E20] bg-[#E8F5E9]" : "border-[#e2e8d5] hover:bg-gray-50"
                )}
              >
                <p className="text-sm font-semibold text-[#1A1A1A] flex items-center gap-1.5"><Icon className="w-4 h-4" /> {label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
              </button>
            ))}
          </div>

          {mode === "selected" && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-neutral-600">{selected.size} selected</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelected((prev) => { const n = new Set(prev); filtered.forEach((a) => n.add(a.userId)); return n; })}
                    className="text-xs font-medium text-[#1B5E20] hover:underline"
                  >
                    Select all filtered ({filtered.length})
                  </button>
                  <button onClick={() => setSelected(new Set())} className="text-xs font-medium text-neutral-500 hover:underline">
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or phone…"
                    className="w-full h-9 rounded-lg border border-[#e2e8d5] pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
                  />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm">
                  {["All", "active", "paused", "pending"].map((s) => <option key={s} value={s}>{s === "All" ? "All statuses" : s}</option>)}
                </select>
                <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} className="h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm">
                  {batches.map((b) => <option key={b} value={b}>{b === "All" ? "All batches" : b}</option>)}
                </select>
                <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className="h-9 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm">
                  {plans.map((p) => <option key={p} value={p}>{p === "All" ? "All plans" : p}</option>)}
                </select>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-lg border border-black/5 divide-y divide-black/5">
                {filtered.length === 0 && (
                  <p className="text-sm text-neutral-400 p-4 text-center">No subscribers match these filters.</p>
                )}
                {filtered.map((a) => (
                  <label key={a.userId} className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(a.userId)}
                      onChange={() => toggle(a.userId)}
                      className="accent-[#1B5E20]"
                    />
                    <span className="font-medium text-[#1A1A1A]">{a.name}</span>
                    <span className="text-neutral-400">{a.phone ?? "no phone"}</span>
                    <span className="ml-auto text-xs text-neutral-500">L: {a.batchLunch} · D: {a.batchDinner} · {a.plan}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && <p className="text-sm text-[#1B5E20]">{result}</p>}

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="flex items-center gap-2 rounded-lg bg-[#1B5E20] text-white text-sm font-semibold px-4 py-2.5 hover:bg-[#164d1a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          {pending ? "Sending…" : mode === "all" ? `Send to all ${count}` : `Send to ${count}`}
        </button>
      </div>

      {/* History */}
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm">
        <div className="px-6 py-4 border-b border-black/5">
          <h2 className="font-semibold text-[#1A1A1A]">Recent sends</h2>
        </div>
        <div className="divide-y divide-black/5">
          {broadcasts.length === 0 && (
            <p className="text-sm text-neutral-400 p-6 text-center">Nothing sent yet.</p>
          )}
          {broadcasts.map((b) => (
            <div key={b.id} className="px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-[#1A1A1A]">{b.title}</p>
                  <p className="text-sm text-neutral-500 mt-0.5">{b.body}</p>
                </div>
                <span className="text-xs font-medium text-neutral-500 whitespace-nowrap">
                  {TYPE_LABEL[b.type] ?? b.type}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500">
                <span>{formatDateTime(b.created_at)}</span>
                <span>{b.recipient_count} recipient{b.recipient_count === 1 ? "" : "s"}</span>
                {b.channels.includes("push") && <span>{b.push_sent_count} push delivered</span>}
                {b.channels.includes("whatsapp") && <span>{b.whatsapp_sent_count} WhatsApp delivered</span>}
                {b.created_by && <span>by {b.created_by}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Automated message editor ──────────────────────────────────────────────

function TemplateCard({ template }: { template: TemplateRow }) {
  const [title, setTitle] = useState(template.title);
  const [body, setBody] = useState(template.body);
  const [enabled, setEnabled] = useState(template.enabled);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = title !== template.title || body !== template.body || enabled !== template.enabled;
  const isDefault = title === template.default_title && body === template.default_body;

  function save(next?: { enabled: boolean }) {
    setNote(null);
    startTransition(async () => {
      try {
        await saveTemplate(template.key, { title, body, enabled: next?.enabled ?? enabled });
        setNote({ ok: true, text: "Saved — the next message uses this." });
      } catch (e: any) {
        setNote({ ok: false, text: e?.message ?? "Could not save." });
      }
    });
  }

  return (
    <div className={cn("bg-white rounded-2xl border shadow-sm p-5 space-y-3", enabled ? "border-black/5" : "border-dashed border-gray-300 opacity-80")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-[#1A1A1A]">{template.label}</p>
          {template.description && <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>}
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-gray-600 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setEnabled(e.target.checked); save({ enabled: e.target.checked }); }}
            className="accent-[#1B5E20] w-4 h-4"
          />
          {enabled ? "On" : "Off"}
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20]"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20] resize-none"
          />
          <div className="flex flex-wrap gap-1">
            {template.placeholders.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setBody((b) => `${b}${b.endsWith(" ") || !b ? "" : " "}{${p}}`)}
                className="px-1.5 py-0.5 rounded bg-gray-100 text-[11px] font-mono text-gray-600 hover:bg-[#E8F5E9] hover:text-[#1B5E20]"
              >
                {`{${p}}`}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-[#F9FBF7] border border-[#e2e8d5] p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Preview</p>
          <p className="text-sm font-semibold text-[#1A1A1A]">{render(title)}</p>
          <p className="text-sm text-gray-600 mt-0.5">{render(body)}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          disabled={!dirty || pending || !title.trim() || !body.trim()}
          onClick={() => save()}
          className="px-4 py-1.5 rounded-lg bg-[#1B5E20] text-white text-sm font-medium disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {!isDefault && template.default_title && (
          <button
            disabled={pending}
            onClick={() => startTransition(async () => {
              try {
                const t = await resetTemplate(template.key);
                setTitle(t.title);
                setBody(t.body);
                setNote({ ok: true, text: "Back to the original text." });
              } catch (e: any) {
                setNote({ ok: false, text: e?.message ?? "Could not reset." });
              }
            })}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#1B5E20]"
          >
            <RotateCcw className="w-3 h-3" /> Reset to original
          </button>
        )}
        {note && <span className={cn("text-xs", note.ok ? "text-[#1B5E20]" : "text-red-600")}>{note.text}</span>}
        {template.updated_by && !note && (
          <span className="text-[11px] text-gray-400 ml-auto">edited by {template.updated_by} · {formatDateTime(template.updated_at)}</span>
        )}
      </div>
    </div>
  );
}
