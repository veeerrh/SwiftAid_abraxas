import { describe, expect, it } from "vitest";
import { dispatchAction } from "@/lib/actions";
import { buildWorldFromSpec } from "@/lib/market/studio";
import { BLANK_SPEC, PRESETS, scenarioSchema } from "@/lib/market/studio-presets";
import { Store } from "@/lib/store";

describe("Demo Studio", () => {
  it("every preset validates and builds a world of the requested size", () => {
    for (const p of PRESETS) {
      const spec = scenarioSchema.parse(p.spec);
      const s = buildWorldFromSpec(spec);
      expect(s.donors).toHaveLength(spec.donors);
      expect(s.shelters).toHaveLength(spec.shelters);
      expect(s.riders).toHaveLength(spec.riders);
      expect(s.market.listings.length).toBeGreaterThan(0);
      expect(s.studio?.failures).toHaveLength(spec.failures.length);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = buildWorldFromSpec({ ...BLANK_SPEC, donors: 10, riders: 15 });
    const b = buildWorldFromSpec({ ...BLANK_SPEC, donors: 10, riders: 15 });
    expect(a.riders.map((r) => r.loc)).toEqual(b.riders.map((r) => r.loc));
  });

  it("loads through the action API and fires scheduled failures on time", () => {
    const st = new Store({ autostart: false, boot: "market" });
    const spec = scenarioSchema.parse({ ...BLANK_SPEC, autoOrders: true, failures: [{ atMin: 5, type: "traffic", factor: 2, durationMin: 10 }] });
    expect(dispatchAction(st, { type: "studioLoad", spec }).ok).toBe(true);
    expect(st.state.studio?.failures[0].fired).toBe(false);
    st.advance(8);
    expect(st.state.studio?.failures[0].fired).toBe(true);
    expect(st.state.events.some((e) => e.type === "studio_failure")).toBe(true);
  });

  it("applies live knobs and manual failures", () => {
    const st = new Store({ autostart: false, boot: "market" });
    dispatchAction(st, { type: "studioLoad", spec: scenarioSchema.parse(BLANK_SPEC) });
    const k = dispatchAction(st, { type: "studioKnob", riderReliability: 0.5, ridersOffline: 2 });
    expect(k.ok).toBe(true);
    expect(st.state.riders.every((r) => r.reliability === 0.5)).toBe(true);
    expect(st.state.riders.filter((r) => r.status === "offline").length).toBe(2);
    expect(dispatchAction(st, { type: "studioFail", failure: { atMin: 0, type: "expiryShock", factor: 0.5 } }).ok).toBe(true);
  });

  it("rejects an invalid scenario", () => {
    const st = new Store({ autostart: false, boot: "market" });
    expect(dispatchAction(st, { type: "studioLoad", spec: { name: "x", donors: 99 } }).ok).toBe(false);
  });
});

describe("Demo Studio snapshot", () => {
  it("exposes the running scenario to the UI", () => {
    const st = new Store({ autostart: false, boot: "market" });
    expect(st.snapshot().studio).toBeUndefined();
    dispatchAction(st, { type: "studioLoad", spec: scenarioSchema.parse(BLANK_SPEC) });
    expect(st.snapshot().studio?.name).toBe(BLANK_SPEC.name);
  });
});
