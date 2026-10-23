import { describe, expect, it } from "vitest";
import { createListing, createRequest, placeOrder } from "@/lib/market/engine";
import { eligibleListings } from "@/lib/market/rules";
import { suggestBundles } from "@/lib/market/suggest";
import type { SimState } from "@/lib/domain/types";
import { emptyWorld, seededWorld, listingBy } from "./market-helpers";

const must = <T,>(r: { ok: boolean; value?: T; error?: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value as T;
};

function checkBundle(s: SimState, shelterId: string, b: { lines: { listingId: string; qty: number }[]; covered: number }, need: number) {
  const eligible = new Set(eligibleListings(s, s.shelters.find((x) => x.id === shelterId)!).map((e) => e.listing.id));
  let sum = 0;
  for (const l of b.lines) {
    const listing = s.market.listings.find((x) => x.id === l.listingId)!;
    expect(l.qty).toBeGreaterThan(0);
    expect(l.qty).toBeLessThanOrEqual(listing.availableQty);
    expect(eligible.has(l.listingId)).toBe(true); // never suggests a donor the shelter could not see
    sum += l.qty;
  }
  expect(sum).toBe(b.covered);
  expect(sum).toBeLessThanOrEqual(need);
}

describe("smart bundle suggestions", () => {
  it("covers a large request by combining donors, within stock and never beyond the need", () => {
    const s = seededWorld();
    const rq = must(createRequest(s, { shelterId: "S2", category: "cooked", qty: 190 })); // larger than any one donor's stock
    const sug = suggestBundles(s, "S2", { requestId: rq.id });
    expect(sug.reason).toBeUndefined();
    expect(sug.candidates).toBeGreaterThanOrEqual(3);
    const top = sug.bundles[0];
    expect(top.covered).toBe(190);
    expect(top.shortfall).toBe(0);
    expect(top.donors).toBeGreaterThanOrEqual(2);
    for (const b of sug.bundles) checkBundle(s, "S2", b, 190);

    // When one donor can cover it alone, the recommendation does not invent extra pickups.
    const small = s.market.requests.find((r) => r.shelterId === "S2" && r.priority === "high")!;
    const one = suggestBundles(s, "S2", { requestId: small.id });
    expect(one.bundles[0].covered).toBe(120);
    expect(one.bundles.find((b) => b.profile === "fewest")?.donors ?? 1).toBe(1);
  });

  it("never suggests a donor that is outside the reachable zone or incompatible", () => {
    const s = seededWorld();
    const rq = s.market.requests.find((r) => r.shelterId === "S5" && r.category === "infant_formula")!;
    const sug = suggestBundles(s, "S5", { requestId: rq.id });
    for (const b of sug.bundles) checkBundle(s, "S5", b, rq.remainingQty);
    // Shelter S4 has no clean water: formula must never be offered to it.
    const none = suggestBundles(s, "S4", { category: "infant_formula", qty: 10 });
    expect(none.bundles).toHaveLength(0);
    expect(none.reason).toBeDefined();
  });

  it("is never worse than the greedy baseline and says why", () => {
    const s = seededWorld();
    const rq = s.market.requests.find((r) => r.shelterId === "S2" && r.category === "cooked")!;
    const sug = suggestBundles(s, "S2", { requestId: rq.id });
    expect(sug.baseline).not.toBeNull();
    expect(sug.bundles[0].score).toBeGreaterThanOrEqual(sug.baseline!.score - 1e-9);
    expect(sug.runs.map((r) => r.name)).toEqual(["greedy", "qiga", "hybrid"]);
    for (const r of sug.runs.filter((x) => x.name !== "greedy")) {
      for (let i = 1; i < r.convergence.length; i++) expect(r.convergence[i]).toBeGreaterThanOrEqual(r.convergence[i - 1] - 1e-9);
    }
    expect(sug.why.length).toBeGreaterThanOrEqual(2);
    expect(sug.why[0]).toMatch(/covers 120 of 120/i);
  });

  it("the 'fewest pickups' alternative never uses more donors than the recommended mix", () => {
    const s = seededWorld();
    const rq = s.market.requests.find((r) => r.shelterId === "S2" && r.category === "cooked")!;
    const sug = suggestBundles(s, "S2", { requestId: rq.id });
    const fewest = sug.bundles.find((b) => b.profile === "fewest");
    const balanced = sug.bundles.find((b) => b.profile === "balanced")!;
    if (fewest) expect(fewest.donors).toBeLessThanOrEqual(balanced.donors);
  });

  it("is deterministic for the same situation", () => {
    const s = seededWorld();
    const rq = s.market.requests.find((r) => r.shelterId === "S2" && r.category === "cooked")!;
    const a = suggestBundles(s, "S2", { requestId: rq.id });
    const b = suggestBundles(s, "S2", { requestId: rq.id });
    expect(a.bundles.map((x) => x.lines.map((l) => `${l.listingId}:${l.qty}`))).toEqual(b.bundles.map((x) => x.lines.map((l) => `${l.listingId}:${l.qty}`)));
  });

  it("reports a shortfall honestly when there is not enough safe stock", () => {
    const s = emptyWorld();
    must(createListing(s, { donorId: "D2", category: "cooked", label: "Small batch", qty: 30, expiresAt: 120 }));
    const rq = must(createRequest(s, { shelterId: "S1", category: "cooked", qty: 100 }));
    const sug = suggestBundles(s, "S1", { requestId: rq.id });
    expect(sug.bundles[0].covered).toBe(30);
    expect(sug.bundles[0].shortfall).toBe(70);
    expect(sug.why[0]).toMatch(/70 short/);
  });

  it("explains an empty result instead of failing", () => {
    const s = emptyWorld();
    const rq = must(createRequest(s, { shelterId: "S1", category: "cooked", qty: 50 }));
    const sug = suggestBundles(s, "S1", { requestId: rq.id });
    expect(sug.bundles).toHaveLength(0);
    expect(sug.reason).toMatch(/no donor/i);
    expect(suggestBundles(s, "S1", { category: "cooked", qty: 0 }).reason).toMatch(/nothing left/i);
  });

  it("respects a needed-by time by dropping donors that would arrive too late", () => {
    const s = seededWorld();
    const loose = suggestBundles(s, "S2", { category: "cooked", qty: 100 });
    const tight = suggestBundles(s, "S2", { category: "cooked", qty: 100, neededBy: s.clock + 22 });
    expect(tight.candidates).toBeLessThanOrEqual(loose.candidates);
    for (const b of tight.bundles) checkBundle(s, "S2", b, 100);
  });

  it("critical requests lead with the freshest and safest bundle", () => {
    const s = seededWorld();
    const rq = s.market.requests.find((r) => r.shelterId === "S5" && r.priority === "critical")!;
    const sug = suggestBundles(s, "S5", { requestId: rq.id });
    if (sug.bundles.length) expect(sug.bundles[0].profile).toBe("freshest");
  });

  it("a suggested bundle can be ordered as-is", () => {
    const s = seededWorld();
    const rq = s.market.requests.find((r) => r.shelterId === "S2" && r.category === "cooked")!;
    const top = suggestBundles(s, "S2", { requestId: rq.id }).bundles[0];
    const orders = must(placeOrder(s, "S2", top.lines.map((l) => ({ listingId: l.listingId, qty: l.qty })), rq.id));
    expect(orders).toHaveLength(top.lines.length);
    expect(rq.remainingQty).toBe(0);
    expect(listingBy(s, "Veg biryani trays").availableQty).toBeLessThanOrEqual(120);
  });

  it("holds across random worlds: always within stock, need and the reachable zone", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = seededWorld();
      s.seed = seed * 7919;
      for (const sh of s.shelters) {
        for (const cat of ["cooked", "kit", "medical", "raw_ration", "infant_formula"] as const) {
          const need = 10 + ((seed * 13 + sh.id.charCodeAt(1)) % 150);
          const sug = suggestBundles(s, sh.id, { category: cat, qty: need });
          for (const b of sug.bundles) checkBundle(s, sh.id, b, need);
          if (sug.bundles[0] && sug.baseline) expect(sug.bundles[0].score).toBeGreaterThanOrEqual(sug.baseline.score - 1e-9);
        }
      }
    }
  }, 120_000);
});
