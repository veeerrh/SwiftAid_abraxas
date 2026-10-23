import { describe, expect, it } from "vitest";
import { greedyPlan } from "@/lib/engine/greedy";
import { validatePlan } from "@/lib/engine/validator";
import { analyticSurvival, checkFeasible, fitQty, scorePlan } from "@/lib/engine/feasibility";
import { seedProblem } from "./helpers";

describe("feasibility", () => {
  it("rejects a delivery that cannot land inside the safe window", () => {
    const p = seedProblem([{ donorId: "D1", category: "cooked", qty: 40, minutesLeft: 8 }]);
    const f = checkFeasible(p, p.cargos[0], p.riders[0], p.shelters[0]);
    expect(f.ok).toBe(false);
    expect(f.code).toBe("TOO_LATE");
  });

  it("survival falls as slack shrinks and as reliability drops", () => {
    const tight = analyticSurvival(30, 32, 0.95);
    const roomy = analyticSurvival(30, 80, 0.95);
    expect(roomy).toBeGreaterThan(tight);
    expect(analyticSurvival(30, 80, 0.7)).toBeLessThan(analyticSurvival(30, 80, 0.95));
    expect(analyticSurvival(30, 5, 0.99)).toBeLessThan(0.05);
  });

  it("fitQty respects chunking and caps", () => {
    expect(fitQty(40, 180, 50, 5)).toBe(40);
    expect(fitQty(40, 7, 50, 5)).toBe(7);
    expect(fitQty(40, 100, 3, 5)).toBe(0);
    expect(fitQty(40, 100, 12, 5)).toBe(10);
  });
});

describe("greedy allocator — the 180-meal banquet scenario", () => {
  const problem = seedProblem(
    [{ donorId: "D1", category: "cooked", qty: 180, minutesLeft: 75 }],
    { shelterOverrides: { S1: { available: 50 } } },
  );
  const plan = greedyPlan(problem);

  it("splits the batch across several riders because one rider can only carry 40", () => {
    // 180 meals cannot ride on one scooter (40) or even the van (60): needs >= 4 riders.
    expect(plan.assignments.length).toBeGreaterThanOrEqual(4);
    const cap = new Map(problem.riders.map((r) => [r.id, r.capacity]));
    expect(plan.assignments.every((a) => a.qty <= cap.get(a.riderId)!)).toBe(true);
  });

  it("never exceeds shelter capacity (Shelter A only fits 50)", () => {
    const toS1 = plan.assignments.filter((a) => a.shelterId === "S1").reduce((n, a) => n + a.qty, 0);
    expect(toS1).toBeLessThanOrEqual(50);
  });

  it("places everything the network can safely take and passes the validator", () => {
    const placed = plan.assignments.reduce((n, a) => n + a.qty, 0);
    expect(placed + (plan.unplaced.C1 ?? 0)).toBe(180);
    expect(placed).toBeGreaterThanOrEqual(170);
    expect(validatePlan(problem, plan).ok).toBe(true);
  });

  it("uses each rider at most once", () => {
    const ids = plan.assignments.map((a) => a.riderId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every leg lands before the batch expires", () => {
    for (const a of plan.assignments) expect(a.totalMin).toBeLessThan(75);
  });
});

describe("dependency rules in the planner", () => {
  it("never sends infant formula to a shelter without clean water (S4)", () => {
    const p = seedProblem([{ donorId: "D2", category: "infant_formula", qty: 60, minutesLeft: 300 }]);
    const plan = greedyPlan(p);
    expect(plan.assignments.length).toBeGreaterThan(0);
    expect(plan.assignments.some((a) => a.shelterId === "S4")).toBe(false);
  });

  it("never sends raw rations to a shelter without cooking fuel (S3)", () => {
    const p = seedProblem([{ donorId: "D2", category: "raw_ration", qty: 100, minutesLeft: 300 }]);
    const plan = greedyPlan(p);
    expect(plan.assignments.some((a) => a.shelterId === "S3")).toBe(false);
  });

  it("only routes cold-chain medical packs to sites with cold storage", () => {
    const p = seedProblem([{ donorId: "D3", category: "medical", qty: 20, minutesLeft: 120, coldChain: true }]);
    const plan = greedyPlan(p);
    expect(plan.assignments.length).toBeGreaterThan(0);
    for (const a of plan.assignments) expect(["S4", "S6"]).toContain(a.shelterId);
  });

  it("leaves a cargo unplaced (not dispatched) when no safe destination exists", () => {
    const p = seedProblem([{ donorId: "D2", category: "infant_formula", qty: 20, minutesLeft: 300 }], {
      shelterOverrides: { S1: { open: false }, S2: { open: false }, S3: { open: false }, S5: { open: false }, S6: { open: false } },
    });
    const plan = greedyPlan(p);
    expect(plan.assignments).toHaveLength(0);
    expect(plan.unplaced.C1).toBe(20);
  });
});

describe("safety validator", () => {
  const problem = seedProblem(
    [{ donorId: "D1", category: "cooked", qty: 100, minutesLeft: 75 }],
    { shelterOverrides: { S1: { available: 50 } } },
  );
  const base = greedyPlan(problem);

  it("accepts a clean plan", () => {
    expect(validatePlan(problem, base).ok).toBe(true);
  });

  it("rejects over-capacity shipments to a shelter", () => {
    const a = { ...base.assignments[0], shelterId: "S1", qty: 40 };
    const b = { ...base.assignments[1], shelterId: "S1", qty: 40 };
    const v = validatePlan(problem, { assignments: [a, b], unplaced: {} });
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => x.code === "OVER_SHELTER_CAPACITY")).toBe(true);
  });

  it("rejects the same rider twice", () => {
    const a = base.assignments[0];
    const v = validatePlan(problem, { assignments: [a, { ...a }], unplaced: {} });
    expect(v.violations.some((x) => x.code === "DUPLICATE_RIDER")).toBe(true);
  });

  it("rejects incompatible destinations proposed by an AI", () => {
    const f = seedProblem([{ donorId: "D2", category: "infant_formula", qty: 10, minutesLeft: 300 }]);
    const good = greedyPlan(f).assignments[0];
    const bad = { ...good, shelterId: "S4" };
    const v = validatePlan(f, { assignments: [bad], unplaced: {} });
    expect(v.ok).toBe(false);
    expect(v.violations[0].code).toBe("NO_CLEAN_WATER");
  });

  it("rejects unknown references and bad quantities", () => {
    const a = base.assignments[0];
    expect(validatePlan(problem, { assignments: [{ ...a, riderId: "R999" }], unplaced: {} }).violations[0].code).toBe("UNKNOWN_REF");
    expect(validatePlan(problem, { assignments: [{ ...a, qty: -3 }], unplaced: {} }).violations[0].code).toBe("BAD_QTY");
  });

  it("rejects moving more than the cargo holds or the rider can carry", () => {
    const a = base.assignments[0];
    const v = validatePlan(problem, { assignments: [{ ...a, qty: 500 }], unplaced: {} });
    const codes = v.violations.map((x) => x.code);
    expect(codes).toContain("OVER_RIDER_CAPACITY");
    expect(codes).toContain("OVER_CARGO");
  });

  it("scores a plan with positive fitness and survival in [0,1]", () => {
    const s = scorePlan(problem, base);
    expect(s.fitness).toBeGreaterThan(0);
    expect(s.avgSurvival).toBeGreaterThan(0);
    expect(s.avgSurvival).toBeLessThanOrEqual(1);
  });
});
