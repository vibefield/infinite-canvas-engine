// rig:scale — design-016 §6 K7 (K7b): TEN THOUSAND objects on one desk, in MIXED kind order, the prints carrying K6a's real
// pictures, seen at LOW ZOOM — the desk James asked about ("production grade with many objects"). rig:stress proves 1,000 objects
// with ~87 drawn at zoom 1; this proves 10,000 with ≈ 2,000 drawn at zoom 0.2. One scene — notes (most written), prints, whiteboards
// with strokes, mini mats with insides, a few notebooks and desk calendars — on a golden spiral, each index's kind drawn from a
// seeded hash (so the things' SIBLING ORDER interleaves the kinds as a desk built over months does: a print or a board between
// notes). Every number is read from the instruments the desk carries — K2's profiler armed on the real frames (the GPU span,
// draws, pipelines, bind groups, instances by kind), the engine's `step` timed from outside (`perf.arm`), the builder's work
// counters, the queue's uploads by label, V8's heap between a `gc()` and the last frame, the saturated batch (`holdCost`), the GPU
// memory ledger and the raster budget — with the host's 1-minute load average beside every row (this Mac is loaded).
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:scale [scenario-regex]
//   DESK_SCALE_N=10000 (objects) · DESK_SCALE_ROUNDS=7 · DESK_SCALE_GATE=1 (the gates assert — the exit code is the verdict)
//   DESK_SCALE_OUT=<dir> (the JSON of every round; default apps/desk/results)
//
// THE METHOD (K-H's discipline for timing rows): every timed batch follows an UNTIMED warm batch of the same frames (the GPU's clock
// ramps after a rest, the JIT settles); each timed row is a median over its frames, then the MIN and the median over ROUNDS rounds —
// the gates read the min (load only ever adds time; the best round is the machine's cost) and the load average is printed beside
// it; the tab is brought to front before every frame wait (a hidden tab never fires rAF); the GPU is drained around the batches.
//
// THE SCENARIOS. `stage`: the scene spawned into the world and settled — the time it took, the members, what the root slot draws
// at zoom 0.2 and how many lie on screen. `pan`: 120 frames of the camera moving 8 CSS px a frame at zoom 0.2 — the step's ms (JS
// a frame), the desk's flush, the builder's work, the uploads and the heap's growth a frame; the armed pan's real frames (the GPU
// span p50/p95 and busy; draws, pipelines, bind groups and instances a frame, by kind); the saturated batch (the frame at the pan's
// end: GPU-bound ms and its recording ms). `zoom`: the camera from zoom 1 out to 0.1 and back to 1 about the field's centre (×0.98
// a frame, 114 frames each way) — each frame's step ms, p50 / p95 / the worst, the records remade and the rasters laid, and the
// draws at the far end. `idle`: 240 frames at rest at zoom 0.2 — submits (0), the engine's steps and its ms a second, then 1 s of
// the page alone (every task the main thread ran). `memory`: the GPU ledger by label and the raster budget, the pictures resident.
// Exit code: 0 once the table is printed (and under DESK_SCALE_GATE=1 every gate held); 1 for a preflight, a throw or a failed
// check or gate; 2 for the watchdog.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { loadavg } from "node:os";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { PICTURES, scaleScene } from "./scale-scene.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const N = Number(process.env.DESK_SCALE_N ?? 10000);
const ROUNDS = Number(process.env.DESK_SCALE_ROUNDS ?? 7);
const GATE = process.env.DESK_SCALE_GATE === "1";
const OUT = resolve(process.env.DESK_SCALE_OUT ?? resolve(app, "results"));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => loadavg()[0].toFixed(2);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length === 0 ? Number.NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const min = (xs) => Math.min(...xs);
const max = (xs) => Math.max(...xs);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const MB = (b) => `${(b / 1048576).toFixed(1)} MB`;
/** Nearest-rank percentile. */
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length === 0 ? Number.NaN : s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };

const die = (what, cmd) => { console.log(`PREFLIGHT FAIL: ${what}\n  produce it with:  ${cmd}`); process.exit(1); };
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
// V8's gc() exposed and a young generation PINNED big enough that a 120-frame batch never scavenges (the heap's growth IS the
// allocation — stress.mjs, K7a); precise heap readings
const chrome = await launchChrome({ port: await freePort(9651), headless: !process.env.DESK_HEADED, extraArgs: ["--js-flags=--expose-gc --min-semi-space-size=128 --max-semi-space-size=128", "--enable-precise-memory-info"] });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 2_400_000).unref();
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
  const settle = async (ms = 8000) => { await front(); return qa(`window.__desk.settle(${ms})`, ms + 20000); };
  const wantCase = (name) => only === null || only.test(name);
  const coi = await q("crossOriginIsolated");
  check(coi === true, `the page is cross-origin isolated — performance.now() resolves µs, not 100 µs (crossOriginIsolated ${coi})`);

  // ── stage: the scene in the world, the time it took
  const { scene, count, R } = scaleScene(N);
  const cam0 = { x: scene.camX, y: scene.camY, zoom: scene.zoom };
  const t0 = performance.now();
  const staged = await qa(`window.__desk.setScene(${JSON.stringify(scene)})`, 600000);
  const spawnMs = performance.now() - t0;
  console.log(`  (spawned in ${fmt(spawnMs / 1000, 1)} s · load ${load()})`);
  const st = await settle(60000);
  const settleMs = performance.now() - t0 - spawnMs;
  const st0 = await q("window.__desk.stats()");
  await q("window.__desk.perf.arm()");
  const onScreen = await q("(() => { const d = window.__desk; const c = d.camera(); const v = d.viewport(); const x1 = c.x + v.w / c.zoom, y1 = c.y + v.h / c.zoom; let n = 0; for (const e of d.entities()) if (e.active && e.x < x1 && e.x + e.w > c.x && e.y < y1 && e.y + e.h > c.y) n++; return n; })()");
  const pics = await q(`window.__desk.handle.local("photo")?.pictures() ?? null`);
  const roots = count.note + count.print + count.board + count.minimat + count.book + count.pad;
  report.stage = { n: N, R, count, objects: staged.objects, active: st0.active, drawn: st0.objects, onScreen, spawnMs, settleMs, settled: st.settled, pictures: pics, load: load() };
  console.log(`\n-- stage · ${N} root objects on a spiral of radius ${R} (${count.note} notes, ${count.written} written · ${count.print} prints · ${count.board} whiteboards · ${count.minimat} mini mats with insides · ${count.book} notebooks · ${count.pad} desk calendars) · load ${load()} --`);
  console.log(`  spawned in ${fmt(spawnMs / 1000, 1)} s, settled ${st.settled} in ${fmt(settleMs / 1000, 1)} s more · ${st0.active} members · at zoom 0.2 the root slot draws ${st0.objects} (${onScreen} on screen, ${st0.culled} culled)`);
  check(staged.objects === roots && st0.active === roots, `stage: the scene is in the world — ${staged.objects} root objects spawned, ${st0.active} Active (${roots} laid)`);
  check(pics !== null && pics.loading === 0 && pics.failed === 0 && pics.ready >= PICTURES.length, `stage: every picture decoded and on the device (${JSON.stringify(pics)})`);
  check(st0.objects >= 1500 && st0.objects <= 2600, `stage: ≈ 2,000 drawn at zoom 0.2 — the root slot draws ${st0.objects} (${onScreen} on screen)`);
  // THE SPAWN is the durable document's (one transaction — src/scene.ts `spawnAll`): strata's ordered relation walks the root's whole
  // sibling list on every placement (durable `placeInOrderList` → `pruneOrderList`, one wasm lookup an entry) — O(n²) in the objects,
  // strata's, not the desk's: 2,000 in 10 s, 10,000 in 285 s at load 233. The settle is the desk's: every first frame's asks laid.
  gate(st.settled && settleMs <= 10000, `stage: the desk settled within 10 s of the spawn (${st.settled ? "settled" : "NOT settled"} after ${fmt(settleMs / 1000, 1)} s)`);
  rows.push(["stage", `${N} objects · ${st0.objects} drawn (${onScreen} on screen) at zoom 0.2`, `spawned ${fmt(spawnMs / 1000, 1)} s + settled ${fmt(settleMs / 1000, 1)} s · ${count.print} prints of ${PICTURES.length} real pictures · ${count.written} written notes`, load()]);

  /** Diff two perf readings: the steps between, the flush, the uploads by label, the submits, the builder's work, the redraws, the records. */
  const diff = (a, b) => {
    const uploads = {};
    for (const k of new Set([...Object.keys(a.uploads), ...Object.keys(b.uploads)])) uploads[k] = { writes: (b.uploads[k]?.writes ?? 0) - (a.uploads[k]?.writes ?? 0), bytes: (b.uploads[k]?.bytes ?? 0) - (a.uploads[k]?.bytes ?? 0) };
    const work = {};
    for (const k of Object.keys(b.totals)) work[k] = b.totals[k] - a.totals[k];
    const records = { written: 0, bytes: 0, orderWrites: 0 };
    for (const k of new Set([...Object.keys(a.records ?? {}), ...Object.keys(b.records ?? {})])) for (const f of Object.keys(records)) records[f] += (b.records?.[k]?.[f] ?? 0) - (a.records?.[k]?.[f] ?? 0);
    return { steps: b.steps, flush: { frames: b.flush.frames - a.flush.frames, frameMs: b.flush.frameMs - a.flush.frameMs }, uploads, submits: b.submits - a.submits, work, records, redraws: b.redraws - a.redraws };
  };
  /**
   * One driven run in the page: `frames` rAFs, the camera written each from `path` — the source of a function (i, cam) → { x, y, zoom }
   * of the frame's index (1…frames) and the start — the heap read after a gc before and at the end.
   */
  const drive = async (frames, cam, path) => {
    await front();
    return qa(`(async () => {
      const d = window.__desk;
      const cam = ${JSON.stringify(cam)};
      const path = ${path};
      d.setCamera(cam);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      d.perf.gc();
      const h0 = d.perf.heap();
      const before = d.perf.take();
      const t0 = performance.now();
      let i = 0;
      await new Promise((r) => { const f = () => { i++; d.setCamera(path(i, cam)); if (i >= ${frames}) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      await new Promise((r) => requestAnimationFrame(r));
      const t1 = performance.now();
      const h1 = d.perf.heap();
      const after = d.perf.take();
      return { ms: t1 - t0, h0, h1, before, after, stats: d.stats() };
    })()`, 300000);
  };
  /** THE PAN: 8 CSS px a frame round a circle of 1,000 units about the start's view centre — the density the same all the way, whatever N. */
  const PAN = "(i, c) => { const v = 8 / c.zoom, r = 1000, a = (i * v) / r; return { x: c.x + r * Math.sin(a), y: c.y + r * (1 - Math.cos(a)), zoom: c.zoom }; }";
  /** A zoom through `zs` (a factor a frame, listed) about the start's view centre. */
  const ZOOM = (zs) => `(i, c) => { const zs = ${JSON.stringify(zs)}; const z = zs[Math.min(i, zs.length) - 1]; const cx = c.x + 600 / c.zoom, cy = c.y + 400 / c.zoom; return { x: cx - 600 / z, y: cy - 400 / z, zoom: z }; }`;
  const summarise = (label, runs, frames) => {
    const per = runs.map((r) => {
      const d = diff(r.before, r.after);
      const steps = d.steps.slice(-frames);
      const f = Math.max(d.redraws, 1);
      return {
        stepMed: median(steps), stepP95: pct(steps, 0.95), stepMax: max(steps), flushPerFrame: d.flush.frameMs / Math.max(d.flush.frames, 1),
        resolved: d.work.resolved / f, recorded: d.work.recorded / f, visited: d.work.visited / f, written: d.records.written / f,
        bytes: Object.values(d.uploads).reduce((a, v) => a + v.bytes, 0) / f, writes: Object.values(d.uploads).reduce((a, v) => a + v.writes, 0) / f,
        uploads: Object.fromEntries(Object.entries(d.uploads).map(([k, v]) => [k, v.bytes / f])),
        alloc: (r.h1 - r.h0) / frames, fps: (frames * 1000) / r.ms, redraws: d.redraws, submits: d.submits, drawn: r.stats.objects, load: r.load, steps,
      };
    });
    const col = (k) => per.map((p) => p[k]);
    const s = {
      label, rounds: per.length, frames,
      stepMs: { median: median(col("stepMed")), min: min(col("stepMed")), p95: median(col("stepP95")), maxMedian: median(col("stepMax")) },
      flushMs: { median: median(col("flushPerFrame")), min: min(col("flushPerFrame")) },
      resolved: median(col("resolved")), recorded: median(col("recorded")), visited: median(col("visited")), written: median(col("written")),
      bytes: { median: median(col("bytes")), min: min(col("bytes")) }, writes: median(col("writes")),
      uploads: Object.fromEntries([...new Set(per.flatMap((p) => Object.keys(p.uploads)))].map((k) => [k, median(per.map((p) => p.uploads[k] ?? 0))])),
      alloc: { median: median(col("alloc")), min: min(col("alloc")) }, fps: median(col("fps")), redraws: median(col("redraws")), submits: median(col("submits")), drawn: median(col("drawn")),
      loads: col("load"), perRound: per.map(({ steps, ...p }) => p),
    };
    report[label] = s;
    return s;
  };
  /** K2's armed run (design-016 §4): the drive again with the GPU profiler ARMED — the real frames' span, busy, draws, pipelines, bind groups, by kind. */
  const armed = async (frames, cam, path) => {
    await q("window.__gpuOff = window.__desk.perf.gpu().arm(); 0");
    const run = await drive(frames, cam, path);
    await qa("new Promise((r) => setTimeout(r, 300))");   // the last readbacks land
    const late = (await q("window.__desk.perf.take()")).gpu.frames;
    await q("window.__gpuOff(); 0");
    const gf = [...run.after.gpu.frames, ...late].filter((f) => f.kind === "frame");
    const spans = gf.flatMap((f) => (f.span !== null ? [f.span] : []));
    const busies = gf.flatMap((f) => (f.busy !== null ? [f.busy] : []));
    const per = (k) => median(gf.map((f) => f.counts[k]));
    const kinds = [...new Set(gf.flatMap((f) => Object.keys(f.byKind)))];
    return {
      frames: gf.length, timed: spans.length, quantised: gf.some((f) => f.quantised === true),
      span: { p50: pct(spans, 0.5), p95: pct(spans, 0.95), max: max(spans) }, busy: { p50: pct(busies, 0.5), p95: pct(busies, 0.95) },
      draws: per("draws"), drawsMax: max(gf.map((f) => f.counts.draws)), instances: per("instances"), pipelines: per("pipelines"), bindGroups: per("bindGroups"), passes: per("passes"),
      byKind: Object.fromEntries(kinds.map((k) => [k, median(gf.map((f) => f.byKind[k]?.draws ?? 0))])),
      instancesByKind: Object.fromEntries(kinds.map((k) => [k, median(gf.map((f) => f.byKind[k]?.instances ?? 0))])),
      last: gf.at(-1)?.counts ?? null, armedStepMs: median(run.after.steps.slice(-frames)), load: load(),
    };
  };
  const printDrive = (s) => {
    console.log(`  JS (the step)        median ${fmt(s.stepMs.median)} · min ${fmt(s.stepMs.min)} ms/frame (the rounds' medians) · p95 ${fmt(s.stepMs.p95)} · the rounds' worst frames' median ${fmt(s.stepMs.maxMedian)} · the desk's flush ${fmt(s.flushMs.median)} (min ${fmt(s.flushMs.min)})`);
    console.log(`  builder work/frame   visited ${fmt(s.visited, 0)} · resolved ${fmt(s.resolved, 1)} · recorded ${fmt(s.recorded, 1)} · records written ${fmt(s.written, 1)}`);
    console.log(`  uploads/frame        ${kb(s.bytes.median)} (min ${kb(s.bytes.min)}) in ${fmt(s.writes, 1)} writes — ${Object.entries(s.uploads).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${kb(v)}`).join(" · ")}`);
    console.log(`  heap growth/frame    median ${kb(s.alloc.median)} · min ${kb(s.alloc.min)} · cadence ${fmt(s.fps, 1)} fps · ${s.redraws} redraws, ${s.submits} submits a round · ${s.drawn} drawn at the end`);
  };
  const printGpu = (g, label) => console.log(`  real frames (armed)  ${label}: GPU span p50 ${fmt(g.span.p50)} · p95 ${fmt(g.span.p95)} ms, busy p50 ${fmt(g.busy.p50)} (${g.timed} of ${g.frames} timed) · a frame: ${g.draws} draws (most ${g.drawsMax}; ${g.instances} instances) · ${g.pipelines} pipelines · ${g.bindGroups} bind groups · ${g.passes} passes — by kind ${Object.entries(g.byKind).map(([k, n]) => `${k} ${n}/${g.instancesByKind[k]}`).join(" · ")} (draws/instances) · JS armed ${fmt(g.armedStepMs)} ms`);
  const memoryNow = async () => ({ ledger: await q("window.__desk.handle.gpuMemory()?.read() ?? null"), budget: await q("window.__desk.memory()") });
  const memoryLine = (m) => `${MB(m.ledger?.total ?? 0)} live (${Object.entries(m.ledger?.byLabel ?? {}).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 7).map(([k, v]) => `${k} ${MB(v.bytes)}`).join(" · ")}) · budget ${MB(m.budget.used)} of ${MB(m.budget.cap)} (${Object.entries(m.budget.byOwner).map(([k, v]) => `${k} ${MB(v.bytes)} × ${v.entries}`).join(" · ")}), ${m.budget.evictions} evictions`;

  // ── pan: 120 frames, 8 CSS px a frame at zoom 0.2 — an untimed warm batch, then ROUNDS timed rounds
  if (wantCase("pan")) {
    await settle(30000);
    await drive(120, cam0, PAN);   // warm (untimed)
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) { const run = await drive(120, cam0, PAN); run.load = load(); runs.push(run); }
    const s = summarise("pan", runs, 120);
    console.log(`\n-- pan · zoom 0.2, 8 CSS px a frame · ${ROUNDS} rounds × 120 frames after a warm batch · load ${s.loads.join(" ")} --`);
    printDrive(s);
    const g = await armed(120, cam0, PAN);
    s.gpu = g;
    printGpu(g, "the pan");
    await settle(30000);
    const batch = [];
    await qa("window.__desk.holdCost(12)");   // warm
    for (let r = 0; r < ROUNDS; r++) { await front(); batch.push((await qa("window.__desk.holdCost(24)")).rest); }
    s.batch = { ms: { median: median(batch.map((b) => b.ms)), min: min(batch.map((b) => b.ms)) }, cpu: { median: median(batch.map((b) => b.cpu)), min: min(batch.map((b) => b.cpu)) } };
    console.log(`  saturated batch      the frame at rest: GPU-bound ${fmt(s.batch.ms.median)} ms/frame (min ${fmt(s.batch.ms.min)}) · its recording (prepare + encode) ${fmt(s.batch.cpu.median)} ms (min ${fmt(s.batch.cpu.min)})`);
    check(g.timed >= g.frames / 2 && !g.quantised, `pan (armed): the real frames' GPU spans read back — ${g.timed} of ${g.frames} timed, none quantised`);
    gate(s.stepMs.min <= 2, `pan: main-thread JS ≤ 2 ms/frame at ${s.drawn} drawn — the best round's median ${fmt(s.stepMs.min)} ms (the rounds' median ${fmt(s.stepMs.median)}; load ${s.loads.join(" ")})`);
    gate(s.batch.ms.min <= 8.33, `pan: the frame's GPU work (saturated batch) ≤ 8.33 ms — ${fmt(s.batch.ms.min)} ms at best (median ${fmt(s.batch.ms.median)})`);
    rows.push(["pan (zoom 0.2)", `JS ${fmt(s.stepMs.median)} (min ${fmt(s.stepMs.min)}) ms · GPU span p50 ${fmt(g.span.p50)} · batch ${fmt(s.batch.ms.median)} ms`, `${g.draws} draws · ${g.pipelines} pipelines · ${g.bindGroups} bind groups · ${g.instances} instances · ${s.drawn} drawn · ${kb(s.bytes.median)} up · ${kb(s.alloc.median)} alloc · recording ${fmt(s.batch.cpu.median)} ms`, s.loads.join(" ")]);
  }

  // ── zoom: 1 → 0.1 → 1 about the field's centre, ×0.98 a frame — every frame's step, the records remade and the rasters laid
  if (wantCase("zoom")) {
    const steps = 114;
    const zs = [...Array.from({ length: steps }, (_, i) => 0.98 ** (i + 1)), ...Array.from({ length: steps }, (_, i) => 0.98 ** (steps - i - 1))];
    const camZ = { x: -600, y: -400, zoom: 1 };
    await q(`window.__desk.setCamera(${JSON.stringify(camZ)})`);
    await settle(30000);
    await drive(zs.length, camZ, ZOOM(zs));   // warm (untimed): the rasters and records the zoom makes are made once
    await q(`window.__desk.setCamera(${JSON.stringify(camZ)})`);
    await settle(30000);
    const runs = [];
    for (let r = 0; r < ROUNDS; r++) { const run = await drive(zs.length, camZ, ZOOM(zs)); run.load = load(); runs.push(run); await q(`window.__desk.setCamera(${JSON.stringify(camZ)})`); await settle(30000); }
    const s = summarise("zoom", runs, zs.length);
    const worst = runs.map((r) => max(diff(r.before, r.after).steps.slice(-zs.length)));
    s.worst = { median: median(worst), min: min(worst) };
    console.log(`\n-- zoom · 1 → 0.1 → 1 (×0.98 a frame, ${zs.length} frames) · ${ROUNDS} rounds after a warm one · load ${s.loads.join(" ")} --`);
    printDrive(s);
    console.log(`  the worst frame      median ${fmt(s.worst.median)} · min ${fmt(s.worst.min)} ms over the rounds`);
    const far = await armed(40, { x: -6000, y: -4000, zoom: 0.1 }, PAN);
    s.far = far;
    printGpu(far, "at zoom 0.1");
    rows.push(["zoom (1 → 0.1 → 1)", `JS p50 ${fmt(s.stepMs.median)} · p95 ${fmt(s.stepMs.p95)} · worst ${fmt(s.worst.median)} (min ${fmt(s.worst.min)}) ms`, `remade ${fmt(s.recorded, 1)}/frame · ${kb(s.bytes.median)} up · at zoom 0.1: ${far.draws} draws · ${far.instances} instances · span p50 ${fmt(far.span.p50)} ms`, s.loads.join(" ")]);
  }

  // ── runs (the run question, design-016 §6 K7): at each zoom a short armed pan about the field's centre — the draws, pipelines and
  //    bind groups a real frame takes against the objects it draws. In MIXED sibling order a run of one kind ends at the next object of
  //    another, so the draws follow the interleave, not the kinds: this row is the numbers the flat-card call is made on.
  if (wantCase("runs")) {
    const at = [];
    for (const zoom of [1, 0.5, 0.35, 0.25, 0.2, 0.1]) {
      const cam = { x: -600 / zoom, y: -400 / zoom, zoom };
      await q(`window.__desk.setCamera(${JSON.stringify(cam)})`);
      await settle(15000);
      await drive(20, cam, PAN);   // warm
      const g = await armed(40, cam, PAN);
      at.push({ zoom, drawn: (await q("window.__desk.stats()")).objects, draws: g.draws, pipelines: g.pipelines, bindGroups: g.bindGroups, instances: g.instances, byKind: g.byKind, span: g.span.p50, load: g.load });
    }
    report.runs = at;
    console.log("\n-- runs · a short armed pan at each zoom (mixed sibling order) --");
    for (const r of at) console.log(`  zoom ${String(r.zoom).padEnd(4)}  ${String(r.drawn).padStart(5)} drawn · ${r.draws} draws · ${r.pipelines} pipelines · ${r.bindGroups} bind groups · ${r.instances} instances · span p50 ${fmt(r.span)} ms — ${Object.entries(r.byKind).map(([k, n]) => `${k} ${n}`).join(" · ")} · load ${r.load}`);
    rows.push(["runs (draws a frame)", at.map((r) => `z ${r.zoom}: ${r.draws}`).join(" · "), at.map((r) => `z ${r.zoom}: ${r.drawn} drawn, ${r.pipelines} pipelines`).join(" · "), load()]);
  }

  // ── idle: 240 frames at rest at zoom 0.2, then 1 s of the page alone
  if (wantCase("idle")) {
    await q(`window.__desk.setCamera(${JSON.stringify(cam0)})`);
    await settle(30000);
    const per = [];
    for (let r = 0; r < Math.min(ROUNDS, 5); r++) {
      await settle(30000);
      const run = await qa(`(async () => {
        const d = window.__desk;
        d.perf.gc();
        const before = d.perf.take();
        const sleep0 = d.engine.engine.frame.sleepStats();
        const t0 = performance.now();
        await new Promise((r) => { let n = 0; const f = () => { if (++n >= 240) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
        const after = d.perf.take();
        return { ms: performance.now() - t0, submits: after.submits - before.submits, steps: after.steps, sleep0, sleep: d.engine.engine.frame.sleepStats() };
      })()`);
      const metrics = async () => Object.fromEntries((await tab.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
      const soon = await q("(() => { const now = performance.now(); return window.__desk.handle.due(now).at - now; })()");
      if (soon < 1500) await sleep(Math.max(0, soon) + 150);
      const m0 = await metrics();
      const w0 = performance.now();
      await sleep(1000);
      const m1 = await metrics();
      const w1 = performance.now();
      per.push({ submits: run.submits, steps: run.steps.length, stepMsPerS: (run.steps.reduce((a, b) => a + b, 0) / run.ms) * 1000, asleep: run.sleep.asleep, pageMsPerS: ((m1.TaskDuration - m0.TaskDuration) * 1e6) / (w1 - w0), load: load() });
    }
    const idle = { submits: max(per.map((p) => p.submits)), steps: max(per.map((p) => p.steps)), stepMsPerS: median(per.map((p) => p.stepMsPerS)), page: { median: median(per.map((p) => p.pageMsPerS)), min: min(per.map((p) => p.pageMsPerS)) }, asleep: per.every((p) => p.asleep), loads: per.map((p) => p.load) };
    report.idle = idle;
    console.log(`\n-- idle · ${per.length} rounds × 240 frames at zoom 0.2, then 1 s of the page alone · load ${idle.loads.join(" ")} --`);
    console.log(`  submits ${idle.submits} (the most in a round) · engine steps ${idle.steps} · ${fmt(idle.stepMsPerS, 3)} ms/s · the loop asleep ${idle.asleep} · the whole page ${fmt(idle.page.median, 3)} ms/s (min ${fmt(idle.page.min, 3)})`);
    gate(idle.submits === 0 && idle.asleep, `idle: 0 submits over 240 frames at rest with ${N} objects, the loop asleep (${idle.submits} submits, ${idle.steps} steps)`);
    gate(idle.stepMsPerS <= 0.1, `idle: the engine's main thread ≤ 0.1 ms per 1 s (${fmt(idle.stepMsPerS, 3)} ms)`);
    rows.push(["idle (zoom 0.2)", `${idle.submits} submits · ${idle.steps} steps`, `${fmt(idle.stepMsPerS, 3)} ms/s engine · the page ${fmt(idle.page.median, 3)} ms/s (min ${fmt(idle.page.min, 3)})`, idle.loads.join(" ")]);
  }

  // ── memory: the GPU ledger and the raster budget after the pans and the zoom swept the field
  if (wantCase("memory")) {
    const mem = await memoryNow();
    report.memory = mem;
    console.log(`\n-- memory · after the scenarios · load ${load()} --\n  ${memoryLine(mem)}`);
    gate(mem.budget.used <= mem.budget.cap && mem.budget.evictions < 1000, `memory: the kinds' rasters and pictures within the ONE budget, no thrash (${MB(mem.budget.used)} of ${MB(mem.budget.cap)}, ${mem.budget.evictions} evictions)`);
    gate((mem.ledger?.total ?? Number.POSITIVE_INFINITY) <= 512 * 1048576, `memory: the whole GPU ledger ≤ 512 MB with ${count.print} prints of real pictures (${MB(mem.ledger?.total ?? 0)})`);
    rows.push(["memory", `${MB(mem.ledger?.total ?? 0)} live`, `budget ${MB(mem.budget.used)} of ${MB(mem.budget.cap)} · ${mem.budget.evictions} evictions`, load()]);
  }

  logs.push(...(await faultsOf(tab)));
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log("\n| scenario | headline | detail | load |\n|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(resolve(OUT, `scale-${stamp}.json`), JSON.stringify({ rounds: ROUNDS, n: N, gate: GATE, report }, null, 1));
  console.log(`\n${pass} passed, ${failN} failed · ${resolve(OUT, `scale-${stamp}.json`)}`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
