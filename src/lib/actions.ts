import { z } from "zod";
import { CATEGORY_META } from "@/lib/domain/rules";
import type { Store } from "@/lib/store";
import {
  acceptLeg,
  addBatch,
  closeShelter,
  declineLeg,
  ghostRider,
  heartbeat,
  log,
  requestReplan,
  setShelterFacility,
  setShelterOpen,
  setShelterRemaining,
  spawnScenario,
  surgeDemand,
  tightExpiryBatch,
  trafficJam,
  unghostRider,
} from "@/lib/engine/sim";

const category = z.enum(["cooked", "raw_ration", "medical", "infant_formula", "kit"]);
const algo = z.enum(["greedy", "qiga", "qpso", "hybrid"]);
const scenarioKey = z.enum(["banquet", "formula", "pharmacy", "rush"]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reset"), scenario: z.enum(["quiet", "banquet", "formula", "pharmacy", "rush"]).optional() }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("setRate"), rate: z.number().min(0.05).max(4) }),
  z.object({ type: z.literal("step"), minutes: z.number().min(0).max(240) }),
  z.object({ type: z.literal("setAlgo"), algo }),
  z.object({ type: z.literal("replan") }),
  z.object({
    type: z.literal("addBatch"),
    donorId: z.string(),
    category,
    qty: z.number().int().min(1).max(2000),
    label: z.string().max(120).optional(),
    safeMin: z.number().min(3).max(1440).optional(),
    coldChain: z.boolean().optional(),
    notes: z.string().max(300).optional(),
    riskFlags: z.array(z.string().max(60)).max(8).optional(),
  }),
  z.object({ type: z.literal("acceptLeg"), legId: z.string() }),
  z.object({ type: z.literal("declineLeg"), legId: z.string() }),
  z.object({ type: z.literal("heartbeat"), riderId: z.string() }),
  z.object({ type: z.literal("setRiderManual"), riderId: z.string(), manual: z.boolean() }),
  z.object({ type: z.literal("setRiderSilent"), riderId: z.string(), silent: z.boolean() }),
  z.object({ type: z.literal("setShelterOpen"), shelterId: z.string(), open: z.boolean() }),
  z.object({
    type: z.literal("setShelterFacility"),
    shelterId: z.string(),
    key: z.enum(["cleanWater", "cookingFuel", "coldStorage"]),
    value: z.boolean(),
  }),
  z.object({ type: z.literal("setShelterRemaining"), shelterId: z.string(), remaining: z.number().min(0) }),
  z.object({ type: z.literal("citizenDrop"), shelterId: z.string(), amount: z.number().int().min(1).max(500) }),
  // Chaos panel
  z.object({ type: z.literal("chaosGhost"), riderId: z.string().optional() }),
  z.object({ type: z.literal("chaosUnghost"), riderId: z.string() }),
  z.object({ type: z.literal("chaosCloseShelter"), shelterId: z.string().optional() }),
  z.object({ type: z.literal("chaosSurge"), shelterId: z.string().optional(), amount: z.number().int().min(1).optional() }),
  z.object({
    type: z.literal("chaosTraffic"),
    factor: z.number().min(1.2).max(4).optional(),
    durationMin: z.number().min(2).max(90).optional(),
  }),
  z.object({ type: z.literal("chaosTightExpiry") }),
  z.object({ type: z.literal("scenario"), key: scenarioKey }),
]);

export type Action = z.infer<typeof actionSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
  info?: Record<string, unknown>;
}

const fail = (error: string): ActionResult => ({ ok: false, error });

/** Applies a validated action to the store. Pure of HTTP so it is unit-testable. */
export function dispatchAction(store: Store, raw: unknown): ActionResult {
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const a = parsed.data;
  const s = store.state;

  const hasShelter = (id: string) => s.shelters.some((x) => x.id === id);
  const hasRider = (id: string) => s.riders.some((x) => x.id === id);

  switch (a.type) {
    case "reset":
      store.reset(a.scenario ?? "rush");
      return { ok: true };
    case "pause":
      store.running = false;
      store.emit();
      return { ok: true };
    case "resume":
      store.running = true;
      store.emit();
      return { ok: true };
    case "setRate":
      store.rate = a.rate;
      store.emit();
      return { ok: true };
    case "step":
      store.advance(a.minutes);
      return { ok: true };
    case "setAlgo":
      return store.mutate((st) => {
        st.algo = a.algo;
        requestReplan(st, `optimizer switched to ${a.algo}`);
        return { ok: true };
      });
    case "replan":
      return store.mutate((st) => {
        requestReplan(st, "manual replan");
        return { ok: true };
      });
    case "addBatch": {
      if (!s.donors.some((d) => d.id === a.donorId)) return fail("unknown donor");
      const meta = CATEGORY_META[a.category];
      const b = store.mutate((st) =>
        addBatch(st, { ...a, safeMin: a.safeMin ?? meta.defaultSafeMin }),
      );
      return { ok: true, info: { batchId: b.id } };
    }
    case "acceptLeg":
      return store.mutate((st) => (acceptLeg(st, a.legId) ? { ok: true } : fail("leg is not awaiting acceptance")));
    case "declineLeg":
      return store.mutate((st) => (declineLeg(st, a.legId) ? { ok: true } : fail("leg is not awaiting acceptance")));
    case "heartbeat":
      if (!hasRider(a.riderId)) return fail("unknown rider");
      heartbeat(s, a.riderId);
      return { ok: true };
    case "setRiderManual": {
      if (!hasRider(a.riderId)) return fail("unknown rider");
      return store.mutate((st) => {
        const r = st.riders.find((x) => x.id === a.riderId)!;
        r.manual = a.manual;
        r.lastHeartbeat = st.clock;
        log(st, "info", "rider_control", `${r.name} is now ${a.manual ? "human-controlled" : "auto-piloted"}`, { riderId: r.id });
        return { ok: true };
      });
    }
    case "setRiderSilent": {
      if (!hasRider(a.riderId)) return fail("unknown rider");
      return store.mutate((st) => {
        if (a.silent) ghostRider(st, a.riderId);
        else unghostRider(st, a.riderId);
        return { ok: true };
      });
    }
    case "setShelterOpen":
      if (!hasShelter(a.shelterId)) return fail("unknown shelter");
      return store.mutate((st) => {
        setShelterOpen(st, a.shelterId, a.open);
        return { ok: true };
      });
    case "setShelterFacility":
      if (!hasShelter(a.shelterId)) return fail("unknown shelter");
      return store.mutate((st) => {
        setShelterFacility(st, a.shelterId, a.key, a.value);
        return { ok: true };
      });
    case "setShelterRemaining":
      if (!hasShelter(a.shelterId)) return fail("unknown shelter");
      return store.mutate((st) => {
        setShelterRemaining(st, a.shelterId, a.remaining, `Capacity at ${st.shelters.find((x) => x.id === a.shelterId)!.name} updated to ${a.remaining}`);
        return { ok: true };
      });
    case "citizenDrop":
      if (!hasShelter(a.shelterId)) return fail("unknown shelter");
      return store.mutate((st) => {
        surgeDemand(st, a.shelterId, a.amount);
        return { ok: true };
      });
    case "chaosGhost": {
      if (a.riderId && !hasRider(a.riderId)) return fail("unknown rider");
      const r = store.mutate((st) => ghostRider(st, a.riderId));
      return r ? { ok: true, info: { riderId: r.id } } : fail("no rider available to ghost");
    }
    case "chaosUnghost":
      if (!hasRider(a.riderId)) return fail("unknown rider");
      return store.mutate((st) => {
        unghostRider(st, a.riderId);
        return { ok: true };
      });
    case "chaosCloseShelter": {
      if (a.shelterId && !hasShelter(a.shelterId)) return fail("unknown shelter");
      const sh = store.mutate((st) => closeShelter(st, a.shelterId));
      return sh ? { ok: true, info: { shelterId: sh.id } } : fail("no open shelter to close");
    }
    case "chaosSurge": {
      if (a.shelterId && !hasShelter(a.shelterId)) return fail("unknown shelter");
      const sh = store.mutate((st) => surgeDemand(st, a.shelterId, a.amount));
      return sh ? { ok: true, info: { shelterId: sh.id } } : fail("no shelter available");
    }
    case "chaosTraffic":
      return store.mutate((st) => {
        trafficJam(st, a.factor ?? 2.2, a.durationMin ?? 15);
        return { ok: true };
      });
    case "chaosTightExpiry": {
      const b = store.mutate((st) => tightExpiryBatch(st));
      return { ok: true, info: { batchId: b.id } };
    }
    case "scenario": {
      const b = store.mutate((st) => spawnScenario(st, a.key));
      return { ok: true, info: { batchId: b.id } };
    }
  }
}
