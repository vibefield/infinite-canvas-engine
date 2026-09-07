// The size presets, seen: each glyph at a dense zoom (the floor bites on the
// fine rung) and a sparse one (the ceiling bites on the coarse rung), preset
// vs open, same scene. Screenshots only.
//   node test/harness/range.mjs → results/range-<glyph>-z<zoom>-<preset|open>.png
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { makeCards } from "@ice/ground/oracle/scene.mjs";
const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
mkdirSync(resolve(app, "results"), { recursive: true });
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9475, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 150_000).unref();
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object'", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  for (const glyph of ["dot", "needle"]) for (const zoom of [0.398, 3.981]) for (const range of ["open", "preset"]) {
    // the product's field settings (reach 60 · needle 5 × 0.55), 48 cards at 0.1 strength like widgets, the pole on
    const s = { cards: makeCards(48).map((c) => ({ ...c, strength: 0.1 })), camX: 13.7, camY: -21.3, zoom, mouseX: 640, mouseY: 400, mouseOn: true, reach: 60, halfLen: 5, theme: "dark", glyph, range, drawFrames: true };
    await q(`window.__ground.setScene(${JSON.stringify(s)}); document.getElementById('legend').style.visibility = 'hidden'`);
    await sleep(500);
    const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(app, "results", `range-${glyph}-z${zoom}-${range}.png`), Buffer.from(data, "base64"));
    console.log(`${glyph.padEnd(6)} z ${zoom}  ${range.padEnd(6)}  ${await q("document.getElementById('stats').textContent")}`);
  }
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(0);
