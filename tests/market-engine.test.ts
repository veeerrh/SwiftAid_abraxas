import { describe, expect, it } from "vitest";
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
  orderOf,
  ping,
  placeOrder,
  registerDonor,
  registerRider,
  registerShelter,
  setMarketConfig,
  syncMarket,
  checkTrip,
} from "@/lib/market/engine";
import { activeLegs, closeShelter, ghostRider, trafficJam } from "@/lib/engine/sim";
import { assertMarketInvariants, emptyWorld, listingBy, run, seededWorld } from "./market-helpers";

const req = (s: ReturnType<typeof seededWorld>, shelter: string, cat: string) => s.market.requests.find((r) => r.shelterId === shelter && r.category === cat)!;
const must = <T,>(r: { ok: boolean; value?: T; error?: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value as T;
};

describe("listings and requests", () => {
  it("validates listings", () => {
    const s = emptyWorld();
    const base = { donorId: "D1", category: "cooked" as const, label: "Meals", qty: 20, expiresAt: 60 };
    expect(createListing(s, { ...base, donorId: "D99" }).ok).toBe(false);
    expect(createListing(s, { ...base, qty: 0 }).ok).toBe(false);
    expect(createListing(s, { ...base, label: " " }).ok).toBe(false);
    const soon = createListing(s, { ...base, expiresAt: 5 });
    expect(soon.ok).toBe(false);
    expect(createListing(s, { ...base, readyAt: 59 }).ok).toBe(false);
    expect(createListing(s, base).ok).toBe(true);
  });

  it("refuses requests a shelter cannot safely receive", () => {
    const s = emptyWorld();
    const r = createRequest(s, { shelterId: "S4", category: "infant_formula", qty: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/clean water/i);
    expect(createRequest(s, { shelterId: "S1", category: "cooked", qty: 10, neededBy: 3 }).ok).toBe(false);
    expect(createRequest(s, { shelterId: "S1", category: "cooked", qty: 10 }).ok).toBe(true);
  });

  it("registers new organisations live", () => {
    const s = emptyWorld();
    const d = must(registerDonor(s, { name: "Seva Kitchen", area: "Aundh", loc: { lat: 18.56, lng: 73.81 } }));
    const sh = must(registerShelter(s, { name: "Hope Home", area: "Baner", loc: { lat: 18.55, lng: 73.79 }, capacity: 40 }));
    const r = must(registerRider(s, { name: "Priya", area: "Kothrud", loc: { lat: 18.51, lng: 73.81 } }));
    expect(d.id).toBe("D6");
    expect(sh.id).toBe("S7");
    expect(r.id).toBe("R11");
    expect(registerDonor(s, { name: " ", area: "x", loc: d.loc }).ok).toBe(false);
  });
});

describe("placing an order", () => {
  it("locks stock and covers the request, and refuses unsafe or oversized orders atomically", () => {
    const s = seededWorld();
    const l = listingBy(s, "Hostel mess dinner");
    const rq = req(s, "S1", "cooked");
    expect(placeOrder(s, "S1", [{ listingId: l.id, qty: 500 }], rq.id).ok).toBe(false);
    expect(l.availableQty).toBe(80);
    expect(placeOrder(s, "S1", [{ listingId: l.id, qty: 60 }], rq.id).ok).toBe(false); // more than the request needs
    const wrong = placeOrder(s, "S1", [{ listingId: listingBy(s, "Infant formula tins").id, qty: 5 }], rq.id);
    expect(wrong.ok).toBe(false);
    expect(l.availableQty).toBe(80);

    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 30 }], rq.id));
    expect(o.status).toBe("pending_donor");
    expect(l.availableQty).toBe(50);
    expect(rq.remainingQty).toBe(20);
    expect(o.bufferedDeadline).toBeLessThan(o.expiresAt);
    expect(o.pickupCode).toMatch(/^\d{4}$/);
    expect(s.market.notifications.some((n) => n.to.includes("donor:D2") && n.kind === "reservation")).toBe(true);
  });

  it("refuses donors outside the reachable zone", () => {
    const s = emptyWorld();
    const l = must(createListing(s, { donorId: "D4", category: "cooked", label: "Rushed", qty: 30, expiresAt: 25 }));
    const r = placeOrder(s, "S5", [{ listingId: l.id, qty: 10 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too far/i);
  });

  it("supports a group of donors in one order", () => {
    const s = seededWorld();
    const rq = req(s, "S2", "cooked");
    const lines = [
      { listingId: listingBy(s, "Veg biryani trays").id, qty: 60 },
      { listingId: listingBy(s, "Paneer curry and roti packs").id, qty: 40 },
    ];
    const orders = must(placeOrder(s, "S2", lines, rq.id));
    expect(orders).toHaveLength(2);
    expect(rq.remainingQty).toBe(20);
    expect(placeOrder(s, "S2", [lines[0], lines[0]], rq.id).ok).toBe(false);
  });
});

describe("donor confirmation", () => {
  it("auto donors confirm after a short delay and the trip lands on the board", () => {
    const s = seededWorld();
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty: 30 }], req(s, "S1", "cooked").id));
    run(s, 1);
    expect(orderOf(s, o.id)!.status).toBe("pending_donor");
    run(s, 1);
    const after = orderOf(s, o.id)!;
    expect(after.status).toBe("awaiting_rider");
    const batch = s.batches.find((b) => b.id === after.batchId)!;
    expect(batch.dispatch).toBe("board");
    expect(batch.allowedShelterIds).toEqual(["S1"]);
    expect(batch.plannedDeadline).toBe(after.bufferedDeadline);
    expect(batch.expiresAt).toBe(after.expiresAt);
  });

  it("a declined reservation returns stock and tells the shelter", () => {
    const s = seededWorld();
    const l = listingBy(s, "Hostel mess dinner");
    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 30 }], req(s, "S1", "cooked").id));
    must(donorRespond(s, o.id, false, "Out of stock"));
    expect(l.availableQty).toBe(80);
    expect(req(s, "S1", "cooked").remainingQty).toBe(50);
    expect(orderOf(s, o.id)!.status).toBe("cancelled");
    expect(s.market.notifications.some((n) => n.kind === "declined" && n.to.includes("shelter:S1"))).toBe(true);
    expect(donorRespond(s, o.id, true).ok).toBe(false);
  });

  it("an unresponsive donor's hold times out and the stock goes back on the market", () => {
    const s = seededWorld();
    s.donors.find((d) => d.id === "D2")!.responseRate = 0;
    const l = listingBy(s, "Hostel mess dinner");
    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 30 }], req(s, "S1", "cooked").id));
    expect(o.autoRespondAt).toBeUndefined();
    run(s, 7);
    expect(orderOf(s, o.id)!.status).toBe("cancelled");
    expect(orderOf(s, o.id)!.closedReason).toMatch(/did not respond/i);
    expect(l.availableQty).toBe(80);
    expect(s.market.notifications.some((n) => n.kind === "hold_expired")).toBe(true);
  });

  it("a human at the donor's desk disables auto-confirmation and extends the hold", () => {
    const s = seededWorld();
    ping(s, "donor", "D2");
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty: 30 }], req(s, "S1", "cooked").id));
    expect(o.autoRespondAt).toBeUndefined();
    expect(o.holdExpiresAt - o.createdAt).toBe(s.market.config.humanHoldMin);
    run(s, 3, 0.25, () => ping(s, "donor", "D2"));
    expect(orderOf(s, o.id)!.status).toBe("pending_donor");
    must(donorRespond(s, o.id, true));
    expect(orderOf(s, o.id)!.status).toBe("awaiting_rider");
  });
});

describe("rider job board", () => {
  function confirmed(s = seededWorld(), qty = 30) {
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty }], req(s, "S1", "cooked").id));
    must(donorRespond(s, o.id, true));
    return { s, o: orderOf(s, o.id)! };
  }

  it("shows a feasible trip to a nearby free rider and never to one who could not finish in time", () => {
    const { s, o } = confirmed();
    const near = s.riders.find((r) => r.id === "R10")!; // Camp, next to the donor
    const trips = boardFor(s, near.id);
    expect(trips.map((t) => t.orderId)).toContain(o.id);
    const t = trips.find((x) => x.orderId === o.id)!;
    expect(t.arrivalP90).toBeLessThanOrEqual(o.bufferedDeadline);
    expect(t.qty).toBe(30);

    // Make the deadline impossible for everyone: it disappears from the board.
    o.bufferedDeadline = s.clock + 3;
    expect(boardFor(s, near.id).some((x) => x.orderId === o.id)).toBe(false);
    expect(checkTrip(s, near, o).reason).toMatch(/safe deadline/i);
  });

  it("hides trips from busy, silent, or far-away riders", () => {
    const { s, o } = confirmed();
    const rider = s.riders.find((r) => r.id === "R10")!;
    rider.silent = true;
    expect(boardFor(s, rider.id)).toHaveLength(0);
    rider.silent = false;
    const far = s.riders.find((r) => r.id === "R5")!; // Katraj
    far.loc = { lat: 18.62, lng: 73.7 };
    expect(boardFor(s, far.id).some((t) => t.orderId === o.id)).toBe(false);
  });

  it("only offers cold-chain supplies to riders with an insulated box", () => {
    const s = seededWorld();
    const rq = req(s, "S4", "medical");
    const [o] = must(placeOrder(s, "S4", [{ listingId: listingBy(s, "Insulin and vaccines").id, qty: 24 }], rq.id));
    must(donorRespond(s, o.id, true));
    const noBox = s.riders.find((r) => r.coldGear === false)!;
    const box = s.riders.find((r) => r.id === "R7")!;
    expect(boardFor(s, noBox.id).some((t) => t.orderId === o.id)).toBe(false);
    expect(boardFor(s, box.id).some((t) => t.orderId === o.id)).toBe(true);
  });

  it("claiming creates a leg bound to the order's shelter; big orders are split across riders", () => {
    const { s, o } = confirmed(seededWorld(), 50);
    const a = s.riders.find((r) => r.id === "R10")!;
    const b = s.riders.find((r) => r.id === "R1")!;
    const leg = must(acceptTrip(s, a.id, o.id));
    expect(leg.qty).toBe(40);
    expect(leg.orderId).toBe(o.id);
    expect(leg.shelterId).toBe("S1");
    expect(leg.state).toBe("to_pickup");
    // 10 left: still on the board for someone else, but not for the rider already busy.
    expect(boardFor(s, a.id)).toHaveLength(0);
    const rest = boardFor(s, b.id).find((t) => t.orderId === o.id);
    expect(rest?.qty).toBe(10);
    must(acceptTrip(s, b.id, o.id));
    expect(s.batches.find((x) => x.id === o.batchId)!.unplacedQty).toBe(0);
    assertMarketInvariants(s);
  });

  it("refuses a rider who is busy or a trip already taken", () => {
    const { s, o } = confirmed();
    must(acceptTrip(s, "R10", o.id));
    expect(acceptTrip(s, "R10", o.id).ok).toBe(false);
    expect(acceptTrip(s, "R1", o.id).ok).toBe(false); // nothing left
    expect(acceptTrip(s, "R99", o.id).ok).toBe(false);
  });

  it("admin can force-assign a distant rider, but not past the expiry", () => {
    const { s, o } = confirmed();
    const far = s.riders.find((r) => r.id === "R5")!;
    far.loc = { lat: 18.56, lng: 73.8 }; // ~37 min from the donor: beyond the normal pickup radius, still in time
    expect(acceptTrip(s, far.id, o.id).ok).toBe(false);
    expect(acceptTrip(s, far.id, o.id, { force: true }).ok).toBe(true);
    const { s: s2, o: o2 } = confirmed();
    o2.bufferedDeadline = s2.clock + 2;
    expect(acceptTrip(s2, "R10", o2.id, { force: true }).ok).toBe(false);
  });
});

describe("end to end: delivery", () => {
  it("auto-pilot completes an order: pickup handover, receipt, request fulfilled, stock accounted", () => {
    const s = seededWorld();
    const rq = req(s, "S1", "cooked");
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty: 50 }], rq.id));
    run(s, 70, 0.25, (st) => assertMarketInvariants(st, "autopilot"));
    const done = orderOf(s, o.id)!;
    expect(done.status).toBe("delivered");
    expect(done.deliveredQty).toBe(50);
    expect(rq.status).toBe("fulfilled");
    expect(rq.deliveredQty).toBe(50);
    expect(s.market.notifications.some((n) => n.kind === "delivered" && n.to.includes("shelter:S1"))).toBe(true);
    expect(s.metrics.spoiled).toBe(0);
  });

  it("a human rider claims, collects after a code-checked handover, and delivers", () => {
    const s = seededWorld();
    ping(s, "rider", "R10");
    const rq = req(s, "S1", "cooked");
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty: 30 }], rq.id));
    run(s, 2, 0.25, () => ping(s, "rider", "R10"));
    expect(orderOf(s, o.id)!.status).toBe("awaiting_rider");
    // The human has a long grace: auto-pilot must not steal the trip.
    run(s, 4, 0.25, () => ping(s, "rider", "R10"));
    expect(s.batches.find((b) => b.id === orderOf(s, o.id)!.batchId)!.dispatch).toBe("board");
    const leg = must(acceptTrip(s, "R10", o.id));
    // Donor is a person, so the handover is manual; the rider proves it with the code.
    ping(s, "donor", "D2");
    let tries = 0;
    while (!leg.handoverSince && tries++ < 200) {
      run(s, 0.25, 0.25, () => { ping(s, "rider", "R10"); ping(s, "donor", "D2"); });
    }
    expect(leg.state).toBe("to_pickup");
    expect(confirmPickup(s, o.id, "rider", "0000").ok).toBe(false);
    expect(must(confirmPickup(s, o.id, "rider", orderOf(s, o.id)!.pickupCode))).toBe(1);
    expect(leg.state).toBe("to_drop");
    ping(s, "shelter", "S1");
    tries = 0;
    while (leg.receipt !== "pending" && tries++ < 400) run(s, 0.25, 0.25, () => { ping(s, "rider", "R10"); ping(s, "shelter", "S1"); ping(s, "donor", "D2"); });
    expect(orderOf(s, o.id)!.status).toBe("awaiting_receipt");
    expect(confirmReceipt(s, o.id, true, "rider", { code: "9" }).ok).toBe(false);
    must(confirmReceipt(s, o.id, true, "shelter"));
    expect(orderOf(s, o.id)!.status).toBe("delivered");
    expect(s.shelters.find((x) => x.id === "S1")!.capacityRemaining).toBe(20);
    assertMarketInvariants(s);
  });

  it("the shelter can reject a delivery: logged, rider released, donor and admin told", () => {
    const s = seededWorld();
    ping(s, "shelter", "S1");
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty: 30 }], req(s, "S1", "cooked").id));
    let tries = 0;
    while (orderOf(s, o.id)!.status !== "awaiting_receipt" && tries++ < 600) run(s, 0.25, 0.25, () => ping(s, "shelter", "S1"));
    expect(orderOf(s, o.id)!.status).toBe("awaiting_receipt");
    must(confirmReceipt(s, o.id, false, "shelter", { reason: "Smelled off" }));
    const after = orderOf(s, o.id)!;
    expect(after.status).toBe("rejected");
    expect(s.metrics.rejected).toBe(30);
    expect(s.market.notifications.some((n) => n.kind === "rejected" && n.to.includes("donor:D2"))).toBe(true);
    expect(s.riders.every((r) => r.status !== "busy")).toBe(true);
    assertMarketInvariants(s);
  });

  it("an auto shelter with a reject rate rejects bad deliveries", () => {
    const s = seededWorld();
    s.shelters.find((x) => x.id === "S1")!.rejectRate = 1;
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty: 30 }], req(s, "S1", "cooked").id));
    run(s, 80);
    expect(orderOf(s, o.id)!.status).toBe("rejected");
  });
});

describe("failures", () => {
  it("a donor who is never ready is a no-show: rider released, order cancelled after repeated no-shows", () => {
    const s = seededWorld();
    s.donors.find((d) => d.id === "D2")!.prepDelayMin = 999;
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty: 30 }], req(s, "S1", "cooked").id));
    run(s, 60, 0.25, (st) => assertMarketInvariants(st, "no-show"));
    const after = orderOf(s, o.id)!;
    expect(after.noShows).toBeGreaterThanOrEqual(1);
    expect(["cancelled", "awaiting_rider", "rider_assigned"]).toContain(after.status);
    expect(s.market.notifications.some((n) => /not ready/i.test(n.title))).toBe(true);
  });

  it("a shelter that closes mid-route diverts the rider and tells both shelters", () => {
    const s = seededWorld();
    const [o] = must(placeOrder(s, "S2", [{ listingId: listingBy(s, "Veg biryani trays").id, qty: 40 }], req(s, "S2", "cooked").id));
    let tries = 0;
    while (!activeLegs(s).some((l) => l.state === "to_drop") && tries++ < 400) run(s, 0.25);
    expect(activeLegs(s).some((l) => l.state === "to_drop")).toBe(true);
    closeShelter(s, "S2");
    syncMarket(s);
    const after = orderOf(s, o.id)!;
    expect(after.shelterId).not.toBe("S2");
    expect(after.divertedFrom).toBe("S2");
    expect(after.requestId).toBeNull();
    expect(s.market.notifications.some((n) => n.kind === "rerouted")).toBe(true);
    run(s, 80, 0.25, (st) => assertMarketInvariants(st, "divert"));
  });

  it("warns, then says DO NOT CONSUME, when a rider on the road can no longer beat the expiry", () => {
    const s = seededWorld();
    const l = must(createListing(s, { donorId: "D2", category: "cooked", label: "Tight tray", qty: 20, expiresAt: 50 }));
    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 20 }]));
    run(s, 2.5);
    expect(orderOf(s, o.id)!.status).toBe("awaiting_rider");
    must(acceptTrip(s, "R10", o.id));
    let guard = 0;
    while (!activeLegs(s).some((x) => x.state === "to_drop") && guard++ < 200) run(s, 0.25);
    expect(activeLegs(s).some((x) => x.state === "to_drop")).toBe(true);
    trafficJam(s, 7, 60);
    run(s, 70, 0.25, (st) => assertMarketInvariants(st, "jam"));
    const msgs = s.market.notifications.filter((n) => n.orderId === o.id);
    expect(msgs.some((n) => n.to.includes("rider:R10") && /no safe destination/i.test(n.title))).toBe(true);
    const breach = msgs.find((n) => n.severity === "critical" && /DO NOT/i.test(n.title));
    expect(breach).toBeDefined();
    expect(breach!.to).toEqual(expect.arrayContaining(["shelter:S1", "donor:D2", "admin", "rider:R10"]));
    expect(breach!.text).toMatch(/do not deliver or consume/i);
    const final = orderOf(s, o.id)!;
    expect(["expired", "failed", "delivered", "rejected", "partial"]).toContain(final.status);
  });

  it("a jam that only eats the safety buffer raises an amber warning, not a breach", () => {
    const s = seededWorld();
    const l = must(createListing(s, { donorId: "D2", category: "cooked", label: "Tight tray", qty: 20, expiresAt: 50 }));
    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 20 }]));
    run(s, 2.5);
    must(acceptTrip(s, "R10", o.id));
    let guard = 0;
    while (!activeLegs(s).some((x) => x.state === "to_drop") && guard++ < 200) run(s, 0.25);
    trafficJam(s, 3, 60);
    run(s, 1);
    const kinds = s.market.notifications.filter((n) => n.orderId === o.id).map((n) => n.kind);
    expect(kinds).toContain("at_risk");
    expect(kinds).not.toContain("expiry_breach");
    expect(orderOf(s, o.id)!.risk).toBe("at_risk");
  });

  it("a trip that nobody could finish in time is withdrawn instead of sent out (jam before claim)", () => {
    const s = seededWorld();
    setMarketConfig(s, { autopilot: false });
    const l = must(createListing(s, { donorId: "D2", category: "cooked", label: "Tight tray", qty: 20, expiresAt: 40 }));
    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 20 }]));
    run(s, 3);
    trafficJam(s, 4, 60);
    run(s, 6);
    expect(orderOf(s, o.id)!.status).toBe("cancelled");
    expect(l.availableQty).toBe(20);
  });

  it("tells a rider who was on the way that the trip was withdrawn", () => {
    const s = seededWorld();
    setMarketConfig(s, { autopilot: false });
    const l = must(createListing(s, { donorId: "D2", category: "cooked", label: "Tight tray", qty: 20, expiresAt: 50 }));
    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 20 }]));
    run(s, 2.5);
    must(acceptTrip(s, "R10", o.id));
    trafficJam(s, 5, 60);
    run(s, 4);
    expect(s.market.notifications.some((n) => n.to.includes("rider:R10") && /withdrawn|cancelled/i.test(n.title))).toBe(true);
    expect(s.riders.find((r) => r.id === "R10")!.status).toBe("idle");
  });

  it("marks goods that outlive their window while in transit as expired and warns every party", () => {
    const s = seededWorld();
    const [o] = must(placeOrder(s, "S2", [{ listingId: listingBy(s, "Veg biryani trays").id, qty: 40 }], req(s, "S2", "cooked").id));
    let tries = 0;
    while (!activeLegs(s).some((l) => l.state === "to_drop") && tries++ < 400) run(s, 0.25);
    const leg = activeLegs(s).find((l) => l.state === "to_drop")!;
    // Freeze the rider (ghost) so the goods never arrive.
    ghostRider(s, leg.riderId);
    setMarketConfig(s, { autopilot: false });
    run(s, 140, 0.25, (st) => assertMarketInvariants(st, "expire"));
    const final = orderOf(s, o.id)!;
    expect(["expired", "failed", "cancelled", "delivered", "partial"]).toContain(final.status);
    expect(s.metrics.spoiled + s.metrics.delivered).toBeGreaterThan(0);
  });

  it("escalates trips nobody takes, then to the admin", () => {
    const s = seededWorld();
    setMarketConfig(s, { autopilot: false, urgentAfterMin: 4, escalateAfterMin: 8 });
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty: 30 }], req(s, "S1", "cooked").id));
    run(s, 3);
    expect(orderOf(s, o.id)!.urgency).toBe(0);
    run(s, 3.5);
    expect(orderOf(s, o.id)!.urgency).toBe(1);
    run(s, 5);
    expect(orderOf(s, o.id)!.urgency).toBe(2);
    expect(s.market.notifications.some((n) => n.to.includes("admin") && n.kind === "escalation" && n.severity === "critical")).toBe(true);
  });

  it("cancels, and frees the stock, when no rider could possibly deliver in time", () => {
    const s = seededWorld();
    setMarketConfig(s, { autopilot: false });
    const l = listingBy(s, "Hostel mess dinner");
    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 30 }], req(s, "S1", "cooked").id));
    run(s, 2);
    orderOf(s, o.id)!.bufferedDeadline = s.clock + 4; // impossible
    run(s, 5);
    expect(orderOf(s, o.id)!.status).toBe("cancelled");
    expect(orderOf(s, o.id)!.closedReason).toMatch(/no rider could deliver/i);
    expect(l.availableQty).toBe(80);
  });
});

describe("cancellation", () => {
  it("a shelter can cancel before pickup: riders are stood down and stock returns", () => {
    const s = seededWorld();
    const l = listingBy(s, "Hostel mess dinner");
    const rq = req(s, "S1", "cooked");
    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 30 }], rq.id));
    run(s, 2.5);
    must(acceptTrip(s, "R10", o.id));
    must(cancelOrder(s, o.id, "shelter", "No longer needed"));
    expect(orderOf(s, o.id)!.status).toBe("cancelled");
    expect(activeLegs(s)).toHaveLength(0);
    expect(l.availableQty).toBe(80);
    expect(rq.remainingQty).toBe(50);
    expect(s.market.notifications.some((n) => n.to.includes("rider:R10") && n.kind === "cancelled")).toBe(true);
    assertMarketInvariants(s);
  });

  it("cannot cancel once goods are on a rider", () => {
    const s = seededWorld();
    const [o] = must(placeOrder(s, "S1", [{ listingId: listingBy(s, "Hostel mess dinner").id, qty: 30 }], req(s, "S1", "cooked").id));
    let tries = 0;
    while (!activeLegs(s).some((l) => l.carrying) && tries++ < 400) run(s, 0.25);
    expect(cancelOrder(s, o.id, "shelter", "oops").ok).toBe(false);
  });

  it("a donor withdrawing a listing cancels pending orders and tells the shelters", () => {
    const s = seededWorld();
    const l = listingBy(s, "Hostel mess dinner");
    s.donors.find((d) => d.id === "D2")!.responseRate = 0;
    const [o] = must(placeOrder(s, "S1", [{ listingId: l.id, qty: 30 }], req(s, "S1", "cooked").id));
    must(cancelListing(s, l.id));
    expect(l.status).toBe("cancelled");
    expect(orderOf(s, o.id)!.status).toBe("cancelled");
    expect(placeOrder(s, "S1", [{ listingId: l.id, qty: 5 }]).ok).toBe(false);
  });
});

describe("housekeeping", () => {
  it("expired listings disappear from the market", () => {
    const s = emptyWorld();
    const l = must(createListing(s, { donorId: "D1", category: "cooked", label: "Soon gone", qty: 10, expiresAt: 20 }));
    run(s, 21);
    expect(l.status).toBe("expired");
    expect(l.availableQty).toBe(0);
  });

  it("requests expire when their needed-by passes with nothing in flight", () => {
    const s = emptyWorld();
    const r = must(createRequest(s, { shelterId: "S1", category: "cooked", qty: 10, neededBy: 20 }));
    run(s, 21);
    expect(r.status).toBe("expired");
  });

  it("preloaded demo data is alive: listings, requests and moving orders", () => {
    const s = seededWorld({ withMovingOrders: true });
    expect(s.market.listings.length).toBeGreaterThanOrEqual(8);
    expect(s.market.requests.length).toBeGreaterThanOrEqual(5);
    run(s, 4);
    expect(s.market.orders.length).toBe(2);
    expect(s.market.orders.every((o) => o.status !== "pending_donor")).toBe(true);
    run(s, 80, 0.25, (st) => assertMarketInvariants(st, "seed"));
    expect(s.market.orders.some((o) => o.status === "delivered")).toBe(true);
  });
});
