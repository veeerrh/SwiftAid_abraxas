import { createInitialState } from "@/lib/domain/seed";
import type { OptimizerRun, SimState } from "@/lib/domain/types";
import { flushReplan, isActive, log, spawnScenario, tick, type ScenarioKey } from "@/lib/engine/sim";

export type Snapshot = Omit<SimState, "replanReasons" | "nextId" | "seed" | "lastReplanAt"> & {
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

export type BootScenario = ScenarioKey | "quiet";

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
    if (scenario !== "quiet") spawnScenario(this.state, scenario);
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

  reset(scenario: BootScenario = "rush") {
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
    return {
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
  if (!g.__swiftaid) g.__swiftaid = new Store();
  return g.__swiftaid;
}
