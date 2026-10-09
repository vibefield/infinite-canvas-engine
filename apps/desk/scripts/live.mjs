// rig:live — THE LIVE FACE (ICE M24 LT1, design-019 §3, §10) in the desk the product runs, on `rig.html?live` (the rigs' harness lends
// a LIVE source over one OffscreenCanvas per face — the rig ticks it or holds it still — and registers a rig live kind: a lit sheet,
// never a public kind). The rows:
//   1. THE FACE: a live object's face is opened by its DURABLE key (the document's `store.keyOf`), frame 0 taken at the open and
//      shown (the face's pixels are the source's frame, the gobo off);
//   2. A QUIET SOURCE → ZERO RENDERS in 1.2 s (the idle row's discipline: no frame, no submit, no engine step but a registered time's,
//      the kind never ticked — nothing polls a face);
//   3. ONE ARRIVAL → EXACTLY ONE FRAME and NO RECORD REMADE — the builder's counters (`stats().totals.recorded`, `.restless`) and the
//      kind's record store (`records()["rig-live"].written`) stand still while the face's texture takes the frame (its revision +1)
//      and the pixels show it; three arrivals in one task are ONE frame (they coalesce); a PLAYING source draws a frame per arrival
//      it takes and remakes nothing;
//   4. THE SIGHT: `px` follows a zoom (and the minified face still shows its frame: its mips made into the frame's encoder); `seen`
//      false when culled and while ANOTHER object is held (behind the hand); `held` and `seen` when the live object itself is held;
//      seen inside a mini mat's portal, unseen when the face is too far for the inside;
//   5. THE LEDGER (`gpuLedger: true`): `rig/live <key>` lines under `rig`, their bytes the faces' own;
//   6. THE DEMAND reaches the source CHANGE-ONLY: no two in a row alike, one per change the sight saw, none per frame;
//   7. THE HAND'S INPUT (ICE M24 LT2, design-019 §5): the kind TOLD its held input, sending its face what lands on its `live` part in the
//      DISPLAYED frame's logical coordinates — a press, a move and a release, a double-click counted 1 then 2 that leaves the object in
//      hand (the edge's double-click still puts it down: the hand's rule); a plain wheel the face's and the hand never pans for it, ⌘
//      zooms the hand; the page's cursor over its link the container's; keys, committed text and an IME composition through the editor
//      its DOM half leases; Esc puts it down in one press — the terminal's (`open.escape: "kind"`) is its face's, and Done puts it
//      down; and the COST of a held face playing at 60 (the hand slot and its composites; the desk copy behind never remade);
//   8. THE RENDER HALF CONTAINED (ICE M24 LT3, design-019 §8): the boundary's price a frame (the held frame and the rest frame recorded
//      with the boundary off, on, on with the slot's GPU error scope, and on with each kind's own); and the FAULT DOOR
//      (`__deskRig.live.fault(kind, call)`), each call in a page of its own (a quarantine is for the page's life): a rig live kind that
//      throws in its pass's `prepare` MID-PASS (its own pass and a debug group left open), in its `drawRange` MID-RUN (a viewport and a
//      debug group of its own left in the desk's pass), in its `held` while in hand — three frames and it is MISSING, its object in the
//      missing face, the status naming the call, the layer never degraded (no frame refused at the submit), every other kind drawn, the
//      frame count rising, no frame lost (no contained reflector fault); the held one put down, its `up` told to no one;
//   9. no page errors, no contained faults.
// THE EXIT CODE IS THE VERDICT: the number of failed rows; 1 for a throw; 2 for the watchdog.
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:live
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, until, watchPage } from "./cdp.mjs";
import { decodePng } from "./png.mjs";
import { dblClick, hostLoad, median, minOf, watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
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

const LIVE = "rig.live";
const KIND = "rig-live";
/** The rig's terminal face (LT2): Esc in hand is its face's. */
const TERM = "rig.live-term";
/** The face's logical size and its edge (src/rig/live-source.ts `RIG_LIVE_LOGICAL`, live-kind.ts `RIG_LIVE_EDGE`); the sheet is 320 × 200. */
const LOGICAL = [256, 160];
const SHEET = [320, 200];
/** The rig source's frame colour (src/rig/live-source.ts `rigFrameColour`, sRGB). */
const frameColour = (n) => [(40 + n * 67) % 256, (90 + n * 131) % 256, (160 + n * 29) % 256];
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const fmtPx = (p) => (p === undefined ? "?" : `${p[0]}×${p[1]}`);

try {
  const logs = [];
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html?live`);
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  const front = () => tab.send("Page.bringToFront");
  const q = async (js, ms = 30000) => { await front(); return tab.evaluate(js, { awaitPromise: true, timeoutMs: ms }); };
  const settle = () => q("window.__desk.settle(6000)");
  const shot = async () => { await front(); const { data } = await tab.send("Page.captureScreenshot", { format: "png" }); return decodePng(Buffer.from(data, "base64")); };
  /** A screen point's rgb, CSS px. */
  const pixel = (img, x, y) => { const dpr = img.width / 1200; const i = (Math.round(y * dpr) * img.width + Math.round(x * dpr)) * 4; return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]; };
  // the wind still, the Sun, the gobo's dapple OFF (`opacity` 0 — the sheet then shows its face's own pixels), the tray's bar hidden
  await q("window.__desk.ambient('still'); window.__desk.setTheme('light'); window.__desk.pinMat({ opacity: 0 }); window.__desk.bar(false); window.__desk.setCamera({ x: 0, y: 0, zoom: 1 }); window.__desk.settle(6000)");
  /** The local, the source's faces and the handle's counters, read in ONE evaluate (one frame's state). */
  const state = (id) => q(`(() => {
    const d = window.__desk; const h = d.handle; const local = h.local(${JSON.stringify(KIND)}); const rl = window.__deskRig.live;
    return { key: d.engine.docs.current()?.store.keyOf(${id}), localKey: local.keyOf(${id}), seen: local.seen(${id}) ?? null, counts: local.counts(), faces: rl.faces(),
      redraws: h.redraws(), submits: d.submits().total, totals: h.stats().totals, written: h.records()[${JSON.stringify(KIND)}]?.written ?? -1,
      steps: d.engine.engine.frame.sleepStats().steps, timed: d.engine.engine.frame.sleepStats().timed, ticks: h.perf().kindTicks[${JSON.stringify(KIND)}] ?? 0 };
  })()`);
  const faceOf = (s, key) => s.faces.find((f) => f.key === key);

  // ---- 1. THE FACE, opened by its durable key, frame 0 taken at the open and shown
  const id = await q(`window.__desk.spawn(${JSON.stringify(LIVE)}, {}, { x: 400, y: 300 })`);
  await settle();
  const s1 = await state(id);
  const f1 = faceOf(s1, s1.key);
  const img1 = await shot();
  const c1 = pixel(img1, 400, 300);
  check(typeof s1.key === "string" && /^\d+-\d+$/.test(s1.key) && s1.localKey === s1.key && s1.faces.length === 1 && f1 !== undefined && f1.takes === 1 && f1.shown === 0 && f1.texture?.revision === 1 && s1.counts.opened === 1 && s1.counts.landed === 1 && near(c1, frameColour(0), 3),
    `the face is opened by the object's DURABLE key ("${s1.key}" — the document's store.keyOf; the kind's ${s1.localKey}), ${s1.faces.length} face, frame ${f1?.shown} taken at the open (${f1?.takes} take, texture revision ${f1?.texture?.revision}, ${f1?.texture?.width}×${f1?.texture?.height}); the face's centre shows it: ${c1.join(",")} (frame 0 is ${frameColour(0).join(",")})`);

  // ---- 2. A QUIET SOURCE → ZERO RENDERS in 1.2 s
  // (a registered time due within the window — a layer let go LAYER_IDLE_MS after it was last drawn — is waited out first)
  const soon = await q("(() => { const now = performance.now(); return window.__desk.handle.due(now).at - now; })()");
  if (soon < 1500) await sleep(Math.max(0, soon) + 150);
  const q0 = await state(id);
  await sleep(1200);
  const q1 = await state(id);
  const load2 = hostLoad();
  check(q1.redraws === q0.redraws && q1.submits === q0.submits && q1.steps - q0.steps === q1.timed - q0.timed && q1.ticks === q0.ticks && faceOf(q1, s1.key).asked === faceOf(q0, s1.key).asked,
    `a QUIET source → ${q1.redraws - q0.redraws} renders in 1.2 s (${q1.submits - q0.submits} submits, ${(q1.steps - q0.steps) - (q1.timed - q0.timed)} engine steps but a registered time's, the kind ticked ${q1.ticks - q0.ticks} times, its face asked ${faceOf(q1, s1.key).asked - faceOf(q0, s1.key).asked} takes) · load ${load2}`);

  // ---- 3. ONE ARRIVAL → EXACTLY ONE FRAME, NO RECORD REMADE (the builder's counters and the kind's record store stand)
  const a0 = await state(id);
  await q("window.__deskRig.live.tick()");
  await settle();
  const a1 = await state(id);
  const fa0 = faceOf(a0, s1.key);
  const fa1 = faceOf(a1, s1.key);
  const c3 = pixel(await shot(), 400, 300);
  check(a1.redraws - a0.redraws === 1 && a1.submits - a0.submits === 1 && a1.totals.recorded === a0.totals.recorded && a1.totals.restless === a0.totals.restless && a1.written === a0.written && fa1.texture.revision - fa0.texture.revision === 1 && fa1.shown === 1 && a1.counts.redraws - a0.counts.redraws === 1 && near(c3, frameColour(1), 3),
    `ONE ARRIVAL → ${a1.redraws - a0.redraws} frame drawn (${a1.submits - a0.submits} submit), NO record remade — the builder's records made ${a1.totals.recorded - a0.totals.recorded}, restless ${a1.totals.restless - a0.totals.restless}, the kind's store written ${a1.written - a0.written}; the face took it (texture revision ${fa0.texture.revision} → ${fa1.texture.revision}, frame ${fa1.shown}; the kind asked ${a1.counts.redraws - a0.counts.redraws} redraw) and shows it: ${c3.join(",")} (frame 1 is ${frameColour(1).join(",")})`);
  // …three arrivals in one task: ONE wake, one take, one frame
  const b0 = await state(id);
  await q("window.__deskRig.live.tick(); window.__deskRig.live.tick(); window.__deskRig.live.tick()");
  await settle();
  const b1 = await state(id);
  const fb0 = faceOf(b0, s1.key);
  const fb1 = faceOf(b1, s1.key);
  const c3b = pixel(await shot(), 400, 300);
  check(b1.redraws - b0.redraws === 1 && fb1.arrivals - fb0.arrivals === 3 && fb1.takes - fb0.takes === 1 && fb1.texture.revision - fb0.texture.revision === 1 && fb1.shown === 4 && b1.totals.recorded === b0.totals.recorded && near(c3b, frameColour(4), 3),
    `three arrivals in one task COALESCE: ${b1.redraws - b0.redraws} frame, ${fb1.arrivals - fb0.arrivals} arrivals → ${fb1.takes - fb0.takes} take (the newest, frame ${fb1.shown}: ${c3b.join(",")}), ${b1.totals.recorded - b0.totals.recorded} records remade`);
  // …and a PLAYING source: a frame per arrival it takes, nothing remade, quiet again once held
  const p0 = await state(id);
  await q("window.__deskRig.live.play(30)");
  await sleep(1000);
  await q("window.__deskRig.live.hold()");
  await settle();
  const p1 = await state(id);
  const fp0 = faceOf(p0, s1.key);
  const fp1 = faceOf(p1, s1.key);
  const takes = fp1.takes - fp0.takes;
  check(takes >= 5 && p1.redraws - p0.redraws === takes && p1.totals.recorded === p0.totals.recorded && p1.written === p0.written && fp1.arrivals - fp0.arrivals >= takes,
    `a PLAYING source (30 a second for 1 s): ${fp1.arrivals - fp0.arrivals} arrivals, ${takes} taken, ${p1.redraws - p0.redraws} frames drawn — one per frame taken — ${p1.totals.recorded - p0.totals.recorded} records remade, the store written ${p1.written - p0.written} · load ${hostLoad()}`);

  // ---- 4. THE SIGHT
  // a zoom: px follows it — at zoom 1 (dpr 2) the 320 × 200 face is 640 × 400 device px; at 0.5 about its centre, 320 × 200, and the
  // minified face still shows its frame (its level 1 made into the frame's encoder: an unmade level would darken it)
  const seen1 = (await state(id)).seen;
  await q("window.__desk.setCamera({ x: 400 - 600 / 0.5, y: 300 - 400 / 0.5, zoom: 0.5 })");
  await settle();
  const z = await state(id);
  const cz = pixel(await shot(), 600, 400);
  check(seen1?.seen === true && seen1.px[0] === 640 && seen1.px[1] === 400 && seen1.held === false && z.seen?.seen === true && z.seen.px[0] === 320 && z.seen.px[1] === 200 && near(cz, frameColour(fp1.shown), 4),
    `the sight's px FOLLOWS A ZOOM: ${fmtPx(seen1?.px)} at zoom 1 → ${fmtPx(z.seen?.px)} at 0.5 (seen ${z.seen?.seen}, held ${z.seen?.held}); minified, the face still shows frame ${fp1.shown}: ${cz.join(",")} (${frameColour(fp1.shown).join(",")})`);
  // culled: a pan far away — the frame that culls it says so, and the kind (due after it) steps its sight
  await q("window.__desk.setCamera({ x: 20000, y: 20000, zoom: 1 })");
  await settle();
  const cull = await state(id);
  check(cull.seen?.seen === false && cull.seen.px[0] === 0 && faceOf(cull, s1.key).demands.at(-1)?.mode === "paused",
    `CULLED (a pan far away): seen ${cull.seen?.seen}, px ${fmtPx(cull.seen?.px)} — and its source is told paused (${JSON.stringify(faceOf(cull, s1.key).demands.at(-1))})`);
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");
  await settle();
  // behind the hand: ANOTHER object held (a whiteboard) — the desk copy behind it is no frame the eye sees (design-019 §6)
  const note = await q("window.__desk.spawn('desk.board', {}, { x: 950, y: 250 })");
  await settle();
  const hist0 = (await q(`window.__desk.handle.local(${JSON.stringify(KIND)}).history(${id}).length`));
  await q(`window.__desk.open(${note})`);
  for (let i = 0; i < 100 && (await q("window.__desk.hand()?.settled === true")) !== true; i++) await sleep(40);
  await settle();
  const behind = await state(id);
  const behindHand = await q("window.__desk.hand()");
  // what the hold took the face through: ONE move, straight to unseen — never a frame of it "seen" in the desk copy (prepared once,
  // at the hold's first frame, at half the dpr), which the sight does not count
  const through = (await q(`window.__desk.handle.local(${JSON.stringify(KIND)}).history(${id})`)).slice(hist0);
  await q("window.__desk.putDown()");
  for (let i = 0; i < 100 && (await q("window.__desk.hand() === null")) !== true; i++) await sleep(40);
  await settle();
  const down = await state(id);
  check(behindHand?.entity === note && behind.seen?.seen === false && behind.seen.held === false && through.length === 1 && through[0].seen === false && faceOf(behind, s1.key).demands.at(-1)?.mode === "paused" && down.seen?.seen === true,
    `BEHIND THE HAND (a whiteboard held, ${behindHand?.entity === note ? "in hand" : "NOT in hand"}): seen ${behind.seen?.seen}, held ${behind.seen?.held} — the hold took the face through ${through.length} move${through.length === 1 ? "" : "s"} (${through.map((t) => (t.seen ? `seen ${fmtPx(t.px)}` : "unseen")).join(" → ")}; the desk copy behind the hand is no frame the eye sees), the source told ${faceOf(behind, s1.key).demands.at(-1)?.mode}; put down, seen ${down.seen?.seen}`);
  // held: the live object itself in hand — seen, held, drawn at its reading size; the source told interactive at 60
  await q(`window.__desk.open(${id})`);
  for (let i = 0; i < 100 && (await q("window.__desk.hand()?.settled === true")) !== true; i++) await sleep(40);
  await settle();
  const held = await state(id);
  const heldDemand = faceOf(held, s1.key).demands.at(-1);
  await q("window.__desk.putDown()");
  for (let i = 0; i < 100 && (await q("window.__desk.hand() === null")) !== true; i++) await sleep(40);
  await settle();
  const after = await state(id);
  check(held.seen?.seen === true && held.seen.held === true && held.seen.px[0] > 640 && heldDemand?.interactive === true && heldDemand.fps === 60 && after.seen?.held === false && after.seen.seen === true,
    `HELD (the live object in hand): seen ${held.seen?.seen}, held ${held.seen?.held}, px ${fmtPx(held.seen?.px)} (its reading size); the source told ${JSON.stringify(heldDemand)}; put down: held ${after.seen?.held}`);
  // inside a mini mat's portal: a live object laid INTO a mini mat is drawn only in its live inside (the face ≥ 220 px: presence 1),
  // and its sight says so; far away (the face under the gate) the inside is not drawn and it reads unseen
  const mm = await q("window.__desk.spawn('desk.minimat', { name: 'Inbox' }, { x: 2000, y: 300 })");
  await settle();
  const inner = await q(`window.__desk.engine.ops.spawnWidget(${JSON.stringify(LIVE)}, { x: 40, y: 40, parent: ${mm} })`);
  await q("window.__desk.setCamera({ x: 2000 - 600 / 0.75, y: 300 - 400 / 0.75, zoom: 0.75 })");
  await settle();
  await settle();
  const ins = await state(inner);
  const insFace = await q(`window.__desk.navFace(${mm})`);
  const insRank = await q(`window.__desk.handle.builder.rankOf(${inner}) ?? null`);
  const insShows = await q(`window.__desk.handle.builder.shows(${inner})`);
  await q("window.__desk.setCamera({ x: 2000 - 600 / 0.15, y: 300 - 400 / 0.15, zoom: 0.15 })");
  await settle();
  const far = await state(inner);
  const farFace = await q(`window.__desk.navFace(${mm})`);
  check(insFace?.presence === 1 && insShows === true && insRank === null && ins.seen?.seen === true && ins.seen.px[0] > 0 && typeof ins.localKey === "string" && farFace?.presence === 0 && far.seen?.seen === false,
    `INSIDE A MINI MAT's portal (presence ${insFace?.presence}): the inside's live object is drawn there alone (in the root slot: ${insRank === null ? "no" : `rank ${insRank}`}; drawn: ${insShows}) — seen ${ins.seen?.seen}, px ${fmtPx(ins.seen?.px)}, its face opened by "${ins.localKey}"; far (presence ${farFace?.presence}) — seen ${far.seen?.seen}`);

  // ---- 5. THE LEDGER: `rig/live <key>` lines under `rig`, their bytes the faces' own
  const led = await q(`(() => { const m = window.__desk.handle.gpuMemory(); const r = m?.read(); return { rig: r?.byLabel?.rig ?? null, top: (m?.top(64) ?? []).filter((t) => t.label.startsWith("rig/live ")), faces: window.__deskRig.live.faces().filter((f) => !f.closed && f.texture !== undefined).map((f) => ({ key: f.key, bytes: f.texture.bytes })) }; })()`);
  const faceBytes = led.faces.reduce((n, f) => n + f.bytes, 0);
  check(led.rig !== null && led.rig.bytes === faceBytes && led.rig.textures === led.faces.length && led.top.length === led.faces.length && led.faces.every((f) => led.top.some((t) => t.label === `rig/live ${f.key}` && t.bytes === f.bytes)),
    `THE LEDGER (gpuLedger): ${led.top.map((t) => `"${t.label}" ${(t.bytes / 1024).toFixed(0)} KiB`).join(", ")} — under "rig" ${led.rig?.bytes} B in ${led.rig?.textures} textures; the faces' own bytes ${faceBytes} B`);

  // ---- 6. THE DEMAND, CHANGE-ONLY: the first face's demands in order — none twice in a row, one per change of the rig's law (its
  //      raster a rung of the native size, held through a zoom's and the hand's flight px), none per frame and none per arrival
  const fin = await state(id);
  const dem = faceOf(fin, s1.key).demands;
  const twice = dem.filter((d, i) => i > 0 && JSON.stringify(d) === JSON.stringify(dem[i - 1])).length;
  const modes = dem.map((d) => (d.mode === "paused" ? "paused" : `${d.fps}${d.interactive ? "!" : ""} ${d.raster[0]}×${d.raster[1]}`));
  check(twice === 0 && dem.length >= 6 && dem.length <= 12 && fin.counts.moved > 2 * fin.counts.demands && dem[0]?.mode === "live" && dem.some((d) => d.mode === "paused") && dem.some((d) => d.interactive && d.fps === 60) && a1.counts.demands === a0.counts.demands && p1.counts.demands === p0.counts.demands,
    `THE DEMAND reaches the source CHANGE-ONLY: ${dem.length} demands to the first face (${twice} twice in a row) — ${modes.join(" → ")}; the kind's sight moved ${fin.counts.moved} times over the rig (both faces) and its law sent ${fin.counts.demands} demands; none sent by an arrival (${a1.counts.demands - a0.counts.demands}) or while it played (${p1.counts.demands - p0.counts.demands} over ${p1.redraws - p0.redraws} frames)`);

  // ---- 7. THE HAND'S INPUT (LT2): a fresh page and a terminal in view, the camera home (a block of its own: its names are its own)
  {
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");
  const pg = await q(`window.__desk.spawn(${JSON.stringify(LIVE)}, {}, { x: 600, y: 420 })`);
  const tm = await q(`window.__desk.spawn(${JSON.stringify(TERM)}, {}, { x: 600, y: 160 })`);
  await settle();
  /** A page's frame: a rAF or `n` (the desk takes an input a frame). */
  const frames = (n = 2) => q(`new Promise((r) => { let k = 0; const f = () => (++k >= ${n} ? r(k) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
  const mouse = async (type, x, y, extra = {}) => { await front(); await tab.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" || type === "mouseWheel" ? "none" : "left", ...extra }); await frames(2); };
  const key = async (k, code, vk, extra = {}) => { await front(); await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, ...extra }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, ...extra }); await frames(2); };
  const hand = () => q("window.__desk.hand()");
  const settledInHand = async (e) => (await until(async () => { const h = await hand(); return h?.entity === e && h.settled === true; }, 6000)) === true;
  const landed = async () => (await until(async () => (await hand()) === null, 6000)) === true;
  /** The source's record of `e`'s face: its inputs (since `from`), its page's cursor, its texture's logical size. */
  const src = async (e, from = 0) => q(`(() => { const k = window.__desk.engine.docs.current()?.store.keyOf(${e}); const f = window.__deskRig.live.faces().find((x) => x.key === k); return f === undefined ? null : { key: k, inputs: f.inputs.slice(${from}), n: f.inputs.length, cursor: f.cursor, logical: f.texture?.logical ?? null, takes: f.takes }; })()`);
  /** A screen point of the object in hand, in its own units (centred) — the hand's frame as the last frame drew it. */
  const at = (h, ox, oy) => [h.frame.cx + ox * h.frame.s, h.frame.cy + oy * h.frame.s];
  /** The page point the kind should send for a held point: the sheet's units to the frame's logical px. */
  const page = (ox, oy) => [((ox + SHEET[0] / 2) / SHEET[0]) * LOGICAL[0], ((oy + SHEET[1] / 2) / SHEET[1]) * LOGICAL[1]];
  const fmtIn = (i) => (i.kind === "pointer" ? `${i.phase} ${i.x.toFixed(1)},${i.y.toFixed(1)} b${i.button}/${i.buttons} ×${i.count}` : i.kind === "wheel" ? `wheel ${i.x.toFixed(1)},${i.y.toFixed(1)} ${i.dx},${i.dy}` : i.kind === "key" ? `key ${i.phase === "down" ? "↓" : "↑"}${i.key}${i.mods ? `+${i.mods}` : ""}` : i.kind === "text" ? `text "${i.text}"` : `compose "${i.text}" ${i.caret}`);
  const nearPt = (i, p) => Math.abs(i.x - p[0]) < 0.6 && Math.abs(i.y - p[1]) < 0.6;
  const cursor = () => q("document.querySelector('canvas')?.parentElement?.style.cursor ?? null");
  await q(`window.__desk.open(${pg})`);
  const inHand = await settledInHand(pg);
  const h0 = await hand();
  const lent = await q("document.activeElement?.hasAttribute('data-desk-editor') === true");
  const s0 = await src(pg);
  // 7a. a press, a move and a release on its `live` part, then a double-click there
  const [p0, p1, p2] = [[-60, -30], [-20, -30], [40, 20]];
  let from = s0.n;
  await mouse("mouseMoved", ...at(h0, ...p0));
  await mouse("mousePressed", ...at(h0, ...p0), { buttons: 1, clickCount: 1 });
  await mouse("mouseMoved", ...at(h0, ...p1), { buttons: 1 });
  await mouse("mouseReleased", ...at(h0, ...p1), { buttons: 0, clickCount: 1 });
  const s1 = await src(pg, from);
  const want1 = [["move", p0, 0, 0], ["down", p0, 1, 1], ["move", p1, 1, 0], ["up", p1, 0, 1]];
  const got1 = s1.inputs.filter((i) => i.kind === "pointer");
  check(inHand && lent && s0.logical?.[0] === LOGICAL[0] && s0.logical?.[1] === LOGICAL[1] && got1.length === want1.length && want1.every(([ph, pt, b, c], i) => got1[i]?.phase === ph && nearPt(got1[i], page(...pt)) && got1[i].buttons === b && got1[i].count === c),
    `IN HAND (settled ${inHand}, the editor lent to the face ${lent}; the face's frame ${s0.logical?.join(" × ")} logical over ${SHEET.join(" × ")} units): a press, a move, a release on the live part reach the face in the frame's LOGICAL px — ${got1.map(fmtIn).join(" · ")} (want ${want1.map(([ph, pt, b, c]) => `${ph} ${page(...pt).map((v) => v.toFixed(1)).join(",")} /${b} ×${c}`).join(" · ")})`);
  from = (await src(pg)).n;
  await dblClick(tab, ...at(h0, ...p2));
  await frames(4);
  const s2 = await src(pg, from);
  const presses = s2.inputs.filter((i) => i.kind === "pointer" && i.phase !== "move");
  const still = await hand();
  check(presses.map((i) => `${i.phase}${i.count}`).join(" ") === "down1 up1 down2 up2" && presses.every((i) => nearPt(i, page(...p2))) && still?.entity === pg && still.landing === false,
    `a DOUBLE-CLICK on the live part reaches the face counted — ${presses.map(fmtIn).join(" · ")} — and the object stays IN HAND (${still?.entity === pg ? "held" : "NOT held"}): two presses on the kind's part are the kind's, never the hand's way back`);
  // 7b. the edge — outside the part, the object itself: two instant taps there put it down, as ever, and the face hears nothing
  from = (await src(pg)).n;
  await dblClick(tab, ...at(h0, SHEET[0] / 2 - 5, 0));
  const edgeDown = await landed();
  const s3 = await src(pg, from);
  check(edgeDown && s3.inputs.filter((i) => i.kind === "pointer" && i.phase !== "move").length === 0,
    `a double-click on the face's EDGE (outside the live part — the object itself) does what it did: put down ${edgeDown}, the face sent ${s3.inputs.filter((i) => i.kind === "pointer" && i.phase !== "move").length} presses`);
  // 7c. the wheel: a plain wheel is the face's — the hand never pans for it, brought close or not; ⌘-wheel zooms the hand
  await q(`window.__desk.open(${pg})`);
  await settledInHand(pg);
  let hw = await hand();
  from = (await src(pg)).n;
  await mouse("mouseMoved", ...at(hw, ...p0));
  await mouse("mouseWheel", ...at(hw, ...p0), { deltaX: 0, deltaY: 40 });
  const view0 = await q(`window.__desk.heldView(${pg})`);
  await mouse("mouseWheel", hw.frame.cx, hw.frame.cy, { deltaX: 0, deltaY: -60, modifiers: 4 });
  await until(async () => (await q(`window.__desk.heldView(${pg})?.zoom ?? 1`)) > 1.2, 3000);
  const view1 = await q(`window.__desk.heldView(${pg})`);
  hw = await hand();
  await mouse("mouseMoved", ...at(hw, ...p0));
  await mouse("mouseWheel", ...at(hw, ...p0), { deltaX: 10, deltaY: 30 });
  const view2 = await q(`window.__desk.heldView(${pg})`);
  const wheels = (await src(pg, from)).inputs.filter((i) => i.kind === "wheel");
  // the deltas in CSS px of the hand, as the page's wheel events said them: CDP's are device px — 40, and 10,30, are 20 and 5,15 at the
  // rig's dpr 2 (probed: a bare page reads 10,30 at scale 1 and 5,15 at 2)
  check(wheels.length === 2 && nearPt(wheels[0], page(...p0)) && wheels[0].dx === 0 && wheels[0].dy === 20 && nearPt(wheels[1], page(...p0)) && wheels[1].dx === 5 && wheels[1].dy === 15 && view0?.panX === 0 && view0.panY === 0 && view1.zoom > 1.2 && view2.panX === view1.panX && view2.panY === view1.panY,
    `a plain WHEEL over the held face is the face's — ${wheels.map(fmtIn).join(" · ")} — and the hand never pans for it (the view ${JSON.stringify(view0)}; brought close by ⌘-wheel to ${view1.zoom.toFixed(2)}×, a plain wheel leaves its pan at ${view2.panX.toFixed(1)},${view2.panY.toFixed(1)}); ⌘ is the hand's: no wheel sent for it`);
  await mouse("mouseWheel", hw.frame.cx, hw.frame.cy, { deltaX: 0, deltaY: 60, modifiers: 4 });   // back to the reading size
  await until(async () => (await q(`window.__desk.heldView(${pg})?.zoom ?? 0`)) < 1.01, 3000);
  await settle();
  // 7d. the cursor: over the page's link its `pointer` (the kind's word, `open.cursor`), elsewhere on the face the desk's own
  hw = await hand();
  const overLink = [((60 / LOGICAL[0]) * SHEET[0]) - SHEET[0] / 2, ((120 / LOGICAL[1]) * SHEET[1]) - SHEET[1] / 2];
  await mouse("mouseMoved", ...at(hw, ...overLink));
  const onLink = await until(async () => (await cursor()) === "pointer", 2000);
  const linkWord = await cursor();
  await mouse("mouseMoved", ...at(hw, 90, -50));
  await until(async () => (await cursor()) !== "pointer", 2000);
  const offLink = await cursor();
  const pageCursor = (await src(pg)).cursor;
  check(onLink === true && linkWord === "pointer" && offLink !== "pointer" && pageCursor === null,
    `the CURSOR the kind names is the container's: over the page's link "${linkWord}", elsewhere on the face "${offLink}" (the page's word now ${JSON.stringify(pageCursor)})`);
  // 7e. keys, committed text and an IME composition — through the editor the face's DOM half leases
  from = (await src(pg)).n;
  await key("ArrowLeft", "ArrowLeft", 37);
  await key("ArrowRight", "ArrowRight", 39, { modifiers: 8 });
  await front();
  await tab.send("Input.insertText", { text: "hello" });
  await frames(2);
  await front();
  await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "x", code: "KeyX", text: "x", windowsVirtualKeyCode: 88 });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "x", code: "KeyX", windowsVirtualKeyCode: 88 });
  await frames(2);
  await tab.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
  await frames(1);
  await tab.send("Input.imeSetComposition", { text: "にほ", selectionStart: 1, selectionEnd: 1 });
  await frames(1);
  await tab.send("Input.insertText", { text: "日本" });
  await frames(2);
  const typed = (await src(pg, from)).inputs.filter((i) => i.kind !== "pointer" && i.kind !== "wheel").map(fmtIn);
  const wantTyped = ["key ↓ArrowLeft", "key ↑ArrowLeft", "key ↓ArrowRight+8", "key ↑ArrowRight+8", 'text "hello"', "key ↓x", 'text "x"', "key ↑x", 'compose "" 0', 'compose "に" 1', 'compose "にほ" 1', 'compose "日本" 2', 'text "日本"'];
  check(JSON.stringify(typed) === JSON.stringify(wantTyped),
    `KEYS, TEXT and an IME COMPOSITION reach the face through the leased editor: ${typed.join(" · ")}${JSON.stringify(typed) === JSON.stringify(wantTyped) ? "" : ` (want ${wantTyped.join(" · ")})`}`);
  // 7f. Esc: the page's is the desk's — one press puts it down (the lease declines it); the terminal's is its face's, and Done puts it down
  from = (await src(pg)).n;
  const doneTip = await q("document.querySelector('[data-ice-selection-menu] [data-act=\"done\"]')?.getAttribute('title') ?? null");
  await key("Escape", "Escape", 27);
  const escDown = await landed();
  const escSent = (await src(pg, from)).inputs.filter((i) => i.kind === "key").length;
  if (!escDown) { await q("window.__desk.putDown()"); await landed(); }   // (a red row still lets the next rows run)
  await q(`window.__desk.open(${tm})`);
  const termHeld = await settledInHand(tm);
  const termLent = await until(() => q("document.activeElement?.hasAttribute('data-desk-editor') === true"), 2000);
  const tFrom = (await src(tm)).n;
  await key("Escape", "Escape", 27);
  await frames(6);
  const termStill = (await hand())?.entity === tm;
  const termKeys = (await src(tm, tFrom)).inputs.filter((i) => i.kind === "key").map(fmtIn);
  // …and with its lease gone (a blur — the face's half lends it again next frame), an Esc on the bare page is still never the desk's
  await q("(() => { document.activeElement?.blur?.(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); })()");
  await frames(6);
  const bareStill = await hand();
  const termBare = bareStill?.entity === tm && bareStill.landing === false;
  const termTip = await q("document.querySelector('[data-ice-selection-menu] [data-act=\"done\"]')?.getAttribute('title') ?? null");
  await q("document.querySelector('[data-ice-selection-menu] [data-act=\"done\"]')?.click()");
  const doneDown = await landed();
  check(escDown && escSent === 0 && doneTip === "Done (Esc)" && termHeld && termLent === true && termStill && JSON.stringify(termKeys) === JSON.stringify(["key ↓Escape", "key ↑Escape"]) && termBare && termTip === "Done" && doneDown,
    `ESC puts the page down in ONE press (put down ${escDown}, the face sent ${escSent} keys; Done's tip "${doneTip}"); the TERMINAL's Esc is its face's (open.escape "kind": ${termKeys.join(" · ")}, still in hand ${termStill}; with its lease blurred away, an Esc on the bare page leaves it in hand ${termBare}; Done's tip "${termTip}") — and Done puts it down (${doneDown})`);
  // 7g. THE COST of a held face playing at 60: the hand slot and its composites — the desk copy behind stands (never remade), one frame
  //     a take; the hand's frame timed drained (holdCost's `hand`: the hand over the standing copy, drawn in full), the loop's main thread
  await q(`window.__desk.open(${pg})`);
  await settledInHand(pg);
  await settle();
  const costRead = "(() => { const h = window.__desk.handle; return { copies: window.__desk.holdCopies(), perf: h.perf(), redraws: h.redraws() }; })()";
  const c0 = await q(costRead);
  const k0 = (await src(pg)).takes;
  await q("window.__deskRig.live.play(60)");
  await sleep(2000);
  await q("window.__deskRig.live.hold()");
  await settle();
  const c1 = await q(costRead);
  const taken = (await src(pg)).takes - k0;
  const drawn = c1.redraws - c0.redraws;
  const mainMs = (c1.perf.frameMs - c0.perf.frameMs) / Math.max(1, c1.perf.frames - c0.perf.frames);
  const rounds = [];
  for (let i = 0; i < 5; i++) rounds.push(await tab.evaluate("window.__desk.holdCost(40)", { awaitPromise: true, timeoutMs: 60000 }));
  const handMs = minOf(rounds.map((r) => r.hand.ms));
  const standMs = minOf(rounds.map((r) => r.standing.ms));
  const load7 = hostLoad();
  check(c1.copies === c0.copies && taken >= 30 && drawn >= taken && drawn <= taken + 6 && handMs < 1000 / 60,
    `the COST of a held face PLAYING at 60 for 2 s: ${taken} frames taken, ${drawn} drawn (${(drawn / 2).toFixed(0)}/s), the desk copy behind remade ${c1.copies - c0.copies} times — each frame the hand slot and its composites alone: ${handMs.toFixed(2)} ms drawn in full on the GPU (drained; median ${median(rounds.map((r) => r.hand.ms)).toFixed(2)}), ${standMs.toFixed(2)} ms standing, ${mainMs.toFixed(2)} ms of the loop's main thread a frame · load ${load7}`);
  // 7h. THE BOUNDARY'S PRICE (LT3): the frame recorded 100 times back to back (the CPU of recording it — the GPU's share is the
  //     frame's, unchanged) in four arms, in turn and drained between — NONE (the ground's boundary taken off), CONTAINED (every kind's
  //     call in its try, the frame's encoder guarded, no GPU scope), SLOT (one GPU error scope over each slot's kinds: the product's),
  //     KIND (one over each kind's: what the desk keeps for a while after a slot's caught an error no one kind owns) — the minima of 11
  //     rounds, the held frame and then the rest; the scopes counted in one frame of SLOT and of KIND
  const price = async () => q(`(async () => {
    const h = window.__desk.handle; const g = h.ground(); const root = g.root; const b = root.boundary; const d = h.device(); const inp = h.lastInputs();
    const count = (mode) => { b.scopes = mode; let n = 0; const push = d.pushErrorScope.bind(d); d.pushErrorScope = (f) => { n++; return push(f); }; g.render(inp); d.pushErrorScope = push; return n; };
    const scopes = { slot: count("slot"), kind: count("kind") };
    const loop = (arm) => { root.boundary = arm === "none" ? undefined : b; b.scopes = arm === "none" || arm === "contained" ? "off" : arm; const t0 = performance.now(); for (let i = 0; i < 100; i++) g.render(inp); return ((performance.now() - t0) / 100) * 1000; };
    const arms = ["none", "contained", "slot", "kind"];
    const t = { none: [], contained: [], slot: [], kind: [] };
    for (let r = 0; r < 11; r++) for (let a = 0; a < 4; a++) { const arm = arms[(a + r) % 4]; t[arm].push(loop(arm)); await d.queue.onSubmittedWorkDone(); }
    root.boundary = b; b.scopes = "slot";
    return { scopes, none: Math.min(...t.none), contained: Math.min(...t.contained), slot: Math.min(...t.slot), kind: Math.min(...t.kind) };
  })()`);
  const heldPrice = await price();
  await q("window.__desk.putDown()");
  await landed();
  await settle();
  const restPrice = await price();
  const loadPrice = hostLoad();
  const priced = (p) => `${p.none.toFixed(1)} µs none; contained +${(p.contained - p.none).toFixed(1)}; the slot's scope${p.scopes.slot === 1 ? "" : "s"} (${p.scopes.slot}) +${(p.slot - p.contained).toFixed(1)}; each kind's (${p.scopes.kind}) +${(p.kind - p.contained).toFixed(1)}`;
  check(heldPrice.scopes.slot === 1 && restPrice.scopes.slot === 1 && restPrice.scopes.kind > 1 && heldPrice.slot - heldPrice.none < 25 && restPrice.slot - restPrice.none < 25,
    `the BOUNDARY's price a frame (the frame recorded 100 times, the minima of 11): the held frame — ${priced(heldPrice)}; the rest frame — ${priced(restPrice)} · load ${loadPrice}`);
  }

  // ---- 8. THE RENDER HALF CONTAINED (LT3): the fault door — each call in a page of its own, as a host's desk would meet it
  for (const call of ["prepare", "drawRange", "held"]) {
    const flogs = [];
    const ft = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html?live`);
    await ft.send("Runtime.enable"); await ft.send("Log.enable"); await ft.send("Page.enable");
    watchPage(ft, flogs);
    await ft.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
    const fq = async (js, ms = 30000) => { await ft.send("Page.bringToFront"); return ft.evaluate(js, { awaitPromise: true, timeoutMs: ms }); };
    for (let i = 0; i < 200; i++) { if (await fq("typeof window.__desk === 'object' && window.__desk.state.ready", 20000)) break; await sleep(200); }
    const fsettle = () => fq("window.__desk.settle(6000)");
    const fframes = (n = 2) => fq(`new Promise((r) => { let k = 0; const f = () => (++k >= ${n} ? r(k) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
    const fhand = () => fq("window.__desk.hand()");
    await fq("window.__desk.ambient('still'); window.__desk.setTheme('light'); window.__desk.pinMat({ opacity: 0 }); window.__desk.bar(false); window.__desk.setCamera({ x: 0, y: 0, zoom: 1 }); window.__desk.settle(6000)");
    const lv = await fq(`window.__desk.spawn(${JSON.stringify(LIVE)}, {}, { x: 400, y: 300 })`);
    const bd = await fq("window.__desk.spawn('desk.board', {}, { x: 900, y: 300 })");
    await fsettle();
    const look = () => fq(`(() => { const h = window.__desk.handle; const rec = (k) => h.lastInputs()?.objects?.find((o) => o.key === k)?.record ?? null;
      const f = window.__deskRig.live.faces()[0]; return { redraws: h.redraws(), status: h.status(), kinds: h.stats().frame?.kinds ?? {}, live: rec(${lv}), board: rec(${bd}) !== null, missing: rec(${lv})?.missing === true, inputs: f?.inputs.length ?? 0, faults: window.__desk.faults ?? [] }; })()`);
    if (call === "held") {
      await fq(`window.__desk.open(${lv})`);
      await until(async () => (await fhand())?.settled === true, 6000);
    }
    const before = await look();
    await fq(`window.__deskRig.live.fault(${JSON.stringify(KIND)}, ${JSON.stringify(call)})`);
    // three frames that ask the call: arrivals for the pass's (each a frame drawn again), the hand's input for `held` — a move, a press, a move
    const h0 = call === "held" ? await fhand() : null;
    const point = (dx) => (h0 === null ? [0, 0] : [h0.frame.cx + dx, h0.frame.cy]);
    for (let n = 0; n < 3; n++) {
      if (call === "held") {
        const [x, y] = point(n * 8);
        await ft.send("Input.dispatchMouseEvent", n === 1 ? { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 } : { type: "mouseMoved", x, y, button: "none", buttons: n === 2 ? 1 : 0 });
      } else await fq("window.__deskRig.live.tick()");
      await fframes(3);
    }
    if (call === "held") {
      const [x, y] = point(16);
      await ft.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
      await fframes(3);
    }
    const after = await look();
    // the frame count rises on: the camera nudged, a frame drawn — the missing face in the live object's place, the board drawn
    await fq("window.__desk.setCamera({ x: 2, y: 0, zoom: 1 })");
    await fsettle();
    const later = await look();
    // put down in the WORLD, not only undrawn (a missing kind's object in hand builds no hand to draw): the desk answers a pick again
    // — over the board — which it never does while anything is held
    const picked = call === "held" ? await fq("window.__desk.handle.pick({ x: 918, y: 320 })?.entity ?? null") : null;
    const putDown = call === "held" ? picked === bd && (await fhand()) === null : true;
    const reason = after.status.faults?.[0]?.reason ?? "";
    const unexpected = flogs.filter((l) => !l.includes(`"${KIND}"`));
    // (the state READY: the kind's `prepare` and `drawRange` throw with a pass, a debug group or a viewport of their own left open — WebGPU
    // would refuse the whole frame at the submit, the layer `degraded` for good, but the ground closed them)
    check(before.status.faults === undefined && after.status.state === "ready" && later.status.state === "ready" && after.status.faults?.length === 1 && after.status.faults[0].kind === KIND && reason.startsWith(`its \`${call}\` threw`) && reason.includes("(strike 3 of 3)")
      && later.missing && later.board && (later.kinds.board ?? 0) === 1 && later.redraws > after.redraws && after.redraws > before.redraws && after.faults.length === 0 && later.faults.length === 0
      && unexpected.length === 0 && flogs.filter((l) => l.includes("is MISSING")).length === 1
      && (call !== "held" || (putDown && after.inputs === before.inputs)),
      `THE FAULT DOOR — the "${KIND}" kind's \`${call}\` throws${call === "prepare" ? " mid-pass (its own pass and a debug group left open)" : call === "drawRange" ? " mid-run (a viewport and a debug group of its own left in the desk's pass)" : " in hand"}: MISSING after three frames (${JSON.stringify(after.status.faults?.[0] ?? null)}), said once, the layer ${later.status.state} (never degraded: no frame refused); its object in the missing face (${later.missing}), the board drawn (${later.kinds.board ?? 0}), the frames ${before.redraws} → ${after.redraws} → ${later.redraws} — none lost (contained reflector faults ${after.faults.length + later.faults.length}), no other page error (${unexpected.length})${call === "held" ? `; the hand put down (${putDown}: a pick over the board answers #${picked}), the face sent ${after.inputs - before.inputs} inputs after the door armed — its \`up\` told to no one` : ""}`);
    try { await fetch(`http://127.0.0.1:${chrome.port}/json/close/${ft.target.id}`); } catch {}
    ft.close();
  }

  // ---- 9. no page errors
  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors, no contained faults");
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
console.log(`\nrig:live — ${pass} passed · ${failN} failed · load ${hostLoad()}`);
process.exit(Math.min(failN, 250));
