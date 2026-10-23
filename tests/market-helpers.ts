import { createInitialState } from "@/lib/domain/seed";
import type { SimState } from "@/lib/domain/types";
import { applyMarketWorldConfig, seedMarket } from "@/lib/market/seed";
import { tick } from "@/lib/engine/sim";
import { activeLegs } from "@/lib/engine/sim";
import "@/lib/market/engine"; // registers the engine hooks

export function emptyWorld(): SimState {
  const s = createInitialState();
  applyMarketWorldConfig(s);
  return s;
}

export function seededWorld(opts: { withMovingOrders?: boolean } = {}): SimState {
  const s = emptyWorld();
  seedMarket(s, opts);
  return s;
}

export function run(s: SimState, minutes: number, step = 0.25, each?: (s: SimState) => void) {
  const n = Math.round(minutes / step);
  for (let i = 0; i < n; i++) {
    tick(s, step);
    each?.(s);
  }
}

export const listingBy = (s: SimState, label: string) => s.market.listings.find((l) => l.label === label)!;
export const orderOfListing = (s: SimState, listingId: string) => s.market.orders.filter((o) => o.listingId === listingId);

/** Safety invariants that must hold at every instant. */
export function assertMarketInvariants(s: SimState, where = "") {
  const tag = `${where} t=${s.clock.toFixed(1)}`;
  for (const b of s.batches) {
    const inflight = activeLegs(s).filter((l) => l.batchId === b.id).reduce((n, l) => n + l.qty, 0);
    const sum = b.deliveredQty + b.spoiledQty + b.unplacedQty + inflight;
    if (sum !== b.qty) throw new Error(`${tag}: batch ${b.id} leaks (${sum} != ${b.qty})`);
  }
  for (const l of s.market.listings) {
    if (l.availableQty < 0 || l.availableQty > l.qty) throw new Error(`${tag}: listing ${l.id} availability out of range (${l.availableQty}/${l.qty})`);
  }
  for (const r of s.market.requests) {
    if (r.remainingQty < 0 || r.remainingQty > r.qty) throw new Error(`${tag}: request ${r.id} remaining out of range`);
    if (r.deliveredQty > r.qty + 0.001) throw new Error(`${tag}: request ${r.id} over-delivered`);
  }
  const seen = new Set<string>();
  for (const l of activeLegs(s)) {
    if (seen.has(l.riderId)) throw new Error(`${tag}: rider ${l.riderId} double-booked`);
    seen.add(l.riderId);
  }
  for (const sh of s.shelters) {
    if (sh.capacityRemaining < 0) throw new Error(`${tag}: negative capacity at ${sh.id}`);
  }
  for (const o of s.market.orders) {
    if (o.status === "delivered" && o.deliveredQty <= 0) throw new Error(`${tag}: delivered order ${o.id} has nothing delivered`);
  }
}
