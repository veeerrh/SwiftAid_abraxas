import { checkFeasible, type InfeasibleCode } from "./feasibility";
import type { Plan, Problem } from "./problem";

export interface Violation {
  code: InfeasibleCode | "DUPLICATE_RIDER" | "OVER_RIDER_CAPACITY" | "OVER_SHELTER_CAPACITY" | "OVER_CARGO" | "BAD_QTY" | "UNKNOWN_REF";
  message: string;
  cargoId?: string;
  riderId?: string;
  shelterId?: string;
}

export interface Validation {
  ok: boolean;
  violations: Violation[];
}

/**
 * Safety gatekeeper. Every plan — from the greedy baseline, the optimizers or the AI copilot —
 * must pass through here before it can create dispatch legs. Pure and deterministic.
 */
export function validatePlan(problem: Problem, plan: Plan): Validation {
  const violations: Violation[] = [];
  const riderUse = new Map<string, number>();
  const shelterUse = new Map<string, number>();
  const cargoUse = new Map<string, number>();

  for (const a of plan.assignments) {
    const cargo = problem.cargos.find((c) => c.id === a.cargoId);
    const rider = problem.riders.find((r) => r.id === a.riderId);
    const shelter = problem.shelters.find((s) => s.shelter.id === a.shelterId);
    if (!cargo || !rider || !shelter) {
      violations.push({ code: "UNKNOWN_REF", message: "Plan references an unknown cargo, rider or shelter", ...refs(a) });
      continue;
    }
    if (!(a.qty > 0) || !Number.isFinite(a.qty)) {
      violations.push({ code: "BAD_QTY", message: "Assignment quantity must be positive", ...refs(a) });
      continue;
    }
    const f = checkFeasible(problem, cargo, rider, shelter);
    if (!f.ok) violations.push({ code: f.code!, message: f.reason!, ...refs(a) });

    riderUse.set(a.riderId, (riderUse.get(a.riderId) ?? 0) + 1);
    shelterUse.set(a.shelterId, (shelterUse.get(a.shelterId) ?? 0) + a.qty);
    cargoUse.set(a.cargoId, (cargoUse.get(a.cargoId) ?? 0) + a.qty);
    if (a.qty > rider.capacity) {
      violations.push({
        code: "OVER_RIDER_CAPACITY",
        message: `Rider ${a.riderId} can carry ${rider.capacity}, plan asks for ${a.qty}`,
        ...refs(a),
      });
    }
  }

  for (const [riderId, n] of riderUse) {
    if (n > 1) violations.push({ code: "DUPLICATE_RIDER", message: `Rider ${riderId} is assigned ${n} trips at once`, riderId });
  }
  for (const [shelterId, used] of shelterUse) {
    const s = problem.shelters.find((x) => x.shelter.id === shelterId)!;
    if (used > s.available) {
      violations.push({
        code: "OVER_SHELTER_CAPACITY",
        message: `${s.shelter.name} has ${s.available} free but plan sends ${used}`,
        shelterId,
      });
    }
  }
  for (const [cargoId, used] of cargoUse) {
    const c = problem.cargos.find((x) => x.id === cargoId)!;
    if (used > c.qty) {
      violations.push({ code: "OVER_CARGO", message: `Plan moves ${used} of a ${c.qty}-unit cargo`, cargoId });
    }
  }
  return { ok: violations.length === 0, violations };
}

function refs(a: { cargoId: string; riderId: string; shelterId: string }) {
  return { cargoId: a.cargoId, riderId: a.riderId, shelterId: a.shelterId };
}
