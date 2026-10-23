import type { Rng } from "@/lib/domain/rng";
import { scorePlan } from "../feasibility";
import type { Plan, PlanScore, Problem } from "../problem";
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
const THETA_MIN = 0.03;
const THETA_MAX = Math.PI / 2 - 0.03;

/**
 * Quantum-inspired genetic algorithm (Han & Kim).
 * Each gene is a Q-bit |ψ⟩ = cos θ|0⟩ + sin θ|1⟩. Observing a chromosome collapses every Q-bit
 * to a classical bit with P(1) = sin²θ; a rotation gate then nudges each angle toward the best
 * solution found so far. Here the bits encode, per rider, the (cargo, shelter) assignment.
 * Load fractions and priorities come from `base`.
 */
export function runQIGA(problem: Problem, rng: Rng, base: Genome, opts: QigaOptions = {}): OptResult {
  const t0 = performance.now();
  const R = problem.riders.length;
  const C1 = problem.cargos.length + 1;
  const S = Math.max(1, problem.shelters.length);
  const bc = bitsFor(C1);
  const bs = bitsFor(S);
  const per = bc + bs;
  const nbits = R * per;
  const pop = opts.pop ?? 28;
  const gens = opts.gens ?? 45;
  const budget = opts.budgetMs ?? 160;

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

  // Population of angles; individual 0 is biased toward the seed (baseline) assignment.
  const theta: Float64Array[] = Array.from({ length: pop }, () => new Float64Array(nbits).fill(Math.PI / 4));
  const seedBits = toBits(base);
  for (let j = 0; j < nbits; j++) theta[0][j] = seedBits[j] ? THETA_MAX - 0.15 : THETA_MIN + 0.15;

  let best = evaluate(seedBits);
  let bestBits = seedBits;
  const convergence: number[] = [best.score.fitness];
  const diversity: number[] = [];
  let stagnant = 0;

  for (let gen = 0; gen < gens; gen++) {
    if (performance.now() - t0 > budget) break;
    const delta = (0.045 - 0.03 * (gen / gens)) * Math.PI;
    let improved = false;
    let uncertainty = 0;

    for (let k = 0; k < pop; k++) {
      const th = theta[k];
      const bits = new Uint8Array(nbits);
      for (let j = 0; j < nbits; j++) {
        const p1 = Math.sin(th[j]) ** 2;
        bits[j] = rng() < p1 ? 1 : 0;
        uncertainty += 4 * p1 * (1 - p1);
      }
      const ev = evaluate(bits);
      if (ev.score.fitness > best.score.fitness + 1e-9) {
        best = ev;
        bestBits = bits;
        improved = true;
      }
      // Rotation gate toward the best solution (lookup table of Han & Kim, simplified).
      const worse = ev.score.fitness < best.score.fitness - 1e-9;
      for (let j = 0; j < nbits; j++) {
        const x = bits[j];
        const b = bestBits[j];
        if (x === b) continue;
        const toward = worse ? b : x;
        th[j] = Math.min(THETA_MAX, Math.max(THETA_MIN, th[j] + (toward ? delta : -delta)));
      }
    }
    convergence.push(best.score.fitness);
    diversity.push(uncertainty / (pop * nbits));

    stagnant = improved ? 0 : stagnant + 1;
    if (stagnant >= 8) {
      // Catastrophe: re-diversify the weaker half, keep the elite attractor.
      for (let k = Math.floor(pop / 2); k < pop; k++) {
        for (let j = 0; j < nbits; j++) {
          theta[k][j] = bestBits[j] ? THETA_MAX - 0.25 - rng() * 0.3 : THETA_MIN + 0.25 + rng() * 0.3;
          if (rng() < 0.12) theta[k][j] = Math.PI / 4;
        }
      }
      stagnant = 0;
    }
  }

  return {
    plan: best.plan,
    score: best.score,
    genome: best.genome,
    convergence,
    diversity,
    ms: performance.now() - t0,
  };
}

export { emptyGenome };
