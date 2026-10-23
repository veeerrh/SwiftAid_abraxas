import { chromium } from "playwright-core";
const base = process.env.BASE ?? "http://localhost:3000";
const out = process.argv[2] ?? ".";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let fails = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) fails++; };

await page.goto(base + "/admin", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

// Demo Studio: run a preset and watch the timeline.
await page.getByRole("button", { name: "Demo Studio" }).click();
const dlg = page.getByRole("dialog", { name: "Demo Studio" });
await dlg.getByText("Flash flood night", { exact: true }).waitFor();
await page.screenshot({ path: `${out}/studio-run.png` });
await dlg.getByRole("button", { name: "Run", exact: true }).nth(1).click();
await dlg.getByText("Running: Flash flood night").waitFor({ timeout: 8000 });
check("preset loads and shows live controls", true);
await dlg.getByRole("button", { name: "Traffic jam" }).click();
await page.waitForTimeout(800);
await dlg.getByRole("button", { name: "Save result" }).click();
await dlg.getByRole("button", { name: /^Compare/ }).click();
check("result saved to compare table", await dlg.getByRole("cell", { name: "Flash flood night" }).first().isVisible());
await dlg.getByRole("button", { name: "Design", exact: true }).click();
await page.screenshot({ path: `${out}/studio-design.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// Intelligence lab: run the benchmark.
await page.getByRole("button", { name: "Intelligence lab" }).click();
const lab = page.getByRole("dialog", { name: /Intelligence lab/ });
await lab.getByRole("button", { name: "Benchmark", exact: true }).click();
await lab.getByRole("button", { name: "Run benchmark" }).click();
await lab.getByText("Hybrid beat greedy").waitFor({ timeout: 60000 });
check("benchmark renders results", true);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/intel-bench.png` });
await lab.getByRole("button", { name: "Stress test", exact: true }).click();
await lab.getByRole("button", { name: "Run stress test" }).click();
await lab.getByText("Hybrid solve").first().waitFor({ timeout: 90000 }).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/intel-stress.png` });
check("no page errors", errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
await browser.close();
process.exit(fails ? 1 : 0);
