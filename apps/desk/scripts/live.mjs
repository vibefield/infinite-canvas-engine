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
//   7. no page errors, no contained faults.
// THE EXIT CODE IS THE VERDICT: the number of failed rows; 1 for a throw; 2 for the watchdog.
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:live
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { decodePng } from "./png.mjs";
import { hostLoad, watchdog } from "./timing.mjs";

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

  // ---- 7. no page errors
  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors, no contained faults");
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
console.log(`\nrig:live — ${pass} passed · ${failN} failed · load ${hostLoad()}`);
process.exit(Math.min(failN, 250));
