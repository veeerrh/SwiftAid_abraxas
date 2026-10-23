import { describe, expect, it } from "vitest";
import { dispatchAction } from "@/lib/actions";
import { Store } from "@/lib/store";

const city = () => new Store({ autostart: false, boot: "market" });

describe("marketplace through the action API", () => {
  it("boots the preloaded demo market with a job board and zones in the snapshot", () => {
    const st = city();
    const snap = st.snapshot();
    expect(snap.market.listings.length).toBeGreaterThanOrEqual(8);
    expect(snap.market.requests.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(snap.zones)).toHaveLength(6);
    expect(snap.zones.S1.some((z) => z.ok)).toBe(true);
  });

  it("runs listing → request → order → rider claim → delivery entirely through actions", () => {
    const st = city();
    dispatchAction(st, { type: "reset", scenario: "market" });
    const l = dispatchAction(st, { type: "createListing", donorId: "D2", category: "cooked", label: "Fresh dal and rice", qty: 40, expiresInMin: 90 });
    expect(l.ok).toBe(true);
    const rq = dispatchAction(st, { type: "createRequest", shelterId: "S1", category: "cooked", qty: 40, label: "Dinner" });
    expect(rq.ok).toBe(true);
    const ord = dispatchAction(st, { type: "placeOrder", shelterId: "S1", requestId: rq.info!.requestId as string, lines: [{ listingId: l.info!.listingId as string, qty: 40 }] });
    expect(ord.ok).toBe(true);
    dispatchAction(st, { type: "presence", role: "rider", id: "R10" });
    st.advance(2.5);
    const orderId = (ord.info!.orderIds as string[])[0];
    const snap = st.snapshot();
    expect(snap.board.R10.some((t) => t.orderId === orderId)).toBe(true);
    expect(dispatchAction(st, { type: "acceptTrip", riderId: "R10", orderId }).ok).toBe(true);
    st.advance(60);
    const done = st.snapshot().market.orders.find((o) => o.id === orderId)!;
    expect(done.status).toBe("delivered");
    expect(st.snapshot().market.requests.find((r) => r.id === rq.info!.requestId)!.status).toBe("fulfilled");
  });

  it("rejects bad marketplace input with readable errors", () => {
    const st = city();
    expect(dispatchAction(st, { type: "createListing", donorId: "D1", category: "cooked", label: "x", qty: 5, expiresInMin: 3 }).error).toMatch(/at least/i);
    expect(dispatchAction(st, { type: "createRequest", shelterId: "S4", category: "infant_formula", qty: 5 }).error).toMatch(/clean water/i);
    expect(dispatchAction(st, { type: "placeOrder", shelterId: "S1", lines: [{ listingId: "nope", qty: 1 }] }).ok).toBe(false);
    expect(dispatchAction(st, { type: "acceptTrip", riderId: "R1", orderId: "nope" }).ok).toBe(false);
  });

  it("registers a new donor and shelter live", () => {
    const st = city();
    const d = dispatchAction(st, { type: "registerDonor", name: "Seva Kitchen", area: "Aundh", lat: 18.56, lng: 73.81 });
    const s = dispatchAction(st, { type: "registerShelter", name: "Hope Home", area: "Baner", lat: 18.55, lng: 73.79, capacity: 40 });
    expect(d.ok && s.ok).toBe(true);
    const snap = st.snapshot();
    expect(snap.donors.some((x) => x.id === d.info!.id)).toBe(true);
    expect(snap.zones[s.info!.id as string]).toBeDefined();
  });
});
