# v2 build phases

Each phase ends with passing tests and a push. See `SPEC-v2.md` for the full specification.

| Phase | Scope | Status |
| --- | --- | --- |
| A | Marketplace engine: listings, requests, reachable zone, expiry buffer, confirmations with timeouts, rider job board, handover and receipt, expiry alerts, escalation, preloaded demo data | **Done** |
| B | Smart donor-bundle suggestions (QIGA/QPSO) | **Done** (beats greedy in ~39% of random cases, avg +1 pt, max +6.7) |
| API | Marketplace actions, job board and reachable-zone data in the live snapshot, `/api/suggest` | **Done** |
| D | Shelter screen (request composer, reachable donor cards with expiry countdowns, AI-recommended bundle, order cart, receipt accept/reject) and donor screen (listing composer with expiry, AI prefill, reservations, handover) | **Done** |
| E | Rider phone app: job board (only trips finishable before the buffered expiry), claim, handover and receipt codes | **Done** (map navigation with turn-by-turn steps: not yet) |
| F | Admin: Marketplace view with escalations and manual assign | **Partly done** (Intelligence tab, Impact and Live board redesign: not yet) |
| Demo | Guided demo rewritten around the marketplace flow | **Done** |
| C | Logins, role-scoped dashboards, persistence | **Not started** |
| G | Demo Studio (scenario designer) | **Not started** |
| H | Gemini integration (offline fallbacks already in place; the provider layer is the remaining work) | **Not started** |
| I | Design pass with references, final docs | **Waiting for design references** |

Verification at this point: 169 unit/property/fuzz tests and 49 browser checks pass; lint, types clean.

## Phase A notes

- Rules: `src/lib/market/rules.ts` (buffer, pessimistic p90 travel, reachable zone, eligible listings).
- Engine: `src/lib/market/engine.ts` (listings, requests, orders, rider board, handover and receipt gates, expiry alerts, escalation, sync).
- Seed: `src/lib/market/seed.ts` (preloaded listings, requests and two moving orders).
- The v1 engine is reused through hooks (`src/lib/engine/hooks.ts`); with no marketplace order involved it behaves exactly as before.
- Tests: `market-rules`, `market-engine`, `market-fuzz` (random operations from every party, invariants after each step, everything resolves).

## Demo Studio and Intelligence lab

- **Demo Studio** (admin → Studio): restore the standard city, run one of five ready-made scenarios, or design your own (donors, shelters, riders, traffic, reliability, shelf life, response rate, supplies, requests, failure timeline). Describe a situation in words and AI drafts the scenario (offline keyword fallback). While a scenario runs: timeline of scheduled failures, one-click failures, live knobs, saving results and a comparison table. Scenarios save to the browser, and export/import as JSON.
- **Intelligence lab** (admin → Intelligence): live plan comparison, a benchmark of greedy vs QIGA/QPSO/hybrid over random emergencies, a scale stress test, and the donor-mix benchmark. All numbers are measured by running the solvers.
- Tests: `tests/studio.test.ts`, `tests/intel.test.ts`, browser check `e2e/studio.mjs`.
