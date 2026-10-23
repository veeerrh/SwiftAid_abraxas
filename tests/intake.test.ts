import { describe, expect, it } from "vitest";
import { detectCategory, fallbackParse, parseSafeMinutes, sanitizeDraft } from "@/lib/intake";

describe("offline intake parser", () => {
  it("reads the statement's banquet example", () => {
    const d = fallbackParse("180 cooked meals from the banquet hall, will spoil in 75 minutes");
    expect(d.category).toBe("cooked");
    expect(d.qty).toBe(180);
    expect(d.safeMin).toBe(75);
    expect(d.source).toBe("fallback");
    expect(d.confidence).toBeGreaterThan(0.7);
  });

  it("classifies dependency-bearing categories ahead of generic food words", () => {
    expect(detectCategory("24 tins of infant formula milk powder")).toBe("infant_formula");
    expect(detectCategory("insulin and antibiotics, keep refrigerated")).toBe("medical");
    expect(detectCategory("50 raw ration kits with atta and dal")).toBe("raw_ration");
    expect(detectCategory("30 hygiene kits and blankets")).toBe("kit");
    expect(detectCategory("veg biryani trays")).toBe("cooked");
    expect(detectCategory("cooked rice and dal, 40 packets")).toBe("cooked");
  });

  it("flags cold chain and destination dependencies", () => {
    const med = fallbackParse("20 packs insulin vials, needs refrigeration, 2 hours");
    expect(med.coldChain).toBe(true);
    expect(med.safeMin).toBe(120);
    expect(med.riskFlags.join(" ")).toMatch(/cold chain/);
    const f = fallbackParse("12 tins infant formula");
    expect(f.riskFlags.join(" ")).toMatch(/clean water/);
    const r = fallbackParse("40 raw ration kits");
    expect(r.riskFlags.join(" ")).toMatch(/cooking fuel/);
  });

  it("parses combined hour and minute phrases", () => {
    expect(parseSafeMinutes("good for 1 hour 30 minutes")).toBe(90);
    expect(parseSafeMinutes("within 2 hrs")).toBe(120);
    expect(parseSafeMinutes("45 min left")).toBe(45);
    expect(parseSafeMinutes("no time given")).toBeNull();
  });

  it("falls back to category defaults and low confidence when details are missing", () => {
    const d = fallbackParse("some food");
    expect(d.safeMin).toBe(90);
    expect(d.confidence).toBeLessThan(0.7);
    expect(d.qty).toBeGreaterThan(0);
  });

  it("clamps absurd numbers", () => {
    const d = fallbackParse("999999 meals in 99999 minutes");
    expect(d.qty).toBeLessThanOrEqual(2000);
    expect(d.safeMin).toBeLessThanOrEqual(1440);
  });

  it("flags possible leftovers", () => {
    expect(fallbackParse("leftover curry, 10 portions").riskFlags.join(" ")).toMatch(/leftover/i);
  });
});

describe("sanitizeDraft (guards model output)", () => {
  const good = {
    category: "infant_formula",
    qty: 24,
    label: "Formula tins",
    safeMin: 360,
    coldChain: false,
    riskFlags: [],
    confidence: 0.9,
    rationale: "Seen in photo",
  };
  it("accepts a valid draft and adds missing dependency flags", () => {
    const d = sanitizeDraft(good, "ai");
    expect(d).not.toBeNull();
    expect(d!.riskFlags.join(" ")).toMatch(/clean water/);
    expect(d!.source).toBe("ai");
  });
  it("rejects malformed or out-of-range output", () => {
    expect(sanitizeDraft({ ...good, qty: -1 }, "ai")).toBeNull();
    expect(sanitizeDraft({ ...good, category: "weapons" }, "ai")).toBeNull();
    expect(sanitizeDraft({ ...good, safeMin: 99999 }, "ai")).toBeNull();
    expect(sanitizeDraft("nonsense", "ai")).toBeNull();
  });
});
