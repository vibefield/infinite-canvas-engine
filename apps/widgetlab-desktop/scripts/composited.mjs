/**
 * The B2 + B3a exit (design-013 §8): the new composited profile boots on the app-owned
 * device, submits nothing while idle, answers a camera write with one frame — and then
 * draws a board of real widgets from the world: the counts, the pixels off the ground
 * canvas (a card's plate, the ground in a gap, a folder's face as a HOLE over its inside),
 * idle-zero with cards on the board, the reveal on selection, the lift on Grab, the heat on
 * the drop pair. Run: `pnpm --filter widgetlab-desktop boot`.
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
/** The page's pixel at CSS point (sx, sy): a 4×4 CSS px clip decoded, its centre pixel. */
async function pagePixel(page, sx, sy) {
  const png = decodePng(await page.screenshot({ type: "png", clip: { x: sx - 2, y: sy - 2, width: 4, height: 4 } }));
  return png.rgb(Math.floor(png.width / 2), Math.floor(png.height / 2));
}

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const log = (m) => console.log(`[boot] ${m}`);
const failures = [];
const check = (ok, what) => { log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures.push(what); };
const rgb = (c) => `(${c.join(",")})`;
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`); });
  await page.goto(`file://${path.join(appDir, "dist", "composited.html")}`);
  await page.waitForFunction(() => window.__nextRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__nextRig.ready);

  // ---- B2: the boot
  const mounted = await page.evaluate(() => window.__nextRig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.profile === "composited", `the NEW profile mounted through <InfiniteCanvas> (${mounted.profile})`);
  check(mounted.canvases === 1, `one canvas in the L0 slot — the ground's own (${mounted.canvases})`);
  // B4: the mount also carries the L1 source canvas (`layoutsubtree`, unpainted).
  check(mounted.sourceCanvases === 1, `and one L1 source canvas beside it (${mounted.sourceCanvases})`);
  check(mounted.available === true, "Ground.create resolved on the app-owned device");
  check(mounted.redraws >= 1, `the ground drew (${mounted.redraws} redraw${mounted.redraws === 1 ? "" : "s"})`);
  check(mounted.submits >= 1, `and submitted real work (${mounted.submits} submits)`);
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors (${mounted.gpuErrors})`);

  const idle = await page.evaluate(() => window.__nextRig.idle(3000));
  log(`idle 3 s: ${JSON.stringify(idle)}`);
  check(idle.submits === 0 && idle.redraws === 0, `idle-zero: ${idle.submits} submits, ${idle.redraws} redraws over ${idle.frames} frames`);

  const nudged = await page.evaluate(() => window.__nextRig.nudge());
  log(`camera write: ${JSON.stringify(nudged)}`);
  check(nudged.redraws >= 1 && nudged.submits >= 1, `a camera write is a frame: +${nudged.redraws} redraw, +${nudged.submits} submit`);

  // ---- B3a: the board
  const board = await page.evaluate(() => window.__nextRig.board());
  log(`board: ${JSON.stringify(board)}`);
  check(board.note === undefined, board.note ?? "the board settled (7 cards, 1 portal)");
  check(board.cards === 7 && board.containers === 1, `7 cards drawn, 1 of them the folder (${board.cards} cards, ${board.containers} containers)`);
  check(board.portals === 1 && board.inside === 3, `the folder's face carries a live portal with its 3 cards inside (${board.portals} portal, ${board.inside} inside)`);
  check(board.capped === 0, `nothing past the record cap (${board.capped})`);
  check(board.gpuErrors === 0, `no uncaptured GPU errors with cards on the board (${board.gpuErrors})`);
  check(near(board.pixels.card, board.expect.card, 4), `a card's centre is the plate: ${rgb(board.pixels.card)} vs --vf-card ${rgb(board.expect.card)}`);
  check(near(board.pixels.gap, board.expect.bg, 4), `the gap between two cards is the ground: ${rgb(board.pixels.gap)} vs --vf-canvas-bg ${rgb(board.expect.bg)}`);
  check(near(board.pixels.face, board.expect.bg, 4), `the folder's face shows its inside's ground — a hole, not a plate: ${rgb(board.pixels.face)}`);
  check(near(board.pixels.bar, board.expect.card, 4), `the folder's bar is the plate: ${rgb(board.pixels.bar)}`);

  const idleCards = await page.evaluate(() => window.__nextRig.idle(2000));
  log(`idle 2 s with cards: ${JSON.stringify(idleCards)}`);
  check(idleCards.submits === 0 && idleCards.redraws === 0, `idle-zero holds with cards on the board: ${idleCards.submits} submits, ${idleCards.redraws} redraws over ${idleCards.frames} frames`);

  // ---- the springs
  const sel = await page.evaluate(() => window.__nextRig.select(0));
  log(`select: ${JSON.stringify(sel)}`);
  check(sel.reveal === 1 && sel.ring === 1 && sel.live === false, `selection reveals: reveal ${sel.reveal}, ring ${sel.ring}, settled ${!sel.live}`);
  const idleSel = await page.evaluate(() => window.__nextRig.idle(1500));
  log(`idle 1.5 s after the reveal: ${JSON.stringify(idleSel)}`);
  check(idleSel.submits === 0, `idle-zero after the spring settles: ${idleSel.submits} submits over ${idleSel.frames} frames (woken by ${JSON.stringify(idleSel.wakes)})`);

  // ---- B3b: the DOM boundary — chrome exists once, the controls are the ground's, the band is a handle
  const b = await page.evaluate(() => window.__nextRig.boundary(0));
  log(`boundary: ${JSON.stringify(b)}`);
  check(b.domWrites.clips >= 7 && b.clip.startsWith("polygon("), `DomCompose wrote every card's clip from the program's inner shape (${b.domWrites.clips} clips, ${b.domWrites.writes} writes; card 0: ${b.clip.slice(0, 40)}…)`);
  // Chrome ONCE: the page with the DOM hosts hidden must equal the page with them shown at the ring band and in
  // the shadow skirt (the shell paints nothing there), and differ over the title (the content IS the DOM's).
  // Two page screenshots, one colour space — a canvas readback is in the swap chain's sRGB bytes while the
  // capture is display-managed, so those two cannot be compared byte for byte off a saturated ring.
  const bandShown = await pagePixel(page, b.band.sx, b.band.sy);
  const shadowShown = await pagePixel(page, b.shadow.sx, b.shadow.sy);
  const faceShown = await pagePixel(page, b.face.sx, b.face.sy);
  const hideHosts = (hidden) => page.evaluate((h) => { for (const el of document.querySelectorAll("[data-ice-entity]")) el.style.visibility = h ? "hidden" : ""; }, hidden);
  await hideHosts(true);
  await page.waitForTimeout(50);
  const bandHidden = await pagePixel(page, b.band.sx, b.band.sy);
  const shadowHidden = await pagePixel(page, b.shadow.sx, b.shadow.sy);
  const faceHidden = await pagePixel(page, b.face.sx, b.face.sy);
  const titleHiddenPng = decodePng(await page.screenshot({ type: "png", clip: { x: b.title.sx, y: b.title.sy, width: b.title.w, height: b.title.h } }));
  await hideHosts(false);
  await page.waitForTimeout(50);
  check(near(bandShown, bandHidden, 2), `chrome once — the ring band reads the same with the DOM hosts shown and hidden: ${rgb(bandShown)} vs ${rgb(bandHidden)} (the ground's own, ${rgb(b.canvas.band)} in swap-chain bytes)`);
  check(near(faceShown, faceHidden, 2), `the folder's face is the ground's live portal, uncovered by its DOM host: ${rgb(faceShown)} vs hosts hidden ${rgb(faceHidden)}`);
  check(near(shadowShown, shadowHidden, 2), `chrome once — the shadow skirt reads the same with the DOM hosts shown and hidden (no CSS box-shadow): ${rgb(shadowShown)} vs ${rgb(shadowHidden)}`);
  const titlePng = decodePng(await page.screenshot({ type: "png", clip: { x: b.title.sx, y: b.title.sy, width: b.title.w, height: b.title.h } }));
  let titleMax = 0;
  for (let y = 0; y < titlePng.height; y++) for (let x = 0; x < titlePng.width; x++) { const c = titlePng.rgb(x, y); const h = titleHiddenPng.rgb(x, y); titleMax = Math.max(titleMax, Math.abs(c[0] - h[0]) + Math.abs(c[1] - h[1]) + Math.abs(c[2] - h[2])); }
  check(titleMax > 60, `the DOM content IS above the plate: the title area differs with the hosts hidden by up to ${titleMax}/765`);
  const before = await page.evaluate(() => window.__nextRig.cardState(0));
  await page.mouse.click(b.close.sx, b.close.sy);
  const afterClick = await page.evaluate(() => window.__nextRig.cardState(0));
  log(`close click: ${JSON.stringify({ before: { selected: before.selected, taps: before.taps.length }, after: { selected: afterClick.selected, grabbed: afterClick.grabbed, taps: afterClick.taps } })}`);
  check(afterClick.taps.length === before.taps.length + 1 && afterClick.taps.at(-1)?.part === "close", `a click on the ground-drawn close button reaches the app as onPart("close") (${JSON.stringify(afterClick.taps.at(-1))})`);
  check(afterClick.selected === before.selected && afterClick.grabbed === false, `and it neither grabs nor changes the selection (selected ${afterClick.selected}, grabbed ${afterClick.grabbed})`);
  // a frame between moves, so the drag recognizer sees a gesture rather than one coalesced sample
  // LEFT, away from every neighbour: a release over a solid card is a rejected drop and flies back
  await page.mouse.move(b.band.sx - 20, b.band.sy + 3);
  await page.mouse.down();
  await page.waitForTimeout(40);
  for (let k = 1; k <= 6; k++) { await page.mouse.move(b.band.sx - 20 - k * 7, b.band.sy + 3); await page.waitForTimeout(40); }
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => window.__nextRig.cardState(0));
  log(`band drag: x ${before.x} → ${afterDrag.x}`);
  check(afterDrag.x <= before.x - 20, `a drag begun on the frame band (outside the content rect) moves the card: x ${before.x} → ${afterDrag.x}`);

  const grab = await page.evaluate(() => window.__nextRig.grab(1));
  log(`grab: ${JSON.stringify(grab)}`);
  check(grab.lift === 1 && Math.abs(grab.scale - 1.05) < 1e-6, `Grab lifts: lift ${grab.lift}, scale ${grab.scale.toFixed(4)} (ChromeSettings.liftScale 1.05)`);
  check(grab.liftAfter === 0 && grab.scaleAfter === 1, `losing Grab sets it down: lift ${grab.liftAfter}, scale ${grab.scaleAfter}`);

  const heat = await page.evaluate(() => window.__nextRig.heat(2, 1));
  log(`heat: ${JSON.stringify(heat)}`);
  check(heat.hot === 1 && heat.tier === 1, `the drop pair lights the target at the accept tier: presence ${heat.hot}, tier ${heat.tier}`);
  check(luma(heat.lit) > luma(heat.cold) + 1, `the plate under the light reads brighter: lit ${rgb(heat.lit)} vs cold ${rgb(heat.cold)}`);
  check(heat.hotAfter === 0, `clearing the pair fades the light out (presence ${heat.hotAfter})`);

  // B7 — the flight: the second slot from the live portal's exact camera. The pointer leaves the board first: the
  // departed frame is a STILL at rest (no hover, no selection — the lab's rule), so a parked pointer's hover would differ.
  // far from every card's widened pick (card 0 sits at x 12 after the band drag; the pick pads by the chrome's reach)
  const vpSize = page.viewportSize() ?? { width: 1280, height: 808 };
  await page.mouse.move(vpSize.width - 6, vpSize.height - 6);
  await page.waitForTimeout(160);
  const nav = await page.evaluate(() => window.__nextRig.nav());
  log(`nav: ${JSON.stringify(nav)}`);
  check(nav.cut.active && nav.cut.p === 0 && nav.cut.ticks === 1, `enter: the first frame after the cut is held at p = 0 (ticks ${nav.cut.ticks})`);
  check(nav.cut.maxDelta === 0, `the cut changes no pixel on the ground: maxΔ ${nav.cut.maxDelta} over ${nav.size.w}×${nav.size.h} (the arriving frame IS the portal's last frame, the departed IS its pre-cut frame)`);
  // the folder's index in the departed frame's PAINT order (the drag raised card 0 above it — the departed frame keeps its own order)
  check(nav.cut.outgoing !== null && nav.cut.outgoing.kind === "enter" && nav.cut.outgoing.frames === 7 && nav.cut.outgoing.at !== null && nav.cut.outgoing.at >= 0 && nav.cut.outgoing.at < 7, `the departed frame draws beside the arriving one — one tree through the folder at its own paint index: ${JSON.stringify(nav.cut.outgoing)}`);
  check(nav.mid.p > 0 && nav.mid.outgoing, `mid-flight both slots draw (p ${nav.mid.p.toFixed(3)})`);
  check(nav.landed < 1e-9, `the flight lands EXACTLY on the arrival (|cam − c1| ${nav.landed})`);
  check(!nav.afterLanding.outgoing && nav.afterLanding.submits === 0, `at rest inside: one slot, idle-zero (${nav.afterLanding.submits} submits over ${nav.afterLanding.frames} frames)`);
  check(nav.exit.kind === "exit" && nav.exit.p === 0 && nav.exit.outgoing, "exit: the cut frame is held at p = 0 with the departed inside drawn over the parent");
  check(nav.exit.maxDeltaInset === 0, `the exit cut changes no pixel inside the face: maxΔ ${nav.exit.maxDeltaInset} inset (whole frame ${nav.exit.maxDelta})`);
  check(nav.landed2 < 1e-9, `the exit lands EXACTLY on the saved camera (|cam − c1| ${nav.landed2})`);
  check(nav.roundTripOutsideFolder === 0, `the round trip returns the board pixel for pixel outside the folder: maxΔ ${nav.roundTripOutsideFolder} (whole frame ${nav.roundTrip} — the folder's inside is measured for the first time on entry)`);
  check(nav.gpuErrors === 0, `no uncaptured GPU errors through the flight (${nav.gpuErrors})`);

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "composited.png"), await page.screenshot());
} finally {
  await app.close();
}
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
