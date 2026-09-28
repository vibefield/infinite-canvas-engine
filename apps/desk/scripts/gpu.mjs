// rig:gpu — THE GPU PROFILER on real frames (design-016 §4, K2; K-L5 "measured on real frames: the span is the headline, counts
// and bytes come from the calls themselves, quantised clocks are flagged; unarmed it costs nothing; armed it adds no submit and
// never wakes the desk"). Driven through `window.__desk` and the keyboard (CDP key events into the page — never OS input):
//
//   the clock        cross-origin isolated (performance.now at µs); timestamp-query on the desk's device
//   unarmed          at boot the queue and the encoder door are the device's own (no wrapper); the memory ledger is the one
//                    instrument kept from the boot, because the app asks for it (D-K2.2)
//   the dock         ⇧` opens @ice/devtools' dock with its gpu slot, waiting for a frame, the profiler ARMED; ⇧` again closes
//                    it and every wrapper is gone; armed at rest, 240 frames: 0 submits, 0 redraws, no frame; after a camera
//                    move the slot reads live numbers (a screenshot into DESK_GPU_OUT, default apps/desk/results)
//   the counts       24 notes in ONE run are ONE instanced draw of 24; notes · print · notes · print · print split the note run
//                    in two (the code's rule: a run of one kind at a time, in paint order) — 2 draws of 5, and the 3 prints 2
//                    draws of 3 (the two side by side one instanced draw since K6a)
//   the span         a multi-pass frame (the notebook's shadow and layer, the ground): its span — first begin → last end — is
//                    well formed and > 0, and a SUM of its passes is not the frame's time: the tiler overlaps passes (sum > span
//                    in most frames) and the GPU waits between them (the drawable: span > sum in some — D-K2.4); unquantised
//                    under the rig's Chrome switch
//   memory, uploads  the ledger's rows sum to its total; the calendar's printed tiles are uploads (copyExternalImageToTexture,
//                    a canvas → a 260² rgba8 tile: 270,400 bytes each)
//   capture          20 frames → a Chrome trace-event JSON (CPU spans, a GPU track per pass, counters), saved beside the shot
//   per-kind cost    the ablation's A/A control within its noise floor
//   the drawer       (K3) armed with the pegboard drawer OPEN and at rest, 240 frames: 0 submits, 0 redraws, no frame; then a
//                    scroll: its pipeline `tray/pegboard` is each frame's `tray` row — two draws (the board to its edge, the
//                    accessories), inside the `ground` pass — its blocks uploaded (its light block never), the ledger's `tray` row
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:gpu        (DESK_HEADED=1 to watch)
// Exit 0 = every check passed; 1 = a check failed or a throw; 2 = the watchdog.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, until, watchPage } from "./cdp.mjs";
import { aaVerdict, hostLoad, twoWitnesses, watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const OUT = process.env.DESK_GPU_OUT ?? resolve(app, "results");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
const kick = watchdog(300_000, cleanup);   // no row in 300 s: a hang (K-H — a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };
const fmt = (v, d = 2) => (typeof v === "number" ? v.toFixed(d) : String(v));

/** The wrappers an instrument installs, as own properties of the queue and the device (unwrapped, their methods are the prototypes'). */
const WRAPPED = `(() => { const d = window.__desk.handle.device(); return [...['submit', 'writeBuffer', 'writeTexture', 'copyExternalImageToTexture'].filter((m) => Object.hasOwn(d.queue, m)), ...(Object.hasOwn(d, 'createCommandEncoder') ? ['createCommandEncoder'] : [])]; })()`;

try {
  mkdirSync(OUT, { recursive: true });
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  const front = () => tab.send("Page.bringToFront");
  await front();
  const q = (js, timeoutMs = 20000) => tab.evaluate(js, { timeoutMs });
  const qa = (js, timeoutMs = 60000) => tab.evaluate(js, { awaitPromise: true, timeoutMs });
  const settle = async (ms = 8000) => { await front(); return qa(`window.__desk.settle(${ms})`); };
  /** ⇧` — the dock's key (CDP key events into the page). */
  const tilde = async () => {
    await front();
    await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "~", code: "Backquote", windowsVirtualKeyCode: 192, modifiers: 8, text: "~" });
    await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "~", code: "Backquote", windowsVirtualKeyCode: 192, modifiers: 8 });
    await sleep(150);
  };
  /** `n` frames drawn: the camera moved a pixel each, from `cam`; the readbacks given a moment to land; the frames taken. */
  const frames = async (n, cam) => {
    await front();
    return qa(`(async () => {
      const d = window.__desk; const c = ${JSON.stringify(cam)};
      for (let i = 1; i <= ${n}; i++) { d.setCamera({ x: c.x + i, y: c.y, zoom: c.zoom }); await new Promise((r) => requestAnimationFrame(r)); }
      await new Promise((r) => setTimeout(r, 250));
      return d.perf.take().gpu.frames.filter((f) => f.kind === "frame");
    })()`);
  };

  // ── the clock
  const clock = await q("({ coi: crossOriginIsolated, ts: window.__desk.handle.device().features.has('timestamp-query'), supported: window.__desk.perf.gpu()?.supported ?? false })");
  check(clock.coi && clock.ts && clock.supported, `the clock: cross-origin isolated ${clock.coi}, timestamp-query on the desk's device ${clock.ts}, the profiler supported ${clock.supported}`);

  // ── unarmed at boot: nothing wraps the queue or the encoder door; the ledger is kept from the boot (the app asks, D-K2.2)
  const boot = await q(`({ wrapped: ${WRAPPED}, armed: window.__desk.perf.gpu().armed(), ledger: window.__desk.handle.gpuMemory() !== undefined, ledgerWraps: Object.hasOwn(window.__desk.handle.device(), 'createTexture') })`);
  check(boot.wrapped.length === 0 && !boot.armed, `unarmed at boot: the queue's submit/writes/external copies and the device's createCommandEncoder are its own (wrapped: [${boot.wrapped}]), the profiler unarmed`);
  check(boot.ledger && boot.ledgerWraps, "the memory ledger is the one instrument kept from the boot — the app asks for it (gpuLedger), a ledger cannot be armed late (D-K2.2)");

  // a desk: 24 notes in ONE run along a row (spawn order = paint order), a notebook and a whiteboard below them; far off, the mixed row
  const N = 24;
  await q(`(() => { const d = window.__desk; for (let i = 0; i < ${N}; i++) d.spawn('desk.note', { seed: i + 1 }, { x: 150 + (i % 12) * 80, y: 200 + Math.floor(i / 12) * 110 }); d.spawn('desk.notebook', { seed: 3, angle: 0.05 }, { x: 760, y: 590 }); d.spawn('desk.board', {}, { x: 300, y: 600 }); return 0; })()`);
  const ROW2 = 6000;   // the mixed row: n n p n n n p p, in paint order
  await q(`(() => { const d = window.__desk; ['desk.note', 'desk.note', 'desk.photo', 'desk.note', 'desk.note', 'desk.note', 'desk.photo', 'desk.photo'].forEach((t, i) => d.spawn(t, t === 'desk.note' ? { seed: 50 + i } : {}, { x: ${ROW2} + 130 + i * 130, y: 400 })); return 0; })()`);
  await q("window.__desk.ambient('still')");
  await settle();
  const cam1 = await q("window.__desk.camera()");

  // ── the dock: ⇧` opens it, armed, waiting; ⇧` closes it, every wrapper gone (the rigs' door has not asked yet). Its code is a
  //    chunk of its own, loaded on the first press: the page's scripts grow by it then, not before
  const scripts = "performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.js')).length";
  const scripts0 = await q(scripts);
  await tilde();
  await until(() => q("window.__desk.dock.isOpen()"), 5000);
  const scripts1 = await q(scripts);
  check(scripts1 > scripts0, `the dock's code loads on the first press, not with the page (${scripts0} → ${scripts1} scripts)`);
  const opened = await q(`({ open: window.__desk.dock.isOpen(), slot: !!document.querySelector('.ice-dock .ice-dock-slot[data-slot="gpu"] .ice-gpu'), waiting: document.querySelector('.ice-gpu-body')?.textContent?.includes('waiting for a frame') ?? false, armed: window.__desk.perf.gpu().armed(), wrapped: ${WRAPPED} })`);
  check(opened.open && opened.slot && opened.waiting && opened.armed && opened.wrapped.includes("createCommandEncoder") && opened.wrapped.includes("submit"), `⇧\` opens the devtools dock: the gpu slot mounted and waiting for a frame, the profiler armed (wrapped: [${opened.wrapped}])`);
  await tilde();
  const closed = await q(`({ open: window.__desk.dock.isOpen(), dom: !!document.querySelector('.ice-dock'), armed: window.__desk.perf.gpu().armed(), wrapped: ${WRAPPED} })`);
  check(!closed.open && !closed.dom && !closed.armed && closed.wrapped.length === 0, `⇧\` again closes it: disarmed, every wrapper gone (wrapped: [${closed.wrapped}])`);

  // ── ARMED AT REST adds nothing (K-L5): the door's counter asked first, the dock opened again; 240 frames
  await q("window.__desk.submits(); 0");
  await settle();
  await tilde();
  await until(() => q("window.__desk.dock.isOpen()"), 5000);
  await front();
  const rest = await qa(`(async () => {
    const d = window.__desk; const n0 = d.submits().total; const r0 = d.handle.redraws(); d.perf.take();
    await new Promise((r) => { let n = 0; const f = () => { if (++n >= 240) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    return { submits: d.submits().total - n0, redraws: d.handle.redraws() - r0, frames: d.perf.take().gpu.frames.length, armed: d.perf.gpu().armed() };
  })()`, 30000);
  check(rest.armed && rest.submits === 0 && rest.redraws === 0 && rest.frames === 0, `armed at rest (the dock open), 240 frames: ${rest.submits} submits, ${rest.redraws} redraws, ${rest.frames} GPU frames — it adds no submit and never wakes the desk`);

  // ── live numbers in the slot after a camera move; the shot
  await frames(40, cam1);
  const slot = await q(`({ head: document.querySelector('.ice-gpu-head')?.textContent ?? '', sects: Array.from(document.querySelectorAll('.ice-gpu-sect')).map((e) => e.textContent), cells: Array.from(document.querySelectorAll('.ice-gpu-cell b')).map((e) => e.textContent) })`);
  const shotPath = resolve(OUT, "gpu-dock.png");
  writeFileSync(shotPath, Buffer.from((await tab.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })).data, "base64"));
  const live = /gpu\s*\d+\.\d+\s*ms/.test(slot.head) && slot.sects.some((s) => s.startsWith("passes · frame")) && slot.sects.some((s) => s.startsWith("memory ·")) && Number(slot.cells[0]) > 0;
  check(live, `the slot reads live numbers after a camera move — "${slot.head.replace(/\s+/g, " ").slice(0, 60)}", ${slot.sects.find((s) => s.startsWith("passes")) ?? "no passes"}, draws ${slot.cells[0]} (shot: ${shotPath})`);
  await tilde();

  // ── the counts: 24 notes in ONE run = ONE instanced draw of 24
  const off = "window.__gpuOff = window.__desk.perf.gpu().arm(); window.__desk.perf.take(); 0";
  await q(off);
  const run1 = await frames(24, cam1);
  const timed1 = run1.filter((f) => f.timing === "timed");
  const last1 = run1.at(-1);
  // (K7b: a note is a FLAT CARD — the one pipeline every card-material kind draws through, `card/flat`)
  check(run1.length > 0 && run1.every((f) => f.byKind.card?.draws === 1 && f.byKind.card?.instances === N), `${N} notes in ONE run: ONE instanced draw of ${N} in every frame (${run1.length} frames: card ${JSON.stringify(last1?.byKind.card)}; the frame ${last1?.counts.draws} draws, ${last1?.counts.pipelines} pipelines, ${last1?.counts.bindGroups} bind groups)`);

  // ── the span on a multi-pass frame (the notebook's shadow, its layer, the ground): first begin → last end, > 0 — and never a sum.
  //    A sum misleads BOTH ways on this Mac (D-K2.4, measured at K2: 52 of 60 frames sum > span, 8 span > sum): the tiler keeps
  //    passes in flight together (sum > span), and the GPU waits between them — for the drawable the ground pass draws into (span > sum)
  const multi = timed1.filter((f) => f.passes.length >= 2);
  const formed = multi.every((f) => f.span > 0 && f.passes.every((p) => p.begin >= 0 && p.end >= p.begin) && Math.abs(Math.max(...f.passes.map((p) => p.end)) - Math.min(...f.passes.map((p) => p.begin)) - f.span) < 1e-9);
  const overlapped = multi.filter((f) => f.sum > f.span + 1e-6);
  const waited = multi.filter((f) => f.span > f.sum + 1e-6);
  const ex = overlapped.at(-1);
  const busyOk = multi.every((f) => f.busy > 0 && f.busy <= f.span + 1e-9 && f.busy <= f.sum + 1e-9);
  check(multi.length > 0 && formed && busyOk && overlapped.length > 0, `the span on a multi-pass frame: first begin → last end, > 0, in all ${multi.length}, the busy within it — and not a sum: passes overlapped in ${overlapped.length} (e.g. ${ex?.passes.map((p) => p.label).join(" · ")}: span ${fmt(ex?.span, 3)} < sum ${fmt(ex?.sum, 3)} ms, busy ${fmt(ex?.busy, 3)}), the GPU waited between passes in ${waited.length} (span > sum)`);
  check(timed1.length > 0 && timed1.every((f) => f.quantised === false), `the timestamps are unquantised under the rig's --disable-dawn-features=timestamp_quantization (${timed1.length} timed frames, none quantised)`);

  // ── per-kind GPU cost by ablation on the settled desk (the notes, the notebook, the whiteboard): the A/A control within its noise
  //    floor, and the floor itself a floor (≤ 10 % of the frame) — a desk drawing frames of its own meanwhile (a calendar still
  //    printing its tiles) shares the GPU with the batches and the tool must say its numbers are noise, not pass on them
  await q("window.__gpuOff(); 0");
  const quiet = await settle();
  // THE A/A BY ITS METHOD (K-H; D-KH.2, D-KH.3): WARM first — an untimed ablation, the GPU coming to it from the settle's idle; then
  // 21 rounds, the control read PAIRED as every kind is and judged against its OWN run's spread (timing.mjs `aaVerdict`), the desk's
  // own frames meanwhile counted (what "the floor ≤ 10 % of the frame" stood in for: a desk drawing beside the batches — a loaded
  // host swelled that floor past 10 % in 4 of 12 runs at load 140 whose A/A read zero, z ≤ 1.9); on a failure ONE second witness
  await qa("window.__desk.perf.kindCost({ rounds: 1 })", 180000);
  const aa = await twoWitnesses(async () => {
    const r0 = await q("window.__desk.handle.redraws()");
    const kc = await qa("window.__desk.perf.kindCost({ rounds: 21 })", 180000);
    return { kc, redraws: (await q("window.__desk.handle.redraws()")) - r0 };
  }, ({ kc, redraws }, earlier) => ({ ...aaVerdict(kc, { redraws, pool: earlier?.kc }), kc }));
  const kc = (aa.second ?? aa.first).kc;
  console.log(`  per-kind GPU         ${Object.entries(kc.kinds).sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => `${k} ${fmt(v.ms, 3)} ms × ${v.objects}${v.clears ? "" : " (under the floor)"}`).join(" · ")} — base ${fmt(kc.base.median, 3)} ms/frame, ${kc.frames}-frame batches × ${kc.rounds} rounds · load ${hostLoad()}`);
  check(quiet.settled && aa.ok, `per-kind cost: the A/A control reads zero by the method's own spread and below every cost it calls real — ${aa.text}; the desk settled first: ${quiet.settled}`);
  await q("window.__gpuOff = window.__desk.perf.gpu().arm(); window.__desk.perf.take(); 0");

  // ── prints between notes split the run as the code says: n n p n n n p p → paper 2 draws / 5 instances, photo 2 draws / 3
  //    instances — the two prints side by side are ONE run and, since K6a (design-016 K-L4), ONE instanced draw
  const cam2 = { x: ROW2, y: cam1.y, zoom: cam1.zoom };
  await q(`window.__desk.setCamera(${JSON.stringify(cam2)})`);
  await settle();
  const run2 = await frames(8, cam2);
  const last2 = run2.at(-1);
  // K7b (design-016 §6 K7): the notes and the prints are FLAT CARDS — the interleaved row is one run, ONE draw (before: the note
  // run cut in two by the prints, paper 2 draws / 5 + photo 2 / 3 since K6a); a print with its detail bound would be its pass's own
  check(run2.length > 0 && last2?.byKind.card?.draws === 1 && last2?.byKind.card?.instances === 8 && (last2?.byKind.paper?.draws ?? 0) === 0 && (last2?.byKind.photo?.draws ?? 0) === 0, `notes · print · notes · print · print: ONE draw of the eight, the flat card's (K7b) — card ${JSON.stringify(last2?.byKind.card)}, paper ${JSON.stringify(last2?.byKind.paper ?? null)}, photo ${JSON.stringify(last2?.byKind.photo ?? null)}`);

  // ── memory: the ledger's rows sum to its total; the calendar's printed tiles are uploads (copyExternalImageToTexture)
  const m = last2?.memory;
  const rowsSum = m ? Object.values(m.byLabel).reduce((s, r) => s + r.bytes, 0) : -1;
  check(m !== null && m !== undefined && m.total > 0 && rowsSum === m.total && m.total === m.textures + m.buffers, `the ledger: ${(m?.total / 1048576).toFixed(1)} MB live, the rows by label sum to it exactly (${Object.entries(m?.byLabel ?? {}).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 4).map(([k, r]) => `${k} ${(r.bytes / 1048576).toFixed(1)} MB`).join(" · ")})`);
  const TILE = 260 * 260 * 4;   // a printed tile: 260² rgba8 (calendar/tiles.ts TILE_TEX, the pass's "calendar/print tiles")
  await q(`window.__desk.perf.take(); window.__desk.spawn('desk.calendar', { month: '2026-09' }, { x: ${ROW2} + 600, y: 640 }); 0`);
  await settle();
  const run3 = [...(await frames(6, cam2))];
  const externals = run3.reduce((n, f) => n + f.counts.externals, 0);
  const tileBytes = run3.reduce((n, f) => n + (f.uploads.calendar?.bytes ?? 0), 0);
  check(externals > 0 && tileBytes >= externals * TILE, `the calendar's printed tiles are uploads: ${externals} external copies (copyExternalImageToTexture — uncounted before K2) over ${run3.length} frames, ${(tileBytes / 1048576).toFixed(2)} MB of calendar uploads ≥ ${externals} × 270,400`);
  await q("window.__gpuOff(); 0");

  // ── capture: 20 frames → a trace-event JSON, saved beside the shot
  await q(`window.__desk.setCamera(${JSON.stringify(cam1)})`);
  await settle();
  await front();
  const trace = await qa(`(async () => {
    const d = window.__desk; const done = d.perf.gpu().capture(20, { timeoutMs: 15000 }); const c = d.camera();
    for (let i = 1; i <= 40; i++) { d.setCamera({ x: c.x + i, y: c.y, zoom: c.zoom }); await new Promise((r) => requestAnimationFrame(r)); }
    return done;
  })()`, 30000);
  const tracePath = resolve(OUT, "gpu-trace.json");
  writeFileSync(tracePath, JSON.stringify(trace));
  const ev = trace.traceEvents;
  const cpu = new Set(ev.filter((e) => e.ph === "X" && e.pid === 1).map((e) => e.name));
  const gpuX = ev.filter((e) => e.ph === "X" && e.pid === 2);
  const tracks = ev.filter((e) => e.ph === "M" && e.name === "thread_name" && e.pid === 2).map((e) => e.args.name);
  check(trace.metadata.frames === 20 && cpu.has("desk flush") && cpu.has("encode") && gpuX.some((e) => e.name === "ground") && tracks.includes("frame span") && ev.some((e) => e.ph === "C" && e.name === "draws") && gpuX.every((e) => e.dur >= 0), `capture: ${trace.metadata.frames} frames → ${ev.length} trace events — CPU ${[...cpu].join(" · ")}; GPU tracks ${tracks.join(" · ")}; counters (${tracePath})`);

  // ── THE DRAWER (K3, design-017) under the profiler. Armed with the drawer OPEN and at rest — the counter read before the arm —
  //    240 frames: no submit, no redraw, no GPU frame (K-L5 · K-L6: its motion is flux that runs only while it moves). Then a
  //    scroll: its pipeline `tray/pegboard` is every frame's `tray` row — TWO draws inside the `ground` pass (it has no pass of its
  //    own: it draws after the marks): the board under its specimens, its edge included (one instance — the rim laid over them all
  //    retired, design-018 §2), and the specimens' accessories (one each) — K5a; the specimens themselves are their kinds' rows. Its
  //    uploads the `tray` row's — its block and the accessories' records, both moving with the board — its blocks and hash texture
  //    the ledger's.
  await q("window.__desk.tray.open(); 0");
  await settle();
  await front();
  const openRest = await qa(`(async () => {
    const d = window.__desk; const n0 = d.submits().total; const r0 = d.handle.redraws();
    window.__gpuOff = d.perf.gpu().arm(); d.perf.take();
    await new Promise((r) => { let n = 0; const f = () => { if (++n >= 240) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    return { open: d.tray.isOpen(), submits: d.submits().total - n0, redraws: d.handle.redraws() - r0, frames: d.perf.take().gpu.frames.length, armed: d.perf.gpu().armed() };
  })()`, 30000);
  check(openRest.open && openRest.armed && openRest.submits === 0 && openRest.redraws === 0 && openRest.frames === 0, `armed with the drawer OPEN at rest (the counter read before the arm), 240 frames: ${openRest.submits} submits, ${openRest.redraws} redraws, ${openRest.frames} GPU frames — arming adds no submit and never wakes the drawer`);
  let run4 = await qa(`(async () => {
    const d = window.__desk; const s0 = d.tray.scroll();
    for (let i = 1; i <= 12; i++) { d.tray.scroll(s0 + i * 7); await new Promise((r) => requestAnimationFrame(r)); }
    await new Promise((r) => setTimeout(r, 250));
    return { frames: d.perf.take().gpu.frames.filter((f) => f.kind === "frame"), accessories: d.tray.state().laid?.accessories.length ?? 0 };
  })()`);
  const nAcc = run4.accessories;
  run4 = run4.frames;
  const last4 = run4.at(-1);
  const timed4 = run4.filter((f) => f.timing === "timed");
  const passes4 = [...new Set(timed4.flatMap((f) => f.passes.map((p) => p.label)))];
  check(nAcc === 6 && run4.length > 0 && run4.every((f) => f.byKind.tray?.draws === 2 && f.byKind.tray?.instances === 1 + nAcc) && timed4.length > 0 && timed4.every((f) => f.passes.some((p) => p.label === "ground") && !f.passes.some((p) => p.label.startsWith("tray"))), `the drawer is every frame's "tray" row (pipeline tray/pegboard): TWO draws — the board to its edge, ${nAcc} accessories — of ${1 + nAcc} instances in each of ${run4.length} scroll frames (${JSON.stringify(last4?.byKind.tray)}), inside the ground pass — the timed frames' passes: ${passes4.join(" · ")}`);
  // the wind is still (no pointer here), so the frame's light does not move: a scroll changes the drawer's own block alone
  const up4 = run4.map((f) => f.uploads.tray ?? { writes: 0, bytes: 0 });
  const mem4 = last4?.memory?.byLabel.tray;
  check(up4.every((u) => u.writes === 2 && u.bytes === up4[0].bytes) && mem4?.textures === 1 && mem4?.buffers === 3 && mem4.bytes > 0, `its uploads and memory are the "tray" rows: a scroll writes TWO blocks a frame — its own and its accessories' records, moving with the board (${up4.map((u) => u.writes).join(" ")} × ${up4[0]?.bytes} B) — its light block, unchanged, never; the ledger's tray row ${mem4?.bytes} B — ${mem4?.textures} texture (the hash) and ${mem4?.buffers} buffers (its block, its light, its accessories)`);
  await q("window.__gpuOff(); window.__desk.tray.close(); 0");
  await settle();

  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
