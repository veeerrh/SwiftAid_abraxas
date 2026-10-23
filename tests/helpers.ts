import { createInitialState } from "@/lib/domain/seed";
import type { Category } from "@/lib/domain/types";
import { CATEGORY_META } from "@/lib/domain/rules";
import type { Cargo, Problem } from "@/lib/engine/problem";

/** Build a planning problem straight from seed data for unit tests. */
export function seedProblem(
  cargoSpecs: {
    donorId: string;
    category: Category;
    qty: number;
    minutesLeft: number;
    coldChain?: boolean;
  }[],
  opts: { traffic?: number; shelterOverrides?: Record<string, Partial<{ available: number; open: boolean }>> } = {},
): Problem {
  const s = createInitialState();
  const cargos: Cargo[] = cargoSpecs.map((c, i) => {
    const donor = s.donors.find((d) => d.id === c.donorId)!;
    return {
      id: `C${i + 1}`,
      batchId: `B${i + 1}`,
      category: c.category,
      qty: c.qty,
      loc: donor.loc,
      expiresAt: c.minutesLeft,
      coldChain: c.coldChain ?? false,
      chunk: CATEGORY_META[c.category].chunk,
    };
  });
  return {
    now: 0,
    traffic: opts.traffic ?? 1,
    cargos,
    riders: s.riders.map((r) => ({
      id: r.id,
      loc: r.loc,
      capacity: r.capacity,
      speedKmh: r.speedKmh,
      reliability: r.reliability,
    })),
    shelters: s.shelters.map((sh) => {
      const o = opts.shelterOverrides?.[sh.id];
      return {
        shelter: { ...sh, open: o?.open ?? sh.open },
        available: o?.available ?? sh.capacityRemaining,
      };
    }),
  };
}
