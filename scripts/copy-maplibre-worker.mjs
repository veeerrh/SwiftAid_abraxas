// MapLibre v6 spawns an ES-module worker. Bundlers rewrite its URL, so we serve it from /public instead.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("maplibre-gl/package.json"));
const src = path.join(pkgDir, "dist", "maplibre-gl-worker.mjs");
const outDir = path.join(process.cwd(), "public", "maplibre");
if (!existsSync(src)) {
  console.error("maplibre worker not found at", src);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
copyFileSync(src, path.join(outDir, "maplibre-gl-worker.mjs"));
console.log("maplibre worker copied to public/maplibre/");
