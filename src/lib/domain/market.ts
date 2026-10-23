import type { Category } from "./types";

/**
 * Marketplace layer (v2). Donors list supplies, shelters request them, orders bind a shelter to a donor's
 * listing once both sides confirm, and riders pick trips from a board. All times are simulation minutes.
 */

export type Priority = "normal" | "high" | "critical";

export type ListingStatus = "available" | "exhausted" | "expired" | "cancelled";

export interface Listing {
  id: string;
  donorId: string;
  category: Category;
  label: string;
  unit: string;
  qty: number;
  /** Quantity not locked by an order. */
  availableQty: number;
  coldChain: boolean;
  createdAt: number;
  /** After this minute the supplies are not fit to consume. */
  expiresAt: number;
  /** Earliest pickup. */
  readyAt: number;
  notes?: string;
  riskFlags?: string[];
  status: ListingStatus;
}

export type RequestStatus = "open" | "partial" | "fulfilled" | "cancelled" | "expired";

export interface SupplyRequest {
  id: string;
  shelterId: string;
  category: Category;
  label: string;
  unit: string;
  qty: number;
  /** Quantity not yet covered by a live or completed order. */
  remainingQty: number;
  deliveredQty: number;
  /** Optional: latest acceptable arrival. */
  neededBy: number | null;
  priority: Priority;
  notes?: string;
  status: RequestStatus;
  createdAt: number;
}

export type OrderStatus =
  | "pending_donor"
  | "awaiting_rider"
  | "rider_assigned"
  | "in_transit"
  | "awaiting_receipt"
  | "delivered"
  | "partial"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";

export const TERMINAL_ORDER: OrderStatus[] = ["delivered", "partial", "rejected", "cancelled", "expired", "failed"];

export type RiskState = "ok" | "at_risk" | "breached";

export interface Order {
  id: string;
  requestId: string | null;
  listingId: string;
  donorId: string;
  shelterId: string;
  category: Category;
  label: string;
  unit: string;
  qty: number;
  status: OrderStatus;
  createdAt: number;
  /** Donor must confirm before this or the hold is released. */
  holdExpiresAt: number;
  /** Auto-responding donors confirm at this minute (undefined = never auto-responds). */
  autoRespondAt?: number;
  donorConfirmedAt?: number;
  batchId?: string;
  deliveredQty: number;
  lostQty: number;
  expiresAt: number;
  /** expiresAt minus the safety buffer: the deadline riders and shelters plan against. */
  bufferedDeadline: number;
  coldChain: boolean;
  priority: Priority;
  pickupCode: string;
  dropCode: string;
  boardSince?: number;
  /** 0 normal, 1 urgent (wider radius), 2 escalated to admin. */
  urgency: 0 | 1 | 2;
  risk: RiskState;
  noShows: number;
  divertedFrom?: string;
  closedReason?: string;
  closedAt?: number;
}

export type NotifyKind =
  | "reservation"
  | "confirmed"
  | "declined"
  | "hold_expired"
  | "rider_assigned"
  | "picked_up"
  | "at_risk"
  | "expiry_breach"
  | "delivered"
  | "rejected"
  | "escalation"
  | "cancelled"
  | "rerouted"
  | "info";

export interface Notification {
  id: number;
  at: number;
  /** "admin", "donor:D1", "shelter:S2", "rider:R3". */
  to: string[];
  severity: "info" | "success" | "warn" | "critical";
  kind: NotifyKind;
  title: string;
  text: string;
  orderId?: string;
}

export interface MarketConfig {
  /** Human-controlled riders only see the job board (no auto offers). */
  boardOnlyForManual: boolean;
  /** Auto-pilot riders take trips humans have not claimed. */
  autopilot: boolean;
  /** Minutes a trip waits on the board before auto-pilot may take it. */
  boardGraceMin: number;
  /** Longer grace while a person is logged in as a rider and free to take trips. */
  humanBoardGraceMin: number;
  /** Donor confirmation hold for organisations without a human present. */
  holdMin: number;
  /** Hold when a human is present at the donor. */
  humanHoldMin: number;
  /** How long an auto-responding organisation takes to answer. */
  orgResponseMin: number;
  /** Receipt confirmation timeout (auto organisations / humans). */
  receiptMin: number;
  humanReceiptMin: number;
  /** Longest a rider waits for the donor to hand over. */
  pickupWaitCapMin: number;
  /** Trips farther than this (mean ride to donor) are hidden from riders. */
  maxRideToDonorMin: number;
  /** Minutes on the board before a trip turns urgent / is escalated. */
  urgentAfterMin: number;
  escalateAfterMin: number;
  /** A person is "present" if their portal pinged within this many sim minutes. */
  presenceMin: number;
}

export interface MarketState {
  listings: Listing[];
  requests: SupplyRequest[];
  orders: Order[];
  notifications: Notification[];
  config: MarketConfig;
}

export const DEFAULT_MARKET_CONFIG: MarketConfig = {
  boardOnlyForManual: false,
  autopilot: true,
  boardGraceMin: 2,
  humanBoardGraceMin: 15,
  holdMin: 6,
  humanHoldMin: 20,
  orgResponseMin: 1.5,
  receiptMin: 1,
  humanReceiptMin: 20,
  pickupWaitCapMin: 8,
  maxRideToDonorMin: 30,
  urgentAfterMin: 6,
  escalateAfterMin: 12,
  presenceMin: 2,
};

export function emptyMarket(): MarketState {
  return { listings: [], requests: [], orders: [], notifications: [], config: { ...DEFAULT_MARKET_CONFIG } };
}
