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

for (const [path, text] of [["/", "before it spoils"], ["/impact", "Impact"], ["/live", "Happening now"], ["/donor", "Donate surplus"], ["/shelter", "Capacity"], ["/rider", "Playing as"], ["/judge", "Judge mode"]]) {
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

// --- Shelter portal closes intake
await post({ type: "reset", scenario: "quiet" });
const shelter = await ctx.newPage();
await shelter.goto(`${BASE}/shelter?s=S2`, { waitUntil: "domcontentloaded" });
await shelter.getByRole("switch", { name: /Accepting deliveries/ }).click({ timeout: 10000 });
r = await until((x) => x.shelters.find((q) => q.id === "S2").open === false);
check("shelter portal closes intake", r.ok);
await shelter.close();

// --- Donor portal: AI intake (offline parser) → post → journey
await post({ type: "reset", scenario: "quiet" });
const donor = await ctx.newPage();
await donor.goto(`${BASE}/donor?d=D1`, { waitUntil: "domcontentloaded" });
await donor.getByPlaceholder(/180 cooked meals/).fill("60 cooked meals, spoil in 90 minutes");
await donor.getByRole("button", { name: /Analyze with AI/ }).click();
await donor.getByText(/review and confirm/i).waitFor({ timeout: 10000 });
check("donor intake produces an editable AI draft", true);
await donor.getByRole("button", { name: /^Post from/ }).click();
r = await until((x) => x.batches.some((b) => b.qty === 60) && x.legs.length > 0);
check("posting creates and dispatches the batch", r.ok);
await donor.getByText(/journey of your donation/i).waitFor({ timeout: 8000 });
check("donor sees the journey tracker", true);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
