// rig:portal — the MINI MATS' live insides through a real Chrome, FROM THE WORLD (D2b; the
// prototype's test/harness/portal.mjs, PORTAL.md, MINIMAT.md §3–§5): the live counts of the minimat
// scenes; THE CUT — the frame before an enter and the flight's first frame are the same PNG, the
// flight starting from the face's own camera (the seam's `navFace(...).cam` IS `flight().c0`); the
// landing shows the inside's own mini mat live; the exit lands on the saved camera with the live
// insides back — the same PNG as before the enter; a mini mat laid inside shows ITS inside; the
// gate 0 → 0.63 → 1; the zoom-through IN as the same PNG (the cut op the wheel asks for, the
// re-dressing held), then by a REAL wheel (the `zoomThrough` system, the `NavRedress` fact) and OUT
// by real wheels; live insides off and on; the quiet loop. Exit 0 = every check passed.
//
//   pnpm --filter ./packages/objects oracle && pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:portal
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { DESK, deskNotes, MINIMAT_SCENES } from "@ice/objects/oracle/scenes.mjs";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
const kick = watchdog(480_000, cleanup);   // no row in 480 s: a hang (K-H — a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.evaluate("window.__desk.bar(false)", { timeoutMs: 20000 });   // design-018 §5 (R2): its pixels are the renderer's alone — the tray's bar hidden
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  const settle = () => tab.evaluate("window.__desk.settle(6000)", { awaitPromise: true, timeoutMs: 20000 });
  const scene = async (s) => { const r = await tab.evaluate(`window.__desk.setScene(${JSON.stringify(s)})`, { awaitPromise: true, timeoutMs: 60000 }); await settle(); return r; };
  const png = async () => { await tab.send("Page.bringToFront"); await settle(); return (await tab.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })).data; };
  const land = async () => { let w = 0; while (w < 4000) { await sleep(50); w += 50; if (!(await q("window.__desk.flight()"))) return true; } return false; };
  const frame = () => q("(() => { const s = window.__desk.stats(); return { portals: s.frame ? s.frame.portals : -1, outgoing: s.frame ? s.frame.outgoing !== null : null, objects: s.objects, live: s.live }; })()");
  const wheel = (x, y, dy) => tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy });
  /** Zoom about the screen point (x, y) to `zoom` — the prototype's `zoomAt`. */
  const zoomAt = (x, y, zoom) => q(`(() => { const c = window.__desk.camera(); const wx = c.x + ${x} / c.zoom, wy = c.y + ${y} / c.zoom; window.__desk.setCamera({ x: wx - ${x} / ${zoom}, y: wy - ${y} / ${zoom}, zoom: ${zoom} }); })()`);
  const still = { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] };
  const live = { camX: 0, camY: 0, zoom: 1, theme: "light", mat: still, minimats: DESK, notes: deskNotes };

  // ---- 1. the live insides the Node oracle counted for each desk (the prototype's harness table)
  console.log("-- the minimat scenes: live insides --");
  const want = { "minimat-desk-z1": 2, "minimat-desk-night-z1": 2, "minimat-far-z0.35": 1, "minimat-near-z2.2": 2, "minimat-selected-held-z1": 2, "minimat-light-z1": 1, "minimat-farlod-z1": 0 };
  for (const sc of MINIMAT_SCENES.filter((s) => s.name in want)) {
    await scene(sc.scene);
    const f = await frame();
    check(f.portals === want[sc.name], `${sc.name.padEnd(26)} ${f.objects} objects · ${f.portals} live (want ${want[sc.name]})`);
  }

  // ---- 2. THE CUT: the frame before the flight IS the flight's first frame, and the flight starts from the face's own camera — the seam's
  console.log("-- the cut --");
  /** The live desk afresh — its entities are new each time, so is "Studio notes"' id. */
  const liveDesk = async () => (await scene(live)).minimats[0];
  let A = await liveDesk();
  const before = await png();
  const restFrame = await frame();
  const camFace = await q(`window.__desk.navFace(${A}).cam`);
  check(restFrame.portals === 2, `at rest two faces are past the gate and show their insides live: ${restFrame.portals} live`);
  await q(`window.__desk.enter(${A}); window.__desk.pinFlight(0)`);
  await settle();
  const f0 = await q("window.__desk.flight()");
  check(f0 && f0.kind === "enter" && same(f0.c0, camFace), `the flight starts from the face's own camera — the seam's word, the same numbers (zoom ${f0?.c0.zoom.toFixed(4)})`);
  const first = await png();
  check(first === before, `the flight's FIRST frame is the face's last frame — the same PNG, ${(first.length / 1024).toFixed(0)} KB (${first === before ? "identical" : `differs: ${before.length} vs ${first.length} bytes`})`);
  await q("window.__desk.pinFlight(null)");
  const landed = await land();
  await settle();
  const inFrame = await frame();
  check(landed && (await q("window.__desk.depth()")) === 1 && inFrame.portals === 1 && inFrame.outgoing === false, `landed inside (depth 1): its own mini mat shows ITS inside — ${inFrame.portals} live, no departed desk`);

  // ---- 3. the exit lands on the saved camera with the live insides back — the frame equals the one before the enter
  await q("window.__desk.exit()");
  await land();
  const after = await png();
  const cam = await q("window.__desk.camera()");
  const back = await frame();
  check(near(cam.x, 0) && near(cam.y, 0) && near(cam.zoom, 1) && back.portals === 2 && after === before, `exit lands on the saved camera (${cam.x}, ${cam.y} @ ${cam.zoom}) with ${back.portals} live — the frame equals the one before the enter (${after === before ? "identical PNG" : "PNG differs"})`);

  // ---- 4. a mini mat laid inside shows ITS inside
  await q(`window.__desk.enter(${A}, "none")`);
  await settle();
  const n0 = (await frame()).portals;
  await q("(() => { const c = window.__desk.camera(), v = window.__desk.viewport(); window.__desk.spawn('desk.minimat', { name: 'Laid inside' }, { x: c.x + v.w / (2 * c.zoom), y: c.y + v.h / (2 * c.zoom) }); })()");
  await settle();
  const n1 = (await frame()).portals;
  check(n1 === n0 + 1 && (await q("window.__desk.depth()")) === 1, `a mini mat laid inside shows ITS inside — ${n0} → ${n1} live`);
  await q('window.__desk.exit("none")');
  await settle();

  // ---- 5. the gate: presence 0 below 140 px, between the rungs across, 1 past 220 (MINIMAT.md §5)
  A = await liveDesk();
  const presenceAt = async (z) => { await zoomAt(380, 330, z); await settle(); return { f: await frame(), p: await q(`window.__desk.navFace(${A}).presence`) }; };
  const g0 = await presenceAt(0.2);
  const g1 = await presenceAt(0.45);
  const g2 = await presenceAt(1);
  const short = 480 - 2 * 32;   // "Studio notes": the face's short side, world units
  check(g0.f.portals === 0 && g0.p === 0 && g1.p > 0 && g1.p < 1 && g2.p === 1 && g2.f.portals === 2, `the gate: zoom 0.2 (face ${(short * 0.2).toFixed(0)} px) → ${g0.f.portals} live · zoom 0.45 (${(short * 0.45).toFixed(0)} px) → presence ${g1.p.toFixed(2)} · zoom 1 → ${g2.f.portals} live`);

  // ---- 6. the zoom-through IN (PORTAL.md §8): zoom until the face covers the view; the cut the wheel asks for is the same PNG
  console.log("-- the zoom-through --");
  A = await liveDesk();
  let covered = false;
  let zCover = 1;
  for (let i = 0; i < 40 && !covered; i++) { zCover *= 1.12; await zoomAt(380, 330, zCover); covered = await q(`window.__desk.navFace(${A}, 2).covers`); }
  await settle();
  await q("window.__desk.pinRedress(true)");
  const preThrough = await png();
  await q(`window.__desk.enter(${A}, "cut")`);
  await settle();
  const postThrough = await png();
  const d1 = await q("window.__desk.depth()");
  check(covered && d1 === 1 && !(await q("window.__desk.flight()")) && postThrough === preThrough, `the face covers the view at zoom ${zCover.toFixed(2)}; the cut enters (depth ${d1}, no flight, the camera now ${(await q("window.__desk.camera().zoom")).toFixed(2)}) and the frame is the SAME PNG (${postThrough === preThrough ? "identical" : "differs"})`);
  await q("window.__desk.pinRedress(false)");
  // ---- 7. and by a REAL wheel: back out onto the covering camera, one wheel in — the `zoomThrough` system cuts and states the re-dressing
  await q('window.__desk.exit("none")');
  await settle();
  check((await q("window.__desk.depth()")) === 0 && (await q(`window.__desk.navFace(${A}, 2).covers`)), "back out as a cut, the face still covering");
  const epoch0 = (await q("window.__desk.redress()"))?.epoch ?? 0;
  await wheel(600, 400, -60);
  await sleep(150);
  const rIn = await q("window.__desk.redress()");
  const arrival = await q(`(() => { const c = window.__desk.camera(); return window.__desk.flight() ? null : ${JSON.stringify(null)}; })()`);
  void arrival;
  check((await q("window.__desk.depth()")) === 1 && rIn && rIn.kind === "in" && rIn.epoch === epoch0 + 1 && rIn.frame === A, `a real wheel in cuts through (depth ${await q("window.__desk.depth()")}): NavRedress { kind: ${rIn?.kind}, from: ${rIn?.from?.toFixed(3)} — the arrival's zoom the face was dressed for, frame: the mini mat }`);
  await sleep(500);   // the desk re-dresses from the face's look to its own, and takes its own lamp
  await settle();
  // ---- 8. the zoom-through OUT: real wheels out until the face no longer covers by 6 px — a cut back, the live inside returns
  let left = false;
  for (let i = 0; i < 40 && !left; i++) { await wheel(600, 400, 60); await sleep(40); left = (await q("window.__desk.depth()")) === 0; }
  await settle();
  const rOut = await q("window.__desk.redress()");
  const outFrame = await frame();
  check(left && rOut && rOut.kind === "out" && rOut.frame === A && outFrame.portals >= 1, `zooming out past the face leaves as a cut (depth ${await q("window.__desk.depth()")}, NavRedress { kind: ${rOut?.kind}, from: ${rOut?.from?.toFixed(3)} }) with the live inside back (${outFrame.portals} live) at zoom ${(await q("window.__desk.camera().zoom")).toFixed(2)}`);

  // ---- 9. live insides off → the faces draw themselves; on → back
  A = await liveDesk();
  await q("window.__desk.portals(false)");
  await settle();
  const off = await frame();
  await q("window.__desk.portals(true)");
  await settle();
  const on = await frame();
  check(off.portals === 0 && off.objects === 6 && on.portals === 2, `live insides off → ${off.portals} (the faces draw themselves, ${off.objects} objects); on → ${on.portals}`);

  // ---- 10. quiet: a still desk of live insides renders nothing on its own
  const s = await settle();
  const c0 = await q("window.__desk.handle.redraws()");
  await sleep(500);
  const c1 = await q("window.__desk.handle.redraws()");
  check(s.settled && c1 - c0 <= 2, `a still desk of live insides renders nothing on its own (${c1 - c0} frames in 0.5 s)`);
  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
