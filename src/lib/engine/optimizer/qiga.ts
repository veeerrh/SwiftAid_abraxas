import type { Rng } from "@/lib/domain/rng";
import { scorePlan } from "../feasibility";
import type { Plan, PlanScore, Problem } from "../problem";
import { qigaCore } from "./core";
import { cloneGenome, decode, emptyGenome, type Genome } from "./encoding";

export interface OptResult {
  plan: Plan;
  score: PlanScore;
  genome: Genome;
  convergence: number[];
  diversity: number[];
  ms: number;
}

export interface QigaOptions {
  pop?: number;
  gens?: number;
  budgetMs?: number;
}

const bitsFor = (n: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

/**
 * QIGA over the rider allocation: the bits encode, per rider, the (cargo, shelter) assignment.
 * Load fractions and priorities come from `base`. See core.ts for the algorithm.
 */
export function runQIGA(problem: Problem, rng: Rng, base: Genome, opts: QigaOptions = {}): OptResult {
  const R = problem.riders.length;
  const C1 = problem.cargos.length + 1;
  const S = Math.max(1, problem.shelters.length);
  const bc = bitsFor(C1);
  const bs = bitsFor(S);
  const per = bc + bs;
  const nbits = R * per;

  const toGenome = (bits: Uint8Array): Genome => {
    const g = cloneGenome(base);
    for (let i = 0; i < R; i++) {
      let c = 0;
      let s = 0;
      for (let k = 0; k < bc; k++) c = (c << 1) | bits[i * per + k];
      for (let k = 0; k < bs; k++) s = (s << 1) | bits[i * per + bc + k];
      g.cargo[i] = c % C1;
      g.shelter[i] = s % S;
      g.load[i] = 1;
    }
    return g;
  };
  const toBits = (g: Genome): Uint8Array => {
    const bits = new Uint8Array(nbits);
    for (let i = 0; i < R; i++) {
      for (let k = 0; k < bc; k++) bits[i * per + k] = (g.cargo[i] >> (bc - 1 - k)) & 1;
      for (let k = 0; k < bs; k++) bits[i * per + bc + k] = (g.shelter[i] >> (bs - 1 - k)) & 1;
    }
    return bits;
  };
  const evaluate = (bits: Uint8Array) => {
    const genome = toGenome(bits);
    const plan = decode(problem, genome);
    return { genome, plan, score: scorePlan(problem, plan) };
  };

  const r = qigaCore({ rng, nbits, seedBits: toBits(base), evaluate, fitness: (e) => e.score.fitness, pop: opts.pop, gens: opts.gens, budgetMs: opts.budgetMs });
  return { plan: r.best.plan, score: r.best.score, genome: r.best.genome, convergence: r.convergence, diversity: r.diversity, ms: r.ms };
}

export { emptyGenome };
