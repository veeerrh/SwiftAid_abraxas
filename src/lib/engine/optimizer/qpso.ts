import type { Rng } from "@/lib/domain/rng";
import { scorePlan } from "../feasibility";
import type { Problem } from "./../problem";
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

/**
 * Quantum-behaved particle swarm optimization (Sun et al.).
 * Particles have no velocity: each moves in a delta-potential well centred on an attractor
 * p = φ·pbest + (1-φ)·gbest, with a spread set by the distance to the swarm's mean best
 * position (mbest) and a contraction–expansion coefficient β that decays from 1.0 to 0.5.
 * Positions live in [0,1]^D and are mapped onto the rider genome.
 */
export function runQPSO(problem: Problem, rng: Rng, seed: Genome, opts: QpsoOptions = {}): OptResult {
  const t0 = performance.now();
  const mode = opts.mode ?? "full";
  const R = problem.riders.length;
  const C1 = problem.cargos.length + 1;
  const S = Math.max(1, problem.shelters.length);
  const stride = mode === "full" ? 4 : 2;
  const D = R * stride;
  const pop = opts.pop ?? 26;
  const iters = opts.iters ?? 55;
  const budget = opts.budgetMs ?? 160;

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

  const X: number[][] = Array.from({ length: pop }, () => Array.from({ length: D }, () => rng()));
  X[0] = fromGenome(seed);
  const P = X.map((x) => [...x]);
  const pf = X.map((x) => evaluate(x).score.fitness);

  let gi = 0;
  for (let k = 1; k < pop; k++) if (pf[k] > pf[gi]) gi = k;
  let gbest = [...P[gi]];
  let best = evaluate(gbest);
  const convergence: number[] = [best.score.fitness];
  const diversity: number[] = [];

  for (let it = 0; it < iters; it++) {
    if (performance.now() - t0 > budget) break;
    const beta = 1.0 - 0.5 * (it / iters);
    const mbest = new Array(D).fill(0);
    for (let k = 0; k < pop; k++) for (let d = 0; d < D; d++) mbest[d] += P[k][d] / pop;

    let spread = 0;
    for (let k = 0; k < pop; k++) {
      const x = X[k];
      for (let d = 0; d < D; d++) {
        const phi = rng();
        const attractor = phi * P[k][d] + (1 - phi) * gbest[d];
        const u = Math.max(1e-12, rng());
        const step = beta * Math.abs(mbest[d] - x[d]) * Math.log(1 / u);
        x[d] = clamp01(rng() < 0.5 ? attractor + step : attractor - step);
        spread += Math.abs(x[d] - mbest[d]);
      }
      const ev = evaluate(x);
      if (ev.score.fitness > pf[k]) {
        pf[k] = ev.score.fitness;
        P[k] = [...x];
        if (ev.score.fitness > best.score.fitness + 1e-9) {
          best = ev;
          gbest = [...x];
        }
      }
    }
    convergence.push(best.score.fitness);
    diversity.push(spread / (pop * D));
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
