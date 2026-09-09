/**
 * THE COPY'S COST, WITHOUT THE ENGINE (2026-09-09).
 *
 * Drives `hic-micro.html` inside the real widgetlab desktop app (which sets the
 * CanvasDrawElement switches before app.whenReady): N immediate children of one
 * `layoutsubtree` canvas copied into a WebGPU page array with `copyElementImageToTexture`,
 * with no engine in the loop, so the number is Chromium's and nothing else's. One app
 * launch; every config runs in sequence on the same page with a fresh board. GPU-process
 * and renderer CPU come from `app.getAppMetrics()` deltas (×10 on macOS: Electron
 * normalises `percentCPUUsage` by core count).
 *
 * What it measured on Chromium 150.0.7871.114 (Electron 43.1.1, M1 Max, dpr 2): the copy
 * is a FIXED cost per CALL of about 0.58 ms of GPU-process CPU plus about 0.05 ms per card
 * of content, independent of texel count (a 44× texel range moved it 14 %) and of the
 * destination; raw ceiling ≈3,000–3,800 calls/s at ≈1.9 cores of GPU process. One call per
 * page-sized wrapper element carries 23,000 cards/s at a display-capped 120 fps. The record
 * is the draft plan's "HiC pipeline — 2026-09-09" section.
 *
 * Run: `pnpm --filter widgetlab-desktop hic:micro`
 *   MICRO_MS=2000  MICRO_OUT=<dir> (default screenshots/hic-micro/)  MICRO_ONLY=<regex on config name>
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { _electron } = require("playwright-core");
const MS = Number(process.env.MICRO_MS ?? "2000");
const outDir = process.env.MICRO_OUT ? path.resolve(process.env.MICRO_OUT) : path.join(appDir, "screenshots", "hic-micro");
const ONLY = process.env.MICRO_ONLY ? new RegExp(process.env.MICRO_ONLY) : null;
fs.mkdirSync(outDir, { recursive: true });
const log = (m) => console.log(`[micro] ${m}`);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : "—");
const CPU_SCALE = 10;

const S = { n: 192, w: 150, h: 100, content: "stress", anim: "none", mode: "copy" };
const CONFIGS = [
  { name: "base 192 @150x100 stress", ...S },
  { name: "base 192 @150x100 stress +anim", ...S, anim: "compositor" },
  { name: "size 48 @75x50", ...S, n: 48, w: 75, h: 50 },
  { name: "size 48 @150x100", ...S, n: 48 },
  { name: "size 48 @300x200", ...S, n: 48, w: 300, h: 200 },
  { name: "size 48 @512x320", ...S, n: 48, w: 512, h: 320 },
  { name: "content 192 flat", ...S, content: "flat" },
  { name: "content 192 text", ...S, content: "text" },
  { name: "own 192 @150x100", ...S, mode: "own" },
  { name: "wrapper 192 @150x100 (1 call per page)", ...S, mode: "wrapper" },
  { name: "wrapper 192 @150x100 +anim", ...S, mode: "wrapper", anim: "compositor" },
  { name: "wrapper 192 flat", ...S, mode: "wrapper", content: "flat" },
  { name: "draw2d 192 @150x100 (N draws + 1 copy)", ...S, mode: "draw2d" },
  { name: "draw2d 192 +anim", ...S, mode: "draw2d", anim: "compositor" },
  { name: "n 24 @150x100", ...S, n: 24 },
  { name: "n 96 @150x100", ...S, n: 96 },
  { name: "n 384 @150x100", ...S, n: 384 },
  { name: "wrapcap 192 ×1 (per-card, as wrapper)", ...S, mode: "wrapper", wrapCap: 1 },
  { name: "wrapcap 192 ×4", ...S, mode: "wrapper", wrapCap: 4 },
  { name: "wrapcap 192 ×13 (one row)", ...S, mode: "wrapper", wrapCap: 13 },
  { name: "wrapcap 192 ×26 (two rows)", ...S, mode: "wrapper", wrapCap: 26 },
  { name: "wrapcap 192 ×52 (four rows)", ...S, mode: "wrapper", wrapCap: 52 },
  { name: "wrapcap 384 ×13 (one row)", ...S, n: 384, mode: "wrapper", wrapCap: 13 },
  { name: "wrapcap 384 ×52 (four rows)", ...S, n: 384, mode: "wrapper", wrapCap: 52 },
  { name: "screen 192 (one viewport copy)", ...S, mode: "screen" },
  { name: "screen 384 (one viewport copy)", ...S, n: 384, mode: "screen" },
  { name: "screen 192 +anim", ...S, mode: "screen", anim: "compositor" },
  { name: "wrapcap 192 ×13 @300x200", ...S, w: 300, h: 200, mode: "wrapper", wrapCap: 6 },
];

const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
const results = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" || m.text().startsWith("[micro")) console.log(`  [renderer] ${m.text()}`); });
  await page.goto(`file://${path.join(appDir, "hic-micro.html")}`);
  await page.waitForFunction(() => window.__micro !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__micro.ready);
  const host = await page.evaluate(() => window.__micro.host());
  log(`host: ${JSON.stringify(host)}`);
  const metrics = async () => app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })));
  const fold = (ms) => { const o = { renderer: 0, gpu: 0 }; for (const m of ms) { if (m.type === "Tab") o.renderer += m.cpu * CPU_SCALE; if (m.type === "GPU") o.gpu += m.cpu * CPU_SCALE; } return o; };

  for (const c of CONFIGS) {
    if (ONLY && !ONLY.test(c.name)) continue;
    const board = await page.evaluate((cc) => window.__micro.setup(cc), c);
    await new Promise((r) => setTimeout(r, 500));
    await metrics();
    const w = await page.evaluate((ms) => window.__micro.run({ ms }), MS);
    const cpu = fold(await metrics());
    const drain = await page.evaluate(() => window.__micro.drain());
    const inkA = await page.evaluate(() => window.__micro.ink(0));
    const inkZ = await page.evaluate((i) => window.__micro.ink(i), c.n - 1);
    const cards = c.n;
    const cardsPerS = c.mode === "wrapper" || c.mode === "draw2d" ? cards * w.fps : w.copiesPerS;
    const gpuMsPerCard = (cpu.gpu / 100) * 1000 / cardsPerS;
    const gpuMsPerCall = (cpu.gpu / 100) * 1000 / w.copiesPerS;
    const row = { ...c, board, window: w, cpu, drainMs: drain, ink: inkA, inkLast: inkZ, cardsPerS, gpuMsPerCard, gpuMsPerCall };
    results.push(row);
    log(`${c.name.padEnd(42)} texels ${String(board.texels).padStart(7)} layers ${String(board.layers).padStart(2)} · ${f1(w.fps).padStart(5)} fps · calls/s ${f1(w.copiesPerS).padStart(7)} cards/s ${f1(cardsPerS).padStart(7)} · main ${f3(w.mainMsPerCopy)} ms/call ${f2(w.copyMsPerFrame)} ms/frame · cpu renderer ${f1(cpu.renderer)}% gpu ${f1(cpu.gpu)}% → gpu ${f3(gpuMsPerCall)} ms/call ${f3(gpuMsPerCard)} ms/card · drain ${f1(drain)} ms · ink ${inkA ? `${inkA.ink}/${inkA.total}` : "—"} last ${inkZ ? `${inkZ.ink}/${inkZ.total}` : "—"} · errors ${w.gpuErrors}`);
  }
  fs.writeFileSync(path.join(outDir, `micro-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ host, ms: MS, results }, null, 1));
} finally {
  await app.close();
}
