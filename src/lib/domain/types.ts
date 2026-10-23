import type { MarketState } from "./market";

/** Core domain model. All times are simulation minutes since scenario start. */

export type Category = "cooked" | "raw_ration" | "medical" | "infant_formula" | "kit";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Behaviour shared by organisations that answer automatically unless a person is present. */
export interface OrgBehaviour {
  /** Responds on its own (confirmations, handovers) when no human is present. */
  auto?: boolean;
  /** Sim minute a person last pinged from this organisation's portal. */
  humanSeenAt?: number;
}

export interface Donor extends OrgBehaviour {
  id: string;
  name: string;
  area: string;
  loc: LatLng;
  /** Probability an auto donor ever answers a reservation (demo knob for ghost confirmations). */
  responseRate?: number;
  /** Minutes an auto donor needs before handing over after a rider arrives. */
  prepDelayMin?: number;
}

export interface Facilities {
  cleanWater: boolean;
  cookingFuel: boolean;
  coldStorage: boolean;
}

export interface Shelter extends OrgBehaviour {
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
  /** Probability an auto shelter ever answers the receipt prompt. */
  receiptRate?: number;
  /** Probability an auto shelter rejects a delivery on quality grounds. */
  rejectRate?: number;
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
  /** Declined or timed-out riders are skipped by the planner until this sim minute. */
  cooldownUntil?: number;
  /** Carries an insulated box: required for cold-chain supplies. */
  coldGear?: boolean;
  /** Sim minute a person last pinged from the rider app. */
  humanSeenAt?: number;
}

export type BatchStatus =
  | "pending"
  | "planned"
  | "in_progress"
  | "delivered"
  | "partial"
  | "at_risk"
  | "spoiled"
  | "cancelled";

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
  /** Cargo stranded away from the donor (e.g. a carrier went silent mid-route). */
  recovery?: { loc: LatLng; qty: number }[];
  /** Sim minute when a rider on this batch last spoke, set when a ghost leg is released. */
  ghostSince?: number;
  /** Planner already reported why this batch can't be dispatched (avoids log spam). */
  blockedLogged?: boolean;
  /** Marketplace: the order this batch fulfils. */
  orderId?: string;
  /** The order was cancelled before everything was collected. */
  cancelled?: boolean;
  /** Buffered deadline riders plan against (expiresAt stays the true expiry). */
  plannedDeadline?: number;
  /** "board": waits for a rider to claim it; "auto": the planner may assign auto-pilot riders. */
  dispatch?: "board" | "auto";
  /** Marketplace batches may only go to these shelters. */
  allowedShelterIds?: string[];
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
  /** Marketplace: order this leg serves, and its handover progress. */
  orderId?: string;
  pickupConfirmed?: boolean;
  /** Set when the rider is waiting at the shelter for the receipt decision. */
  receipt?: "pending" | "accepted" | "rejected";
  handoverSince?: number;
  divertedFrom?: string;
  divertedAt?: number;
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
  /** Units a shelter rejected at the door. */
  rejected: number;
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
  /** Reasons queued for the next planner pass. */
  replanReasons: string[];
  lastReplanAt: number;
  market: MarketState;
  /** Run all four optimizers on every plan (for the Optimizer Lab). Default true. */
  labCompare?: boolean;
}
