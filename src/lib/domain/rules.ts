import type { Category, Shelter } from "./types";

export interface CategoryMeta {
  label: string;
  unit: string;
  /** Default safe window in minutes when the donor doesn't know. */
  defaultSafeMin: number;
  /** Allocation granularity. */
  chunk: number;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  cooked: { label: "Cooked meals", unit: "meals", defaultSafeMin: 90, chunk: 5 },
  raw_ration: { label: "Raw ration kits", unit: "kits", defaultSafeMin: 480, chunk: 5 },
  medical: { label: "Medical supplies", unit: "packs", defaultSafeMin: 150, chunk: 2 },
  infant_formula: { label: "Infant formula", unit: "tins", defaultSafeMin: 360, chunk: 2 },
  kit: { label: "Essential kits", unit: "kits", defaultSafeMin: 600, chunk: 5 },
};

export type IncompatCode =
  | "SHELTER_CLOSED"
  | "NOT_ACCEPTED"
  | "NO_CLEAN_WATER"
  | "NO_COOKING_FUEL"
  | "NO_COLD_STORAGE";

export interface Compat {
  ok: boolean;
  code?: IncompatCode;
  reason?: string;
}

/** Dependency / safety rules between a cargo type and a destination. */
export function checkCompatibility(
  category: Category,
  shelter: Pick<Shelter, "open" | "accepts" | "facilities" | "name">,
  opts: { coldChain?: boolean } = {},
): Compat {
  if (!shelter.open) {
    return { ok: false, code: "SHELTER_CLOSED", reason: `${shelter.name} is not accepting deliveries` };
  }
  if (!shelter.accepts.includes(category)) {
    return {
      ok: false,
      code: "NOT_ACCEPTED",
      reason: `${shelter.name} does not accept ${CATEGORY_META[category].label.toLowerCase()}`,
    };
  }
  if (category === "infant_formula" && !shelter.facilities.cleanWater) {
    return {
      ok: false,
      code: "NO_CLEAN_WATER",
      reason: `Infant formula needs clean water, which ${shelter.name} currently lacks`,
    };
  }
  if (category === "raw_ration" && !shelter.facilities.cookingFuel) {
    return {
      ok: false,
      code: "NO_COOKING_FUEL",
      reason: `Raw ration kits need cooking fuel, which ${shelter.name} currently lacks`,
    };
  }
  if ((category === "medical" && opts.coldChain) && !shelter.facilities.coldStorage) {
    return {
      ok: false,
      code: "NO_COLD_STORAGE",
      reason: `Cold-chain medical supplies need cold storage, which ${shelter.name} lacks`,
    };
  }
  return { ok: true };
}
