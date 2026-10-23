import { z } from "zod";
import { applyKnobs, buildWorldFromSpec, fireFailure } from "@/lib/market/studio";
import { failureSchema, scenarioSchema } from "@/lib/market/studio-presets";
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
import {
  acceptTrip,
  cancelListing,
  cancelOrder,
  cancelRequest,
  confirmPickup,
  confirmReceipt,
  createListing,
  createRequest,
  donorRespond,
  ping,
  placeOrder,
  registerDonor,
  registerRider,
  registerShelter,
  setMarketConfig,
} from "@/lib/market/engine";

const category = z.enum(["cooked", "raw_ration", "medical", "infant_formula", "kit"]);
const algo = z.enum(["greedy", "qiga", "qpso", "hybrid"]);
const scenarioKey = z.enum(["banquet", "formula", "pharmacy", "rush"]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reset"), scenario: z.enum(["quiet", "banquet", "formula", "pharmacy", "rush", "market"]).optional() }),
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
  // Marketplace (v2). Times are minutes from now so clients need no clock maths.
  z.object({
    type: z.literal("createListing"),
    donorId: z.string(),
    category,
    label: z.string().min(1).max(120),
    qty: z.number().int().min(1).max(5000),
    expiresInMin: z.number().min(1).max(7 * 1440),
    readyInMin: z.number().min(0).max(1440).optional(),
    coldChain: z.boolean().optional(),
    notes: z.string().max(300).optional(),
    riskFlags: z.array(z.string().max(80)).max(8).optional(),
  }),
  z.object({ type: z.literal("cancelListing"), listingId: z.string() }),
  z.object({
    type: z.literal("createRequest"),
    shelterId: z.string(),
    category,
    qty: z.number().int().min(1).max(5000),
    label: z.string().max(120).optional(),
    neededInMin: z.number().min(1).max(7 * 1440).optional(),
    priority: z.enum(["normal", "high", "critical"]).optional(),
    notes: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal("cancelRequest"), requestId: z.string() }),
  z.object({
    type: z.literal("placeOrder"),
    shelterId: z.string(),
    requestId: z.string().nullable().optional(),
    lines: z.array(z.object({ listingId: z.string(), qty: z.number().int().min(1) })).min(1).max(12),
  }),
  z.object({ type: z.literal("donorRespond"), orderId: z.string(), accept: z.boolean(), reason: z.string().max(200).optional() }),
  z.object({ type: z.literal("acceptTrip"), riderId: z.string(), orderId: z.string(), force: z.boolean().optional() }),
  z.object({ type: z.literal("confirmPickup"), orderId: z.string(), by: z.enum(["donor", "rider", "admin"]), code: z.string().max(8).optional() }),
  z.object({
    type: z.literal("confirmReceipt"),
    orderId: z.string(),
    accept: z.boolean(),
    by: z.enum(["shelter", "rider", "admin"]),
    code: z.string().max(8).optional(),
    reason: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal("cancelOrder"), orderId: z.string(), by: z.enum(["shelter", "donor", "admin"]), reason: z.string().max(200).optional() }),
  z.object({ type: z.literal("presence"), role: z.enum(["donor", "shelter", "rider"]), id: z.string() }),
  z.object({ type: z.literal("registerDonor"), name: z.string().min(1).max(80), area: z.string().max(60), lat: z.number().min(18.3).max(18.7), lng: z.number().min(73.6).max(74.1) }),
  z.object({
    type: z.literal("registerShelter"),
    name: z.string().min(1).max(80),
    area: z.string().max(60),
    lat: z.number().min(18.3).max(18.7),
    lng: z.number().min(73.6).max(74.1),
    capacity: z.number().int().min(5).max(2000),
  }),
  z.object({ type: z.literal("registerRider"), name: z.string().min(1).max(60), area: z.string().max(60), lat: z.number().min(18.3).max(18.7), lng: z.number().min(73.6).max(74.1) }),
  z.object({ type: z.literal("studioLoad"), spec: scenarioSchema }),
  z.object({ type: z.literal("studioFail"), failure: failureSchema }),
  z.object({
    type: z.literal("studioKnob"),
    expiryFactor: z.number().min(0.1).max(1).optional(),
    traffic: z.number().min(1).max(5).optional(),
    riderReliability: z.number().min(0.3).max(0.99).optional(),
    donorResponseRate: z.number().min(0).max(1).optional(),
    shelterRejectRate: z.number().min(0).max(1).optional(),
    autopilot: z.boolean().optional(),
    ridersOffline: z.number().int().min(0).max(20).optional(),
    ridersOnline: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("setMarketConfig"),
    autopilot: z.boolean().optional(),
    boardGraceMin: z.number().optional(),
    holdMin: z.number().optional(),
    maxRideToDonorMin: z.number().optional(),
    urgentAfterMin: z.number().optional(),
    escalateAfterMin: z.number().optional(),
  }),
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
      store.reset(a.scenario ?? "market");
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
    case "createListing": {
      const r = store.mutate((st) =>
        createListing(st, { donorId: a.donorId, category: a.category, label: a.label, qty: a.qty, expiresAt: st.clock + a.expiresInMin, readyAt: st.clock + (a.readyInMin ?? 0), coldChain: a.coldChain, notes: a.notes, riskFlags: a.riskFlags }),
      );
      return r.ok ? { ok: true, info: { listingId: r.value.id } } : fail(r.error);
    }
    case "cancelListing": {
      const r = store.mutate((st) => cancelListing(st, a.listingId));
      return r.ok ? { ok: true } : fail(r.error);
    }
    case "createRequest": {
      const r = store.mutate((st) =>
        createRequest(st, { shelterId: a.shelterId, category: a.category, label: a.label, qty: a.qty, neededBy: a.neededInMin != null ? st.clock + a.neededInMin : null, priority: a.priority, notes: a.notes }),
      );
      return r.ok ? { ok: true, info: { requestId: r.value.id } } : fail(r.error);
    }
    case "cancelRequest": {
      const r = store.mutate((st) => cancelRequest(st, a.requestId));
      return r.ok ? { ok: true } : fail(r.error);
    }
    case "placeOrder": {
      const r = store.mutate((st) => placeOrder(st, a.shelterId, a.lines, a.requestId ?? undefined));
      return r.ok ? { ok: true, info: { orderIds: r.value.map((o) => o.id) } } : fail(r.error);
    }
    case "donorRespond": {
      const r = store.mutate((st) => donorRespond(st, a.orderId, a.accept, a.reason));
      return r.ok ? { ok: true } : fail(r.error);
    }
    case "acceptTrip": {
      const r = store.mutate((st) => acceptTrip(st, a.riderId, a.orderId, { force: a.force }));
      return r.ok ? { ok: true, info: { legId: r.value.id } } : fail(r.error);
    }
    case "confirmPickup": {
      const r = store.mutate((st) => confirmPickup(st, a.orderId, a.by, a.code));
      return r.ok ? { ok: true } : fail(r.error);
    }
    case "confirmReceipt": {
      const r = store.mutate((st) => confirmReceipt(st, a.orderId, a.accept, a.by, { code: a.code, reason: a.reason }));
      return r.ok ? { ok: true } : fail(r.error);
    }
    case "cancelOrder": {
      const r = store.mutate((st) => cancelOrder(st, a.orderId, a.by, a.reason?.trim() || "Cancelled"));
      return r.ok ? { ok: true } : fail(r.error);
    }
    case "presence":
      ping(s, a.role, a.id);
      return { ok: true };
    case "registerDonor": {
      const r = store.mutate((st) => registerDonor(st, { name: a.name, area: a.area, loc: { lat: a.lat, lng: a.lng } }));
      return r.ok ? { ok: true, info: { id: r.value.id } } : fail(r.error);
    }
    case "registerShelter": {
      const r = store.mutate((st) => registerShelter(st, { name: a.name, area: a.area, loc: { lat: a.lat, lng: a.lng }, capacity: a.capacity }));
      return r.ok ? { ok: true, info: { id: r.value.id } } : fail(r.error);
    }
    case "registerRider": {
      const r = store.mutate((st) => registerRider(st, { name: a.name, area: a.area, loc: { lat: a.lat, lng: a.lng } }));
      return r.ok ? { ok: true, info: { id: r.value.id } } : fail(r.error);
    }
    case "studioLoad": {
      store.load(buildWorldFromSpec(a.spec));
      store.mutate(() => 0);
      return { ok: true };
    }
    case "studioFail": {
      const msg = store.mutate((st) => fireFailure(st, a.failure));
      return { ok: true, info: { message: msg } };
    }
    case "studioKnob": {
      const { type: _t, ...k } = a;
      void _t;
      const done = store.mutate((st) => applyKnobs(st, k));
      return { ok: true, info: { applied: done } };
    }
    case "setMarketConfig":
      return store.mutate((st) => {
        const { type: _t, ...patch } = a;
        void _t;
        setMarketConfig(st, patch);
        return { ok: true };
      });
    case "scenario": {
      const b = store.mutate((st) => spawnScenario(st, a.key));
      return { ok: true, info: { batchId: b.id } };
    }
  }
}
