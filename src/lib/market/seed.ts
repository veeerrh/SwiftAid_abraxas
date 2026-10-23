import type { SimState } from "@/lib/domain/types";
import type { Category } from "@/lib/domain/types";
import { createListing, createRequest, donorRespond, placeOrder, setMarketConfig } from "./engine";

/**
 * Pre-loaded demo market: supplies and requests already on the board so judges see a living system
 * without logging in as dozens of accounts. Times are minutes from "now" (sim minute 0 = 19:00).
 */

interface L {
  donor: string;
  category: Category;
  label: string;
  qty: number;
  inMin: number;
  cold?: boolean;
  notes?: string;
}
const LISTINGS: L[] = [
  { donor: "D1", category: "cooked", label: "Veg biryani trays", qty: 120, inMin: 110, notes: "Hot, sealed foil trays" },
  { donor: "D1", category: "cooked", label: "Paneer curry and roti packs", qty: 60, inMin: 85 },
  { donor: "D2", category: "cooked", label: "Hostel mess dinner", qty: 80, inMin: 120 },
  { donor: "D2", category: "raw_ration", label: "Atta, dal and oil ration kits", qty: 60, inMin: 1200 },
  { donor: "D3", category: "medical", label: "Insulin and vaccines", qty: 24, inMin: 240, cold: true, notes: "Keep refrigerated, 2-8 °C" },
  { donor: "D3", category: "medical", label: "Antibiotics and wound dressings", qty: 40, inMin: 900 },
  { donor: "D4", category: "cooked", label: "Caterer surplus: rice and dal", qty: 90, inMin: 75 },
  { donor: "D4", category: "infant_formula", label: "Infant formula tins", qty: 30, inMin: 1000 },
  { donor: "D5", category: "cooked", label: "Aundh hostel khichdi", qty: 50, inMin: 100 },
  { donor: "D5", category: "kit", label: "Hygiene and essentials kits", qty: 45, inMin: 2000 },
];

interface R {
  shelter: string;
  category: Category;
  qty: number;
  priority?: "normal" | "high" | "critical";
  label?: string;
  notes?: string;
}
const REQUESTS: R[] = [
  { shelter: "S1", category: "cooked", qty: 50 },
  { shelter: "S2", category: "cooked", qty: 120, priority: "high", notes: "Flood-displaced families arriving tonight" },
  { shelter: "S3", category: "cooked", qty: 70 },
  { shelter: "S4", category: "medical", qty: 30, priority: "high", label: "Insulin and essential medicines" },
  { shelter: "S5", category: "infant_formula", qty: 20, priority: "critical" },
  { shelter: "S6", category: "cooked", qty: 60 },
  { shelter: "S6", category: "kit", qty: 40 },
];

/** Seed listings and requests into a fresh city. Safe to call once on an empty market. */
export function seedMarket(state: SimState, opts: { withMovingOrders?: boolean } = {}): void {
  for (const l of LISTINGS) {
    createListing(state, {
      donorId: l.donor,
      category: l.category,
      label: l.label,
      qty: l.qty,
      expiresAt: state.clock + l.inMin,
      coldChain: l.cold,
      notes: l.notes,
    });
  }
  for (const r of REQUESTS) {
    createRequest(state, { shelterId: r.shelter, category: r.category, qty: r.qty, priority: r.priority, label: r.label, notes: r.notes });
  }
  if (opts.withMovingOrders) {
    // Two deliveries already under way so the map is alive from the first second.
    const byLabel = (label: string) => state.market.listings.find((x) => x.label === label)!;
    const req = (shelter: string, cat: Category) => state.market.requests.find((x) => x.shelterId === shelter && x.category === cat);
    const a = placeOrder(state, "S1", [{ listingId: byLabel("Hostel mess dinner").id, qty: 50 }], req("S1", "cooked")?.id);
    const b = placeOrder(state, "S6", [{ listingId: byLabel("Aundh hostel khichdi").id, qty: 40 }], req("S6", "cooked")?.id);
    for (const res of [a, b]) if (res.ok) for (const o of res.value) donorRespond(state, o.id, true);
  }
}

/** The configuration used by the v2 world (human riders use the board; auto-pilot fills gaps). */
export function applyMarketWorldConfig(state: SimState) {
  setMarketConfig(state, { boardOnlyForManual: true, autopilot: true });
}
