import { buildAssignment, checkFeasible, fitQty } from "./feasibility";
import type { Assignment, Plan, Problem } from "./problem";

/**
 * Baseline allocator: most urgent cargo first, then for each cargo repeatedly take the
 * rider/shelter pair that moves the most quantity, breaking ties by shortest trip.
 * One trip per rider. Always computed first and used to seed the optimizers.
 */
export function greedyPlan(problem: Problem): Plan {
  const assignments: Assignment[] = [];
  const usedRiders = new Set<string>();
  const avail = new Map(problem.shelters.map((s) => [s.shelter.id, s.available]));
  const unplaced: Record<string, number> = {};

  const cargos = [...problem.cargos].sort((a, b) => a.expiresAt - b.expiresAt);

  for (const cargo of cargos) {
    let remaining = cargo.qty;
    while (remaining > 0) {
      let best: { score: number; a: Assignment } | null = null;
      for (const rider of problem.riders) {
        if (usedRiders.has(rider.id)) continue;
        if (cargo.carrierRiderId && cargo.carrierRiderId !== rider.id) continue;
        for (const shelter of problem.shelters) {
          const a = avail.get(shelter.shelter.id) ?? 0;
          const view = { ...shelter, available: a };
          const f = checkFeasible(problem, cargo, rider, view);
          if (!f.ok) continue;
          const qty = fitQty(rider.capacity, remaining, a, cargo.chunk);
          if (qty <= 0) continue;
          const asg = buildAssignment(problem, cargo, rider, view, qty);
          const score = qty * 10 * asg.survival - asg.totalMin * 0.2;
          if (!best || score > best.score) best = { score, a: asg };
        }
      }
      if (!best) break;
      assignments.push(best.a);
      usedRiders.add(best.a.riderId);
      avail.set(best.a.shelterId, (avail.get(best.a.shelterId) ?? 0) - best.a.qty);
      remaining -= best.a.qty;
    }
    unplaced[cargo.id] = remaining;
  }
  return { assignments, unplaced };
}
