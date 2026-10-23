import { z } from "zod";

/** Scenario specification for the Demo Studio. Pure data: safe to import in the browser. */

const category = z.enum(["cooked", "raw_ration", "medical", "infant_formula", "kit"]);

export const failureSchema = z.object({
  atMin: z.number().min(0).max(600),
  type: z.enum(["ghost", "closeShelter", "fillShelter", "traffic", "donorCancel", "rejectNext", "riderShortage", "expiryShock", "donorNoShow"]),
  /** Shelter/donor/rider id (e.g. "S2") or empty for "the busiest". */
  target: z.string().max(10).optional(),
  factor: z.number().min(0.1).max(8).optional(),
  durationMin: z.number().min(1).max(240).optional(),
  count: z.number().int().min(1).max(20).optional(),
});

export const scenarioSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  seed: z.number().int().optional(),
  donors: z.number().int().min(1).max(14),
  shelters: z.number().int().min(1).max(12),
  riders: z.number().int().min(1).max(30),
  trafficFactor: z.number().min(1).max(5).default(1),
  riderReliability: z.number().min(0.4).max(0.99).optional(),
  /** Multiplies every supply's time-to-expiry. */
  expiryScale: z.number().min(0.2).max(4).default(1),
  donorResponseRate: z.number().min(0).max(1).optional(),
  autopilot: z.boolean().default(true),
  autoOrders: z.boolean().default(false),
  listings: z
    .array(z.object({ category, label: z.string().max(80).optional(), qty: z.number().int().min(1).max(2000), expiresInMin: z.number().min(10).max(4000), cold: z.boolean().optional() }))
    .max(40),
  requests: z
    .array(z.object({ category, qty: z.number().int().min(1).max(2000), priority: z.enum(["normal", "high", "critical"]).optional(), neededInMin: z.number().min(10).max(2000).optional() }))
    .max(30),
  failures: z.array(failureSchema).max(30),
});

export type ScenarioSpec = z.infer<typeof scenarioSchema>;
export type FailureSpec = z.infer<typeof failureSchema>;

export const FAILURE_LABEL: Record<FailureSpec["type"], string> = {
  ghost: "A rider goes silent",
  closeShelter: "A shelter closes intake",
  fillShelter: "A citizen fills a shelter",
  traffic: "Traffic jam",
  donorCancel: "A donor withdraws a listing",
  rejectNext: "A shelter rejects deliveries",
  riderShortage: "Riders go offline",
  expiryShock: "Supplies expire sooner (heat / power cut)",
  donorNoShow: "A donor is not ready at pickup",
};

const base = (o: Partial<ScenarioSpec> & Pick<ScenarioSpec, "name">): ScenarioSpec =>
  scenarioSchema.parse({ donors: 5, shelters: 6, riders: 10, listings: [], requests: [], failures: [], ...o });

export const PRESETS: { id: string; blurb: string; spec: ScenarioSpec }[] = [
  {
    id: "flash_flood",
    blurb: "Displaced families fill shelters; traffic worsens; riders and shelters fail one after another.",
    spec: base({
      name: "Flash flood night",
      description: "A flood floods the roads. A big request, traffic, a ghosting rider and a shelter that fills mid-route.",
      trafficFactor: 1.4,
      autoOrders: true,
      listings: [
        { category: "cooked", label: "Banquet biryani trays", qty: 120, expiresInMin: 95 },
        { category: "cooked", label: "Hostel dinner", qty: 80, expiresInMin: 75 },
        { category: "cooked", label: "Caterer surplus", qty: 90, expiresInMin: 80 },
        { category: "infant_formula", qty: 30, expiresInMin: 800 },
        { category: "kit", label: "Essentials kits", qty: 45, expiresInMin: 1500 },
        { category: "medical", label: "Insulin and vaccines", qty: 24, expiresInMin: 240, cold: true },
      ],
      requests: [
        { category: "cooked", qty: 150, priority: "critical", neededInMin: 120 },
        { category: "cooked", qty: 70, priority: "high" },
        { category: "infant_formula", qty: 20, priority: "critical" },
        { category: "medical", qty: 20, priority: "high" },
      ],
      failures: [
        { atMin: 6, type: "traffic", factor: 2.2, durationMin: 15 },
        { atMin: 9, type: "ghost" },
        { atMin: 16, type: "fillShelter" },
        { atMin: 24, type: "closeShelter" },
      ],
    }),
  },
  {
    id: "hospital_cold_chain",
    blurb: "Cold-chain medicine with few insulated riders. Tests dependency rules and rider scarcity.",
    spec: base({
      name: "Hospital cold chain",
      donors: 3,
      shelters: 3,
      riders: 6,
      autoOrders: true,
      listings: [
        { category: "medical", label: "Insulin pens", qty: 30, expiresInMin: 200, cold: true },
        { category: "medical", label: "Vaccines", qty: 24, expiresInMin: 150, cold: true },
        { category: "medical", label: "Dressings and antibiotics", qty: 40, expiresInMin: 900 },
      ],
      requests: [
        { category: "medical", qty: 40, priority: "critical", neededInMin: 160 },
        { category: "medical", qty: 30, priority: "high" },
      ],
      failures: [
        { atMin: 8, type: "ghost" },
        { atMin: 14, type: "riderShortage", count: 2 },
      ],
    }),
  },
  {
    id: "festival_surplus",
    blurb: "Lots of donors and food, uneven demand. Shows bundling across many donors.",
    spec: base({
      name: "Festival surplus",
      donors: 8,
      shelters: 6,
      riders: 14,
      listings: [
        { category: "cooked", qty: 150, expiresInMin: 100 },
        { category: "cooked", qty: 100, expiresInMin: 90 },
        { category: "cooked", qty: 80, expiresInMin: 120 },
        { category: "cooked", qty: 60, expiresInMin: 70 },
        { category: "cooked", qty: 90, expiresInMin: 110 },
        { category: "kit", qty: 60, expiresInMin: 2000 },
        { category: "raw_ration", qty: 80, expiresInMin: 1500 },
      ],
      requests: [
        { category: "cooked", qty: 220, priority: "high" },
        { category: "cooked", qty: 120 },
        { category: "kit", qty: 50 },
        { category: "raw_ration", qty: 60 },
      ],
      failures: [
        { atMin: 12, type: "donorCancel" },
        { atMin: 20, type: "rejectNext" },
      ],
    }),
  },
  {
    id: "rider_shortage",
    blurb: "Three riders for a busy night: trips go unclaimed and escalate to the control room.",
    spec: base({
      name: "Rider shortage",
      riders: 3,
      autoOrders: true,
      listings: [
        { category: "cooked", qty: 100, expiresInMin: 110 },
        { category: "cooked", qty: 80, expiresInMin: 100 },
        { category: "cooked", qty: 60, expiresInMin: 90 },
      ],
      requests: [
        { category: "cooked", qty: 100, priority: "high" },
        { category: "cooked", qty: 80 },
        { category: "cooked", qty: 60 },
      ],
      failures: [{ atMin: 5, type: "ghost" }],
    }),
  },
  {
    id: "heatwave_expiry",
    blurb: "A power cut shortens every supply's life mid-run: tighter buffers, more breaches.",
    spec: base({
      name: "Heatwave and power cut",
      trafficFactor: 1.3,
      autoOrders: true,
      listings: [
        { category: "cooked", qty: 100, expiresInMin: 90 },
        { category: "cooked", qty: 80, expiresInMin: 80 },
        { category: "medical", label: "Insulin", qty: 24, expiresInMin: 200, cold: true },
        { category: "infant_formula", qty: 30, expiresInMin: 600 },
      ],
      requests: [
        { category: "cooked", qty: 120, priority: "high" },
        { category: "medical", qty: 20, priority: "critical" },
        { category: "infant_formula", qty: 20 },
      ],
      failures: [
        { atMin: 6, type: "expiryShock", factor: 0.55 },
        { atMin: 12, type: "traffic", factor: 1.8, durationMin: 20 },
      ],
    }),
  },
];

export const BLANK_SPEC: ScenarioSpec = base({ name: "My scenario", listings: [{ category: "cooked", qty: 80, expiresInMin: 90 }], requests: [{ category: "cooked", qty: 60 }] });
