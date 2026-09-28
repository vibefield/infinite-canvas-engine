// rig:ruler — the RULERS on the desk through a real Chrome (RULER.md; the prototype's test/harness/ruler.mjs, its check rows,
// ported at D5a against `window.__desk`). The stills themselves are oracle scenes already (`ruler-*`, held to Dawn from the world
// by rig:world); these are the rows the harness asked of a LIVE frame: the atlas is up; every ruler still — and a zoom ladder
// through one decade — has ink in both bands over the field; a 7 px pan moves the ticks 14 device px; the label MIRROR agrees
// with the shader's UNIFORMS (the root mat's `rulerSites`/`rulerOrigin` as the frame uploaded them, against lattice/ruler.ts
// for the same view — and at zoom 1 it lays 11 labels 100 px apart along x); rulers off, no print.
// K1 (design-016 §3) FIRST, before any scene is staged: THE PRODUCT'S rulers — the desk as the product boots it (the grid App.tsx
// mounts, the panel applied at install, the app's RUNTIME atlas; setScene would upload the committed fixture and force the flag):
// printed with ink in both bands; `u` takes the print away and back byte for byte, kept in the browser; a saved "off" holds across a
// reload; not while typing; a selection's extent on the bands, the menu kept out from under the top band, the laser's tick where a
// guide stands; a 1× ratio re-renders the atlas (the host re-syncs the viewport); the panel's text size and density reach the print;
// and the mat pass's cost with the print and without (printed, not held — a loaded host's number). Exit 0 = every check passed.
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:ruler
import { spawn } from "node:child_process";
import { loadavg } from "node:os";
import { resolve } from "node:path";
import { RULER_SCENES } from "@ice/objects/oracle/scenes.mjs";
import { lod } from "../../../packages/desk/src/lattice/lod.ts";
import { finestLabelled, labelReach, labelsAlong, rulerLevels } from "../../../packages/desk/src/lattice/ruler.ts";
import { DEFAULT_MAT_CONFIG } from "../../../packages/desk/src/mat/layout.ts";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { watchdog } from "./timing.mjs";
import { decodePng } from "./png.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
const kick = watchdog(240_000, cleanup);   // no row in 240 s: a hang (K-H — a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };
const lumAt = (P, x, y) => { const o = (y * P.width + x) * 4; return 0.2126 * P.rgba[o] + 0.7152 * P.rgba[o + 1] + 0.0722 * P.rgba[o + 2]; };
/** The harness's `inkOf`: the brightest pixel in each band (CSS 28–50 in from the top and the left) against the field's mean (CSS 150–450 × 150–250). */
function inkOf(P, r = 2) {
  let top = 0;
  let left = 0;
  let mid = 0;
  let n = 0;
  for (let y = 28 * r; y < 50 * r; y++) for (let x = 55 * r; x < P.width - 30 * r; x++) top = Math.max(top, lumAt(P, x, y));
  for (let x = 28 * r; x < 50 * r; x++) for (let y = 55 * r; y < P.height - 30 * r; y++) left = Math.max(left, lumAt(P, x, y));
  for (let y = 150 * r; y < 250 * r; y += 7) for (let x = 150 * r; x < 450 * r; x += 7) { mid += lumAt(P, x, y); n++; }
  return { top, left, mid: mid / n };
}
/** The harness's pan witness: the brightest column of the top band's row 100 (device px), x 300–500. */
function brightestColumn(P) {
  let best = -1;
  let bx = 0;
  for (let x = 300; x < 500; x++) { const l = lumAt(P, x, 100); if (l > best) { best = l; bx = x; } }
  return bx;
}
/** A region of a frame in CSS px (`r` device px each): x0 ≤ x < x1, y0 ≤ y < y1. */
function crop(P, x0, y0, x1, y1, r = 2) {
  const w = Math.max(0, Math.round((x1 - x0) * r));
  const h = Math.max(0, Math.round((y1 - y0) * r));
  const ox = Math.round(x0 * r);
  const oy = Math.round(y0 * r);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(P.rgba.subarray(((oy + y) * P.width + ox) * 4, ((oy + y) * P.width + ox + w) * 4), y * w * 4);
  return { width: w, height: h, rgba };
}
/** The PRINT's pixels as the oracle draws the line (render.mjs `rulerCheck`): the frame's four lines one margin in, the bands, ±(2 + r) device px. */
function inPrint(x, y, W, H, r = 2, margin = 26, band = 26) {
  const m = margin * r;
  const inner = m + band * r;
  const right = W - m;
  const bottom = H - m;
  const near = (v, line) => Math.abs(v - line) <= 2 + r;
  const X = x + 0.5;
  const Y = y + 0.5;
  if ((near(X, m) || near(X, right)) && Y >= m - 3 && Y <= bottom + 3) return true;
  if ((near(Y, m) || near(Y, bottom)) && X >= m - 3 && X <= right + 3) return true;
  if (near(X, inner) && Y >= m - 3 && Y <= bottom + 3) return true;
  if (near(Y, inner) && X >= m - 3 && X <= right + 3) return true;
  if (Y >= m - 3 && Y <= inner + 3 && X >= m - 3 && X <= right + 3) return true;
  return X >= m - 3 && X <= inner + 3 && Y >= m - 3 && Y <= bottom + 3;
}
/** The largest channel difference between two frames of one size — over all of it, or only OUTSIDE the print (`inPrint`). */
function maxDelta(A, B, outside = false, r = 2) {
  if (A.width !== B.width || A.height !== B.height) return Number.POSITIVE_INFINITY;
  let m = 0;
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    if (outside && inPrint(x, y, A.width, A.height, r)) continue;
    const o = (y * A.width + x) * 4;
    for (let c = 0; c < 3; c++) { const d = Math.abs(A.rgba[o + c] - B.rgba[o + c]); if (d > m) m = d; }
  }
  return m;
}

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
  const scene = (s) => tab.evaluate(`window.__desk.setScene(${JSON.stringify(s)}).then(() => window.__desk.settle(6000))`, { awaitPromise: true, timeoutMs: 60000 });
  const shot = async () => decodePng(Buffer.from((await tab.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })).data, "base64"));
  /** What the root mat's last frame uploaded: the camera, the view, the rulers' on/margin/band, the origin row and the five levels' sites. */
  const uniforms = () => q(`(() => { const m = window.__desk.handle.ground().mat; const U = m.uniforms; const f = new Float32Array(U.bytes); const S = U.def.slots;
    const at = (k) => { const a = /^array<vec4f, (\\d+)>$/.exec(S[k].type); return Array.from(f.subarray(S[k].byte / 4, S[k].byte / 4 + (a ? Number(a[1]) * 4 : S[k].n))); };
    return { cam: at("cam"), view: at("view"), ruler: at("ruler"), origin: at("rulerOrigin"), sites: at("rulerSites"), glyphs: m.glyphs, loaded: m.loaded }; })()`);
  const base = RULER_SCENES[0].scene;   // the product's zoom: the still mat, the rulers on, nothing near the bands

  // ================================================================ THE PRODUCT'S RULERS (K1, design-016 §3)
  // The desk exactly as the product boots it — NO setScene (which uploads the committed fixture atlas and forces the flag per
  // scene): the grid App.tsx mounts, the panel's params applied at install, the app's RUNTIME atlas at the view's ratio. The mat's
  // clocks are PINNED (`pinMat`, the cost rig's still — nothing of the rulers) so two frames compare byte for byte, across a reload too.
  const hold = () => q("window.__desk.pinMat({ time: 3.7, goboTime: 57.14, noise: [0.37, 0.61], wind: 0 })");
  const settle = () => tab.evaluate("window.__desk.settle(6000)", { awaitPromise: true, timeoutMs: 60000 });
  const key = async (k, code, vk, text) => {
    await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text, unmodifiedText: text } : {}) });
    await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  };
  const pressU = async () => { await key("u", "KeyU", 85, "u"); await sleep(60); await settle(); };
  const mouse = (type, x, y) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  /** Where the print stands: the root mat's uniform, the panel's params and its row, the browser's saved desk (null = nothing kept). */
  const printState = async () => ({
    uniform: (await uniforms()).ruler[0],
    panel: await q("window.__desk.panel.params.ruler.on"),
    row: await q("[...document.querySelectorAll('#desk-panel .p-row')].find((r) => r.textContent === 'print the rulers (u)')?.querySelector('input')?.checked ?? null"),
    saved: await q("(() => { const s = localStorage.getItem('ice-desk-panel'); return s === null ? null : JSON.parse(s).ruler.on; })()"),
  });
  const menuState = () => q(`(() => { const m = document.querySelector("[data-ice-selection-menu]"); if (!m || m.dataset.visible !== "true") return null; const b = m.firstElementChild.getBoundingClientRect(); return { below: m.dataset.below === "true", y0: b.top, y1: b.bottom }; })()`);
  const reboot = async () => {
    await tab.send("Page.reload");
    for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) return true; await sleep(200); }
    return false;
  };

  // ---- the product prints: on in the uniforms, the panel's row ticked, nothing kept — from the app's RUNTIME atlas (the very meta the
  //      app's feed uploaded is the mat's), with ink in both bands over the field and over the same frame bare (`u`, below)
  await hold();
  await settle();
  const cam0 = await q("window.__desk.camera()");
  const theme0 = await q("window.__desk.theme()");   // the OS's, as the product boots (the print is lit: faint by night, RULER.md Q-b)
  const g0 = await q("window.__desk.glyphs()");
  const p0 = await uniforms();
  const s0 = await printState();
  const on0 = await shot();
  check(p0.ruler[0] === 1 && s0.panel === true && s0.row === true && s0.saved === null && g0?.key === "2:10" && g0.onMat === true && p0.glyphs.scale === 2 && p0.origin[2] >= 0,
    `the PRODUCT prints its rulers, no scene staged: on in the uniforms (margin ${p0.ruler[1]}, band ${p0.ruler[2]}, labels on level ${p0.origin[2]}), the panel's row ticked, nothing kept — from the app's RUNTIME atlas on the mat (${g0?.key}: ${g0?.meta.width}×${g0?.meta.height}, ${g0?.meta.count} glyphs, upload ${g0?.uploads}); camera (${cam0.x}, ${cam0.y}) @ ${cam0.zoom}, ${theme0}`);

  // ---- `u` (the demo's key): the print goes — the uniforms, the panel's row, the browser's saved desk all agree — and not a byte moves
  //      outside the bands; `u` again brings it back byte for byte, and nothing is kept (the product)
  await pressU();
  const off0 = await shot();
  const s1 = await printState();
  const ink0 = inkOf(on0);
  const bare0 = inkOf(off0);
  // the stills' bars (below): over the field by 25 by day, 6 under the Moon; over the same frame bare by 20 by day, 6 by night
  const [inkBar, bareBar] = theme0 === "dark" ? [6, 6] : [25, 20];
  check(ink0.top > ink0.mid + inkBar && ink0.left > ink0.mid + inkBar && ink0.top > bare0.top + bareBar && ink0.left > bare0.left + bareBar, `…its ink (${theme0}): the top band ${ink0.top.toFixed(0)}, the left ${ink0.left.toFixed(0)}, over the field (${ink0.mid.toFixed(0)}) and over the same frame bare (${bare0.top.toFixed(0)} · ${bare0.left.toFixed(0)})`);
  const outside0 = maxDelta(on0, off0, true);
  check(s1.uniform === 0 && s1.panel === false && s1.row === false && s1.saved === false && outside0 === 0 && maxDelta(on0, off0) > 0, `\`u\` takes the print away: the uniforms off, the panel's row unticked, kept in this browser (ruler.on ${s1.saved}) — nothing outside the print moved (maxΔ ${outside0})`);
  await pressU();
  const on1 = await shot();
  const s2 = await printState();
  check(s2.uniform === 1 && s2.panel === true && s2.row === true && s2.saved === null && maxDelta(on0, on1) === 0, `\`u\` again: the print back byte for byte (maxΔ ${maxDelta(on0, on1)}), the row ticked, nothing kept — the product`);

  // ---- a saved "off" takes effect on a FRESH boot: the panel applies itself at install (before, only a change or a restore projected)
  await pressU();
  const rebooted = await reboot();
  await hold();
  await settle();
  const s3 = await printState();
  check(rebooted && s3.uniform === 0 && s3.panel === false && s3.row === false && s3.saved === false, `a reload with "off" kept boots with the rulers off: uniforms ${s3.uniform}, the row ${s3.row}, kept ${s3.saved}`);
  await pressU();
  const s4 = await printState();
  check(s4.uniform === 1 && s4.panel === true && s4.saved === null, "…and `u` prints them again, keeping nothing");

  // ---- not while typing: a `u` into a note's editor is the note's; the rulers stay (the keymap's editable gate, as every letter key)
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");
  const n = await q("window.__desk.spawn('desk.note', { seed: 7 }, { x: 640, y: 420 })");
  await settle();
  const focused = await q(`window.__desk.note.focus(${n})`);
  await key("u", "KeyU", 85, "u");
  await sleep(150);
  const typed = (await q(`window.__desk.note.ink(${n})`))?.text ?? "";
  const s5 = await printState();
  check(focused && typed.endsWith("u") && s5.uniform === 1 && s5.panel === true && s5.saved === null, `not while typing: a \`u\` into a note's editor is the note's ("${typed}"); the rulers stay printed, nothing kept`);
  await key("Escape", "Escape", 27);
  await settle();

  // ---- the selection's extent on the rulers (ICE's — the desk-chrome prototype's `drawRulerBand`, marks/layout.ts): a pencil wash between
  //      the selection's edges in both bands, which a deselected frame has not; `u` off takes it with the print
  const band = (P, x0, x1, y0, y1) => { let s = 0; let c = 0; for (let y = y0 * 2; y < y1 * 2; y++) for (let x = x0 * 2; x < x1 * 2; x++) { const o = (y * P.width + x) * 4; s += P.rgba[o + 2] - P.rgba[o]; c++; } return s / c; };
  await q(`window.__desk.engine.ops.setSelection([${n}], 'replace')`);
  await settle(); await sleep(300); await settle();
  const e = await q(`window.__desk.entity(${n})`);
  const mk = await q("window.__desk.marks()");
  const sel = await shot();
  await q("window.__desk.engine.ops.clearSelection()");
  await settle(); await sleep(300); await settle();
  const none = await shot();
  const topSel = band(sel, e.x + 8, e.x + e.w - 8, 30, 50) - band(none, e.x + 8, e.x + e.w - 8, 30, 50);
  const leftSel = band(sel, 30, 50, e.y + 8, e.y + e.h - 8) - band(none, 30, 50, e.y + 8, e.y + e.h - 8);
  const beside = maxDelta(crop(sel, 60, 27, e.x - 60, 51), crop(none, 60, 27, e.x - 60, 51));
  // the extent is the selection's drawn frame (the sheet's, a few px about the note's rect)
  const about = (a, b) => Math.abs(a - b) <= 4;
  const W0 = mk?.ruler?.world;
  check(W0 !== undefined && mk.ruler.margin === 26 && mk.ruler.band === 26 && about(W0.x0, e.x) && about(W0.x1, e.x + e.w) && about(W0.y0, e.y) && about(W0.y1, e.y + e.h) && topSel > 8 && leftSel > 8 && beside === 0,
    `a selection's extent washes both bands in pencil between its edges (blue over red +${topSel.toFixed(1)} on top, +${leftSel.toFixed(1)} on the left, over the same band deselected; beside it maxΔ ${beside}) — the marks' extent ${W0 ? `${Math.round(W0.x0)}…${Math.round(W0.x1)} × ${Math.round(W0.y0)}…${Math.round(W0.y1)}` : "none"} for the note's ${e.x}…${e.x + e.w} × ${e.y}…${e.y + e.h}`);
  await q(`window.__desk.engine.ops.setSelection([${n}], 'replace')`);
  await pressU(); await sleep(300); await settle();
  const mkOff = await q("window.__desk.marks()");
  const selOff = await shot();
  await pressU(); await sleep(300); await settle();
  const topOff = band(selOff, e.x + 8, e.x + e.w - 8, 30, 50) - band(off0, e.x + 8, e.x + e.w - 8, 30, 50);
  check(mkOff?.ruler === null && Math.abs(topOff) < 2, `…and with the rulers off the extent goes with the print: the marks carry none, the band reads as bare (Δ ${topOff.toFixed(1)})`);

  // ---- the menu under the top band: a selection whose bar would sit on the band sends it below the selection (roomAbove is measured
  //      from under the band, selection-menu.tsx:119); with the rulers off the same selection keeps it above
  await q(`window.__desk.setCamera({ x: 0, y: ${e.y - 90}, zoom: 1 })`);
  await settle(); await sleep(400); await settle();
  const menuOn = await menuState();
  await pressU(); await sleep(400); await settle();
  const menuOff = await menuState();
  await pressU(); await sleep(400); await settle();
  const menuBack = await menuState();
  const top0 = 90;
  const bottom0 = 90 + e.h;
  check(menuOn?.below && menuOn.y0 >= bottom0 && menuOff !== null && !menuOff.below && menuOff.y1 <= top0 && menuOff.y0 < 52 && menuBack?.below === true,
    `the menu keeps out from under the band: a selection 90 px from the top puts it below (bar ${menuOn?.y0.toFixed(0)}–${menuOn?.y1.toFixed(0)}, the selection ${top0}–${bottom0}); rulers off, above it on the band's place (${menuOff?.y0.toFixed(0)}–${menuOff?.y1.toFixed(0)}); on again, below`);

  // ---- the laser ticks the band where a guide stands (marks/layout.ts): note B dragged to snap onto note A's top edge and HELD — at the
  //      guide's row the band changes by far more than the field does (the wall-to-wall line is in both; the band adds the tick); with the
  //      rulers off it changes no more than the field
  await q("window.__desk.engine.ops.clearSelection(); window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");
  const spawnB = async () => { const id = await q("window.__desk.spawn('desk.note', { seed: 11 }, { x: 1000, y: 560 })"); await settle(); await sleep(300); await settle(); return q(`window.__desk.entity(${id})`); };
  let B = await spawnB();
  const A = await q(`window.__desk.entity(${n})`);
  /** Drag B up until the snap holds it on A's top edge with the guide lit; the frame shot while held, the rows' change against `rest`. */
  const snapHeld = async () => {
    const reach = B.y - A.y;
    await mouse("mouseMoved", B.cx, B.cy); await mouse("mousePressed", B.cx, B.cy);
    for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", B.cx, B.cy - ((reach - 16) * i) / 8); await sleep(16); }
    let guide = null;
    for (let d = reach - 16; d <= reach + 30 && guide === null; d += 2) {
      await mouse("mouseMoved", B.cx, B.cy - d); await sleep(50);
      const mk2 = await q("window.__desk.marks()");
      const now = await q(`window.__desk.entity(${B.id})`);
      const g = (mk2?.guides ?? []).find((x) => x.axis === "y" && Math.abs(x.at - A.y) <= 0.51);
      if (g && Math.abs(now.y - A.y) < 1e-6) guide = g;
    }
    await sleep(800);   // the strike eases off
    const held = await shot();
    return { guide, held };
  };
  const release = async () => { await mouse("mouseReleased", B.cx, B.cy - (B.y - A.y)); await settle(); };
  const rowDelta = (P, Q, x0, x1, y) => maxDelta(crop(P, x0, y - 1, x1, y + 2), crop(Q, x0, y - 1, x1, y + 2));
  const lit = await snapHeld();
  await release(); await sleep(300); await settle();
  const restOn = await shot();
  const tickOn = lit.guide ? rowDelta(lit.held, restOn, 28, 51, Math.round(lit.guide.at)) : -1;
  const wallOn = lit.guide ? rowDelta(lit.held, restOn, 200, 240, Math.round(lit.guide.at)) : -1;
  await q(`window.__desk.engine.ops.setSelection([${B.id}], 'replace'); window.__desk.engine.ops.deleteSelection()`);
  await pressU();
  B = await spawnB();
  const unlit = await snapHeld();
  await release(); await sleep(300); await settle();
  const restOff = await shot();
  const tickOff = unlit.guide ? rowDelta(unlit.held, restOff, 28, 51, Math.round(unlit.guide.at)) : -1;
  const wallOff = unlit.guide ? rowDelta(unlit.held, restOff, 200, 240, Math.round(unlit.guide.at)) : -1;
  await pressU();
  check(lit.guide !== null && unlit.guide !== null && tickOn > wallOn + 40 && tickOff <= wallOff + 10,
    `the laser ticks the band where a guide stands: at the guide's row (y ${lit.guide?.at.toFixed(1)}) the band changes by ${tickOn} while held vs the field's ${wallOn} (the wall line alone); rulers off, the band ${tickOff} vs the field ${wallOff}`);
  await q("window.__desk.engine.ops.clearSelection()");

  // ---- the device's ratio: at 1× the viewport, the canvas and the runtime atlas all follow (the host re-syncs the viewport before the
  //      next step — no resize, no media query fires for an emulated ratio — and the app's tick re-renders the atlas), the bands inked at
  //      1× — the 1× atlas row the D5a port owed (docs/implementation-plan.md; the demo's test/harness/ruler.mjs:93-101); back at 2×, again
  const up0 = (await q("window.__desk.glyphs()")).uploads;
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  let g1 = null;
  for (let i = 0; i < 60; i++) { g1 = await q("window.__desk.glyphs()"); if (g1?.key === "1:10") break; await sleep(100); }
  await settle();
  const vp1 = await q("window.__desk.viewport()");
  const p1x = await uniforms();
  const ink1 = inkOf(await shot(), 1);
  const canvas1 = await q("[window.__desk.handle.canvas.width, window.__desk.handle.canvas.height]");
  check(g1?.key === "1:10" && g1.onMat === true && g1.uploads === up0 + 1 && vp1.dpr === 1 && canvas1[0] === 1200 && p1x.glyphs.scale === 1 && ink1.top > ink1.mid + inkBar && ink1.left > ink1.mid + inkBar,
    `a 1× ratio: the viewport ${vp1.dpr}, the canvas ${canvas1.join("×")}, the atlas re-rendered for it (${g1?.key}: ${g1?.meta.width}×${g1?.meta.height}, upload ${g1?.uploads}, on the mat) — the bands inked at 1× (${ink1.top.toFixed(0)} · ${ink1.left.toFixed(0)} over ${ink1.mid.toFixed(0)})`);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  let g2 = null;
  for (let i = 0; i < 60; i++) { g2 = await q("window.__desk.glyphs()"); if (g2?.key === "2:10") break; await sleep(100); }
  await settle();
  const vp2 = await q("window.__desk.viewport()");
  check(g2?.key === "2:10" && g2.onMat === true && g2.uploads === up0 + 2 && vp2.dpr === 2, `…and back at 2×: the viewport ${vp2.dpr}, the atlas ${g2?.key} again (upload ${g2?.uploads})`);

  // ---- the panel's rows reach the print (the demo's parity rows, K1): the text size re-renders the atlas at its em (the label strip
  //      changes, nothing outside the bands does); "labels from" moves the finest labelled level; "reset to product" puts it all back
  const row = (label) => `[...document.querySelectorAll('#desk-panel .p-row')].find((r) => r.querySelector('.p-label')?.textContent === ${JSON.stringify(label)})`;
  const slide = async (label, v) => { await q(`(() => { const s = ${row(label)}.querySelector('.p-slider'); s.value = '${v}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`); await settle(); };
  const before = await shot();
  const lvl0 = (await uniforms()).origin[2];
  await slide("text size", 14);
  const gT = await q("window.__desk.glyphs()");
  const after = await shot();
  await slide("labels from (pitch)", 120);
  const lvl1 = (await uniforms()).origin[2];
  await q(`[...document.querySelectorAll('#desk-panel .p-btn')].find((x) => x.textContent === 'reset to product').click()`);
  await settle();
  const gR = await q("window.__desk.glyphs()");
  check(gT?.key === "2:14" && gT.onMat === true && maxDelta(before, after, true) === 0 && maxDelta(before, after) > 0 && lvl1 > lvl0 && gR?.key === "2:10" && (await uniforms()).origin[2] === lvl0 && (await printState()).saved === null,
    `the panel's rows reach the print: text size 14 → the atlas ${gT?.key} (${gT?.meta.width}×${gT?.meta.height}) on the mat, the bands changed and nothing else; "labels from" 120 → labels on level ${lvl1} (was ${lvl0}); reset → ${gR?.key}, level ${lvl0}, nothing kept`);

  // ---- the mat pass's cost with the print and without (the demo's lesson — the per-band early return on `across`, RULER.md §7: 4.8 ms
  //      vs 1.0 when it was missing): the product's frame at rest (`holdCost(n).rest`, a saturated batch into the canvas's current texture,
  //      the queue drained before and after; a 4-frame probe sizes it to ~25 ms), the two alternating, the host's load beside it
  const ROUNDS = Number(process.env.DESK_RULER_COST_ROUNDS ?? 7);
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const setPrint = async (on) => { await q(`window.__desk.panel.tweak((p) => { p.ruler.on = ${on}; })`); await settle(); };
  const batch = async () => {
    const probe = await tab.evaluate("window.__desk.holdCost(4)", { awaitPromise: true, timeoutMs: 60000 });
    const n = Math.max(3, Math.min(300, Math.round(25 / Math.max(probe.rest.ms, 0.05))));
    return (await tab.evaluate(`window.__desk.holdCost(${n})`, { awaitPromise: true, timeoutMs: 60000 })).rest;
  };
  console.log(`\n  the mat pass's cost (the product's frame at rest, saturated batches, ${ROUNDS} rounds alternating; ms/frame median · min, CPU µs median)`);
  console.log("  scene                 load   off ms          on ms           ratio   off cpu  on cpu");
  for (const [label, zoom, notes] of [["the empty mat", 1, 0], ["the empty mat", 7, 0], ["24 notes", 1, 24]]) {
    await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");
    const ids = [];
    for (let i = 0; i < notes; i++) ids.push(await q(`window.__desk.spawn('desk.note', { seed: ${100 + i} }, { x: ${140 + (i % 6) * 180}, y: ${180 + Math.floor(i / 6) * 160} })`));
    await q(`window.__desk.setCamera({ x: 13.7, y: -21.3, zoom: ${zoom} })`);   // the demo's harness view (the camera's corner at (13.7, −21.3))
    await settle();
    const R = { off: [], on: [] };
    const C = { off: [], on: [] };
    const load = loadavg()[0];
    for (let round = 0; round < ROUNDS; round++) for (const arm of round % 2 ? ["on", "off"] : ["off", "on"]) {
      await setPrint(arm === "on");
      const r = await batch();
      R[arm].push(r.ms); C[arm].push(r.cpu);
    }
    const f = (a) => `${med(a).toFixed(3)} · ${Math.min(...a).toFixed(3)}`;
    console.log(`  ${`${label} z${zoom}`.padEnd(20)}  ${load.toFixed(1).padStart(5)}  ${f(R.off).padEnd(14)}  ${f(R.on).padEnd(14)}  ${(med(R.on) / med(R.off)).toFixed(2).padStart(5)}   ${(med(C.off) * 1000).toFixed(0).padStart(5)}   ${(med(C.on) * 1000).toFixed(0).padStart(5)}`);
    for (const id of ids) await q(`window.__desk.engine.ops.setSelection([${id}], 'replace'); window.__desk.engine.ops.deleteSelection()`);
  }
  await setPrint(true);
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");
  await settle();

  // ---- a staged scene's atlas is up: the committed FIXTURE (the oracle's — setScene uploads it over the app's runtime one) at the view's
  //      ratio, the rulers' twelve and more
  await scene(base);
  const u0 = await uniforms();
  const gs = await q("window.__desk.glyphs()");
  check(u0.loaded.glyphs && u0.glyphs.count >= 12 && u0.glyphs.scale === 2 && gs?.onMat === false, `a staged scene's atlas is up — the committed fixture, not the app's runtime one (on the mat: ${gs?.onMat}): ${u0.glyphs.count} glyphs at ${u0.glyphs.scale} texels per CSS px (${u0.glyphs.width}×${u0.glyphs.height})`);

  // ---- every ruler still has ink in both bands over the field (the print's contrast: the cream by day, the moonlit grey by night)
  // — and, the harness's rows made honest, over the SAME frame with the rulers off (the control): the bare mat's own lattice lines
  // clear the field bar at some zooms (at zoom 1 they read ~45 over it — D5a's red proof found it), so a band only counts as printed
  // where it also outshines itself bare: by 20 by day, by 6 under the Moon (measured: the print adds 45–66 by day, 14 by night)
  const INK = (s) => (s.theme === "dark" ? 6 : 25);
  const OVER_BARE = (s) => (s.theme === "dark" ? 6 : 20);
  const bareOf = (s) => { const { ruler: _r, ...rest } = s; return rest; };
  /** Ink in both bands: over the field, and over the same frame bare. */
  const printed = async (s) => {
    await scene(bareOf(s));
    const bare = inkOf(await shot());
    await scene(s);
    const ink = inkOf(await shot());
    const ok = ink.top > ink.mid + INK(s) && ink.left > ink.mid + INK(s) && ink.top > bare.top + OVER_BARE(s) && ink.left > bare.left + OVER_BARE(s);
    return { ok, ink, bare };
  };
  for (const sc of RULER_SCENES) {
    const { ok, ink, bare } = await printed(sc.scene);
    check(ok, `${sc.name.padEnd(18)} ink in the top band (${ink.top.toFixed(0)}) and the left (${ink.left.toFixed(0)}) over the field (${ink.mid.toFixed(0)}) and over the same frame bare (${bare.top.toFixed(0)} · ${bare.left.toFixed(0)})`);
  }

  // ---- the zoom ladder through one decade — the fine ticks arriving, the labels arriving, the wrap: ink, and a labelled level, at every rung
  for (const z of [1, 1.6, 2.5, 3.2, 4, 5, 6.3, 8, 9.9, 10.1, 12]) {
    const { ok: inked, ink, bare } = await printed({ ...base, zoom: z });
    const u = await uniforms();
    const lf = u.origin[2];
    check(inked && lf >= 0, `ladder z ${String(z).padEnd(5)} ink in the bands (${ink.top.toFixed(0)} over the field's ${ink.mid.toFixed(0)}, over ${bare.top.toFixed(0)} bare) · labels on level ${lf} at ${lf >= 0 ? (u.sites[lf * 4] * z).toFixed(0) : "—"} px (presence ${lf >= 0 ? u.sites[lf * 4 + 3].toFixed(2) : "—"}) · fine ticks ${u.sites[2].toFixed(2)}`);
  }

  // ---- a pan moves the ticks: the same scene 7 px along has its brightest top-band column 14 device px further
  // (the column must be the PRINT's: brighter than anything in that row of the same frame bare — the lattice's lines pan too)
  await scene(bareOf({ ...base, zoom: 1, camX: 0, camY: 0 }));
  const bareShot = await shot();
  const bareRow = lumAt(bareShot, brightestColumn(bareShot), 100);
  await scene({ ...base, zoom: 1, camX: 0, camY: 0 });
  const pa = await shot();
  const ca = brightestColumn(pa);
  await scene({ ...base, zoom: 1, camX: -7, camY: 0 });
  const cb = brightestColumn(await shot());
  check(Math.abs(cb - ca - 14) <= 1 && lumAt(pa, ca, 100) > bareRow + 20, `a 7 px pan moves the ticks 14 device px (±1: a tick centred on a pixel edge lights two columns alike): brightest column ${ca} → ${cb} — a tick of the print (${lumAt(pa, ca, 100).toFixed(0)} over the bare row's ${bareRow.toFixed(0)})`);

  // ---- the label mirror agrees with the shader's uniforms: lattice/ruler.ts for this frame's own view is what the frame uploaded
  await scene(base);
  const u = await uniforms();
  const view = { camX: u.cam[0], camY: u.cam[1], zoom: u.cam[2], width: u.view[0], height: u.view[1], dpr: u.cam[3] };
  const law = { ...DEFAULT_MAT_CONFIG.ruler, ...(base.ruler ?? {}), on: true };
  const levels = rulerLevels(lod(view), view.zoom, law, Math.max(labelReach(view.camX, view.zoom, view.width), labelReach(view.camY, view.zoom, view.height)));
  const f32 = Math.fround;
  const sitesOk = levels.every((L, i) => [L.spacing, L.tickLen, L.tickAlpha, L.labelAlpha].every((v, k) => f32(v) === u.sites[i * 4 + k]));
  const lf = finestLabelled(levels);
  check(u.ruler[0] === 1 && u.ruler[1] === law.margin && u.ruler[2] === law.band && sitesOk && lf === u.origin[2], `the mirror's five levels are the uniforms' own (spacing, tick, presences — f32 for f32), its finest labelled level ${lf} = the uniforms' ${u.origin[2]}; the rulers on at margin ${u.ruler[1]}, band ${u.ruler[2]}`);
  const labels = labelsAlong(view.camX, view.zoom, view.width, levels, law);
  check(labels.length === 11 && labels.every((l, i) => i === 0 || Math.abs(l.at - labels[i - 1].at - 100) < 1e-6), `at zoom 1 the mirror lays 11 labels 100 px apart along x: ${labels.map((l) => l.text).join(" ")}`);

  // ---- rulers off: the print goes
  const { ruler: _ruler, ...bare } = base;
  await scene(bare);
  const off = inkOf(await shot());
  const uOff = await uniforms();
  check(uOff.ruler[0] === 0 && off.top < off.mid + 60, `rulers off: the uniforms say so (${uOff.ruler[0]}) and there is no print in the band (${off.top.toFixed(0)} vs the field ${off.mid.toFixed(0)})`);

  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
