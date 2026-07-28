"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, Send, Bell, MessageCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendBroadcast } from "./actions";

export type Audience = {
  userId: string;
  name: string;
  phone: string | null;
  batch: string;
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

const TYPE_LABEL: Record<string, string> = {
  promotional: "Promotional",
  custom: "General",
  delivery_status: "Delivery status (auto)",
  renewal_reminder: "Renewal reminder (auto)",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function NotificationsClient({
  audience,
  initialBroadcasts,
  whatsappConfigured,
}: {
  audience: Audience[];
  initialBroadcasts: Broadcast[];
  whatsappConfigured: boolean;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<"promotional" | "custom">("custom");
  const [pushOn, setPushOn] = useState(true);
  const [waOn, setWaOn] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [batchFilter, setBatchFilter] = useState("All");
  const [planFilter, setPlanFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [broadcasts, setBroadcasts] = useState(initialBroadcasts);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const batches = useMemo(() => ["All", ...Array.from(new Set(audience.map((a) => a.batch)))], [audience]);
  const plans = useMemo(() => ["All", ...Array.from(new Set(audience.map((a) => a.plan)))], [audience]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audience.filter((a) => {
      if (statusFilter !== "All" && a.status !== statusFilter) return false;
      if (batchFilter !== "All" && a.batch !== batchFilter) return false;
      if (planFilter !== "All" && a.plan !== planFilter) return false;
      if (q && !a.name.toLowerCase().includes(q) && !(a.phone ?? "").includes(q)) return false;
      return true;
    });
  }, [audience, search, statusFilter, batchFilter, planFilter]);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((a) => next.add(a.userId));
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function handleSend() {
    setError(null);
    setResult(null);

    const recipients = audience
      .filter((a) => selected.has(a.userId))
      .map((a) => ({ userId: a.userId, name: a.name, phone: a.phone }));

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
          recipients,
          audienceDescription: `${recipients.length} selected (status=${statusFilter}, batch=${batchFilter}, plan=${planFilter})`,
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
            recipient_count: recipients.length,
            push_sent_count: summary.pushSent,
            whatsapp_sent_count: summary.whatsappSent,
            created_by: null,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        setTitle("");
        setBody("");
        clearSelection();
      } catch (e: any) {
        setError(e?.message ?? "Could not send. Try again.");
      }
    });
  }

  const canSend = title.trim() && body.trim() && selected.size > 0 && (pushOn || waOn) && !pending;

  return (
    <div className="p-6 md:p-8 max-w-5xl space-y-8">
      <div>
        <p className="text-sm text-[#1B5E20] font-medium flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5" /> COMMUNICATIONS
        </p>
        <h1 className="text-3xl font-bold text-[#1A1A1A] mt-1">Notifications</h1>
        <p className="text-gray-500 mt-1">
          Send a push or WhatsApp message to selected subscribers. Delivery-status
          updates and renewal reminders send automatically — this composer is for
          promotional and one-off messages.
        </p>
      </div>

      {/* Compose */}
      <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 space-y-5">
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
            placeholder="What should it say?"
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20] resize-none"
          />
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
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-700">
              Recipients — {selected.size} selected
            </p>
            <div className="flex gap-2">
              <button onClick={selectAllFiltered} className="text-xs font-medium text-[#1B5E20] hover:underline">
                Select all filtered ({filtered.length})
              </button>
              <button onClick={clearSelection} className="text-xs font-medium text-neutral-500 hover:underline">
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
                <span className="ml-auto text-xs text-neutral-500">{a.batch} · {a.plan}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && <p className="text-sm text-[#1B5E20]">{result}</p>}

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="flex items-center gap-2 rounded-lg bg-[#1B5E20] text-white text-sm font-semibold px-4 py-2.5 hover:bg-[#164d1a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          {pending ? "Sending…" : `Send to ${selected.size}`}
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
    </div>
  );
}
