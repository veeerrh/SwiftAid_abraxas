import { describe, expect, it } from "vitest";
import { makeRng } from "@/lib/domain/rng";
import { TERMINAL_ORDER } from "@/lib/domain/market";
import type { SimState } from "@/lib/domain/types";
import {
  acceptTrip,
  boardFor,
  cancelListing,
  cancelOrder,
  confirmPickup,
  confirmReceipt,
  createListing,
  createRequest,
  donorRespond,
  ping,
  placeOrder,
  setMarketConfig,
} from "@/lib/market/engine";
import { eligibleListings } from "@/lib/market/rules";
import { closeShelter, ghostRider, tick, trafficJam, unghostRider } from "@/lib/engine/sim";
import { assertMarketInvariants, seededWorld } from "./market-helpers";

/** Random operations from every party; safety invariants are checked after every step. */
function fuzz(seed: number, steps: number): SimState {
  const rng = makeRng(seed);
  const s = seededWorld({ withMovingOrders: true });
  s.labCompare = false;
  s.algo = seed % 2 ? "greedy" : "hybrid";
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const humans = new Set<string>();

  for (let i = 0; i < steps; i++) {
    const roll = rng();
    if (roll < 0.2) {
      const sh = pick(s.shelters);
      const reqs = s.market.requests.filter((r) => r.shelterId === sh.id && (r.status === "open" || r.status === "partial") && r.remainingQty > 0);
      const req = reqs.length ? pick(reqs) : undefined;
      const options = eligibleListings(s, sh, { category: req?.category });
      if (options.length) {
        const o = pick(options);
        const max = Math.min(o.listing.availableQty, req?.remainingQty ?? o.listing.availableQty);
        placeOrder(s, sh.id, [{ listingId: o.listing.id, qty: Math.max(1, Math.floor(rng() * max)) }], req?.id);
      }
    } else if (roll < 0.28) {
      const pend = s.market.orders.filter((o) => o.status === "pending_donor");
      if (pend.length) donorRespond(s, pick(pend).id, rng() < 0.8);
    } else if (roll < 0.36) {
      const r = pick(s.riders);
      ping(s, "rider", r.id);
      humans.add(`rider:${r.id}`);
      const trips = boardFor(s, r.id);
      if (trips.length) acceptTrip(s, r.id, pick(trips).orderId);
    } else if (roll < 0.42) ghostRider(s, pick(s.riders).id);
    else if (roll < 0.46) unghostRider(s, pick(s.riders).id);
    else if (roll < 0.5) closeShelter(s, pick(s.shelters).id);
    else if (roll < 0.54) trafficJam(s, 1.5 + rng() * 4, 5 + Math.floor(rng() * 20));
    else if (roll < 0.58) {
      const live = s.market.orders.filter((o) => !TERMINAL_ORDER.includes(o.status));
      if (live.length) cancelOrder(s, pick(live).id, "shelter", "fuzz");
    } else if (roll < 0.6) {
      const ls = s.market.listings.filter((l) => l.status === "available");
      if (ls.length) cancelListing(s, pick(ls).id);
    } else if (roll < 0.66) {
      const d = pick(s.donors);
      ping(s, "donor", d.id);
      humans.add(`donor:${d.id}`);
      const o = s.market.orders.find((x) => x.donorId === d.id && x.status === "awaiting_rider");
      if (o) confirmPickup(s, o.id, "donor");
    } else if (roll < 0.72) {
      const sh = pick(s.shelters);
      ping(s, "shelter", sh.id);
      humans.add(`shelter:${sh.id}`);
      const o = s.market.orders.find((x) => x.shelterId === sh.id && x.status === "awaiting_receipt");
      if (o) confirmReceipt(s, o.id, rng() < 0.7, "shelter", { reason: "fuzz" });
    } else if (roll < 0.76) {
      setMarketConfig(s, { autopilot: rng() < 0.7 });
    } else if (roll < 0.84) {
      const sh = pick(s.shelters);
      createRequest(s, { shelterId: sh.id, category: pick(["cooked", "kit"] as const), qty: 10 + Math.floor(rng() * 60), priority: pick(["normal", "high", "critical"] as const) });
    } else if (roll < 0.9) {
      const d = pick(s.donors);
      createListing(s, { donorId: d.id, category: pick(["cooked", "kit", "raw_ration", "medical"] as const), label: "Fuzz supplies", qty: 10 + Math.floor(rng() * 80), expiresAt: s.clock + 20 + Math.floor(rng() * 200), coldChain: rng() < 0.2 });
    }
    // Time passes, humans linger a little.
    const dt = 0.25 + rng() * 2.5;
    let left = dt;
    while (left > 1e-9) {
      const d = Math.min(0.25, left);
      tick(s, d);
      left -= d;
    }
    assertMarketInvariants(s, `seed ${seed} step ${i}`);
  }
  return s;
}

describe("market fuzz", () => {
  for (const seed of [1, 2, 3, 5, 8, 13]) {
    it(`seed ${seed}: invariants hold and everything resolves`, () => {
      const s = fuzz(seed, 80);
      // Stop all human activity and let time pass: every order must reach a final state.
      setMarketConfig(s, { autopilot: true, boardOnlyForManual: false });
      for (let i = 0; i < 900; i++) {
        tick(s, 3);
        if (i % 100 === 0) assertMarketInvariants(s, `seed ${seed} drain ${i}`);
      }
      for (const r of s.riders) r.silent = false;
      const stuck = s.market.orders.filter((o) => !TERMINAL_ORDER.includes(o.status));
      expect(stuck.map((o) => `${o.id}:${o.status}`), `seed ${seed}`).toEqual([]);
      for (const b of s.batches) expect(b.deliveredQty + b.spoiledQty + b.unplacedQty, `batch ${b.id}`).toBe(b.qty);
    }, 120_000);
  }
});
