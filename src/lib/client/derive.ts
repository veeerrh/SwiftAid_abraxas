import type { Batch, Leg, Rider, Shelter } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/store";

export const isActiveLeg = (l: Leg) => l.state === "offered" || l.state === "accepted" || l.state === "to_pickup" || l.state === "to_drop";

export function activeLegs(snap: Snapshot): Leg[] {
  return snap.legs.filter(isActiveLeg);
}

export function batchProgress(snap: Snapshot, b: Batch) {
  const inflight = snap.legs.filter((l) => l.batchId === b.id && isActiveLeg(l)).reduce((n, l) => n + l.qty, 0);
  return { delivered: b.deliveredQty, inflight, unplaced: b.unplacedQty, spoiled: b.spoiledQty };
}

/** Quantity-weighted Monte Carlo survival across a batch's active legs (1 if nothing is in flight yet). */
export function batchSurvival(snap: Snapshot, b: Batch): number | null {
  const legs = snap.legs.filter((l) => l.batchId === b.id && isActiveLeg(l) && l.survival);
  const qty = legs.reduce((n, l) => n + l.qty, 0);
  if (qty === 0) return null;
  return legs.reduce((n, l) => n + l.survival!.p * l.qty, 0) / qty;
}

export function riderLeg(snap: Snapshot, riderId: string): Leg | undefined {
  return snap.legs.find((l) => l.riderId === riderId && isActiveLeg(l));
}

export function shelterInbound(snap: Snapshot, shelterId: string): Leg[] {
  return snap.legs.filter((l) => l.shelterId === shelterId && isActiveLeg(l));
}

export function shelterFree(snap: Snapshot, s: Shelter): number {
  return Math.max(0, s.capacityRemaining - shelterInbound(snap, s.id).reduce((n, l) => n + l.qty, 0));
}

export const batchOf = (snap: Snapshot, id: string) => snap.batches.find((b) => b.id === id);
export const riderOf = (snap: Snapshot, id: string) => snap.riders.find((r) => r.id === id) as Rider | undefined;
export const shelterOf = (snap: Snapshot, id: string) => snap.shelters.find((s) => s.id === id);
export const donorOf = (snap: Snapshot, id: string) => snap.donors.find((d) => d.id === id);

export function avgResponse(snap: Snapshot): number | null {
  const m = snap.metrics;
  return m.responseCount > 0 ? m.responseMinSum / m.responseCount : null;
}

/** Status label shown on batch cards. */
export const STATUS_LABEL: Record<Batch["status"], string> = {
  pending: "Awaiting dispatch",
  planned: "Dispatched",
  in_progress: "In transit",
  delivered: "Delivered",
  partial: "Partly delivered",
  at_risk: "At risk",
  spoiled: "Spoiled",
};

export const STATUS_TONE: Record<Batch["status"], "safe" | "warn" | "crit" | "info" | "neutral"> = {
  pending: "warn",
  planned: "info",
  in_progress: "info",
  delivered: "safe",
  partial: "warn",
  at_risk: "crit",
  spoiled: "crit",
};
