import { travelMinutes } from "@/lib/domain/geo";
import type { Listing, MarketConfig, NotifyKind, Order, OrderStatus, Priority, RiskState, SupplyRequest } from "@/lib/domain/market";
import { TERMINAL_ORDER } from "@/lib/domain/market";
import { makeRng } from "@/lib/domain/rng";
import { CATEGORY_META, checkCompatibility } from "@/lib/domain/rules";
import { makeBatch } from "@/lib/domain/seed";
import type { Batch, Category, Donor, LatLng, Leg, Rider, Shelter, SimState } from "@/lib/domain/types";
import { analyticSurvival } from "@/lib/engine/feasibility";
import { hooks } from "@/lib/engine/hooks";
import { DROP_HANDLING_MIN, PICKUP_HANDLING_MIN, type Cargo } from "@/lib/engine/problem";
import {
  acceptLeg,
  advanceLeg,
  isActive,
  log,
  makeLeg,
  newId,
  refreshSurvival,
  releaseLeg,
  requestReplan,
} from "@/lib/engine/sim";
import { bufferedDeadline, riderIsFree, tripTiming, reachability, type TripTiming } from "./rules";
import { simLabel } from "./time";

/* ------------------------------------------------------------------ plumbing */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T = never>(error: string): Result<T> => ({ ok: false, error });

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** Deterministic coin flip per (salt, state seed): the demo is reproducible. */
function chance(state: SimState, salt: string, p: number): boolean {
  if (p >= 1) return true;
  if (p <= 0) return false;
  return makeRng(hash(salt) ^ state.seed)() < p;
}

const donorOf = (s: SimState, id: string) => s.donors.find((d) => d.id === id);
const shelterOf = (s: SimState, id: string) => s.shelters.find((d) => d.id === id);
const riderOf = (s: SimState, id: string) => s.riders.find((d) => d.id === id);
const listingOf = (s: SimState, id: string) => s.market.listings.find((l) => l.id === id);
const requestOf = (s: SimState, id: string | null) => (id ? s.market.requests.find((r) => r.id === id) : undefined);
export const orderOf = (s: SimState, id: string) => s.market.orders.find((o) => o.id === id);
const batchOf = (s: SimState, id?: string) => (id ? s.batches.find((b) => b.id === id) : undefined);

export function notify(
  state: SimState,
  to: string[],
  severity: "info" | "success" | "warn" | "critical",
  kind: NotifyKind,
  title: string,
  text: string,
  orderId?: string,
) {
  const n = state.market.notifications;
  n.push({ id: state.nextId++, at: state.clock, to, severity, kind, title, text, orderId });
  if (n.length > 400) n.splice(0, n.length - 400);
}

/* ------------------------------------------------------------------ presence */

type Org = Donor | Shelter;

export function humanPresent(state: SimState, org: Org | undefined): boolean {
  return !!org && org.humanSeenAt !== undefined && state.clock - org.humanSeenAt <= state.market.config.presenceMin;
}

/** A portal heartbeat: someone is at this organisation's screen. */
export function ping(state: SimState, role: "donor" | "shelter" | "rider", id: string) {
  if (role === "donor") {
    const d = donorOf(state, id);
    if (d) d.humanSeenAt = state.clock;
  } else if (role === "shelter") {
    const s = shelterOf(state, id);
    if (s) s.humanSeenAt = state.clock;
  } else {
    const r = riderOf(state, id);
    if (r) {
      r.humanSeenAt = state.clock;
      if (!r.silent) r.lastHeartbeat = state.clock;
      if (!r.manual) r.manual = true;
    }
  }
}

/* ------------------------------------------------------------- registrations */

function nextOrgId(state: SimState, prefix: "D" | "S" | "R", existing: { id: string }[]): string {
  const max = existing.reduce((m, o) => Math.max(m, Number(o.id.slice(1)) || 0), 0);
  return `${prefix}${max + 1}`;
}

export function registerDonor(state: SimState, p: { name: string; area: string; loc: LatLng }): Result<Donor> {
  if (!p.name.trim()) return fail("Name is required");
  const d: Donor = { id: nextOrgId(state, "D", state.donors), name: p.name.trim(), area: p.area.trim() || "Pune", loc: p.loc, auto: true };
  state.donors.push(d);
  log(state, "info", "org_registered", `${d.name} joined as a donor`);
  return ok(d);
}

export function registerShelter(
  state: SimState,
  p: { name: string; area: string; loc: LatLng; capacity: number; accepts?: Category[]; facilities?: Partial<Shelter["facilities"]> },
): Result<Shelter> {
  if (!p.name.trim()) return fail("Name is required");
  const cap = Math.max(5, Math.min(2000, Math.round(p.capacity || 50)));
  const s: Shelter = {
    id: nextOrgId(state, "S", state.shelters),
    name: p.name.trim(),
    area: p.area.trim() || "Pune",
    loc: p.loc,
    capacityRemaining: cap,
    totalCapacity: cap,
    accepts: p.accepts ?? ["cooked", "raw_ration", "kit", "infant_formula"],
    facilities: { cleanWater: true, cookingFuel: true, coldStorage: false, ...p.facilities },
    open: true,
    auto: true,
  };
  state.shelters.push(s);
  log(state, "info", "org_registered", `${s.name} joined as a shelter`, { shelterId: s.id });
  return ok(s);
}

export function registerRider(
  state: SimState,
  p: { name: string; area: string; loc: LatLng; vehicle?: Rider["vehicle"]; coldGear?: boolean },
): Result<Rider> {
  if (!p.name.trim()) return fail("Name is required");
  const vehicle = p.vehicle ?? "scooter";
  const r: Rider = {
    id: nextOrgId(state, "R", state.riders),
    name: p.name.trim(),
    area: p.area.trim() || "Pune",
    loc: p.loc,
    home: p.loc,
    vehicle,
    capacity: vehicle === "van" ? 60 : vehicle === "bike" ? 25 : 40,
    speedKmh: vehicle === "van" ? 22 : vehicle === "bike" ? 21 : 24,
    reliability: 0.9,
    status: "idle",
    lastHeartbeat: state.clock,
    silent: false,
    manual: false,
    coldGear: p.coldGear ?? vehicle === "van",
  };
  state.riders.push(r);
  log(state, "info", "org_registered", `${r.name} joined as a rider`, { riderId: r.id });
  return ok(r);
}

/* ------------------------------------------------------------------ listings */

const MIN_SHELF_MIN = 10;

export function createListing(
  state: SimState,
  p: {
    donorId: string;
    category: Category;
    label: string;
    qty: number;
    expiresAt: number;
    readyAt?: number;
    coldChain?: boolean;
    notes?: string;
    riskFlags?: string[];
  },
): Result<Listing> {
  const donor = donorOf(state, p.donorId);
  if (!donor) return fail("Unknown donor");
  if (!p.label.trim()) return fail("Describe what you are donating");
  if (!Number.isFinite(p.qty) || p.qty < 1 || p.qty > 5000) return fail("Quantity must be between 1 and 5000");
  if (!Number.isFinite(p.expiresAt) || p.expiresAt < state.clock + MIN_SHELF_MIN) {
    return fail(`Expiry must be at least ${MIN_SHELF_MIN} minutes from now: riders need time to collect and deliver`);
  }
  const readyAt = Math.max(state.clock, p.readyAt ?? state.clock);
  if (readyAt > p.expiresAt - 5) return fail("Pickup must be ready before the supplies expire");
  const meta = CATEGORY_META[p.category];
  const l: Listing = {
    id: newId(state, "LS"),
    donorId: donor.id,
    category: p.category,
    label: p.label.trim(),
    unit: meta.unit,
    qty: Math.round(p.qty),
    availableQty: Math.round(p.qty),
    coldChain: !!p.coldChain,
    createdAt: state.clock,
    expiresAt: p.expiresAt,
    readyAt,
    notes: p.notes,
    riskFlags: p.riskFlags,
    status: "available",
  };
  state.market.listings.push(l);
  log(state, "info", "listing_created", `${donor.name} listed ${l.qty} ${l.unit} of ${l.label} (fit until ${simLabel(l.expiresAt)})`);
  return ok(l);
}

/** Donor withdraws supplies. Orders not yet picked up are cancelled and everyone is told. */
export function cancelListing(state: SimState, listingId: string, reason = "Donor withdrew the listing"): Result<Listing> {
  const l = listingOf(state, listingId);
  if (!l) return fail("Unknown listing");
  if (l.status === "cancelled" || l.status === "expired") return fail("Listing is already closed");
  const live = state.market.orders.filter((o) => o.listingId === l.id && !TERMINAL_ORDER.includes(o.status));
  const picked = live.filter((o) => carrying(state, o));
  if (picked.length) return fail("A rider already collected part of this listing; it can no longer be withdrawn");
  l.status = "cancelled";
  for (const o of live) cancelOrder(state, o.id, "donor", reason, { restoreStock: false });
  l.availableQty = 0;
  log(state, "warn", "listing_cancelled", `${donorOf(state, l.donorId)?.name} withdrew ${l.label}`);
  syncMarket(state);
  return ok(l);
}

/* ------------------------------------------------------------------ requests */

export function createRequest(
  state: SimState,
  p: { shelterId: string; category: Category; label?: string; qty: number; neededBy?: number | null; priority?: Priority; notes?: string },
): Result<SupplyRequest> {
  const sh = shelterOf(state, p.shelterId);
  if (!sh) return fail("Unknown shelter");
  if (!Number.isFinite(p.qty) || p.qty < 1 || p.qty > 5000) return fail("Quantity must be between 1 and 5000");
  const compat = checkCompatibility(p.category, { ...sh, open: true });
  if (!compat.ok) return fail(`${sh.name} cannot safely receive this: ${compat.reason}`);
  if (p.neededBy != null && p.neededBy < state.clock + 10) return fail("Needed-by time must be at least 10 minutes away");
  const meta = CATEGORY_META[p.category];
  const r: SupplyRequest = {
    id: newId(state, "RQ"),
    shelterId: sh.id,
    category: p.category,
    label: p.label?.trim() || meta.label,
    unit: meta.unit,
    qty: Math.round(p.qty),
    remainingQty: Math.round(p.qty),
    deliveredQty: 0,
    neededBy: p.neededBy ?? null,
    priority: p.priority ?? "normal",
    notes: p.notes,
    status: "open",
    createdAt: state.clock,
  };
  state.market.requests.push(r);
  log(state, "info", "request_created", `${sh.name} requested ${r.qty} ${r.unit} of ${r.label.toLowerCase()}${r.priority !== "normal" ? ` (${r.priority} priority)` : ""}`, { shelterId: sh.id });
  return ok(r);
}

export function cancelRequest(state: SimState, requestId: string): Result<SupplyRequest> {
  const r = requestOf(state, requestId);
  if (!r) return fail("Unknown request");
  if (r.status === "cancelled" || r.status === "fulfilled") return fail("Request is already closed");
  for (const o of state.market.orders.filter((x) => x.requestId === r.id && !TERMINAL_ORDER.includes(x.status))) {
    if (carrying(state, o)) return fail("A rider is already carrying part of this order");
  }
  for (const o of state.market.orders.filter((x) => x.requestId === r.id && !TERMINAL_ORDER.includes(x.status))) {
    cancelOrder(state, o.id, "shelter", "Shelter cancelled the request");
  }
  r.status = "cancelled";
  syncMarket(state);
  return ok(r);
}

/* -------------------------------------------------------------------- orders */

function carrying(state: SimState, o: Order): boolean {
  return state.legs.some((l) => l.batchId === o.batchId && isActive(l) && l.carrying);
}

export interface OrderLine {
  listingId: string;
  qty: number;
}

/**
 * A shelter confirms an order. Each line becomes a reservation the donor must confirm.
 * Re-checks reachability at this instant so a stale screen cannot place an unsafe order.
 */
export function placeOrder(state: SimState, shelterId: string, lines: OrderLine[], requestId?: string | null): Result<Order[]> {
  const sh = shelterOf(state, shelterId);
  if (!sh) return fail("Unknown shelter");
  if (!sh.open) return fail(`${sh.name} is closed to deliveries`);
  if (!lines.length) return fail("Choose at least one donor");
  const req = requestId ? requestOf(state, requestId) : undefined;
  if (requestId && !req) return fail("Unknown request");
  if (req && req.shelterId !== sh.id) return fail("That request belongs to another shelter");
  if (req && (req.status === "cancelled" || req.status === "expired" || req.status === "fulfilled")) return fail("That request is closed");

  const seen = new Set<string>();
  let total = 0;
  for (const ln of lines) {
    if (seen.has(ln.listingId)) return fail("Each donor can appear once per order");
    seen.add(ln.listingId);
    const l = listingOf(state, ln.listingId);
    if (!l) return fail("A listing in your order no longer exists");
    if (l.status !== "available") return fail(`${l.label} is no longer available`);
    if (!Number.isFinite(ln.qty) || ln.qty < 1) return fail("Quantities must be positive");
    if (ln.qty > l.availableQty) return fail(`Only ${l.availableQty} ${l.unit} of ${l.label} are left`);
    if (req && l.category !== req.category) return fail(`${l.label} is not the category you requested`);
    const reach = reachability(state, l, sh, { neededBy: req?.neededBy });
    if (!reach.ok) return fail(`${l.label}: ${reach.reason}`);
    total += ln.qty;
  }
  if (req && total > req.remainingQty) return fail(`Your request only has ${req.remainingQty} ${req.unit} still to cover`);

  const created: Order[] = [];
  for (const ln of lines) {
    const l = listingOf(state, ln.listingId)!;
    const donor = donorOf(state, l.donorId)!;
    const id = newId(state, "OR");
    const humanDonor = humanPresent(state, donor);
    const cfg = state.market.config;
    const answers = donor.auto !== false && !humanDonor && chance(state, `resp:${id}`, donor.responseRate ?? 1);
    const o: Order = {
      id,
      requestId: req?.id ?? null,
      listingId: l.id,
      donorId: l.donorId,
      shelterId: sh.id,
      category: l.category,
      label: l.label,
      unit: l.unit,
      qty: Math.round(ln.qty),
      status: "pending_donor",
      createdAt: state.clock,
      holdExpiresAt: state.clock + (humanDonor ? cfg.humanHoldMin : cfg.holdMin),
      autoRespondAt: answers ? state.clock + cfg.orgResponseMin : undefined,
      deliveredQty: 0,
      lostQty: 0,
      expiresAt: l.expiresAt,
      bufferedDeadline: bufferedDeadline(l),
      coldChain: l.coldChain,
      priority: req?.priority ?? "normal",
      pickupCode: String(1000 + (hash(`pk:${id}`) % 9000)),
      dropCode: String(1000 + (hash(`dr:${id}`) % 9000)),
      urgency: 0,
      risk: "ok",
      noShows: 0,
    };
    l.availableQty -= o.qty;
    if (l.availableQty <= 0) l.status = "exhausted";
    state.market.orders.push(o);
    created.push(o);
    notify(state, [`donor:${donor.id}`], "info", "reservation", "New reservation request", `${sh.name} would like ${o.qty} ${o.unit} of ${o.label}. Confirm before ${simLabel(o.holdExpiresAt)}.`, o.id);
    log(state, "info", "order_placed", `${sh.name} reserved ${o.qty} ${o.unit} of ${o.label} from ${donor.name}`, { shelterId: sh.id });
  }
  if (req) req.remainingQty = Math.max(0, req.remainingQty - total);
  syncMarket(state);
  return ok(created);
}

/** Donor confirms (accept) or declines a reservation. */
export function donorRespond(state: SimState, orderId: string, accept: boolean, reason?: string): Result<Order> {
  const o = orderOf(state, orderId);
  if (!o) return fail("Unknown order");
  if (o.status !== "pending_donor") return fail("This reservation has already been answered");
  const l = listingOf(state, o.listingId)!;
  const donor = donorOf(state, o.donorId)!;
  const shelter = shelterOf(state, o.shelterId)!;
  if (!accept) {
    releaseStock(state, o);
    o.status = "cancelled";
    o.closedReason = reason?.trim() || "Declined by the donor";
    o.closedAt = state.clock;
    notify(state, [`shelter:${shelter.id}`, "admin"], "warn", "declined", "Donor declined", `${donor.name} declined ${o.qty} ${o.unit} of ${o.label}. Pick another donor to cover the request.`, o.id);
    log(state, "warn", "order_declined", `${donor.name} declined the reservation from ${shelter.name}`);
    syncMarket(state);
    return ok(o);
  }
  if (state.clock >= o.bufferedDeadline) {
    releaseStock(state, o);
    o.status = "cancelled";
    o.closedReason = "Too late: supplies can no longer be delivered safely";
    o.closedAt = state.clock;
    notify(state, [`shelter:${shelter.id}`, `donor:${donor.id}`, "admin"], "warn", "cancelled", "Reservation lapsed", `${o.label} can no longer reach ${shelter.name} before it expires.`, o.id);
    syncMarket(state);
    return fail(o.closedReason);
  }
  o.status = "awaiting_rider";
  o.donorConfirmedAt = state.clock;
  o.boardSince = Math.max(state.clock, l.readyAt);
  const b = makeBatch(newId(state, "B"), {
    donorId: donor.id,
    label: o.label,
    category: o.category,
    qty: o.qty,
    now: state.clock,
    safeMin: Math.max(1, l.expiresAt - state.clock),
    coldChain: o.coldChain,
    notes: l.notes,
    riskFlags: l.riskFlags,
  });
  b.expiresAt = l.expiresAt;
  b.plannedDeadline = o.bufferedDeadline;
  b.orderId = o.id;
  b.dispatch = "board";
  b.allowedShelterIds = [o.shelterId];
  state.batches.push(b);
  o.batchId = b.id;
  notify(state, [`shelter:${shelter.id}`], "success", "confirmed", "Donor confirmed", `${donor.name} confirmed ${o.qty} ${o.unit} of ${o.label}. A rider will be assigned shortly.`, o.id);
  log(state, "success", "order_confirmed", `${donor.name} confirmed ${o.qty} ${o.unit} for ${shelter.name}; trip is on the rider board`, { shelterId: shelter.id, batchId: b.id });
  syncMarket(state);
  return ok(o);
}

/** Return reserved quantity to the listing and the request. */
function releaseStock(state: SimState, o: Order, qty = o.qty - o.deliveredQty - o.lostQty) {
  const l = listingOf(state, o.listingId);
  if (l && qty > 0 && l.status !== "cancelled" && l.status !== "expired" && state.clock < l.expiresAt) {
    l.availableQty += qty;
    if (l.status === "exhausted") l.status = "available";
  }
  // The request recomputes its cover from live orders in syncMarket.
}

/** Cancel an order that has not been collected. Part already delivered is kept. */
export function cancelOrder(
  state: SimState,
  orderId: string,
  by: "shelter" | "donor" | "admin" | "system",
  reason: string,
  opts: { restoreStock?: boolean } = {},
): Result<Order> {
  const o = orderOf(state, orderId);
  if (!o) return fail("Unknown order");
  if (TERMINAL_ORDER.includes(o.status)) return fail("This order is already closed");
  if (carrying(state, o)) return fail("A rider is already carrying this order; it cannot be cancelled");
  const b = batchOf(state, o.batchId);
  let freed = o.qty - o.deliveredQty - o.lostQty;
  if (b) {
    // Riders heading to pick up are stood down; their cargo returns to the unplaced pool.
    for (const leg of state.legs.filter((l) => l.batchId === b.id && isActive(l))) {
      releaseLeg(state, leg, reason, { ghost: false, quiet: true, noCooldown: true, defer: true });
      const r = riderOf(state, leg.riderId);
      if (r) notify(state, [`rider:${r.id}`], "warn", "cancelled", "Trip cancelled", `${o.label} for ${shelterOf(state, o.shelterId)?.name} was cancelled: ${reason}`, o.id);
    }
    freed = b.unplacedQty;
    b.qty -= b.unplacedQty;
    b.unplacedQty = 0;
    b.recovery = [];
    if (b.qty <= 0 || b.deliveredQty + b.spoiledQty === 0) b.cancelled = true;
  }
  if (opts.restoreStock !== false) releaseStock(state, o, freed);
  o.status = o.deliveredQty > 0 ? "partial" : "cancelled";
  o.closedReason = reason;
  o.closedAt = state.clock;
  const who = by === "shelter" ? "the shelter" : by === "donor" ? "the donor" : by === "admin" ? "the control room" : "the system";
  notify(
    state,
    [`shelter:${o.shelterId}`, `donor:${o.donorId}`, "admin"],
    "warn",
    "cancelled",
    "Order cancelled",
    `${o.qty} ${o.unit} of ${o.label} was cancelled by ${who}: ${reason}.`,
    o.id,
  );
  log(state, "warn", "order_cancelled", `Order for ${o.label} cancelled by ${who}: ${reason}`);
  syncMarket(state);
  return ok(o);
}

/* --------------------------------------------------------------- rider board */

export interface TripOffer {
  orderId: string;
  label: string;
  unit: string;
  category: Category;
  coldChain: boolean;
  priority: Priority;
  urgency: 0 | 1 | 2;
  /** Quantity this rider would carry. */
  qty: number;
  remainingQty: number;
  donorId: string;
  shelterId: string;
  pickupLoc: LatLng;
  dropLoc: LatLng;
  /** True when the pickup is a recovery point rather than the donor's door. */
  recovery: boolean;
  rideMin: number;
  legMin: number;
  /** Pessimistic arrival and the deadlines it is judged against. */
  arrivalP90: number;
  bufferedDeadline: number;
  expiresAt: number;
  slackMin: number;
}

/** Where the next unplaced quantity of a batch physically is. */
function cargoSource(state: SimState, b: Batch): { loc: LatLng; qty: number; recoveryIndex: number | null } | null {
  const donor = donorOf(state, b.donorId);
  if (!donor) return null;
  const recov = b.recovery ?? [];
  const recSum = recov.reduce((n, r) => n + r.qty, 0);
  const atDonor = b.unplacedQty - recSum;
  if (atDonor > 0) return { loc: donor.loc, qty: atDonor, recoveryIndex: null };
  const i = recov.findIndex((r) => r.qty > 0);
  return i >= 0 ? { loc: recov[i].loc, qty: recov[i].qty, recoveryIndex: i } : null;
}

export interface OfferCheck {
  offer: TripOffer | null;
  /** Why not (for admin tooling and tests). */
  reason?: string;
}

export function checkTrip(state: SimState, rider: Rider, order: Order, opts: { force?: boolean } = {}): OfferCheck {
  const cfg = state.market.config;
  const b = batchOf(state, order.batchId);
  if (!b || order.status === "pending_donor" || TERMINAL_ORDER.includes(order.status) || b.unplacedQty <= 0) {
    return { offer: null, reason: "Not waiting for a rider" };
  }
  const src = cargoSource(state, b);
  if (!src) return { offer: null, reason: "Nothing left to collect" };
  const listing = listingOf(state, order.listingId);
  const shelter = shelterOf(state, order.shelterId);
  const donor = donorOf(state, order.donorId);
  if (!listing || !shelter || !donor) return { offer: null, reason: "Missing party" };
  if (!riderIsFree(state, rider)) return { offer: null, reason: "Rider is not free" };
  if (!opts.force && state.clock < listing.readyAt - 10) return { offer: null, reason: "Not ready for pickup yet" };
  if (order.coldChain && rider.coldGear === false) return { offer: null, reason: "Needs an insulated box" };
  const comp = checkCompatibility(order.category, shelter, { coldChain: order.coldChain });
  if (!comp.ok) return { offer: null, reason: comp.reason };
  const req = requestOf(state, order.requestId);
  const limit = Math.min(order.bufferedDeadline, req?.neededBy ?? Infinity);
  const t = tripTiming(rider, src.loc, shelter.loc, state.clock, state.trafficFactor, listing.readyAt);
  const maxRide = cfg.maxRideToDonorMin * (order.urgency >= 1 ? 2 : 1);
  if (!opts.force && t.rideMin > maxRide) return { offer: null, reason: `Pickup is ${Math.round(t.rideMin)} min away` };
  if (t.arrivalP90 > limit) return { offer: null, reason: "Could not arrive before the safe deadline" };
  const qty = Math.min(rider.capacity, src.qty);
  return {
    offer: {
      orderId: order.id,
      label: order.label,
      unit: order.unit,
      category: order.category,
      coldChain: order.coldChain,
      priority: order.priority,
      urgency: order.urgency,
      qty,
      remainingQty: b.unplacedQty,
      donorId: donor.id,
      shelterId: shelter.id,
      pickupLoc: src.loc,
      dropLoc: shelter.loc,
      recovery: src.recoveryIndex !== null,
      rideMin: t.rideMin,
      legMin: t.legMin,
      arrivalP90: t.arrivalP90,
      bufferedDeadline: order.bufferedDeadline,
      expiresAt: order.expiresAt,
      slackMin: limit - t.arrivalP90,
    },
  };
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 2, high: 1, normal: 0 };

/** Trips this rider may see right now: only those they could finish before the buffered expiry. */
export function boardFor(state: SimState, riderId: string): TripOffer[] {
  const rider = riderOf(state, riderId);
  if (!rider) return [];
  const out: TripOffer[] = [];
  for (const o of state.market.orders) {
    const c = checkTrip(state, rider, o);
    if (c.offer) out.push(c.offer);
  }
  return out.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.urgency - a.urgency || a.rideMin - b.rideMin);
}

/** A rider claims a trip from the board (or the admin assigns one with force). */
export function acceptTrip(state: SimState, riderId: string, orderId: string, opts: { force?: boolean; qty?: number } = {}): Result<Leg> {
  const rider = riderOf(state, riderId);
  const order = orderOf(state, orderId);
  if (!rider) return fail("Unknown rider");
  if (!order) return fail("Unknown order");
  const check = checkTrip(state, rider, order, { force: opts.force });
  if (!check.offer) return fail(check.reason ?? "This trip is no longer available to you");
  const o = check.offer;
  const b = batchOf(state, order.batchId)!;
  const shelter = shelterOf(state, order.shelterId)!;
  const listing = listingOf(state, order.listingId)!;
  const src = cargoSource(state, b)!;
  const qty = Math.max(1, Math.min(o.qty, opts.qty ?? o.qty));

  const rideMin = travelMinutes(rider.loc, src.loc, { speedKmh: rider.speedKmh, traffic: state.trafficFactor });
  const legMin = travelMinutes(src.loc, shelter.loc, { speedKmh: rider.speedKmh, traffic: state.trafficFactor });
  const pickupMin = Math.max(rideMin, listing.readyAt - state.clock) + PICKUP_HANDLING_MIN;
  const dropMin = legMin + DROP_HANDLING_MIN;
  const cargo: Cargo = {
    id: `${b.id}:${src.recoveryIndex === null ? "d" : `r${src.recoveryIndex}`}`,
    batchId: b.id,
    category: b.category,
    qty,
    loc: src.loc,
    expiresAt: b.plannedDeadline ?? b.expiresAt,
    coldChain: b.coldChain,
    chunk: 1,
  };
  const leg = makeLeg(state, cargo, {
    cargoId: cargo.id,
    riderId: rider.id,
    shelterId: shelter.id,
    qty,
    pickupMin,
    dropMin,
    totalMin: pickupMin + dropMin,
    survival: analyticSurvival(pickupMin + dropMin, order.expiresAt - state.clock, rider.reliability),
  });
  state.legs.push(leg);
  b.unplacedQty -= qty;
  if (src.recoveryIndex !== null && b.recovery) {
    b.recovery = b.recovery.map((r, i) => (i === src.recoveryIndex ? { ...r, qty: r.qty - qty } : r)).filter((r) => r.qty > 0);
  }
  acceptLeg(state, leg.id);
  refreshSurvival(state, leg);
  notify(
    state,
    [`shelter:${shelter.id}`, `donor:${order.donorId}`, "admin"],
    "info",
    "rider_assigned",
    "Rider on the way",
    `${rider.name} will collect ${qty} ${order.unit} of ${order.label}${qty < order.qty ? ` (part of ${order.qty})` : ""}. ETA to ${shelter.name} about ${Math.round(pickupMin + dropMin)} min.`,
    order.id,
  );
  log(state, "info", "trip_claimed", `${rider.name} claimed ${qty} ${order.unit} of ${order.label} for ${shelter.name}${opts.force ? " (assigned by the control room)" : ""}`, {
    riderId: rider.id,
    batchId: b.id,
    shelterId: shelter.id,
  });
  syncMarket(state);
  return ok(leg);
}

/* ---------------------------------------------------------------- handovers */

function legsOfOrder(state: SimState, o: Order) {
  return state.legs.filter((l) => l.batchId === o.batchId);
}

/** Donor taps "handed over", or the rider enters the pickup code. */
export function confirmPickup(state: SimState, orderId: string, by: "donor" | "rider" | "admin", code?: string): Result<number> {
  const o = orderOf(state, orderId);
  if (!o) return fail("Unknown order");
  if (by === "rider" && String(code ?? "").trim() !== o.pickupCode) return fail("That code does not match the donor's handover code");
  const waiting = legsOfOrder(state, o).filter((l) => l.state === "to_pickup" && l.phase === "pickup" && !l.pickupConfirmed && state.clock >= l.phaseStart + l.phaseDuration);
  if (!waiting.length) return fail("No rider is waiting at the pickup yet");
  for (const l of waiting) {
    l.pickupConfirmed = true;
    const r = riderOf(state, l.riderId);
    if (r) advanceLeg(state, l, r);
  }
  syncMarket(state);
  return ok(waiting.length);
}

/** Shelter accepts or rejects a delivery; a rider may also accept by entering the shelter's code. */
export function confirmReceipt(
  state: SimState,
  orderId: string,
  accept: boolean,
  by: "shelter" | "rider" | "admin",
  opts: { reason?: string; code?: string } = {},
): Result<number> {
  const o = orderOf(state, orderId);
  if (!o) return fail("Unknown order");
  if (by === "rider") {
    if (!accept) return fail("Only the shelter can reject a delivery");
    if (String(opts.code ?? "").trim() !== o.dropCode) return fail("That code does not match the shelter's receipt code");
  }
  const waiting = legsOfOrder(state, o).filter((l) => l.receipt === "pending" && isActive(l));
  if (!waiting.length) return fail("No delivery is waiting to be received");
  for (const l of waiting) {
    if (accept) {
      l.receipt = "accepted";
      const r = riderOf(state, l.riderId);
      if (r) advanceLeg(state, l, r);
    } else {
      rejectLeg(state, l, opts.reason?.trim() || "Did not pass the quality check");
    }
  }
  syncMarket(state);
  return ok(waiting.length);
}

function rejectLeg(state: SimState, leg: Leg, reason: string) {
  const b = batchOf(state, leg.batchId)!;
  const o = orderOf(state, leg.orderId ?? "");
  const rider = riderOf(state, leg.riderId);
  leg.receipt = "rejected";
  leg.state = "failed";
  leg.note = `rejected: ${reason}`;
  b.spoiledQty += leg.qty;
  state.metrics.spoiled += leg.qty;
  state.metrics.rejected += leg.qty;
  if (rider) rider.status = rider.silent ? "ghosting" : "idle";
  const sh = shelterOf(state, leg.shelterId);
  notify(
    state,
    [`donor:${b.donorId}`, `rider:${leg.riderId}`, "admin"],
    "warn",
    "rejected",
    "Delivery rejected",
    `${sh?.name} rejected ${leg.qty} ${b.unit} of ${b.label}: ${reason}. Do not redistribute; return or dispose safely.`,
    o?.id,
  );
  log(state, "warn", "delivery_rejected", `${sh?.name} rejected ${leg.qty} ${b.unit} of ${b.label}: ${reason}`, { shelterId: leg.shelterId, batchId: b.id });
}

function dropDuration(state: SimState, leg: Leg, rider: Rider): number {
  const sh = shelterOf(state, leg.shelterId)!;
  return travelMinutes(leg.originLoc, sh.loc, { speedKmh: rider.speedKmh, traffic: state.trafficFactor }) + DROP_HANDLING_MIN;
}

function pickupGate(state: SimState, leg: Leg, rider: Rider): boolean {
  if (!leg.orderId || leg.pickupConfirmed) {
    leg.handoverSince = undefined;
    return true;
  }
  const o = orderOf(state, leg.orderId);
  const donor = o ? donorOf(state, o.donorId) : undefined;
  if (!o || !donor) return true;
  if (leg.handoverSince === undefined) {
    leg.handoverSince = state.clock;
    notify(state, [`donor:${donor.id}`], "info", "picked_up", "Rider has arrived", `${rider.name} is at your door for ${leg.qty} ${o.unit} of ${o.label}. Hand over and confirm (code ${o.pickupCode}).`, o.id);
    log(state, "info", "rider_arrived", `${rider.name} arrived at ${donor.name} and is waiting for the handover`, { riderId: rider.id, batchId: leg.batchId });
  }
  // Waiting at the donor eats into the delivery window: keep the ETA honest.
  leg.dropEta = state.clock + dropDuration(state, leg, rider);
  const waited = state.clock - leg.handoverSince;
  const auto = donor.auto !== false && !humanPresent(state, donor);
  if (auto && waited >= (donor.prepDelayMin ?? 0.5)) {
    leg.pickupConfirmed = true;
    leg.handoverSince = undefined;
    return true;
  }
  if (waited >= state.market.config.pickupWaitCapMin) {
    o.noShows += 1;
    notify(state, [`rider:${rider.id}`, `donor:${donor.id}`, "admin"], "warn", "cancelled", "Donor was not ready", `${donor.name} did not hand over ${o.label} within ${state.market.config.pickupWaitCapMin} minutes.`, o.id);
    log(state, "warn", "donor_no_show", `${donor.name} was not ready; ${rider.name} was released`, { riderId: rider.id });
    releaseLeg(state, leg, "donor not ready", { ghost: false, quiet: true, noCooldown: true });
    if (o.noShows >= 2) cancelOrder(state, o.id, "system", `${donor.name} repeatedly failed to hand over`);
  }
  return false;
}

function dropGate(state: SimState, leg: Leg, rider: Rider): boolean {
  if (!leg.orderId) return true;
  if (leg.receipt === "accepted") {
    leg.handoverSince = undefined;
    return true;
  }
  if (leg.receipt === "rejected") return false;
  const o = orderOf(state, leg.orderId);
  const shelter = shelterOf(state, leg.shelterId);
  if (!o || !shelter) return true;
  if (leg.receipt === undefined) {
    leg.receipt = "pending";
    leg.handoverSince = state.clock;
    notify(state, [`shelter:${shelter.id}`], "info", "delivered", "Delivery has arrived", `${rider.name} brought ${leg.qty} ${o.unit} of ${o.label}. Check it and confirm receipt (code ${o.dropCode}).`, o.id);
    log(state, "info", "rider_at_shelter", `${rider.name} arrived at ${shelter.name} and is waiting for receipt`, { riderId: rider.id, shelterId: shelter.id });
  }
  leg.dropEta = state.clock;
  const waited = state.clock - (leg.handoverSince ?? state.clock);
  const cfg = state.market.config;
  const human = humanPresent(state, shelter);
  const auto = shelter.auto !== false && !human;
  const timeout = auto ? cfg.receiptMin : cfg.humanReceiptMin;
  if (waited < timeout) return false;
  if (auto && !chance(state, `rcpt:${leg.id}`, shelter.receiptRate ?? 1)) return false; // an unresponsive shelter never answers
  const expired = state.clock >= o.expiresAt;
  if (expired) {
    rejectLeg(state, leg, "supplies were past their expiry on arrival");
    return false;
  }
  if (auto && chance(state, `rej:${leg.id}`, shelter.rejectRate ?? 0)) {
    rejectLeg(state, leg, "did not pass the quality check");
    return false;
  }
  leg.receipt = "accepted";
  leg.handoverSince = undefined;
  return true;
}

/* -------------------------------------------------------------------- admin */

export function setMarketConfig(state: SimState, patch: Partial<MarketConfig>) {
  const c = state.market.config;
  const num = (v: unknown, lo: number, hi: number, cur: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : cur);
  if (typeof patch.autopilot === "boolean") c.autopilot = patch.autopilot;
  if (typeof patch.boardOnlyForManual === "boolean") c.boardOnlyForManual = patch.boardOnlyForManual;
  c.boardGraceMin = num(patch.boardGraceMin, 0, 60, c.boardGraceMin);
  c.humanBoardGraceMin = num(patch.humanBoardGraceMin, 0, 120, c.humanBoardGraceMin);
  c.holdMin = num(patch.holdMin, 1, 60, c.holdMin);
  c.humanHoldMin = num(patch.humanHoldMin, 1, 120, c.humanHoldMin);
  c.orgResponseMin = num(patch.orgResponseMin, 0, 30, c.orgResponseMin);
  c.receiptMin = num(patch.receiptMin, 0, 30, c.receiptMin);
  c.humanReceiptMin = num(patch.humanReceiptMin, 1, 120, c.humanReceiptMin);
  c.pickupWaitCapMin = num(patch.pickupWaitCapMin, 1, 60, c.pickupWaitCapMin);
  c.maxRideToDonorMin = num(patch.maxRideToDonorMin, 5, 120, c.maxRideToDonorMin);
  c.urgentAfterMin = num(patch.urgentAfterMin, 1, 120, c.urgentAfterMin);
  c.escalateAfterMin = num(patch.escalateAfterMin, 2, 240, c.escalateAfterMin);
}

/* ------------------------------------------------------------------ the tick */

function humanRiderAvailable(state: SimState): boolean {
  return state.riders.some((r) => r.manual && r.humanSeenAt !== undefined && state.clock - r.humanSeenAt <= state.market.config.presenceMin * 3 && riderIsFree(state, r));
}

function bestCase(state: SimState, o: Order): TripTiming | null {
  const b = batchOf(state, o.batchId);
  const src = b ? cargoSource(state, b) : null;
  const sh = shelterOf(state, o.shelterId);
  const l = listingOf(state, o.listingId);
  if (!src || !sh || !l) return null;
  let best: TripTiming | null = null;
  for (const r of state.riders) {
    if (r.silent || r.status === "offline") continue;
    if (o.coldChain && r.coldGear === false) continue;
    const t = tripTiming(r, src.loc, sh.loc, state.clock, state.trafficFactor, l.readyAt);
    if (!best || t.arrivalP90 < best.arrivalP90) best = t;
  }
  return best;
}

function marketTick(state: SimState): void {
  const cfg = state.market.config;

  // People leave: human-controlled riders with no activity return to auto-pilot.
  for (const r of state.riders) {
    if (r.manual && r.humanSeenAt !== undefined && state.clock - r.humanSeenAt > cfg.presenceMin * 3 && !state.legs.some((l) => l.riderId === r.id && isActive(l))) {
      r.manual = false;
    }
  }

  // Listings expire.
  for (const l of state.market.listings) {
    if ((l.status === "available" || l.status === "exhausted") && state.clock >= l.expiresAt) {
      l.status = "expired";
      l.availableQty = 0;
      log(state, "info", "listing_expired", `${l.label} from ${donorOf(state, l.donorId)?.name} has expired and was removed`);
    }
  }

  // Reservations awaiting the donor.
  for (const o of state.market.orders.filter((x) => x.status === "pending_donor")) {
    const donor = donorOf(state, o.donorId);
    const human = humanPresent(state, donor);
    if (o.autoRespondAt !== undefined && state.clock >= o.autoRespondAt && !human) {
      donorRespond(state, o.id, true);
      continue;
    }
    if (state.clock >= o.holdExpiresAt) {
      releaseStock(state, o);
      o.status = "cancelled";
      o.closedReason = "The donor did not respond in time";
      o.closedAt = state.clock;
      notify(state, [`shelter:${o.shelterId}`, `donor:${o.donorId}`, "admin"], "warn", "hold_expired", "Reservation timed out", `${donor?.name} did not confirm ${o.qty} ${o.unit} of ${o.label}. The stock is back on the market; choose another donor.`, o.id);
      log(state, "warn", "hold_expired", `${donor?.name} did not answer in time; reservation released`);
    }
  }

  // The rider board: escalation, auto-pilot and impossible trips.
  for (const o of state.market.orders.filter((x) => x.batchId && x.status !== "pending_donor" && !TERMINAL_ORDER.includes(x.status))) {
    const b = batchOf(state, o.batchId);
    if (!b || b.unplacedQty <= 0) continue;
    const since = o.boardSince ?? state.clock;
    const waited = state.clock - since;
    if (waited < 0) continue;
    if (o.urgency < 1 && waited >= cfg.urgentAfterMin) {
      o.urgency = 1;
      notify(state, [`shelter:${o.shelterId}`], "warn", "escalation", "Still looking for a rider", `${o.label} has waited ${Math.round(waited)} min. Riders farther away can now see this trip.`, o.id);
      log(state, "warn", "order_urgent", `${o.label} is urgent: no rider has claimed it after ${Math.round(waited)} min`);
    }
    if (o.urgency < 2 && waited >= cfg.escalateAfterMin) {
      o.urgency = 2;
      notify(state, ["admin"], "critical", "escalation", "Trip needs manual assignment", `${o.label} (${b.unplacedQty} ${o.unit}) has no rider after ${Math.round(waited)} min. Assign one from the control room.`, o.id);
      log(state, "critical", "order_escalated", `${o.label} escalated to the control room after ${Math.round(waited)} min without a rider`);
    }
    const bc = bestCase(state, o);
    if (waited >= 3 && (!bc || bc.arrivalP90 > o.bufferedDeadline)) {
      cancelOrder(state, o.id, "system", "no rider could deliver it before the safe deadline");
      continue;
    }
    if (cfg.autopilot && b.dispatch === "board") {
      const grace = humanRiderAvailable(state) ? cfg.humanBoardGraceMin : cfg.boardGraceMin;
      if (waited >= grace) {
        b.dispatch = "auto";
        requestReplan(state, "auto-pilot takes unclaimed trips");
      }
    }
  }

  syncMarket(state);
}

/* ---------------------------------------------------------------------- sync */

const STATUS_TEXT: Partial<Record<OrderStatus, string>> = {
  awaiting_rider: "waiting for a rider",
  rider_assigned: "rider heading to pickup",
  in_transit: "on the way to the shelter",
  awaiting_receipt: "waiting for the shelter to confirm receipt",
};

/** Derive order, request and listing state from the live legs/batches, and raise alerts on transitions. */
export function syncMarket(state: SimState): void {
  const m = state.market;

  for (const o of m.orders) {
    if (TERMINAL_ORDER.includes(o.status) || o.status === "pending_donor") continue;
    const b = batchOf(state, o.batchId);
    if (!b) continue;
    const legs = state.legs.filter((l) => l.batchId === b.id);
    const active = legs.filter(isActive);
    o.deliveredQty = b.deliveredQty;
    o.lostQty = b.spoiledQty;

    // A rider was diverted to a different shelter mid-route.
    const moved = active.find((l) => l.shelterId !== o.shelterId);
    if (moved) {
      const from = shelterOf(state, o.shelterId);
      const to = shelterOf(state, moved.shelterId);
      o.divertedFrom = o.shelterId;
      o.shelterId = moved.shelterId;
      o.requestId = null;
      b.allowedShelterIds = [moved.shelterId];
      notify(state, [`shelter:${from?.id}`, `shelter:${to?.id}`, `donor:${o.donorId}`, "admin"], "warn", "rerouted", "Delivery rerouted", `${o.label} was rerouted from ${from?.name} to ${to?.name} because the original shelter could no longer take it.`, o.id);
    }

    const prev = o.status;
    let next: OrderStatus;
    if (b.cancelled) next = "cancelled";
    else if (b.unplacedQty <= 0 && active.length === 0) {
      if (o.deliveredQty > 0 && o.lostQty === 0) next = "delivered";
      else if (o.deliveredQty > 0) next = "partial";
      else if (legs.some((l) => l.note?.startsWith("rejected"))) next = "rejected";
      else if (state.clock >= o.expiresAt) next = "expired";
      else next = "failed";
    } else if (active.some((l) => l.receipt === "pending")) next = "awaiting_receipt";
    else if (active.some((l) => l.state === "to_drop")) next = "in_transit";
    else if (active.length > 0) next = "rider_assigned";
    else next = "awaiting_rider";
    o.status = next;

    // Expiry risk while goods are moving.
    if (!TERMINAL_ORDER.includes(next) && active.length > 0) {
      const projected = Math.max(...active.map((l) => l.dropEta));
      const risk: RiskState = state.clock >= o.expiresAt || projected > o.expiresAt ? "breached" : projected > o.bufferedDeadline ? "at_risk" : "ok";
      if (risk !== o.risk) {
        const sh = shelterOf(state, o.shelterId);
        const riders = active.map((l) => `rider:${l.riderId}`);
        const to = [`shelter:${o.shelterId}`, `donor:${o.donorId}`, "admin", ...riders];
        if (risk === "at_risk") {
          notify(state, to, "warn", "at_risk", "Delivery running late", `${o.label} for ${sh?.name} is now expected after its safety buffer (${simLabel(o.bufferedDeadline)}). Expiry is ${simLabel(o.expiresAt)}; speed is of the essence.`, o.id);
          log(state, "warn", "expiry_at_risk", `${o.label} is cutting into its safety buffer`, { batchId: b.id });
        } else if (risk === "breached") {
          notify(state, to, "critical", "expiry_breach", "DO NOT DELIVER OR CONSUME", `${o.label} for ${sh?.name} will miss its expiry (${simLabel(o.expiresAt)}). Do not deliver or consume it. Return it to the donor or dispose of it safely.`, o.id);
          log(state, "critical", "expiry_breach", `${o.label} will miss its expiry: do not deliver or consume`, { batchId: b.id });
        }
        o.risk = risk;
      } else if (risk === "ok" && o.risk !== "ok") o.risk = "ok";
    }

    if (next !== prev && TERMINAL_ORDER.includes(next)) {
      o.closedAt = state.clock;
      const sh = shelterOf(state, o.shelterId);
      const riders = legs.map((l) => `rider:${l.riderId}`);
      if (next === "delivered" || next === "partial") {
        o.closedReason = next === "delivered" ? "Delivered" : `Partly delivered (${o.deliveredQty} of ${o.qty})`;
        notify(state, [`shelter:${o.shelterId}`, `donor:${o.donorId}`, "admin"], "success", "delivered", "Delivered", `${o.deliveredQty} ${o.unit} of ${o.label} reached ${sh?.name}.`, o.id);
      } else if (next === "expired") {
        o.closedReason = "Expired before delivery";
        notify(state, [`shelter:${o.shelterId}`, `donor:${o.donorId}`, "admin", ...riders], "critical", "expiry_breach", "DO NOT CONSUME: expired", `${o.label} for ${sh?.name} passed its expiry (${simLabel(o.expiresAt)}) before delivery. Do not consume it.`, o.id);
      } else if (next === "rejected") {
        o.closedReason = "Rejected at the shelter";
      } else if (next === "failed") {
        o.closedReason = "Could not be completed";
        notify(state, [`shelter:${o.shelterId}`, `donor:${o.donorId}`, "admin"], "warn", "cancelled", "Delivery failed", `${o.label} could not be completed. The request is open again.`, o.id);
      }
      // Stock that never left the donor returns to the market only if it can still be used.
    }
  }

  // Requests follow their orders.
  for (const r of m.requests) {
    if (r.status === "cancelled") continue;
    const os = m.orders.filter((o) => o.requestId === r.id);
    r.deliveredQty = os.reduce((n, o) => n + o.deliveredQty, 0);
    const covered = os.reduce((n, o) => {
      if (o.status === "delivered" || o.status === "partial" || o.status === "rejected") return n + o.deliveredQty;
      if (o.status === "cancelled" || o.status === "expired" || o.status === "failed") return n + o.deliveredQty;
      return n + (o.qty - o.lostQty);
    }, 0);
    r.remainingQty = Math.max(0, r.qty - covered);
    const live = os.some((o) => !TERMINAL_ORDER.includes(o.status));
    if (r.deliveredQty >= r.qty) r.status = "fulfilled";
    else if (r.neededBy !== null && state.clock >= r.neededBy && !live) r.status = "expired";
    else if (covered > 0) r.status = "partial";
    else r.status = "open";
  }
}

export function describeStage(status: OrderStatus): string {
  return STATUS_TEXT[status] ?? status.replace(/_/g, " ");
}

/* ------------------------------------------------------------ hook wiring */

hooks.legReleased = (state, leg, reason, ghost) => {
  if (!leg.orderId) return;
  const o = orderOf(state, leg.orderId);
  if (!o) return;
  const shelter = shelterOf(state, o.shelterId);
  if (ghost) {
    notify(state, [`shelter:${o.shelterId}`, "admin"], "warn", "rider_assigned", "Rider went silent", `The rider for ${o.label} stopped responding. The trip is back on the board for another rider.`, o.id);
    return;
  }
  notify(
    state,
    [`rider:${leg.riderId}`],
    "warn",
    "cancelled",
    "Trip withdrawn",
    `Your trip with ${o.label} to ${shelter?.name} was withdrawn: ${reason}. You are free to take another trip.`,
    o.id,
  );
};
hooks.legStranded = (state, leg, why) => {
  if (!leg.orderId) return;
  const o = orderOf(state, leg.orderId);
  if (!o) return;
  const rider = riderOf(state, leg.riderId);
  notify(
    state,
    [`rider:${leg.riderId}`, `shelter:${o.shelterId}`, `donor:${o.donorId}`, "admin"],
    "critical",
    "rerouted",
    "No safe destination reachable",
    `${rider?.name} is carrying ${leg.qty} ${o.unit} of ${o.label} but no shelter can safely take it in time (${why}). Return it to the donor or dispose of it safely; do not distribute it.`,
    o.id,
  );
};
hooks.tick = (state) => marketTick(state);
hooks.pickupGate = pickupGate;
hooks.dropGate = dropGate;
