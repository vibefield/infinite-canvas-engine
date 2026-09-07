// The content term through a real Chrome — stills, the runs, a live cycle,
// and the cost of textured interiors.
//   node test/harness/content.mjs          → results/content-<what>.png, the checks, and the cost table
//   node test/harness/content.mjs perf     → the cost table only, more rounds
// Stills: the four modes at 1:1 and magnified · the z-runs · a 48-card board
// textured through one page layer (one run). Live: `setContent` swaps a
// card's interior without touching its chrome (the run count follows). Cost:
// 48 cards + frames at zoom 1, plate vs page vs own vs own-srgb, saturated
// batches, medians of alternating rounds — the content term is one tap per
// interior pixel, so the number to watch is the delta over the plate.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { makeCards } from "@ice/ground/oracle/scene.mjs";
const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
mkdirSync(resolve(app, "results"), { recursive: true });
const mode = process.argv[2] ?? "shots";
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9491, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 300_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object' && window.__ground.state.contentReady", { timeoutMs: 20000 })) break; await sleep(200); }
  check(await tab.evaluate("window.__ground.state.contentReady"), "the test residency is built (a 2-layer page array + two own textures)");
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
  const settle = () => tab.evaluate("new Promise((resolve) => { const t0 = performance.now(); const poll = () => { if (!window.__ground.state.needsDraw || performance.now() - t0 > 4000) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))); else requestAnimationFrame(poll); }; poll(); })", { awaitPromise: true, timeoutMs: 15000 });
  const shot = async (name) => { await tab.send("Page.bringToFront"); await settle(); const { data } = await tab.send("Page.captureScreenshot", { format: "png" }); writeFileSync(resolve(app, "results", `content-${name}.png`), Buffer.from(data, "base64")); return data.length; };
  const hide = "for (const el of document.querySelectorAll('#legend, #stats')) el.style.visibility = 'hidden'";
  const one = (x, y, content, extra = {}) => ({ x, y, w: 64, h: 64, r: 8, strength: 1, content, ...extra });
  const base = { camX: 0, camY: 0, mouseX: 640, mouseY: 400, mouseOn: false, reach: 60, halfLen: 5, theme: "dark", style: "product" };
  const modes = [one(200, 200, "page0"), one(400, 200, "page1"), one(600, 200, "own"), one(800, 200, "own-srgb"), { x: 500, y: 540, w: 260, h: 150, r: 14, strength: 1, content: "page0", surface: "note" }];
  const zruns = [one(300, 300, "page0"), one(340, 330, "own"), one(380, 300, "page1"), one(420, 330, "own-srgb"), one(460, 300, "own"), one(340, 380, "plate", { surface: "deep" })];
  const board = (content) => ({ ...base, camX: 13.7, camY: -21.3, zoom: 1, cards: makeCards(48).map((c) => ({ ...c, content })) });

  if (mode === "shots") {
    // runs (card/content.ts): plate and page cards ride whichever run they fall in; a run breaks only where the own texture changes
    for (const [name, s, runs] of [["modes-z1", { ...base, zoom: 1, cards: modes }, 2], ["modes-z2.5", { ...base, zoom: 2.5, camX: 150, camY: 130, cards: modes }, 2], ["zruns", { ...base, zoom: 1, cards: zruns }, 3], ["board-page0", board("page0"), 1], ["board-light-own", { ...board("own"), theme: "light" }, 1]]) {
      await q(`window.__ground.setScene(${JSON.stringify(s)}); ${hide}`);
      const bytes = await shot(name);
      const st = await q("window.__ground.render()");
      const got = await q("window.__ground.ground.frames.runCount");
      check(st.frames === s.cards.length && got === runs && bytes > 60_000, `${name.padEnd(16)} ${st.frames} frames in ${got} run${got === 1 ? "" : "s"} (expected ${runs}) · ${(bytes / 1024).toFixed(0)} KB png`);
    }
    // live: the interior swaps, the chrome does not — the run count follows the own textures
    await q(`window.__ground.setScene(${JSON.stringify({ ...base, zoom: 1, cards: modes.map((c) => ({ ...c, content: "plate" })) })}); ${hide}`); await settle();
    const r0 = await q("window.__ground.render(); window.__ground.ground.frames.runCount");
    await q("window.__ground.setContent(0, 'page0'); window.__ground.setContent(2, 'own'); window.__ground.setContent(3, 'own-srgb')"); await settle();
    const r1 = await q("window.__ground.render(); window.__ground.ground.frames.runCount");
    check(r0 === 1 && r1 === 2, `setContent: plate board = ${r0} run → page0 · own · own-srgb among plates = ${r1} runs (own and own-srgb split it; the plates ride)`);
  }

  // ---- the cost of textured interiors: 48 cards + frames, saturated batches
  const ARM = (n) => `(async () => { const g = window.__ground; const q = g.ground.device.queue; await q.onSubmittedWorkDone();
    const t0 = performance.now(); let cpu = 0;
    for (let i = 0; i < ${n}; i++) { const c0 = performance.now(); g.render(); cpu += performance.now() - c0; }
    await q.onSubmittedWorkDone(); return { ms: (performance.now() - t0) / ${n}, cpu: cpu / ${n} }; })()`;
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(`\ncrossOriginIsolated: ${await q("crossOriginIsolated")}`);
  console.log("  interior        zoom   ms/frame   vs plate   cpu");
  const rounds = mode === "perf" ? 7 : 5;
  for (const z of [1, 2.512]) {
    const R = { plate: [], page0: [], own: [], "own-srgb": [] };
    const C = { plate: [], page0: [], own: [], "own-srgb": [] };
    const names = Object.keys(R);
    for (let round = 0; round < rounds; round++) for (const name of round % 2 ? [...names].reverse() : names) {
      await q(`window.__ground.setScene(${JSON.stringify({ ...board(name), zoom: z })}); ${hide}`); await settle();
      const probe = await tab.evaluate(ARM(4), { awaitPromise: true, timeoutMs: 60000 });
      const B = Math.max(3, Math.min(300, Math.round(25 / Math.max(probe.ms, 0.05))));
      const r = await tab.evaluate(ARM(B), { awaitPromise: true, timeoutMs: 60000 });
      R[name].push(r.ms); C[name].push(r.cpu);
    }
    for (const name of names) console.log(`  ${name.padEnd(14)} ${z.toFixed(2).padStart(5)}   ${med(R[name]).toFixed(3).padStart(8)}   ${(med(R[name]) - med(R.plate) >= 0 ? "+" : "") + (med(R[name]) - med(R.plate)).toFixed(3).padStart(6)}   ${(med(C[name]) * 1000).toFixed(0).padStart(4)} µs`);
  }
  if (logs.length) console.log("logs:", logs.slice(0, 6).join(" | "));
  console.log(`\n${pass} passed, ${failN} failed`);
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(failN ? 1 : 0);
