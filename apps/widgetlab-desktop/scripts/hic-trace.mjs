/**
 * THE COPY'S COST, TRACED (2026-09-09).
 *
 * Launches the widgetlab desktop app on the stress rig (`dist/stress.html`, gpu arm by
 * default), reaches the steady state of the compositor-animation phase, records a Chrome
 * trace for TRACE_MS through Electron's `contentTracing`, and saves it beside the window's
 * counters. The trace is what named the bottleneck: per element copy the GPU process's
 * main thread creates and destroys one IOSurface-backed shared image, rasterises the
 * cached paint record through OOP raster as a Skia Graphite recording with its own Metal
 * submit, wraps the result for Dawn and blits it with CopyTextureForBrowser — 8 GPU-channel
 * requests and 4 command-buffer flushes per copy, about 0.5 ms of that one thread, whatever
 * the card's size — and past its saturation the renderer's main thread blocks in
 * command-buffer flow control (`GpuChannel::WaitForGetOffsetInRange`), which is what a CPU
 * profile reports as time "inside" `copyElementImageToTexture`.
 *
 * Aggregate the JSON by (process, thread, event name); a 2 s window at 192 cards is
 * ≈1.3 M events / 240 MB, so stream or use a script with room (the record's analyzer was
 * Python: count, total and max duration per name, divided by the window's copy count).
 *
 * Run: `pnpm --filter widgetlab-desktop hic:trace`
 *   TRACE_N=192  TRACE_ARM=gpu  TRACE_MS=2000  TRACE_OUT=<dir> (default screenshots/hic-trace/)
 *   TRACE_COPY=element|batched  TRACE_BUDGET=off|adaptive|<n>  — DomRender's levers, as the stress rig takes them
 *   TRACE_PHASE=drag — trace the gesture set's pickup (the dom arm's grab of card 0) instead of the animation window
 *   TRACE_CATS=<comma list> to override the category set
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { _electron } = require("playwright-core");
const N = Number(process.env.TRACE_N ?? "192");
const ARM = process.env.TRACE_ARM ?? "gpu";
const TRACE_MS = Number(process.env.TRACE_MS ?? "2000");
const outDir = process.env.TRACE_OUT ? path.resolve(process.env.TRACE_OUT) : path.join(appDir, "screenshots", "hic-trace");
/** The levers (2026-09-09): `TRACE_COPY=element|batched`, `TRACE_BUDGET=off|adaptive|<n>` reach the rig page as `copy` and `budget`. */
const TUNING = `${process.env.TRACE_COPY ? `&copy=${process.env.TRACE_COPY}` : ""}${process.env.TRACE_BUDGET ? `&budget=${process.env.TRACE_BUDGET}` : ""}`;
const VARIANT = `${process.env.TRACE_COPY ?? "element"}-${process.env.TRACE_BUDGET ?? "nobudget"}`;
fs.mkdirSync(outDir, { recursive: true });
const log = (m) => console.log(`[trace] ${m}`);

const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`); });
  await page.goto(`file://${path.join(appDir, "dist", "stress.html")}?arm=${ARM}&n=${N}${TUNING}`);
  await page.waitForFunction(() => window.__stressRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__stressRig.ready);
  const mounted = await page.evaluate(() => window.__stressRig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  const board = await page.evaluate(() => window.__stressRig.board());
  log(`board: cards ${board.cards} hosts ${board.hostsMounted} band ${board.band} zoom ${board.zoom} layers ${board.pagesLayers}`);
  if (board.cards !== N || board.hostsMounted !== N) throw new Error("board did not mount");
  await page.evaluate((ms) => window.__stressRig.window(ms), 600);
  /** `TRACE_PHASE=drag` traces the gesture set's pickup (a grab on card 0 and the carry) instead of the animation window. */
  const PHASE = process.env.TRACE_PHASE === "drag" ? "drag" : "compositor";
  if (PHASE === "compositor") {
    const a = await page.evaluate((m) => window.__stressRig.anim(m), "compositor");
    log(`anim: ${JSON.stringify(a)}`);
    await page.evaluate((ms) => window.__stressRig.window(ms), 800);
  }

  const cats = await app.evaluate(({ contentTracing }) => contentTracing.getCategories());
  fs.writeFileSync(path.join(outDir, "categories.json"), JSON.stringify(cats, null, 1));
  const want = process.env.TRACE_CATS
    ? process.env.TRACE_CATS.split(",")
    : cats.filter((c) => /^(toplevel|blink|blink\.animations|cc|gpu|gpu\.angle|gpu\.dawn|viz|skia|disabled-by-default-skia|disabled-by-default-skia\.gpu|disabled-by-default-gpu\.dawn|disabled-by-default-gpu\.service|disabled-by-default-gpu\.decoder|disabled-by-default-blink\.debug|disabled-by-default-toplevel\.flow|ipc|mojom|disabled-by-default-devtools\.timeline|disabled-by-default-devtools\.timeline\.frame|latency|benchmark)$/.test(c));
  log(`categories available: ${cats.length}; recording ${want.length}: ${want.join(", ")}`);

  const metrics = async () => app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })));
  await metrics();
  await app.evaluate(({ contentTracing }, w) => contentTracing.startRecording({ included_categories: w, excluded_categories: [] }), want);
  const t0 = Date.now();
  const w = PHASE === "drag"
    ? await page.evaluate((ms) => window.__stressRig.drag(ms), Math.max(600, TRACE_MS))
    : await page.evaluate((ms) => window.__stressRig.window(ms), TRACE_MS);
  if (PHASE === "drag") await page.evaluate((ms) => window.__stressRig.release(ms), 300);
  const file = path.join(outDir, `trace-${ARM}-${N}-${VARIANT}${PHASE === "drag" ? "-drag" : ""}.json`);
  const written = await app.evaluate(({ contentTracing }, f) => contentTracing.stopRecording(f), file);
  const cpu = await metrics();
  const fold = { renderer: 0, gpu: 0 }; for (const m of cpu) { if (m.type === "Tab") fold.renderer += m.cpu; if (m.type === "GPU") fold.gpu += m.cpu; }
  log(`${PHASE}: ${w.frames} frames in ${w.wallMs.toFixed(0)} ms = ${w.fps.toFixed(1)} fps · rAF ${w.rafMsPerFrame.toFixed(2)} ms/frame · copies ${w.delta.copies} submits ${w.delta.submits} dirt ${w.delta.dirtied ?? "—"}${PHASE === "drag" ? ` · pickup longest frame ${w.pickupMaxMs.toFixed(1)} ms` : ""} · cpu renderer ${(fold.renderer * 10).toFixed(0)}% gpu ${(fold.gpu * 10).toFixed(0)}% (×10 calibration) · recorded ${Date.now() - t0} ms`);
  const st = fs.statSync(written);
  log(`trace: ${written} (${(st.size / 1024 / 1024).toFixed(1)} MB) head: ${fs.readFileSync(written, { encoding: "utf8", flag: "r" }).slice(0, 80).replace(/\n/g, " ")}`);
  fs.writeFileSync(path.join(outDir, `window-${ARM}-${N}-${VARIANT}.json`), JSON.stringify({ n: N, arm: ARM, variant: VARIANT, board, window: w, cpu: fold, categories: want }, null, 1));
} finally {
  await app.close();
}
