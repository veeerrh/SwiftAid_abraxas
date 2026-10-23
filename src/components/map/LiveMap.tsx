"use client";

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap, Marker, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { survivalTone } from "@/lib/client/format";
import { smoothClock, useLive } from "@/lib/client/live";
import { pathFor, pointAlong, sliceFrom } from "@/lib/client/routing";
import type { LatLng, Leg, Rider } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/store";
import { cn } from "@/lib/utils";

const PUNE: [number, number] = [73.865, 18.515];

type Pad = number | { top: number; right: number; bottom: number; left: number };

const CARTO = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

const offlineStyle = (dark: boolean): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": dark ? "#0a0f16" : "#e6ebf2" } }],
});

const ICON = {
  donor:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18l-1.5 10a2 2 0 0 1-2 1.7H6.5a2 2 0 0 1-2-1.7L3 9z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></svg>',
  shelter:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
};

export type MapSelection = { type: "batch" | "rider" | "shelter" | "donor"; id: string };

interface Props {
  className?: string;
  selectedBatchId?: string | null;
  /** Rider ids to emphasise (e.g. the rider portal highlights "me"). */
  highlightRiderId?: string | null;
  onSelect?: (s: MapSelection) => void;
  interactive?: boolean;
  /** Slowly orbit the camera for the big-screen board. */
  cinematic?: boolean;
  showLabels?: boolean;
  padding?: Pad;
  /** Restrict what is drawn: legs/riders of one batch (donor view) or one rider. */
  onlyBatchId?: string | null;
  onlyRiderId?: string | null;
  onlyShelterId?: string | null;
  initialZoom?: number;
}

type LineFeature = {
  type: "Feature";
  properties: { color: string; opacity: number };
  geometry: { type: "LineString"; coordinates: number[][] };
};

function toneColor(tone: string) {
  return tone === "safe" ? "#2dd4bf" : tone === "warn" ? "#fbbf24" : tone === "crit" ? "#fb7185" : "#60a5fa";
}

export function LiveMap({
  className,
  selectedBatchId,
  highlightRiderId,
  onSelect,
  interactive = true,
  cinematic = false,
  showLabels = true,
  padding = 80,
  onlyBatchId,
  onlyRiderId,
  onlyShelterId,
  initialZoom = 11.7,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ selectedBatchId, highlightRiderId, onSelect, showLabels, onlyBatchId, onlyRiderId, onlyShelterId });
  propsRef.current = { selectedBatchId, highlightRiderId, onSelect, showLabels, onlyBatchId, onlyRiderId, onlyShelterId };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const isDark = () => document.documentElement.getAttribute("data-theme") !== "light";
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const map: MLMap = new maplibregl.Map({
      container: el,
      style: isDark() ? CARTO.dark : CARTO.light,
      center: PUNE,
      zoom: initialZoom,
      attributionControl: { compact: true },
      interactive,
      pitchWithRotate: false,
      dragRotate: false,
      fadeDuration: 0,
    });
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    const donors = new Map<string, Marker>();
    const shelters = new Map<string, Marker>();
    const riders = new Map<string, Marker>();
    let styleOk = false;
    let lastVersion = -1;
    let fitted = false;
    let raf = 0;
    let lastFrame = 0;
    let lastFit = 0;
    let dead = false;

    const ensureLayers = () => {
      if (!map.getStyle()) return;
      for (const id of ["routes-next", "routes-now"]) {
        if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      const color: maplibregl.ExpressionSpecification = ["get", "color"];
      if (!map.getLayer("routes-next")) {
        map.addLayer({
          id: "routes-next",
          type: "line",
          source: "routes-next",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 2, "line-opacity": ["get", "opacity"], "line-dasharray": [1.5, 2.5] },
        });
      }
      if (!map.getLayer("routes-glow")) {
        map.addLayer({
          id: "routes-glow",
          type: "line",
          source: "routes-now",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 9, "line-blur": 8, "line-opacity": ["*", 0.35, ["get", "opacity"]] },
        });
      }
      if (!map.getLayer("routes-now")) {
        map.addLayer({
          id: "routes-now",
          type: "line",
          source: "routes-now",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": color, "line-width": 3.2, "line-opacity": ["get", "opacity"] },
        });
      }
      styleOk = true;
    };

    map.on("style.load", ensureLayers);
    map.on("load", ensureLayers);
    // Basemap tiles are optional: fall back to a plain canvas so markers and routes still work offline.
    let fellBack = false;
    const fallback = () => {
      if (fellBack || dead) return;
      fellBack = true;
      styleOk = false;
      map.setStyle(offlineStyle(isDark()));
    };
    map.on("error", (e) => {
      const msg = String((e as unknown as { error?: { message?: string } }).error?.message ?? "");
      if (!map.isStyleLoaded() && /style|fetch|Failed|network|404|403/i.test(msg)) fallback();
    });
    const styleTimer = setTimeout(() => {
      if (!map.isStyleLoaded()) fallback();
    }, 7000);

    const onTheme = () => {
      fellBack = false;
      styleOk = false;
      map.setStyle(isDark() ? CARTO.dark : CARTO.light);
    };
    window.addEventListener("swiftaid-theme", onTheme);

    const mkEl = (cls: string, html: string, label?: string) => {
      const d = document.createElement("div");
      d.className = `mk ${cls}`;
      d.innerHTML = html + (label ? `<span class="mk-label">${label}</span>` : "");
      return d;
    };

    const makeMarker = (e: HTMLElement, lngLat: [number, number]): Marker => {
      const mk = new maplibregl.Marker({ element: e });
      mk.setLngLat(lngLat);
      mk.addTo(map);
      return mk;
    };

    const select = (s: MapSelection) => propsRef.current.onSelect?.(s);

    function syncStatic(snap: Snapshot) {
      const p = propsRef.current;
      const batchLegs = p.onlyBatchId ? snap.legs.filter((l) => l.batchId === p.onlyBatchId && l.state !== "released") : null;
      const batchRiders = batchLegs ? new Set(batchLegs.map((l) => l.riderId)) : null;
      const batchShelters = batchLegs ? new Set(batchLegs.map((l) => l.shelterId)) : null;
      const demand = new Map<string, number>();
      for (const l of snap.legs) {
        if (l.state === "delivered" || l.state === "released" || l.state === "failed") continue;
        demand.set(l.shelterId, (demand.get(l.shelterId) ?? 0) + l.qty);
      }

      for (const d of snap.donors) {
        if (p.onlyBatchId) {
          const b = snap.batches.find((x) => x.id === p.onlyBatchId);
          if (!b || b.donorId !== d.id) {
            donors.get(d.id)?.remove();
            donors.delete(d.id);
            continue;
          }
        }
        let m = donors.get(d.id);
        const pending = snap.batches.some((b) => b.donorId === d.id && b.unplacedQty > 0);
        if (!m) {
          const e = mkEl("mk-donor", ICON.donor);
          e.title = `${d.name} · ${d.area}`;
          e.onclick = () => select({ type: "donor", id: d.id });
          m = makeMarker(e, [d.loc.lng, d.loc.lat]);
          donors.set(d.id, m);
        }
        m.getElement().dataset.pending = pending ? "1" : "0";
      }

      for (const s of snap.shelters) {
        if ((p.onlyShelterId && s.id !== p.onlyShelterId) || (batchShelters && !batchShelters.has(s.id))) {
          shelters.get(s.id)?.remove();
          shelters.delete(s.id);
          continue;
        }
        let m = shelters.get(s.id);
        if (!m) {
          const e = mkEl("mk-shelter", ICON.shelter, "");
          e.onclick = () => select({ type: "shelter", id: s.id });
          m = makeMarker(e, [s.loc.lng, s.loc.lat]);
          shelters.set(s.id, m);
        }
        const e = m.getElement();
        const free = Math.max(0, s.capacityRemaining - (demand.get(s.id) ?? 0));
        const frac = s.totalCapacity > 0 ? free / s.totalCapacity : 0;
        e.style.setProperty("--p", String(Math.round(frac * 100)));
        e.dataset.open = s.open ? "1" : "0";
        e.dataset.full = s.open && free === 0 ? "1" : "0";
        e.title = `${s.name} — ${s.open ? "open" : "closed"}`;
        const label = e.querySelector(".mk-label");
        const text = `${s.area}<small>${s.open ? `${free}/${s.totalCapacity}` : "closed"}</small>`;
        if (p.showLabels) {
          if (label) label.innerHTML = text;
          else {
            const span = document.createElement("span");
            span.className = "mk-label";
            span.innerHTML = text;
            e.appendChild(span);
          }
        } else label?.remove();
      }

      const standbyIds = new Set(snap.legs.flatMap((l) => (l.standbyRiderId ? [l.standbyRiderId] : [])));
      for (const r of snap.riders) {
        if ((p.onlyRiderId && r.id !== p.onlyRiderId) || (batchRiders && !p.onlyRiderId && !batchRiders.has(r.id))) {
          riders.get(r.id)?.remove();
          riders.delete(r.id);
          continue;
        }
        let m = riders.get(r.id);
        if (!m) {
          const e = mkEl("mk-rider", r.name.slice(0, 1));
          e.onclick = () => select({ type: "rider", id: r.id });
          m = makeMarker(e, [r.loc.lng, r.loc.lat]);
          riders.set(r.id, m);
        }
        const e = m.getElement();
        e.dataset.status = r.status;
        e.dataset.manual = r.manual ? "1" : "0";
        e.dataset.standby = standbyIds.has(r.id) ? "1" : "0";
        const leg = snap.legs.find((l) => l.riderId === r.id && (l.state === "to_pickup" || l.state === "to_drop" || l.state === "offered"));
        e.dataset.risk = leg && (leg.survival?.p ?? 1) < 0.6 && r.status !== "ghosting" ? "1" : "0";
        e.title = `${r.name} · ${r.area} · ${r.status}${leg ? ` · ${leg.qty} units` : ""}`;
        e.style.zIndex = p.highlightRiderId === r.id ? "8" : leg ? "4" : "1";
        e.style.outline = p.highlightRiderId === r.id ? "2px solid var(--ai)" : "none";
        e.style.outlineOffset = "3px";
      }
    }

    function riderPos(snap: Snapshot, now: number, r: Rider, leg: Leg | undefined): LatLng {
      if (!leg || (leg.state !== "to_pickup" && leg.state !== "to_drop") || r.silent) return r.loc;
      const t = leg.phaseDuration > 0 ? (now - leg.phaseStart) / leg.phaseDuration : 1;
      return pointAlong(pathFor(leg.phaseFrom, leg.phaseTo), Math.max(0, Math.min(1, t)));
    }

    function frame(ts: number) {
      raf = requestAnimationFrame(frame);
      if (ts - lastFrame < 66) return; // ~15 fps is plenty for slow vehicles
      lastFrame = ts;
      const { snap } = useLive.getState();
      if (!snap || dead) return;
      if (snap.version !== lastVersion) {
        lastVersion = snap.version;
        syncStatic(snap);
      }
      const now = smoothClock();
      const p = propsRef.current;
      const pos = new Map<string, LatLng>();
      const nowFeats: LineFeature[] = [];
      const nextFeats: LineFeature[] = [];

      const legsByRider = new Map<string, Leg>();
      for (const l of snap.legs) {
        if (l.state === "to_pickup" || l.state === "to_drop" || l.state === "offered") legsByRider.set(l.riderId, l);
      }

      for (const r of snap.riders) {
        const leg = legsByRider.get(r.id);
        const pt = riderPos(snap, r.silent ? snap.clock : now, r, leg);
        pos.set(r.id, pt);
        riders.get(r.id)?.setLngLat([pt.lng, pt.lat]);
      }

      for (const leg of legsByRider.values()) {
        if (p.onlyBatchId && leg.batchId !== p.onlyBatchId) continue;
        if (p.onlyRiderId && leg.riderId !== p.onlyRiderId) continue;
        if (p.onlyShelterId && leg.shelterId !== p.onlyShelterId) continue;
        const rider = snap.riders.find((x) => x.id === leg.riderId)!;
        const shelter = snap.shelters.find((s) => s.id === leg.shelterId)!;
        const tone = rider.silent ? "crit" : survivalTone(leg.survival?.p ?? 1);
        const focus = p.selectedBatchId ? leg.batchId === p.selectedBatchId : true;
        const opacity = focus ? 0.95 : 0.2;
        const color = toneColor(tone);
        const t = leg.phaseDuration > 0 && leg.state !== "offered" ? Math.max(0, Math.min(1, ((rider.silent ? snap.clock : now) - leg.phaseStart) / leg.phaseDuration)) : 0;
        const cur = pathFor(leg.phaseFrom, leg.phaseTo);
        const remaining = sliceFrom(cur, t);
        nowFeats.push({
          type: "Feature",
          properties: { color, opacity },
          geometry: { type: "LineString", coordinates: remaining.map((q) => [q.lng, q.lat]) },
        });
        if (leg.phase === "pickup") {
          const drop = pathFor(leg.originLoc, shelter.loc);
          nextFeats.push({
            type: "Feature",
            properties: { color, opacity: focus ? 0.7 : 0.15 },
            geometry: { type: "LineString", coordinates: drop.map((q) => [q.lng, q.lat]) },
          });
        }
        if (leg.divertedFrom && leg.divertedAt !== undefined && now - leg.divertedAt < 4) {
          const old = snap.shelters.find((s) => s.id === leg.divertedFrom);
          const here = pos.get(rider.id) ?? rider.loc;
          if (old) {
            nextFeats.push({
              type: "Feature",
              properties: { color: "#fb7185", opacity: 0.9 },
              geometry: { type: "LineString", coordinates: [[here.lng, here.lat], [old.loc.lng, old.loc.lat]] },
            });
          }
        }
      }

      if (styleOk) {
        (map.getSource("routes-now") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: nowFeats });
        (map.getSource("routes-next") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: nextFeats });
      }

      const focusMode = !!(p.onlyBatchId || p.onlyRiderId || p.onlyShelterId);
      if (focusMode && ts - lastFit > 2500) {
        lastFit = ts;
        const b = new maplibregl.LngLatBounds();
        let n = 0;
        for (const m of [...donors.values(), ...shelters.values(), ...riders.values()]) {
          b.extend(m.getLngLat());
          n++;
        }
        if (n > 0) map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 900 });
      }
      if (!fitted && snap.shelters.length) {
        fitted = true;
        const b = new maplibregl.LngLatBounds();
        for (const s of snap.shelters) b.extend([s.loc.lng, s.loc.lat]);
        for (const d of snap.donors) b.extend([d.loc.lng, d.loc.lat]);
        if (!onlyBatchId && !onlyRiderId && !onlyShelterId) map.fitBounds(b, { padding, duration: 0, maxZoom: 12.4 });
      }
    }
    raf = requestAnimationFrame(frame);

    let orbit = 0;
    if (cinematic) {
      let bearing = -6;
      orbit = window.setInterval(() => {
        bearing += 0.04;
        map.setBearing(Math.sin(bearing) * 4);
      }, 50);
    }

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(el);

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      clearTimeout(styleTimer);
      clearInterval(orbit);
      window.removeEventListener("swiftaid-theme", onTheme);
      resize.disconnect();
      for (const m of [...donors.values(), ...shelters.values(), ...riders.values()]) m.remove();
      map.remove();
    };
    // The map is created once; live data flows through the store, props through propsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={box} className={cn("h-full w-full", className)} />;
}
