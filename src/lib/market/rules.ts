import { PICKUP_HANDLING_MIN, DROP_HANDLING_MIN } from "@/lib/engine/problem";
import { travelMinutes, haversineKm } from "@/lib/domain/geo";
import { checkCompatibility } from "@/lib/domain/rules";
import type { Category, LatLng, Rider, Shelter, SimState } from "@/lib/domain/types";
import type { Listing } from "@/lib/domain/market";

/* ------------------------------------------------------------------ buffer */

/** Safety buffer taken off the true expiry. Cooked food and cold chain get more headroom. */
const BUFFER: Record<Category, { pct: number; min: number }> = {
  cooked: { pct: 0.15, min: 15 },
  raw_ration: { pct: 0.08, min: 10 },
  medical: { pct: 0.1, min: 10 },
  infant_formula: { pct: 0.08, min: 10 },
  kit: { pct: 0.05, min: 10 },
};
const COLD_CHAIN_EXTRA = 10;
const BUFFER_CAP = 120;

export function bufferMin(category: Category, coldChain: boolean, shelfLifeMin: number): number {
  const b = BUFFER[category];
  const raw = Math.max(b.min, b.pct * shelfLifeMin) + (coldChain ? COLD_CHAIN_EXTRA : 0);
  return Math.min(BUFFER_CAP, Math.round(raw * 10) / 10);
}

export function bufferedDeadline(l: Pick<Listing, "category" | "coldChain" | "createdAt" | "expiresAt">): number {
  return l.expiresAt - bufferMin(l.category, l.coldChain, l.expiresAt - l.createdAt);
}

/* ----------------------------------------------------------- pessimistic ETA */

/**
 * Multiplier turning a mean trip time into its 90th percentile, matching the Monte Carlo model's
 * log-normal traffic noise (wider for less reliable riders and heavier traffic).
 */
export function p90Factor(reliability: number, traffic: number): number {
  const sigma = 0.22 * (1 + (1 - reliability) * 1.5) * Math.sqrt(traffic);
  return Math.exp(1.2816 * sigma - (sigma * sigma) / 2);
}

export interface TripTiming {
  rideMin: number;
  rideP90: number;
  legMin: number;
  legP90: number;
  /** Absolute minute the cargo reaches the shelter, pessimistic. */
  arrivalP90: number;
  /** Absolute minute at the mean estimate. */
  arrivalMean: number;
}

export function tripTiming(
  rider: Pick<Rider, "loc" | "speedKmh" | "reliability">,
  donorLoc: LatLng,
  shelterLoc: LatLng,
  now: number,
  traffic: number,
  readyAt = now,
): TripTiming {
  const f = p90Factor(rider.reliability, traffic);
  const rideMin = travelMinutes(rider.loc, donorLoc, { speedKmh: rider.speedKmh, traffic });
  const legMin = travelMinutes(donorLoc, shelterLoc, { speedKmh: rider.speedKmh, traffic });
  const rideP90 = rideMin * f;
  const legP90 = legMin * f;
  const pickupP90 = Math.max(now + rideP90, readyAt) + PICKUP_HANDLING_MIN;
  const pickupMean = Math.max(now + rideMin, readyAt) + PICKUP_HANDLING_MIN;
  return {
    rideMin,
    rideP90,
    legMin,
    legP90,
    arrivalP90: pickupP90 + legP90 + DROP_HANDLING_MIN,
    arrivalMean: pickupMean + legMin + DROP_HANDLING_MIN,
  };
}

/* --------------------------------------------------------- rider availability */

export function riderIsFree(state: SimState, r: Rider): boolean {
  if (r.status !== "idle" || r.silent) return false;
  if (r.cooldownUntil !== undefined && state.clock < r.cooldownUntil) return false;
  return !state.legs.some((l) => l.riderId === r.id && (l.state === "offered" || l.state === "to_pickup" || l.state === "to_drop"));
}

/* ---------------------------------------------------------------- reachability */

/** Default allowance when no free rider is near: assume one can be found within this many minutes. */
const NO_RIDER_ALLOWANCE_MIN = 15;
const MAX_ALLOWANCE_MIN = 20;

export interface Reach {
  ok: boolean;
  /** Plain-English reason when not reachable / compatible. */
  reason?: string;
  km: number;
  /** Donor → shelter drive, mean and pessimistic. */
  driveMin: number;
  driveP90: number;
  /** Time assumed for a rider to reach the donor. */
  riderAllowanceMin: number;
  hasNearbyRider: boolean;
  /** Pessimistic arrival (absolute minute). */
  arrivalP90: number;
  /** Minutes of spare time before the buffered deadline (and the request's needed-by). */
  slackMin: number;
  /** Minutes the supplies still have after arriving. */
  freshnessLeftMin: number;
  bufferedDeadline: number;
}

/**
 * Can supplies from this listing reach this shelter before they expire, with margin?
 * Uses the nearest free rider (pessimistic) as the pickup allowance, or a default when none is near.
 */
export function reachability(
  state: SimState,
  listing: Listing,
  shelter: Shelter,
  opts: { neededBy?: number | null; checkCompat?: boolean } = {},
): Reach {
  const donor = state.donors.find((d) => d.id === listing.donorId)!;
  const km = haversineKm(donor.loc, shelter.loc);
  const refRider = { speedKmh: 24, reliability: 0.9 };
  const f = p90Factor(refRider.reliability, state.trafficFactor);
  const driveMin = travelMinutes(donor.loc, shelter.loc, { speedKmh: refRider.speedKmh, traffic: state.trafficFactor });
  const driveP90 = driveMin * f;

  let allowance = NO_RIDER_ALLOWANCE_MIN;
  let near = false;
  for (const r of state.riders) {
    if (!riderIsFree(state, r)) continue;
    if (listing.coldChain && r.coldGear === false) continue;
    const eta = travelMinutes(r.loc, donor.loc, { speedKmh: r.speedKmh, traffic: state.trafficFactor }) * p90Factor(r.reliability, state.trafficFactor);
    if (!near || eta < allowance) {
      allowance = eta;
      near = true;
    }
  }
  allowance = Math.min(MAX_ALLOWANCE_MIN, allowance);

  const deadline = bufferedDeadline(listing);
  const limit = opts.neededBy != null ? Math.min(deadline, opts.neededBy) : deadline;
  const pickupAt = Math.max(state.clock + allowance, listing.readyAt) + PICKUP_HANDLING_MIN;
  const arrivalP90 = pickupAt + driveP90 + DROP_HANDLING_MIN;
  const slackMin = limit - arrivalP90;
  const base: Reach = {
    ok: slackMin >= 0,
    km,
    driveMin,
    driveP90,
    riderAllowanceMin: allowance,
    hasNearbyRider: near,
    arrivalP90,
    slackMin,
    freshnessLeftMin: listing.expiresAt - arrivalP90,
    bufferedDeadline: deadline,
  };
  if (state.clock >= listing.expiresAt) return { ...base, ok: false, reason: "Supplies have expired" };
  if (listing.availableQty <= 0) return { ...base, ok: false, reason: "Nothing left to reserve" };
  if (opts.checkCompat !== false) {
    const c = checkCompatibility(listing.category, shelter, { coldChain: listing.coldChain });
    if (!c.ok) return { ...base, ok: false, reason: c.reason };
  }
  if (!base.ok) return { ...base, reason: `Too far to arrive before the supplies expire (${Math.round(driveP90)} min drive, ${Math.round(Math.max(0, limit - state.clock))} min usable)` };
  return base;
}

/** All listings this shelter may see, nearest-to-expiry-safe first. */
export function eligibleListings(
  state: SimState,
  shelter: Shelter,
  opts: { category?: Category; neededBy?: number | null } = {},
) {
  const out: { listing: Listing; reach: Reach }[] = [];
  for (const l of state.market.listings) {
    if (l.status !== "available") continue;
    if (opts.category && l.category !== opts.category) continue;
    const reach = reachability(state, l, shelter, { neededBy: opts.neededBy });
    if (reach.ok) out.push({ listing: l, reach });
  }
  return out.sort((a, b) => b.reach.slackMin - a.reach.slackMin);
}

/** Why listings were hidden from a shelter (used by admin and explanations). */
export function hiddenListings(state: SimState, shelter: Shelter, category?: Category) {
  const out: { listing: Listing; reason: string }[] = [];
  for (const l of state.market.listings) {
    if (l.status !== "available") continue;
    if (category && l.category !== category) continue;
    const reach = reachability(state, l, shelter);
    if (!reach.ok) out.push({ listing: l, reason: reach.reason ?? "unreachable" });
  }
  return out;
}
