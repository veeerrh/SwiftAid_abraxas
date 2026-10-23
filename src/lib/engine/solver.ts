import { makeRng } from "@/lib/domain/rng";
import type { OptimizerAlgoResult } from "@/lib/domain/types";
import { scorePlan } from "./feasibility";
import { greedyPlan } from "./greedy";
import { genomeFromPlan } from "./optimizer/encoding";
import { runQIGA, type OptResult } from "./optimizer/qiga";
import { runQPSO } from "./optimizer/qpso";
import type { Plan, Problem } from "./problem";

export type AlgoName = OptimizerAlgoResult["name"];

export interface SolveOutput {
  plan: Plan;
  chosen: AlgoName;
  results: OptimizerAlgoResult[];
}

function toResult(name: AlgoName, r: { plan: Plan; score: ReturnType<typeof scorePlan>; convergence: number[]; diversity: number[]; ms: number }): OptimizerAlgoResult {
  return {
    name,
    fitness: r.score.fitness,
    expectedSafe: r.score.expectedSafe,
    placedQty: r.score.placedQty,
    avgSurvival: r.score.avgSurvival,
    travelMin: r.score.travelMin,
    legs: r.plan.assignments.length,
    ms: r.ms,
    convergence: r.convergence,
    diversity: r.diversity,
  };
}

/**
 * Plan with every algorithm so the Optimizer Lab can compare them, and return the plan of the
 * requested one. The baseline greedy plan seeds the search and acts as a floor: whatever is
 * applied is never worse than greedy.
 */
export function solve(problem: Problem, algo: AlgoName, seed: number, opts: { compareAll?: boolean } = {}): SolveOutput {
  const compareAll = opts.compareAll !== false;
  const t0 = performance.now();
  const gPlan = greedyPlan(problem);
  const gScore = scorePlan(problem, gPlan);
  const greedy = { plan: gPlan, score: gScore, convergence: [gScore.fitness], diversity: [] as number[], ms: performance.now() - t0 };
  const results: OptimizerAlgoResult[] = [toResult("greedy", greedy)];
  const plans: Record<AlgoName, { plan: Plan; fitness: number }> = {
    greedy: { plan: gPlan, fitness: gScore.fitness },
    qiga: { plan: gPlan, fitness: gScore.fitness },
    qpso: { plan: gPlan, fitness: gScore.fitness },
    hybrid: { plan: gPlan, fitness: gScore.fitness },
  };

  const searchable = problem.cargos.length > 0 && problem.riders.length > 0 && problem.shelters.length > 0;
  if (searchable && (compareAll || algo !== "greedy")) {
    const base = genomeFromPlan(problem, gPlan);
    const want = (n: AlgoName) => compareAll || algo === n || (n === "qiga" && algo === "hybrid");

    const qiga: OptResult | null = want("qiga") ? runQIGA(problem, makeRng(seed ^ 0x9e3779b1), base) : null;
    const qpso: OptResult | null = want("qpso") ? runQPSO(problem, makeRng(seed ^ 0x85ebca6b), base, { mode: "full" }) : null;

    // Hybrid: QIGA's discrete topology refined by QPSO over loads and priorities.
    let hybrid: OptResult | null = null;
    if (qiga && (compareAll || algo === "hybrid")) {
      const refineStart = performance.now();
      const refined = runQPSO(problem, makeRng(seed ^ 0xc2b2ae35), qiga.genome, { mode: "refine", iters: 40 });
      hybrid = {
        ...refined,
        convergence: [...qiga.convergence, ...refined.convergence],
        diversity: [...qiga.diversity, ...refined.diversity],
        ms: qiga.ms + (performance.now() - refineStart),
      };
    }

    for (const [name, r] of [["qiga", qiga], ["qpso", qpso], ["hybrid", hybrid]] as const) {
      if (!r) continue;
      results.push(toResult(name, r));
      // Never worse than baseline.
      plans[name] = r.score.fitness >= gScore.fitness ? { plan: r.plan, fitness: r.score.fitness } : { plan: gPlan, fitness: gScore.fitness };
    }
  } else if (compareAll) {
    for (const name of ["qiga", "qpso", "hybrid"] as const) results.push(toResult(name, { ...greedy, ms: 0 }));
  }

  return { plan: plans[algo].plan, chosen: algo, results };
}
