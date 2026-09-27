// rig:stress — THE GATES of design-015 §11.4 on a desk of 1,000 mixed objects (D6). One scene — notes, mini mats with
// insides, prints, whiteboards with strokes, a notebook, a desk calendar on a golden spiral over a 7,200-unit field, ~5 %
// of it in a 1200 × 800 view at zoom 1 — driven through `window.__desk`, and every number the doc gates read from the
// instruments the desk carries: the engine's `step` timed from outside (api.ts `perf.arm`), the layer's own flush time,
// the builder's per-entity work counters (`stats().work` — the O(1)-pan witness: a camera move resolves NOTHING), the
// queue instrument's uploads by label (`paper`, `minimat`, `board`, `mat`, `marks` …) and its submits, V8's heap between a
// `gc()` and the last frame (the allocation per frame), the paper writing's raster count, the hand's desk-copy count and
// `holdCost`. THE METHOD: medians and minima over ROUNDS rounds of each scenario, the host's 1-minute load average beside
// every row (this Mac is loaded; a number without its load is folklore), the tab brought to front before every frame wait
// (a hidden tab never fires rAF), the GPU drained around the saturated batch. Headless Chrome ONLY — never Electron.
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:stress [scenario-regex]
//   DESK_STRESS_ROUNDS=7 (rounds) · DESK_STRESS_N=1000 (objects) · DESK_STRESS_GATE=1 (assert §11.4 — the exit code is the verdict)
//   DESK_STRESS_OUT=<dir> (the JSON of every round; default apps/desk/results)
//
// THE SCENARIOS. `idle`: 240 frames after the desk settled — submits (0), the main thread's ms per second (the whole step and
// the desk's flush alone), the engine's steps (K7a: the loop SLEEPS at rest — none); then 1 s of the page alone between two CDP
// readings, no rig code running in it: every task its main thread ran (`Performance.getMetrics` TaskDuration) and its script. `pan`: 120 frames of the camera moving 8 px a frame — the step ms a frame (median, max), the desk's
// share, the builder's resolves/records a frame, the uploads a frame by kind, the heap's growth a frame, the frames' cadence;
// then the saturated batch (`holdCost.rest`): the GPU's ms for the frame at the pan's end. `zoom`: the same, the camera
// zooming 0.5 % a frame about the view's centre. `drag`: the 50 notes nearest the view's centre selected and dragged 60 frames
// by the mouse — the step ms a frame, the frames drawn a second. `edit`: a character typed into a written note — how many
// rasters the writing drew (1) and how many records the builder made in that frame. `hold`: the notebook picked up — the desk
// copies made while it is held (0 more), `holdCost`'s copy (the blur, once), hand (a held frame) and rest. K2 (design-016 §4): the pan
// also runs once with the GPU profiler ARMED — the real frames' GPU span p50/p95 and their draws / pipelines / bind groups a frame —
// and the frame at its end is measured per KIND by ablation (`perf.kindCost`, an A/A control beside); the page must be
// cross-origin isolated (checked: every clock here is performance.now()'s). K6b (design-016 §6): `zoom-written`, LAST (it
// stages its own desk) — 240 written notes and 8 whiteboards zoomed out 1 → 0.35 and back in to 0.72, a fresh desk each round (the band
// ladder's hysteresis would otherwise leave every later round nothing to cross): each step's ms beside THAT step's rasters,
// replays and records (`perf.probe`), p50 / p95 / the worst frame.
// K7a (design-016 §6): `books` — a notebook and a desk calendar on screen, a 2 px pan: the two layered kinds' passes a frame, their
// GPU ms (the profiler's labelled passes by prefix), the span and the memory by label — the numbers the books' layers answer.
//
// The fps gates are stated against THE MACHINE'S REFRESH: headless Chrome's rAF runs at 60 Hz whatever the display, so "120
// fps" cannot be witnessed by counting frames here — it is asserted as a FRAME BUDGET: main-thread JS ≤ 2 ms AND JS + GPU ≤
// 8.33 ms (120 Hz) for the pan, ≤ 9.09 ms (110 Hz) for the drag. The exit code: 0 once the table is printed (and, under
// DESK_STRESS_GATE=1, every gate held); 1 for a failed preflight, a throw or a failed gate; 2 for the watchdog.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { loadavg } from "node:os";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const ROUNDS = Number(process.env.DESK_STRESS_ROUNDS ?? 7);
const N = Number(process.env.DESK_STRESS_N ?? 1000);
const GATE = process.env.DESK_STRESS_GATE === "1";
const OUT = resolve(process.env.DESK_STRESS_OUT ?? resolve(app, "results"));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => loadavg()[0].toFixed(2);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length === 0 ? Number.NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const min = (xs) => Math.min(...xs);
const max = (xs) => Math.max(...xs);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
/** Nearest-rank percentile. */
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length === 0 ? Number.NaN : s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };

// ── THE SCENE: 1,000 root objects on a golden spiral (per 40: 4 mini mats with two notes inside, 6 prints, 1 whiteboard, 29 notes),
//    a notebook and a desk calendar; every third note written. The camera at the field's centre, zoom 1.
const TEXTS = ["Remember the milk", "Call the studio back before five", "The desk is the document", "idle-zero is a law", "one renderer under the camera", "a pan writes the camera and nothing else"];
const scribble = (i) => [
  { ink: "blue", tip: "bullet", points: Array.from({ length: 12 }, (_, k) => [40 + k * 32, 80 + Math.sin(k * 0.9 + i) * 30]) },
  { ink: "green", tip: "fine", points: Array.from({ length: 10 }, (_, k) => [60 + k * 36, 200 + Math.cos(k * 1.1 + i) * 25]) },
  { ink: "red", tip: "chisel", points: Array.from({ length: 6 }, (_, k) => [260 + k * 30, 120 + Math.sin(k + i) * 20]) },
];
// K6a (design-016 §6): the REAL pictures a mixed desk's prints carry — generated JPEGs (rig/scene-kinds.ts `GeneratedPicture`) of every
// size up to PICTURE_MAX, two seeds each: 24 distinct pictures, decoded by the product's own decoder as a pasted file is
export const PICTURES = [[4096, 4096], [4096, 3072], [3072, 4096], [3264, 2448], [2048, 1536], [1600, 1200], [1024, 768], [800, 600], [640, 480], [512, 512], [384, 256], [256, 256]]
  .flatMap(([w, h], i) => [{ w, h, seed: 1 + 2 * i }, { w, h, seed: 2 + 2 * i }]);
/**
 * The stress scene. `mixed`: the things in SIBLING ORDER as the spiral lays them (a print or a whiteboard between notes — the
 * real desk; the default groups each kind into one run, the best case). `pictures`: every print carries a real picture.
 */
export function stressScene(n = N, { mixed = false, pictures = false } = {}) {
  const things = [];
  const notes = [];
  const minimats = [];
  const boards = [];
  const prints = [];
  const R = 3600;   // the spiral's spacing ≈ 200 units: a dense desk, ~50 root objects in the view at zoom 1
  for (let i = 0; i < n; i++) {
    const a = i * 2.399963;
    const rad = R * Math.sqrt((i + 1) / n);
    const x = Math.round(Math.cos(a) * rad);
    const y = Math.round(Math.sin(a) * rad);
    const k = i % 40;
    if (k < 4) minimats.push({ x, y, w: 320 + ((i * 37) % 160), h: 240 + ((i * 53) % 120), name: `Mat ${i}`, inside: { notes: [{ x: -60, y: -30, seed: 100 + i }, { x: 70, y: 40, seed: 200 + i, text: "inside" }], minimats: [] } });
    else if (k < 10) { const p = { x, y, angle: (((i * 7) % 21) - 10) / 100, picture: pictures ? PICTURES[prints.length % PICTURES.length] : null }; prints.push(p); things.push({ ...p, kind: "print" }); }
    else if (k === 10) { const b = { x, y, strokes: scribble(i) }; boards.push(b); things.push({ ...b, kind: "board" }); }
    else { const t = { x, y, seed: 1 + i, text: i % 3 === 0 ? TEXTS[i % TEXTS.length] : "" }; notes.push(t); things.push({ ...t, kind: "note" }); }
  }
  const books = [{ x: 420, y: -260, cover: "orbit", seed: 7 }];
  const calendars = [{ x: -2400, y: 1800, month: "2026-09", weekStart: 1 }];
  if (mixed) return { camX: -600, camY: -400, zoom: 1, theme: "light", minimats, things: [...things, ...books.map((b) => ({ ...b, kind: "book" }))], calendars, notes, boards, prints, books };
  return { camX: -600, camY: -400, zoom: 1, theme: "light", notes, minimats, boards, prints, books, calendars };
}

/**
 * K6b (design-016 §1.3, §6): THE WRITTEN DESK — 240 notes, EVERY one written, on a 20 × 12 grid 260 units apart (5,200 × 3,120,
 * centred on the origin), and 8 whiteboards with strokes on a ring past the cull at zoom 1 (a board's reach is ~260 units: each
 * enters it between zoom 0.72 and 0.5 on the way out, no two in one frame but two). The camera on the origin at zoom 1.
 */
export function writtenScene() {
  const notes = [];
  for (let j = 0; j < 12; j++) for (let i = 0; i < 20; i++) notes.push({ x: Math.round((i - 9.5) * 260), y: Math.round((j - 5.5) * 260), seed: 1 + i + 20 * j, text: TEXTS[(i + 3 * j) % TEXTS.length] });
  const boards = [[-1700, 0], [1900, 0], [0, -1250], [0, 1400], [-1800, -1000], [2000, -1100], [-2100, 1150], [1700, 1300]].map(([x, y], i) => ({ x, y, strokes: scribble(i) }));
  return { camX: -600, camY: -400, zoom: 1, theme: "light", notes, boards };
}

const die =(what, cmd) => { console.log(`PREFLIGHT FAIL: ${what}\n  produce it with:  ${cmd}`); process.exit(1); };
if (!existsSync(resolve(app, "dist/rig.html"))) die("the desk's build is missing (apps/desk/dist/rig.html)", "pnpm --filter ./apps/desk build");

async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const free = await new Promise((r) => { const s = createServer(); s.once("error", () => r(false)); s.listen(port, "127.0.0.1", () => s.close(() => r(true))); });
    if (free) return port;
  }
  throw new Error(`no free CDP port in ${from}…${from + 39}`);
}
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
// V8's gc() exposed and a young generation big enough that a 120-frame batch never scavenges (the heap's growth IS the allocation):
// its size PINNED, min and max (K7a — a max alone let it start small and scavenge mid-batch, so the growth read the scavenger's
// phase: 42 or 122 KB of a pan that allocated 500 KB a frame); precise heap readings
const chrome = await launchChrome({ port: await freePort(9611), headless: !process.env.DESK_HEADED, extraArgs: ["--js-flags=--expose-gc --min-semi-space-size=128 --max-semi-space-size=128", "--enable-precise-memory-info"] });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 900_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };
const gate = (ok, msg) => { if (GATE) check(ok, `GATE  ${msg}`); else console.log(`  ${ok ? "ok  " : "MISS"}  gate  ${msg}`); };
const rows = [];
const report = {};

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable"); await tab.send("Performance.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  const front = () => tab.send("Page.bringToFront");
  await front();
  const q = (js, timeoutMs = 20000) => tab.evaluate(js, { timeoutMs });
  const qa = (js, timeoutMs = 60000) => tab.evaluate(js, { awaitPromise: true, timeoutMs });
  const mouse = async (type, x, y, extra = {}) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  const settle = async (ms = 8000) => { await front(); return qa(`window.__desk.settle(${ms})`); };
  const wantCase = (name) => only === null || only.test(name);

  // ── the scene, in the world
  const scene = stressScene(N);
  const t0 = performance.now();
  const staged = await qa(`window.__desk.setScene(${JSON.stringify(scene)})`, 120000);
  await settle(20000);
  const spawnMs = performance.now() - t0;
  const st0 = await q("window.__desk.stats()");
  const gcOk = await q("window.__desk.perf.gc()");
  const heapOk = await q("window.__desk.perf.heap() !== null");
  await q("window.__desk.perf.arm()");
  const wanted = scene.notes.length + scene.minimats.length + scene.boards.length + scene.prints.length + scene.books.length + scene.calendars.length;
  check(staged.objects === wanted && st0.active === wanted, `the scene is in the world: ${staged.objects} root objects (${scene.notes.length} notes, ${scene.minimats.length} mini mats with insides, ${scene.prints.length} prints, ${scene.boards.length} whiteboards, a notebook, a desk calendar), ${st0.active} Active; spawned and settled in ${(spawnMs / 1000).toFixed(1)} s; ${st0.objects} drawn, ${st0.culled} culled at zoom 1`);
  check(gcOk && heapOk, `the heap instruments are here (gc ${gcOk}, precise heap ${heapOk})`);
  // K2: every clock below is performance.now()'s — at 5 µs only when the page is cross-origin isolated (100 µs-coarse otherwise)
  const coi = await q("crossOriginIsolated");
  check(coi === true, `the page is cross-origin isolated — performance.now() resolves µs, not 100 µs (crossOriginIsolated ${coi})`);
  report.scene = { objects: staged.objects, active: st0.active, drawn: st0.objects, culled: st0.culled, spawnMs };
  console.log(`  load ${load()} · the window ${JSON.stringify(await q("window.__desk.viewport()"))}`);

  /** Diff two perf readings: the steps between (the after's samples), the flush, the uploads by label, the submits, the builder's work, the redraws. */
  const diff = (a, b) => {
    const uploads = {};
    for (const k of new Set([...Object.keys(a.uploads), ...Object.keys(b.uploads)])) uploads[k] = { writes: (b.uploads[k]?.writes ?? 0) - (a.uploads[k]?.writes ?? 0), bytes: (b.uploads[k]?.bytes ?? 0) - (a.uploads[k]?.bytes ?? 0) };
    const work = {};
    for (const k of Object.keys(b.totals)) work[k] = b.totals[k] - a.totals[k];
    // the root passes' persistent record stores (D6, design-015 §4.3): records packed and uploaded, draw lists rewritten, summed over the kinds
    const records = { written: 0, bytes: 0, orderWrites: 0 };
    for (const k of new Set([...Object.keys(a.records ?? {}), ...Object.keys(b.records ?? {})])) {
      for (const f of Object.keys(records)) records[f] += (b.records?.[k]?.[f] ?? 0) - (a.records?.[k]?.[f] ?? 0);
    }
    return { steps: b.steps, flush: { ticks: b.flush.ticks - a.flush.ticks, ms: b.flush.ms - a.flush.ms, frames: b.flush.frames - a.flush.frames, frameMs: b.flush.frameMs - a.flush.frameMs }, uploads, submits: b.submits - a.submits, work, records, redraws: b.redraws - a.redraws };
  };
  /** One driven run in the page: `frames` rAFs, the camera written each from the start by (dx, dy) and ×dz about the view's centre; the heap read after a gc before and at the end. */
  const drive = async (frames, cam, dx, dy, dz) => {
    await front();
    return qa(`(async () => {
      const d = window.__desk;
      const cx = ${cam.x} + 600 / ${cam.zoom}, cy = ${cam.y} + 400 / ${cam.zoom};
      d.setCamera({ x: ${cam.x}, y: ${cam.y}, zoom: ${cam.zoom} });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      d.perf.gc();
      const h0 = d.perf.heap();
      const before = d.perf.take();
      const t0 = performance.now();
      let i = 0;
      await new Promise((r) => { const f = () => { i++; const z = ${cam.zoom} * Math.pow(${dz}, i); d.setCamera({ x: cx - 600 / z + ${dx} * i, y: cy - 400 / z + ${dy} * i, zoom: z }); if (i >= ${frames}) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      await new Promise((r) => requestAnimationFrame(r));
      const t1 = performance.now();
      const h1 = d.perf.heap();
      const after = d.perf.take();
      return { ms: t1 - t0, h0, h1, before, after, stats: d.stats() };
    })()`);
  };
  /** K2's armed pan (design-016 §4): 120 frames of the pan with the GPU profiler ARMED — the real frames' GPU span, their draws, instances, pipelines, bind groups, by kind. */
  const armedPan = async (cam, dx = 8) => {
    await q("window.__gpuOff = window.__desk.perf.gpu().arm(); 0");
    const armedRun = await drive(120, cam, dx, 0, 1);
    await qa("new Promise((r) => setTimeout(r, 300))");   // the last readbacks land
    const late = (await q("window.__desk.perf.take()")).gpu.frames;
    await q("window.__gpuOff(); 0");
    const gf = [...armedRun.after.gpu.frames, ...late].filter((f) => f.kind === "frame");
    const spans = gf.flatMap((f) => (f.span !== null ? [f.span] : []));
    const busies = gf.flatMap((f) => (f.busy !== null ? [f.busy] : []));
    const per = (k) => median(gf.map((f) => f.counts[k]));
    const kinds = [...new Set(gf.flatMap((f) => Object.keys(f.byKind)))];
    // K7a: the labelled passes by their label's prefix (`notebook/shadow 0` → notebook) — how many a frame, and their GPU ms summed
    const prefixes = [...new Set(gf.flatMap((f) => (f.passes ?? []).map((p) => p.label.split("/")[0])))];
    const passesOf = (f, k) => (f.passes ?? []).filter((p) => p.label.split("/")[0] === k);
    const timedFrames = gf.filter((f) => f.span !== null);
    return {
      passesByPrefix: Object.fromEntries(prefixes.map((k) => [k, { n: median(gf.map((f) => passesOf(f, k).length)), ms: pct(timedFrames.map((f) => passesOf(f, k).reduce((a, p) => a + (p.end - p.begin), 0)), 0.5) }])),
      frames: gf.length, timed: spans.length, dropped: gf.filter((f) => f.timing === "dropped").length, quantised: gf.some((f) => f.quantised === true),
      span: { p50: pct(spans, 0.5), p95: pct(spans, 0.95), max: max(spans) },
      busy: { p50: pct(busies, 0.5), p95: pct(busies, 0.95) },
      draws: per("draws"), instances: per("instances"), pipelines: per("pipelines"), bindGroups: per("bindGroups"), passes: per("passes"), submits: per("submits"),
      byKind: Object.fromEntries(kinds.map((k) => [k, median(gf.map((f) => f.byKind[k]?.draws ?? 0))])),
      instancesByKind: Object.fromEntries(kinds.map((k) => [k, median(gf.map((f) => f.byKind[k]?.instances ?? 0))])),
      armedStepMs: median(armedRun.after.steps.slice(-120)), load: load(),
    };
  };
  const MB = (b) => `${(b / 1048576).toFixed(1)} MB`;
  /** The memory ledger (K2) by label, heaviest first, and the raster budget (D6) — what the GPU holds, and what the budget sees of it. */
  const memoryNow = async () => {
    const ledger = await q("window.__desk.handle.gpuMemory()?.read() ?? null");
    const budget = await q("window.__desk.memory()");
    return { ledger, budget };
  };
  const memoryLine = (m) => `${MB(m.ledger?.total ?? 0)} live (${Object.entries(m.ledger?.byLabel ?? {}).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8).map(([k, v]) => `${k} ${MB(v.bytes)}`).join(" · ")}) · budget ${MB(m.budget.used)} of ${MB(m.budget.cap)} (${Object.entries(m.budget.byOwner).map(([k, v]) => `${k} ${MB(v.bytes)} × ${v.entries}`).join(" · ")}), ${m.budget.evictions} evictions`;
  const summarise = (label, runs, frames) => {
    const perRound = runs.map((r) => {
      const d = diff(r.before, r.after);
      const steps = d.steps.slice(-frames);   // the frames driven (the take before the drive drained the rest)
      const upl = Object.fromEntries(Object.entries(d.uploads).map(([k, v]) => [k, v.bytes / Math.max(d.redraws, 1)]));
      // …and the COUNT of queue writes a frame by label (K4a, design-016 K-L3: one view block per slot — the calls, not only the bytes)
      const wrt = Object.fromEntries(Object.entries(d.uploads).map(([k, v]) => [k, v.writes / Math.max(d.redraws, 1)]));
      return {
        stepMed: median(steps), stepMax: max(steps), stepMean: mean(steps),
        flushPerFrame: d.flush.frameMs / Math.max(d.flush.frames, 1),
        resolvedPerFrame: d.work.resolved / Math.max(d.redraws, 1), recordedPerFrame: d.work.recorded / Math.max(d.redraws, 1), visitedPerFrame: d.work.visited / Math.max(d.redraws, 1), queriedPerFrame: d.work.queried / Math.max(d.redraws, 1), sortedPerFrame: d.work.sorted / Math.max(d.redraws, 1),
        uploadsPerFrame: upl, bytesPerFrame: Object.values(d.uploads).reduce((a, v) => a + v.bytes, 0) / Math.max(d.redraws, 1),
        writesByLabel: wrt, writesPerFrame: Object.values(d.uploads).reduce((a, v) => a + v.writes, 0) / Math.max(d.redraws, 1),
        writtenPerFrame: d.records.written / Math.max(d.redraws, 1), orderWrites: d.records.orderWrites,
        allocPerFrame: (r.h1 - r.h0) / frames, fps: (frames * 1000) / r.ms, redraws: d.redraws, submits: d.submits, drawn: r.stats.objects, culled: r.stats.culled, load: r.load,
      };
    });
    const col = (k) => perRound.map((p) => p[k]);
    const s = {
      label, rounds: perRound.length, frames,
      stepMs: { median: median(col("stepMed")), min: min(col("stepMed")), maxMedian: median(col("stepMax")) },
      flushMs: { median: median(col("flushPerFrame")), min: min(col("flushPerFrame")) },
      resolved: { median: median(col("resolvedPerFrame")), min: min(col("resolvedPerFrame")) },
      recorded: { median: median(col("recordedPerFrame")), min: min(col("recordedPerFrame")) },
      visited: { median: median(col("visitedPerFrame")) }, queried: { median: median(col("queriedPerFrame")) }, sorted: { median: median(col("sortedPerFrame")) },
      bytes: { median: median(col("bytesPerFrame")), min: min(col("bytesPerFrame")) },
      writes: { median: median(col("writesPerFrame")), min: min(col("writesPerFrame")), byLabel: Object.fromEntries([...new Set(perRound.flatMap((p) => Object.keys(p.writesByLabel)))].map((k) => [k, median(perRound.map((p) => p.writesByLabel[k] ?? 0))])) },
      written: { median: median(col("writtenPerFrame")), max: max(col("writtenPerFrame")) }, orderWrites: { median: median(col("orderWrites")), max: max(col("orderWrites")) },
      uploads: Object.fromEntries([...new Set(perRound.flatMap((p) => Object.keys(p.uploadsPerFrame)))].map((k) => [k, median(perRound.map((p) => p.uploadsPerFrame[k] ?? 0))])),
      alloc: { median: median(col("allocPerFrame")), min: min(col("allocPerFrame")) },
      fps: { median: median(col("fps")), min: min(col("fps")) },
      redraws: median(col("redraws")), submits: median(col("submits")), drawn: median(col("drawn")), culled: median(col("culled")), loads: col("load"),
      perRound,
    };
    report[label] = s;
    return s;
  };
  const printDrive = (s) => {
    console.log(`-- ${s.label} · ${s.rounds} rounds × ${s.frames} frames · load ${s.loads.join(" ")} --`);
    console.log(`  step ms/frame        median ${fmt(s.stepMs.median)} · min ${fmt(s.stepMs.min)} · the rounds' max frames' median ${fmt(s.stepMs.maxMedian)}`);
    console.log(`  the desk's flush     median ${fmt(s.flushMs.median)} ms/frame · min ${fmt(s.flushMs.min)}`);
    console.log(`  builder work/frame   resolved ${fmt(s.resolved.median, 1)} (min ${fmt(s.resolved.min, 1)}) · recorded ${fmt(s.recorded.median, 1)} · visited ${fmt(s.visited.median, 0)} · queried ${fmt(s.queried.median, 0)} · sorted ${fmt(s.sorted.median, 0)}`);
    console.log(`  records written/frame ${fmt(s.written.median, 2)} (the root stores; the most in a round ${fmt(s.written.max, 2)}) · draw lists rewritten ${fmt(s.orderWrites.median, 0)} a round (most ${fmt(s.orderWrites.max, 0)})`);
    console.log(`  uploads/frame        ${kb(s.bytes.median)} (min ${kb(s.bytes.min)}) — ${Object.entries(s.uploads).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${kb(v)}`).join(" · ")}`);
    console.log(`  writes/frame         ${fmt(s.writes.median, 1)} (min ${fmt(s.writes.min, 1)}) — ${Object.entries(s.writes.byLabel).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmt(v, 1)}`).join(" · ")}`);
    console.log(`  heap growth/frame    median ${kb(s.alloc.median)} · min ${kb(s.alloc.min)}`);
    console.log(`  cadence              ${fmt(s.fps.median, 1)} fps median (min ${fmt(s.fps.min, 1)}) · ${s.redraws} redraws, ${s.submits} submits a round · ${s.drawn} drawn, ${s.culled} culled at the end`);
  };
  const cam0 = { x: scene.camX, y: scene.camY, zoom: scene.zoom };

  /** The frame gate's sleep between two readings (K7a): steps taken, how many a registered time started, the outside wakes. */
  const stepsOf = (a, b) => ({ steps: b.steps - a.steps, timed: b.timed - a.timed, wakes: Object.values(b.wakes).reduce((x, y) => x + y, 0) - Object.values(a.wakes).reduce((x, y) => x + y, 0) });

  // ── idle: 240 frames at rest, 7 rounds
  if (wantCase("idle")) {
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) {
      await q(`window.__desk.setCamera(${JSON.stringify(cam0)})`);
      await settle();
      await front();
      const run = await qa(`(async () => {
        const d = window.__desk;
        d.perf.gc();
        const before = d.perf.take();
        const sleep0 = d.engine.engine.frame.sleepStats();
        const t0 = performance.now();
        await new Promise((r) => { let n = 0; const f = () => { if (++n >= 240) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
        const t1 = performance.now();
        const after = d.perf.take();
        return { ms: t1 - t0, before, after, live: d.stats().live, dirty: d.handle.dirty(), sleep: d.engine.engine.frame.sleepStats(), sleep0 };
      })()`);
      // K7a — THE WHOLE PAGE at rest (design-015 §11.4 read as written: main-thread time a 1 s window): the renderer's main thread
      // between two CDP readings 1 s apart with no rig code running in the page — everything it ran (`TaskDuration`), its JS
      // (`ScriptDuration`) — and the engine's steps over the same window (the sleeping loop takes none)
      const metrics = async () => Object.fromEntries((await tab.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
      // the rest's own registered times first (the notebook's layer let go LAYER_IDLE_MS after the round's frames drew it): the
      // window is the desk at rest after them — it names the step it waited for
      const soon = await q("(() => { const now = performance.now(); return window.__desk.handle.due(now).at - now; })()");
      run.waited = soon < 1500 ? soon : 0;
      if (soon < 1500) await sleep(Math.max(0, soon) + 150);
      const s0 = await q("window.__desk.engine.engine.frame.sleepStats()");
      const m0 = await metrics();
      const w0 = performance.now();
      await sleep(1000);
      const m1 = await metrics();
      const w1 = performance.now();
      const s1 = await q("window.__desk.engine.engine.frame.sleepStats()");
      run.page = { taskMsPerS: ((m1.TaskDuration - m0.TaskDuration) * 1e6) / (w1 - w0), scriptMsPerS: ((m1.ScriptDuration - m0.ScriptDuration) * 1e6) / (w1 - w0), ...stepsOf(s0, s1) };
      run.load = load();
      runs.push(run);
    }
    const per = runs.map((r) => { const d = diff(r.before, r.after); const steps = d.steps.slice(-240); return { submits: d.submits, stepMsPerS: (steps.reduce((a, b) => a + b, 0) / r.ms) * 1000, flushMsPerS: (d.flush.ms / r.ms) * 1000, stepMed: median(steps), steps: steps.length, gate: stepsOf(r.sleep0, r.sleep), ticks: d.flush.ticks, redraws: d.redraws, asleep: r.sleep.asleep, page: r.page, load: r.load }; });
    const col = (f) => per.map(f);
    const idle = {
      submits: max(col((p) => p.submits)), stepMsPerS: { median: median(col((p) => p.stepMsPerS)), min: min(col((p) => p.stepMsPerS)) }, flushMsPerS: { median: median(col((p) => p.flushMsPerS)), min: min(col((p) => p.flushMsPerS)) },
      stepMed: median(col((p) => p.stepMed)), steps: max(col((p) => p.steps)), untimed: max(col((p) => p.gate.steps - p.gate.timed)), outside: max(col((p) => p.gate.wakes)), redraws: max(col((p) => p.redraws)), asleep: per.every((p) => p.asleep),
      page: { taskMsPerS: { median: median(col((p) => p.page.taskMsPerS)), min: min(col((p) => p.page.taskMsPerS)), max: max(col((p) => p.page.taskMsPerS)) }, scriptMsPerS: { median: median(col((p) => p.page.scriptMsPerS)), min: min(col((p) => p.page.scriptMsPerS)) }, steps: max(col((p) => p.page.steps)), untimed: max(col((p) => p.page.steps - p.page.timed)), outside: max(col((p) => p.page.wakes)) },
      loads: col((p) => p.load), perRound: per,
    };
    report.idle = idle;
    console.log(`-- idle · ${ROUNDS} rounds × 240 frames, then 1 s of the page alone · load ${idle.loads.join(" ")} --`);
    console.log(`  submits              ${idle.submits} (the most in a round) · redraws ${idle.redraws} · engine steps ${idle.steps} over 240 frames (the most in a round; ${idle.untimed} not a registered time's, ${idle.outside} outside wakes) · the loop asleep ${idle.asleep}`);
    console.log(`  main thread / 1 s    the whole engine step ${fmt(idle.stepMsPerS.median, 3)} ms (min ${fmt(idle.stepMsPerS.min, 3)}) · the desk's flush ${fmt(idle.flushMsPerS.median, 3)} ms (min ${fmt(idle.flushMsPerS.min, 3)})`);
    console.log(`  the whole page / 1 s every task the renderer's main thread ran ${fmt(idle.page.taskMsPerS.median, 3)} ms (min ${fmt(idle.page.taskMsPerS.min, 3)}, max ${fmt(idle.page.taskMsPerS.max, 3)}) · its script ${fmt(idle.page.scriptMsPerS.median, 3)} ms (min ${fmt(idle.page.scriptMsPerS.min, 3)}) · engine steps ${idle.page.steps} (the most in a window; ${idle.page.untimed} not a registered time's)`);
    check(idle.submits === 0, `idle: 0 submits over 240 frames in every round (${idle.submits})`);
    // K7a: the loop SLEEPS at rest — no step but one a registered time starts (the books' layers let go LAYER_IDLE_MS after they
    // were last drawn, the calendar's midnight), no outside wake, so nothing is polled (design-016 §6 K7: registered wakes)
    check(idle.untimed === 0 && idle.outside === 0 && idle.page.untimed === 0 && idle.page.outside === 0 && idle.asleep, `idle: the loop sleeps — over 240 frames ${idle.steps} steps, ${idle.untimed} not a registered time's, ${idle.outside} outside wakes; over 1 s of the page alone ${idle.page.steps} steps, ${idle.page.untimed} not a time's (asleep ${idle.asleep})`);
    gate(idle.stepMsPerS.median <= 0.1 && idle.flushMsPerS.median <= 0.1, `idle: the engine's main thread ≤ 0.1 ms per 1 s (the whole step ${fmt(idle.stepMsPerS.median, 3)} ms — core's tick and the desk's flush ${fmt(idle.flushMsPerS.median, 3)} ms included)`);
    rows.push(["idle", `${idle.submits} submits · ${idle.steps} steps`, `${fmt(idle.stepMsPerS.median, 3)} ms/s step · ${fmt(idle.flushMsPerS.median, 3)} ms/s desk · the page ${fmt(idle.page.taskMsPerS.median, 3)} ms/s (script ${fmt(idle.page.scriptMsPerS.median, 3)})`, idle.loads.join(" ")]);
  }

  // ── pan: 120 frames, 8 px a frame
  if (wantCase("pan")) {
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) { const run = await drive(120, cam0, 8, 0, 1); run.load = load(); runs.push(run); }
    const s = summarise("pan", runs, 120);
    printDrive(s);
    // the GPU's ms for the frame at the pan's end: the saturated batch (the queue drained before and after), 7 rounds
    const gpu = [];
    for (let r = 0; r < ROUNDS; r++) { await front(); gpu.push((await qa("window.__desk.holdCost(24)")).rest); }
    s.gpu = { ms: { median: median(gpu.map((g) => g.ms)), min: min(gpu.map((g) => g.ms)) }, cpu: { median: median(gpu.map((g) => g.cpu)), min: min(gpu.map((g) => g.cpu)) } };
    console.log(`  saturated batch      GPU-bound ${fmt(s.gpu.ms.median)} ms/frame (min ${fmt(s.gpu.ms.min)}) · recording ${fmt(s.gpu.cpu.median)} ms · JS + GPU ${fmt(s.stepMs.median + s.gpu.ms.median)} ms vs 8.33 (120 Hz)`);
    // K2 — THE REAL FRAMES' GPU (design-016 §4, K-L5): one more pan with the GPU profiler ARMED — every drawn frame's GPU span (its
    // passes' first begin → last end, never a sum), its draws, pipelines and bind groups from the calls themselves — beside the
    // saturated batch above (a still frame, GPU-bound). The armed step beside the unarmed rounds' is the profiler's own cost.
    s.gpuFrames = await armedPan(cam0);
    const armedStep = s.gpuFrames.armedStepMs;
    const g = s.gpuFrames;
    console.log(`  real frames (armed)  GPU span p50 ${fmt(g.span.p50)} · p95 ${fmt(g.span.p95)} · max ${fmt(g.span.max)} ms, busy p50 ${fmt(g.busy.p50)} · p95 ${fmt(g.busy.p95)} ms (the rest of the span the GPU waited) (${g.timed} of ${g.frames} frames timed, ${g.dropped} dropped for a full readback ring) · a frame: ${g.draws} draws (${g.instances} instances) · ${g.pipelines} pipelines · ${g.bindGroups} bind groups · ${g.passes} passes · ${g.submits} submit — draws by kind ${Object.entries(g.byKind).map(([k, n]) => `${k} ${n}`).join(" · ")} · JS ${fmt(armedStep)} ms/frame armed vs ${fmt(s.stepMs.median)} unarmed`);
    check(g.timed >= g.frames / 2 && !g.quantised, `pan (armed): the real frames' GPU spans read back — ${g.timed} of ${g.frames} timed, none quantised`);
    rows.push(["gpu (pan, real frames)", `span p50 ${fmt(g.span.p50)} · p95 ${fmt(g.span.p95)} ms · busy p50 ${fmt(g.busy.p50)}`, `${g.draws} draws · ${g.pipelines} pipelines · ${g.bindGroups} bind groups · ${g.passes} passes a frame`, g.load]);
    // K2 — WHAT EACH KIND COSTS the frame at the pan's end (per-kind GPU by ablation, design-016 §4.4): each kind's objects left out in
    // turn, saturated and drained batches, the variants round-robined, an A/A control beside — a kind under the floor is not a number
    await settle();
    const kc = await qa(`window.__desk.perf.kindCost({ rounds: ${ROUNDS} })`, 300000);
    s.kindCost = kc;
    console.log(`  per-kind GPU         ${Object.entries(kc.kinds).sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => `${k} ${fmt(v.ms, 3)} ms × ${v.objects}${v.clears ? "" : " (under the floor)"}`).join(" · ")} — the frame ${fmt(kc.base.median, 3)} ms, A/A ${fmt(kc.aa, 4)}, floor ${fmt(kc.noise, 4)} ms, ${kc.frames}-frame batches × ${kc.rounds} rounds`);
    const real = Object.values(kc.kinds).filter((k) => k.clears).map((k) => k.ms);
    check(Math.abs(kc.aa) <= Math.max(2 * kc.noise, 0.02 * kc.base.median) && real.length > 0 && Math.abs(kc.aa) < Math.min(...real), `pan: the per-kind cost's A/A control within its noise floor and below every cost it calls real (A/A ${fmt(kc.aa, 4)} ms, floor ${fmt(kc.noise, 4)} ms, the frame ${fmt(kc.base.median, 3)} ms, the smallest real cost ${fmt(Math.min(...real), 3)} ms)`);
    gate(kc.noise <= 0.1 * kc.base.median, `pan: the per-kind cost's noise floor ≤ 10 % of the frame (${fmt(kc.noise, 4)} of ${fmt(kc.base.median, 3)} ms)`);
    rows.push(["per kind (pan's end)", `${Object.entries(kc.kinds).sort((a, b) => b[1].ms - a[1].ms).slice(0, 3).map(([k, v]) => `${k} ${fmt(v.ms, 3)}`).join(" · ")} ms`, `A/A ${fmt(kc.aa, 4)} · floor ${fmt(kc.noise, 4)} ms · the frame ${fmt(kc.base.median, 3)} ms`, load()]);
    gate(s.stepMs.median <= 2, `pan: main-thread JS ≤ 2 ms/frame (${fmt(s.stepMs.median)})`);
    // THE O(1) PAN (design-015 §2 · §4.3 · §11.4; D6) — the counters, not the clock, and CHECKED (the clock's gates above and below
    // bend with this Mac's load; these cannot): the members are neither queried nor sorted on a camera move; the cull visits the
    // index's candidates in the hysteresis band, never every member; what is resolved and recorded a frame is the objects ENTERING
    // the view's margin (a handful over 8 px), not the objects on screen; and the root stores write no standing record — every
    // record written is one the builder remade. Before D6: 1,002 queried and sorted, 1,021 visited, 118 resolved a frame.
    const active = report.scene.active;
    check(s.queried.median === 0 && s.sorted.median === 0, `pan: the members are neither queried nor sorted on a camera move (queried ${fmt(s.queried.median, 0)}, sorted ${fmt(s.sorted.median, 0)} a frame; ${active} members)`);
    check(s.visited.median < active / 2, `pan: the cull visits the index's candidates, never every member (${fmt(s.visited.median, 0)} of ${active} a frame)`);
    check(s.resolved.median <= 3 && s.recorded.median <= 3, `pan: no per-entity work — resolved ${fmt(s.resolved.median, 1)}, recorded ${fmt(s.recorded.median, 1)} a frame against ${s.drawn} drawn (the composites on screen, and the objects entering the margin)`);
    check(s.written.max <= s.recorded.median * 1.5 + 0.5, `pan: the stores write no standing record — ${fmt(s.written.median, 2)} written a frame (most ${fmt(s.written.max, 2)}), ${fmt(s.recorded.median, 2)} remade`);
    gate(s.stepMs.median + s.gpu.ms.median <= 8.33, `pan: 120 fps budget — JS + GPU ${fmt(s.stepMs.median + s.gpu.ms.median)} ms ≤ 8.33`);
    gate(s.alloc.median <= 64 * 1024, `pan: allocation ≤ 64 KB/frame (${kb(s.alloc.median)})`);
    // the memory the kinds' caches hold after the pans swept the field (D6's budget): the boards' rasters, the notebook's page rasters, the tiles
    const mem = await q("window.__desk.memory()");
    s.memory = mem;
    console.log(`  raster budget        ${(mem.used / 1048576).toFixed(1)} MB of ${(mem.cap / 1048576).toFixed(0)} MB resident (${Object.entries(mem.byOwner).map(([k, v]) => `${k} ${(v.bytes / 1048576).toFixed(1)} MB × ${v.entries}`).join(" · ")}) · ${mem.evictions} evictions`);
    gate(mem.used <= mem.cap, `pan: the kinds' rasters within the budget (${(mem.used / 1048576).toFixed(1)} of ${(mem.cap / 1048576).toFixed(0)} MB)`);
    rows.push(["pan", `${fmt(s.stepMs.median)} ms JS · ${fmt(s.gpu.ms.median)} ms GPU`, `resolved ${fmt(s.resolved.median, 1)} · recorded ${fmt(s.recorded.median, 1)} · ${fmt(s.written.median, 2)} written · ${kb(s.bytes.median)} up · ${kb(s.alloc.median)} alloc · rasters ${(mem.used / 1048576).toFixed(0)} MB`, s.loads.join(" ")]);
  }

  // ── nudge: 30 frames, ½ px a frame from rest — a camera move inside the cull's hysteresis band and short of any object's margin.
  //    THE LAW WHOLE (design-015 §4.3, D6): nothing is resolved, recorded or written and the draw list stands; the camera rides the
  //    slot uniforms alone. The desk is settled at cam0 first so the drive's own camera set is no move.
  if (wantCase("nudge")) {
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) {
      await q(`window.__desk.setCamera(${JSON.stringify(cam0)})`);
      await settle();
      const run = await drive(30, cam0, 0.5, 0, 1);
      run.load = load();
      runs.push(run);
    }
    const s = summarise("nudge", runs, 30);
    printDrive(s);
    // what a camera move alone may still resolve: the COMPOSITES on screen (the notebook, the calendar — their layers are not records;
    // the builder remakes a composite every build it is drawn, its resolve steps its own motion — kind.ts `composite`), so the count
    // is theirs (≤ 2 here), never a standing record's: the stores write nothing and the draw lists stand
    check(s.resolved.median <= 2 && s.recorded.median <= 2 && s.written.median === 0 && s.orderWrites.median === 0, `nudge: a camera move alone writes NOTHING and remakes nothing but the composites on screen — resolved ${fmt(s.resolved.median, 2)}, recorded ${fmt(s.recorded.median, 2)} a frame (the composites; every standing record stood), written ${fmt(s.written.median, 2)}, draw lists rewritten ${fmt(s.orderWrites.median, 0)} a round; the slot uniforms ${kb(s.bytes.median)} a frame`);
    rows.push(["nudge", `${fmt(s.stepMs.median)} ms JS`, `resolved ${fmt(s.resolved.median, 2)} (the composites) · recorded ${fmt(s.recorded.median, 2)} · ${fmt(s.written.median, 2)} written · ${kb(s.bytes.median)} up (the slot uniforms)`, s.loads.join(" ")]);
  }

  // ── zoom: 120 frames, ×1.005 a frame about the view's centre
  if (wantCase("zoom")) {
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) { const run = await drive(120, cam0, 0, 0, 1.005); run.load = load(); runs.push(run); }
    const s = summarise("zoom", runs, 120);
    printDrive(s);
    rows.push(["zoom", `${fmt(s.stepMs.median)} ms JS`, `resolved ${fmt(s.resolved.median, 1)} · recorded ${fmt(s.recorded.median, 1)} · ${kb(s.bytes.median)} up · ${kb(s.alloc.median)} alloc`, s.loads.join(" ")]);
  }

  // ── drag: the 50 notes nearest the view's centre, selected, dragged 60 frames by the mouse
  if (wantCase("drag")) {
    await q(`window.__desk.setCamera(${JSON.stringify(cam0)})`);
    await settle();
    const picked = await q(`(() => {
      const d = window.__desk; const cam = d.camera();
      const cx = cam.x + 600 / cam.zoom, cy = cam.y + 400 / cam.zoom;
      const all = d.entities().filter((e) => e.type === "desk.note"); const count = new Map(); for (const e of all) count.set(e.parent, (count.get(e.parent) ?? 0) + 1); const root = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const notes = all.filter((e) => e.parent === root && e.active).map((e) => ({ id: e.id, cx: e.cx, cy: e.cy, dd: (e.cx - cx) ** 2 + (e.cy - cy) ** 2 })).sort((a, b) => a.dd - b.dd).slice(0, 50);
      d.engine.ops.setSelection(notes.map((n) => n.id), "replace");
      return { ids: notes.map((n) => n.id), lead: notes[0], cam };
    })()`);
    await settle();
    check(picked.ids.length === 50 && (await q("window.__desk.selection().length")) === 50, `drag: 50 notes selected near the view's centre`);
    // THE LEAD: a selected note whose centre nothing covers — on a dense desk the nearest note may lie under a print or a mini mat, and
    // a press there drags that object instead; a candidate is kept once ten moves (40 px, past the slop) grab all 50, else it is let go
    // and the desk put back (the camera, the frame, the selection — a press that dragged the mat panned it, a short one clicked)
    const grabbedNow = () => q("window.__desk.entities().filter((e) => e.grabbed).length");
    const reselect = async () => {
      await q(`window.__desk.setCamera(${JSON.stringify(cam0)}); while (window.__desk.depth() > 0) window.__desk.exit("none"); window.__desk.engine.ops.setSelection(${JSON.stringify(picked.ids)}, "replace")`);
      await settle();
    };
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) {
      await reselect();
      const before = await q(`Object.fromEntries(${JSON.stringify(picked.ids)}.map((id) => [id, window.__desk.entity(id)?.cx]))`);
      const dir = r % 2 === 0 ? 1 : -1;
      let lead = null;
      for (const id of picked.ids) {
        const e = await q(`window.__desk.entity(${id})`);
        const cam = await q("window.__desk.camera()");
        const sx = (e.cx - cam.x) * cam.zoom;
        const sy = (e.cy - cam.y) * cam.zoom;
        if (sx < 40 || sy < 40 || sx > 1160 || sy > 760) continue;
        await front();
        await mouse("mouseMoved", sx, sy, { button: "none" });
        await mouse("mousePressed", sx, sy);
        for (let i = 1; i <= 10; i++) { await mouse("mouseMoved", sx + dir * 4 * i, sy + 2 * i); await sleep(12); }
        const grabbed = await grabbedNow();
        if (grabbed === 50) { lead = { sx, sy }; break; }
        if (r === 0) console.log(`  (drag: candidate ${id} at ${sx.toFixed(0)},${sy.toFixed(0)} grabbed ${grabbed}, selection ${await q("window.__desk.selection().length")}, depth ${await q("window.__desk.depth()")} — let go)`);
        await mouse("mouseReleased", sx + dir * 40, sy + 20);
        await reselect();
      }
      if (lead === null) { runs.push({ ms: 1, after: await q("window.__desk.perf.take()"), moved: 0, load: load(), noLead: true }); continue; }
      await q("window.__desk.perf.gc(); window.__desk.perf.take(); window.__desk.__t0 = performance.now()");
      for (let i = 11; i <= 70; i++) { await mouse("mouseMoved", lead.sx + dir * 4 * i, lead.sy + 2 * i); await sleep(12); }
      const run = await q("(() => { const t = performance.now() - window.__desk.__t0; return { ms: t, after: window.__desk.perf.take() }; })()");
      // the witness of "50 dragged": every one carried with the mouse at the last move (the release may DROP them into a mini mat
      // under the pointer — design-015 D-D6 — so the desk is put back by undoing the gesture, one transaction)
      const stillGrabbed = await grabbedNow();
      const midway = await q(`Object.fromEntries(${JSON.stringify(picked.ids)}.map((id) => [id, window.__desk.entity(id)?.cx]))`);
      run.moved = Object.keys(before).filter((id) => midway[id] !== undefined && Math.abs(midway[id] - before[id]) > 100).length;
      await mouse("mouseReleased", lead.sx + dir * 280, lead.sy + 140);
      await settle();
      await q("window.__desk.engine.docs.undo()");
      await settle();
      if (r === 0) console.log(`  (drag: ${stillGrabbed} grabbed at the last move; ${run.moved} of 50 carried > 100 units; the first three before ${JSON.stringify(picked.ids.slice(0, 3).map((id) => before[id]))} · at the last move ${JSON.stringify(picked.ids.slice(0, 3).map((id) => midway[id]))}; the gesture undone after the release)`);
      run.load = load();
      runs.push(run);
    }
    const per = runs.map((r) => { const steps = r.after.steps; return { stepMed: median(steps), stepMax: max(steps), fps: (r.after.redraws - 0) / (r.ms / 1000), redraws: r.after.redraws, moved: r.moved, load: r.load }; });
    // the redraws over the drag: `take` after the moves — its counters are cumulative since the mount, so read the frames from the steps
    for (const [i, p] of per.entries()) p.fps = (runs[i].after.steps.length * 1000) / runs[i].ms;
    const s = { stepMs: { median: median(per.map((p) => p.stepMed)), min: min(per.map((p) => p.stepMed)), maxMedian: median(per.map((p) => p.stepMax)) }, fps: { median: median(per.map((p) => p.fps)), min: min(per.map((p) => p.fps)) }, moved: min(per.map((p) => p.moved)), loads: per.map((p) => p.load), perRound: per };
    report.drag = s;
    console.log(`-- drag of 50 · ${ROUNDS} rounds × 60 moves · load ${s.loads.join(" ")} --`);
    console.log(`  step ms/frame        median ${fmt(s.stepMs.median)} · min ${fmt(s.stepMs.min)} · the rounds' max frames' median ${fmt(s.stepMs.maxMedian)}`);
    console.log(`  cadence              ${fmt(s.fps.median, 1)} steps/s median (min ${fmt(s.fps.min, 1)}) · ${s.moved} of 50 moved > 100 units in the least-moved round`);
    check(s.moved >= 50, `drag: all 50 selected notes moved with the mouse (${s.moved})`);
    gate(s.stepMs.median <= 9.09, `drag of 50: 110 fps budget — the step ${fmt(s.stepMs.median)} ms/frame ≤ 9.09`);
    rows.push(["drag 50", `${fmt(s.stepMs.median)} ms JS`, `${fmt(s.fps.median, 1)} steps/s · ${s.moved}/50 moved`, s.loads.join(" ")]);
  }

  // ── edit: a character into a written note in view — the rasters drawn and the records made in that frame
  if (wantCase("edit")) {
    await q(`window.__desk.engine.ops.clearSelection(); while (window.__desk.depth() > 0) window.__desk.exit("none"); window.__desk.setCamera(${JSON.stringify(cam0)})`);
    await settle();
    // the nearest written ROOT note (the frame's parent is the one most notes share — a mini mat's children sit near their own origin)
    const target = await q(`(() => { const d = window.__desk; const cam = d.camera(); const cx = cam.x + 600, cy = cam.y + 400; const notes = d.entities().filter((e) => e.type === "desk.note"); const count = new Map(); for (const e of notes) count.set(e.parent, (count.get(e.parent) ?? 0) + 1); const root = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]; const n = notes.filter((e) => e.parent === root && e.active && e.props.text).map((e) => ({ id: e.id, dd: (e.cx - cx) ** 2 + (e.cy - cy) ** 2 })).sort((a, b) => a.dd - b.dd)[0]; return n ? n.id : -1; })()`);
    const tgt = target >= 0 ? await q(`(() => { const e = window.__desk.entity(${target}); const cam = window.__desk.camera(); return { cx: e.cx, cy: e.cy, text: e.props.text, parent: e.parent, active: e.active, cam }; })()`) : null;
    check(target >= 0, `edit: a written note in view (${target}: ${JSON.stringify(tgt)})`);
    if (target >= 0) {
      for (let i = 0; i < 100 && !(await q("window.__desk.note.fontReady()")); i++) await sleep(50);
      const focused = await q(`window.__desk.note.focus(${target}, 1)`);
      await settle();
      const w0 = await q("window.__desk.note.writing()");
      const r0 = await q(`window.__desk.note.raster(${target})`);
      await q("window.__desk.perf.take()");
      const typed = await q("window.__desk.note.type('x')");
      await front();
      await qa("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))");
      const after = await q("window.__desk.perf.take()");
      const w1 = await q("window.__desk.note.writing()");
      const r1 = await q(`window.__desk.note.raster(${target})`);
      const edit = { focused, typed, rasters: w1.rasters - w0.rasters, layouts: w1.layouts - w0.layouts, blanks: w1.blanks - w0.blanks, evicted: w1.evicted - w0.evicted, resident: w1.resident, raster: [r0, r1], pages: await q("window.__desk.note.pages()"), redraws: after.redraws, recorded: after.work.recorded, steps: after.steps, load: load() };
      report.edit = edit;
      await q("window.__desk.note.blur()");
      await settle();
      console.log(`-- edit · load ${edit.load} --`);
      console.log(`  a character typed: ${edit.rasters} raster(s) drawn, ${edit.layouts} layout(s) laid, ${edit.blanks} blank, ${edit.evicted} evicted · ${edit.resident} rasters resident, pages ${JSON.stringify(edit.pages)} · the note's raster ${JSON.stringify(r0)} → ${JSON.stringify(r1)} · the last frame recorded ${edit.recorded} record(s) · ${edit.steps.length} steps in the window`);
      check(focused && typed, "edit: the editor took the note and the character");
      gate(edit.rasters === 1, `edit: a note edit re-rasters ONE note (${edit.rasters})`);
      rows.push(["edit", `${edit.rasters} raster`, `${edit.recorded} records in the frame`, edit.load]);
    }
  }

  // ── hold: the notebook picked up — the desk copy once, none per held frame; the blur's cost
  if (wantCase("hold")) {
    await q(`window.__desk.setCamera(${JSON.stringify(cam0)})`);
    await settle();
    const book = await q(`(window.__desk.entities().find((e) => e.type === "desk.notebook") ?? { id: -1 }).id`);
    check(book >= 0, `hold: the notebook is on the desk (${book})`);
    if (book >= 0) {
      await q(`window.__desk.open(${book})`);
      for (let i = 0; i < 40 && !(await q("window.__desk.hand()?.settled")); i++) { await front(); await sleep(50); }
      await settle();
      const c0 = await q("window.__desk.holdCopies()");
      await front();
      await qa("new Promise((r) => { let n = 0; const f = () => { if (++n >= 60) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); })");
      const c1 = await q("window.__desk.holdCopies()");
      const costs = [];
      for (let r = 0; r < ROUNDS; r++) { await front(); costs.push(await qa("window.__desk.holdCost(12)")); }
      const hold = { copies: [c0, c1], copy: { median: median(costs.map((c) => c.copy.ms)), min: min(costs.map((c) => c.copy.ms)) }, hand: { median: median(costs.map((c) => c.hand.ms)), min: min(costs.map((c) => c.hand.ms)) }, rest: { median: median(costs.map((c) => c.rest.ms)), min: min(costs.map((c) => c.rest.ms)) }, standing: { median: median(costs.map((c) => c.standing.ms)), min: min(costs.map((c) => c.standing.ms)) }, load: load() };
      report.hold = hold;
      await q("window.__desk.putDown()");
      await settle();
      console.log(`-- hold · ${ROUNDS} rounds × 12 frames · load ${hold.load} --`);
      console.log(`  desk copies while held  ${c0} → ${c1} over 60 frames`);
      console.log(`  ms/frame                copy (the blur, remade every frame) ${fmt(hold.copy.median)} (min ${fmt(hold.copy.min)}) · hand (a held frame over the standing copy) ${fmt(hold.hand.median)} (min ${fmt(hold.hand.min)}) · rest ${fmt(hold.rest.median)} (min ${fmt(hold.rest.min)}) — each drawn in full · the held frame STANDING (K7a: the hand's layer laid again undrawn) ${fmt(hold.standing.median)} (min ${fmt(hold.standing.min)})`);
      check(c1 === c0, `hold: no desk copy per held frame (${c1 - c0} over 60 frames)`);
      gate(hold.copy.median - hold.hand.median <= 1.5, `hold: the blur costs ≤ 1.5 ms once (copy − hand = ${fmt(hold.copy.median - hold.hand.median)} ms) and 0 per held frame (${c1 - c0} copies)`);
      rows.push(["hold", `blur ${fmt(hold.copy.median - hold.hand.median)} ms once`, `${c1 - c0} copies over 60 held frames · hand ${fmt(hold.hand.median)} ms drawn · ${fmt(hold.standing.median)} ms standing`, hold.load]);
    }
  }

  // ── books (K7a, design-016 §6 · K7): a NOTEBOOK and a DESK CALENDAR on screen — the two layered kinds, each laying a layer of its
  //    own (4× colour and depth, resolved; the notebook a shadow map a book). A pan of 2 px a frame keeps both on screen: JS, the
  //    armed pan's real frames (the GPU span, the books' own passes a frame and their GPU ms, from the labelled passes), the memory.
  if (wantCase("books")) {
    const camB = { x: -600, y: -400, zoom: 1 };
    const booksScene = { camX: camB.x, camY: camB.y, zoom: 1, theme: "light", notes: [{ x: -500, y: 250, seed: 3, text: TEXTS[0] }, { x: 450, y: 300, seed: 5, text: "" }], minimats: [], boards: [], prints: [], books: [{ x: -250, y: -60, cover: "orbit", seed: 7 }], calendars: [{ x: 300, y: -60, month: "2026-09", weekStart: 1 }] };
    await qa(`window.__desk.setScene(${JSON.stringify(booksScene)})`, 120000);
    await settle(20000);
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) { const run = await drive(120, camB, 2, 0, 1); run.load = load(); runs.push(run); }
    const s = summarise("books", runs, 120);
    const g = await armedPan(camB, 2);
    const mem = await memoryNow();
    const row = (k) => mem.ledger?.byLabel?.[k]?.bytes ?? 0;
    const bp = (k) => g.passesByPrefix[k] ?? { n: 0, ms: Number.NaN };
    report.books = { js: s.stepMs, alloc: s.alloc, gpu: g, memory: mem };
    console.log(`\n-- books · a notebook and a desk calendar on screen, a pan of 2 px a frame · ${ROUNDS} rounds × 120 frames · load ${s.loads.join(" ")} --`);
    console.log(`  JS                   ${fmt(s.stepMs.median)} ms/frame (min ${fmt(s.stepMs.min)}) · heap growth ${kb(s.alloc.median)}/frame`);
    console.log(`  real frames (armed)  GPU span p50 ${fmt(g.span.p50)} · p95 ${fmt(g.span.p95)} ms · busy p50 ${fmt(g.busy.p50)} · ${g.passes} passes a frame — the notebook's ${bp("notebook").n} (${fmt(bp("notebook").ms, 3)} ms) · the calendar's ${bp("calendar").n} (${fmt(bp("calendar").ms, 3)} ms) · ${g.draws} draws (${g.timed} of ${g.frames} frames timed)`);
    console.log(`  memory               ${memoryLine(mem)}`);
    rows.push(["books (pan)", `span p50 ${fmt(g.span.p50)} · p95 ${fmt(g.span.p95)} ms · ${g.passes} passes`, `notebook ${bp("notebook").n} passes ${fmt(bp("notebook").ms, 3)} ms · calendar ${bp("calendar").n} passes ${fmt(bp("calendar").ms, 3)} ms · JS ${fmt(s.stepMs.median)} ms · notebook ${MB(row("notebook"))} · calendar ${MB(row("calendar"))} · ${MB(mem.ledger?.total ?? 0)} live`, g.load]);
  }

  // ── mixed (K6a, design-016 §6 · K-L4): THE REAL DESK — the same spiral, its things in SIBLING ORDER as they come (a print or a
  //    whiteboard between notes: runs cut) and every print carrying a REAL picture (24 generated JPEGs up to 4096², decoded by the
  //    product's decoder). The armed pan's real frames — draws, instances, pipelines, bind groups, the GPU span, draws and instances
  //    by kind — JS a frame, and the memory by label: the numbers instancing and residency answer.
  if (wantCase("mixed")) {
    const scene = stressScene(N, { mixed: true, pictures: true });
    const t0 = performance.now();
    await qa(`window.__desk.setScene(${JSON.stringify(scene)})`, 600000);
    await settle(30000);
    const pics = await q(`window.__desk.handle.local("photo")?.pictures() ?? null`);
    console.log(`\n-- mixed · the spiral in sibling order, ${scene.prints.length} prints with real pictures (${PICTURES.length} distinct, up to 4096²) · staged in ${((performance.now() - t0) / 1000).toFixed(1)} s · load ${load()} --`);
    check(pics !== null && pics.loading === 0 && pics.failed === 0 && pics.ready >= PICTURES.length, `mixed: every picture decoded and on the device (${JSON.stringify(pics)})`);
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) { const run = await drive(120, cam0, 8, 0, 1); run.load = load(); runs.push(run); }
    const s = summarise("mixed", runs, 120);
    const g = await armedPan(cam0);
    const mem = await memoryNow();
    report.mixed = { js: s.stepMs, gpu: g, memory: mem, pictures: pics };
    console.log(`  JS                   ${fmt(s.stepMs.median)} ms/frame (min ${fmt(s.stepMs.min)}) · ${kb(s.bytes.median)} up a frame`);
    console.log(`  real frames (armed)  GPU span p50 ${fmt(g.span.p50)} · p95 ${fmt(g.span.p95)} ms · busy p50 ${fmt(g.busy.p50)} · a frame: ${g.draws} draws (${g.instances} instances) · ${g.pipelines} pipelines · ${g.bindGroups} bind groups — draws by kind ${Object.entries(g.byKind).map(([k, n]) => `${k} ${n} (${g.instancesByKind[k]} inst)`).join(" · ")}`);
    console.log(`  memory               ${memoryLine(mem)} · pictures resident ${JSON.stringify((await q(`window.__desk.handle.local("photo")?.pictures() ?? null`))?.resident ?? null)}`);
    // THE NOTEBOOK'S LAYER (K6a, D-K6a.3): 4× colour and depth and the resolve at the canvas's device size, and a shadow map a book
    // drawn — made at the first book drawn, let go once none was for LAYER_IDLE_MS (5 s): the camera away from the book, 6 s of frames
    const nbOn = mem.ledger?.byLabel?.notebook?.bytes ?? 0;
    await q("window.__desk.setCamera({ x: 20000, y: 20000, zoom: 1 })");
    await front();
    await qa("new Promise((r) => { const t0 = performance.now(); const f = () => { const d = window.__desk; if (performance.now() - t0 > 6000) r(); else { d.setCamera({ x: 20000 + ((performance.now() - t0) % 2), y: 20000, zoom: 1 }); requestAnimationFrame(f); } }; requestAnimationFrame(f); })", 60000);
    const away = await memoryNow();
    const nbOff = away.ledger?.byLabel?.notebook?.bytes ?? 0;
    console.log(`  the notebook's layer ${MB(nbOn)} with the book on screen (138.2 MB of targets at 2400 × 1600 + one 4.2 MB shadow map — was 8 maps, 33.5 MB) → ${MB(nbOff)} after 6 s with none drawn`);
    check(nbOff < 4 * 1048576 && nbOn > nbOff, `mixed: the notebook's layer and shadow maps let go once no book was drawn for 5 s — ${MB(nbOn)} → ${MB(nbOff)} (before K6a: 164 MB standing with or without a book)`);
    rows.push(["mixed (pan)", `${g.draws} draws · ${g.pipelines} pipelines · ${g.bindGroups} bind groups`, `span p50 ${fmt(g.span.p50)} · p95 ${fmt(g.span.p95)} ms · JS ${fmt(s.stepMs.median)} ms · photo ${g.byKind.photo ?? 0} draws / ${g.instancesByKind.photo ?? 0} inst · board ${g.byKind.board ?? 0} / ${g.instancesByKind.board ?? 0} · ${MB(mem.ledger?.total ?? 0)} live`, g.load]);
  }

  // ── pictures (K6a, K-L4): TWENTY 4096² pictures on the desk — twenty prints in view at zoom 0.4, no notebook, no desk calendar:
  //    the ledger's total and its rows (the photo kind's, the calendar kind's and the notebook kind's with none of theirs on the
  //    desk), against the raster budget; then one print zoomed large (zoom 4) — what its full resolution costs.
  if (wantCase("pictures")) {
    const prints = Array.from({ length: 20 }, (_, i) => ({ x: (i % 5) * 480 - 960, y: Math.floor(i / 5) * 480 - 720, picture: { w: 4096, h: 4096, seed: 1000 + i } }));
    const t0 = performance.now();
    await qa(`window.__desk.setScene(${JSON.stringify({ camX: -1500, camY: -1000, zoom: 0.4, theme: "light", prints })})`, 600000);
    await settle(30000);
    const picsOf = () => q(`window.__desk.handle.local("photo")?.pictures() ?? null`);
    const pics = await picsOf();
    const far = await memoryNow();
    const st = await q("window.__desk.stats()");
    const camFar = { x: -1500, y: -1000, zoom: 0.4 };
    console.log(`\n-- pictures · 20 prints of 4096² pictures, ${st.objects} drawn at zoom 0.4 · staged in ${((performance.now() - t0) / 1000).toFixed(1)} s · load ${load()} --`);
    console.log(`  at zoom 0.4          ${memoryLine(far)} · resident ${JSON.stringify(pics?.resident ?? null)}`);
    const row = (m, k) => m.ledger?.byLabel?.[k]?.bytes ?? 0;
    // K6a (K-L4): NO BLANK PRINT — every picture resident as its thumbnail the moment it is on the device (its chain's tail in a
    // layer of the one array), whatever its size; and the photo kind's memory is the budget's to see
    const r0 = pics?.resident;
    check(pics !== null && pics.ready >= 21 && pics.failed === 0 && pics.loading === 0 && r0?.pictures === pics.ready && r0?.layers === r0?.pictures, `pictures: every picture resident as its thumbnail — ${r0?.layers} layers of one array for ${r0?.pictures} pictures (20 × 4096², the fixture, any a scene before preloaded), none blank (${pics?.failed} failed, ${pics?.loading} loading)`);
    // THE IDLE WASTE (K6a): a desk with no notebook and no calendar holds neither kind's textures — their shadow maps, layer
    // targets, page ink and print tiles made on first use, let go with the last of their objects (a scene before had both)
    check(row(far, "notebook") < 1048576 && row(far, "calendar") < 1048576, `pictures: no notebook, no calendar on the desk — the notebook kind ${MB(row(far, "notebook"))}, the calendar kind ${MB(row(far, "calendar"))} (before K6a: 164.2 and 42.2 MB)`);
    check(far.ledger !== null && far.ledger.total <= far.budget.cap, `pictures: twenty 4096² pictures on the desk and the whole GPU ledger within the budget — ${MB(far.ledger?.total ?? 0)} live of ${MB(far.budget.cap)} (before K6a: 1,942 MB)`);
    const photoBudget = far.budget.byOwner.photo?.bytes ?? 0;
    check(row(far, "photo") <= far.budget.cap && Math.abs(row(far, "photo") - photoBudget) <= 0.05 * row(far, "photo"), `pictures: the photo kind's memory is the budget's to see — the ledger's photo ${MB(row(far, "photo"))} (the thumbnail array, its details, the records), the budget's photo ${MB(photoBudget)}, the cap ${MB(far.budget.cap)} (before K6a: 1,712 MB, outside the budget)`);
    // A RUN OF 20 PRINTS = ONE DRAW (K-L4): the twenty are sibling after sibling — the armed pan's frames draw them as one instanced draw
    const g = await armedPan(camFar);
    check(g.byKind.photo === 1 && g.instancesByKind.photo >= 19, `pictures: a run of ${g.instancesByKind.photo} prints is ONE draw (${g.byKind.photo} photo draw a frame, ${g.instancesByKind.photo} instances; before K6a a draw and a bind group a print)`);
    // one print LARGE on screen: the camera over print 0 at zoom 4 — its detail fetched (decoded again) and bound; how long it took
    await q(`window.__desk.setCamera({ x: ${prints[0].x} - 600 / 4, y: ${prints[0].y} - 400 / 4, zoom: 4 })`);
    const tz = performance.now();
    let bound = null;
    for (let i = 0; i < 200 && bound === null; i++) {
      await front();
      await qa("new Promise((r) => requestAnimationFrame(() => r()))");
      const r = (await picsOf())?.resident;
      if (r !== undefined && r.slotted >= 1) bound = { ms: performance.now() - tz, r };
    }
    await settle(30000);
    const near = await memoryNow();
    const rn = (await picsOf())?.resident;
    console.log(`  one print at zoom 4  ${memoryLine(near)} · resident ${JSON.stringify(rn ?? null)} · its detail bound ${bound === null ? "NEVER" : `${fmt(bound.ms, 0)} ms after the camera moved`}`);
    check(bound !== null && rn?.slotted >= 1 && rn?.built >= 1, `pictures: a print zoomed large gets its DETAIL — fetched, decoded again and bound ${bound === null ? "never" : `${fmt(bound.ms, 0)} ms after the camera moved`} (${rn?.details} detail, ${rn?.slotted} bound, ${MB(rn?.bytes.details ?? 0)}); the thumbnail drew it meanwhile`);
    check(row(near, "photo") <= near.budget.cap && (near.ledger?.total ?? Number.POSITIVE_INFINITY) <= near.budget.cap, `pictures: zoomed large, the photo kind ${MB(row(near, "photo"))} and the whole ledger ${MB(near.ledger?.total ?? 0)} within the budget's ${MB(near.budget.cap)}`);
    report.pictures = { pictures: pics, far, near, run: g, bound };
    rows.push(["pictures (20 × 4096²)", `${MB(far.ledger?.total ?? 0)} live · photo ${MB(row(far, "photo"))} · 20 prints = ${g.byKind.photo} draw`, `zoom 4 on one: photo ${MB(row(near, "photo"))}, its detail bound in ${bound === null ? "—" : fmt(bound.ms, 0)} ms · calendar ${MB(row(far, "calendar"))} · notebook ${MB(row(far, "notebook"))} with none on the desk · budget cap ${MB(far.budget.cap)}`, load()]);
  }

  // ── boards (K6a, K-L4): TWENTY whiteboards with strokes, sibling after sibling in a row 700 units apart — a run of boards is ONE
  //    draw; far, their rasters at their ZOOM RUNG (never the law's fixed 4 texels a unit); walked past at zoom 1 each is raised to
  //    its rung as it comes on screen, their rasters overrun the budget and the least recently drawn are EVICTED to their
  //    thumbnails (what the board draws from while it has no raster) — replayed when they are on screen again.
  if (wantCase("boards")) {
    const boards = Array.from({ length: 20 }, (_, i) => ({ x: i * 700, y: 0, strokes: scribble(i) }));
    const camFar = { x: -1000, y: -3000, zoom: 0.08 };
    await qa(`window.__desk.setScene(${JSON.stringify({ camX: camFar.x, camY: camFar.y, zoom: camFar.zoom, theme: "light", boards })})`, 600000);
    await settle(30000);
    const ids = await q(`window.__desk.entities().filter((e) => e.type === "desk.board").map((e) => e.id)`);
    const res = () => q(`(${JSON.stringify(ids)}).map((e) => window.__desk.handle.local("board").residency(e) ?? null)`);
    const frames = (n) => qa(`new Promise((r) => { let n = 0; const f = () => { if (++n >= ${n}) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`);
    const row = (m, k) => m.ledger?.byLabel?.[k]?.bytes ?? 0;
    const far = await res();
    const memFar = await memoryNow();
    console.log(`\n-- boards · 20 whiteboards in a row, a run · load ${load()} --`);
    console.log(`  far (zoom 0.08)      ${memoryLine(memFar)} · densities ${far.map((r) => r?.density ?? "—").join(" ")}`);
    check(ids.length === 20 && far.every((r) => r?.thumb && r.density === 1), `boards: far (zoom 0.08) each raster at its ZOOM RUNG — ${far.filter((r) => r?.density === 1).length} of ${ids.length} at 1 texel a unit, each with its thumbnail; the board row ${MB(row(memFar, "board"))} (the law's fixed 4 texels a unit: 20 × 18.3 MB)`);
    const g = await armedPan(camFar);
    check(g.byKind.board === 1 && g.instancesByKind.board === 20, `boards: a run of ${g.instancesByKind.board} boards is ONE draw (${g.byKind.board} board draw a frame; before K6a a draw and a bind group a board)`);
    // walked past at zoom 1, board after board
    const replays0 = await q(`window.__desk.handle.local("board").replays()`);
    for (let i = 0; i < 20; i++) {
      await q(`window.__desk.setCamera({ x: ${i * 700 - 600}, y: -400, zoom: 1 })`);
      await front();
      await frames(6);
    }
    await settle(20000);
    const walked = await res();
    const memWalk = await memoryNow();
    const replays1 = await q(`window.__desk.handle.local("board").replays()`);
    console.log(`  walked at zoom 1     ${memoryLine(memWalk)} · densities ${walked.map((r) => r?.density ?? "—").join(" ")} · ${replays1 - replays0} replays`);
    // back to board 0: its record made again as it enters — its replay ASKED of the frame queue (K6b), its thumbnail drawing it until
    // the queue's turn makes its raster at its rung and replays its strokes; bound
    await q("window.__desk.setCamera({ x: -600, y: -400, zoom: 1 })");
    await front();
    await frames(1);
    const back0 = (await res())[0];
    let backFrames = 1;
    while (backFrames < 60 && (await res())[0]?.density !== 4) { await frames(1); backFrames += 1; }
    await frames(8);
    await settle(20000);
    const back1 = (await res())[0];
    const replays2 = await q(`window.__desk.handle.local("board").replays()`);
    console.log(`  back on board 0      at once ${JSON.stringify(back0)} · its raster made ${backFrames} frame(s) after · then ${JSON.stringify(back1)} · ${replays2 - replays1} replays`);
    check(memWalk.budget.evictions > 0 && walked[0]?.density === null && walked[0]?.thumb === true, `boards: walked past at zoom 1 their rasters overran the budget — ${memWalk.budget.evictions} evictions, board 0's raster gone, its thumbnail kept (the budget ${MB(memWalk.budget.used)} of ${MB(memWalk.budget.cap)})`);
    check(back0?.density === null && back0?.thumb === true && backFrames <= 6 && back1?.density === 4 && back1?.bound === true && replays2 > replays1, `boards: board 0 on screen again — its thumbnail drew it in the frame it came back while its replay waited in the frame queue (K6b); the queue's turn replayed it at its rung (4 texels a unit) ${backFrames} frame(s) after, bound (${JSON.stringify(back0)} → ${JSON.stringify(back1)}; ${replays2 - replays1} replays)`);
    report.boards = { far, memFar, run: g, walked, memWalk, back: [back0, back1] };
    rows.push(["boards (20, a run)", `20 boards = ${g.byKind.board} draw · far: board ${MB(row(memFar, "board"))}`, `walked at zoom 1: ${memWalk.budget.evictions} evictions, board ${MB(row(memWalk, "board"))}; back: replayed and bound`, load()]);
  }

  // ── zoom-written (K6b, design-016 §1.3 · §6): THE WRITTEN DESK (`writtenScene`, a fresh one each round, settled at zoom 1) zoomed
  //    OUT 1 → 0.35 in 90 frames — notes and boards ENTER the view (first rasters, first replays) and the notes rastered at zoom 1
  //    cross a rung DOWN (2 → 1 texel a unit at zoom 0.43) — and back IN 0.35 → 0.72 in 60 (two rungs UP: 1 → 1.41 at zoom 0.5, → 2
  //    at 0.707, three frames before it STOPS). Every step's ms beside THAT step's counters (`perf.probe`): the notes' rasters laid,
  //    the boards' replays, the records the builder remade and the stores wrote; p50 / p95 / the worst frame a round, their medians
  //    over the rounds. Then CONVERGENCE (K6b): the camera standing, the frames until every raster the zoom asked is laid.
  if (wantCase("zoom-written")) {
    const ws = writtenScene();
    const legs = [[1, 0.35, 90], [0.35, 0.72, 60]];
    /** The counters each step is read against (`perf.probe`), cumulative: THAT frame's work is its reading minus the one before. */
    const KEYS = ["rasters", "replays", "recorded", "written", "blanks", "rungs", "fresh", "rerung", "rezoomed", "restless", "ran", "queueMs"];
    const perRound = [];
    for (let r = 0; r < ROUNDS; r++) {
      await qa(`window.__desk.setScene(${JSON.stringify(ws)})`, 120000);
      await settle(20000);
      await front();
      const run = await qa(`(async () => {
        const d = window.__desk;
        const board = d.handle.local("board");
        const read = () => {
          const w = d.note.writing();
          const t = d.handle.stats().totals;
          const q = d.handle.rasters();
          let written = 0;
          for (const v of Object.values(d.handle.records())) written += v.written;
          return { rasters: w?.rasters ?? 0, replays: board?.replays() ?? 0, recorded: t.recorded, written, blanks: w?.blanks ?? 0, rungs: t.rungs, fresh: t.fresh, rerung: t.rerung, rezoomed: t.rezoomed, restless: t.restless, ran: q.ran, queueMs: q.ms, waiting: q.waiting, zoom: d.camera().zoom };
        };
        const bids = d.entities().filter((e) => e.type === "desk.board").map((e) => e.id);
        const res0 = bids.map((e) => board?.residency(e) ?? null);
        const p0 = read();
        d.perf.probe(read);
        d.perf.take();
        for (const [from, to, n] of ${JSON.stringify(legs)}) {
          await new Promise((res) => { let i = 0; const f = () => { i++; const z = from * Math.pow(to / from, i / n); d.setCamera({ x: -600 / z, y: -400 / z, zoom: z }); if (i >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
        }
        const t = d.perf.take();   // the zoom's frames
        const pz = t.probes.at(-1) ?? p0;
        // CONVERGENCE: the camera stands; the frames until the queue has nothing WAITING — every raster the zoom asked laid, or HELD
        // for room (the pages full in shape: a capacity signal, reported beside it — the sheet keeps what it holds)
        const owed = () => d.handle.rasters().waiting;
        const c0 = performance.now();
        let frames = 0;
        while (owed() > 0 && frames < 600) { await new Promise((res) => requestAnimationFrame(res)); frames += 1; }
        const cms = performance.now() - c0;
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const tc = d.perf.take();
        d.perf.probe(undefined);
        const pc = tc.probes.at(-1) ?? pz;
        const converge = { frames, ms: cms, owed: owed(), held: d.handle.rasters().held, maxStep: Math.max(0, ...tc.steps), rasters: pc.rasters - pz.rasters, replays: pc.replays - pz.replays, pages: d.note.pages() };
        return { steps: t.steps, probes: t.probes, p0, converge, queue: d.handle.rasters(), boards: [res0, bids.map((e) => board?.residency(e) ?? null)] };
      })()`, 120000);
      const frames = run.steps.map((ms, i) => {
        const a = i === 0 ? run.p0 : run.probes[i - 1];
        const b = run.probes[i];
        const f = { ms, zoom: b.zoom, waiting: b.waiting };
        for (const k of KEYS) f[k] = b[k] - a[k];
        return f;
      });
      const ms = frames.map((f) => f.ms);
      const sum = (k) => frames.reduce((a, f) => a + f[k], 0);
      const most = (k) => max(frames.map((f) => f[k]));
      perRound.push({
        frames: frames.length, p50: pct(ms, 0.5), p95: pct(ms, 0.95), max: max(ms), over8: frames.filter((f) => f.ms > 8).length,
        rasters: sum("rasters"), rastersMax: most("rasters"), replays: sum("replays"), replaysMax: most("replays"), laidMax: max(frames.map((f) => f.rasters + f.replays)),
        // every raster and replay laid in the queue's turn: none but the queue's runs (a held run lays nothing, so laid ≤ ran)
        laidOutside: sum("rasters") + sum("replays") - sum("ran"),
        recordedMed: median(frames.map((f) => f.recorded)), writtenMed: median(frames.map((f) => f.written)),
        rungs: sum("rungs"), rerung: sum("rerung"), fresh: sum("fresh"), rezoomed: sum("rezoomed"), restless: sum("restless"), recorded: sum("recorded"),
        // THE RUNG LAW's witness: a record remade on the zoom came on screen, crossed a rung, took a raster laid (its record says where
        // its ink is) or a raise (its kind restless) — the frames where records were remade past those causes
        unexplained: frames.filter((f) => f.recorded > f.fresh + f.rerung + f.restless + f.rasters + f.replays).length,
        blanks: sum("blanks"), waitingMax: most("waiting"), queueMsMax: most("queueMs"), queue: run.queue,
        worst: frames.reduce((a, f) => (f.ms > a.ms ? f : a), frames[0]), load: load(), boards: run.boards, converge: run.converge,
        // the round frame by frame: [ms, rasters, replays, remade, written, blanks, the zoom drawn, rungs read, asks waiting after it,
        // the queue's ms in it, rungs crossed, came on screen]
        series: frames.map((f) => [Math.round(f.ms * 100) / 100, f.rasters, f.replays, f.recorded, f.written, f.blanks, Math.round(f.zoom * 1000) / 1000, f.rungs, f.waiting, Math.round(f.queueMs * 100) / 100, f.rerung, f.fresh]),
      });
    }
    const col = (k) => perRound.map((p) => p[k]);
    const total = (k) => col(k).reduce((a, b) => a + b, 0);
    const cv = (k) => perRound.map((p) => p.converge[k]);
    const q = perRound.at(-1).queue;
    const s = {
      rounds: perRound.length, p50: { median: median(col("p50")), min: min(col("p50")) }, p95: { median: median(col("p95")), min: min(col("p95")) }, max: { median: median(col("max")), min: min(col("max")) },
      over8: median(col("over8")), rasters: median(col("rasters")), rastersMax: max(col("rastersMax")), replays: median(col("replays")), replaysMax: max(col("replaysMax")), laidMax: max(col("laidMax")),
      recordedMed: median(col("recordedMed")), writtenMed: median(col("writtenMed")), blanks: max(col("blanks")), waitingMax: max(col("waitingMax")), queueMsMax: max(col("queueMsMax")),
      converge: { frames: median(cv("frames")), max: max(cv("frames")), ms: median(cv("ms")), owed: max(cv("owed")), held: max(cv("held")), rasters: median(cv("rasters")), replays: median(cv("replays")), maxStep: max(cv("maxStep")), pages: perRound.map((p) => p.converge.pages) },
      loads: col("load"), perRound,
    };
    report["zoom-written"] = s;
    console.log(`-- zoom-written · ${s.rounds} rounds × ${perRound[0].frames} frames (1 → 0.35 → 0.72) on 240 written notes + 8 boards · load ${s.loads.join(" ")} --`);
    console.log(`  step ms/frame        p50 ${fmt(s.p50.median)} (min ${fmt(s.p50.min)}) · p95 ${fmt(s.p95.median)} (min ${fmt(s.p95.min)}) · the worst frame ${fmt(s.max.median)} (min ${fmt(s.max.min)}) · frames over 8 ms ${fmt(s.over8, 0)}`);
    console.log(`  rasters              ${fmt(s.rasters, 0)} a round, the most in one frame ${s.rastersMax} · board replays ${fmt(s.replays, 0)} a round, the most in one frame ${s.replaysMax} · blanks ${s.blanks}`);
    console.log(`  records              remade ${fmt(s.recordedMed, 1)} · written ${fmt(s.writtenMed, 1)} a frame (medians) · a round's ${total("recorded")} over ${s.rounds}: ${total("fresh")} came on screen, ${total("rerung")} crossed a rung (${total("rungs")} rungs read), ${total("restless")} restless, ${total("rezoomed")} by the zoom's delta alone`);
    console.log(`  the queue            its budget ${q.budgetMs} ms · the most waiting after a frame ${s.waitingMax} · the most one turn spent ${fmt(q.peakMs)} ms, the dearest run ${fmt(q.dearest)} ms · ${q.dropped} let go unrun`);
    console.log(`  convergence          ${fmt(s.converge.frames, 0)} frames (${fmt(s.converge.ms, 0)} ms) after the zoom stopped, the most ${s.converge.max} — ${fmt(s.converge.rasters, 0)} rasters, ${fmt(s.converge.replays, 0)} replays meanwhile, its worst frame ${fmt(s.converge.maxStep)} ms; ${s.converge.owed} still waiting, ${s.converge.held} held for room at rest (the pages at rest: ${s.converge.pages.map((g) => (g === null ? "—" : `${(g.used / 1048576).toFixed(1)}M texels in ${g.rows} rows`)).join(" · ")} of ${(4 * 2048 * 2048 / 1048576).toFixed(1)}M)`);
    console.log(`  the worst frames     ${perRound.map((p) => `${fmt(p.worst.ms, 1)} ms (${p.worst.rasters} rasters, ${p.worst.replays} replays, ${p.worst.recorded} remade)`).join(" · ")}`);
    check(s.max.min <= 8, `zoom-written: no frame over 8 ms in the best round — its worst ${fmt(s.max.min)} ms; the rounds' worst frames' median ${fmt(s.max.median)} ms (design-016 §6; before K6b 192.84 ms, 106 notes rastered in it)`);
    gate(s.max.median <= 8, `zoom-written: the rounds' worst frame ≤ 8 ms — median ${fmt(s.max.median)} ms over ${s.rounds} rounds`);
    check(total("unexplained") === 0 && total("rezoomed") === 0, `zoom-written: every record remade on the zoom came on screen, crossed a rung, took a raster laid or a raise — none by the zoom's delta alone (${total("rezoomed")}; ${total("unexplained")} frames past those causes; before K6b every note on screen, every frame: 120 a frame)`);
    check(total("laidOutside") <= 0 && q.peakMs <= q.budgetMs + q.dearest, `zoom-written: every raster and replay of the zoom laid in the frame queue's turn (${total("rasters") + total("replays")} laid, none outside), at most ${s.laidMax} in a frame; a turn overshot its ${q.budgetMs} ms budget by at most its last run (the most one spent ${fmt(q.peakMs)} ms, the dearest run ${fmt(q.dearest)} ms)`);
    check(s.converge.owed === 0, `zoom-written: CONVERGED — nothing waiting ${fmt(s.converge.frames, 0)} frames (${fmt(s.converge.ms, 0)} ms) after the zoom stopped (the most ${s.converge.max}): every raster it asked laid, or held for room (${s.converge.held} at rest); its worst frame meanwhile ${fmt(s.converge.maxStep)} ms`);
    gate(s.converge.max <= 120, `zoom-written: converged within 120 frames of the zoom stopping (the most ${s.converge.max})`);
    rows.push(["zoom-written", `p50 ${fmt(s.p50.median)} · p95 ${fmt(s.p95.median)} · worst ${fmt(s.max.median)} ms JS`, `${fmt(s.rasters, 0)} rasters a round (≤ ${s.rastersMax} a frame) · ${fmt(s.replays, 0)} replays (≤ ${s.replaysMax} a frame) · remade ${fmt(s.recordedMed, 1)}/frame · converged in ${fmt(s.converge.frames, 0)} frames`, s.loads.join(" ")]);
  }

  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log("\n| scenario | headline | detail | load |\n|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(resolve(OUT, `stress-${stamp}.json`), JSON.stringify({ rounds: ROUNDS, n: N, gate: GATE, report }, null, 1));
  console.log(`\n${pass} passed, ${failN} failed · ${resolve(OUT, `stress-${stamp}.json`)}`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
