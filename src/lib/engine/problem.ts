import type { Category, LatLng, Shelter } from "@/lib/domain/types";

/** Planning snapshot handed to the allocator/optimizers. Pure data, no side effects. */

export interface Cargo {
  id: string;
  batchId: string;
  category: Category;
  qty: number;
  loc: LatLng;
  expiresAt: number;
  coldChain: boolean;
  chunk: number;
  /** When set only this rider may deliver the cargo (they already hold it). */
  carrierRiderId?: string;
}

export interface PoolRider {
  id: string;
  loc: LatLng;
  capacity: number;
  speedKmh: number;
  reliability: number;
}

export interface PoolShelter {
  shelter: Shelter;
  /** Capacity not already reserved by in-flight legs. */
  available: number;
}

export interface Problem {
  now: number;
  traffic: number;
  cargos: Cargo[];
  riders: PoolRider[];
  shelters: PoolShelter[];
}

export interface Assignment {
  cargoId: string;
  riderId: string;
  shelterId: string;
  qty: number;
  pickupMin: number;
  dropMin: number;
  /** pickupMin + dropMin */
  totalMin: number;
  /** Analytic probability this assignment arrives safely. */
  survival: number;
}

export interface Plan {
  assignments: Assignment[];
  /** Unplaced quantity per cargo id. */
  unplaced: Record<string, number>;
}

export interface PlanScore {
  expectedSafe: number;
  placedQty: number;
  avgSurvival: number;
  travelMin: number;
  fitness: number;
}

export const PICKUP_HANDLING_MIN = 2;
export const DROP_HANDLING_MIN = 2;
/** Plans must land at least this long before the safe window closes. */
export const SAFETY_MARGIN_MIN = 5;
