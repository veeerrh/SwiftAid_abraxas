import { describe, expect, it } from "vitest";
import { makeRng } from "@/lib/domain/rng";
import { greedyPlan } from "@/lib/engine/greedy";
import { scorePlan } from "@/lib/engine/feasibility";
import { decode, emptyGenome, genomeFromPlan } from "@/lib/engine/optimizer/encoding";
import { runQIGA } from "@/lib/engine/optimizer/qiga";
import { runQPSO } from "@/lib/engine/optimizer/qpso";
import { solve } from "@/lib/engine/solver";
import { validatePlan } from "@/lib/engine/validator";
import { monteCarlo } from "@/lib/engine/monteCarlo";
import { seedProblem } from "./helpers";

const scenarios = {
  banquet: () =>
    seedProblem([{ donorId: "D1", category: "cooked", qty: 180, minutesLeft: 75 }], {
      shelterOverrides: { S1: { available: 50 } },
    }),
  rush: () =>
    seedProblem([
      { donorId: "D2", category: "cooked", qty: 80, minutesLeft: 90 },
      { donorId: "D5", category: "kit", qty: 30, minutesLeft: 300 },
      { donorId: "D4", category: "cooked", qty: 60, minutesLeft: 60 },
    ]),
  tight: () =>
    seedProblem([{ donorId: "D1", category: "cooked", qty: 150, minutesLeft: 32 }], {
      shelterOverrides: { S1: { available: 30 }, S3: { available: 20 }, S2: { available: 40 } },
      traffic: 1.6,
    }),
  mixed: () =>
    seedProblem([
      { donorId: "D3", category: "medical", qty: 20, minutesLeft: 120, coldChain: true },
      { donorId: "D2", category: "infant_formula", qty: 30, minutesLeft: 300 },
      { donorId: "D1", category: "cooked", qty: 120, minutesLeft: 50 },
    ]),
};

describe("genome decoding", () => {
  it("always produces rule-feasible plans, even from random genomes", () => {
    const rng = makeRng(99);
    for (const make of Object.values(scenarios)) {
      const p = make();
      const n = p.riders.length;
      for (let t = 0; t < 120; t++) {
        const g = emptyGenome(n);
        for (let i = 0; i < n; i++) {
          g.cargo[i] = Math.floor(rng() * (p.cargos.length + 1));
          g.shelter[i] = Math.floor(rng() * p.shelters.length);
          g.load[i] = 0.15 + rng() * 0.85;
          g.prio[i] = rng();
        }
        const plan = decode(p, g);
        const v = validatePlan(p, plan);
        expect(v.violations, JSON.stringify(v.violations[0])).toEqual([]);
      }
    }
  });

  it("round-trips the greedy plan closely", () => {
    const p = scenarios.banquet();
    const plan = greedyPlan(p);
    const back = decode(p, genomeFromPlan(p, plan));
    const a = scorePlan(p, plan);
    const b = scorePlan(p, back);
    expect(b.placedQty).toBe(a.placedQty);
  });
});

describe("QIGA / QPSO / hybrid", () => {
  it("never do worse than the greedy baseline, always validate", () => {
    for (const [name, make] of Object.entries(scenarios)) {
      const p = make();
      const g = scorePlan(p, greedyPlan(p)).fitness;
      for (const algo of ["qiga", "qpso", "hybrid"] as const) {
        const out = solve(p, algo, 1234);
        expect(validatePlan(p, out.plan).ok, `${name}/${algo}`).toBe(true);
        expect(scorePlan(p, out.plan).fitness, `${name}/${algo}`).toBeGreaterThanOrEqual(g - 1e-9);
      }
    }
  });

  it("is deterministic for a fixed seed", () => {
    const p = scenarios.banquet();
    const a = solve(p, "hybrid", 7).results.map((r) => r.fitness);
    const b = solve(p, "hybrid", 7).results.map((r) => r.fitness);
    expect(a).toEqual(b);
  });

  it("reports all four algorithms with convergence traces for the Optimizer Lab", () => {
    const out = solve(scenarios.rush(), "hybrid", 5);
    expect(out.results.map((r) => r.name)).toEqual(["greedy", "qiga", "qpso", "hybrid"]);
    for (const r of out.results.filter((x) => x.name !== "greedy")) {
      expect(r.convergence.length).toBeGreaterThan(5);
      for (let i = 1; i < r.convergence.length; i++) {
        expect(r.convergence[i]).toBeGreaterThanOrEqual(r.convergence[i - 1] - 1e-9);
      }
    }
  });

  it("converges: the swarm/GA improve on or match their seed", () => {
    const p = scenarios.tight();
    const base = genomeFromPlan(p, greedyPlan(p));
    const q = runQIGA(p, makeRng(3), base);
    const s = runQPSO(p, makeRng(3), base, { mode: "full" });
    expect(q.convergence.at(-1)!).toBeGreaterThanOrEqual(q.convergence[0]);
    expect(s.convergence.at(-1)!).toBeGreaterThanOrEqual(s.convergence[0]);
  });

  it("finds a strictly better plan than greedy on at least one constrained scenario", () => {
    let wins = 0;
    for (const make of Object.values(scenarios)) {
      const p = make();
      const g = scorePlan(p, greedyPlan(p)).fitness;
      const out = solve(p, "hybrid", 42);
      if (scorePlan(p, out.plan).fitness > g + 1e-6) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(1);
  });

  it("stays fast enough for live re-planning", () => {
    const t0 = performance.now();
    solve(scenarios.rush(), "hybrid", 11);
    expect(performance.now() - t0).toBeLessThan(900);
  });

  it("handles degenerate problems without throwing", () => {
    const p = scenarios.banquet();
    const noRiders = { ...p, riders: [] };
    expect(() => solve(noRiders, "hybrid", 1)).not.toThrow();
    const noCargo = { ...p, cargos: [] };
    expect(solve(noCargo, "qiga", 1).plan.assignments).toHaveLength(0);
  });
});

describe("Monte Carlo survival", () => {
  it("is high with plenty of slack and falls as slack tightens", () => {
    const roomy = monteCarlo({ etaMin: 20, minutesLeft: 90, reliability: 0.95, hasStandby: false, seed: 1 });
    const tight = monteCarlo({ etaMin: 20, minutesLeft: 24, reliability: 0.95, hasStandby: false, seed: 1 });
    expect(roomy.p).toBeGreaterThan(0.85);
    expect(tight.p).toBeLessThan(roomy.p);
  });

  it("a hot standby raises survival for an unreliable rider", () => {
    const without = monteCarlo({ etaMin: 20, minutesLeft: 70, reliability: 0.7, hasStandby: false, seed: 4 });
    const withSb = monteCarlo({ etaMin: 20, minutesLeft: 70, reliability: 0.7, hasStandby: true, seed: 4 });
    expect(withSb.p).toBeGreaterThan(without.p + 0.1);
  });

  it("is deterministic and returns a histogram + percentiles", () => {
    const a = monteCarlo({ etaMin: 15, minutesLeft: 40, reliability: 0.9, hasStandby: false, seed: 9 });
    const b = monteCarlo({ etaMin: 15, minutesLeft: 40, reliability: 0.9, hasStandby: false, seed: 9 });
    expect(a).toEqual(b);
    expect(a.bins.reduce((x, y) => x + y, 0)).toBeGreaterThan(1000);
    expect(a.p10).toBeLessThanOrEqual(a.p50);
    expect(a.p50).toBeLessThanOrEqual(a.p90);
  });

  it("collapses when the rider is already ghosting", () => {
    const m = monteCarlo({ etaMin: 15, minutesLeft: 60, reliability: 0.05, hasStandby: false, seed: 2 });
    expect(m.p).toBeLessThan(0.1);
  });
});
