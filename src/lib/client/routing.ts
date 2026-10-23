import { haversineKm } from "@/lib/domain/geo";
import type { LatLng } from "@/lib/domain/types";

/**
 * Road geometry from the public OSRM demo server, cached in memory and localStorage.
 * Everything degrades to a straight line, so the demo never depends on the network.
 */

type Poly = LatLng[];
const cache = new Map<string, Poly | null>();
const inflight = new Set<string>();
const failedAt = new Map<string, number>();
const STORE_KEY = "swiftaid-routes-v1";
const RETRY_MS = 60_000;
let loaded = false;
let active = 0;
const queue: (() => void)[] = [];

const q = (n: number) => n.toFixed(3);
export const routeKey = (a: LatLng, b: LatLng) => `${q(a.lat)},${q(a.lng)}>${q(b.lat)},${q(b.lng)}`;

function load() {
  if (loaded || typeof localStorage === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, [number, number][]>;
    for (const [k, v] of Object.entries(obj)) cache.set(k, v.map(([lat, lng]) => ({ lat, lng })));
  } catch {
    /* corrupt cache: ignore */
  }
}

function persist() {
  try {
    const obj: Record<string, [number, number][]> = {};
    let n = 0;
    for (const [k, v] of cache) {
      if (!v) continue;
      // Thin the polyline so storage stays small.
      const step = Math.max(1, Math.floor(v.length / 60));
      obj[k] = v.filter((_, i) => i % step === 0 || i === v.length - 1).map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5)]);
      if (++n > 150) break;
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(obj));
  } catch {
    /* quota or private mode */
  }
}

function pump() {
  while (active < 2 && queue.length) {
    active++;
    queue.shift()!();
  }
}

function fetchRoute(a: LatLng, b: LatLng, key: string) {
  inflight.add(key);
  queue.push(async () => {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { routes?: { geometry: { coordinates: [number, number][] } }[] };
      const coords = data.routes?.[0]?.geometry.coordinates;
      if (!coords || coords.length < 2) throw new Error("no route");
      cache.set(key, coords.map(([lng, lat]) => ({ lat, lng })));
      persist();
    } catch {
      failedAt.set(key, Date.now());
    } finally {
      inflight.delete(key);
      active--;
      pump();
    }
  });
  pump();
}

/** Cached road polyline for a→b, or null (and a background fetch is started) if unknown. */
export function getCachedRoute(a: LatLng, b: LatLng): Poly | null {
  if (typeof window === "undefined") return null;
  load();
  const key = routeKey(a, b);
  const hit = cache.get(key);
  if (hit) return [a, ...hit.slice(1, -1), b];
  if (!inflight.has(key)) {
    const failed = failedAt.get(key);
    if (!failed || Date.now() - failed > RETRY_MS) fetchRoute(a, b, key);
  }
  return null;
}

/** Polyline to draw/animate: road geometry if available, else a straight line. */
export function pathFor(a: LatLng, b: LatLng): Poly {
  return getCachedRoute(a, b) ?? [a, b];
}

export function polyLengthKm(p: Poly): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += haversineKm(p[i - 1], p[i]);
  return d;
}

/** Point at fraction t (0..1) of the polyline's length. */
export function pointAlong(p: Poly, t: number): LatLng {
  if (p.length === 1) return p[0];
  const total = polyLengthKm(p);
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < p.length; i++) {
    const seg = haversineKm(p[i - 1], p[i]);
    if (target <= seg || i === p.length - 1) {
      const k = seg > 0 ? Math.min(1, target / seg) : 0;
      return { lat: p[i - 1].lat + (p[i].lat - p[i - 1].lat) * k, lng: p[i - 1].lng + (p[i].lng - p[i - 1].lng) * k };
    }
    target -= seg;
  }
  return p[p.length - 1];
}

/** The remaining polyline after fraction t, starting exactly at the rider. */
export function sliceFrom(p: Poly, t: number): Poly {
  const start = pointAlong(p, t);
  const total = polyLengthKm(p);
  let target = Math.max(0, Math.min(1, t)) * total;
  const out: Poly = [start];
  for (let i = 1; i < p.length; i++) {
    const seg = haversineKm(p[i - 1], p[i]);
    if (target < seg) out.push(p[i]);
    target -= seg;
  }
  if (out.length === 1) out.push(p[p.length - 1]);
  return out;
}
