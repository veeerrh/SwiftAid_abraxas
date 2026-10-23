import { travelMinutes } from "@/lib/domain/geo";
import { checkCompatibility, type IncompatCode } from "@/lib/domain/rules";
import {
  DROP_HANDLING_MIN,
  PICKUP_HANDLING_MIN,
  SAFETY_MARGIN_MIN,
  type Assignment,
  type Cargo,
  type Plan,
  type PlanScore,
  type PoolRider,
  type PoolShelter,
  type Problem,
} from "./problem";

export type InfeasibleCode = IncompatCode | "CARRIER_MISMATCH" | "NO_CAPACITY" | "TOO_LATE" | "NO_SPACE";

export interface Feasibility {
  ok: boolean;
  code?: InfeasibleCode;
  reason?: string;
  pickupMin: number;
  dropMin: number;
  totalMin: number;
}

/** Riders already holding cargo (divert candidates) may only deliver that cargo. */
const carrierCache = new WeakMap<Problem, Set<string>>();
function carriersOf(problem: Problem): Set<string> {
  let set = carrierCache.get(problem);
  if (!set) {
    set = new Set(problem.cargos.flatMap((c) => (c.carrierRiderId ? [c.carrierRiderId] : [])));
    carrierCache.set(problem, set);
  }
  return set;
}

export function legTimes(problem: Problem, cargo: Cargo, rider: PoolRider, shelter: PoolShelter) {
  const holds = cargo.carrierRiderId === rider.id;
  const pickupMin = holds
    ? 0
    : travelMinutes(rider.loc, cargo.loc, { speedKmh: rider.speedKmh, traffic: problem.traffic }) +
      PICKUP_HANDLING_MIN;
  const dropMin =
    travelMinutes(cargo.loc, shelter.shelter.loc, { speedKmh: rider.speedKmh, traffic: problem.traffic }) +
    DROP_HANDLING_MIN;
  return { pickupMin, dropMin, totalMin: pickupMin + dropMin };
}

/** Hard rules for a (cargo, rider, shelter) triple, independent of quantity bookkeeping. */
export function checkFeasible(
  problem: Problem,
  cargo: Cargo,
  rider: PoolRider,
  shelter: PoolShelter,
): Feasibility {
  const t = legTimes(problem, cargo, rider, shelter);
  const fail = (code: InfeasibleCode, reason: string): Feasibility => ({ ok: false, code, reason, ...t });

  if (cargo.carrierRiderId && cargo.carrierRiderId !== rider.id) {
    return fail("CARRIER_MISMATCH", "Cargo is already on another rider");
  }
  if (!cargo.carrierRiderId && carriersOf(problem).has(rider.id)) {
    return fail("CARRIER_MISMATCH", "Rider is already carrying other cargo");
  }
  if (rider.capacity <= 0) return fail("NO_CAPACITY", "Rider has no carrying capacity");

  const compat = checkCompatibility(cargo.category, shelter.shelter, { coldChain: cargo.coldChain });
  if (!compat.ok) return fail(compat.code!, compat.reason!);

  if (shelter.available < Math.min(cargo.chunk, cargo.qty)) {
    return fail("NO_SPACE", `${shelter.shelter.name} has no free capacity`);
  }

  const arrival = problem.now + t.totalMin;
  if (arrival > cargo.expiresAt - SAFETY_MARGIN_MIN) {
    return fail(
      "TOO_LATE",
      `Would arrive in ${t.totalMin.toFixed(0)} min, past the safe window (${(cargo.expiresAt - problem.now).toFixed(0)} min left)`,
    );
  }
  return { ok: true, ...t };
}

function erf(x: number): number {
  // Abramowitz–Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Closed-form survival estimate used inside optimizer loops:
 * P(arrive before expiry) × P(rider doesn't ghost). The displayed
 * Monte Carlo (see monteCarlo.ts) refines this with full sampling.
 */
export function analyticSurvival(
  totalMin: number,
  minutesLeft: number,
  reliability: number,
): number {
  const sigma = Math.max(0.5, 0.18 * totalMin * (1 + (1 - reliability) * 1.5));
  const onTime = normalCdf((minutesLeft - totalMin) / sigma);
  return Math.max(0, Math.min(1, onTime * reliability));
}

/** Quantity a (rider, shelter) pair can take from a cargo, respecting chunking. */
export function fitQty(riderCap: number, remaining: number, shelterAvail: number, chunk: number): number {
  const q = Math.min(riderCap, remaining, shelterAvail);
  if (q <= 0) return 0;
  if (q === remaining) return q;
  const floored = Math.floor(q / chunk) * chunk;
  return floored > 0 ? floored : q >= chunk ? chunk : 0;
}

export function scorePlan(problem: Problem, plan: Plan): PlanScore {
  let expectedSafe = 0;
  let placedQty = 0;
  let travelMin = 0;
  let surv = 0;
  for (const a of plan.assignments) {
    expectedSafe += a.qty * a.survival;
    placedQty += a.qty;
    travelMin += a.totalMin;
    surv += a.survival * a.qty;
  }
  const avgSurvival = placedQty > 0 ? surv / placedQty : 0;
  const fitness = expectedSafe * 10 + placedQty - 0.05 * travelMin;
  return { expectedSafe, placedQty, avgSurvival, travelMin, fitness };
}

export function buildAssignment(
  problem: Problem,
  cargo: Cargo,
  rider: PoolRider,
  shelter: PoolShelter,
  qty: number,
): Assignment {
  const t = legTimes(problem, cargo, rider, shelter);
  return {
    cargoId: cargo.id,
    riderId: rider.id,
    shelterId: shelter.shelter.id,
    qty,
    pickupMin: t.pickupMin,
    dropMin: t.dropMin,
    totalMin: t.totalMin,
    survival: analyticSurvival(t.totalMin, cargo.expiresAt - problem.now, rider.reliability),
  };
}
