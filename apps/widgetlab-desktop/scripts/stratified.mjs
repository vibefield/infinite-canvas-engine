/**
 * The C2 exit (design-013 §8): the STRATIFIED profile's ground on the engine — `groundField`
 * on a device of its own under the real DOM board. It mounts and draws, submits nothing while
 * idle, keeps the cards for the DOM (a card's centre on the ground canvas is the ground, the
 * page over its title is not), draws the wires and the guides in their configured bytes and
 * gates them by the type, flies the ground's own second slot (the enter cut moves no pixel
 * inside the face nor outside it), and — D-C2.2 — a local-pointer gesture never re-bakes the
 * atlas while a remote pole's move does. Run: `pnpm --filter widgetlab-desktop stratified`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

/** Decode an 8-bit non-interlaced PNG (what Playwright writes) into { width, height, rgb(x, y) }. */
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
  return { width, height, rgb: (x, y) => { const i = y * stride + x * channels; return [out[i], out[i + 1], out[i + 2]]; } };
}

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const log = (m) => console.log(`[stratified] ${m}`);
const failures = [];
const check = (ok, what) => { log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures.push(what); };
const rgb = (c) => `(${c.join(",")})`;
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`); });
  await page.goto(`file://${path.join(appDir, "dist", "stratified.html")}`);
  await page.waitForFunction(() => window.__stratifiedRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__stratifiedRig.ready);

  // ---- 1. the mount
  const mounted = await page.evaluate(() => window.__stratifiedRig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.profile === "stratified", `the STRATIFIED profile mounted through <InfiniteCanvas> (${mounted.profile})`);
  check(mounted.canvases === 1, `one canvas in the L0 slot — the ground's own (${mounted.canvases})`);
  check(mounted.sourceCanvases === 0, `and NO L1 source canvas: the stratified mount has no HTML-in-Canvas (${mounted.sourceCanvases})`);
  check(mounted.available === true && mounted.ownDevice, `the layer acquired its OWN device and Ground.create resolved (${mounted.status})`);
  check(mounted.redraws >= 1, `the ground drew (${mounted.redraws} redraw${mounted.redraws === 1 ? "" : "s"})`);
  check(mounted.submits >= 1, `and submitted real work on that device (${mounted.submits} submits)`);
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors (${mounted.gpuErrors})`);

  // ---- 2. idle-zero, and a camera write is a frame
  const idle = await page.evaluate(() => window.__stratifiedRig.idle(3000));
  log(`idle 3 s: ${JSON.stringify(idle)}`);
  check(idle.submits === 0 && idle.redraws === 0, `idle-zero: ${idle.submits} submits, ${idle.redraws} redraws over ${idle.frames} frames`);
  const nudged = await page.evaluate(() => window.__stratifiedRig.nudge());
  log(`camera write: ${JSON.stringify(nudged)}`);
  check(nudged.redraws >= 1 && nudged.submits >= 1, `a camera write is a frame: +${nudged.redraws} redraw, +${nudged.submits} submit`);

  // ---- 3. the board: a DOM card is a DOM card
  const board = await page.evaluate(() => window.__stratifiedRig.board());
  log(`board: ${JSON.stringify(board)}`);
  check(board.note === undefined, board.note ?? "the board settled (7 cards, 1 portal)");
  check(board.cards === 7 && board.containers === 1 && board.portals === 1 && board.inside === 3, `the builder counts 7 cards, the folder's live portal with 3 inside (${board.cards}/${board.containers}/${board.portals}/${board.inside})`);
  check(board.drawnFrames === 0 && board.textured === 0, `the ground drew NO card frames (${board.drawnFrames} frames handed to the cards pass, ${board.textured} textured) — the DOM draws the cards`);
  check(board.sources === 7, `and every card is still a field SOURCE (${board.sources})`);
  check(near(board.pixels.gap, board.expect.bg, 4), `the gap between two cards is the ground: ${rgb(board.pixels.gap)} vs the theme's ground ${rgb(board.expect.bg)}`);
  check(near(board.pixels.card, board.expect.bg, 4) && !near(board.pixels.card, board.expect.card, 4), `a card's centre on the GROUND canvas is the ground too — no plate: ${rgb(board.pixels.card)} (the plate would be ${rgb(board.expect.card)})`);
  check(near(board.pixels.face, board.expect.bg, 4), `the folder's face on the ground is the inside's ground (its portal slot): ${rgb(board.pixels.face)}`);
  // the PAGE over the card's title: the DOM card is above the ground
  const titlePng = decodePng(await page.screenshot({ type: "png", clip: { x: board.title.sx, y: board.title.sy, width: board.title.w, height: board.title.h } }));
  let titleMax = 0;
  for (let y = 0; y < titlePng.height; y++) for (let x = 0; x < titlePng.width; x++) { const c = titlePng.rgb(x, y); titleMax = Math.max(titleMax, Math.abs(c[0] - board.expect.bg[0]) + Math.abs(c[1] - board.expect.bg[1]) + Math.abs(c[2] - board.expect.bg[2])); }
  check(titleMax > 60, `the page over the card's title is NOT the ground — the DOM card sits above it (up to ${titleMax}/765 from the ground)`);
  check(board.gpuErrors === 0, `no uncaptured GPU errors with cards on the board (${board.gpuErrors})`);
  const idleCards = await page.evaluate(() => window.__stratifiedRig.idle(2000));
  log(`idle 2 s with cards: ${JSON.stringify(idleCards)}`);
  check(idleCards.submits === 0 && idleCards.redraws === 0, `idle-zero holds with cards on the board: ${idleCards.submits} submits over ${idleCards.frames} frames`);

  // ---- 5. the flight is the ground's second slot, on the ground canvas only
  const vpSize = page.viewportSize() ?? { width: 1280, height: 808 };
  await page.mouse.move(vpSize.width - 6, vpSize.height - 6);
  await page.waitForTimeout(160);
  const nav = await page.evaluate(() => window.__stratifiedRig.nav());
  log(`nav: ${JSON.stringify(nav)}`);
  check(nav.cut.active && nav.cut.p === 0 && nav.cut.ticks === 1, `enter: the first frame after the cut is held at p = 0 (ticks ${nav.cut.ticks})`);
  check(nav.cut.maxDeltaInsideFace === 0, `the cut changes no pixel INSIDE the face: maxΔ ${nav.cut.maxDeltaInsideFace} (the arriving slot IS the portal's last frame)`);
  check(nav.cut.maxDelta === 0, `nor outside it: maxΔ ${nav.cut.maxDelta} over ${nav.size.w}×${nav.size.h} (the departed slot IS the pre-cut frame)`);
  check(nav.cut.outgoing !== null && nav.cut.outgoing.kind === "enter" && nav.cut.outgoing.frames === 0 && nav.cut.outgoing.at !== null, `the departed slot draws beside the arriving one with NO frames, one tree through the folder at index ${nav.cut.outgoing?.at}: ${JSON.stringify(nav.cut.outgoing)}`);
  check(nav.mid.p > 0 && nav.mid.outgoing, `mid-flight both slots draw (p ${nav.mid.p.toFixed(3)})`);
  check(nav.landed < 1e-9, `the flight lands EXACTLY on the arrival (|cam − c1| ${nav.landed})`);
  check(nav.insideGlyph === "line" && nav.wiresOnInside === false, `inside, the root slot is the whiteboard's declaration: glyph ${nav.insideGlyph}, wires ${nav.wiresOnInside}`);
  check(!nav.afterLanding.outgoing && nav.afterLanding.submits === 0, `at rest inside: one slot, idle-zero (${nav.afterLanding.submits} submits over ${nav.afterLanding.frames} frames)`);
  check(nav.exit.kind === "exit" && nav.exit.p === 0 && nav.exit.outgoing, "exit: the cut frame is held at p = 0 with the departed inside drawn over the parent");
  check(nav.exit.maxDelta === 0, `the exit cut changes no pixel: maxΔ ${nav.exit.maxDelta}`);
  check(nav.landed2 < 1e-9, `the exit lands EXACTLY on the saved camera (|cam − c1| ${nav.landed2})`);
  check(nav.roundTrip === 0, `the round trip returns the ground pixel for pixel: maxΔ ${nav.roundTrip}`);
  check(nav.rootGlyph === "dot", `back at the root the board's declaration is in force: glyph ${nav.rootGlyph}`);
  check(nav.gpuErrors === 0, `no uncaptured GPU errors through the flight (${nav.gpuErrors})`);

  // ---- 6. D-C2.2: the bake-count witness — the REAL pointer, one step per frame, over the board
  const STEPS = 60;
  await page.mouse.move(80, 700);
  await page.waitForTimeout(100);
  const c0 = await page.evaluate(() => window.__stratifiedRig.counters());
  for (let i = 1; i <= STEPS; i++) { await page.mouse.move(80 + i * 12, 700 - i * 6); await page.waitForTimeout(16); }
  const c1 = await page.evaluate(() => window.__stratifiedRig.counters());
  const gesture = { steps: STEPS, redraws: c1.redraws - c0.redraws, bakes: c1.bakes - c0.bakes, submits: c1.submits - c0.submits, pointerOn: c1.pointerOn, sources: c1.sources };
  log(`pointer gesture: ${JSON.stringify(gesture)}`);
  check(gesture.pointerOn && gesture.sources === 0, `the pointer rides the analytic term, not the source buffer (pointer ${gesture.pointerOn}, pole sources ${gesture.sources})`);
  check(gesture.redraws >= STEPS / 2 && gesture.bakes === 0, `a ${STEPS}-step pointer gesture: ${gesture.redraws} redraws, ${gesture.bakes} bakes — pointer motion never re-bakes the atlas`);
  const parked = await page.evaluate(() => window.__stratifiedRig.idle(1000));
  log(`parked pointer, 1 s: ${JSON.stringify(parked)}`);
  check(parked.submits === 0, `a parked pointer is not a wake: ${parked.submits} submits over ${parked.frames} frames (the derive's per-tick PointerWorld write is not subscribed)`);
  const rm = await page.evaluate(() => window.__stratifiedRig.remote());
  log(`remote pole: ${JSON.stringify(rm)}`);
  check(rm.sources === 1 && rm.bakes === rm.moves, `a remote cursor pole moved ${rm.moves} times: ${rm.bakes} bakes (one per move, as a source must)`);
  check(rm.gpuErrors === 0, `no uncaptured GPU errors through the gesture (${rm.gpuErrors})`);

  // ---- 4 (last: it spawns far right of the board). the overlays: a wire and a guide, in their configured bytes
  const ov = await page.evaluate(() => window.__stratifiedRig.overlays());
  log(`overlays: ${JSON.stringify(ov)}`);
  check(ov.wiresOn && ov.guidesOn, `the board type gates both overlays ON (wires ${ov.wiresOn}, guides ${ov.guidesOn})`);
  check(ov.wires > 0 && ov.guides > 0, `the wire and the spawned guide were collected (${ov.wires} + ${ov.guides} vertices)`);
  check(ov.guidePixelsBefore === 0, `control: before the guide, no ground pixel is the guide's byte (${ov.guidePixelsBefore})`);
  check(ov.guidePixels > 100 && near(ov.guidePixel, ov.guideExpect, 1), `the guide IS its configured colour over the ground — D-C2.6's chain: ${ov.guidePixels} px of ${rgb(ov.guideExpect)}, the line at mid-height ${rgb(ov.guidePixel)}`);
  check(ov.wirePixels > 100, `the wire's stroke core IS its configured colour over the ground: ${ov.wirePixels} px of ${rgb(ov.wireExpect)}`);
  check(ov.gpuErrors === 0, `no uncaptured GPU errors with the overlays (${ov.gpuErrors})`);

  // ---- 7. idle-zero at the end
  const idleEnd = await page.evaluate(() => window.__stratifiedRig.idle(1500));
  log(`idle 1.5 s at the end: ${JSON.stringify(idleEnd)}`);
  check(idleEnd.submits === 0, `idle-zero after everything: ${idleEnd.submits} submits over ${idleEnd.frames} frames`);

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "stratified.png"), await page.screenshot());
} finally {
  await app.close();
}
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
