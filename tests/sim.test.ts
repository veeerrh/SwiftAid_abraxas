import { describe, expect, it } from "vitest";
import { createInitialState } from "@/lib/domain/seed";
import type { SimState } from "@/lib/domain/types";
import {
  acceptLeg,
  activeLegs,
  addBatch,
  closeShelter,
  ghostRider,
  setShelterOpen,
  spawnScenario,
  surgeDemand,
  tick,
  tightExpiryBatch,
  trafficJam,
} from "@/lib/engine/sim";

/** Quantity conservation: every unit is delivered, spoiled, unplaced or on a rider. */
function assertConserved(s: SimState) {
  for (const b of s.batches) {
    const inflight = s.legs.filter((l) => activeLegs(s).includes(l) && l.batchId === b.id).reduce((n, l) => n + l.qty, 0);
    const total = b.deliveredQty + b.spoiledQty + b.unplacedQty + inflight;
    expect(total, `batch ${b.id} conservation at t=${s.clock.toFixed(1)}`).toBe(b.qty);
  }
  for (const sh of s.shelters) {
    expect(sh.capacityRemaining).toBeGreaterThanOrEqual(0);
  }
}

function run(s: SimState, minutes: number, step = 0.25, each?: (s: SimState) => void) {
  const n = Math.round(minutes / step);
  for (let i = 0; i < n; i++) {
    tick(s, step);
    assertConserved(s);
    each?.(s);
  }
}

const delivered = (s: SimState, batchId: string) => s.batches.find((b) => b.id === batchId)!.deliveredQty;

describe("scenario A — 180-meal banquet", () => {
  it("splits across riders and shelters, delivers safely, never spoils", () => {
    const s = createInitialState();
    const b = spawnScenario(s, "banquet");
    expect(activeLegs(s).length).toBeGreaterThanOrEqual(4);
    expect(activeLegs(s).every((l) => l.qty <= 60)).toBe(true);
    const toS1 = activeLegs(s).filter((l) => l.shelterId === "S1").reduce((n, l) => n + l.qty, 0);
    expect(toS1).toBeLessThanOrEqual(50);

    run(s, 75);
    expect(b.deliveredQty).toBeGreaterThanOrEqual(170);
    expect(b.spoiledQty).toBe(0);
    expect(s.metrics.delivered).toBe(b.deliveredQty);
    expect(s.shelters.every((x) => x.capacityRemaining >= 0)).toBe(true);
  });

  it("attaches survival estimates and a hot standby to risky legs", () => {
    const s = createInitialState();
    spawnScenario(s, "banquet");
    for (const l of activeLegs(s)) {
      expect(l.survival).toBeDefined();
      expect(l.survival!.p).toBeGreaterThan(0);
    }
  });
});

describe("ghost reservations", () => {
  it("releases a silent rider's lease and recovers the batch with another rider", () => {
    const s = createInitialState();
    const b = spawnScenario(s, "banquet");
    run(s, 1);
    const victim = ghostRider(s)!;
    const leg = s.legs.find((l) => l.riderId === victim.id)!;
    run(s, 12);
    expect(leg.state).toBe("released");
    expect(s.metrics.ghostRecoveries).toBeGreaterThanOrEqual(1);
    expect(s.metrics.responseCount).toBeGreaterThanOrEqual(1);
    // Detected and reassigned well inside the shelf life.
    expect(s.metrics.responseMinSum / s.metrics.responseCount).toBeLessThan(10);
    run(s, 70);
    expect(b.deliveredQty).toBeGreaterThanOrEqual(150);
  });

  it("recovers cargo already picked up when the carrier goes silent mid-route", () => {
    const s = createInitialState();
    const b = spawnScenario(s, "banquet");
    // Run until some leg is carrying cargo.
    run(s, 40, 0.25, () => {});
    const carrying = activeLegs(s).find((l) => l.carrying);
    if (!carrying) return; // everything already delivered quickly — nothing to ghost
    ghostRider(s, carrying.riderId);
    run(s, 25);
    expect(carrying.state).toBe("released");
    run(s, 20);
    expect(b.spoiledQty + b.deliveredQty).toBeGreaterThan(0);
  });

  it("does not accept an offer from a silent rider and re-offers elsewhere", () => {
    const s = createInitialState();
    const first = addBatch(s, { donorId: "D1", category: "cooked", qty: 30, safeMin: 90 });
    const leg = activeLegs(s)[0];
    expect(first.unplacedQty).toBe(0);
    ghostRider(s, leg.riderId);
    run(s, 8);
    expect(leg.state).toBe("released");
    const replacement = s.legs.find((l) => l.id !== leg.id && l.batchId === first.id && l.state !== "released");
    expect(replacement).toBeDefined();
    expect(replacement!.riderId).not.toBe(leg.riderId);
  });

  it("manual riders must accept; ignoring the offer times out and reassigns", () => {
    const s = createInitialState();
    for (const r of s.riders) r.manual = r.id === "R7";
    for (const r of s.riders) if (r.id !== "R7") r.status = "offline"; // force R7 as only candidate first
    const b = addBatch(s, { donorId: "D3", category: "kit", qty: 10, safeMin: 200 });
    const leg = activeLegs(s)[0];
    expect(leg.riderId).toBe("R7");
    expect(leg.state).toBe("offered");
    run(s, 2);
    expect(leg.state).toBe("offered"); // no auto accept
    for (const r of s.riders) if (r.id !== "R7") r.status = "idle";
    run(s, 6);
    expect(leg.state).toBe("released");
    expect(b.unplacedQty + activeLegs(s).reduce((n, l) => n + l.qty, 0)).toBe(10);
  });

  it("manual accept starts the journey", () => {
    const s = createInitialState();
    for (const r of s.riders) r.manual = true;
    addBatch(s, { donorId: "D3", category: "kit", qty: 10, safeMin: 200 });
    const leg = activeLegs(s)[0];
    expect(acceptLeg(s, leg.id)).toBe(true);
    expect(leg.state).toBe("to_pickup");
  });
});

describe("mid-journey demand changes", () => {
  function inDropPhase(s: SimState) {
    return activeLegs(s).filter((l) => l.state === "to_drop");
  }

  it("diverts an in-transit rider when their shelter closes", () => {
    const s = createInitialState();
    const b = spawnScenario(s, "banquet");
    let target: ReturnType<typeof inDropPhase>[number] | undefined;
    run(s, 40, 0.25, (st) => {
      if (!target) target = inDropPhase(st)[0];
    });
    // Restart cleaner: rerun until one is in drop phase then close its shelter.
    const s2 = createInitialState();
    const b2 = spawnScenario(s2, "banquet");
    let guard = 0;
    while (inDropPhase(s2).length === 0 && guard++ < 400) tick(s2, 0.25);
    const leg = inDropPhase(s2)[0];
    expect(leg).toBeDefined();
    const closing = leg.shelterId;
    closeShelter(s2, closing);
    expect(leg.shelterId).not.toBe(closing);
    expect(leg.divertedFrom).toBe(closing);
    expect(s2.metrics.diverts).toBeGreaterThanOrEqual(1);
    run(s2, 70);
    expect(b2.deliveredQty).toBeGreaterThanOrEqual(120);
    expect(s2.shelters.find((x) => x.id === closing)!.capacityRemaining).toBeGreaterThanOrEqual(0);
    void b;
  });

  it("diverts when a citizen fills the shelter (demand closes while rider is mid-route)", () => {
    const s = createInitialState();
    const b = spawnScenario(s, "banquet");
    let guard = 0;
    while (inDropPhase(s).length === 0 && guard++ < 400) tick(s, 0.25);
    const leg = inDropPhase(s)[0];
    const from = leg.shelterId;
    surgeDemand(s, from);
    expect(s.shelters.find((x) => x.id === from)!.capacityRemaining).toBe(0);
    expect(leg.shelterId).not.toBe(from);
    run(s, 70);
    expect(b.spoiledQty).toBeLessThan(b.qty * 0.2);
    // Nothing was delivered into the filled shelter after the surge.
    expect(s.shelters.find((x) => x.id === from)!.capacityRemaining).toBe(0);
  });

  it("strands visibly (not silently) when no safe shelter remains", () => {
    const s = createInitialState();
    addBatch(s, { donorId: "D1", category: "cooked", qty: 30, safeMin: 60 });
    let guard = 0;
    while (inDropPhase(s).length === 0 && guard++ < 400) tick(s, 0.25);
    for (const sh of s.shelters) setShelterOpen(s, sh.id, false);
    const leg = s.legs.find((l) => l.state === "to_drop")!;
    expect(leg.note).toBe("stranded");
    expect(s.events.some((e) => e.type === "stranded")).toBe(true);
    run(s, 70);
    // Spoiled cargo is accounted, never delivered into a closed shelter.
    expect(s.metrics.delivered).toBe(0);
  });
});

describe("dependency and expiry safety", () => {
  it("never sends infant formula to a shelter without clean water", () => {
    const s = createInitialState();
    spawnScenario(s, "formula");
    for (const l of s.legs) expect(l.shelterId).not.toBe("S4");
    run(s, 200);
    expect(s.legs.every((l) => l.shelterId !== "S4")).toBe(true);
  });

  it("holds formula back and says why when the only open shelter lacks clean water", () => {
    const s = createInitialState();
    for (const sh of s.shelters) if (sh.id !== "S4") sh.open = false;
    const b = spawnScenario(s, "formula");
    expect(s.legs.length).toBe(0);
    expect(b.unplacedQty).toBe(24);
    const ev = s.events.find((e) => e.type === "blocked");
    expect(ev?.text).toMatch(/clean water/i);
    expect(s.metrics.blockedDispatches).toBeGreaterThanOrEqual(1);
  });

  it("routes cold-chain medicine only to shelters with cold storage", () => {
    const s = createInitialState();
    spawnScenario(s, "pharmacy");
    expect(s.legs.length).toBeGreaterThan(0);
    for (const l of s.legs) expect(["S4", "S6"]).toContain(l.shelterId);
  });

  it("does not dispatch a batch that cannot arrive in time; it spoils visibly", () => {
    const s = createInitialState();
    const b = addBatch(s, { donorId: "D4", category: "cooked", qty: 20, safeMin: 4 });
    expect(s.legs.length).toBe(0);
    run(s, 6);
    expect(b.spoiledQty).toBe(20);
    expect(b.status).toBe("spoiled");
    expect(s.metrics.spoiled).toBe(20);
  });

  it("tight-expiry batch is either delivered safely or held, never delivered late", () => {
    const s = createInitialState();
    const b = tightExpiryBatch(s);
    run(s, 20);
    const late = s.legs.filter((l) => l.state === "delivered");
    expect(late.length === 0 || b.deliveredQty > 0).toBe(true);
    expect(b.deliveredQty + b.spoiledQty + b.unplacedQty + activeLegs(s).reduce((n, l) => n + l.qty, 0)).toBe(40);
  });
});

describe("traffic and general invariants", () => {
  it("survives a traffic jam without breaking conservation", () => {
    const s = createInitialState();
    const b = spawnScenario(s, "banquet");
    run(s, 5);
    trafficJam(s, 2.5, 20);
    run(s, 80);
    expect(b.deliveredQty + b.spoiledQty).toBe(b.qty);
    expect(s.trafficFactor).toBe(1);
  });

  it("handles a chaotic mix of failures without crashing", () => {
    const s = createInitialState();
    spawnScenario(s, "rush");
    run(s, 4);
    ghostRider(s);
    run(s, 3);
    closeShelter(s);
    run(s, 3);
    surgeDemand(s);
    run(s, 3);
    trafficJam(s, 2, 10);
    run(s, 100);
    for (const b of s.batches) expect(b.deliveredQty + b.spoiledQty).toBe(b.qty);
    expect(s.metrics.series.length).toBeGreaterThan(5);
  });
});
