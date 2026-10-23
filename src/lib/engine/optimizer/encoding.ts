import { buildAssignment, checkFeasible, fitQty, legTimes } from "../feasibility";
import type { Assignment, Plan, Problem } from "../problem";

/**
 * Rider-centric genome: every rider independently chooses
 *  - which cargo to take (0 = stay idle),
 *  - which shelter to deliver to,
 *  - how much of its capacity to load,
 *  - a priority that decides who claims scarce shelter space first.
 * Decoding always yields a plan that satisfies the hard rules (it repairs bad genes),
 * so the search space is only ever rule-feasible plans.
 */
export interface Genome {
  cargo: number[];
  shelter: number[];
  load: number[];
  prio: number[];
}

export function emptyGenome(n: number): Genome {
  return {
    cargo: new Array(n).fill(0),
    shelter: new Array(n).fill(0),
    load: new Array(n).fill(1),
    prio: Array.from({ length: n }, (_, i) => 1 - (i + 1) / (n + 1)),
  };
}

export function cloneGenome(g: Genome): Genome {
  return { cargo: [...g.cargo], shelter: [...g.shelter], load: [...g.load], prio: [...g.prio] };
}

export function decode(problem: Problem, g: Genome): Plan {
  const assignments: Assignment[] = [];
  const avail = new Map(problem.shelters.map((s) => [s.shelter.id, s.available]));
  const remaining = new Map(problem.cargos.map((c) => [c.id, c.qty]));

  const order = problem.riders
    .map((_, i) => i)
    .sort((a, b) => g.prio[b] - g.prio[a] || a - b);

  for (const i of order) {
    const ci = g.cargo[i];
    if (ci <= 0 || ci > problem.cargos.length) continue;
    const rider = problem.riders[i];
    const cargo = problem.cargos[ci - 1];
    const rem = remaining.get(cargo.id) ?? 0;
    if (rem <= 0) continue;
    if (cargo.carrierRiderId && cargo.carrierRiderId !== rider.id) continue;

    const pref = Math.min(Math.max(0, g.shelter[i]), problem.shelters.length - 1);
    const rest = problem.shelters
      .map((s, idx) => ({ idx, t: legTimes(problem, cargo, rider, s).totalMin }))
      .filter((x) => x.idx !== pref)
      .sort((a, b) => a.t - b.t)
      .map((x) => x.idx);

    for (const si of [pref, ...rest]) {
      const sh = problem.shelters[si];
      const view = { ...sh, available: avail.get(sh.shelter.id) ?? 0 };
      if (!checkFeasible(problem, cargo, rider, view).ok) continue;
      let qty: number;
      if (cargo.carrierRiderId) {
        qty = rider.capacity >= cargo.qty && view.available >= cargo.qty ? cargo.qty : 0;
      } else {
        const desired = Math.max(1, Math.round(g.load[i] * rider.capacity));
        qty = fitQty(Math.min(rider.capacity, desired), rem, view.available, cargo.chunk);
      }
      if (qty <= 0) continue;
      assignments.push(buildAssignment(problem, cargo, rider, view, qty));
      avail.set(sh.shelter.id, view.available - qty);
      remaining.set(cargo.id, rem - qty);
      break;
    }
  }

  const unplaced: Record<string, number> = {};
  for (const [id, q] of remaining) unplaced[id] = q;
  return { assignments, unplaced };
}

/** Express a plan (e.g. the greedy baseline) as a genome so the search can start from it. */
export function genomeFromPlan(problem: Problem, plan: Plan): Genome {
  const n = problem.riders.length;
  const g = emptyGenome(n);
  g.prio = new Array(n).fill(0);
  plan.assignments.forEach((a, rank) => {
    const ri = problem.riders.findIndex((r) => r.id === a.riderId);
    if (ri < 0) return;
    g.cargo[ri] = problem.cargos.findIndex((c) => c.id === a.cargoId) + 1;
    g.shelter[ri] = problem.shelters.findIndex((s) => s.shelter.id === a.shelterId);
    g.load[ri] = Math.min(1, a.qty / problem.riders[ri].capacity);
    g.prio[ri] = 1 - (rank + 1) / (plan.assignments.length + 2);
  });
  return g;
}
