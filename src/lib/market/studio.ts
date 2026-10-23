import { makeRng } from "@/lib/domain/rng";
import { createInitialState, DONORS } from "@/lib/domain/seed";
import { CATEGORY_META } from "@/lib/domain/rules";
import type { LatLng, SimState } from "@/lib/domain/types";
import { hooks } from "@/lib/engine/hooks";
import { closeShelter, ghostRider, log, pickBusiestShelter, surgeDemand, trafficJam } from "@/lib/engine/sim";
import { cancelListing, createListing, createRequest, notify, placeOrder, registerDonor, registerRider, registerShelter, setMarketConfig } from "./engine";
import { applyMarketWorldConfig } from "./seed";
import { FAILURE_LABEL, scenarioSchema, type FailureSpec, type ScenarioSpec } from "./studio-presets";
import { suggestBundles } from "./suggest";
import { simLabel } from "./time";

const AREAS = ["Baner", "Wakad", "Pashan", "Bibwewadi", "Dhanori", "Magarpatta", "Hinjewadi", "Undri", "Wanowrie", "Kharadi", "Sadashiv Peth", "Karve Nagar", "Aundh", "Hadapsar"];
const CENTER: LatLng = { lat: 18.52, lng: 73.86 };

/** Build a complete city from a scenario spec. Deterministic for a given spec.seed. */
export function buildWorldFromSpec(input: ScenarioSpec): SimState {
  const spec = scenarioSchema.parse(input);
  const s = createInitialState({ seed: spec.seed ?? 20260423 });
  applyMarketWorldConfig(s);
  setMarketConfig(s, { autopilot: spec.autopilot });
  s.scenario = spec.name;
  s.trafficFactor = spec.trafficFactor;
  const rng = makeRng(s.seed ^ 0x5bd1e995);
  const spot = (): LatLng => ({ lat: CENTER.lat + (rng() - 0.5) * 0.15, lng: CENTER.lng + (rng() - 0.5) * 0.18 });
  const area = (i: number) => AREAS[i % AREAS.length];

  // Organisations: trim or extend each seeded group to the requested size.
  s.donors = s.donors.slice(0, spec.donors);
  for (let i = s.donors.length; i < spec.donors; i++) registerDonor(s, { name: `${area(i)} Kitchen ${i + 1}`, area: area(i), loc: spot() });
  s.shelters = s.shelters.slice(0, spec.shelters);
  for (let i = s.shelters.length; i < spec.shelters; i++) {
    const r = registerShelter(s, {
      name: `${area(i + 3)} Relief Hall`,
      area: area(i + 3),
      loc: spot(),
      capacity: 40 + Math.floor(rng() * 90),
      facilities: { coldStorage: i % 2 === 0, cleanWater: true, cookingFuel: true },
      accepts: i % 2 === 0 ? ["cooked", "raw_ration", "kit", "infant_formula", "medical"] : ["cooked", "raw_ration", "kit", "infant_formula"],
    });
    void r;
  }
  s.riders = s.riders.slice(0, spec.riders);
  for (let i = s.riders.length; i < spec.riders; i++) {
    const v = i % 5 === 0 ? "van" : i % 4 === 0 ? "bike" : "scooter";
    registerRider(s, { name: `Rider ${i + 1}`, area: area(i + 5), loc: spot(), vehicle: v, coldGear: i % 3 !== 1 });
  }
  if (spec.riderReliability !== undefined) for (const r of s.riders) r.reliability = spec.riderReliability;
  if (spec.donorResponseRate !== undefined) for (const d of s.donors) d.responseRate = spec.donorResponseRate;
  void DONORS;

  spec.listings.forEach((l, i) => {
    const donor = s.donors[i % s.donors.length];
    createListing(s, {
      donorId: donor.id,
      category: l.category,
      label: l.label ?? `${CATEGORY_META[l.category].label} from ${donor.name}`,
      qty: l.qty,
      expiresAt: s.clock + Math.max(12, l.expiresInMin * spec.expiryScale),
      coldChain: l.cold,
    });
  });
  spec.requests.forEach((r, i) => {
    for (let k = 0; k < s.shelters.length; k++) {
      const sh = s.shelters[(i + k) % s.shelters.length];
      const res = createRequest(s, { shelterId: sh.id, category: r.category, qty: r.qty, priority: r.priority, neededBy: r.neededInMin != null ? s.clock + r.neededInMin : null });
      if (res.ok) break;
    }
  });
  if (spec.autoOrders) {
    for (const rq of s.market.requests) {
      const sug = suggestBundles(s, rq.shelterId, { requestId: rq.id });
      const top = sug.bundles[0];
      if (top) placeOrder(s, rq.shelterId, top.lines.map((l) => ({ listingId: l.listingId, qty: l.qty })), rq.id);
    }
  }
  s.studio = { name: spec.name, startedAt: s.clock, failures: spec.failures.map((f) => ({ ...f, fired: false })) };
  log(s, "info", "studio", `Scenario "${spec.name}" loaded: ${s.donors.length} donors, ${s.shelters.length} shelters, ${s.riders.length} riders, ${s.market.listings.length} listings, ${s.market.requests.length} requests`);
  return s;
}

/** Fire a failure now. Returns a one-line description of what happened (or why it could not). */
export function fireFailure(state: SimState, f: FailureSpec): string {
  const note = (text: string) => {
    log(state, "warn", "studio_failure", `${FAILURE_LABEL[f.type]}: ${text}`);
    return text;
  };
  switch (f.type) {
    case "ghost": {
      const r = ghostRider(state, f.target || undefined);
      return note(r ? `${r.name} stopped responding` : "no rider available to silence");
    }
    case "closeShelter": {
      const sh = closeShelter(state, f.target || undefined);
      return note(sh ? `${sh.name} closed intake` : "no open shelter to close");
    }
    case "fillShelter": {
      const sh = surgeDemand(state, f.target || undefined);
      return note(sh ? `${sh.name} was filled by walk-in donations` : "no shelter available");
    }
    case "traffic":
      trafficJam(state, f.factor ?? 2.2, f.durationMin ?? 15);
      return note(`travel times ×${(f.factor ?? 2.2).toFixed(1)} for ${f.durationMin ?? 15} min`);
    case "donorCancel": {
      const candidates = state.market.listings.filter((l) => l.status === "available" && (!f.target || l.donorId === f.target));
      for (const l of candidates) {
        const r = cancelListing(state, l.id, "The donor withdrew the listing");
        if (r.ok) return note(`${l.label} was withdrawn`);
      }
      return note("no listing could be withdrawn");
    }
    case "rejectNext": {
      const sh = (f.target && state.shelters.find((x) => x.id === f.target)) || pickBusiestShelter(state);
      if (!sh) return note("no shelter to affect");
      sh.rejectRate = 1;
      return note(`${sh.name} will reject deliveries on quality grounds`);
    }
    case "riderShortage": {
      let n = 0;
      for (const r of state.riders) {
        if (n >= (f.count ?? 2)) break;
        if (r.status === "idle" && !state.legs.some((l) => l.riderId === r.id && (l.state === "to_pickup" || l.state === "to_drop" || l.state === "offered"))) {
          r.status = "offline";
          n++;
        }
      }
      return note(`${n} rider${n === 1 ? "" : "s"} went offline`);
    }
    case "donorNoShow": {
      const d = (f.target && state.donors.find((x) => x.id === f.target)) || state.donors[0];
      d.prepDelayMin = 999;
      return note(`${d.name} will not be ready when riders arrive`);
    }
    case "expiryShock": {
      const k = Math.max(0.1, Math.min(1, f.factor ?? 0.6));
      let changed = 0;
      for (const l of state.market.listings) {
        if (l.status === "available" || l.status === "exhausted") {
          l.expiresAt = state.clock + (l.expiresAt - state.clock) * k;
          changed++;
        }
      }
      for (const o of state.market.orders) {
        if (["delivered", "partial", "rejected", "cancelled", "expired", "failed"].includes(o.status)) continue;
        o.expiresAt = state.clock + (o.expiresAt - state.clock) * k;
        o.bufferedDeadline = state.clock + (o.bufferedDeadline - state.clock) * k;
        const b = state.batches.find((x) => x.id === o.batchId);
        if (b) {
          b.expiresAt = o.expiresAt;
          b.plannedDeadline = o.bufferedDeadline;
        }
        notify(state, [`shelter:${o.shelterId}`, `donor:${o.donorId}`, "admin"], "warn", "at_risk", "Expiry moved earlier", `${o.label} must now be consumed by ${simLabel(o.expiresAt)}. Conditions shortened its safe life.`, o.id);
        changed++;
      }
      return note(`${changed} supplies and orders now expire sooner (×${k.toFixed(2)} of remaining life)`);
    }
  }
}

function runScheduled(state: SimState) {
  const st = state.studio;
  if (!st) return;
  for (const f of st.failures) {
    if (!f.fired && state.clock - st.startedAt >= f.atMin) {
      f.fired = true;
      fireFailure(state, f);
    }
  }
}

export interface Knobs {
  expiryFactor?: number;
  traffic?: number;
  riderReliability?: number;
  donorResponseRate?: number;
  shelterRejectRate?: number;
  autopilot?: boolean;
  ridersOffline?: number;
  ridersOnline?: boolean;
}

/** Live adjustments while a scenario runs. */
export function applyKnobs(state: SimState, k: Knobs): string[] {
  const done: string[] = [];
  if (k.expiryFactor !== undefined) done.push(fireFailure(state, { atMin: 0, type: "expiryShock", factor: k.expiryFactor }));
  if (k.traffic !== undefined) {
    trafficJam(state, Math.max(1, Math.min(5, k.traffic)), 60);
    done.push(`traffic ×${k.traffic.toFixed(1)}`);
  }
  if (k.riderReliability !== undefined) {
    for (const r of state.riders) r.reliability = Math.max(0.3, Math.min(0.99, k.riderReliability));
    done.push(`rider reliability ${(k.riderReliability * 100).toFixed(0)}%`);
  }
  if (k.donorResponseRate !== undefined) {
    for (const d of state.donors) d.responseRate = Math.max(0, Math.min(1, k.donorResponseRate));
    done.push(`donor response rate ${(k.donorResponseRate * 100).toFixed(0)}%`);
  }
  if (k.shelterRejectRate !== undefined) {
    for (const s of state.shelters) s.rejectRate = Math.max(0, Math.min(1, k.shelterRejectRate));
    done.push(`shelter reject rate ${(k.shelterRejectRate * 100).toFixed(0)}%`);
  }
  if (k.autopilot !== undefined) {
    setMarketConfig(state, { autopilot: k.autopilot });
    done.push(`auto-pilot ${k.autopilot ? "on" : "off"}`);
  }
  if (k.ridersOffline) done.push(fireFailure(state, { atMin: 0, type: "riderShortage", count: k.ridersOffline }));
  if (k.ridersOnline) {
    let n = 0;
    for (const r of state.riders) if (r.status === "offline") {
      r.status = "idle";
      n++;
    }
    done.push(`${n} riders back online`);
  }
  for (const d of done) log(state, "info", "studio_knob", `Studio: ${d}`);
  return done;
}

// Run scheduled failures after the marketplace tick.
const prevTick = hooks.tick;
hooks.tick = (state, dt) => {
  prevTick?.(state, dt);
  runScheduled(state);
};
