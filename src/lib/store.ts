import { createInitialState } from "@/lib/domain/seed";
import type { OptimizerRun, SimState } from "@/lib/domain/types";
import { flushReplan, isActive, log, spawnScenario, tick, type ScenarioKey } from "@/lib/engine/sim";
import { boardFor, type TripOffer } from "@/lib/market/engine";
import { reachability } from "@/lib/market/rules";
import { applyMarketWorldConfig, seedMarket } from "@/lib/market/seed";

/** Per-shelter view of every listing: can it reach this shelter in time, and with how much spare time. */
export interface ZoneEntry {
  listingId: string;
  ok: boolean;
  reason?: string;
  km: number;
  driveMin: number;
  slackMin: number;
  arrivalP90: number;
  freshnessLeftMin: number;
  hasNearbyRider: boolean;
}

export type Snapshot = Omit<SimState, "replanReasons" | "nextId" | "seed" | "lastReplanAt" | "labCompare"> & {
  /** Job board for each human-controlled rider. */
  board: Record<string, TripOffer[]>;
  /** Reachable-zone view for each shelter. */
  zones: Record<string, ZoneEntry[]>;
  version: number;
  rate: number;
  running: boolean;
  /** Wall-clock label base: sim minute 0 is this hour (24h). */
  startHour: number;
};

type Listener = (s: Snapshot) => void;

/** Default speed: 1 real second = 0.25 simulated minutes (a 75-minute shelf life lasts 5 real minutes). */
export const DEFAULT_RATE = 0.25;
export const TICK_MS = 500;
const MAX_STEP_MIN = 0.25;

export type BootScenario = ScenarioKey | "quiet" | "market";

export class Store {
  state: SimState;
  rate = DEFAULT_RATE;
  running = true;
  version = 0;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWall = Date.now();

  constructor(opts: { autostart?: boolean; boot?: BootScenario } = {}) {
    this.state = createInitialState();
    this.boot(opts.boot ?? "rush");
    if (opts.autostart !== false) this.start();
  }

  private boot(scenario: BootScenario) {
    log(this.state, "info", "boot", "SwiftAid control room online — Pune network simulation");
    if (scenario === "market") {
      applyMarketWorldConfig(this.state);
      this.state.scenario = "Pune marketplace";
      seedMarket(this.state, { withMovingOrders: true });
    } else if (scenario !== "quiet") spawnScenario(this.state, scenario);
  }

  start() {
    if (this.timer) return;
    this.lastWall = Date.now();
    this.timer = setInterval(() => this.onTimer(), TICK_MS);
    // Don't keep the process alive just for the ticker (matters for tests / scripts).
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private onTimer() {
    const now = Date.now();
    const dtSec = Math.min(2, (now - this.lastWall) / 1000);
    this.lastWall = now;
    if (!this.running) return;
    this.advance(dtSec * this.rate);
  }

  /** Advance simulated time (also used by tests and the "step" action). */
  advance(minutes: number) {
    let left = minutes;
    while (left > 1e-9) {
      const dt = Math.min(MAX_STEP_MIN, left);
      tick(this.state, dt);
      left -= dt;
    }
    this.emit();
  }

  reset(scenario: BootScenario = "market") {
    const keepAlgo = this.state.algo;
    this.state = createInitialState();
    this.state.algo = keepAlgo;
    this.boot(scenario);
    this.emit();
  }

  /** Run a mutation against the state, flush any queued planning and notify listeners. */
  mutate<T>(fn: (s: SimState) => T): T {
    const out = fn(this.state);
    flushReplan(this.state);
    this.emit();
    return out;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.version++;
    if (this.listeners.size === 0) return;
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  snapshot(): Snapshot {
    const s = this.state;
    const finished = s.legs.filter((l) => !isActive(l)).slice(-40);
    const active = s.legs.filter(isActive);
    const runs: OptimizerRun[] = s.optimizerRuns.slice(-6).map((r, i, arr) =>
      i === arr.length - 1 ? r : { ...r, results: r.results.map((x) => ({ ...x, convergence: [], diversity: [] })) },
    );
    const board: Record<string, TripOffer[]> = {};
    for (const r of s.riders) if (r.manual) board[r.id] = boardFor(s, r.id);
    const zones: Record<string, ZoneEntry[]> = {};
    for (const sh of s.shelters) {
      zones[sh.id] = s.market.listings
        .filter((l) => l.status === "available")
        .map((l) => {
          const r = reachability(s, l, sh);
          return { listingId: l.id, ok: r.ok, reason: r.reason, km: r.km, driveMin: r.driveMin, slackMin: r.slackMin, arrivalP90: r.arrivalP90, freshnessLeftMin: r.freshnessLeftMin, hasNearbyRider: r.hasNearbyRider };
        });
    }
    return {
      board,
      zones,
      version: this.version,
      rate: this.rate,
      running: this.running,
      startHour: 19,
      clock: s.clock,
      trafficFactor: s.trafficFactor,
      trafficUntil: s.trafficUntil,
      algo: s.algo,
      scenario: s.scenario,
      donors: s.donors,
      shelters: s.shelters,
      riders: s.riders,
      batches: s.batches.slice(-30),
      legs: [...finished, ...active],
      events: s.events.slice(-150),
      metrics: s.metrics,
      optimizerRuns: runs,
      market: { ...s.market, notifications: s.market.notifications.slice(-120) },
    };
  }
}

const g = globalThis as unknown as { __swiftaid?: Store };

/** Process-wide singleton so every route handler and SSE client shares one city. */
export function getStore(): Store {
  if (!g.__swiftaid) g.__swiftaid = new Store({ boot: "market" });
  return g.__swiftaid;
}
