// End-to-end smoke test against a running dev server (pnpm dev). Usage: node e2e/smoke.mjs [baseUrl]
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const post = (action) =>
  fetch(`${BASE}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) }).then((r) => r.json());
const state = () => fetch(`${BASE}/api/state`).then((r) => r.json());
/** Poll the live state until a predicate holds (no fixed sleeps). */
async function until(pred, timeout = 8000) {
  const t0 = Date.now();
  let s = await state();
  while (!pred(s) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 200));
    s = await state();
  }
  return { ok: pred(s), s };
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

/** Network failures to third-party hosts (tiles, fonts, routing) are expected offline and handled by fallbacks. */
const fatal = (msgs) => msgs.filter((m) => !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|Failed to load resource|fonts\.g|ERR_CONNECTION/i.test(m));

async function visit(path, expectText) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const ok = res?.status() === 200;
  const body = (await page.locator("body").innerText()).toLowerCase();
  check(`${path} loads`, ok);
  if (expectText) check(`${path} shows "${expectText}"`, body.includes(expectText.toLowerCase()));
  check(`${path} has no runtime errors`, fatal(errs).length === 0, fatal(errs)[0]);
  return page;
}
const closeAll = async () => { for (const p of ctx.pages()) await p.close(); };

// Fresh quiet city
await post({ type: "reset", scenario: "quiet" });

for (const [path, text] of [["/", "before it spoils"], ["/impact", "Impact"], ["/live", "Happening now"], ["/donor", "List supplies"], ["/shelter", "What do you need"], ["/rider", "Playing as"], ["/judge", "Judge mode"]]) {
  const pg = await visit(path, text);
  await pg.close();
}

// --- Admin + chaos via the UI
const admin = await visit("/admin", "Batches");
await admin.getByRole("button", { name: /Banquet/ }).click();
let r = await until((x) => x.batches.some((b) => b.qty === 180));
check("banquet scenario creates a 180-unit batch via UI", r.ok);
check("banquet is split across multiple riders", r.s.legs.filter((l) => l.state !== "released").length >= 4);

await admin.getByRole("button", { name: /Ghost a rider/ }).click();
r = await until((x) => x.riders.some((q) => q.silent));
check("ghost button silences a rider", r.ok);
let s = r.s;

// --- Copilot flow: preview then approve
await admin.getByRole("button", { name: /^Copilot$/ }).click();
await admin.getByPlaceholder(/Hadapsar just closed/).fill("Close Kasba Peth");
await admin.getByRole("button", { name: "Send", exact: true }).click();
await admin.getByText("Proposed plan").waitFor({ timeout: 10000 });
check("copilot shows a simulated plan diff", true);
s = await state();
check("preview does not change the live city", s.shelters.find((x) => x.id === "S1").open === true);
await admin.getByRole("button", { name: /Approve and apply/ }).click();
r = await until((x) => x.shelters.find((q) => q.id === "S1").open === false);
check("approval applies the action", r.ok);
await admin.keyboard.press("Escape");

// --- Optimizer lab renders data
await admin.getByRole("button", { name: /Optimizer Lab/ }).click();
await admin.getByText("Convergence").waitFor({ timeout: 8000 });
check("optimizer lab shows convergence chart", true);
await admin.close();

// --- Rider portal: take control, accept offer
await post({ type: "reset", scenario: "quiet" });
for (const id of ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"]) await post({ type: "setRiderManual", riderId: id, manual: true });
await post({ type: "addBatch", donorId: "D1", category: "cooked", qty: 30, safeMin: 90 });
s = await state();
const offered = s.legs.find((l) => l.state === "offered");
check("manual riders receive offers", !!offered);
if (offered) {
  const rider = await ctx.newPage();
  await rider.goto(`${BASE}/rider?r=${offered.riderId}`, { waitUntil: "domcontentloaded" });
  await rider.getByRole("button", { name: "Accept", exact: true }).click({ timeout: 8000 });
  r = await until((x) => x.legs.find((l) => l.id === offered.id)?.state === "to_pickup");
  check("rider accepts the offer from the phone UI", r.ok);
  await rider.close();
}

// --- Marketplace: shelter picks a reachable donor card and confirms; donor confirms; rider claims
await post({ type: "reset", scenario: "market" });
const shelterPg = await ctx.newPage();
await shelterPg.goto(`${BASE}/shelter?s=S2`, { waitUntil: "domcontentloaded" });
await shelterPg.getByRole("button", { name: "Take all" }).first().click({ timeout: 15000 });
await shelterPg.getByRole("button", { name: "Confirm order" }).click();
r = await until((x) => x.market.orders.some((o) => o.shelterId === "S2"));
check("shelter UI places an order with a reachable donor", r.ok);
await shelterPg.getByRole("button", { name: /Suggest the best mix/ }).click();
await shelterPg.getByText(/AI-recommended bundle/i).waitFor({ timeout: 10000 });
check("shelter UI shows an AI-recommended bundle with reasons", true);
r = await until((x) => x.market.orders.some((o) => o.shelterId === "S2" && o.status === "awaiting_rider"), 15000);
check("auto donor confirms the reservation and the trip reaches the board", r.ok);
await shelterPg.close();

// --- Donor: lists supplies with an expiry and sees them in the market
const donorPg = await ctx.newPage();
await donorPg.goto(`${BASE}/donor?d=D1`, { waitUntil: "domcontentloaded" });
await donorPg.getByPlaceholder(/Veg biryani trays/).fill("Smoke test trays");
await donorPg.getByRole("button", { name: "Post listing" }).click({ timeout: 15000 });
r = await until((x) => x.market.listings.some((l) => l.label === "Smoke test trays"));
check("donor UI posts a listing with an expiry", r.ok);
await donorPg.close();

// --- Rider: claims a trip from the board in the phone UI
await post({ type: "reset", scenario: "market" });
await post({ type: "presence", role: "rider", id: "R10" });
const riderPg = await ctx.newPage();
await riderPg.goto(`${BASE}/rider?r=R10`, { waitUntil: "domcontentloaded" });
await riderPg.getByRole("button", { name: "Claim this trip" }).first().click({ timeout: 20000 });
r = await until((x) => x.legs.some((l) => l.riderId === "R10" && l.orderId));
check("rider claims a trip from the board in the phone UI", r.ok);
await riderPg.close();

// --- Responsive: no horizontal overflow on a phone-sized viewport
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
for (const path of ["/", "/admin", "/donor", "/rider", "/shelter", "/impact", "/live"]) {
  const pg = await mobile.newPage();
  await pg.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await pg.waitForTimeout(2200);
  const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${path} has no horizontal overflow at 390px`, over <= 1, `overflow=${over}px`);
  await pg.close();
}
await mobile.close();

// --- Guided demo drives real failures
await post({ type: "reset", scenario: "market" });
await post({ type: "setRate", rate: 2 });
const guide = await ctx.newPage();
await guide.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
await guide.getByRole("button", { name: "Guided demo" }).click({ timeout: 15000 });
await guide.getByRole("button", { name: /Post the request and order the AI bundle/ }).click();
r = await until((x) => x.market.orders.filter((o) => o.shelterId === "S2").length >= 2, 15000);
check("guided demo: AI bundle orders from several donors", r.ok);
await guide.getByRole("button", { name: /Ghost the busiest rider/ }).click();
r = await until((x) => x.riders.some((q) => q.silent));
check("guided demo: ghost step silences a rider", r.ok);
r = await until((x) => x.metrics.ghostRecoveries > 0, 90000);
check("guided demo: the ghosted batch is recovered", r.ok, `ghostRecoveries=${r.s.metrics.ghostRecoveries}`);
await guide.getByRole("button", { name: /Run the formula test/ }).click();
r = await until((x) => x.events.some((e) => e.type === "blocked" && /clean water/i.test(e.text)), 10000);
check("guided demo: formula is blocked for lack of clean water", r.ok);
await guide.close();
await post({ type: "setRate", rate: 0.25 });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
