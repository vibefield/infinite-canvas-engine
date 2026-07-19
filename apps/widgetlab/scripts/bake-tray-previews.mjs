/**
 * Bake GL widget tray previews (2026-07-19): real snapshots for the tray's
 * GL tiles — live GL previews would need a second island runtime, so these
 * are captured from the RUNNING demo scene instead (the iOS-gallery / design-
 * reference approach), in BOTH themes (a light-baked PNG on the dark sheet
 * reads wrong).
 *
 * Usage: node scripts/bake-tray-previews.mjs [port]   (default 5199)
 * Re-run whenever a GL card's look changes. Dev-machine script: uses the
 * npx-cache Playwright + the chromium-1208 build (see the headless recipe).
 * Animated cards bake at whatever pose the capture catches — fine for tiles.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pw = require("/Users/jamesyong/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const EXEC = `${homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const PORT = process.argv[2] ?? "5199";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "tray-previews");
mkdirSync(OUT, { recursive: true });

const browser = await pw.chromium.launch({ headless: true, executablePath: EXEC });

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 2400, height: 1400 }, deviceScaleFactor: 2 });
  await page.addInitScript((dark) => localStorage.setItem("ic-dark-mode", String(dark)), theme === "dark");
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector("canvas");
  await page.waitForTimeout(4500); // PMREM env + first GL paints settle

  // GL types + rects from the live registry/world (never hardcoded).
  const cards = await page.evaluate(async () => {
    const core = await import(
      "/@fs/Users/jamesyong/Projects/project100/infinite-canvas-engine/packages/core/src/index.ts"
    );
    const dbg = window.__iceDebug();
    const seen = new Set();
    const out = [];
    for (const w of dbg.widgets) {
      if (w.type === undefined || seen.has(w.type)) continue;
      if (core.widgets.get(w.type)?.surface !== "gl") continue;
      if (!w.pos || !w.size) continue;
      seen.add(w.type);
      out.push({
        type: w.type,
        x: (w.pos.x - dbg.camera.x) * dbg.camera.zoom,
        y: (w.pos.y - dbg.camera.y) * dbg.camera.zoom,
        w: w.size.w * dbg.camera.zoom,
        h: w.size.h * dbg.camera.zoom,
      });
    }
    return out;
  });

  for (const c of cards) {
    if (c.x < 0 || c.y < 0) {
      console.warn(`skip ${c.type} (${theme}): off-viewport at ${c.x},${c.y}`);
      continue;
    }
    const buf = await page.screenshot({
      clip: { x: c.x, y: c.y, width: c.w, height: c.h },
    });
    writeFileSync(join(OUT, `${c.type}.${theme}.png`), buf);
    console.log(`baked ${c.type}.${theme}.png (${Math.round(c.w)}×${Math.round(c.h)} css px @2x)`);
  }
  await page.close();
}

await browser.close();
console.log(`done → ${OUT}`);
