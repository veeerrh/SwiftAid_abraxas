import { describe, expect, it } from "vitest";
import { dispatchAction } from "@/lib/actions";
import { makeRng } from "@/lib/domain/rng";
import { checkCompatibility } from "@/lib/domain/rules";
import { activeLegs } from "@/lib/engine/sim";
import { Store } from "@/lib/store";

/**
 * Judges will break things in unpredictable orders. This throws seeded random failures at the
 * city and checks the safety invariants after every step.
 */
function runFuzz(seed: number, steps: number) {
  const rng = makeRng(seed);
  const st = new Store({ autostart: false, boot: "quiet" });
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const donors = st.state.donors.map((d) => d.id);
  const shelters = st.state.shelters.map((s) => s.id);
  const riders = st.state.riders.map((r) => r.id);
  const cats = ["cooked", "raw_ration", "medical", "infant_formula", "kit"] as const;
  const delivered = new Map<string, number>();

  for (let i = 0; i < steps; i++) {
    const roll = rng();
    if (roll < 0.14) {
      const category = pick([...cats]);
      dispatchAction(st, {
        type: "addBatch",
        donorId: pick(donors),
        category,
        qty: 5 + Math.floor(rng() * 120),
        safeMin: 8 + Math.floor(rng() * 160),
        coldChain: category === "medical" && rng() < 0.5,
      });
    } else if (roll < 0.22) dispatchAction(st, { type: "chaosGhost", riderId: pick(riders) });
    else if (roll < 0.27) dispatchAction(st, { type: "chaosUnghost", riderId: pick(riders) });
    else if (roll < 0.34) dispatchAction(st, { type: "setShelterOpen", shelterId: pick(shelters), open: rng() < 0.5 });
    else if (roll < 0.4) dispatchAction(st, { type: "citizenDrop", shelterId: pick(shelters), amount: 5 + Math.floor(rng() * 50) });
    else if (roll < 0.44) dispatchAction(st, { type: "setShelterRemaining", shelterId: pick(shelters), remaining: Math.floor(rng() * 80) });
    else if (roll < 0.48) dispatchAction(st, { type: "setShelterFacility", shelterId: pick(shelters), key: pick(["cleanWater", "cookingFuel", "coldStorage"] as const), value: rng() < 0.5 });
    else if (roll < 0.52) dispatchAction(st, { type: "chaosTraffic", factor: 1.5 + rng() * 2, durationMin: 5 + Math.floor(rng() * 20) });
    else if (roll < 0.55) dispatchAction(st, { type: "setRiderManual", riderId: pick(riders), manual: rng() < 0.5 });
    else if (roll < 0.58) dispatchAction(st, { type: "setAlgo", algo: pick(["greedy", "qiga", "qpso", "hybrid"] as const) });

    st.advance(0.5 + rng() * 3);

    const s = st.state;
    // 1. Conservation of every batch.
    for (const b of s.batches) {
      const inflight = activeLegs(s).filter((l) => l.batchId === b.id).reduce((n, l) => n + l.qty, 0);
      const sum = b.deliveredQty + b.spoiledQty + b.unplacedQty + inflight;
      if (sum !== b.qty) throw new Error(`seed ${seed} step ${i}: batch ${b.id} leaks (${sum} != ${b.qty})`);
      if (b.unplacedQty < 0 || b.deliveredQty < 0 || b.spoiledQty < 0) throw new Error(`seed ${seed} step ${i}: negative bucket on ${b.id}`);
    }
    // 2. Shelters never go negative and never exceed their total.
    for (const sh of s.shelters) {
      if (sh.capacityRemaining < 0 || sh.capacityRemaining > sh.totalCapacity) throw new Error(`seed ${seed} step ${i}: capacity out of range at ${sh.id}`);
    }
    // 3. Nothing was ever delivered into a shelter that was unsafe at that moment.
    for (const l of s.legs.filter((x) => x.state === "delivered")) {
      if (delivered.has(l.id)) continue;
      delivered.set(l.id, 1);
      const b = s.batches.find((x) => x.id === l.batchId)!;
      const sh = s.shelters.find((x) => x.id === l.shelterId)!;
      // Facilities may change after delivery, so only verify static rules: category accepted.
      if (!sh.accepts.includes(b.category)) throw new Error(`seed ${seed} step ${i}: ${b.category} delivered to a shelter that does not accept it`);
    }
    // 4. A rider carries at most one active leg and never exceeds capacity.
    const seen = new Set<string>();
    for (const l of activeLegs(s)) {
      if (seen.has(l.riderId)) throw new Error(`seed ${seed} step ${i}: rider ${l.riderId} double-booked`);
      seen.add(l.riderId);
      const r = s.riders.find((x) => x.id === l.riderId)!;
      if (l.qty > r.capacity) throw new Error(`seed ${seed} step ${i}: rider ${r.id} overloaded`);
    }
    // 5. Active legs only point at compatible destinations (after the planner had its turn).
    for (const l of activeLegs(s)) {
      const b = s.batches.find((x) => x.id === l.batchId)!;
      const sh = s.shelters.find((x) => x.id === l.shelterId)!;
      const c = checkCompatibility(b.category, sh, { coldChain: b.coldChain });
      if (!c.ok && l.note !== "stranded") throw new Error(`seed ${seed} step ${i}: leg ${l.id} heads to an unsafe destination (${c.code}) without being flagged`);
    }
  }
  // Drain: nothing may stay in flight forever once we stop injecting chaos.
  for (let i = 0; i < 400; i++) st.advance(2);
  for (const b of st.state.batches) {
    expect(b.deliveredQty + b.spoiledQty + b.unplacedQty, `drain ${b.id}`).toBe(b.qty);
  }
  return st.state.metrics;
}

describe("fuzz: random failures never break safety invariants", () => {
  for (const seed of [1, 2, 3, 7, 11, 42, 99, 2026]) {
    it(`seed ${seed}`, () => {
      const m = runFuzz(seed, 90);
      expect(m.delivered + m.spoiled).toBeGreaterThan(0);
    }, 60_000);
  }
});
