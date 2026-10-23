import type { Batch, Donor, Metrics, Rider, Shelter, SimState } from "./types";
import { CATEGORY_META } from "./rules";

/**
 * Demo data: simulated organisations placed at real Pune neighbourhoods.
 * Coordinates are approximate neighbourhood centres, not exact addresses.
 */

export const DONORS: Donor[] = [
  { id: "D1", name: "Koregaon Park Banquet Hall", area: "Koregaon Park", loc: { lat: 18.5362, lng: 73.894 } },
  { id: "D2", name: "Camp Hostel Mess", area: "Camp", loc: { lat: 18.5167, lng: 73.8786 } },
  { id: "D3", name: "Deccan Community Pharmacy", area: "Deccan", loc: { lat: 18.5167, lng: 73.8409 } },
  { id: "D4", name: "Viman Nagar Caterers", area: "Viman Nagar", loc: { lat: 18.5679, lng: 73.9143 } },
  { id: "D5", name: "Aundh Hostel Mess", area: "Aundh", loc: { lat: 18.558, lng: 73.8075 } },
];

const ALL_FOOD = ["cooked", "raw_ration", "kit", "infant_formula"] as const;

export function makeShelters(): Shelter[] {
  return [
    {
      id: "S1",
      name: "Kasba Peth Night Shelter",
      area: "Kasba Peth",
      loc: { lat: 18.5195, lng: 73.8553 },
      capacityRemaining: 50,
      totalCapacity: 50,
      accepts: [...ALL_FOOD],
      facilities: { cleanWater: true, cookingFuel: true, coldStorage: false },
      open: true,
    },
    {
      id: "S2",
      name: "Yerwada School Relief Camp",
      area: "Yerwada",
      loc: { lat: 18.5539, lng: 73.8872 },
      capacityRemaining: 120,
      totalCapacity: 120,
      accepts: [...ALL_FOOD],
      facilities: { cleanWater: true, cookingFuel: true, coldStorage: false },
      open: true,
    },
    {
      id: "S3",
      name: "Kothrud Community Hall Camp",
      area: "Kothrud",
      loc: { lat: 18.5074, lng: 73.8077 },
      capacityRemaining: 80,
      totalCapacity: 80,
      accepts: [...ALL_FOOD],
      facilities: { cleanWater: true, cookingFuel: false, coldStorage: false },
      open: true,
    },
    {
      id: "S4",
      name: "Hadapsar Relief Centre",
      area: "Hadapsar",
      loc: { lat: 18.5089, lng: 73.926 },
      capacityRemaining: 70,
      totalCapacity: 70,
      accepts: [...ALL_FOOD, "medical"],
      facilities: { cleanWater: false, cookingFuel: true, coldStorage: true },
      open: true,
    },
    {
      id: "S5",
      name: "Warje Flood Relief Hall",
      area: "Warje",
      loc: { lat: 18.4833, lng: 73.8014 },
      capacityRemaining: 60,
      totalCapacity: 60,
      accepts: [...ALL_FOOD],
      facilities: { cleanWater: true, cookingFuel: true, coldStorage: false },
      open: true,
    },
    {
      id: "S6",
      name: "Kondhwa Relief School",
      area: "Kondhwa",
      loc: { lat: 18.466, lng: 73.893 },
      capacityRemaining: 90,
      totalCapacity: 90,
      accepts: [...ALL_FOOD, "medical"],
      facilities: { cleanWater: true, cookingFuel: true, coldStorage: true },
      open: true,
    },
  ];
}

interface RiderSeed {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  vehicle: Rider["vehicle"];
  capacity: number;
  reliability: number;
}

const RIDER_SEEDS: RiderSeed[] = [
  { id: "R1", name: "Aarav", area: "Shivajinagar", lat: 18.5308, lng: 73.8475, vehicle: "scooter", capacity: 40, reliability: 0.95 },
  { id: "R2", name: "Isha", area: "Swargate", lat: 18.5018, lng: 73.8636, vehicle: "scooter", capacity: 40, reliability: 0.9 },
  { id: "R3", name: "Rohan", area: "Baner", lat: 18.559, lng: 73.7868, vehicle: "scooter", capacity: 40, reliability: 0.82 },
  { id: "R4", name: "Meera", area: "Kalyani Nagar", lat: 18.5463, lng: 73.9033, vehicle: "scooter", capacity: 40, reliability: 0.93 },
  { id: "R5", name: "Kabir", area: "Katraj", lat: 18.4575, lng: 73.8677, vehicle: "bike", capacity: 25, reliability: 0.74 },
  { id: "R6", name: "Sana", area: "Kondhwa", lat: 18.4701, lng: 73.8987, vehicle: "scooter", capacity: 40, reliability: 0.9 },
  { id: "R7", name: "Dev", area: "Deccan", lat: 18.519, lng: 73.842, vehicle: "scooter", capacity: 40, reliability: 0.97 },
  { id: "R8", name: "Tara", area: "Kothrud", lat: 18.51, lng: 73.81, vehicle: "scooter", capacity: 40, reliability: 0.88 },
  { id: "R9", name: "Nikhil", area: "Hadapsar", lat: 18.5, lng: 73.92, vehicle: "van", capacity: 60, reliability: 0.8 },
  { id: "R10", name: "Zoya", area: "Camp", lat: 18.516, lng: 73.878, vehicle: "scooter", capacity: 40, reliability: 0.92 },
];

export function makeRiders(): Rider[] {
  return RIDER_SEEDS.map((r) => ({
    id: r.id,
    name: r.name,
    area: r.area,
    loc: { lat: r.lat, lng: r.lng },
    home: { lat: r.lat, lng: r.lng },
    vehicle: r.vehicle,
    capacity: r.capacity,
    speedKmh: r.vehicle === "van" ? 22 : r.vehicle === "bike" ? 21 : 24,
    reliability: r.reliability,
    status: "idle",
    lastHeartbeat: 0,
    silent: false,
    manual: false,
  }));
}

export function emptyMetrics(): Metrics {
  return {
    delivered: 0,
    spoiled: 0,
    ghostRecoveries: 0,
    diverts: 0,
    blockedDispatches: 0,
    responseMinSum: 0,
    responseCount: 0,
    series: [],
  };
}

export function makeBatch(
  id: string,
  p: {
    donorId: string;
    label: string;
    category: Batch["category"];
    qty: number;
    now: number;
    safeMin: number;
    coldChain?: boolean;
    notes?: string;
    riskFlags?: string[];
  },
): Batch {
  const meta = CATEGORY_META[p.category];
  return {
    id,
    donorId: p.donorId,
    label: p.label,
    category: p.category,
    qty: p.qty,
    unit: meta.unit,
    coldChain: p.coldChain ?? false,
    createdAt: p.now,
    expiresAt: p.now + p.safeMin,
    status: "pending",
    deliveredQty: 0,
    spoiledQty: 0,
    unplacedQty: p.qty,
    notes: p.notes,
    riskFlags: p.riskFlags,
  };
}

/** Fresh city state. Starts quiet; scenarios inject load. */
export function createInitialState(opts: { seed?: number } = {}): SimState {
  return {
    clock: 0,
    trafficFactor: 1,
    trafficUntil: null,
    algo: "hybrid",
    scenario: "Quiet evening",
    donors: DONORS.map((d) => ({ ...d })),
    shelters: makeShelters(),
    riders: makeRiders(),
    batches: [],
    legs: [],
    events: [],
    metrics: emptyMetrics(),
    optimizerRuns: [],
    nextId: 1,
    seed: opts.seed ?? 20260423,
    replanReasons: [],
    lastReplanAt: -10,
  };
}
