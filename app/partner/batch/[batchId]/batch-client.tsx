"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import {
  Truck, CheckCircle2, AlertTriangle, Banknote, Navigation, Phone, MessageCircle,
  ChevronUp, ChevronDown, Map as MapIcon, List, Route, LocateFixed, Camera, X, Loader2, Clock,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Stop } from "@/lib/partner-data";
import { startDelivery, markDelivered, reportProblem, reportCash, saveRouteOrder, deliveryPhotoUpload } from "../../actions";
import { PROBLEM_REASONS } from "../../reasons";
import type { MapStop } from "./route-map";

// Leaflet touches `window` — the map only ever renders in the browser.
const RouteMap = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => <div className="h-[60vh] animate-pulse bg-gray-100" />,
});

const OPEN = ["scheduled", "confirmed", "preparing", "out_for_delivery"];
const NOT_STARTED = ["scheduled", "confirmed", "preparing"];

type Sheet = { kind: "deliver" | "problem" | "cash"; stop: Stop } | null;
type Toast = { ok: boolean; text: string } | null;

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function clock(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
}

function digits10(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

function mapsTarget(s: Stop) {
  return s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : `${s.address}, Jaipur${s.pincode ? " " + s.pincode : ""}`;
}

function navigateUrl(s: Stop) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsTarget(s))}`;
}

// Google Maps takes the destination plus up to 9 stops on the way.
function routeUrl(stops: Stop[]) {
  const pts = stops.slice(0, 10).map(mapsTarget);
  const dest = pts.pop()!;
  const via = pts.length > 0 ? `&waypoints=${encodeURIComponent(pts.join("|"))}` : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}${via}`;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = b.lat - a.lat;
  return Math.sqrt(x * x + y * y) * 111.32;
}

// Phone photos are several MB — the handover proof only needs ~200 KB.
async function compress(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read the photo."))), "image/jpeg", 0.7)
  );
}

export function BatchClient({
  batchId,
  stops,
  canAct,
  dateLabel,
}: {
  batchId: string;
  stops: Stop[];
  canAct: boolean;
  dateLabel: string;
}) {
  const [view, setView] = useState<"list" | "map">("list");
  // The partner's own reordering, shown at once (saved in the background).
  const [order, setOrder] = useState<string[] | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [starting, startStarting] = useTransition();
  const [locating, setLocating] = useState(false);

  const sorted = useMemo(() => {
    if (!order) return stops;
    const rank = new Map(order.map((k, i) => [k, i]));
    return [...stops].sort((a, b) => (rank.get(a.key) ?? 1e6) - (rank.get(b.key) ?? 1e6));
  }, [stops, order]);
  const pending = sorted.filter((s) => s.state !== "delivered" && s.state !== "closed");
  const done = sorted.filter((s) => s.state === "delivered" || s.state === "closed");
  const notStarted = stops.reduce((n, s) => n + s.items.filter((i) => NOT_STARTED.includes(i.status)).length, 0);
  const cashToCollect = pending.reduce((n, s) => n + (s.codDue > 0 && !s.cashReport ? s.codDue : 0), 0);

  function say(ok: boolean, text: string) {
    setToast({ ok, text });
    setTimeout(() => setToast(null), ok ? 3000 : 6000);
  }

  function saveOrder(keys: string[]) {
    setOrder(keys);
    const addressIds = keys
      .map((k) => stops.find((s) => s.key === k)?.addressId)
      .filter((id): id is string => !!id);
    saveRouteOrder(batchId, addressIds).then((r) => {
      if (!r.ok) say(false, r.error);
    });
  }

  function move(key: string, dir: -1 | 1) {
    const keys = pending.map((s) => s.key);
    const i = keys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    saveOrder([...keys, ...done.map((s) => s.key)]);
  }

  // Nearest stop first from where the partner is now, then nearest to that.
  function sortByDistance() {
    if (!navigator.geolocation) return say(false, "This phone can't share its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMe(here);
        const withPin = pending.filter((s) => s.lat != null && s.lng != null);
        const noPin = pending.filter((s) => s.lat == null || s.lng == null);
        const route: Stop[] = [];
        let from = here;
        const left = [...withPin];
        while (left.length > 0) {
          let best = 0;
          for (let i = 1; i < left.length; i++) {
            if (km(from, { lat: left[i].lat!, lng: left[i].lng! }) < km(from, { lat: left[best].lat!, lng: left[best].lng! })) best = i;
          }
          const [next] = left.splice(best, 1);
          route.push(next);
          from = { lat: next.lat!, lng: next.lng! };
        }
        saveOrder([...route, ...noPin, ...done].map((s) => s.key));
        say(true, noPin.length > 0 ? `Sorted — ${noPin.length} stop${noPin.length === 1 ? " has" : "s have"} no pin and went last.` : "Sorted by distance from you.");
      },
      () => {
        setLocating(false);
        say(false, "Allow location for this site to sort by distance.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  function handleStart() {
    if (!window.confirm(`Start delivery? ${notStarted} customer meal${notStarted === 1 ? "" : "s"} will show "on the way" and they'll get a message.`)) return;
    startStarting(async () => {
      const r = await startDelivery(batchId);
      say(r.ok, r.ok ? r.message : r.error);
    });
  }

  const mapStops: MapStop[] = sorted
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({
      key: s.key,
      n: pending.indexOf(s) + 1,
      lat: s.lat!,
      lng: s.lng!,
      name: s.name,
      done: s.state === "delivered" || s.state === "closed",
      issue: s.state === "issue",
    }));

  return (
    <div>
      {/* Progress and the batch-level action */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">
            {done.length}/{stops.length} stop{stops.length === 1 ? "" : "s"} done
          </span>
          {cashToCollect > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
              <Banknote className="h-3.5 w-3.5" /> Collect {rupees(cashToCollect)}
            </span>
          )}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-[#1B5E20]" style={{ width: `${stops.length ? Math.round((done.length / stops.length) * 100) : 0}%` }} />
        </div>

        {!canAct && (
          <p className="mt-3 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">
            Looking at {dateLabel} — you can mark deliveries only on the day.
          </p>
        )}

        {canAct && notStarted > 0 && (
          <button
            onClick={handleStart}
            disabled={starting}
            className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#1B5E20] text-base font-semibold text-white shadow-sm disabled:opacity-60"
          >
            {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Truck className="h-5 w-5" />}
            Start delivery ({notStarted} meal{notStarted === 1 ? "" : "s"})
          </button>
        )}

        {stops.length > 0 && (
          <div className="mt-4 flex gap-2">
            <div className="flex flex-1 overflow-hidden rounded-xl border border-[#e2e8d5] bg-white">
              {([["list", List, "List"], ["map", MapIcon, "Map"]] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium ${view === v ? "bg-[#1B5E20] text-white" : "text-gray-600"}`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            {pending.length > 0 && (
              <button
                onClick={sortByDistance}
                disabled={locating}
                className="flex items-center gap-1.5 rounded-xl border border-[#e2e8d5] bg-white px-3 text-sm font-medium text-gray-700 disabled:opacity-60"
                aria-label="Sort by distance from me"
              >
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} Nearest
              </button>
            )}
          </div>
        )}

        {pending.length > 0 && (
          <a
            href={routeUrl(pending)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex h-11 items-center justify-center gap-2 rounded-xl border border-[#1B5E20]/30 bg-white text-sm font-semibold text-[#1B5E20]"
          >
            <Route className="h-4 w-4" />
            Open route in Google Maps{pending.length > 10 ? " (next 10 stops)" : ""}
          </a>
        )}
      </div>

      {stops.length === 0 && (
        <p className="mx-4 mt-6 rounded-2xl border border-dashed border-[#e2e8d5] bg-white p-6 text-center text-sm text-gray-500">
          No deliveries in this batch {dateLabel}.
        </p>
      )}

      {view === "map" && stops.length > 0 && (
        <div className="mt-4">
          <RouteMap
            stops={mapStops}
            me={me}
            onPick={(key) => {
              setView("list");
              setTimeout(() => document.getElementById(`stop-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
            }}
          />
          {stops.length > mapStops.length && (
            <p className="px-4 pt-2 text-xs text-gray-500">
              {stops.length - mapStops.length} stop{stops.length - mapStops.length === 1 ? " has" : "s have"} no map pin — see the list.
            </p>
          )}
        </div>
      )}

      {view === "list" && (
        <div className="mt-4 space-y-3 px-4">
          {pending.map((s, i) => (
            <StopCard
              key={s.key}
              stop={s}
              n={i + 1}
              canAct={canAct}
              first={i === 0}
              last={i === pending.length - 1}
              onMove={(dir) => move(s.key, dir)}
              onSheet={(kind) => setSheet({ kind, stop: s })}
            />
          ))}

          {done.length > 0 && (
            <>
              <p className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Done</p>
              {done.map((s) => (
                <div key={s.key} id={`stop-${s.key}`} className="flex items-center gap-3 rounded-2xl border border-[#e2e8d5] bg-white px-4 py-3">
                  <CheckCircle2 className={s.state === "delivered" ? "h-5 w-5 shrink-0 text-[#1B5E20]" : "h-5 w-5 shrink-0 text-gray-300"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.name} <span className="text-sm font-normal text-gray-500">· {s.label}</span></p>
                    <p className="text-xs text-gray-500">
                      {s.state === "delivered" ? `Delivered ${clock(s.items.find((it) => it.deliveredAt)?.deliveredAt ?? null)}` : "Not delivering today"}
                      {s.items.some((it) => it.hasPhoto) ? " · 📷" : ""}
                    </p>
                  </div>
                  {canAct && s.codDue > 0 && !s.cashReport && (
                    <button
                      onClick={() => setSheet({ kind: "cash", stop: s })}
                      className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800"
                    >
                      Cash {rupees(s.codDue)}
                    </button>
                  )}
                  {s.cashReport && <span className="text-xs font-medium text-amber-800">{rupees(s.cashReport.amount)} reported</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {sheet?.kind === "deliver" && <DeliverSheet stop={sheet.stop} onClose={() => setSheet(null)} onDone={say} />}
      {sheet?.kind === "problem" && <ProblemSheet stop={sheet.stop} onClose={() => setSheet(null)} onDone={say} />}
      {sheet?.kind === "cash" && <CashSheet stop={sheet.stop} onClose={() => setSheet(null)} onDone={say} />}

      {toast && (
        <div
          // Never in the way: a tap goes through to the button underneath.
          className={`pointer-events-none fixed inset-x-4 bottom-6 z-50 mx-auto max-w-sm rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.ok ? "bg-[#1B5E20]" : "bg-red-600"}`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function StopCard({
  stop: s,
  n,
  canAct,
  first,
  last,
  onMove,
  onSheet,
}: {
  stop: Stop;
  n: number;
  canAct: boolean;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onSheet: (kind: "deliver" | "problem" | "cash") => void;
}) {
  const phone = digits10(s.phone);
  const openItems = s.items.filter((i) => OPEN.includes(i.status));
  const issue = openItems.find((i) => i.issue)?.issue;
  const onTheWay = openItems.some((i) => i.status === "out_for_delivery");

  return (
    <div
      id={`stop-${s.key}`}
      className={`rounded-2xl border bg-white shadow-sm ${s.state === "issue" ? "border-red-300" : "border-[#e2e8d5]"}`}
    >
      <div className="flex gap-3 p-4 pb-3">
        <div className="flex flex-col items-center gap-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1B5E20] text-sm font-bold text-white">{n}</span>
          <button onClick={() => onMove(-1)} disabled={first} className="p-1 text-gray-400 disabled:opacity-20" aria-label="Move up">
            <ChevronUp className="h-5 w-5" />
          </button>
          <button onClick={() => onMove(1)} disabled={last} className="p-1 text-gray-400 disabled:opacity-20" aria-label="Move down">
            <ChevronDown className="h-5 w-5" />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-base font-bold leading-snug">{s.name}</p>
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{s.label}</span>
          </div>
          <p className="mt-1 text-sm leading-snug text-gray-700">{s.address}</p>
          {(s.timing || s.pincode) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
              {s.timing && <><Clock className="h-3.5 w-3.5" /> {s.timing}</>}
              {s.timing && s.pincode ? " · " : ""}
              {s.pincode}
            </p>
          )}

          <ul className="mt-2 space-y-0.5 text-sm">
            {s.items.map((it) => (
              <li key={it.orderId} className={OPEN.includes(it.status) ? "" : "text-gray-400 line-through"}>
                {it.extra ? "+ " : "• "}
                <span className="font-medium">{it.meal}</span>
                {it.qty > 1 && <span className="font-semibold text-[#1B5E20]"> ×{it.qty}</span>}
                {it.addons.length > 0 && <span className="text-gray-500"> · {it.addons.join(", ")}</span>}
              </li>
            ))}
          </ul>

          {s.note && <p className="mt-2 rounded-lg bg-yellow-50 px-2.5 py-1.5 text-xs text-yellow-900">Note: {s.note}</p>}

          {onTheWay && !issue && <p className="mt-2 text-xs font-medium text-blue-700">On the way · customer has been told</p>}
          {issue && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Reported: {issue}. The office will decide — you can still mark it delivered.</span>
            </p>
          )}

          {s.codDue > 0 && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <Banknote className="h-4 w-4" />
                {s.cashReport ? `${rupees(s.cashReport.amount)} reported` : `Collect ${rupees(s.codDue)} cash`}
              </span>
              {canAct && (
                <button onClick={() => onSheet("cash")} className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 shadow-sm">
                  {s.cashReport ? "Change" : "Cash collected"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 border-t border-[#e2e8d5] text-sm font-medium">
        <a href={navigateUrl(s)} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 py-3 text-[#1B5E20]">
          <Navigation className="h-4 w-4" /> Go
        </a>
        <a href={phone.length === 10 ? `tel:+91${phone}` : undefined} className="flex items-center justify-center gap-1.5 border-x border-[#e2e8d5] py-3 text-gray-700">
          <Phone className="h-4 w-4" /> Call
        </a>
        <a href={phone.length === 10 ? `https://wa.me/91${phone}` : undefined} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 py-3 text-gray-700">
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </a>
      </div>

      {canAct && openItems.length > 0 && (
        <div className="flex gap-2 border-t border-[#e2e8d5] p-3">
          <button
            onClick={() => onSheet("deliver")}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1B5E20] text-base font-semibold text-white"
          >
            <CheckCircle2 className="h-5 w-5" /> Delivered
          </button>
          <button
            onClick={() => onSheet("problem")}
            className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700"
          >
            <AlertTriangle className="h-4 w-4" /> Problem
          </button>
        </div>
      )}
    </div>
  );
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-lg font-bold">{title}</p>
          <button onClick={onClose} className="rounded-full p-2 text-gray-500 active:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DeliverSheet({ stop, onClose, onDone }: { stop: Stop; onClose: () => void; onDone: (ok: boolean, text: string) => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = stop.items.filter((i) => OPEN.includes(i.status));

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      let photoPath: string | null = null;
      if (photo) {
        const up = await deliveryPhotoUpload(open[0].orderId);
        if (!up.ok) throw new Error(up.error);
        const blob = await compress(photo);
        const { error: upErr } = await supabase.storage
          .from("delivery-photos")
          .uploadToSignedUrl(up.path, up.token, blob, { contentType: "image/jpeg" });
        if (upErr) throw new Error("The photo didn't upload — try again, or remove it and deliver without one.");
        photoPath = up.path;
      }
      const r = await markDelivered(open.map((i) => i.orderId), photoPath);
      if (!r.ok) throw new Error(r.error);
      onDone(true, `${stop.name} — delivered ✓`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't mark it delivered. Try again.");
      setBusy(false);
    }
  }

  return (
    <SheetFrame title={`Hand over to ${stop.name}?`} onClose={onClose}>
      <ul className="space-y-1 text-sm">
        {open.map((it) => (
          <li key={it.orderId}>
            • <span className="font-medium">{it.meal}</span>
            {it.qty > 1 && <span className="font-semibold text-[#1B5E20]"> ×{it.qty}</span>}
            {it.addons.length > 0 && <span className="text-gray-500"> · {it.addons.join(", ")}</span>}
          </li>
        ))}
      </ul>
      {stop.codDue > 0 && !stop.cashReport && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Remember to collect {rupees(stop.codDue)} cash.
        </p>
      )}

      <label className="mt-4 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 text-sm font-medium text-gray-600">
        <Camera className="h-5 w-5" /> {photo ? "Retake photo" : "Add photo (optional)"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setPhoto(f);
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />
      </label>
      {preview && (
        <div className="relative mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Handover" className="max-h-56 w-full rounded-xl object-cover" />
          <button
            onClick={() => { setPhoto(null); setPreview(null); }}
            className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"
            aria-label="Remove photo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        onClick={confirm}
        disabled={busy}
        className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#1B5E20] text-base font-semibold text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
        Mark delivered
      </button>
    </SheetFrame>
  );
}

function ProblemSheet({ stop, onClose, onDone }: { stop: Stop; onClose: () => void; onDone: (ok: boolean, text: string) => void }) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!reason) return setError("Pick a reason.");
    setBusy(true);
    const ids = stop.items.filter((i) => OPEN.includes(i.status)).map((i) => i.orderId);
    const r = await reportProblem(ids, reason, note);
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    onDone(true, r.message);
    onClose();
  }

  return (
    <SheetFrame title={`Couldn't deliver to ${stop.name}?`} onClose={onClose}>
      <p className="text-sm text-gray-600">Call the customer first. If it still can&apos;t be handed over, tell the office why — the meal isn&apos;t charged until they decide.</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {PROBLEM_REASONS.map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className={`rounded-xl border px-3 py-3 text-sm font-medium ${reason === r ? "border-red-500 bg-red-50 text-red-800" : "border-[#e2e8d5] text-gray-700"}`}
          >
            {r}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={200}
        placeholder="Anything else? (optional)"
        className="mt-3 w-full rounded-xl border border-[#e2e8d5] px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-200"
      />
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        onClick={send}
        disabled={busy}
        className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-base font-semibold text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <AlertTriangle className="h-5 w-5" />}
        Report to office
      </button>
    </SheetFrame>
  );
}

function CashSheet({ stop, onClose, onDone }: { stop: Stop; onClose: () => void; onDone: (ok: boolean, text: string) => void }) {
  const [amount, setAmount] = useState(String((stop.cashReport?.amount ?? stop.codDue) / 100));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    const paise = Math.round((parseFloat(amount) || 0) * 100);
    if (paise <= 0) return setError("Enter the amount you collected.");
    setBusy(true);
    const r = await reportCash(stop.items[0].orderId, paise, note);
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    onDone(true, r.message);
    onClose();
  }

  return (
    <SheetFrame title={`Cash from ${stop.name}`} onClose={onClose}>
      <p className="text-sm text-gray-600">
        Due: <span className="font-semibold">{rupees(stop.codDue)}</span>. Enter what you actually collected — the office records it when you hand the cash over.
      </p>
      <div className="mt-4 flex h-14 items-center rounded-xl border border-[#e2e8d5] focus-within:ring-2 focus-within:ring-amber-200">
        <span className="pl-4 pr-1 text-lg text-gray-500">₹</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          className="h-full flex-1 bg-transparent pr-4 text-xl font-semibold outline-none"
        />
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder="Note (optional) — e.g. paid part, rest tomorrow"
        className="mt-3 h-11 w-full rounded-xl border border-[#e2e8d5] px-3 text-sm outline-none focus:ring-2 focus:ring-amber-200"
      />
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        onClick={send}
        disabled={busy}
        className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-base font-semibold text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Banknote className="h-5 w-5" />}
        Report cash collected
      </button>
    </SheetFrame>
  );
}
