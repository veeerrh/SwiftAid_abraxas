import { z } from "zod";
import { actionSchema, dispatchAction, type Action } from "@/lib/actions";
import { isActive } from "@/lib/engine/sim";
import { Store } from "@/lib/store";
import type { SimState } from "@/lib/domain/types";

/** Actions the copilot may propose. Everything is re-validated by the same schema and engine as a human click. */
const ALLOWED = new Set<Action["type"]>([
  "setShelterOpen",
  "setShelterRemaining",
  "setShelterFacility",
  "citizenDrop",
  "chaosGhost",
  "chaosUnghost",
  "chaosTraffic",
  "setAlgo",
  "replan",
]);

export function validateProposed(raw: unknown): { actions: Action[]; rejected: string[] } {
  const list = z.array(z.unknown()).max(6).safeParse(raw);
  const actions: Action[] = [];
  const rejected: string[] = [];
  if (!list.success) return { actions, rejected: ["actions must be a short list"] };
  for (const item of list.data) {
    const parsed = actionSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push(`Ignored an invalid action: ${parsed.error.issues[0]?.message ?? "bad shape"}`);
      continue;
    }
    if (!ALLOWED.has(parsed.data.type)) {
      rejected.push(`"${parsed.data.type}" is not something the copilot may do`);
      continue;
    }
    actions.push(parsed.data);
  }
  return { actions, rejected };
}

/* ----------------------------------------------------------------- summaries */

export function describeAction(state: SimState, a: Action): string {
  const sh = (id: string) => state.shelters.find((s) => s.id === id)?.name ?? id;
  const rd = (id: string) => state.riders.find((r) => r.id === id)?.name ?? id;
  switch (a.type) {
    case "setShelterOpen":
      return `${a.open ? "Reopen" : "Close"} ${sh(a.shelterId)}`;
    case "setShelterRemaining":
      return `Set ${sh(a.shelterId)} remaining capacity to ${a.remaining}`;
    case "setShelterFacility":
      return `Mark ${a.key} ${a.value ? "available" : "unavailable"} at ${sh(a.shelterId)}`;
    case "citizenDrop":
      return `A citizen drops ${a.amount} units at ${sh(a.shelterId)}`;
    case "chaosGhost":
      return a.riderId ? `${rd(a.riderId)} goes silent` : "Silence the busiest rider";
    case "chaosUnghost":
      return `${rd(a.riderId)} comes back`;
    case "chaosTraffic":
      return `Traffic jam ×${a.factor ?? 2.2} for ${a.durationMin ?? 15} min`;
    case "setAlgo":
      return `Switch optimizer to ${a.algo.toUpperCase()}`;
    case "replan":
      return "Re-plan everything now";
    default:
      return a.type;
  }
}

/* ---------------------------------------------------------------- plan diff */

export interface PlanDiff {
  before: Totals;
  after: Totals;
  changes: { kind: "divert" | "released" | "new" | "stranded" | "blocked" | "spoiled"; text: string }[];
}
interface Totals {
  expectedSafe: number;
  inFlight: number;
  waiting: number;
  atRisk: number;
  spoiled: number;
}

function totals(state: SimState): Totals {
  const live = state.legs.filter(isActive);
  return {
    expectedSafe: live.reduce((n, l) => n + l.qty * (l.survival?.p ?? 1), 0),
    inFlight: live.reduce((n, l) => n + l.qty, 0),
    waiting: state.batches.reduce((n, b) => n + b.unplacedQty, 0),
    atRisk: state.batches.filter((b) => b.status === "at_risk").length,
    spoiled: state.metrics.spoiled,
  };
}

/** Run proposed actions on a clone of the city and report what would change. Never touches the live store. */
export function simulateDiff(live: Store, actions: Action[]): { diff: PlanDiff; errors: string[] } {
  const clone = new Store({ autostart: false, boot: "quiet" });
  clone.state = structuredClone(live.state);
  clone.running = false;
  const before = totals(clone.state);
  const legsBefore = new Map(clone.state.legs.filter(isActive).map((l) => [l.id, { shelterId: l.shelterId, qty: l.qty, riderId: l.riderId }]));
  const eventMark = clone.state.nextId;
  const errors: string[] = [];

  for (const a of actions) {
    const res = dispatchAction(clone, a);
    if (!res.ok) errors.push(res.error ?? "action failed");
  }

  const s = clone.state;
  const name = {
    shelter: (id: string) => s.shelters.find((x) => x.id === id)?.name ?? id,
    rider: (id: string) => s.riders.find((x) => x.id === id)?.name ?? id,
  };
  const changes: PlanDiff["changes"] = [];
  for (const [id, was] of legsBefore) {
    const leg = s.legs.find((l) => l.id === id);
    if (!leg) continue;
    if (leg.state === "released") {
      changes.push({ kind: "released", text: `${name.rider(was.riderId)}'s ${was.qty} units released and re-planned (${leg.releasedReason ?? "plan changed"})` });
    } else if (leg.shelterId !== was.shelterId) {
      changes.push({ kind: "divert", text: `${name.rider(leg.riderId)} diverted ${name.shelter(was.shelterId)} → ${name.shelter(leg.shelterId)}` });
    }
  }
  for (const l of s.legs) {
    if (!legsBefore.has(l.id) && isActive(l)) {
      changes.push({ kind: "new", text: `${name.rider(l.riderId)} assigned ${l.qty} units → ${name.shelter(l.shelterId)}` });
    }
  }
  for (const e of s.events.filter((x) => x.id >= eventMark)) {
    if (e.type === "stranded") changes.push({ kind: "stranded", text: e.text });
    else if (e.type === "blocked") changes.push({ kind: "blocked", text: e.text });
    else if (e.type === "plan_rejected") changes.push({ kind: "blocked", text: e.text });
  }
  return { diff: { before, after: totals(s), changes }, errors };
}

/* ------------------------------------------------------- offline understanding */

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
}

export function findShelter(state: SimState, text: string) {
  const t = norm(text);
  return state.shelters.find((s) => t.includes(norm(s.area).trim()) || t.includes(norm(s.name).trim()) || new RegExp(`\\b${s.id.toLowerCase()}\\b`).test(t));
}
export function findRider(state: SimState, text: string) {
  const t = norm(text);
  return state.riders.find((r) => new RegExp(`\\b${norm(r.name).trim()}\\b`).test(t) || new RegExp(`\\b${r.id.toLowerCase()}\\b`).test(t));
}

export interface Understanding {
  reply: string;
  actions: Action[];
}

/** Rule-based command parser used when no model is available (or as a safety net). */
export function understandOffline(state: SimState, message: string): Understanding {
  const t = norm(message);
  const shelter = findShelter(state, message);
  const rider = findRider(state, message);
  const actions: Action[] = [];

  const algo = t.match(/\b(qiga|qpso|hybrid|greedy)\b/)?.[1] as "qiga" | "qpso" | "hybrid" | "greedy" | undefined;
  if (algo && /\b(use|switch|run|apply|try)\b/.test(t)) {
    return { reply: `I'll re-plan with the ${algo.toUpperCase()} optimizer.`, actions: [{ type: "setAlgo", algo }] };
  }
  if (/\btraffic|jam|gridlock\b/.test(t)) {
    return { reply: "Simulating a city-wide traffic jam.", actions: [{ type: "chaosTraffic", factor: 2.3, durationMin: 15 }] };
  }
  if (/\breplan|re plan|reoptimi[sz]e\b/.test(t)) {
    return { reply: "Re-planning every unplaced and at-risk delivery.", actions: [{ type: "replan" }] };
  }
  if (shelter) {
    if (/\b(reopen|re open|open up|open)\b/.test(t) && !/\bclose|closed|closing\b/.test(t)) {
      actions.push({ type: "setShelterOpen", shelterId: shelter.id, open: true });
      return { reply: `Reopening ${shelter.name} for deliveries.`, actions };
    }
    if (/\b(close|closed|closing|shut|not accepting)\b/.test(t)) {
      actions.push({ type: "setShelterOpen", shelterId: shelter.id, open: false });
      return { reply: `Closing intake at ${shelter.name}. Inbound riders will be rerouted if a safe alternative exists.`, actions };
    }
    if (/\b(full|filled|fills|no space|no room|capacity)\b/.test(t)) {
      actions.push({ type: "setShelterRemaining", shelterId: shelter.id, remaining: 0 });
      return { reply: `Marking ${shelter.name} full.`, actions };
    }
    const fac = /\bwater\b/.test(t) ? "cleanWater" : /\b(fuel|gas|cooking)\b/.test(t) ? "cookingFuel" : /\b(cold|fridge|refrigerat)\b/.test(t) ? "coldStorage" : null;
    if (fac) {
      const lost = /\b(out|down|no|lost|without|failed|ran out|unavailable)\b/.test(t);
      actions.push({ type: "setShelterFacility", shelterId: shelter.id, key: fac, value: !lost });
      return { reply: `${fac} ${lost ? "lost" : "restored"} at ${shelter.name}; dependent supplies will be blocked or unblocked.`, actions };
    }
  }
  if (rider && /\b(ghost|silent|unresponsive|stuck|offline|stopped)\b/.test(t)) {
    actions.push({ type: "chaosGhost", riderId: rider.id });
    return { reply: `Simulating ${rider.name} going silent.`, actions };
  }
  if (rider && /\b(back|responsive|revive)\b/.test(t)) {
    actions.push({ type: "chaosUnghost", riderId: rider.id });
    return { reply: `${rider.name} is back online.`, actions };
  }
  if (/\bwhy\b|\bexplain\b|\bhow come\b/.test(t)) return { reply: explainOffline(state, message), actions: [] };
  return {
    reply:
      "I can close or reopen a shelter, mark one full, change its water/fuel/cold storage, silence a rider, simulate traffic, or switch optimizers. Try: “Close Hadapsar”, “Kothrud just filled up”, or “Why was Aarav chosen?”.",
    actions: [],
  };
}

export function explainOffline(state: SimState, message: string): string {
  const rider = findRider(state, message);
  const run = state.optimizerRuns.at(-1);
  if (rider) {
    const leg = [...state.legs].reverse().find((l) => l.riderId === rider.id && l.state !== "released");
    if (!leg) return `${rider.name} has no current delivery. They are ${rider.status}.`;
    const batch = state.batches.find((b) => b.id === leg.batchId);
    const sh = state.shelters.find((s) => s.id === leg.shelterId);
    const donor = state.donors.find((d) => d.id === batch?.donorId);
    return (
      `${rider.name} (${Math.round(rider.reliability * 100)}% reliable, capacity ${rider.capacity}) was assigned ${leg.qty} ${batch?.unit ?? "units"} from ${donor?.name} to ${sh?.name}. ` +
      `That pairing kept the arrival inside the shelf-life window with a Monte Carlo survival of ${Math.round((leg.survival?.p ?? 1) * 100)}%` +
      (run ? `, chosen by the ${run.chosen.toUpperCase()} optimizer over ${run.results.length - 1} alternatives and never worse than the greedy baseline.` : ".")
    );
  }
  const shelter = findShelter(state, message);
  if (shelter) {
    const reasons: string[] = [];
    if (!shelter.open) reasons.push("it is closed");
    if (!shelter.facilities.cleanWater) reasons.push("it has no clean water, so infant formula is blocked");
    if (!shelter.facilities.cookingFuel) reasons.push("it has no cooking fuel, so raw rations are blocked");
    if (!shelter.facilities.coldStorage) reasons.push("it has no cold storage, so cold-chain medicine is blocked");
    return `${shelter.name}: ${reasons.length ? reasons.join("; ") : "it is open with all facilities available"}.`;
  }
  const recent = state.events.slice(-4).map((e) => e.text).join(" · ");
  return `Latest activity: ${recent || "nothing yet"}.`;
}

/* ------------------------------------------------------------ model plumbing */

export const COPILOT_TOOL = {
  name: "propose_actions",
  description:
    "Reply to the dispatcher and optionally propose operational actions. Only propose what the dispatcher asked for. Questions get a reply and NO actions.",
  input_schema: {
    type: "object" as const,
    properties: {
      reply: { type: "string", description: "Short plain-English answer or confirmation (max 3 sentences)" },
      actions: {
        type: "array",
        description: "Actions to simulate and preview. Empty for pure questions.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...ALLOWED] },
            shelterId: { type: "string" },
            riderId: { type: "string" },
            open: { type: "boolean" },
            remaining: { type: "number" },
            key: { type: "string", enum: ["cleanWater", "cookingFuel", "coldStorage"] },
            value: { type: "boolean" },
            amount: { type: "integer" },
            algo: { type: "string", enum: ["greedy", "qiga", "qpso", "hybrid"] },
            factor: { type: "number" },
            durationMin: { type: "number" },
          },
          required: ["type"],
        },
      },
    },
    required: ["reply", "actions"],
  },
};

export function stateBrief(state: SimState): string {
  const free = (id: string) => {
    const s = state.shelters.find((x) => x.id === id)!;
    const reserved = state.legs.filter((l) => isActive(l) && l.shelterId === id).reduce((n, l) => n + l.qty, 0);
    return Math.max(0, s.capacityRemaining - reserved);
  };
  const shelters = state.shelters.map(
    (s) => `${s.id} ${s.name} (${s.area}) ${s.open ? "open" : "CLOSED"} free=${free(s.id)}/${s.totalCapacity} water=${s.facilities.cleanWater} fuel=${s.facilities.cookingFuel} cold=${s.facilities.coldStorage}`,
  );
  const riders = state.riders.map((r) => {
    const leg = state.legs.find((l) => isActive(l) && l.riderId === r.id);
    return `${r.id} ${r.name} ${r.status}${leg ? ` carrying ${leg.qty} to ${leg.shelterId}` : ""}`;
  });
  const batches = state.batches
    .filter((b) => b.unplacedQty > 0 || state.legs.some((l) => l.batchId === b.id && isActive(l)))
    .map((b) => `${b.id} ${b.label} ${b.status} qty=${b.qty} waiting=${b.unplacedQty} life_left=${Math.max(0, Math.round(b.expiresAt - state.clock))}min`);
  const events = state.events.slice(-6).map((e) => e.text);
  return `SHELTERS\n${shelters.join("\n")}\n\nRIDERS\n${riders.join("\n")}\n\nACTIVE BATCHES\n${batches.join("\n") || "none"}\n\nRECENT EVENTS\n${events.join("\n")}`;
}

export const COPILOT_SYSTEM =
  "You are the dispatcher copilot for a city perishable-aid network. You translate the dispatcher's instructions into a small set of proposed actions and explain decisions from the state provided. " +
  "You only PROPOSE: the actions are simulated on a copy of the city, shown to the human as a before/after diff, and applied only if they approve; a deterministic safety engine enforces every rule. " +
  "Use the exact shelterId/riderId values from the state. Never invent ids. Keep replies under three sentences.";
