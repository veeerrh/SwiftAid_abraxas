import type { SurvivalEstimate } from "@/lib/domain/types";
import { gaussian, makeRng } from "@/lib/domain/rng";

export interface MonteCarloParams {
  /** Planned minutes from now until the cargo reaches the shelter. */
  etaMin: number;
  /** Minutes until the batch's safe window closes. */
  minutesLeft: number;
  reliability: number;
  traffic?: number;
  /** A hot-standby rider can recover the cargo if the primary rider ghosts. */
  hasStandby: boolean;
  samples?: number;
  seed?: number;
}

/** Extra minutes a recovery costs: detect silence, release the lease, dispatch standby. */
const RECOVERY_DELAY_MIN = 9;

/**
 * Samples traffic noise and rider ghosting to estimate P(cargo lands before expiry).
 * Deterministic for a given seed so tests and the UI agree.
 */
export function monteCarlo(p: MonteCarloParams): SurvivalEstimate {
  const n = p.samples ?? 2000;
  const rng = makeRng(p.seed ?? 1);
  const sigma = 0.22 * (1 + (1 - p.reliability) * 1.5) * Math.sqrt(p.traffic ?? 1);
  const etas: number[] = new Array(n);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const mult = Math.exp(sigma * gaussian(rng) - (sigma * sigma) / 2);
    let eta = Math.max(0.5, p.etaMin * mult);
    const ghost = rng() > p.reliability;
    let delivered = true;
    if (ghost) {
      if (p.hasStandby) eta += RECOVERY_DELAY_MIN + p.etaMin * 0.5;
      else delivered = false;
    }
    etas[i] = delivered ? eta : Number.POSITIVE_INFINITY;
    if (delivered && eta <= p.minutesLeft) ok++;
  }
  const finite = etas.filter(Number.isFinite).sort((a, b) => a - b);
  const pick = (q: number) => (finite.length ? finite[Math.min(finite.length - 1, Math.floor(q * finite.length))] : p.minutesLeft * 2);
  const binMin = 0;
  const binMax = Math.max(p.minutesLeft * 1.25, pick(0.97), 5);
  const bins = new Array(24).fill(0);
  for (const e of finite) {
    if (e > binMax) continue;
    bins[Math.min(bins.length - 1, Math.floor(((e - binMin) / (binMax - binMin)) * bins.length))]++;
  }
  return {
    p: ok / n,
    samples: n,
    p10: pick(0.1),
    p50: pick(0.5),
    p90: pick(0.9),
    bins,
    binMin,
    binMax,
  };
}
