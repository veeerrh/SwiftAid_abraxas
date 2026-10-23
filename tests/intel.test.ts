import { describe, expect, it } from "vitest";
import { benchmark, bundleBenchmark, dispatchTrial, stress } from "@/lib/market/intel";

describe("Intelligence lab", () => {
  it("a trial reports all four algorithms and the optimiser is never worse than greedy", () => {
    const t = dispatchTrial(7001);
    for (const a of ["greedy", "qiga", "qpso", "hybrid"] as const) expect(t.fitness[a]).toBeDefined();
    expect(t.fitness.hybrid).toBeGreaterThanOrEqual(t.fitness.greedy - 1e-9);
  });

  it("benchmark summary adds up and never loses", () => {
    const { rows, summary } = benchmark(8);
    expect(rows).toHaveLength(8);
    expect(summary.winRate + summary.tieRate + summary.lossRate).toBeCloseTo(1, 5);
    expect(summary.histogram.reduce((a, b) => a + b.count, 0)).toBe(8);
    expect(summary.lossRate).toBe(0);
    expect(summary.winRate).toBeGreaterThan(0.3);
    expect(summary.meanSafe.greedy).toBeGreaterThan(50);
  });

  it("stress test returns one row per scale and bundle benchmark is sane", () => {
    const rows = stress([0.7, 1.5], 2);
    expect(rows).toHaveLength(2);
    expect(rows[1].meals).toBeGreaterThan(rows[0].meals);
    const b = bundleBenchmark(6);
    expect(b.trials).toBeGreaterThan(0);
    expect(b.avgGain).toBeGreaterThanOrEqual(-0.01);
  });
});
