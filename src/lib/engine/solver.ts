import type { OptimizerAlgoResult } from "@/lib/domain/types";
import { greedyPlan } from "./greedy";
import { scorePlan } from "./feasibility";
import type { Plan, Problem } from "./problem";

export interface SolveOutput {
  plan: Plan;
  chosen: OptimizerAlgoResult["name"];
  results: OptimizerAlgoResult[];
}

/**
 * Entry point used by the simulator. Phase 4 ships the greedy baseline; the quantum-inspired
 * optimizers register themselves here in the next phase.
 */
export function solve(problem: Problem, algo: OptimizerAlgoResult["name"], _seed: number): SolveOutput {
  void algo;
  void _seed;
  const t0 = performance.now();
  const plan = greedyPlan(problem);
  const s = scorePlan(problem, plan);
  const result: OptimizerAlgoResult = {
    name: "greedy",
    fitness: s.fitness,
    expectedSafe: s.expectedSafe,
    placedQty: s.placedQty,
    avgSurvival: s.avgSurvival,
    travelMin: s.travelMin,
    legs: plan.assignments.length,
    ms: performance.now() - t0,
    convergence: [s.fitness],
    diversity: [],
  };
  return { plan, chosen: "greedy", results: [result] };
}
