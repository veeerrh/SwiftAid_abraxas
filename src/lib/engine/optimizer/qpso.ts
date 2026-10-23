import type { Rng } from "@/lib/domain/rng";
import { scorePlan } from "../feasibility";
import type { Problem } from "./../problem";
import { qpsoCore } from "./core";
import { cloneGenome, decode, type Genome } from "./encoding";
import type { OptResult } from "./qiga";

export interface QpsoOptions {
  pop?: number;
  iters?: number;
  budgetMs?: number;
  /** "full" searches assignment + loads + priorities; "refine" keeps the assignment topology fixed. */
  mode?: "full" | "refine";
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** QPSO over the rider allocation. Positions in [0,1]^D map onto the rider genome. See core.ts. */
export function runQPSO(problem: Problem, rng: Rng, seed: Genome, opts: QpsoOptions = {}): OptResult {
  const mode = opts.mode ?? "full";
  const R = problem.riders.length;
  const C1 = problem.cargos.length + 1;
  const S = Math.max(1, problem.shelters.length);
  const stride = mode === "full" ? 4 : 2;
  const D = R * stride;

  const toGenome = (x: number[]): Genome => {
    const g = cloneGenome(seed);
    for (let i = 0; i < R; i++) {
      const o = i * stride;
      if (mode === "full") {
        g.cargo[i] = Math.min(C1 - 1, Math.floor(x[o] * C1));
        g.shelter[i] = Math.min(S - 1, Math.floor(x[o + 1] * S));
        g.load[i] = 0.15 + 0.85 * x[o + 2];
        g.prio[i] = x[o + 3];
      } else {
        g.load[i] = 0.15 + 0.85 * x[o];
        g.prio[i] = x[o + 1];
      }
    }
    return g;
  };
  const fromGenome = (g: Genome): number[] => {
    const x = new Array(D).fill(0);
    for (let i = 0; i < R; i++) {
      const o = i * stride;
      const load = clamp01((g.load[i] - 0.15) / 0.85);
      if (mode === "full") {
        x[o] = (g.cargo[i] + 0.5) / C1;
        x[o + 1] = (g.shelter[i] + 0.5) / S;
        x[o + 2] = load;
        x[o + 3] = clamp01(g.prio[i]);
      } else {
        x[o] = load;
        x[o + 1] = clamp01(g.prio[i]);
      }
    }
    return x;
  };
  const evaluate = (x: number[]) => {
    const genome = toGenome(x);
    const plan = decode(problem, genome);
    return { genome, plan, score: scorePlan(problem, plan) };
  };

  const r = qpsoCore({ rng, dims: D, seedPosition: fromGenome(seed), evaluate, fitness: (e) => e.score.fitness, pop: opts.pop, iters: opts.iters, budgetMs: opts.budgetMs });
  return { plan: r.best.plan, score: r.best.score, genome: r.best.genome, convergence: r.convergence, diversity: r.diversity, ms: r.ms };
}
