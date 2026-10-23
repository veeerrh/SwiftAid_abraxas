import { describe, expect, it } from "vitest";
import { dispatchAction } from "@/lib/actions";
import { Store } from "@/lib/store";

const fresh = (boot: "quiet" | "banquet" | "rush" = "quiet") => new Store({ autostart: false, boot });

describe("action API", () => {
  it("rejects malformed actions with a readable error", () => {
    const st = fresh();
    expect(dispatchAction(st, { type: "nope" }).ok).toBe(false);
    const r = dispatchAction(st, { type: "addBatch", donorId: "D1", category: "cooked", qty: -4 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/qty/);
  });

  it("rejects unknown ids instead of throwing", () => {
    const st = fresh();
    expect(dispatchAction(st, { type: "setShelterOpen", shelterId: "ZZZ", open: false }).ok).toBe(false);
    expect(dispatchAction(st, { type: "chaosGhost", riderId: "R99" }).ok).toBe(false);
    expect(dispatchAction(st, { type: "addBatch", donorId: "D99", category: "kit", qty: 5 }).ok).toBe(false);
  });

  it("creates a donation and plans it immediately", () => {
    const st = fresh();
    const r = dispatchAction(st, { type: "addBatch", donorId: "D1", category: "cooked", qty: 60, safeMin: 90 });
    expect(r.ok).toBe(true);
    const snap = st.snapshot();
    expect(snap.batches).toHaveLength(1);
    expect(snap.legs.length).toBeGreaterThan(0);
    expect(snap.optimizerRuns.length).toBeGreaterThan(0);
  });

  it("runs the full banquet flow through the API and delivers", () => {
    const st = fresh();
    dispatchAction(st, { type: "scenario", key: "banquet" });
    dispatchAction(st, { type: "step", minutes: 80 });
    const snap = st.snapshot();
    expect(snap.metrics.delivered).toBeGreaterThanOrEqual(170);
    expect(snap.metrics.spoiled).toBe(0);
  });

  it("chaos ghost + step recovers the batch", () => {
    const st = fresh("banquet");
    dispatchAction(st, { type: "step", minutes: 1 });
    expect(dispatchAction(st, { type: "chaosGhost" }).ok).toBe(true);
    dispatchAction(st, { type: "step", minutes: 80 });
    expect(st.snapshot().metrics.ghostRecoveries).toBeGreaterThanOrEqual(1);
  });

  it("shelter controls trigger replanning", () => {
    const st = fresh("banquet");
    dispatchAction(st, { type: "step", minutes: 12 });
    const before = st.snapshot().legs.filter((l) => l.state !== "delivered" && l.state !== "released");
    const target = before[0]?.shelterId;
    if (target) {
      expect(dispatchAction(st, { type: "chaosCloseShelter", shelterId: target }).ok).toBe(true);
      const after = st.snapshot().legs.filter((l) => l.state === "to_drop" || l.state === "to_pickup" || l.state === "offered");
      expect(after.every((l) => l.shelterId !== target)).toBe(true);
    }
  });

  it("pause stops the clock; step still advances; rate is clamped by schema", () => {
    const st = fresh("banquet");
    dispatchAction(st, { type: "pause" });
    expect(st.snapshot().running).toBe(false);
    const t = st.snapshot().clock;
    dispatchAction(st, { type: "step", minutes: 2 });
    expect(st.snapshot().clock).toBeCloseTo(t + 2, 5);
    expect(dispatchAction(st, { type: "setRate", rate: 99 }).ok).toBe(false);
    expect(dispatchAction(st, { type: "setRate", rate: 1 }).ok).toBe(true);
  });

  it("switching algorithm re-plans and keeps results for all four algorithms", () => {
    const st = fresh("banquet");
    expect(dispatchAction(st, { type: "setAlgo", algo: "qiga" }).ok).toBe(true);
    const snap = st.snapshot();
    expect(snap.algo).toBe("qiga");
    const last = snap.optimizerRuns.at(-1)!;
    expect(last.results.map((r) => r.name)).toEqual(["greedy", "qiga", "qpso", "hybrid"]);
  });

  it("manual rider control, heartbeat and decline flow", () => {
    const st = fresh();
    dispatchAction(st, { type: "setRiderManual", riderId: "R7", manual: true });
    for (const id of ["R1", "R2", "R3", "R4", "R5", "R6", "R8", "R9", "R10"]) {
      dispatchAction(st, { type: "setRiderManual", riderId: id, manual: true });
    }
    dispatchAction(st, { type: "addBatch", donorId: "D3", category: "kit", qty: 10, safeMin: 300 });
    const leg = st.snapshot().legs.find((l) => l.state === "offered")!;
    expect(leg).toBeDefined();
    expect(dispatchAction(st, { type: "heartbeat", riderId: leg.riderId }).ok).toBe(true);
    expect(dispatchAction(st, { type: "declineLeg", legId: leg.id }).ok).toBe(true);
    const re = st.snapshot().legs.find((l) => l.state === "offered" && l.id !== leg.id);
    expect(re?.riderId).not.toBe(leg.riderId);
    expect(dispatchAction(st, { type: "acceptLeg", legId: re!.id }).ok).toBe(true);
    expect(dispatchAction(st, { type: "acceptLeg", legId: re!.id }).ok).toBe(false);
  });

  it("reset restores the seed city and keeps the chosen optimizer", () => {
    const st = fresh("banquet");
    dispatchAction(st, { type: "setAlgo", algo: "qpso" });
    dispatchAction(st, { type: "step", minutes: 20 });
    dispatchAction(st, { type: "reset", scenario: "quiet" });
    const snap = st.snapshot();
    expect(snap.batches).toHaveLength(0);
    expect(snap.legs).toHaveLength(0);
    expect(snap.algo).toBe("qpso");
    expect(snap.clock).toBe(0);
  });

  it("snapshot is JSON-serialisable and bounded", () => {
    const st = fresh("rush");
    dispatchAction(st, { type: "step", minutes: 30 });
    const json = JSON.stringify(st.snapshot());
    expect(json.length).toBeLessThan(400_000);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
