import { describe, expect, it } from "vitest";
import { bufferMin, bufferedDeadline, p90Factor, reachability, eligibleListings, hiddenListings } from "@/lib/market/rules";
import { createListing } from "@/lib/market/engine";
import { clockToSim, simLabel } from "@/lib/market/time";
import { emptyWorld, seededWorld, listingBy } from "./market-helpers";

describe("expiry buffer", () => {
  it("is at least the category minimum and scales with shelf life", () => {
    expect(bufferMin("cooked", false, 60)).toBe(15);
    expect(bufferMin("cooked", false, 300)).toBe(45);
    expect(bufferMin("kit", false, 60)).toBe(10);
    expect(bufferMin("raw_ration", false, 1000)).toBe(80);
  });
  it("gives cooked food and cold chain more headroom", () => {
    expect(bufferMin("cooked", false, 120)).toBeGreaterThan(bufferMin("kit", false, 120));
    expect(bufferMin("medical", true, 120)).toBe(bufferMin("medical", false, 120) + 10);
  });
  it("is capped so long-life goods are not wasted", () => {
    expect(bufferMin("cooked", true, 100000)).toBe(120);
  });
  it("buffered deadline is before the true expiry", () => {
    const s = emptyWorld();
    const l = createListing(s, { donorId: "D1", category: "cooked", label: "Meals", qty: 40, expiresAt: 100 });
    expect(l.ok).toBe(true);
    if (l.ok) expect(bufferedDeadline(l.value)).toBeLessThan(100);
  });
});

describe("pessimistic travel", () => {
  it("p90 exceeds the mean and widens with unreliability and traffic", () => {
    expect(p90Factor(0.95, 1)).toBeGreaterThan(1);
    expect(p90Factor(0.7, 1)).toBeGreaterThan(p90Factor(0.95, 1));
    expect(p90Factor(0.9, 2.5)).toBeGreaterThan(p90Factor(0.9, 1));
  });
});

describe("sim time helpers", () => {
  it("round-trips clock labels", () => {
    expect(simLabel(0)).toBe("19:00");
    expect(simLabel(95)).toBe("20:35");
    expect(clockToSim("21:30")).toBe(150);
    expect(clockToSim("08:00", 1)).toBe(780);
    expect(clockToSim("25:00")).toBeNull();
  });
});

describe("reachable zone (what a shelter may see)", () => {
  const w = seededWorld();
  const shelter = (id: string) => w.shelters.find((s) => s.id === id)!;

  it("shows a nearby donor with spare time", () => {
    const r = reachability(w, listingBy(w, "Hostel mess dinner"), shelter("S1"));
    expect(r.ok).toBe(true);
    expect(r.slackMin).toBeGreaterThan(0);
    expect(r.arrivalP90).toBeGreaterThan(w.clock);
  });

  it("hides supplies that cannot arrive before they expire", () => {
    const s = emptyWorld();
    const l = createListing(s, { donorId: "D4", category: "cooked", label: "Almost gone", qty: 30, expiresAt: 25 });
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    const far = reachability(s, l.value, s.shelters.find((x) => x.id === "S5")!);
    expect(far.ok).toBe(false);
    expect(far.reason).toMatch(/too far/i);
  });

  it("hides formula from a shelter with no clean water and cold-chain medicine from one without cold storage", () => {
    const f = reachability(w, listingBy(w, "Infant formula tins"), shelter("S4"));
    expect(f.ok).toBe(false);
    expect(f.reason).toMatch(/clean water/i);
    const m = reachability(w, listingBy(w, "Insulin and vaccines"), shelter("S1"));
    expect(m.ok).toBe(false);
  });

  it("respects a request's needed-by time", () => {
    const l = listingBy(w, "Hostel mess dinner");
    const loose = reachability(w, l, shelter("S1"));
    const tight = reachability(w, l, shelter("S1"), { neededBy: w.clock + 12 });
    expect(loose.ok).toBe(true);
    expect(tight.ok).toBe(false);
  });

  it("a pickup window in the future shrinks the slack", () => {
    const s = emptyWorld();
    const early = createListing(s, { donorId: "D2", category: "cooked", label: "Early", qty: 20, expiresAt: 120 });
    const late = createListing(s, { donorId: "D2", category: "cooked", label: "Late", qty: 20, expiresAt: 120, readyAt: 60 });
    if (!early.ok || !late.ok) throw new Error("setup");
    const sh = s.shelters.find((x) => x.id === "S1")!;
    expect(reachability(s, late.value, sh).slackMin).toBeLessThan(reachability(s, early.value, sh).slackMin);
  });

  it("lists only eligible donors, best margin first, and explains the hidden ones", () => {
    const list = eligibleListings(w, shelter("S1"), { category: "cooked" });
    expect(list.length).toBeGreaterThan(0);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].reach.slackMin).toBeGreaterThanOrEqual(list[i].reach.slackMin);
    expect(list.every((x) => x.listing.category === "cooked")).toBe(true);
    const hidden = hiddenListings(w, shelter("S4"));
    expect(hidden.some((h) => /clean water/i.test(h.reason))).toBe(true);
  });

  it("never offers expired or exhausted listings", () => {
    const s = seededWorld();
    const l = listingBy(s, "Hostel mess dinner");
    l.status = "expired";
    expect(eligibleListings(s, s.shelters[0]).some((x) => x.listing.id === l.id)).toBe(false);
  });
});
