// rig:nav — the FLIGHT into a mini mat through a real Chrome, FROM THE WORLD (D2b; the prototype's
// test/harness/nav.mjs, design-006, PORTAL.md §2.4): the nav oracle scenes as stills (the flight
// pinned at p, the departed desk drawn while its opacity is above 0 and skipped when not); a live
// flight — the desk cuts at once, the camera flies, held midway both desks draw, the landing is
// EXACT and the loop goes quiet; the exit lands back on the saved camera exactly; a wheel mid-flight
// yields (touch wins); a double-click on a mini mat flies in and on the bare mat flies out (the
// engine's gesture); and THE PRESS + DOUBLE-CLICK CUT — a mini mat HELD (its face reads 2 % larger, the
// still's `held`), hovered and selected, double-clicked: the flight starts from the face AS DRAWN
// (the seam) and its first frame is the face's last, the same PNG outside the selection's marks (D4a:
// the marks are the root slot's chrome and leave with the selection, which the enter clears). Exit 0 =
// every check passed.
//
//   pnpm --filter ./packages/desk oracle && pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:nav
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { NAV_SCENES } from "@ice/desk/oracle/scenes.mjs";
import { layoutMarks } from "../../../packages/desk/src/marks/layout.ts";
import { markDistance } from "../../../packages/desk/src/marks/mirror.ts";
import { flightOpacity } from "../../../packages/desk/src/nav/flight.ts";
import { launchChrome, openTab } from "./cdp.mjs";
import { decodePng } from "./png.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const free = await new Promise((r) => { const s = createServer(); s.once("error", () => r(false)); s.listen(port, "127.0.0.1", () => s.close(() => r(true))); });
    if (free) return port;
  }
  throw new Error(`no free CDP port in ${from}…${from + 39}`);
}
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: await freePort(9611), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 480_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/**
 * Two captures compared OUTSIDE a frame's marks (D4a): the device px within one of a mark's ink by the marks' CPU mirror are the
 * chrome's (the oracle's `marks` check); every other pixel is held to the same bytes.
 */
function outsideMarks(a, b, marks, dpr) {
  const A = decodePng(Buffer.from(a, "base64"));
  const B = decodePng(Buffer.from(b, "base64"));
  const band = new Uint8Array(A.width * A.height);
  for (const m of layoutMarks(marks)) {
    const [x0, y0, x1, y1] = m.quad;
    for (let Y = Math.max(0, Math.floor(y0 * dpr) - 1); Y <= Math.min(A.height - 1, Math.ceil(y1 * dpr) + 1); Y++) {
      for (let X = Math.max(0, Math.floor(x0 * dpr) - 1); X <= Math.min(A.width - 1, Math.ceil(x1 * dpr) + 1); X++) {
        if (markDistance(m, (X + 0.5) / dpr, (Y + 0.5) / dpr) <= 1 / dpr) band[Y * A.width + X] = 1;
      }
    }
  }
  let outside = 0;
  let outsideMax = 0;
  let inside = 0;
  let insideDiff = 0;
  for (let i = 0; i < band.length; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(A.rgba[o] - B.rgba[o]), Math.abs(A.rgba[o + 1] - B.rgba[o + 1]), Math.abs(A.rgba[o + 2] - B.rgba[o + 2]));
    if (band[i]) { inside++; if (d > 0) insideDiff++; } else { outside++; if (d > outsideMax) outsideMax = d; }
  }
  return { outside, outsideMax, inside, insideDiff };
}

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/index.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  tab.on("Log.entryAdded", (e) => { if (e.entry.level === "error") logs.push(`[${e.entry.level}] ${e.entry.text}`); });
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  const settle = () => tab.evaluate("window.__desk.settle(6000)", { awaitPromise: true, timeoutMs: 20000 });
  const scene = async (s) => { const r = await tab.evaluate(`window.__desk.setScene(${JSON.stringify(s)})`, { awaitPromise: true, timeoutMs: 60000 }); await settle(); return r; };
  const png = async () => { await tab.send("Page.bringToFront"); await settle(); return (await tab.send("Page.captureScreenshot", { format: "png" })).data; };
  const land = async () => { let w = 0; while (w < 4000) { await sleep(50); w += 50; if (!(await q("window.__desk.flight()"))) return true; } return false; };
  const frame = () => q("(() => { const s = window.__desk.stats(); return { portals: s.frame ? s.frame.portals : -1, outgoing: s.frame ? s.frame.outgoing !== null : null, objects: s.objects, active: s.active }; })()");
  const mouse = async (type, x, y, extra = {}) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  const dbl = async (x, y) => { for (const [type, clickCount] of [["mousePressed", 1], ["mouseReleased", 1], ["mousePressed", 2], ["mouseReleased", 2]]) { await tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount }); await sleep(16); } };
  const byName = Object.fromEntries(NAV_SCENES.map((s) => [s.name, s.scene]));
  const rest = { ...byName["nav-enter-p0"], nav: undefined };   // the desk of four mini mats at 1:1, no flight

  // ---- 1. the nav scenes as stills: the flight pinned at the scene's p; the departed desk drawn while its opacity is above 0
  console.log("-- the nav scenes as stills --");
  for (const sc of NAV_SCENES) {
    await scene(sc.scene);
    const fl = await q("window.__desk.flight()");
    const f = await frame();
    const outOn = fl ? flightOpacity(fl.kind, fl.p, fl.frozen).outgoing > 0 : false;
    check(fl && fl.p === sc.scene.nav.p && fl.kind === sc.scene.nav.kind && f.outgoing === outOn, `${sc.name.padEnd(24)} ${outOn ? "both desks drew" : "departed at opacity 0, skipped"} · ${fl?.kind} p ${fl?.p}${fl?.frozen ? " frozen" : ""} · ${f.active} objects, ${f.portals} live`);
  }

  // ---- 2. a live flight: enter a mini mat
  console.log("-- a live flight --");
  const { minimats: mats } = await scene(rest);
  const A = mats[0];
  const cam0 = await q("window.__desk.camera()");
  await q(`window.__desk.enter(${A})`);
  const f0 = await q("window.__desk.flight()");
  const z0 = (await q("window.__desk.camera()")).zoom;
  check(f0 && f0.kind === "enter" && (await q("window.__desk.depth()")) === 1, `enter: the desk cut at once (depth 1) and a flight is on — c0 zoom ${f0?.c0.zoom.toFixed(3)} → c1 zoom ${f0?.c1.zoom.toFixed(3)}`);
  await sleep(120);
  const z1 = (await q("window.__desk.camera()")).zoom;
  check(z1 > z0, `the camera is flying in (zoom ${z0.toFixed(3)} → ${z1.toFixed(3)} in 120 ms)`);
  await q("window.__desk.pinFlight(0.5)");
  await settle();
  const mid = await frame();
  check(mid.outgoing === true && mid.portals >= 1, `mid-flight (held at p 0.5) the departed desk draws beside the arriving one (${mid.portals} live)`);
  await q("window.__desk.pinFlight(null)");
  const t0 = Date.now();
  const landed = await land();
  const cam1 = await q("window.__desk.camera()");
  check(landed && near(cam1.zoom, f0.c1.zoom) && near(cam1.x, f0.c1.x) && near(cam1.y, f0.c1.y), `the flight landed EXACTLY on the arrival in ${Date.now() - t0} ms (zoom ${cam1.zoom.toFixed(3)})`);
  await settle();
  const inside = await frame();
  const members = await q("window.__desk.entities().filter((e) => e.active).map((e) => e.type)");
  check(inside.outgoing === false && members.filter((t) => t === "desk.note").length === 5 && members.filter((t) => t === "desk.minimat").length === 1, `at rest inside: one desk — its five notes and its own mini mat (${members.length} members)`);
  const c0 = await q("window.__desk.handle.redraws()");
  await sleep(500);
  const c1 = await q("window.__desk.handle.redraws()");
  check(c1 - c0 <= 2, `and the loop is quiet again (${c1 - c0} frames in 0.5 s)`);

  // ---- 3. the exit lands back where we came from
  await q("window.__desk.exit()");
  const e0 = await q("window.__desk.flight()");
  check(e0 && e0.kind === "exit" && (await q("window.__desk.depth()")) === 0, `exit: depth 0 at once, the inside flies back into its face (c0 zoom ${e0?.c0.zoom.toFixed(3)})`);
  await land();
  const cam2 = await q("window.__desk.camera()");
  check(near(cam2.x, cam0.x) && near(cam2.y, cam0.y) && near(cam2.zoom, cam0.zoom), `landed on the saved camera (${cam2.x.toFixed(2)}, ${cam2.y.toFixed(2)} @ ${cam2.zoom})`);

  // ---- 4. touch wins: a wheel mid-flight yields the camera
  await q(`window.__desk.enter(${A})`);
  await sleep(80);
  await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 400, deltaX: 0, deltaY: -40 });
  await sleep(100);
  check(!(await q("window.__desk.flight()")) && (await q("window.__desk.depth()")) === 1, "a wheel mid-flight aborts the flight and keeps the desk (touch wins)");
  await q("window.__desk.exit()");
  await land();

  // ---- 5. the gesture: a double-click on a mini mat flies in; a double-click on the bare mat flies out
  console.log("-- the gesture --");
  await scene(rest);
  await dbl(915, 175);   // "Errands", its face
  await sleep(60);
  const fIn = await q("window.__desk.flight()");
  check(fIn?.kind === "enter" && (await q("window.__desk.depth()")) === 1, "a double-click on a mini mat flies into it");
  await land();
  await dbl(40, 760);    // the bare mat, inside
  await sleep(60);
  const fOut = await q("window.__desk.flight()");
  check(fOut?.kind === "exit" && (await q("window.__desk.depth()")) === 0, "a double-click on the bare mat flies back out");
  await land();

  // ---- 6. THE PRESS + DOUBLE-CLICK CUT (design-015 §9, the seam): the mini mat HELD (its face 2 % larger — in ICE a press alone does not
  //         lift, `Grab` comes with the drag, so the still's `held` pin is the lifted face), hovered and selected; the flux frozen so the
  //         still is one frame; then a real double-click. The flight must start from the face AS DRAWN, and its first frame be the last.
  console.log("-- the press + double-click cut --");
  const { minimats: mats2 } = await scene(rest);
  const A2 = mats2[0];
  await q(`window.__desk.handle.pinFlux(${A2}, { lift: 1 })`);
  await mouse("mouseMoved", 380, 330);
  await sleep(700);   // the hover's rise settles
  await mouse("mousePressed", 380, 330); await sleep(30); await mouse("mouseReleased", 380, 330);
  await sleep(900);   // the selection ring settles, the tap's window closes
  await settle();
  const faceHeld = await q(`window.__desk.navFace(${A2})`);
  const faceStatic = { x: 380 - 320 + 32, y: 330 - 240 + 32, width: 640 - 64, height: 480 - 64 };
  check((await q(`window.__desk.entity(${A2})`)).selected && faceHeld.face.width > faceStatic.width && faceHeld.face.x < faceStatic.x, `held and selected: the face as drawn is ${faceHeld.face.width.toFixed(1)} wide, the static portal rect ${faceStatic.width} — the drawn one is the seam's word`);
  await q("window.__desk.freeze(true)");
  // D4a: the witness is the RENDERER's frame — the screen-space selection menu (DOM over the canvas) is hidden, as in rig:world — and
  // the selection's MARKS are chrome drawn from the root slot's selection, which the enter clears: they leave at the cut. The cut
  // frame is held to the pre-cut frame everywhere outside their band.
  await q("document.head.insertAdjacentHTML('beforeend', '<style id=rig-no-menu>[data-ice-selection-menu]{display:none!important}</style>')");
  const preMarks = await q("window.__desk.marks()");
  const beforeCut = await png();
  await dbl(380, 330);
  await sleep(40);
  const fc = await q("window.__desk.flight()");
  await q("window.__desk.pinFlight(0)");
  await settle();
  const firstCut = await png();
  const atCut = await q("({ marked: window.__desk.marks().objects.length, selected: window.__desk.selection().length })");
  check(fc && fc.kind === "enter" && same(fc.c0, faceHeld.cam), `the double-click's flight starts from the held face's own camera — the seam's numbers (zoom ${fc?.c0.zoom.toFixed(4)}); the static rect's would have been ${(faceHeld.cam.zoom * faceStatic.width / faceHeld.face.width).toFixed(4)}`);
  const cut = outsideMarks(beforeCut, firstCut, preMarks, 2);
  check(preMarks.objects.length === 1 && atCut.marked === 0 && atCut.selected === 0 && cut.outsideMax === 0 && cut.insideDiff > 0, `the cut frame IS the pre-cut frame outside the selection's marks — maxΔ ${cut.outsideMax} over ${cut.outside.toLocaleString()} px; the brackets left with the selection (the enter clears it: ${atCut.selected} selected, ${atCut.marked} marked; ${cut.insideDiff.toLocaleString()} of ${cut.inside.toLocaleString()} band px changed)`);
  await q("window.__desk.pinFlight(null); window.__desk.freeze(false); document.getElementById('rig-no-menu')?.remove()");
  await land();
  await q(`window.__desk.handle.pinFlux(${A2}, undefined)`);

  await settle();
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
