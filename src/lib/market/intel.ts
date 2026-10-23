import { makeRng } from "@/lib/domain/rng";
import { createInitialState, makeBatch } from "@/lib/domain/seed";
import { buildProblem, newId } from "@/lib/engine/sim";
import { solve, type AlgoName } from "@/lib/engine/solver";
import { scenarioSchema } from "./studio-presets";
import { buildWorldFromSpec } from "./studio";
import { suggestBundles } from "./suggest";

/**
 * Intelligence lab: evidence for the optimiser, produced by actually running it.
 * Every number here comes from solving randomly generated situations with greedy, QIGA, QPSO and the hybrid.
 */

export interface TrialRow {
  seed: number;
  cargoQty: number;
  riders: number;
  /** fitness per algorithm (higher is better). */
  fitness: Record<AlgoName, number>;
  /** meals expected to arrive safely. */
  safe: Record<AlgoName, number>;
  ms: Record<AlgoName, number>;
}

export interface Summary {
  trials: number;
  /** Share of trials where hybrid beat greedy by more than the noise threshold. */
  winRate: number;
  tieRate: number;
  lossRate: number;
  avgGainSafe: number;
  maxGainSafe: number;
  avgGainPct: number;
  avgMs: Record<AlgoName, number>;
  /** Histogram of (hybrid - greedy) expected safe meals. */
  histogram: { from: number; to: number; count: number }[];
  /** Mean expected safe meals per algorithm. */
  meanSafe: Record<AlgoName, number>;
}

const ALGOS: AlgoName[] = ["greedy", "qiga", "qpso", "hybrid"];
const zero = (): Record<AlgoName, number> => ({ greedy: 0, qiga: 0, qpso: 0, hybrid: 0 });

/** One random dispatch situation: a big perishable batch, tight shelf life, a few riders, varied traffic. */
export function dispatchTrial(seed: number, scale = 1): TrialRow {
  const rng = makeRng(seed);
  const s = createInitialState({ seed });
  s.trafficFactor = 1 + rng() * 1.1;
  const nRiders = Math.max(4, Math.min(s.riders.length, Math.round((5 + rng() * 6) * scale)));
  s.riders = s.riders.slice(0, nRiders);
  for (const r of s.riders) r.reliability = 0.6 + rng() * 0.35;
  for (const sh of s.shelters) sh.capacityRemaining = Math.round(30 + rng() * 120);
  const qty = Math.round((90 + rng() * 230) * scale);
  // Pushed without planning, so the problem is built from an untouched batch.
  s.batches.push(makeBatch(newId(s, "B"), { donorId: s.donors[Math.floor(rng() * s.donors.length)].id, label: "Trial batch", category: "cooked", qty, now: 0, safeMin: Math.round(45 + rng() * 70) }));
  for (const r of s.riders) r.status = "idle";
  const built = buildProblem(s);
  const out = solve(built.problem, "hybrid", seed);
  const row: TrialRow = { seed, cargoQty: qty, riders: nRiders, fitness: zero(), safe: zero(), ms: zero() };
  for (const r of out.results) {
    row.fitness[r.name] = r.fitness;
    row.safe[r.name] = r.expectedSafe;
    row.ms[r.name] = r.ms;
  }
  return row;
}

export function summarise(rows: TrialRow[]): Summary {
  const n = rows.length || 1;
  const gains = rows.map((r) => r.safe.hybrid - r.safe.greedy);
  const eps = 0.5;
  const win = gains.filter((g) => g > eps).length;
  const loss = gains.filter((g) => g < -eps).length;
  const avg = (f: (r: TrialRow) => number) => rows.reduce((a, r) => a + f(r), 0) / n;
  const max = Math.max(0, ...gains);
  const lo = Math.min(0, ...gains);
  const bins = 8;
  const width = Math.max(1, (max - lo) / bins);
  const histogram = Array.from({ length: bins }, (_, i) => ({ from: Math.round(lo + i * width), to: Math.round(lo + (i + 1) * width), count: 0 }));
  for (const g of gains) histogram[Math.min(bins - 1, Math.floor((g - lo) / width))].count++;
  const avgMs = zero();
  const meanSafe = zero();
  for (const a of ALGOS) {
    avgMs[a] = avg((r) => r.ms[a]);
    meanSafe[a] = avg((r) => r.safe[a]);
  }
  const totalGreedy = rows.reduce((a, r) => a + r.safe.greedy, 0) || 1;
  return {
    trials: rows.length,
    winRate: win / n,
    tieRate: (rows.length - win - loss) / n,
    lossRate: loss / n,
    avgGainSafe: gains.reduce((a, g) => a + g, 0) / n,
    maxGainSafe: max,
    avgGainPct: (gains.reduce((a, g) => a + g, 0) / totalGreedy) * 100,
    avgMs,
    histogram,
    meanSafe,
  };
}

/** Same trial for greedy vs optimised, with the plan geometry so the UI can draw both side by side. */
export function benchmark(trials: number, baseSeed = 7001, scale = 1) {
  const rows: TrialRow[] = [];
  for (let i = 0; i < trials; i++) rows.push(dispatchTrial(baseSeed + i * 131, scale));
  return { rows, summary: summarise(rows) };
}

/** Scale test: how the advantage and the solve time grow as the problem gets bigger. */
export function stress(scales = [0.6, 1, 1.5, 2, 3], perScale = 4) {
  return scales.map((sc) => {
    const rows: TrialRow[] = [];
    for (let i = 0; i < perScale; i++) rows.push(dispatchTrial(9100 + i * 97 + Math.round(sc * 10), sc));
    const sum = summarise(rows);
    return {
      scale: sc,
      meals: Math.round(rows.reduce((a, r) => a + r.cargoQty, 0) / rows.length),
      riders: Math.round(rows.reduce((a, r) => a + r.riders, 0) / rows.length),
      gainSafe: sum.avgGainSafe,
      gainPct: sum.avgGainPct,
      greedyMs: sum.avgMs.greedy,
      hybridMs: sum.avgMs.hybrid,
    };
  });
}

/** Donor-bundle benchmark: the shelter's "best mix" optimiser vs the freshest-first baseline. */
export function bundleBenchmark(trials = 24, baseSeed = 4400) {
  const gains: number[] = [];
  let wins = 0;
  let fewer = 0;
  for (let i = 0; i < trials; i++) {
    const rng = makeRng(baseSeed + i * 53);
    const spec = scenarioSchema.parse({
      name: "bundle trial",
      seed: baseSeed + i * 53,
      donors: 6 + Math.floor(rng() * 6),
      shelters: 3,
      riders: 10,
      listings: Array.from({ length: 6 + Math.floor(rng() * 6) }, () => ({ category: "cooked", qty: 20 + Math.floor(rng() * 90), expiresInMin: 60 + Math.floor(rng() * 160) })),
      requests: [{ category: "cooked", qty: 80 + Math.floor(rng() * 160) }],
      failures: [],
    });
    const w = buildWorldFromSpec(spec);
    const rq = w.market.requests[0];
    if (!rq) continue;
    const sug = suggestBundles(w, rq.shelterId, { requestId: rq.id });
    if (!sug.bundles[0] || !sug.baseline) continue;
    const gain = sug.bundles[0].score - sug.baseline.score;
    gains.push(gain);
    if (gain > 0.5) wins++;
    if (sug.bundles[0].donors < sug.baseline.donors) fewer++;
  }
  const n = gains.length || 1;
  return { trials: gains.length, winRate: wins / n, avgGain: gains.reduce((a, g) => a + g, 0) / n, maxGain: Math.max(0, ...gains), fewerPickupsRate: fewer / n };
}
