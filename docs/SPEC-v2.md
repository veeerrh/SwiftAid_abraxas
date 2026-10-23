# SwiftAid — Final Specification (v2)

Consolidates everything decided so far: what is already built (v1) and the changes agreed for the next build (v2).
Items marked **(to confirm)** are my assumptions, not decisions you have made.

---

## 0. Status at a glance

| Area | State |
| --- | --- |
| v1 prototype | Built, tested, pushed (`veeerrh/SwiftAid_abraxas`). 100 unit/property tests, 48 browser checks |
| v2 changes | Specified below. **No v2 code written yet** |
| Waiting on you | Design references (colour scheme, fonts), Gemini API key, final prompt |

---

## 1. What v1 already provides (kept and reused)

- **Engine:** feasibility rules, greedy baseline, QIGA, QPSO and Hybrid optimizers, Monte Carlo survival, lease/heartbeat ghost recovery, hot standby, event-driven re-planner with live diverts, safety validator, conservation invariant, seeded fuzz tests.
- **Platform:** Next.js 15 + TypeScript, Tailwind v4 design tokens (dark/light), MapLibre map, Recharts, Framer Motion, SSE real-time store, zod-validated action API.
- **Screens:** control room, donor, rider (phone frame), shelter, impact, live board, judge mode, guided demo, chaos panel, optimizer lab, dispatcher copilot.
- **Resilience:** offline fallbacks for AI, map tiles and routing; mobile layouts; Pune seed data.
- Details: `docs/SwiftAid-Project-Summary.pdf`, `docs/ARCHITECTURE.md`.

**What changes in v2:** v1 pushes each donation to riders automatically. v2 becomes a **marketplace in which donors, shelters and riders each confirm**, with logins, role-scoped dashboards and a Demo Studio. The v1 engine is reused for the rider job board, ghost recovery, diverts and failure handling.

---

## 2. Core flow (the new heart of the system)

1. **Donor posts a listing:** supply category (food or medical), item details, quantity, **expiry date and time** (after which it is unfit to consume), pickup window, storage condition (cold chain), handover notes.
2. **Shelter posts a request:** what it needs, how much, needed-by time, priority.
3. **Reachable-zone filter:** the shelter is shown only donors whose supplies can still reach it before expiry. Donors outside that zone are never shown.
4. **Shelter chooses** one donor, or a **group of donors**, to fulfil the request. The system **suggests** the best choice or combination (section 5).
5. **Both parties confirm:** the donor confirms the reservation, the shelter confirms the order. Confirmations have a timeout so a silent party cannot hold stock forever.
6. **Rider job board:** once confirmed, the trip appears to riders. A rider sees a trip **only if** their own travel to the donor, plus handling time, plus the donor → shelter leg fits before the **buffered** expiry. Otherwise the trip is hidden from them.
7. **Rider accepts** and gets Google-Maps-style navigation: current location → donor → shelter, with the expiry countdown.
8. **Handover and delivery** are confirmed by code or QR at both ends. The shelter accepts or rejects on arrival (with a reason).
9. **If expiry is breached at any point** the shelter, rider, donor and admin are notified: **do not deliver or consume.**

### Status lifecycle (listing, request and order)

`Listed → Requested → Matched → Donor confirmed → Rider assigned → Picked up → In transit → Delivered / Rejected / Expired`

---

## 3. Expiry, buffer and visibility rules

- **Buffered deadline** = expiry − buffer.
  - Buffer ≈ 10% of the supply's shelf life, minimum 10 minutes.
  - Larger buffer for cooked food and cold-chain medicine. Exact values per category are to be set in the build.
- **Pessimistic travel:** eligibility uses a p90 travel estimate (from the Monte Carlo model), not the average.
- **Shelter visibility:** show a donor only if a rider *could* still make it in time. The shelter map shows the **reachable zone**.
- **Rider visibility:** show a trip only if `now + ride to donor + pickup handling + donor→shelter + drop handling ≤ buffered expiry`. If it exceeds, the rider does not see it.
- **Continuous re-check:** offers disappear automatically as time passes or traffic worsens.
- **In-transit monitoring:**
  - Amber "at risk" when the delivery will probably not arrive in time.
  - Red "will expire" when it cannot.
  - Red triggers: notify all parties, show "do not consume", offer reroute or return/discard instructions.

---

## 4. Real-world failure handling

| Situation | Behaviour |
| --- | --- |
| Rider running late / will miss expiry | Amber then red alert to shelter, rider, donor, admin; "do not consume"; reroute or discard |
| Rider goes silent (ghost) | Lease expires, hot standby or re-plan (already built) |
| Shelter closes or fills mid-route | Live divert to another valid shelter, or flagged stranded with reason (already built) |
| Item fails quality check at delivery | Shelter rejects with a reason; logged; item marked rejected |
| Donor or shelter does not confirm | Hold times out; stock returns to the pool |
| Two shelters want the same stock | Quantity locks on the listing |
| Nobody takes a trip | Widen visibility radius → flag urgent → escalate to admin for manual assignment |
| Donor not ready on arrival | Capped waiting time, then reassign or cancel |
| Donor cancels or edits a listing | Orders affected are re-planned and parties notified |
| Partial fulfilment | Allowed; the shelter's request stays open for the remainder |
| Rider breakdown | Handled like a ghost, with a recovery point at last position |
| Cold-chain supplies | Only offered to riders with suitable gear; only to shelters with cold storage |
| Listing reaches expiry unclaimed | Auto-hidden and marked expired |

---

## 5. Smart suggestions for shelters (new, QIGA/QPSO showcase)

- When a shelter's request cannot be met by one donor, the system **suggests which donors to pick and how to combine them**.
- The suggestion weighs expiry margin (freshness), distance and travel time, probability of safe arrival, urgency, and not over-draining one donor.
- Shown on the shelter screen as an **"AI-recommended bundle"** badge with a short "why this bundle" explanation built from the optimizer's real scores. The shelter can accept it, edit it, or choose donors manually.
- The same logic can bundle **multiple pickups into one rider trip** ("Recommended for you" on the rider board).
- **Where the algorithms fit:**
  - **QIGA** searches the discrete choice (which donors, which riders).
  - **QPSO** tunes continuous quantities (how much from each donor, priorities).
  - Hybrid combines them.
  - Hard rules always filter first; the greedy plan is the fallback floor.

---

## 6. Roles, logins and structure

- **Landing page** with four login cards: Donor, Shelter, Rider, Admin.
- **Logins are demo-grade:** seeded accounts with a role-scoped session and one-click demo login. No real authentication.
- **Each role has its own dashboard** and sees only its own data. Dashboards update continuously and stay synchronised.
- **Admin sees everything:**
  - Operations: central map of all deliveries.
  - Marketplace: all listings, requests, orders.
  - Deliveries.
  - Impact.
  - Live board.
  - Intelligence (optimizers).
  - Demo Studio.
  - Users and escalations.
- **Rider** gets a mobile-smartphone display. For the demo it appears as a phone frame on the laptop, and a **QR code** lets a judge open the rider view on a real phone over the local network.
- **Persistence (to confirm):** listings, requests and accounts survive restarts via lightweight storage, so the demo is reliable.
- **English only** for now.

### Preloaded demo data

- Several donors and shelters are **already registered**, each with supplies, expiry times and open requests visible immediately, so there is no need to log in as dozens of accounts.
- Pune network with fictional organisations at real neighbourhoods; a few riders pre-registered.
- **In the final presentation:** add one donor, one shelter, and log in as a rider live so judges see the full flow.

---

## 7. Screens (v2)

### Donor
- Listing composer: category, items, quantity, **expiry date/time picker**, pickup window, storage condition, handover notes.
- Photo upload (file picker, drag-and-drop, sample gallery, optional webcam) that pre-fills the form (section 10).
- "My listings" cards with status, incoming reservations (accept/decline), and a journey tracker.

### Shelter (card-first)
- Request composer.
- **Donor cards:** donor, supplies, quantity, **expiry countdown and freshness bar**, distance and drive time, reachable-window badge, quantity stepper, "add to order".
- Sort and filter chips; **AI-recommended bundle** banner.
- Map is secondary (toggle or split view) and shows the **reachable zone**.
- Order summary and a stage tracker; receive-and-check step with accept/reject.

### Rider (phone UI)
- Log in, go available, see a **job board** of feasible trips only (sorted by what suits them).
- After accepting: **navigation view**, a map route first to the donor, then to the shelter, with turn-by-turn steps, a follow-camera, ETA, and a **buffered expiry countdown**.
- Handover code/QR at pickup and drop.
- SOS and an "Open in Google Maps" fallback button.

### Admin
- Central live map with all deliveries, plus the tabs listed in section 6, escalations queue and manual assign.
- Map improvements: marker clustering, freshness colours on donors, reachable-zone overlays, rider follow mode.

### Impact (admin only, reorganised)
- **Headline:** safe units delivered, waste prevented (with assumptions labelled).
- **Reliability:** on-time rate, expiry breaches avoided.
- **Network health:** rider utilisation, shelter and donor fulfilment %.
- **Resilience:** ghost recoveries, diverts, average recovery time.
- **Optimizer value:** gain over greedy.
- Exportable report.

### Live board (admin only, optimised)
- Modes (map, scoreboard, ticker) with auto-rotation; projector-friendly.

---

## 8. Intelligence tab (how QIGA and QPSO are shown)

The v1 convergence chart is replaced by evidence of real decisions:
- **Greedy vs optimized, side by side:** two maps of the same situation with spoilage risk, safe units and distance.
- **Benchmark:** run over many random scenarios and show the distribution of gains.
- **Stress test:** gain and solve time as donors/shelters are added.
- Elsewhere (shelter, rider) the optimizers appear only as small "AI-matched" chips, so the main UI stays clean.
- Keep the honest wording: **quantum-inspired, runs on ordinary hardware**; gains are real but modest and largest when capacity is tight.

---

## 9. Demo Studio (inside admin)

- **Standard demonstration:** a scripted, guided walkthrough we design.
- **Scenario designer:**
  - Number of donors, shelters and riders.
  - Supplies and expiry times; an expiry-shortening slider.
  - Traffic level; rider reliability.
  - Shelter demand.
  - A **timeline of failures** (e.g. at +10 min a rider ghosts, at +15 min a shelter closes).
- **Presets:** flash flood night, hospital cold chain, festival surplus, rider shortage, heatwave expiry.
- **Save, load, replay;** seeded runs are repeatable and two runs can be compared.
- Scenarios can be created by describing them in plain English (section 10), always schema-validated before running.
- Judges can change the factors live (shelters, donors, supplies, expiry timelines) and watch the system respond.

---

## 10. AI (Gemini)

**Model setup**
- Primary: the Gemini Flash model you named; fallback: the older Flash model you named.
- Model IDs are **configured by environment variable**. I will not hard-code them; verify the exact current IDs in Google AI Studio.
- Key stays on the server (`.env.local`), never in the browser.
- A small provider layer so the AI can be swapped without touching features.
- Every AI feature has a deterministic offline fallback.

**Guardrail:** AI proposes; the engine decides. AI never determines eligibility, matching rules, or dispatch.

**AI roles**
1. **Vision intake** (donor): photo → category, quantity estimate, packaging, visible hazards, suggested shelf life, cold chain, and any **expiry date printed on the label**.
2. **Text and voice intake** normalisation.
3. **Shelter request parsing** from plain English into a structured request.
4. **Explanations:** why a bundle or trip was suggested, grounded in real optimizer data.
5. **Admin copilot** (existing): simulate-then-approve changes.
6. **Scenario generation** for the Demo Studio.
7. **Drafting alerts** (expiry risk, rejections).
8. **Safety screening** of risky listings before they go live (e.g. unrefrigerated raw meat, opened medicine), flagged for human review.
9. **After-action summary** of each demo run.

**Image upload on a laptop**
- File picker and drag-and-drop; built-in **sample image gallery** for reliable demos; optional laptop-webcam capture; on a phone the same control opens the camera.
- Flow: browser downsizes (about 1024 px) → server sends to Gemini with a fixed JSON output format → structured draft → donor reviews and edits → post.
- Results are **cached by image hash** so repeated demo images are instant and use no quota.

**Free-tier caution:** current limits are unclear and sources conflict (per-minute and per-day caps, reportedly reduced in April 2026). A demo needs only tens of calls, but check your quota table in AI Studio before the presentation. Mitigations: caching, per-session rate limits, pre-analysed sample images, offline fallback. Free-tier data may be used by Google, so do not upload sensitive images.

---

## 11. Extra features agreed or recommended

- Handover code/QR at pickup and delivery; shelter accept/reject with reason.
- Priority flags (infant, medical, disaster).
- Notification centre with a simulated SMS/WhatsApp preview.
- Rider reliability updating after each trip (feeds the survival model).
- Rider SOS button.
- Trip receipts and audit trail.
- Auto-expiry sweeper that hides expired listings.

*(Hindi/Marathi is deferred: English only for now.)*

---

## 12. Proposed build order (to confirm)

1. Marketplace data model and flow: listings, requests, reachable-zone filter, confirmations, expiry buffer, rider job board.
2. Logins, role-scoped dashboards, landing page, preloaded demo data, persistence.
3. Rider mobile experience and navigation.
4. Shelter card UI and smart bundle suggestions.
5. Admin tabs: marketplace, deliveries, Intelligence, Impact, Live board.
6. Demo Studio.
7. Gemini integration (provider layer, vision intake, copilot, scenario generator).
8. Design pass using your references (colour scheme, fonts).
9. Tests per phase (unit, fuzz, browser), documentation refresh.

---

## 13. Open items

- **From you:** design references, Gemini API key, the final prompt, confirmation of the build order and persistence.
- **Needs verifying:** exact Gemini model IDs and current free-tier quotas (AI Studio).
- **Known v1 limitations that still apply:** one trip per rider per plan unless bundling is built; haversine-based distances with a single traffic factor; public map and routing services need internet.
