import { makeRng } from "@/lib/domain/rng";
import type { Category, SimState } from "@/lib/domain/types";
import type { Listing } from "@/lib/domain/market";
import { analyticSurvival } from "@/lib/engine/feasibility";
import { qigaCore, qpsoCore } from "@/lib/engine/optimizer/core";
import { eligibleListings, type Reach } from "./rules";

/**
 * Smart suggestions for shelters: which donors to pick, and how much from each, to cover a request.
 *
 * Hard rules decide who is *eligible* (reachable before expiry, compatible, in stock). QIGA then chooses
 * which donors take part, QPSO tunes how much to take from each, and the best of greedy / QIGA / hybrid
 * is returned, never worse than the greedy baseline. The explanation bullets are computed from the real
 * numbers, not written by a model.
 */

export interface Candidate {
  listing: Listing;
  reach: Reach;
  /** Probability the supplies arrive in time (analytic, reference rider). */
  pSafe: number;
}

export interface BundleLine {
  listingId: string;
  donorId: string;
  label: string;
  unit: string;
  qty: number;
  availableQty: number;
  driveMin: number;
  slackMin: number;
  freshnessLeftMin: number;
  pSafe: number;
}

export interface Bundle {
  id: string;
  profile: Profile;
  title: string;
  lines: BundleLine[];
  covered: number;
  need: number;
  shortfall: number;
  donors: number;
  /** Quantity-weighted. */
  avgSafe: number;
  avgSlackMin: number;
  avgDriveMin: number;
  score: number;
  algo: "greedy" | "qiga" | "hybrid";
}

export type Profile = "balanced" | "fewest" | "freshest";

export interface SuggestRun {
  name: "greedy" | "qiga" | "hybrid";
  score: number;
  covered: number;
  donors: number;
  ms: number;
  convergence: number[];
}

export interface Suggestion {
  shelterId: string;
  category: Category;
  need: number;
  unit: string;
  candidates: number;
  /** Total stock across candidates. */
  stock: number;
  bundles: Bundle[];
  baseline: Bundle | null;
  runs: SuggestRun[];
  /** Plain-English reasons the top bundle was chosen, from computed numbers. */
  why: string[];
  /** Set when nothing eligible can be offered. */
  reason?: string;
}

interface Weights {
  cov: number;
  over: number;
  safe: number;
  fresh: number;
  near: number;
  donors: number;
  drain: number;
}
const WEIGHTS: Record<Profile, Weights> = {
  balanced: { cov: 100, over: 300, safe: 30, fresh: 10, near: 8, donors: 4, drain: 3 },
  fewest: { cov: 100, over: 300, safe: 20, fresh: 6, near: 4, donors: 22, drain: 1 },
  freshest: { cov: 100, over: 300, safe: 60, fresh: 25, near: 4, donors: 3, drain: 3 },
};
const TITLES: Record<Profile, string> = {
  balanced: "Recommended mix",
  fewest: "Fewest pickups",
  freshest: "Freshest and safest",
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const MAX_CANDIDATES = 12;

function qtyVector(cands: Candidate[], need: number, include: boolean[], frac: number[], prio: number[]): number[] {
  const q = new Array(cands.length).fill(0);
  let remaining = need;
  const order = cands.map((_, i) => i).sort((a, b) => prio[b] - prio[a] || a - b);
  for (const i of order) {
    if (!include[i] || remaining <= 0) continue;
    const avail = cands[i].listing.availableQty;
    const take = Math.min(avail, Math.max(1, Math.round(frac[i] * avail)), remaining);
    q[i] = take;
    remaining -= take;
  }
  return q;
}

interface Scored {
  q: number[];
  score: number;
}

function scoreQty(cands: Candidate[], need: number, q: number[], w: Weights): number {
  const covered = q.reduce((n, v) => n + v, 0);
  if (covered <= 0) return -1e6;
  let safe = 0;
  let fresh = 0;
  let near = 0;
  let donors = 0;
  let drain = 0;
  q.forEach((v, i) => {
    if (v <= 0) return;
    const c = cands[i];
    donors++;
    safe += v * c.pSafe;
    fresh += v * Math.max(0, Math.min(1, c.reach.slackMin / 60));
    near += v * (c.reach.driveP90 / 60);
    drain = Math.max(drain, (v / Math.max(1, c.listing.availableQty)) ** 2);
  });
  const over = Math.max(0, covered - need) / need;
  return (
    w.cov * (Math.min(covered, need) / need) -
    w.over * over +
    w.safe * (safe / covered) +
    w.fresh * (fresh / covered) -
    w.near * (near / covered) -
    w.donors * (donors - 1) -
    w.drain * drain
  );
}

function toBundle(cands: Candidate[], need: number, q: number[], profile: Profile, algo: Bundle["algo"], w: Weights): Bundle {
  const lines: BundleLine[] = [];
  q.forEach((v, i) => {
    if (v <= 0) return;
    const c = cands[i];
    lines.push({
      listingId: c.listing.id,
      donorId: c.listing.donorId,
      label: c.listing.label,
      unit: c.listing.unit,
      qty: v,
      availableQty: c.listing.availableQty,
      driveMin: c.reach.driveMin,
      slackMin: c.reach.slackMin,
      freshnessLeftMin: c.reach.freshnessLeftMin,
      pSafe: c.pSafe,
    });
  });
  const covered = lines.reduce((n, l) => n + l.qty, 0);
  const wavg = (f: (l: BundleLine) => number) => (covered > 0 ? lines.reduce((n, l) => n + f(l) * l.qty, 0) / covered : 0);
  return {
    id: `${profile}-${algo}`,
    profile,
    title: TITLES[profile],
    lines: lines.sort((a, b) => b.qty - a.qty),
    covered,
    need,
    shortfall: Math.max(0, need - covered),
    donors: lines.length,
    avgSafe: wavg((l) => l.pSafe),
    avgSlackMin: wavg((l) => l.slackMin),
    avgDriveMin: wavg((l) => l.driveMin),
    score: scoreQty(cands, need, q, w),
    algo,
  };
}

/** Baseline: take from the donor with the most spare time first until the need is met. */
function greedyQty(cands: Candidate[], need: number): number[] {
  const order = cands.map((_, i) => i).sort((a, b) => cands[b].reach.slackMin - cands[a].reach.slackMin);
  const q = new Array(cands.length).fill(0);
  let remaining = need;
  for (const i of order) {
    if (remaining <= 0) break;
    const take = Math.min(cands[i].listing.availableQty, remaining);
    q[i] = take;
    remaining -= take;
  }
  return q;
}

function optimise(cands: Candidate[], need: number, profile: Profile, seed: number): { q: number[]; algo: Bundle["algo"]; runs: SuggestRun[] } {
  const w = WEIGHTS[profile];
  const n = cands.length;
  const g = greedyQty(cands, need);
  const gScore = scoreQty(cands, need, g, w);
  const runs: SuggestRun[] = [{ name: "greedy", score: gScore, covered: g.reduce((a, b) => a + b, 0), donors: g.filter((v) => v > 0).length, ms: 0, convergence: [gScore] }];

  // Seed genome from the greedy solution.
  const seedInclude = g.map((v) => v > 0);
  const seedFrac = g.map((v, i) => (v > 0 ? Math.min(1, v / cands[i].listing.availableQty) : 1));
  const seedPrio = cands.map((_, i) => 1 - (i + 1) / (n + 1)).map((p, i) => (seedInclude[i] ? 0.5 + p / 2 : p / 2));
  const baseBits = Uint8Array.from(seedInclude.map((b) => (b ? 1 : 0)));

  const decodeBits = (bits: Uint8Array, frac = seedFrac, prio = seedPrio) => {
    const q = qtyVector(cands, need, Array.from(bits, (b) => b === 1), frac, prio);
    return { q, score: scoreQty(cands, need, q, w) } as Scored;
  };

  const qiga = qigaCore<Scored>({
    rng: makeRng(seed ^ 0x9e3779b1),
    nbits: n,
    seedBits: baseBits,
    evaluate: (bits) => decodeBits(bits),
    fitness: (e) => e.score,
    pop: 24,
    gens: 40,
    budgetMs: 120,
  });
  runs.push({ name: "qiga", score: qiga.best.score, covered: qiga.best.q.reduce((a, b) => a + b, 0), donors: qiga.best.q.filter((v) => v > 0).length, ms: qiga.ms, convergence: qiga.convergence });

  // Hybrid: QIGA chose who takes part; QPSO tunes how much from each and the order of filling.
  const includeBest = Array.from(qiga.bestBits, (b) => b === 1);
  const sf = qiga.best.q.map((v, i) => (v > 0 ? Math.min(1, v / cands[i].listing.availableQty) : 1));
  const refineSeed = [...sf, ...cands.map((_, i) => 1 - (i + 1) / (n + 1))];
  const qpso = qpsoCore<Scored>({
    rng: makeRng(seed ^ 0xc2b2ae35),
    dims: 2 * n,
    seedPosition: refineSeed,
    evaluate: (x) => {
      const frac = x.slice(0, n).map((v) => 0.1 + 0.9 * v);
      const prio = x.slice(n);
      const q = qtyVector(cands, need, includeBest, frac, prio);
      return { q, score: scoreQty(cands, need, q, w) };
    },
    fitness: (e) => e.score,
    pop: 22,
    iters: 40,
    budgetMs: 120,
  });
  const hybridQ = qpso.best.score >= qiga.best.score ? qpso.best.q : qiga.best.q;
  const hybridScore = Math.max(qpso.best.score, qiga.best.score);
  runs.push({
    name: "hybrid",
    score: hybridScore,
    covered: hybridQ.reduce((a, b) => a + b, 0),
    donors: hybridQ.filter((v) => v > 0).length,
    ms: qiga.ms + qpso.ms,
    convergence: [...qiga.convergence, ...qpso.convergence],
  });

  // Never worse than the baseline.
  if (hybridScore >= gScore) return { q: hybridQ, algo: "hybrid", runs };
  return { q: g, algo: "greedy", runs };
}

export interface SuggestOptions {
  requestId?: string;
  category?: Category;
  qty?: number;
  neededBy?: number | null;
}

/** Suggest donor bundles for a shelter's request. Pure with respect to the state. */
export function suggestBundles(state: SimState, shelterId: string, opts: SuggestOptions): Suggestion {
  const shelter = state.shelters.find((s) => s.id === shelterId);
  if (!shelter) throw new Error("Unknown shelter");
  const req = opts.requestId ? state.market.requests.find((r) => r.id === opts.requestId) : undefined;
  const category = (req?.category ?? opts.category) as Category;
  const need = Math.max(0, Math.round(req?.remainingQty ?? opts.qty ?? 0));
  const neededBy = req?.neededBy ?? opts.neededBy ?? null;
  const unit = state.market.listings.find((l) => l.category === category)?.unit ?? "units";
  const base: Suggestion = { shelterId, category, need, unit, candidates: 0, stock: 0, bundles: [], baseline: null, runs: [], why: [] };
  if (!category || need <= 0) return { ...base, reason: "Nothing left to cover" };

  const eligible = eligibleListings(state, shelter, { category, neededBy })
    .filter((e) => e.listing.availableQty > 0)
    .slice(0, MAX_CANDIDATES);
  if (!eligible.length) return { ...base, reason: "No donor can safely reach this shelter in time right now" };

  const cands: Candidate[] = eligible.map((e) => ({
    listing: e.listing,
    reach: e.reach,
    pSafe: analyticSurvival(e.reach.arrivalP90 - state.clock, Math.max(0, e.listing.expiresAt - state.clock), 0.9),
  }));
  const stock = cands.reduce((n, c) => n + c.listing.availableQty, 0);
  const target = Math.min(need, stock);
  const seed = state.seed ^ hash(`${shelterId}:${req?.id ?? category}`);

  const bundles: Bundle[] = [];
  let runs: SuggestRun[] = [];
  const profiles: Profile[] = req?.priority === "critical" ? ["freshest", "balanced", "fewest"] : ["balanced", "fewest", "freshest"];
  for (const profile of profiles) {
    const { q, algo, runs: r } = optimise(cands, target, profile, seed);
    const b = toBundle(cands, need, q, profile, algo, WEIGHTS[profile]);
    // Drop alternatives identical to one already listed.
    const sig = b.lines.map((l) => `${l.listingId}:${l.qty}`).join("|");
    if (!bundles.some((x) => x.lines.map((l) => `${l.listingId}:${l.qty}`).join("|") === sig)) bundles.push(b);
    if (profile === profiles[0]) runs = r;
  }
  const w0 = WEIGHTS[profiles[0]];
  const baseline = toBundle(cands, need, greedyQty(cands, target), profiles[0], "greedy", w0);
  const top = bundles[0];

  const why: string[] = [];
  why.push(`Covers ${top.covered} of ${need} ${unit}${top.shortfall > 0 ? ` (all the safe stock available; ${top.shortfall} short)` : ""} from ${top.donors} donor${top.donors === 1 ? "" : "s"}.`);
  why.push(`Everything arrives with about ${Math.round(top.avgSlackMin)} min to spare before the safety deadline (${Math.round(top.avgSafe * 100)}% chance of arriving in time).`);
  if (baseline.donors > top.donors) why.push(`Needs ${baseline.donors - top.donors} fewer pickup${baseline.donors - top.donors === 1 ? "" : "s"} than simply taking the freshest first.`);
  if (top.score > baseline.score + 0.5) why.push(`Scores ${(top.score - baseline.score).toFixed(1)} points above the simple freshest-first plan on the combined measure of cover, safety, freshness, distance and pickups.`);
  const skipped = cands.filter((c) => !top.lines.some((l) => l.listingId === c.listing.id));
  const tight = skipped.filter((c) => c.reach.slackMin < 15).length;
  if (tight > 0) why.push(`Leaves out ${tight} donor${tight === 1 ? "" : "s"} whose supplies would arrive with very little time to spare.`);

  return { ...base, candidates: cands.length, stock, bundles, baseline, runs, why };
}
