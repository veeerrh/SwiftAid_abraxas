import type { LatLng } from "./types";

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** City roads are longer than the crow flies. */
export const ROAD_FACTOR = 1.35;
export const MIN_LEG_MINUTES = 1.5;

export function travelMinutes(
  a: LatLng,
  b: LatLng,
  opts: { speedKmh?: number; traffic?: number } = {},
): number {
  const speed = opts.speedKmh ?? 24;
  const traffic = opts.traffic ?? 1;
  const km = haversineKm(a, b) * ROAD_FACTOR;
  return Math.max(MIN_LEG_MINUTES, (km / speed) * 60 * traffic);
}

export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  const k = Math.max(0, Math.min(1, t));
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
}
