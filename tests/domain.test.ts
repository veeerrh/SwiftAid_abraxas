import { describe, expect, it } from "vitest";
import { haversineKm, travelMinutes, lerpLatLng } from "@/lib/domain/geo";
import { checkCompatibility } from "@/lib/domain/rules";
import { createInitialState, makeShelters } from "@/lib/domain/seed";
import { gaussian, makeRng } from "@/lib/domain/rng";

describe("geo", () => {
  it("haversine is ~0 for identical points and symmetric", () => {
    const a = { lat: 18.5, lng: 73.85 };
    const b = { lat: 18.56, lng: 73.9 };
    expect(haversineKm(a, a)).toBeCloseTo(0, 6);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it("Koregaon Park to Kasba Peth is a plausible urban hop", () => {
    const km = haversineKm({ lat: 18.5362, lng: 73.894 }, { lat: 18.5195, lng: 73.8553 });
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(6);
  });

  it("travel time scales with traffic and has a floor", () => {
    const a = { lat: 18.5, lng: 73.85 };
    const b = { lat: 18.52, lng: 73.87 };
    const base = travelMinutes(a, b);
    expect(travelMinutes(a, b, { traffic: 2 })).toBeCloseTo(base * 2, 5);
    expect(travelMinutes(a, a)).toBeGreaterThanOrEqual(1.5);
  });

  it("lerp clamps", () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 10, lng: 10 };
    expect(lerpLatLng(a, b, -1)).toEqual(a);
    expect(lerpLatLng(a, b, 2)).toEqual(b);
    expect(lerpLatLng(a, b, 0.5)).toEqual({ lat: 5, lng: 5 });
  });
});

describe("compatibility rules", () => {
  const shelters = makeShelters();
  const byId = (id: string) => shelters.find((s) => s.id === id)!;

  it("blocks infant formula where there is no clean water", () => {
    const r = checkCompatibility("infant_formula", byId("S4"));
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NO_CLEAN_WATER");
  });

  it("blocks raw rations where there is no cooking fuel", () => {
    const r = checkCompatibility("raw_ration", byId("S3"));
    expect(r.code).toBe("NO_COOKING_FUEL");
  });

  it("blocks cold-chain medical supplies without cold storage and non-medical sites", () => {
    expect(checkCompatibility("medical", byId("S1")).code).toBe("NOT_ACCEPTED");
    const noCold = { ...byId("S4"), facilities: { ...byId("S4").facilities, coldStorage: false } };
    expect(checkCompatibility("medical", noCold, { coldChain: true }).code).toBe("NO_COLD_STORAGE");
    expect(checkCompatibility("medical", byId("S6"), { coldChain: true }).ok).toBe(true);
  });

  it("blocks closed shelters", () => {
    const closed = { ...byId("S2"), open: false };
    expect(checkCompatibility("cooked", closed).code).toBe("SHELTER_CLOSED");
  });

  it("allows cooked food at a healthy shelter", () => {
    expect(checkCompatibility("cooked", byId("S1")).ok).toBe(true);
  });
});

describe("seed + rng", () => {
  it("creates a populated quiet city", () => {
    const s = createInitialState();
    expect(s.donors.length).toBeGreaterThanOrEqual(4);
    expect(s.shelters.length).toBeGreaterThanOrEqual(5);
    expect(s.riders.length).toBeGreaterThanOrEqual(8);
    expect(s.shelters.some((x) => !x.facilities.cleanWater)).toBe(true);
    expect(s.shelters.some((x) => !x.facilities.cookingFuel)).toBe(true);
  });

  it("rng is deterministic per seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const g = makeRng(7);
    const xs = Array.from({ length: 4000 }, () => gaussian(g));
    const mean = xs.reduce((p, c) => p + c, 0) / xs.length;
    expect(Math.abs(mean)).toBeLessThan(0.08);
  });
});
