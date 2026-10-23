/** Core domain model. All times are simulation minutes since scenario start. */

export type Category = "cooked" | "raw_ration" | "medical" | "infant_formula" | "kit";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Donor {
  id: string;
  name: string;
  area: string;
  loc: LatLng;
}

export interface Facilities {
  cleanWater: boolean;
  cookingFuel: boolean;
  coldStorage: boolean;
}

export interface Shelter {
  id: string;
  name: string;
  area: string;
  loc: LatLng;
  /** Total people / units the site can still absorb (not counting in-flight reservations). */
  capacityRemaining: number;
  totalCapacity: number;
  accepts: Category[];
  facilities: Facilities;
  open: boolean;
}

export type RiderStatus = "idle" | "busy" | "ghosting" | "offline";

export interface Rider {
  id: string;
  name: string;
  area: string;
  loc: LatLng;
  home: LatLng;
  vehicle: "scooter" | "bike" | "van";
  capacity: number;
  speedKmh: number;
  /** Probability the rider completes what they accept (drives survival model). */
  reliability: number;
  status: RiderStatus;
  /** Sim minute of last heartbeat. */
  lastHeartbeat: number;
  /** When true the rider stops sending heartbeats (ghost simulation). */
  silent: boolean;
  /** Human-controlled from the rider portal: no auto-accept / auto-heartbeat. */
  manual: boolean;
}

export type BatchStatus =
  | "pending"
  | "planned"
  | "in_progress"
  | "delivered"
  | "partial"
  | "at_risk"
  | "spoiled";

export interface Batch {
  id: string;
  donorId: string;
  label: string;
  category: Category;
  qty: number;
  unit: string;
  coldChain: boolean;
  createdAt: number;
  expiresAt: number;
  status: BatchStatus;
  deliveredQty: number;
  spoiledQty: number;
  /** Quantity not yet covered by an active/delivered leg. */
  unplacedQty: number;
  notes?: string;
  /** Free-form flags produced by AI intake (e.g. "raw items", "no packaging"). */
  riskFlags?: string[];
}

export type LegState =
  | "offered"
  | "accepted"
  | "to_pickup"
  | "to_drop"
  | "delivered"
  | "released"
  | "failed";

export interface SurvivalEstimate {
  /** Monte Carlo probability this leg reaches the shelter before expiry. */
  p: number;
  samples: number;
  /** ETA percentiles in minutes from now. */
  p10: number;
  p50: number;
  p90: number;
  /** Histogram of ETA samples for the visual band. */
  bins: number[];
  binMin: number;
  binMax: number;
}

export interface Leg {
  id: string;
  batchId: string;
  riderId: string;
  shelterId: string;
  qty: number;
  state: LegState;
  createdAt: number;
  /** Offer must be accepted before this, else released. */
  offerExpiresAt: number;
  /** Heartbeat silence beyond this releases the leg. */
  leaseTtl: number;
  /** Where the cargo currently is when the leg started (donor or last known position of a failed carrier). */
  originLoc: LatLng;
  /** Rider already holds the cargo (divert / in-transit). */
  carrying: boolean;
  /** Current movement phase. */
  phase: "pickup" | "drop" | "done";
  phaseFrom: LatLng;
  phaseTo: LatLng;
  phaseStart: number;
  phaseDuration: number;
  /** Absolute sim-minute ETA to shelter (updated as plan changes). */
  dropEta: number;
  standbyRiderId?: string;
  survival?: SurvivalEstimate;
  divertedFrom?: string;
  releasedReason?: string;
  note?: string;
}

export type EventSeverity = "info" | "success" | "warn" | "critical";

export interface SimEvent {
  id: number;
  at: number;
  severity: EventSeverity;
  type: string;
  text: string;
  batchId?: string;
  riderId?: string;
  shelterId?: string;
}

export interface OptimizerAlgoResult {
  name: "greedy" | "qiga" | "qpso" | "hybrid";
  fitness: number;
  expectedSafe: number;
  placedQty: number;
  avgSurvival: number;
  travelMin: number;
  legs: number;
  ms: number;
  /** Best-so-far fitness per iteration (for the convergence chart). */
  convergence: number[];
  diversity: number[];
}

export interface OptimizerRun {
  id: number;
  at: number;
  reason: string;
  chosen: OptimizerAlgoResult["name"];
  results: OptimizerAlgoResult[];
}

export interface Metrics {
  delivered: number;
  spoiled: number;
  ghostRecoveries: number;
  diverts: number;
  blockedDispatches: number;
  /** Sum / count of ghost detection → reassignment minutes. */
  responseMinSum: number;
  responseCount: number;
  /** Time series sampled each sim-minute for the analytics page. */
  series: { t: number; delivered: number; spoiled: number; active: number }[];
}

export interface SimState {
  clock: number;
  trafficFactor: number;
  trafficUntil: number | null;
  algo: OptimizerAlgoResult["name"];
  scenario: string;
  donors: Donor[];
  shelters: Shelter[];
  riders: Rider[];
  batches: Batch[];
  legs: Leg[];
  events: SimEvent[];
  metrics: Metrics;
  optimizerRuns: OptimizerRun[];
  nextId: number;
  seed: number;
}
