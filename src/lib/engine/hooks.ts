import type { Leg, Rider, SimState } from "@/lib/domain/types";

/**
 * Extension points the marketplace layer plugs into. They default to no-ops, so the core engine
 * (and its tests) behave exactly as before when no marketplace order is involved.
 */
export interface EngineHooks {
  /** Runs once per tick after riders have moved. */
  tick?: (state: SimState, dtMin: number) => void;
  /** Return false to hold a rider at the donor until the handover is confirmed. */
  pickupGate?: (state: SimState, leg: Leg, rider: Rider) => boolean;
  /** Return false to hold a rider at the shelter until the receipt is decided. */
  dropGate?: (state: SimState, leg: Leg, rider: Rider) => boolean;
  /** A leg was released (not quiet): lets the marketplace tell the rider why. */
  /** A rider holds cargo but no safe shelter is reachable. */
  legStranded?: (state: SimState, leg: Leg, why: string) => void;
  legReleased?: (state: SimState, leg: Leg, reason: string, ghost: boolean) => void;
}

export const hooks: EngineHooks = {};
