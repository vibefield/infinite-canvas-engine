/**
 * The STRESS driver (2026-09-09): many DOM cards with looping CSS animations,
 * `ice:surface.domAtRest` (arm `dom`, the default) against `ice:surface.alwaysGpu`
 * (arm `gpu`), one fresh Electron process per (arm, board size, round), arms
 * interleaved and the order rotated each round so the loaded host's weather falls
 * on both arms alike. Medians across rounds are the result; every raw window is
 * kept in the JSON.
 *
 * Per cell, in order: mount → board → a discarded settle → then one measured window
 * per phase: `idle` (no animation), `compositor` (transform + opacity), `paint`
 * (width + colour), `compositor+pan`, `compositor+zoomcross` (a band crossing),
 * and for the gpu arm the demand-bucket lever at 30 and 15. Each window reports
 * the page's counters (frames, intervals, main-thread rAF ms, copies, submits,
 * dirt) and the driver adds per-process CPU% from `app.getAppMetrics()` (100 =
 * one core) and physical footprints from `vmmap --summary`.
 *
 * Two witnesses per arm that the counters cannot give: the spinner and the bar
 * MOVE in the presented pixels (two clipped screenshots 250 ms apart differ), and
 * one screenshot per arm at the largest board.
 *
 * Run: `pnpm --filter widgetlab-desktop stress`
 *   STRESS_ARMS=dom,gpu  STRESS_N=24,48,96,192  STRESS_ROUNDS=2  STRESS_WINDOW_MS=4000
 *   STRESS_OUT=<dir>  (default: screenshots/stress)
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.STRESS_OUT ? path.resolve(process.env.STRESS_OUT) : path.join(appDir, "screenshots", "stress");
const ARMS = (process.env.STRESS_ARMS ?? "dom,gpu").split(",").map((s) => s.trim()).filter(Boolean);
const NS = (process.env.STRESS_N ?? "24,48,96,192,384").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
const ROUNDS = Math.max(1, Number(process.env.STRESS_ROUNDS ?? "2") || 2);
const WINDOW_MS = Math.max(500, Number(process.env.STRESS_WINDOW_MS ?? "4000") || 4000);
const SETTLE_MS = 600;
/**
 * PROFILE MODE (`STRESS_PROFILE=1`): one CDP CPU profile per animation window and per
 * pan window, aggregated by SELF time per function, so the report can say WHERE the
 * main thread's time goes and not only how much. Function names survive only in an
 * unminified bundle — build one with `pnpm exec vite build --minify false --outDir
 * dist-profile` and point the driver at it with `STRESS_DIST=dist-profile`.
 */
const PROFILE = process.env.STRESS_PROFILE === "1";
const DIST = process.env.STRESS_DIST ?? "dist";
const BUCKETS = [30, 15];
/** How long the compositor frame stream is watched per witness (ms). */
const STREAM_MS = Math.max(500, Number(process.env.STRESS_STREAM_MS ?? "1500") || 1500);

const log = (m) => console.log(`[stress] ${m}`);
const failures = [];
const check = (ok, what) => { log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures.push(what); };
const pageUrl = (arm, n) => `file://${path.join(appDir, DIST, "stress.html")}?arm=${arm}&n=${n}`;
const median = (xs) => { const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b); return s.length === 0 ? Number.NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");

/** Decode an 8-bit non-interlaced PNG (what Playwright writes). */
function decodePng(buf) {
  let off = 8;
  let width = 0; let height = 0; let channels = 4;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString("ascii", off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); const ct = data[9]; channels = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1; if (data[8] !== 8 || data[12] !== 0) throw new Error("png: 8-bit non-interlaced only"); }
    else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      out[dst + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}
/**
 * The motion witness: a rect captured `samples` times, `gapMs` apart, and the pixels that
 * differ by more than 16/255 between CONSECUTIVE captures. `max` > 0 says the presented
 * pixels move at all; `min` = 0 with `max` > 0 says they stalled between two captures;
 * every pair 0 says the picture is frozen for the whole span — the stale-texture class a
 * counter cannot see (a copy that lands from an unchanged paint record still counts).
 */
async function motion(page, rect, samples = 4, gapMs = 300) {
  const clip = { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.max(2, Math.ceil(rect.w)), height: Math.max(2, Math.ceil(rect.h)) };
  const shots = [];
  for (let i = 0; i < samples; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
    shots.push(decodePng(await page.screenshot({ type: "png", clip })));
  }
  const series = [];
  for (let k = 1; k < shots.length; k++) {
    const a = shots[k - 1]; const b = shots[k];
    if (a.width !== b.width || a.height !== b.height) return { differing: -1, min: -1, max: -1, series: [], total: 0, error: "size mismatch" };
    const total = a.width * a.height;
    let differing = 0;
    for (let i = 0; i < total; i++) {
      let worst = 0;
      for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[i * a.channels + c] - b.data[i * b.channels + c]); if (d > worst) worst = d; }
      if (worst > 16) differing += 1;
    }
    series.push(differing);
  }
  const total = shots[0].width * shots[0].height;
  return { differing: Math.max(...series), min: Math.min(...series), max: Math.max(...series), series, total, gapMs, error: null };
}
/**
 * THE THIRD WITNESS: the compositor's own frame stream, from the main process.
 * `webContents.beginFrameSubscription` hands over every frame the display compositor
 * produces for the window, which is what the screen shows — independent of the page's
 * counters (calls made) and of the CDP screenshot (a capture of a surface). Over `ms`
 * it counts frames and hashes card 0's spinner region in each, so "the presented
 * picture froze" and "the capture was stale" can be told apart.
 */
async function framesWitness(app, rect, ms) {
  return app.evaluate(async ({ BrowserWindow }, { rect, ms }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const wc = win.webContents;
    const scale = win.webContents.getZoomFactor ? 1 : 1;
    const hashes = [];
    let frames = 0;
    let size = null;
    // FNV-1a over the crop's bitmap — the main process's evaluate scope has no `require`.
    const fnv = (buf) => { let h = 2166136261; for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
    await new Promise((resolve) => {
      wc.beginFrameSubscription(false, (image) => {
        frames += 1;
        try {
          if (size === null) size = image.getSize();
          const sz = image.getSize();
          // the image is in device px when it carries a scale factor; crop in its own px
          const k = sz.width / rect.viewportW;
          const crop = image.crop({ x: Math.floor(rect.x * k), y: Math.floor(rect.y * k), width: Math.max(2, Math.ceil(rect.w * k)), height: Math.max(2, Math.ceil(rect.h * k)) });
          const h = fnv(crop.toBitmap());
          if (hashes.length === 0 || hashes[hashes.length - 1] !== h) hashes.push(h);
        } catch (e) {
          hashes.push(`err:${e.message}`);
        }
      });
      setTimeout(() => { wc.endFrameSubscription(); resolve(); }, ms);
    });
    return { frames, distinctSpinner: hashes.length, hashes: hashes.slice(0, 12), size, scale };
  }, { rect, ms });
}

/** Physical footprint of a process in MB from `vmmap --summary`, or null. */
function footprint(pid) {
  try {
    const txt = execFileSync("vmmap", ["--summary", String(pid)], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] });
    const m = /Physical footprint:\s+([\d.]+)\s*([KMG])/i.exec(txt);
    if (!m) return null;
    const v = Number(m[1]);
    const u = m[2].toUpperCase();
    return u === "G" ? v * 1024 : u === "K" ? v / 1024 : v;
  } catch {
    return null;
  }
}

/** Aggregate a CDP profile by self time per function (ms), descending. */
function aggregateProfile(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const deltas = profile.timeDeltas ?? [];
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]);
    const dt = (deltas[i] ?? 0) / 1000;
    total += dt;
    if (node === undefined) continue;
    const cf = node.callFrame;
    const file = cf.url ? cf.url.split("/").pop().split("?")[0] : "";
    const key = `${cf.functionName || "(anonymous)"}${file ? ` · ${file}:${cf.lineNumber + 1}` : ""}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  const rows = [...self.entries()].map(([fn, ms]) => ({ fn, ms, pct: total > 0 ? (100 * ms) / total : 0 })).sort((a, b) => b.ms - a.ms);
  return { totalMs: total, top: rows.slice(0, 24) };
}

/** One cell: a fresh app, one arm, one board size. */
async function cell(arm, n, round, wantShot) {
  const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
  const renderer = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (e) => { renderer.push(`error: ${e.message}`); console.error(`  [renderer:error] ${e.message}`); });
    page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) { renderer.push(t); console.log(`  [renderer] ${t}`); } });

    // Per-process CPU since the previous call (Electron's own accounting; 100 = one core) and working sets.
    const metrics = async () => app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, cpu: m.cpu.percentCPUUsage, wsKB: m.memory?.workingSetSize ?? 0 })));
    const fold = (ms) => { const out = { renderer: 0, gpu: 0, browser: 0, other: 0 }; for (const m of ms) { if (m.type === "Tab") out.renderer += m.cpu; else if (m.type === "GPU") out.gpu += m.cpu; else if (m.type === "Browser") out.browser += m.cpu; else out.other += m.cpu; } return out; };
    const pids = (ms) => { let gpu = null; let tab = null; let tabWs = -1; for (const m of ms) { if (m.type === "GPU") gpu = m.pid; if (m.type === "Tab" && m.wsKB > tabWs) { tab = m.pid; tabWs = m.wsKB; } } return { gpu, renderer: tab }; };
    const footprints = (ms) => { const p = pids(ms); const ws = {}; for (const m of ms) { if (m.type === "GPU") ws.gpuWsMB = m.wsKB / 1024; if (m.pid === p.renderer) ws.rendererWsMB = m.wsKB / 1024; } return { gpuMB: p.gpu === null ? null : footprint(p.gpu), rendererMB: p.renderer === null ? null : footprint(p.renderer), ...ws }; };

    await page.goto(pageUrl(arm, n));
    await page.waitForFunction(() => window.__stressRig !== undefined, null, { timeout: 30_000 });
    await page.evaluate(() => window.__stressRig.ready);
    const mounted = await page.evaluate(() => window.__stressRig.mount());
    log(`[${arm} n=${n} r${round}] mount: ${JSON.stringify(mounted)}`);
    const board = await page.evaluate(() => window.__stressRig.board());
    log(`[${arm} n=${n} r${round}] board: ${JSON.stringify(board)}`);
    // A board that did not mount is not a measurement: the cell is retried once by the matrix loop.
    if (board.cards !== n || board.hostsMounted !== n) throw new Error(`board did not mount: ${board.cards}/${n} cards built, ${board.hostsMounted}/${n} hosts (camera ${JSON.stringify(board.camera)})`);
    await page.evaluate((ms) => window.__stressRig.window(ms), SETTLE_MS);
    const fp0 = footprints(await metrics());
    log(`[${arm} n=${n} r${round}] footprint after board: ${JSON.stringify(fp0)}`);

    const phases = {};
    const run = async (name, anim, opts) => {
      const a = await page.evaluate((m) => window.__stressRig.anim(m), anim);
      await page.evaluate((ms) => window.__stressRig.window(ms), SETTLE_MS); // the animation and the clamp reach steady state; discarded
      await metrics(); // reset the CPU accounting to this window
      const w = await page.evaluate(([ms, o]) => window.__stressRig.window(ms, o), [WINDOW_MS, opts]);
      const cpu = fold(await metrics());
      const secs = w.wallMs / 1000;
      const row = { ...w, cpu, animations: a.animations, perSecond: { copies: w.delta.copies / secs, submits: w.delta.submits / secs, dirtied: w.delta.dirtied / secs, redraws: w.delta.redraws / secs } };
      phases[name] = row;
      if (w.clipFields) {
        log(`[${arm} n=${n} r${round}] ${name}: clip polygons recomputed ${w.clipFields.clips} · card 0's clip-key fields that moved first→last frame: ${w.clipFields.changed.length ? w.clipFields.changed.map((k) => `${k} ${w.clipFields.first[k]} → ${w.clipFields.last[k]}`).join("; ") : "none"}`);
        for (const e of w.clipFields.early ?? []) log(`[${arm} n=${n} r${round}] ${name}: frame ${e.frame} moved ${e.changed.map((k) => `${k} ${e.from[k]} → ${e.to[k]}`).join("; ")}`);
      }
      if (w.cameraDrifts || w.foreignCameraWrites) log(`[${arm} n=${n} r${round}] ${name}: camera drifts so far ${w.cameraDrifts}, foreign Camera writes so far ${w.foreignCameraWrites}`);
      log(`[${arm} n=${n} r${round}] ${name.padEnd(22)} fps ${f1(w.fps)} (p50 ${f1(w.interval.p50)} p95 ${f1(w.interval.p95)} max ${f1(w.interval.max)} ms; >25ms ${w.interval.over25}) · rAF ${f2(w.rafMsPerFrame)} ms/frame (max ${f1(w.rafMaxMs)}) · copies/s ${f1(row.perSecond.copies)} submits/s ${f1(row.perSecond.submits)} dirt/s ${f1(row.perSecond.dirtied)} · cpu renderer ${f1(cpu.renderer)}% gpu ${f1(cpu.gpu)}% · long ${w.delta.longTasks}/${f1(w.delta.longTaskMs)}ms · anims ${a.animations}${w.zoomRange ? ` · zoom ${f2(w.zoomRange.from)}→${f2(w.zoomRange.to)} band ${w.zoomRange.bandFrom}→${w.zoomRange.bandTo}` : ""}`);
      return row;
    };

    await run("idle", "none", {});
    await run("compositor-one", "compositor-one", {});
    await run("compositor", "compositor", {});
    let profiles = null;
    if (PROFILE) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
      const profiled = async (name, anim, opts) => {
        await page.evaluate((m) => window.__stressRig.anim(m), anim);
        await page.evaluate((ms) => window.__stressRig.window(ms), SETTLE_MS);
        await cdp.send("Profiler.start");
        const w = await page.evaluate(([ms, o]) => window.__stressRig.window(ms, o), [WINDOW_MS, opts]);
        const { profile } = await cdp.send("Profiler.stop");
        const agg = aggregateProfile(profile);
        log(`[${arm} n=${n} r${round}] profile ${name}: ${f1(agg.totalMs)} ms sampled over ${w.frames} frames (rAF ${f2(w.rafMsPerFrame)} ms/frame)`);
        for (const r of agg.top.slice(0, 12)) log(`    ${f1(r.ms).padStart(8)} ms ${f1(r.pct).padStart(5)}%  ${r.fn}`);
        return { window: { frames: w.frames, wallMs: w.wallMs, rafMsPerFrame: w.rafMsPerFrame, copies: w.delta.copies, submits: w.delta.submits }, ...agg };
      };
      profiles = { compositor: await profiled("compositor", "compositor", {}), pan: await profiled("compositor+pan", "compositor", { pan: true }) };
      await cdp.send("Profiler.disable");
      await cdp.detach();
    }
    const rects = await page.evaluate(() => window.__stressRig.rects(0));
    const rectsLast = await page.evaluate((i) => window.__stressRig.rects(i), n - 1);
    // WHOLE-CARD crops. Under `band` raster the host's CSS box is band space, so at a band other
    // than 1 a widget's px-fixed content reflows and a crop aimed at the world-size layout misses
    // the spinner (the first sweep read a frozen picture at 192 and 384 cards for exactly that
    // reason; the pictures showed the ring elsewhere and the bar clipped off the box). Any change
    // anywhere in the card is motion, on either arm, at any band.
    const spinMotion = await motion(page, rects.card);
    const spinMotionLast = await motion(page, rectsLast.card);
    // The GPU-side witness beside the screen-side one: does the COPY bring new texels?
    const texelSeries = [];
    for (let k = 0; k < 4; k++) {
      if (k > 0) await new Promise((r) => setTimeout(r, 300));
      texelSeries.push(await page.evaluate(() => window.__stressRig.texels(0)));
    }
    const vp = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
    const composited = await framesWitness(app, { ...rects.card, viewportW: vp.w }, STREAM_MS);
    log(`[${arm} n=${n} r${round}] compositor frame stream over ${STREAM_MS} ms: ${composited.frames} frames, ${composited.distinctSpinner} distinct spinner crops (${composited.hashes.join(" ")}; frame ${composited.size ? `${composited.size.width}x${composited.size.height}` : "?"})`);
    const texelHashes = texelSeries.map((t) => (t === null ? null : t.hash));
    const texelChanges = texelHashes.slice(1).filter((h, k) => h !== null && h !== texelHashes[k]).length;
    if (texelHashes[0] !== null) log(`[${arm} n=${n} r${round}] texel witness (card 0's slot, 4 readbacks 300 ms apart): hashes ${texelHashes.join(" ")} → ${texelChanges} of 3 consecutive pairs changed (ink ${texelSeries[0].ink}/${texelSeries[0].w * texelSeries[0].h})`);
    let shot = null;
    if (wantShot) { fs.mkdirSync(outDir, { recursive: true }); shot = path.join(outDir, `stress-${arm}-${n}-compositor.png`); fs.writeFileSync(shot, await page.screenshot()); }
    await run("paint", "paint", {});
    const barMotion = await motion(page, rects.card);
    // THE DRAG (the gesture set, 2026-09-09): grab card 0, carry it onto card 1, read the overlap's pixel, release, settle.
    await page.evaluate((m) => window.__stressRig.anim(m), "none");
    await page.evaluate((ms) => window.__stressRig.window(ms), SETTLE_MS);
    await metrics();
    const drag = await page.evaluate((ms) => window.__stressRig.drag(ms), 2500);
    const dragCpu = fold(await metrics());
    const px = decodePng(await page.screenshot({ type: "png", clip: { x: Math.floor(drag.over.sample.x) - 1, y: Math.floor(drag.over.sample.y) - 1, width: 3, height: 3 } }));
    const mid = ((1 * px.width) + 1) * px.channels;
    const rgb = [px.data[mid], px.data[mid + 1], px.data[mid + 2]];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const overlapCarried = dist(rgb, drag.over.expectRgb) < dist(rgb, drag.over.underRgb);
    const release = await page.evaluate((ms) => window.__stressRig.release(ms), 600);
    const plates = drag.plateFrames.filter((f) => f.textured < f.cards).length;
    phases.drag = { ...drag, cpu: dragCpu, overlap: { rgb, carried: overlapCarried }, plates, release };
    log(`[${arm} n=${n} r${round}] drag: after the grab ${drag.targets.gpu}/${n} on the GPU, ${drag.demand.paused}/${n} paused · pickup longest frame ${f1(drag.pickupMaxMs)} ms · plate frames ${plates} of ${drag.plateFrames.length} (${drag.plateFrames.slice(0, 6).map((f) => `${f.textured}/${f.cards}`).join(" ")}) · carry ${f1(drag.fps)} fps (p95 ${f1(drag.interval.p95)} max ${f1(drag.interval.max)} ms) · copies ${drag.delta.copies} (stills ${drag.stills}) submits ${drag.delta.submits} · rAF ${f2(drag.rafMsPerFrame)} ms/frame · cpu renderer ${f1(dragCpu.renderer)}% gpu ${f1(dragCpu.gpu)}% · overlap pixel rgb(${rgb.join(",")}) ${overlapCarried ? "IS the carried card" : "is the card UNDER it"} · release+600 ms: ${release.targets.dom}/${n} on the DOM, ${release.demand.live}/${n} live, ${release.delta.copies} copies`);
    if (arm === "dom") {
      check(drag.targets.gpu === n && drag.demand.paused === n, `[${arm} n=${n} r${round}] a grab promotes the BOARD as stills (${drag.targets.gpu}/${n} gpu, ${drag.demand.paused}/${n} paused)`);
      check(drag.delta.copies <= n + 4 && drag.delta.copies >= n, `[${arm} n=${n} r${round}] the carry costs one copy per card and no more (${drag.delta.copies} copies for ${n} cards over ${drag.frames} frames)`);
      check(release.targets.dom === n && release.demand.live === n, `[${arm} n=${n} r${round}] the set comes back after the settle (${release.targets.dom}/${n} dom, ${release.demand.live}/${n} live)`);
    }
    check(overlapCarried, `[${arm} n=${n} r${round}] the CARRIED card draws ABOVE the card it overlaps (overlap pixel rgb(${rgb.join(",")}), carried ${drag.over.expectRgb.join(",")} vs under ${drag.over.underRgb.join(",")})`);
    const fpA = footprints(await metrics());
    log(`[${arm} n=${n} r${round}] footprint after the animation phases (before the camera moves): ${JSON.stringify(fpA)}`);
    await run("compositor+pan", "compositor", { pan: true });
    await run("compositor+zoomcross", "compositor", { zoomCross: true });
    if (arm === "gpu") {
      for (const fps of BUCKETS) {
        const b = await page.evaluate((f) => window.__stressRig.bucket(f), fps);
        log(`[${arm} n=${n} r${round}] bucket ${fps}: ${JSON.stringify(b)}`);
        const row = await run(`compositor@${fps}`, "compositor", {});
        // The presentation witness at this bucket: does the screen move when the copy rate is the same but the main thread is not saturated?
        const stream = await framesWitness(app, { ...rects.card, viewportW: vp.w }, STREAM_MS);
        row.composited = { frames: stream.frames, distinct: stream.distinctSpinner };
        log(`[${arm} n=${n} r${round}] compositor frame stream at bucket ${fps} over ${STREAM_MS} ms: ${stream.frames} frames, ${stream.distinctSpinner} distinct spinner crops`);
      }
      await page.evaluate((f) => window.__stressRig.bucket(f), 60);
    }
    const fp1 = footprints(await metrics());
    await page.evaluate(() => window.__stressRig.anim("none"));
    log(`[${arm} n=${n} r${round}] footprint after the phases: ${JSON.stringify(fp1)} · spinner motion ${spinMotion.series.join("/")} of ${spinMotion.total} px (last card ${spinMotionLast.series.join("/")}) · bar motion ${barMotion.series.join("/")} of ${barMotion.total} px`);

    // The witnesses the counters cannot give.
    if (arm === "gpu") check(texelChanges > 0, `[${arm} n=${n} r${round}] the copy brings NEW texels into card 0's slot (${texelChanges} of 3 consecutive readbacks differ)`);
    check(composited.frames > 0 && composited.distinctSpinner > 1, `[${arm} n=${n} r${round}] the compositor's frame stream shows the spinner moving (${composited.distinctSpinner} distinct crops over ${composited.frames} frames)`);
    check(spinMotion.max > 0, `[${arm} n=${n} r${round}] card 0 MOVES in the presented pixels (whole-card crop) (consecutive diffs ${spinMotion.series.join("/")} of ${spinMotion.total} px, ${spinMotion.gapMs} ms apart)`);
    check(spinMotionLast.max > 0, `[${arm} n=${n} r${round}] the LAST card moves too (whole-card crop) (${spinMotionLast.series.join("/")} of ${spinMotionLast.total} px)`);
    check(barMotion.max > 0, `[${arm} n=${n} r${round}] card 0 moves under the paint animation (whole-card crop) (${barMotion.series.join("/")} of ${barMotion.total} px)`);
    if (arm === "dom") {
      check(board.targets.gpu === 0 && board.textured === 0, `[${arm} n=${n} r${round}] every card is on the live DOM (gpu targets ${board.targets.gpu}, textured ${board.textured})`);
      // Every phase but the drag: the gesture set (S1) copies each card once at the pickup, by design.
      check(Object.entries(phases).filter(([k]) => k !== "drag").every(([, p]) => p.delta.copies === 0), `[${arm} n=${n} r${round}] the dom arm copied nothing outside the drag`);
    } else {
      check(board.targets.gpu === n && board.written === n, `[${arm} n=${n} r${round}] every card is on the GPU and written (targets ${board.targets.gpu}/${n}, written ${board.written}/${n})`);
      check(phases.compositor.delta.copies > 0 && phases.paint.delta.copies > 0, `[${arm} n=${n} r${round}] the gpu arm copies while animating (${phases.compositor.delta.copies} / ${phases.paint.delta.copies})`);
    }
    check(phases.idle.delta.submits === 0 && phases.idle.delta.copies === 0, `[${arm} n=${n} r${round}] idle-zero on the settled board (${phases.idle.delta.submits} submits, ${phases.idle.delta.copies} copies over ${phases.idle.frames} frames)`);
    check(phases.compositor.animations >= 2 * n && phases.paint.animations >= 2 * n, `[${arm} n=${n} r${round}] the animations ran on every card (${phases.compositor.animations} / ${phases.paint.animations} for ${2 * n})`);

    return { arm, n, round, loadavg: os.loadavg(), mounted, board, phases, witness: { spin: spinMotion, spinLast: spinMotionLast, bar: barMotion, composited, texels: { hashes: texelHashes, changes: texelChanges, ink: texelSeries[0]?.ink ?? null } }, footprint: { afterBoard: fp0, afterAnim: fpA, afterPhases: fp1 }, screenshot: shot, renderer, profiles };
  } finally {
    await app.close().catch(() => {});
  }
}

// ---- CPU calibration --------------------------------------------------------
// `percentCPUUsage` is Electron's number, and on macOS it has historically been
// normalised by the core count. A fully busy main thread for two seconds says which:
// ~100 means "percent of one core", ~100/cores means "percent of the machine".
async function calibrateCpu() {
  const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
  try {
    const page = await app.firstWindow();
    await page.goto(pageUrl("dom", 1));
    await page.waitForFunction(() => window.__stressRig !== undefined, null, { timeout: 30_000 });
    await page.evaluate(() => window.__stressRig.ready);
    const metrics = async () => app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })));
    await metrics();
    await new Promise((r) => setTimeout(r, 500));
    await metrics();
    await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 2000) { /* one busy main thread */ } });
    const after = await metrics();
    let renderer = 0;
    for (const m of after) if (m.type === "Tab") renderer += m.cpu;
    const cores = os.cpus().length;
    const scale = renderer > 0 && renderer < 60 ? cores : 1;
    log(`cpu calibration: a busy main thread reads ${f1(renderer)}% on a ${cores}-core host → the metric is ${scale === 1 ? "percent of one core" : `normalised by the core count; ×${cores} = percent of one core`}`);
    return { rendererDuringSpin: renderer, cores, scale };
  } finally {
    await app.close().catch(() => {});
  }
}
const cpuCalibration = await calibrateCpu();

// ---- the matrix, interleaved and rotated ----------------------------------
const cells = [];
for (const n of NS) for (const arm of ARMS) cells.push({ arm, n });
const runs = [];
const started = new Date();
log(`host: ${os.cpus().length} cpus · loadavg at start ${os.loadavg().map((x) => x.toFixed(2)).join(" ")} · arms ${ARMS.join(",")} · n ${NS.join(",")} · rounds ${ROUNDS} · window ${WINDOW_MS} ms`);
for (let round = 0; round < ROUNDS; round++) {
  const order = round % 2 === 0 ? cells : [...cells].reverse();
  for (const c of order) {
    const wantShot = round === 0 && c.n === Math.max(...NS);
    let attempt = 0;
    for (;;) {
      try {
        runs.push(await cell(c.arm, c.n, round, wantShot));
        break;
      } catch (err) {
        console.error(err);
        if (attempt === 0 && /board did not mount/.test(String(err?.message))) { attempt += 1; log(`[${c.arm} n=${c.n} r${round}] retrying the cell once (a board that never mounted)`); continue; }
        failures.push(`[${c.arm} n=${c.n} r${round}] threw: ${err.message}`);
        runs.push({ arm: c.arm, n: c.n, round, error: String(err?.stack ?? err) });
        break;
      }
    }
  }
}

// ---- the summary: medians across rounds per (arm, n, phase) ---------------
const summary = [];
const phaseNames = ["idle", "compositor-one", "compositor", "paint", "drag", "compositor+pan", "compositor+zoomcross", ...BUCKETS.map((b) => `compositor@${b}`)];
for (const n of NS) for (const arm of ARMS) for (const ph of phaseNames) {
  const rows = runs.filter((r) => r.arm === arm && r.n === n && r.phases?.[ph]).map((r) => r.phases[ph]);
  if (rows.length === 0) continue;
  summary.push({
    arm, n, phase: ph, rounds: rows.length,
    fps: median(rows.map((r) => r.fps)),
    p50: median(rows.map((r) => r.interval.p50)),
    p95: median(rows.map((r) => r.interval.p95)),
    max: median(rows.map((r) => r.interval.max)),
    over12: median(rows.map((r) => r.interval.over12)),
    over25: median(rows.map((r) => r.interval.over25)),
    rafMsPerFrame: median(rows.map((r) => r.rafMsPerFrame)),
    rafMaxMs: median(rows.map((r) => r.rafMaxMs)),
    copiesPerS: median(rows.map((r) => r.perSecond.copies)),
    submitsPerS: median(rows.map((r) => r.perSecond.submits)),
    dirtPerS: median(rows.map((r) => r.perSecond.dirtied)),
    cpuRenderer: median(rows.map((r) => r.cpu.renderer)),
    cpuGpu: median(rows.map((r) => r.cpu.gpu)),
    longTasks: median(rows.map((r) => r.delta.longTasks)),
  });
}
const memory = [];
for (const n of NS) for (const arm of ARMS) {
  const rows = runs.filter((r) => r.arm === arm && r.n === n && r.footprint);
  if (rows.length === 0) continue;
  memory.push({ arm, n, rounds: rows.length,
    gpuAfterBoardMB: median(rows.map((r) => r.footprint.afterBoard.gpuMB)), gpuAfterAnimMB: median(rows.map((r) => r.footprint.afterAnim.gpuMB)), rendererAfterAnimMB: median(rows.map((r) => r.footprint.afterAnim.rendererMB)), gpuAfterPhasesMB: median(rows.map((r) => r.footprint.afterPhases.gpuMB)),
    rendererAfterBoardMB: median(rows.map((r) => r.footprint.afterBoard.rendererMB)), rendererAfterPhasesMB: median(rows.map((r) => r.footprint.afterPhases.rendererMB)),
    pagesLayers: median(rows.map((r) => r.board.pagesLayers)), slotTexels: median(rows.map((r) => r.board.slotTexels)), zoom: median(rows.map((r) => r.board.zoom)), band: median(rows.map((r) => r.board.band)) });
}

log("");
log(`${"arm".padEnd(4)} ${"n".padStart(4)} ${"phase".padEnd(22)} ${"fps".padStart(6)} ${"p95ms".padStart(6)} ${"maxms".padStart(6)} ${">12".padStart(4)} ${">25".padStart(4)} ${"rAFms".padStart(6)} ${"cp/s".padStart(7)} ${"sub/s".padStart(6)} ${"dirt/s".padStart(8)} ${"cpuR%".padStart(6)} ${"cpuG%".padStart(6)}`);
for (const s of summary) log(`${s.arm.padEnd(4)} ${String(s.n).padStart(4)} ${s.phase.padEnd(22)} ${f1(s.fps).padStart(6)} ${f1(s.p95).padStart(6)} ${f1(s.max).padStart(6)} ${String(s.over12).padStart(4)} ${String(s.over25).padStart(4)} ${f2(s.rafMsPerFrame).padStart(6)} ${f1(s.copiesPerS).padStart(7)} ${f1(s.submitsPerS).padStart(6)} ${f1(s.dirtPerS).padStart(8)} ${f1(s.cpuRenderer).padStart(6)} ${f1(s.cpuGpu).padStart(6)}`);
log("");
for (const m of memory) log(`memory ${m.arm} n=${m.n}: GPU process ${f1(m.gpuAfterBoardMB)} → ${f1(m.gpuAfterAnimMB)} (anim) → ${f1(m.gpuAfterPhasesMB)} (camera) MB · renderer ${f1(m.rendererAfterBoardMB)} → ${f1(m.rendererAfterAnimMB)} → ${f1(m.rendererAfterPhasesMB)} MB · page layers ${m.pagesLayers} · slot ${m.slotTexels} texels · zoom ${f2(m.zoom)} band ${m.band}`);

fs.mkdirSync(outDir, { recursive: true });
const stamp = started.toISOString().replace(/[:.]/g, "-");
const out = { started: started.toISOString(), finished: new Date().toISOString(), host: { cpus: os.cpus().length, model: os.cpus()[0]?.model, cpu: cpuCalibration, mem: os.totalmem(), platform: `${os.platform()} ${os.release()}`, loadavgStart: runs[0]?.loadavg ?? null, loadavgEnd: os.loadavg() }, config: { arms: ARMS, ns: NS, rounds: ROUNDS, windowMs: WINDOW_MS, settleMs: SETTLE_MS, buckets: BUCKETS }, summary, memory, runs, failures };
fs.writeFileSync(path.join(outDir, `stress-${stamp}.json`), `${JSON.stringify(out, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "stress-latest.json"), `${JSON.stringify(out, null, 2)}\n`);
log(`wrote ${path.join(outDir, `stress-${stamp}.json`)}`);
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
