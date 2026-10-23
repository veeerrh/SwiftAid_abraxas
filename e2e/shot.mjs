// Usage: node e2e/shot.mjs <path> <out.png> [width] [height] [waitMs]
import { chromium } from "playwright-core";

const [, , path = "/admin", out = "shot.png", w = "1440", h = "900", wait = "6000"] = process.argv;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto("http://localhost:3000" + path, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(JSON.stringify({ errors: errors.slice(0, 8) }));
await browser.close();
