import type { Rng } from "@/lib/domain/rng";

/**
 * Generic quantum-inspired search engines. They know nothing about riders or donors: callers
 * supply how to turn bits / positions into a candidate solution and how good it is.
 */

export interface CoreResult<T> {
  best: T;
  fitness: number;
  /** Best-so-far fitness per iteration (for charts). */
  convergence: number[];
  /** Population diversity per iteration. */
  diversity: number[];
  ms: number;
}

const THETA_MIN = 0.03;
const THETA_MAX = Math.PI / 2 - 0.03;

export interface QigaCoreOptions<T> {
  rng: Rng;
  nbits: number;
  /** A known-good starting solution (e.g. the greedy plan) expressed as bits. */
  seedBits: Uint8Array;
  evaluate: (bits: Uint8Array) => T;
  fitness: (t: T) => number;
  pop?: number;
  gens?: number;
  budgetMs?: number;
}

/**
 * Quantum-inspired genetic algorithm (Han & Kim). Each gene is a Q-bit cos θ|0⟩ + sin θ|1⟩; observing a
 * chromosome collapses every Q-bit with P(1) = sin²θ, and a rotation gate then nudges each angle toward
 * the best solution found so far. A catastrophe step re-diversifies after stagnation.
 */
export function qigaCore<T>(o: QigaCoreOptions<T>): CoreResult<T> & { bestBits: Uint8Array } {
  const t0 = performance.now();
  const { rng, nbits, seedBits } = o;
  const pop = o.pop ?? 28;
  const gens = o.gens ?? 45;
  const budget = o.budgetMs ?? 160;

  const theta: Float64Array[] = Array.from({ length: pop }, () => new Float64Array(nbits).fill(Math.PI / 4));
  for (let j = 0; j < nbits; j++) theta[0][j] = seedBits[j] ? THETA_MAX - 0.15 : THETA_MIN + 0.15;

  let best = o.evaluate(seedBits);
  let bestFit = o.fitness(best);
  let bestBits = seedBits;
  const convergence: number[] = [bestFit];
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
      const ev = o.evaluate(bits);
      const f = o.fitness(ev);
      if (f > bestFit + 1e-9) {
        best = ev;
        bestFit = f;
        bestBits = bits;
        improved = true;
      }
      // Rotation gate toward the best solution (lookup table of Han & Kim, simplified).
      const worse = f < bestFit - 1e-9;
      for (let j = 0; j < nbits; j++) {
        const x = bits[j];
        const b = bestBits[j];
        if (x === b) continue;
        const toward = worse ? b : x;
        th[j] = Math.min(THETA_MAX, Math.max(THETA_MIN, th[j] + (toward ? delta : -delta)));
      }
    }
    convergence.push(bestFit);
    diversity.push(uncertainty / (pop * Math.max(1, nbits)));

    stagnant = improved ? 0 : stagnant + 1;
    if (stagnant >= 8) {
      for (let k = Math.floor(pop / 2); k < pop; k++) {
        for (let j = 0; j < nbits; j++) {
          theta[k][j] = bestBits[j] ? THETA_MAX - 0.25 - rng() * 0.3 : THETA_MIN + 0.25 + rng() * 0.3;
          if (rng() < 0.12) theta[k][j] = Math.PI / 4;
        }
      }
      stagnant = 0;
    }
  }
  return { best, fitness: bestFit, bestBits, convergence, diversity, ms: performance.now() - t0 };
}

export interface QpsoCoreOptions<T> {
  rng: Rng;
  dims: number;
  /** Position encoding a known-good starting solution. */
  seedPosition: number[];
  evaluate: (x: number[]) => T;
  fitness: (t: T) => number;
  pop?: number;
  iters?: number;
  budgetMs?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Quantum-behaved particle swarm (Sun et al.). Particles have no velocity: each moves in a delta-potential
 * well around φ·pbest + (1-φ)·gbest, with a spread set by the distance to the swarm's mean best position
 * (mbest) and a contraction-expansion coefficient β decaying from 1.0 to 0.5. Positions live in [0,1]^D.
 */
export function qpsoCore<T>(o: QpsoCoreOptions<T>): CoreResult<T> & { position: number[] } {
  const t0 = performance.now();
  const { rng, dims: D } = o;
  const pop = o.pop ?? 26;
  const iters = o.iters ?? 55;
  const budget = o.budgetMs ?? 160;

  const X: number[][] = Array.from({ length: pop }, () => Array.from({ length: D }, () => rng()));
  X[0] = [...o.seedPosition];
  const P = X.map((x) => [...x]);
  const pf = X.map((x) => o.fitness(o.evaluate(x)));

  let gi = 0;
  for (let k = 1; k < pop; k++) if (pf[k] > pf[gi]) gi = k;
  let gbest = [...P[gi]];
  let best = o.evaluate(gbest);
  let bestFit = o.fitness(best);
  const convergence: number[] = [bestFit];
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
      const ev = o.evaluate(x);
      const f = o.fitness(ev);
      if (f > pf[k]) {
        pf[k] = f;
        P[k] = [...x];
        if (f > bestFit + 1e-9) {
          best = ev;
          bestFit = f;
          gbest = [...x];
        }
      }
    }
    convergence.push(bestFit);
    diversity.push(spread / (pop * Math.max(1, D)));
  }
  return { best, fitness: bestFit, position: gbest, convergence, diversity, ms: performance.now() - t0 };
}
