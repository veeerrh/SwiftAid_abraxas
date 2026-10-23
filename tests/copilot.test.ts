import { describe, expect, it } from "vitest";
import { dispatchAction } from "@/lib/actions";
import { explainOffline, simulateDiff, understandOffline, validateProposed } from "@/lib/copilot";
import { Store } from "@/lib/store";

const city = (boot: "quiet" | "banquet" = "banquet") => new Store({ autostart: false, boot });

describe("copilot: offline understanding", () => {
  const st = city("quiet").state;
  it("closes a shelter by area name", () => {
    const u = understandOffline(st, "Please close Hadapsar");
    expect(u.actions).toEqual([{ type: "setShelterOpen", shelterId: "S4", open: false }]);
  });
  it("marks a shelter full", () => {
    const u = understandOffline(st, "Kothrud just filled up");
    expect(u.actions).toEqual([{ type: "setShelterRemaining", shelterId: "S3", remaining: 0 }]);
  });
  it("handles facility outages", () => {
    const u = understandOffline(st, "Warje ran out of clean water");
    expect(u.actions).toEqual([{ type: "setShelterFacility", shelterId: "S5", key: "cleanWater", value: false }]);
  });
  it("silences a named rider and switches optimizers", () => {
    expect(understandOffline(st, "ghost Aarav").actions).toEqual([{ type: "chaosGhost", riderId: "R1" }]);
    expect(understandOffline(st, "switch to QPSO").actions).toEqual([{ type: "setAlgo", algo: "qpso" }]);
  });
  it("answers questions without proposing actions", () => {
    const u = understandOffline(st, "why was Aarav chosen?");
    expect(u.actions).toHaveLength(0);
    expect(u.reply.length).toBeGreaterThan(10);
  });
  it("gives help for things it does not understand", () => {
    const u = understandOffline(st, "make me a sandwich");
    expect(u.actions).toHaveLength(0);
    expect(u.reply).toMatch(/Close Hadapsar/);
  });
});

describe("copilot: safety allowlist", () => {
  it("rejects actions the copilot may not take", () => {
    const { actions, rejected } = validateProposed([
      { type: "reset" },
      { type: "step", minutes: 100 },
      { type: "addBatch", donorId: "D1", category: "cooked", qty: 5 },
      { type: "setShelterOpen", shelterId: "S1", open: false },
    ]);
    expect(actions.map((a) => a.type)).toEqual(["setShelterOpen"]);
    expect(rejected).toHaveLength(3);
  });
  it("rejects malformed shapes and oversized lists", () => {
    expect(validateProposed([{ type: "setShelterOpen" }]).actions).toHaveLength(0);
    expect(validateProposed("nonsense").actions).toHaveLength(0);
    expect(validateProposed(new Array(20).fill({ type: "replan" })).actions).toHaveLength(0);
  });
});

describe("copilot: simulate then approve", () => {
  it("previews a shelter closure without touching the live city", () => {
    const live = city();
    live.advance(12);
    const snapBefore = JSON.stringify(live.state);
    const target = live.state.legs.find((l) => l.state === "to_drop" || l.state === "to_pickup")!.shelterId;
    const { diff, errors } = simulateDiff(live, [{ type: "setShelterOpen", shelterId: target, open: false }]);
    expect(errors).toEqual([]);
    expect(diff.changes.length).toBeGreaterThan(0);
    expect(JSON.stringify(live.state)).toBe(snapBefore);
    expect(live.state.shelters.find((s) => s.id === target)!.open).toBe(true);
  });

  it("the previewed outcome matches what approval actually does", () => {
    const live = city();
    live.advance(12);
    const target = live.state.legs.find((l) => l.state === "to_drop" || l.state === "to_pickup")!.shelterId;
    const actions = [{ type: "setShelterOpen" as const, shelterId: target, open: false }];
    const { diff } = simulateDiff(live, actions);
    for (const a of actions) expect(dispatchAction(live, a).ok).toBe(true);
    const after = live.state.legs.filter((l) => l.state !== "released" && l.state !== "delivered" && l.state !== "failed");
    expect(after.every((l) => l.shelterId !== target)).toBe(true);
    const expectedSafe = after.reduce((n, l) => n + l.qty * (l.survival?.p ?? 1), 0);
    expect(Math.abs(expectedSafe - diff.after.expectedSafe)).toBeLessThan(diff.after.expectedSafe * 0.25 + 3);
  });

  it("explains rider choices from live state", () => {
    const live = city();
    const leg = live.state.legs[0];
    const name = live.state.riders.find((r) => r.id === leg.riderId)!.name;
    expect(explainOffline(live.state, `why was ${name} chosen`)).toMatch(/survival/);
  });
});
