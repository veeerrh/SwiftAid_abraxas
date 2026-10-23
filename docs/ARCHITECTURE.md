# Architecture

## Layers

```
src/lib/domain      types, geo helpers, compatibility rules, seeded RNG, Pune seed data
src/lib/engine      feasibility → greedy → optimizers → validator → simulation (leases, diverts, chaos)
src/lib/store.ts    process-wide in-memory store, 500 ms ticker, SSE snapshots
src/lib/actions.ts  zod-validated action API (the only way state changes)
src/lib/copilot.ts  proposal validation, plan-diff simulation on a cloned city
src/lib/intake.ts   donation parsing (model output sanitiser + offline parser)
src/app             portals + API routes (/api/state, /api/stream, /api/action, /api/intake, /api/copilot)
src/components      design-system primitives, live map, admin panels
```

## Time model

All times are simulation minutes. The store converts wall-clock to sim time (default 0.25 sim-min per real second) and
steps the engine in ≤0.25-minute slices, so behaviour is identical at any speed and in tests.

## Planning problem

A `Problem` is a pure snapshot: cargos (batch remainder at the donor, stranded cargo where a carrier went silent, or cargo
already on a rider that must be diverted), an idle rider pool, and shelters with *available* capacity (remaining minus what
in-flight legs have already reserved).

`checkFeasible(cargo, rider, shelter)` enforces, in order: carrier ownership, compatibility (open, accepts category, water/fuel/cold
chain), space, and **arrival ≤ expiry − safety margin**. `analyticSurvival` gives a closed-form estimate used inside optimizer loops.

## Optimizers

Rider-centric genome: per rider *(cargo index, shelter index, load fraction, priority)*. `decode` always yields a plan that satisfies the
hard rules (it repairs infeasible genes), so searches only explore rule-feasible plans.

- **QIGA**: Q-bit angles θ per gene; observation collapses to bits with P(1)=sin²θ; rotation gates move angles toward the best solution; catastrophe step re-diversifies after stagnation.
- **QPSO**: no velocities; each particle samples a delta-potential well around `φ·pbest + (1−φ)·gbest` with width `β|mbest − x|ln(1/u)`, β decaying 1.0 → 0.5.
- **Hybrid**: QIGA discovers topology; QPSO (refine mode) tunes loads and priorities.
- Fitness `10·E[safe units] + placed − 0.05·travel`; greedy seeds every run and a floor guarantees the applied plan is never worse.
- Seeded PRNG ⇒ reproducible in tests; runs in tens of milliseconds, so diverts feel instant.

## Leases and ghost recovery

An accepted leg is a lease: `leaseTtl = clamp(15 % of remaining shelf life, 2, 8) min`, `offerTtl = clamp(10 %, 1.5, 4) min`.
Simulated riders heartbeat automatically; human-controlled riders send heartbeats from the rider portal. Silence beyond `GHOST_WARN`
raises a warning, beyond the TTL releases the leg. Cargo not yet picked up returns to the donor; cargo already on the rider is
recorded as a recovery point at their last position. A hot standby (assigned when a leg's survival is below 85 %) gets first refusal,
then the general planner runs.

## Re-planning

Every mutation requests a replan with a reason. A pass first finds legs whose destination became invalid (closed, incompatible, no room,
ETA beyond the window). Pickup-phase legs are released and re-planned; drop-phase legs become *divert cargo* that only their own rider
may carry. If no feasible shelter exists the rider is flagged **stranded** with a plain-English reason.

## Safety validator

`validatePlan` re-checks everything independently of how the plan was made: rule feasibility per assignment, one trip per rider, rider
capacity, shelter capacity, cargo totals, unknown references. A rejected plan falls back to greedy and is logged.

## Copilot

The model (or the offline rule parser) returns `{ reply, actions[] }` restricted to an allow-list. `simulateDiff` clones the store, runs the
actions through the same `dispatchAction` path, and diffs legs and totals. Approval re-validates and applies; the live city is never
touched by a preview.

## Scaling path

The planner is a pure function over a snapshot, so it shards naturally by city zone. Replace the in-memory store with Postgres (state) and
a queue (events), run one solver per zone, add SMS/WhatsApp heartbeats for riders without the app, and swap the public routing demo for a
traffic-aware routing API.
