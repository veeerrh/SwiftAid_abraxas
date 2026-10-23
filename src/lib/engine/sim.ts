import { lerpLatLng, travelMinutes } from "@/lib/domain/geo";
import { CATEGORY_META, checkCompatibility } from "@/lib/domain/rules";
import { makeBatch } from "@/lib/domain/seed";
import type {
  Batch,
  Category,
  EventSeverity,
  Leg,
  LegState,
  Rider,
  Shelter,
  SimState,
} from "@/lib/domain/types";
import { buildAssignment, checkFeasible } from "./feasibility";
import { greedyPlan } from "./greedy";
import { monteCarlo } from "./monteCarlo";
import {
  DROP_HANDLING_MIN,
  type Cargo,
  type Plan,
  type PoolRider,
  type PoolShelter,
  type Problem,
} from "./problem";
import { solve } from "./solver";
import { validatePlan } from "./validator";

/* ------------------------------------------------------------------ helpers */

export const ACTIVE_STATES: LegState[] = ["offered", "accepted", "to_pickup", "to_drop"];
const MOVING_STATES: LegState[] = ["to_pickup", "to_drop"];
/** Heartbeat silence after which a rider is shown as ghosting. */
export const GHOST_WARN_MIN = 1.5;

export const isActive = (l: Leg) => ACTIVE_STATES.includes(l.state);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function newId(state: SimState, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}

export function log(
  state: SimState,
  severity: EventSeverity,
  type: string,
  text: string,
  refs: { batchId?: string; riderId?: string; shelterId?: string } = {},
) {
  state.events.push({ id: state.nextId++, at: state.clock, severity, type, text, ...refs });
  if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
}

const batchOf = (s: SimState, id: string) => s.batches.find((b) => b.id === id)!;
const riderOf = (s: SimState, id: string) => s.riders.find((r) => r.id === id)!;
const shelterOf = (s: SimState, id: string) => s.shelters.find((x) => x.id === id)!;
const donorOf = (s: SimState, id: string) => s.donors.find((d) => d.id === id)!;

export function activeLegs(state: SimState) {
  return state.legs.filter(isActive);
}

/** Capacity already promised to in-flight legs at a shelter. */
export function reservedAt(state: SimState, shelterId: string, exclude?: Set<string>): number {
  return state.legs
    .filter((l) => isActive(l) && l.shelterId === shelterId && !exclude?.has(l.id))
    .reduce((n, l) => n + l.qty, 0);
}

export function availableAt(state: SimState, shelterId: string, exclude?: Set<string>): number {
  return Math.max(0, shelterOf(state, shelterId).capacityRemaining - reservedAt(state, shelterId, exclude));
}

/* ----------------------------------------------------------------- planning */

interface Built {
  problem: Problem;
  divertLegs: Map<string, Leg>;
}

function standbyRiderIds(state: SimState): Set<string> {
  return new Set(activeLegs(state).flatMap((l) => (l.standbyRiderId ? [l.standbyRiderId] : [])));
}

function poolRider(r: Rider): PoolRider {
  return { id: r.id, loc: r.loc, capacity: r.capacity, speedKmh: r.speedKmh, reliability: r.reliability };
}

export function buildProblem(
  state: SimState,
  divertLegs: Leg[] = [],
  opts: { onlyRiders?: string[]; onlyBatchId?: string; ignoreStandby?: boolean } = {},
): Built {
  const cargos: Cargo[] = [];
  for (const b of state.batches) {
    if (opts.onlyBatchId && b.id !== opts.onlyBatchId) continue;
    if (b.unplacedQty <= 0 || state.clock >= b.expiresAt) continue;
    const donor = donorOf(state, b.donorId);
    const recov = b.recovery ?? [];
    const recSum = recov.reduce((n, r) => n + r.qty, 0);
    const base = {
      batchId: b.id,
      category: b.category,
      expiresAt: b.expiresAt,
      coldChain: b.coldChain,
      chunk: CATEGORY_META[b.category].chunk,
    };
    const atDonor = b.unplacedQty - recSum;
    if (atDonor > 0) cargos.push({ ...base, id: `${b.id}:d`, qty: atDonor, loc: donor.loc });
    recov.forEach((r, i) => {
      if (r.qty > 0) cargos.push({ ...base, id: `${b.id}:r${i}`, qty: r.qty, loc: r.loc });
    });
  }

  const divertMap = new Map<string, Leg>();
  for (const leg of divertLegs) {
    if (opts.onlyBatchId && leg.batchId !== opts.onlyBatchId) continue;
    const b = batchOf(state, leg.batchId);
    const rider = riderOf(state, leg.riderId);
    const id = `dv:${leg.id}`;
    divertMap.set(id, leg);
    cargos.push({
      id,
      batchId: b.id,
      category: b.category,
      qty: leg.qty,
      loc: rider.loc,
      expiresAt: b.expiresAt,
      coldChain: b.coldChain,
      chunk: leg.qty,
      carrierRiderId: rider.id,
    });
  }

  const standby = opts.ignoreStandby ? new Set<string>() : standbyRiderIds(state);
  const carriers = new Set(divertLegs.map((l) => l.riderId));
  const riders: PoolRider[] = state.riders
    .filter((r) => {
      if (opts.onlyRiders && !opts.onlyRiders.includes(r.id)) return false;
      if (carriers.has(r.id)) return true;
      if (r.status !== "idle" || r.silent) return false;
      if (r.cooldownUntil !== undefined && state.clock < r.cooldownUntil) return false;
      if (standby.has(r.id)) return false;
      return true;
    })
    .map(poolRider);

  const exclude = new Set(divertLegs.map((l) => l.id));
  const shelters: PoolShelter[] = state.shelters.map((s) => ({
    shelter: s,
    available: availableAt(state, s.id, exclude),
  }));

  return { problem: { now: state.clock, traffic: state.trafficFactor, cargos, riders, shelters }, divertLegs: divertMap };
}

export function requestReplan(state: SimState, reason: string) {
  if (!state.replanReasons.includes(reason)) state.replanReasons.push(reason);
}

const REASON_PRIORITY = [
  "NO_CLEAN_WATER",
  "NO_COOKING_FUEL",
  "NO_COLD_STORAGE",
  "NOT_ACCEPTED",
  "TOO_LATE",
  "NO_SPACE",
  "SHELTER_CLOSED",
];

/** Human-readable reason a cargo found no safe destination, most informative cause first. */
function explainBlocked(_state: SimState, problem: Problem, cargo: Cargo): string {
  if (problem.riders.length === 0) return "no riders are available";
  const rider = problem.riders[0];
  const found = new Map<string, string[]>();
  const add = (code: string, text: string) => found.set(code, [...(found.get(code) ?? []), text]);
  for (const sh of problem.shelters) {
    const compat = checkCompatibility(cargo.category, sh.shelter, { coldChain: cargo.coldChain });
    if (!compat.ok) {
      add(compat.code!, compat.reason!);
      continue;
    }
    if (sh.available < Math.min(cargo.chunk, cargo.qty)) {
      add("NO_SPACE", `${sh.shelter.name} is full`);
      continue;
    }
    const f = checkFeasible(problem, cargo, rider, sh);
    if (!f.ok) add(f.code!, f.reason!);
  }
  const parts: string[] = [];
  for (const code of REASON_PRIORITY) {
    const list = found.get(code);
    if (!list) continue;
    if (code === "SHELTER_CLOSED") parts.push(`${list.length} shelter${list.length > 1 ? "s are" : " is"} closed`);
    else if (code === "NO_SPACE") parts.push(`${list.length} shelter${list.length > 1 ? "s are" : " is"} full`);
    else parts.push(list[0]);
  }
  return parts.slice(0, 3).join("; ") || "no safe destination within the shelf-life window";
}

/** Legs whose destination became unsafe: closed/full/incompatible shelter or a missed deadline. */
export function findInvalidLegs(state: SimState): { leg: Leg; reason: string }[] {
  const out: { leg: Leg; reason: string }[] = [];
  const claimed = new Map<string, number>();
  const ordered = activeLegs(state).sort((a, b) => {
    const pa = a.phase === "drop" ? 0 : 1;
    const pb = b.phase === "drop" ? 0 : 1;
    return pa - pb || a.createdAt - b.createdAt;
  });
  for (const leg of ordered) {
    const shelter = shelterOf(state, leg.shelterId);
    const batch = batchOf(state, leg.batchId);
    const compat = checkCompatibility(batch.category, shelter, { coldChain: batch.coldChain });
    if (!compat.ok) {
      out.push({ leg, reason: compat.reason! });
      continue;
    }
    const used = (claimed.get(shelter.id) ?? 0) + leg.qty;
    if (used > shelter.capacityRemaining) {
      out.push({ leg, reason: `${shelter.name} no longer has room` });
      continue;
    }
    claimed.set(shelter.id, used);
    if (leg.dropEta > batch.expiresAt - 0.5 && !leg.note?.startsWith("late")) {
      out.push({ leg, reason: `ETA now beyond the safe window for ${batch.label}` });
    }
  }
  return out;
}

function refreshSurvival(state: SimState, leg: Leg) {
  const batch = batchOf(state, leg.batchId);
  const rider = riderOf(state, leg.riderId);
  leg.survival = monteCarlo({
    etaMin: Math.max(0.5, leg.dropEta - state.clock),
    minutesLeft: Math.max(0, batch.expiresAt - state.clock),
    reliability: rider.silent ? 0.05 : rider.reliability,
    traffic: state.trafficFactor,
    hasStandby: !!leg.standbyRiderId,
    samples: 1500,
    seed: hash(leg.id) ^ state.seed,
  });
}

function assignStandby(state: SimState, problem: Problem, leg: Leg, taken: Set<string>) {
  const cargo: Cargo = {
    id: "standby",
    batchId: leg.batchId,
    category: batchOf(state, leg.batchId).category,
    qty: leg.qty,
    loc: leg.originLoc,
    expiresAt: batchOf(state, leg.batchId).expiresAt,
    coldChain: batchOf(state, leg.batchId).coldChain,
    chunk: 1,
  };
  const shelter = problem.shelters.find((s) => s.shelter.id === leg.shelterId);
  if (!shelter) return;
  let best: { id: string; total: number } | null = null;
  for (const r of problem.riders) {
    if (taken.has(r.id) || r.capacity < leg.qty) continue;
    const f = checkFeasible(problem, cargo, r, { ...shelter, available: Math.max(shelter.available, leg.qty) });
    if (!f.ok) continue;
    if (!best || f.totalMin < best.total) best = { id: r.id, total: f.totalMin };
  }
  if (best) {
    leg.standbyRiderId = best.id;
    taken.add(best.id);
  }
}

function makeLeg(state: SimState, cargo: Cargo, a: ReturnType<typeof buildAssignment>): Leg {
  const batch = batchOf(state, cargo.batchId);
  const rider = riderOf(state, a.riderId);
  const shelter = shelterOf(state, a.shelterId);
  const left = batch.expiresAt - state.clock;
  const leg: Leg = {
    id: newId(state, "L"),
    batchId: batch.id,
    riderId: rider.id,
    shelterId: shelter.id,
    qty: a.qty,
    state: "offered",
    createdAt: state.clock,
    offerExpiresAt: state.clock + clamp(0.1 * left, 1.5, 4),
    leaseTtl: clamp(0.15 * left, 2, 8),
    originLoc: cargo.loc,
    carrying: false,
    phase: "pickup",
    phaseFrom: rider.loc,
    phaseTo: cargo.loc,
    phaseStart: state.clock,
    phaseDuration: a.pickupMin,
    dropEta: state.clock + a.totalMin,
  };
  rider.status = "busy";
  return leg;
}

/** Run the planner over everything unplaced/invalid and apply the validated result. */
export function replan(state: SimState, reason: string, opts: { onlyRiders?: string[]; onlyBatchId?: string } = {}) {
  state.lastReplanAt = state.clock;

  // 1. Handle legs whose destination went bad.
  const divertLegs: Leg[] = [];
  for (const { leg, reason: why } of findInvalidLegs(state)) {
    if (opts.onlyBatchId && leg.batchId !== opts.onlyBatchId) continue;
    if (leg.phase === "drop" && leg.state === "to_drop") {
      leg.note = leg.note === "stranded" ? "stranded" : `divert: ${why}`;
      divertLegs.push(leg);
    } else {
      releaseLeg(state, leg, why, { ghost: false, quiet: false, noCooldown: true, defer: true });
    }
  }

  state.replanReasons = state.replanReasons.filter((r) => r !== "leg released");

  const built = buildProblem(state, divertLegs, opts);
  const { problem, divertLegs: divertMap } = built;
  if (problem.cargos.length === 0) return;

  const out = solve(problem, state.algo, state.seed + state.nextId);
  let plan: Plan = out.plan;
  const v = validatePlan(problem, plan);
  if (!v.ok) {
    state.metrics.blockedDispatches += v.violations.length;
    log(state, "critical", "plan_rejected", `Safety validator rejected a plan: ${v.violations[0].message}. Falling back to baseline.`);
    plan = greedyPlan(problem);
    if (!validatePlan(problem, plan).ok) return;
  }

  state.optimizerRuns.push({
    id: state.nextId++,
    at: state.clock,
    reason,
    chosen: out.chosen,
    results: out.results,
  });
  if (state.optimizerRuns.length > 12) state.optimizerRuns.shift();

  applyPlan(state, problem, plan, divertMap, reason);
}

function applyPlan(
  state: SimState,
  problem: Problem,
  plan: Plan,
  divertMap: Map<string, Leg>,
  reason: string,
) {
  const newLegs: Leg[] = [];
  const recoveryUsed = new Map<string, Map<number, number>>();
  const placedByBatch = new Map<string, number>();

  for (const a of plan.assignments) {
    const cargo = problem.cargos.find((c) => c.id === a.cargoId)!;
    const batch = batchOf(state, cargo.batchId);

    const dvLeg = divertMap.get(cargo.id);
    if (dvLeg) {
      const rider = riderOf(state, dvLeg.riderId);
      const from = shelterOf(state, dvLeg.shelterId);
      const to = shelterOf(state, a.shelterId);
      dvLeg.divertedFrom = from.id;
      dvLeg.divertedAt = state.clock;
      dvLeg.shelterId = to.id;
      dvLeg.phaseFrom = { ...rider.loc };
      dvLeg.phaseTo = { ...to.loc };
      dvLeg.phaseStart = state.clock;
      dvLeg.phaseDuration = a.dropMin;
      dvLeg.dropEta = state.clock + a.dropMin;
      dvLeg.note = undefined;
      state.metrics.diverts++;
      refreshSurvival(state, dvLeg);
      log(
        state,
        "success",
        "divert",
        `${rider.name} diverted from ${from.name} to ${to.name} with ${dvLeg.qty} ${batch.unit} — ${reason}`,
        { riderId: rider.id, shelterId: to.id, batchId: batch.id },
      );
      continue;
    }

    const leg = makeLeg(state, cargo, a);
    newLegs.push(leg);
    state.legs.push(leg);
    batch.unplacedQty = Math.max(0, batch.unplacedQty - a.qty);
    batch.blockedLogged = false;
    placedByBatch.set(batch.id, (placedByBatch.get(batch.id) ?? 0) + a.qty);

    const m = cargo.id.match(/:r(\d+)$/);
    if (m) {
      const per = recoveryUsed.get(batch.id) ?? new Map<number, number>();
      per.set(+m[1], (per.get(+m[1]) ?? 0) + a.qty);
      recoveryUsed.set(batch.id, per);
    }
    if (batch.ghostSince !== undefined) {
      state.metrics.ghostRecoveries++;
      state.metrics.responseMinSum += state.clock - batch.ghostSince;
      state.metrics.responseCount++;
      log(
        state,
        "success",
        "ghost_recovered",
        `Recovered ${a.qty} ${batch.unit} of ${batch.label}: reassigned to ${riderOf(state, a.riderId).name} ${(state.clock - batch.ghostSince).toFixed(1)} min after the rider went silent`,
        { batchId: batch.id, riderId: a.riderId },
      );
      batch.ghostSince = undefined;
    }
  }

  for (const [batchId, per] of recoveryUsed) {
    const b = batchOf(state, batchId);
    b.recovery = (b.recovery ?? [])
      .map((r, i) => ({ ...r, qty: r.qty - (per.get(i) ?? 0) }))
      .filter((r) => r.qty > 0);
  }

  // Standby riders for risky legs, then survival estimates.
  const taken = new Set(newLegs.map((l) => l.riderId));
  for (const leg of newLegs) {
    const asg = plan.assignments.find((a) => a.riderId === leg.riderId && a.shelterId === leg.shelterId)!;
    if (asg.survival < 0.85) assignStandby(state, problem, leg, taken);
    refreshSurvival(state, leg);
  }

  // Summaries + blocked reporting.
  const byBatch = new Map<string, Leg[]>();
  for (const l of newLegs) byBatch.set(l.batchId, [...(byBatch.get(l.batchId) ?? []), l]);
  for (const [batchId, legs] of byBatch) {
    const b = batchOf(state, batchId);
    const riders = new Set(legs.map((l) => l.riderId)).size;
    const shelters = new Set(legs.map((l) => l.shelterId)).size;
    const qty = legs.reduce((n, l) => n + l.qty, 0);
    const surv = legs.reduce((n, l) => n + (l.survival?.p ?? 0) * l.qty, 0) / Math.max(1, qty);
    log(
      state,
      "info",
      "planned",
      `Planned ${qty} ${b.unit} of ${b.label} → ${riders} rider${riders > 1 ? "s" : ""} → ${shelters} shelter${shelters > 1 ? "s" : ""} (survival ${(surv * 100).toFixed(0)}%)`,
      { batchId },
    );
  }
  for (const cargo of problem.cargos) {
    if (divertMap.has(cargo.id)) {
      const placed = plan.assignments.some((a) => a.cargoId === cargo.id);
      if (!placed) {
        const leg = divertMap.get(cargo.id)!;
        if (leg.note !== "stranded") {
          leg.note = "stranded";
          const rider = riderOf(state, leg.riderId);
          batchOf(state, leg.batchId).status = "at_risk";
          log(
            state,
            "critical",
            "stranded",
            `${rider.name} is stranded with ${leg.qty} ${batchOf(state, leg.batchId).unit}: no safe shelter is reachable in time (${explainBlocked(state, problem, cargo)}). Suggest returning to donor cold-hold.`,
            { riderId: rider.id, batchId: leg.batchId },
          );
        }
      }
      continue;
    }
    const got = plan.assignments.filter((a) => a.cargoId === cargo.id).reduce((n, a) => n + a.qty, 0);
    if (got < cargo.qty) {
      const b = batchOf(state, cargo.batchId);
      if (!b.blockedLogged) {
        b.blockedLogged = true;
        state.metrics.blockedDispatches++;
        log(
          state,
          "warn",
          "blocked",
          `${cargo.qty - got} ${b.unit} of ${b.label} held back: ${explainBlocked(state, problem, cargo)}`,
          { batchId: b.id },
        );
      }
    }
  }
}

export function flushReplan(state: SimState) {
  if (state.replanReasons.length === 0) return;
  const reason = state.replanReasons.join("; ");
  state.replanReasons = [];
  replan(state, reason);
  refreshStatuses(state);
}

/* ------------------------------------------------------------------- leases */

export function releaseLeg(
  state: SimState,
  leg: Leg,
  reason: string,
  opts: { ghost: boolean; quiet?: boolean; noCooldown?: boolean; defer?: boolean } = { ghost: false },
) {
  if (!isActive(leg)) return;
  const batch = batchOf(state, leg.batchId);
  const rider = riderOf(state, leg.riderId);
  const silentFor = state.clock - rider.lastHeartbeat;

  leg.state = "released";
  leg.releasedReason = reason;
  batch.unplacedQty += leg.qty;
  if (leg.carrying) {
    batch.recovery = [...(batch.recovery ?? []), { loc: { ...rider.loc }, qty: leg.qty }];
  }
  if (opts.ghost) batch.ghostSince = rider.lastHeartbeat;

  rider.status = rider.silent ? "ghosting" : "idle";
  if (!opts.noCooldown) rider.cooldownUntil = state.clock + (opts.ghost ? 999 : 3);

  if (!opts.quiet) {
    log(
      state,
      opts.ghost ? "critical" : "warn",
      opts.ghost ? "lease_expired" : "released",
      opts.ghost
        ? `${rider.name} silent for ${silentFor.toFixed(1)} min — lease released, ${leg.qty} ${batch.unit} of ${batch.label} returned to the pool`
        : `${rider.name}'s ${leg.qty} ${batch.unit} released: ${reason}`,
      { riderId: rider.id, batchId: batch.id, shelterId: leg.shelterId },
    );
  }

  // Hot standby gets first refusal, before the general replan.
  if (leg.standbyRiderId && opts.ghost) {
    const sb = riderOf(state, leg.standbyRiderId);
    if (sb.status === "idle" && !sb.silent) {
      log(state, "info", "standby", `Hot standby ${sb.name} activated for ${batch.label}`, { riderId: sb.id, batchId: batch.id });
      leg.standbyRiderId = undefined;
      replan(state, "standby activation", { onlyRiders: [sb.id], onlyBatchId: batch.id });
    }
  }
  if (!opts.defer) requestReplan(state, opts.ghost ? "ghost recovery" : "leg released");
  else requestReplan(state, "leg released");
}

export function acceptLeg(state: SimState, legId: string): boolean {
  const leg = state.legs.find((l) => l.id === legId);
  if (!leg || leg.state !== "offered") return false;
  const rider = riderOf(state, leg.riderId);
  const total = leg.dropEta - leg.createdAt;
  leg.state = "to_pickup";
  leg.phaseStart = state.clock;
  leg.dropEta = state.clock + total;
  rider.lastHeartbeat = state.clock;
  log(state, "info", "accepted", `${rider.name} accepted ${leg.qty} ${batchOf(state, leg.batchId).unit} → ${shelterOf(state, leg.shelterId).name}`, {
    riderId: rider.id,
    batchId: leg.batchId,
    shelterId: leg.shelterId,
  });
  return true;
}

export function declineLeg(state: SimState, legId: string): boolean {
  const leg = state.legs.find((l) => l.id === legId);
  if (!leg || leg.state !== "offered") return false;
  releaseLeg(state, leg, "declined by rider", { ghost: false });
  flushReplan(state);
  return true;
}

export function heartbeat(state: SimState, riderId: string) {
  const r = state.riders.find((x) => x.id === riderId);
  if (r && !r.silent) r.lastHeartbeat = state.clock;
}

/* ------------------------------------------------------------------ batches */

export function addBatch(
  state: SimState,
  p: {
    donorId: string;
    category: Category;
    qty: number;
    label?: string;
    safeMin?: number;
    coldChain?: boolean;
    notes?: string;
    riskFlags?: string[];
  },
): Batch {
  const donor = donorOf(state, p.donorId);
  const meta = CATEGORY_META[p.category];
  const b = makeBatch(newId(state, "B"), {
    donorId: donor.id,
    label: p.label ?? `${meta.label} from ${donor.name}`,
    category: p.category,
    qty: Math.max(1, Math.round(p.qty)),
    now: state.clock,
    safeMin: p.safeMin ?? meta.defaultSafeMin,
    coldChain: p.coldChain,
    notes: p.notes,
    riskFlags: p.riskFlags,
  });
  state.batches.push(b);
  log(
    state,
    "info",
    "batch_created",
    `${donor.name} posted ${b.qty} ${b.unit} of ${meta.label.toLowerCase()} — safe for ${p.safeMin ?? meta.defaultSafeMin} min`,
    { batchId: b.id },
  );
  requestReplan(state, "new donation");
  flushReplan(state);
  return b;
}

/* --------------------------------------------------------------- statuses */

export function refreshStatuses(state: SimState) {
  for (const b of state.batches) {
    const legs = state.legs.filter((l) => l.batchId === b.id && isActive(l));
    const inflight = legs.reduce((n, l) => n + l.qty, 0);
    if (inflight === 0 && b.unplacedQty <= 0) {
      if (b.spoiledQty === 0) b.status = "delivered";
      else b.status = b.deliveredQty > 0 ? "partial" : "spoiled";
    } else if (legs.some((l) => (l.survival?.p ?? 1) < 0.6) || legs.some((l) => l.note === "stranded")) {
      b.status = "at_risk";
    } else if (inflight > 0) {
      b.status = b.deliveredQty > 0 || legs.some((l) => l.state === "to_drop") ? "in_progress" : "planned";
    } else {
      b.status = state.clock - b.createdAt > 0.5 && b.blockedLogged ? "at_risk" : "pending";
    }
  }
  for (const r of state.riders) {
    const has = state.legs.some((l) => isActive(l) && l.riderId === r.id);
    if (r.status === "offline") continue;
    if (r.silent && (has || state.clock - r.lastHeartbeat > GHOST_WARN_MIN)) r.status = "ghosting";
    else if (has) r.status = "busy";
    else r.status = r.silent ? "ghosting" : "idle";
  }
}

/* --------------------------------------------------------------------- tick */

export function tick(state: SimState, dtMin: number) {
  if (dtMin <= 0) return;
  state.clock += dtMin;

  if (state.trafficUntil !== null && state.clock >= state.trafficUntil) {
    applyTraffic(state, 1);
    state.trafficUntil = null;
    log(state, "info", "traffic_clear", "Traffic has cleared across the city");
  }

  // Auto heartbeats for simulated riders.
  for (const r of state.riders) {
    if (!r.manual && !r.silent && r.status !== "offline") r.lastHeartbeat = state.clock;
  }

  // Expiry sweeps.
  for (const b of state.batches) {
    if (b.unplacedQty > 0 && state.clock >= b.expiresAt) {
      const lost = b.unplacedQty;
      b.spoiledQty += lost;
      b.unplacedQty = 0;
      b.recovery = [];
      state.metrics.spoiled += lost;
      log(state, "critical", "spoiled", `${lost} ${b.unit} of ${b.label} expired before it could be dispatched`, { batchId: b.id });
    }
  }
  for (const leg of activeLegs(state)) {
    const b = batchOf(state, leg.batchId);
    if (state.clock >= b.expiresAt) {
      leg.state = "failed";
      leg.note = "expired in transit";
      b.spoiledQty += leg.qty;
      state.metrics.spoiled += leg.qty;
      const r = riderOf(state, leg.riderId);
      r.status = r.silent ? "ghosting" : "idle";
      log(state, "critical", "spoiled", `${leg.qty} ${b.unit} of ${b.label} expired in transit with ${r.name}`, { batchId: b.id, riderId: r.id });
    }
  }

  // Offers.
  for (const leg of state.legs.filter((l) => l.state === "offered")) {
    const rider = riderOf(state, leg.riderId);
    if (!rider.manual && !rider.silent && state.clock - leg.createdAt >= 0.4) {
      acceptLeg(state, leg.id);
    } else if (state.clock >= leg.offerExpiresAt) {
      releaseLeg(state, leg, rider.silent ? "no response to offer" : "offer timed out", { ghost: rider.silent });
    }
  }

  // Leases + movement.
  for (const leg of state.legs.filter((l) => MOVING_STATES.includes(l.state))) {
    const rider = riderOf(state, leg.riderId);
    const silentFor = state.clock - rider.lastHeartbeat;
    if (silentFor > leg.leaseTtl) {
      releaseLeg(state, leg, "heartbeat lost", { ghost: true });
      continue;
    }
    if (silentFor > GHOST_WARN_MIN && rider.status !== "ghosting") {
      rider.status = "ghosting";
      log(state, "warn", "ghost_warning", `${rider.name} has gone quiet (${silentFor.toFixed(1)} min without a heartbeat)`, {
        riderId: rider.id,
        batchId: leg.batchId,
      });
    }
    if (rider.silent) {
      leg.phaseStart += dtMin;
      leg.dropEta += dtMin;
    }
    advance(state, leg, rider);
  }

  // Destinations that went bad.
  const invalid = findInvalidLegs(state);
  if (invalid.length > 0) {
    const fresh = invalid.filter(({ leg }) => leg.note !== "stranded");
    if (fresh.length > 0) requestReplan(state, fresh[0].reason);
  }

  // Periodic retry for anything still waiting.
  if (
    state.batches.some((b) => b.unplacedQty > 0 && state.clock < b.expiresAt) &&
    state.clock - state.lastReplanAt >= 2
  ) {
    requestReplan(state, "retry");
  }
  // Stranded carriers retry as shelters free up.
  if (activeLegs(state).some((l) => l.note === "stranded") && state.clock - state.lastReplanAt >= 2) {
    requestReplan(state, "retry stranded");
  }

  // Refresh survival once per sim minute.
  if (Math.floor(state.clock) !== Math.floor(state.clock - dtMin)) {
    for (const leg of activeLegs(state)) refreshSurvival(state, leg);
    sampleSeries(state);
  }

  refreshStatuses(state);
  flushReplan(state);
}

function advance(state: SimState, leg: Leg, rider: Rider) {
  for (let guard = 0; guard < 4; guard++) {
    if (!MOVING_STATES.includes(leg.state)) return;
    const end = leg.phaseStart + leg.phaseDuration;
    const t = leg.phaseDuration > 0 ? (state.clock - leg.phaseStart) / leg.phaseDuration : 1;
    rider.loc = lerpLatLng(leg.phaseFrom, leg.phaseTo, t);
    if (state.clock < end) return;

    if (leg.phase === "pickup") {
      const batch = batchOf(state, leg.batchId);
      const shelter = shelterOf(state, leg.shelterId);
      leg.phase = "drop";
      leg.state = "to_drop";
      leg.carrying = true;
      leg.phaseFrom = { ...leg.originLoc };
      leg.phaseTo = { ...shelter.loc };
      leg.phaseStart = end;
      leg.phaseDuration =
        travelMinutes(leg.originLoc, shelter.loc, { speedKmh: rider.speedKmh, traffic: state.trafficFactor }) +
        DROP_HANDLING_MIN;
      leg.dropEta = leg.phaseStart + leg.phaseDuration;
      rider.loc = { ...leg.originLoc };
      log(state, "info", "picked_up", `${rider.name} picked up ${leg.qty} ${batch.unit} of ${batch.label}`, {
        riderId: rider.id,
        batchId: batch.id,
      });
      continue;
    }
    if (!tryDeliver(state, leg, rider)) return;
    return;
  }
}

function tryDeliver(state: SimState, leg: Leg, rider: Rider): boolean {
  const shelter = shelterOf(state, leg.shelterId);
  const batch = batchOf(state, leg.batchId);
  const compat = checkCompatibility(batch.category, shelter, { coldChain: batch.coldChain });
  if (!compat.ok || shelter.capacityRemaining < leg.qty) {
    // Wait at the door a moment; the planner will divert this rider.
    leg.phaseStart += 1;
    leg.dropEta += 1;
    requestReplan(state, compat.ok ? `${shelter.name} no longer has room` : compat.reason!);
    return false;
  }
  shelter.capacityRemaining -= leg.qty;
  batch.deliveredQty += leg.qty;
  state.metrics.delivered += leg.qty;
  leg.state = "delivered";
  leg.phase = "done";
  rider.loc = { ...shelter.loc };
  rider.status = rider.silent ? "ghosting" : "idle";
  log(state, "success", "delivered", `${rider.name} delivered ${leg.qty} ${batch.unit} to ${shelter.name}`, {
    riderId: rider.id,
    batchId: batch.id,
    shelterId: shelter.id,
  });
  return true;
}

function sampleSeries(state: SimState) {
  state.metrics.series.push({
    t: Math.floor(state.clock),
    delivered: state.metrics.delivered,
    spoiled: state.metrics.spoiled,
    active: activeLegs(state).length,
  });
  if (state.metrics.series.length > 400) state.metrics.series.shift();
}

/* ------------------------------------------------------------------- chaos */

/** Scale the remaining time of in-flight legs when traffic changes. */
function applyTraffic(state: SimState, next: number) {
  const prev = state.trafficFactor;
  if (prev === next) return;
  const k = next / prev;
  for (const leg of state.legs.filter((l) => MOVING_STATES.includes(l.state))) {
    const remaining = Math.max(0, leg.phaseStart + leg.phaseDuration - state.clock);
    const rest = leg.dropEta - (leg.phaseStart + leg.phaseDuration);
    leg.phaseDuration = state.clock - leg.phaseStart + remaining * k;
    leg.dropEta = leg.phaseStart + leg.phaseDuration + Math.max(0, rest) * k;
  }
  state.trafficFactor = next;
  for (const leg of activeLegs(state)) refreshSurvival(state, leg);
}

export function trafficJam(state: SimState, factor = 2.2, durationMin = 15) {
  applyTraffic(state, factor);
  state.trafficUntil = state.clock + durationMin;
  log(state, "warn", "traffic", `Heavy traffic: travel times ×${factor.toFixed(1)} for ~${durationMin} min`);
  requestReplan(state, "traffic jam");
  flushReplan(state);
}

export function ghostRider(state: SimState, riderId?: string): Rider | null {
  const withLeg = activeLegs(state).filter((l) => MOVING_STATES.includes(l.state) || l.state === "offered");
  let rider: Rider | undefined;
  if (riderId) rider = state.riders.find((r) => r.id === riderId);
  else if (withLeg.length) rider = riderOf(state, withLeg.sort((a, b) => b.qty - a.qty)[0].riderId);
  else rider = state.riders.find((r) => r.status === "idle");
  if (!rider) return null;
  rider.silent = true;
  rider.lastHeartbeat = state.clock;
  log(state, "warn", "chaos_ghost", `${rider.name} stopped responding (simulated)`, { riderId: rider.id });
  refreshStatuses(state);
  return rider;
}

export function unghostRider(state: SimState, riderId: string) {
  const r = state.riders.find((x) => x.id === riderId);
  if (!r) return;
  r.silent = false;
  r.lastHeartbeat = state.clock;
  r.cooldownUntil = undefined;
  log(state, "info", "rider_back", `${r.name} is responsive again`, { riderId: r.id });
  refreshStatuses(state);
  requestReplan(state, "rider back");
  flushReplan(state);
}

export function pickBusiestShelter(state: SimState): Shelter | undefined {
  const inbound = new Map<string, number>();
  for (const l of activeLegs(state)) inbound.set(l.shelterId, (inbound.get(l.shelterId) ?? 0) + l.qty);
  const top = [...inbound.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? shelterOf(state, top[0]) : state.shelters.find((s) => s.open);
}

export function setShelterOpen(state: SimState, shelterId: string, open: boolean) {
  const s = shelterOf(state, shelterId);
  if (!s || s.open === open) return;
  s.open = open;
  log(state, open ? "info" : "warn", open ? "shelter_open" : "shelter_closed", `${s.name} ${open ? "reopened for deliveries" : "closed intake"}`, { shelterId });
  requestReplan(state, open ? `${s.name} reopened` : `${s.name} closed`);
  flushReplan(state);
}

export function closeShelter(state: SimState, shelterId?: string) {
  const s = shelterId ? shelterOf(state, shelterId) : pickBusiestShelter(state);
  if (s) setShelterOpen(state, s.id, false);
  return s;
}

export function setShelterFacility(state: SimState, shelterId: string, key: keyof Shelter["facilities"], value: boolean) {
  const s = shelterOf(state, shelterId);
  if (!s) return;
  s.facilities[key] = value;
  log(state, "info", "facility", `${s.name}: ${key} ${value ? "restored" : "unavailable"}`, { shelterId });
  requestReplan(state, "facility change");
  flushReplan(state);
}

export function setShelterRemaining(state: SimState, shelterId: string, remaining: number, why?: string) {
  const s = shelterOf(state, shelterId);
  if (!s) return;
  s.capacityRemaining = clamp(Math.round(remaining), 0, s.totalCapacity);
  if (why) log(state, "warn", "demand_change", why, { shelterId });
  requestReplan(state, `${s.name} demand changed`);
  flushReplan(state);
}

/** A local citizen drops food directly at a shelter, eating into its remaining demand. */
export function surgeDemand(state: SimState, shelterId?: string, amount?: number) {
  const s = shelterId ? shelterOf(state, shelterId) : pickBusiestShelter(state);
  if (!s) return undefined;
  const take = amount ?? s.capacityRemaining;
  setShelterRemaining(state, s.id, s.capacityRemaining - take, `A local citizen dropped ${Math.min(take, s.capacityRemaining)} meals directly at ${s.name}`);
  return s;
}

export function tightExpiryBatch(state: SimState) {
  return addBatch(state, {
    donorId: "D2",
    category: "cooked",
    qty: 40,
    label: "Hostel dinner surplus",
    safeMin: 14,
    notes: "Tight expiry demo",
  });
}

export type ScenarioKey = "banquet" | "formula" | "pharmacy" | "rush";

export function spawnScenario(state: SimState, key: ScenarioKey) {
  if (key === "banquet") {
    state.scenario = "Banquet hall surplus";
    setShelterRemainingQuiet(state, "S1", 50);
    return addBatch(state, {
      donorId: "D1",
      category: "cooked",
      qty: 180,
      label: "Banquet hall dinner",
      safeMin: 75,
      notes: "180 cooked meals, spoils in 75 minutes",
    });
  }
  if (key === "formula") {
    state.scenario = "Infant formula dependency";
    return addBatch(state, {
      donorId: "D3",
      category: "infant_formula",
      qty: 24,
      label: "Infant formula tins",
      safeMin: 360,
    });
  }
  if (key === "pharmacy") {
    state.scenario = "Cold-chain medical supplies";
    return addBatch(state, {
      donorId: "D3",
      category: "medical",
      qty: 24,
      label: "Insulin and antibiotics",
      safeMin: 150,
      coldChain: true,
    });
  }
  state.scenario = "Evening rush";
  addBatch(state, { donorId: "D2", category: "cooked", qty: 80, label: "Hostel mess dinner", safeMin: 90 });
  addBatch(state, { donorId: "D5", category: "kit", qty: 30, label: "Essential kits", safeMin: 300 });
  return addBatch(state, { donorId: "D4", category: "cooked", qty: 60, label: "Caterer surplus", safeMin: 60 });
}

function setShelterRemainingQuiet(state: SimState, id: string, remaining: number) {
  const s = shelterOf(state, id);
  if (s) s.capacityRemaining = clamp(remaining, 0, s.totalCapacity);
}
