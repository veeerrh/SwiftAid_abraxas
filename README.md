# SwiftAid

**Aid that arrives before it spoils.** A real-time coordination, dispatch and safety-enforcement platform that connects
donors, volunteer riders and receiving shelters, and treats **shelf life, rider capacity, destination rules and human
unreliability as live variables**.

Built for the Vibe-A-Thon problem *"The Last-Mile Spoilage Trap: Coordinating Perishable Surplus & Fragile Aid Under Uncertainty"*,
running on a simulated Pune network (fictional organisations placed at real neighbourhoods).

## What it does

| Problem in the brief | How SwiftAid handles it |
| --- | --- |
| Supply, rider capacity and shelter space never line up (180 meals, 40 per scooter, 50 seats) | A planner **splits** every batch across riders and shelters, one trip per rider, respecting rider capacity, remaining shelter capacity and the batch's expiry |
| "Ghost reservations": a claim stalls the network | Every claim is a **lease**. Its length shrinks with the cargo's remaining shelf life; missed heartbeats release it and the cargo is reassigned, using a pre-assigned **hot standby** when risk is high |
| Conditions change mid-journey (a shelter fills while a rider is halfway there) | An event-driven **re-planner** diverts in-transit riders to the best feasible shelter, or flags them as stranded with the reason if none exists |
| Dependency rules (infant formula needs clean water, raw rations need fuel, cold-chain medicine needs cold storage) | A hard-rule layer and a **safety validator** that every plan must pass, from any source |

### Portals

- **Control room** (`/admin`): live map, batch rail with countdown rings and Monte Carlo survival, rider and shelter cards, dispatch timeline (Gantt against expiry markers), event feed, **chaos panel**, **Optimizer Lab** and **Dispatcher Copilot**.
- **Donor** (`/donor`): describe or photograph a donation; AI proposes a structured draft you confirm; live journey tracker.
- **Rider** (`/rider`): phone-style app. Take control to accept or decline offers and keep the heartbeat alive, or go silent on purpose.
- **Shelter** (`/shelter`): capacity gauge, open/close, mark full, facilities toggles, inbound queue.
- **Impact** (`/impact`) and **Live board** (`/live`): analytics and a projector-friendly city view.
- **Judge mode** (`/judge`): every portal tiled around the control room so one person can play every role.

## The engine

```
            ┌────────────── hard rules (compatibility, capacity, expiry, closed shelters) ──────────────┐
 events ──▶ │ find invalid legs ─▶ build planning problem ─▶ greedy baseline ─▶ QIGA · QPSO · Hybrid ─▶ │ ─▶ validatePlan ─▶ legs
 (ghost,    └──────────────────────────────────────────────────────────────────────────────────────────┘      (gatekeeper)
 shelter, traffic, new batch, …)                                         ▲ warm-start, never worse than greedy
```

- **Deterministic and testable.** The planner is a pure function over a snapshot. The simulation advances in sim-minutes, so tests can drive it faster than real time.
- **Quantum-inspired optimizers inside the rule engine.** Rules filter; **QIGA** (Q-bit chromosomes with rotation gates) searches the discrete rider→shelter structure, **QPSO** (delta-potential-well swarm) tunes continuous splits and priorities, and **Hybrid** refines QIGA's best topology with QPSO. They run on classical hardware: quantum-*inspired*, not quantum. The greedy plan seeds the search, and whatever is applied is never worse than it.
- **Monte Carlo survival.** Each leg gets a 1,500-sample estimate of arriving before expiry (traffic noise, rider ghosting, standby recovery), shown as a distribution against the deadline.
- **AI proposes, the engine disposes.** Photo/text intake and the copilot only produce *proposals*. Intake drafts are reviewed by the donor and re-validated; copilot actions are simulated on a **copy of the city**, shown as a before/after diff, and applied only on approval, through the same validated path as a button click.
- **Offline-safe.** Every AI feature has a deterministic fallback, the map falls back to a plain canvas without tiles, and routes fall back to straight lines without the routing service.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the details.

## Run it

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Optional: copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` to enable photo understanding and the language model behind the copilot. Without it the app is fully functional offline.

### Suggested demo

1. Open `/admin` (or `/judge` to see every role at once) and press **Banquet · 180**. 180 meals split across riders and shelters; open a batch card to see each leg's survival distribution.
2. **Ghost a rider.** Watch the heartbeat warning, the lease release and the reassignment; the feed shows how many minutes recovery took.
3. **Citizen fills shelter** (or close one from `/shelter`) while riders are mid-route. They are diverted live.
4. **Infant formula**: it is never sent to the shelter without clean water. Close the others and it is held back with the reason.
5. Open **Copilot** and type *"Close Hadapsar"*. Review the simulated diff, then approve.
6. Open **Optimizer Lab** to compare Greedy, QIGA, QPSO and Hybrid on the plan just made.
7. `/donor`: describe a donation in words (or add a photo), confirm the AI draft and follow its journey.

## Tests

```bash
pnpm test        # 100 unit/property tests (vitest)
pnpm typecheck
pnpm lint
pnpm dev &       # then, in another shell:
pnpm e2e         # 37 Playwright checks across every portal
```

- Domain, feasibility, greedy, validator and optimizers: unit tests, including property-style fuzzing of the genome decoder.
- Simulation: scenario tests for the brief's failure modes plus a **conservation invariant** (every unit is delivered, spoiled, waiting or on a rider) checked on every tick.
- **Seeded fuzz suite**: random donations, ghosts, closures, traffic and optimizer switches, asserting safety invariants after each step (no leaks, no overload, no double-booked riders, no unsafe destinations).
- End-to-end: Playwright drives the real UI (chaos panel, copilot approval, rider accept, shelter close, donor intake).

## Stack

Next.js 15 (App Router), TypeScript, Tailwind v4, Framer Motion, MapLibre GL, Recharts, Zustand, Zod. Real-time via server-sent events from an in-memory store.
The design system is token-driven (`src/app/globals.css`), so restyling is a token change.

## Honest limitations

- The city is simulated: riders, shelters and donors are fictional; locations are approximate neighbourhood centres. Map tiles and road geometry come from public services and fall back gracefully offline.
- State is in memory on one server process. `docs/ARCHITECTURE.md` describes the path to a persistent, sharded deployment.
- One trip per rider per plan; riders do not chain multiple pickups.
- The optimizers improve expected safe delivery modestly on the demo scenarios (a few percent); they matter most when capacity is tight and rider reliability varies.
