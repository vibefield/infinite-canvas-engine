// A zoom sweep, the product fade-in window vs the sparser one, same scene: the
// window (mid cell 20 → 40 px), a decade wrap (zoom 0.99 → 1.01), and the
// sparse end. Screenshots only.
//   node test/harness/zoom.mjs → results/zoom-<window>-z<zoom>.png
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
const chrome = await launchChrome({ port: 9477, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 200_000).unref();
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object'", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  const ZOOMS = [0.11, 0.15, 0.2, 0.3, 0.6, 0.99, 1.01, 1.5];
  // two windows: the product's, and the classic grid's literal "nothing under 20 px"
  const MODES = [["uniform", [10, 20]], ["uniform-sparse", [20, 40]]];
  for (const [name, fadeIn] of MODES) for (const zoom of ZOOMS) {
    const s = { cards: makeCards(48).map((c) => ({ ...c, strength: 0.1 })), camX: 13.7, camY: -21.3, zoom, mouseX: 640, mouseY: 400, mouseOn: true, reach: 60, halfLen: 5, theme: "dark", glyph: "dot", fadeIn, drawFrames: true };
    await q(`window.__ground.setScene(${JSON.stringify(s)}); document.getElementById('legend').style.visibility = 'hidden'`);
    await sleep(450);
    const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(app, "results", `zoom-${name}-z${zoom}.png`), Buffer.from(data, "base64"));
    console.log(`${name.padEnd(14)} z ${String(zoom).padEnd(5)} ${(await q("document.getElementById('stats').textContent")).replace(/^ground · \d+ fps · [\d.]+ ms cpu · /, "").slice(0, 150)}`);
  }
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(0);
