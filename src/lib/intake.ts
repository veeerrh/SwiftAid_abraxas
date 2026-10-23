import { z } from "zod";
import { CATEGORY_META } from "@/lib/domain/rules";
import type { Category } from "@/lib/domain/types";

/** A structured donation proposed from free text and/or a photo. Always reviewed by the donor and re-validated by the engine. */
export const draftSchema = z.object({
  category: z.enum(["cooked", "raw_ration", "medical", "infant_formula", "kit"]),
  qty: z.number().int().min(1).max(2000),
  label: z.string().min(1).max(120),
  safeMin: z.number().min(5).max(1440),
  coldChain: z.boolean(),
  riskFlags: z.array(z.string().max(80)).max(6),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400),
});

export type Draft = z.infer<typeof draftSchema> & {
  source: "ai" | "fallback" | "offline-estimate";
  note?: string;
};

const KEYWORDS: Record<Category, RegExp> = {
  infant_formula: /\b(formula|infant|baby|newborn|milk powder|cerelac|lactogen|nan pro)\b/i,
  medical: /\b(medic|insulin|antibiotic|vaccine|bandage|paracetamol|saline|syringe|tablet|capsule|pharmacy|ors|first[- ]aid|inhaler|drip)\b/i,
  raw_ration: /\b(ration|atta|flour|grain|lentil|pulses|dal packet|rice bag|dry rice|uncooked|raw|oil|sugar|salt|wheat)\b/i,
  kit: /\b(kit|blanket|hygiene|sanitary|toothbrush|soap|clothes|clothing|torch|mat|essentials)\b/i,
  cooked: /\b(meal|cooked|biryani|rice|curry|dal|roti|chapati|sabzi|thali|sandwich|food|lunch|dinner|breakfast|pulao|khichdi|packed|tiffin|parcel|snack|idli|poha)\b/i,
};

const COLD = /\b(insulin|vaccine|refrigerat|cold chain|cold-chain|fridge|chilled|biologic)\b/i;

/** Order matters: dependencies (formula, medicine) win over generic food words. */
const ORDER: Category[] = ["infant_formula", "medical", "raw_ration", "kit", "cooked"];

export function detectCategory(text: string): Category {
  for (const c of ORDER) {
    if (c === "cooked") continue;
    if (KEYWORDS[c].test(text)) {
      // "raw rice" vs "cooked rice": explicit cooked wins over generic raw words.
      if (c === "raw_ration" && /\b(cooked|prepared|hot|fresh meal)/i.test(text)) continue;
      return c;
    }
  }
  return "cooked";
}

function parseQty(text: string): number | null {
  const withUnit = text.match(/(\d{1,4})\s*(?:\+\s*)?(?:x\s*)?(?:cooked\s+|hot\s+|packed\s+|veg\s+|veg\s+|dry\s+|baby\s+|infant\s+)?(?:meals?|portions?|plates?|packets?|packs?|kits?|tins?|boxes|box|parcels?|servings?|units?|bottles?|trays?|bags?|people|persons)/i);
  if (withUnit) return Number(withUnit[1]);
  const any = text.match(/\b(\d{1,4})\b/);
  return any ? Number(any[1]) : null;
}

/** Minutes of safe life mentioned in text, e.g. "spoils in 75 minutes", "within 2 hours", "1.5 hrs". */
export function parseSafeMinutes(text: string): number | null {
  const h = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  const m = text.match(/(\d{1,4})\s*(?:minutes?|mins?|min|m)\b/i);
  if (h && m) return Math.round(Number(h[1]) * 60 + Number(m[1]));
  if (h) return Math.round(Number(h[1]) * 60);
  if (m) return Number(m[1]);
  return null;
}

export function fallbackParse(text: string): Draft {
  const t = text.trim();
  const category = detectCategory(t);
  const meta = CATEGORY_META[category];
  const qty = parseQty(t);
  const minutes = parseSafeMinutes(t);
  const flags: string[] = [];
  if (/\b(raw|uncooked)\b/i.test(t) && category === "cooked") flags.push("mentions raw items");
  if (/\b(left ?over|leftover|opened|half[- ]eaten)\b/i.test(t)) flags.push("possible leftovers: check hygiene");
  if (/\b(no (?:packaging|container|box)|loose|open)\b/i.test(t)) flags.push("packaging unclear");
  const coldChain = COLD.test(t);
  if (coldChain) flags.push("cold chain required");
  if (category === "infant_formula") flags.push("needs clean water at destination");
  if (category === "raw_ration") flags.push("needs cooking fuel at destination");

  const conf = 0.35 + (qty ? 0.2 : 0) + (minutes ? 0.2 : 0) + (KEYWORDS[category].test(t) ? 0.15 : 0);
  const draft: Draft = {
    category,
    qty: Math.max(1, Math.min(2000, qty ?? 20)),
    label: t.length > 0 ? titleCase(t.split(/[.,;\n]/)[0]).slice(0, 80) || meta.label : meta.label,
    safeMin: Math.max(5, Math.min(1440, minutes ?? meta.defaultSafeMin)),
    coldChain,
    riskFlags: flags,
    confidence: Math.min(0.85, conf),
    rationale: `Read from your description: ${qty ? `${qty} ${meta.unit}` : "quantity not stated"}, ${minutes ? `${minutes} min of shelf life` : `assuming the ${meta.defaultSafeMin} min default for ${meta.label.toLowerCase()}`}.`,
    source: "fallback",
  };
  return draft;
}

function titleCase(s: string) {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Clamp and normalise whatever a model returned so nothing unsafe reaches the engine. */
export function sanitizeDraft(raw: unknown, source: Draft["source"], note?: string): Draft | null {
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const flags = [...d.riskFlags];
  if (d.category === "infant_formula" && !flags.some((f) => /water/i.test(f))) flags.push("needs clean water at destination");
  if (d.category === "raw_ration" && !flags.some((f) => /fuel/i.test(f))) flags.push("needs cooking fuel at destination");
  return { ...d, riskFlags: flags, source, note };
}

export const INTAKE_TOOL = {
  name: "record_donation",
  description:
    "Record the structured donation described by the donor's text and/or photo. Be conservative: if shelf life is unclear choose a SHORT safe window, and say so in the rationale.",
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: ["cooked", "raw_ration", "medical", "infant_formula", "kit"],
        description: "cooked = ready-to-eat food; raw_ration = uncooked staples; medical = medicines/supplies; infant_formula = baby formula/food; kit = hygiene/essentials",
      },
      qty: { type: "integer", description: "Estimated number of servings/packs/tins/kits. Count visible items if a photo is provided." },
      label: { type: "string", description: "Short human title, e.g. 'Veg biryani trays'" },
      safeMin: { type: "integer", description: "Safe minutes before it should be delivered (cooked food is typically 60-120; never exceed 1440)" },
      coldChain: { type: "boolean", description: "True if refrigeration is required (insulin, vaccines, chilled items)" },
      riskFlags: { type: "array", items: { type: "string" }, description: "Hygiene or safety concerns visible or implied (max 6, short phrases)" },
      confidence: { type: "number", description: "0-1 confidence in this reading" },
      rationale: { type: "string", description: "One or two sentences explaining what you saw and assumed" },
    },
    required: ["category", "qty", "label", "safeMin", "coldChain", "riskFlags", "confidence", "rationale"],
  },
};

export const INTAKE_SYSTEM =
  "You help intake perishable donations for a city aid-logistics network. Extract a structured record. You only PROPOSE: a human confirms and a deterministic safety engine enforces all rules. Prefer under-estimating shelf life to over-estimating it.";
