// Usage: node e2e/shot2.mjs <path> <out.png> <w> <h> <theme> [waitMs]
import { chromium } from "playwright-core";
const [, , path = "/admin", out = "shot.png", w = "1440", h = "900", theme = "dark", wait = "5000"] = process.argv;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await ctx.addInitScript((t) => { try { localStorage.setItem("swiftaid-theme", t); } catch {} }, theme);
const page = await ctx.newPage();
await page.goto("http://localhost:3000" + path, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
