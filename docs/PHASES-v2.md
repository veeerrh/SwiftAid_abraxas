# v2 build phases

Each phase ends with passing tests and a push. See `SPEC-v2.md` for the full specification.

| Phase | Scope | Status |
| --- | --- | --- |
| A | Marketplace engine: listings, requests, reachable-zone filter, expiry buffer, confirmations with timeouts, rider job board, handover and receipt, expiry alerts, escalation, preloaded demo data | **Done** (154 tests) |
| B | Smart donor-bundle suggestions (QIGA/QPSO) | Pending |
| C | Logins, role-scoped dashboards, persistence | Pending |
| D | New donor and shelter screens | Pending |
| E | Rider mobile app and navigation | Pending |
| F | Admin: marketplace, deliveries, Intelligence, Impact, Live board | Pending |
| G | Demo Studio | Pending |
| H | Gemini integration with offline fallbacks | Pending |
| I | Design pass with references, final docs, full regression | Pending |

## Phase A notes

- Rules: `src/lib/market/rules.ts` (buffer, pessimistic p90 travel, reachable zone, eligible listings).
- Engine: `src/lib/market/engine.ts` (listings, requests, orders, rider board, handover and receipt gates, expiry alerts, escalation, sync).
- Seed: `src/lib/market/seed.ts` (preloaded listings, requests and two moving orders).
- The v1 engine is reused through hooks (`src/lib/engine/hooks.ts`); with no marketplace order involved it behaves exactly as before.
- Tests: `market-rules`, `market-engine`, `market-fuzz` (random operations from every party, invariants after each step, everything resolves).
