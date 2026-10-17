"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// The batch's stops on a map (OpenStreetMap tiles — no API key). Numbered
// pins in the partner's stop order, ticks for delivered ones, a blue dot
// for the partner once they've shared their location. Loaded only in the
// browser (next/dynamic, ssr: false).

export type MapStop = { key: string; n: number; lat: number; lng: number; name: string; done: boolean; issue: boolean };

const JAIPUR: L.LatLngTuple = [26.9124, 75.7873];

function pin(s: MapStop) {
  const bg = s.done ? "#9CA3AF" : s.issue ? "#DC2626" : "#1B5E20";
  return L.divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;border-radius:9999px;background:${bg};color:#fff;font:700 13px/30px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${s.done ? "✓" : s.n}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export default function RouteMap({
  stops,
  me,
  onPick,
}: {
  stops: MapStop[];
  me: { lat: number; lng: number } | null;
  onPick: (key: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  // Which stops the view was last fitted to — the 60-second refresh redraws
  // the pins but mustn't undo the partner's own zooming.
  const fitted = useRef("");

  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true }).setView(JAIPUR, 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const points: L.LatLngTuple[] = [];
    for (const s of stops) {
      // Customer names are user-typed: pass a text node, never HTML.
      const label = document.createElement("span");
      label.textContent = s.done ? `${s.name} (delivered)` : `${s.n}. ${s.name}`;
      L.marker([s.lat, s.lng], { icon: pin(s), zIndexOffset: s.done ? 0 : 1000 })
        .bindTooltip(label)
        .on("click", () => pick.current(s.key))
        .addTo(g);
      points.push([s.lat, s.lng]);
    }
    if (me) {
      L.circleMarker([me.lat, me.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#2563EB", fillOpacity: 1 }).addTo(g);
      points.push([me.lat, me.lng]);
    }
    const signature = stops.map((s) => s.key).join(",") + (me ? `|${me.lat},${me.lng}` : "");
    if (points.length > 0 && signature !== fitted.current) {
      fitted.current = signature;
      m.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    }
  }, [stops, me]);

  return <div ref={box} className="h-[60vh] w-full" />;
}
