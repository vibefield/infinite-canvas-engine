/**
 * The B4 exit (design-013 §8): DomRender copies a promoted card's pixels into
 * the layer Residency named, and the ground draws them.
 *
 * Five phases, each a page of its own where the mount decides the answer (one
 * profile — and one raster strategy — per page, §11 Q2):
 *
 *   boot     the profile mounts, HTML-in-Canvas is present, ONE L1 canvas
 *            exists, and a board of text-free cards is idle-zero;
 *   promote  D7 — the chrome band and the card's INTERIOR read the same before
 *            and after a promotion, and again after the demotion. The only
 *            thing that changed is who rasterised the pixels;
 *   idle     promoted cards submit and copy nothing while still; an animating
 *            card copies at its demand BUCKET's rate; a paused card not at all;
 *   drift    at zoom 1.9 the page layer is read back around the slot: pixels
 *            written OUTSIDE it, under `band` and under `crisp`;
 *   parity   the same board's interiors, promoted here and painted by the
 *            browser on the stratified twin page.
 *
 * Run: `pnpm --filter widgetlab-desktop next-render`.
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
  return { width, height, channels, rgb: (x, y) => { const i = y * stride + x * channels; return [out[i], out[i + 1], out[i + 2]]; } };
}
/** The page's pixel at CSS point (sx, sy): a 4×4 CSS px clip decoded, its centre pixel. */
async function pagePixel(page, sx, sy) {
  const png = decodePng(await page.screenshot({ type: "png", clip: { x: sx - 2, y: sy - 2, width: 4, height: 4 } }));
  return png.rgb(Math.floor(png.width / 2), Math.floor(png.height / 2));
}
/** A CSS-px rect of the page, decoded. */
async function pageRect(page, r) {
  return decodePng(await page.screenshot({ type: "png", clip: { x: r.sx, y: r.sy, width: r.w, height: r.h } }));
}
/**
 * Max per-channel delta between two decoded rects, inset by `inset` px on every
 * side, WITH the bounding box of what differs and how far in it reaches. A
 * count alone cannot tell a rim from a wrong picture; the box can, and the
 * `edge` number — the greatest distance any differing pixel sits from the
 * nearest border of the inset region — is the one that says "boundary only".
 */
function rectDiff(a, b, inset) {
  if (a.width !== b.width || a.height !== b.height) return { error: `${a.width}x${a.height} vs ${b.width}x${b.height}`, differing: -1, max: -1, total: 0 };
  let differing = 0;
  let max = 0;
  let total = 0;
  let edge = 0;
  const box = { x0: Number.POSITIVE_INFINITY, y0: Number.POSITIVE_INFINITY, x1: -1, y1: -1 };
  for (let y = inset; y < a.height - inset; y++) {
    for (let x = inset; x < a.width - inset; x++) {
      const p = a.rgb(x, y);
      const q = b.rgb(x, y);
      const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
      total++;
      if (d > max) max = d;
      if (d === 0) continue;
      differing++;
      if (x < box.x0) box.x0 = x;
      if (y < box.y0) box.y0 = y;
      if (x > box.x1) box.x1 = x;
      if (y > box.y1) box.y1 = y;
      const depth = Math.min(x - inset, y - inset, a.width - 1 - inset - x, a.height - 1 - inset - y);
      if (depth > edge) edge = depth;
    }
  }
  return { error: null, differing, max, total, edge, box: box.x1 < 0 ? null : box };
}

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const log = (m) => console.log(`[next-render] ${m}`);
const failures = [];
const check = (ok, what) => { log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures.push(what); };
const rgb = (c) => `(${c.join(",")})`;
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const pageUrl = (q) => `file://${path.join(appDir, "dist", "composited-next-render.html")}${q}`;
/**
 * How far in the card's CHROME reaches, in CSS px: the corner radius the ground
 * draws (22, `CARD_RADIUS`) plus the ring and the coverage filter's own pixel.
 * Inside it, the two arms are painting the same content and nothing else.
 */
const INTERIOR_INSET = 28;

const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`); });

  const open = async (q) => {
    await page.goto(pageUrl(q));
    await page.waitForFunction(() => window.__renderRig !== undefined, null, { timeout: 30_000 });
    await page.evaluate(() => window.__renderRig.ready);
    return page.evaluate(() => window.__renderRig.mount());
  };

  // ---- boot
  const mounted = await open("");
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.profile === "composited-next", `the NEW profile mounted (${mounted.profile})`);
  check(mounted.hicMissing.length === 0, `HTML-in-Canvas is present${mounted.hicMissing.length ? ` — missing ${mounted.hicMissing.join(", ")}` : ""}`);
  check(mounted.layoutSubtree === true, "a `layoutsubtree` canvas lays its children out (the functional probe)");
  check(mounted.sourceCanvases === 1, `ONE L1 source canvas in the mount, built by the facade from the ground's handle (${mounted.sourceCanvases})`);
  check(mounted.canvases === 1, `and ONE ground canvas beside it in the L0 slot (${mounted.canvases})`);
  check(mounted.available === true, "Ground.create resolved on the app-owned device");
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors (${mounted.gpuErrors})`);

  const board = await page.evaluate(() => window.__renderRig.board(6));
  log(`board: ${JSON.stringify(board)}`);
  check(board.cards === 6, `6 text-free cards drawn (${board.cards})`);
  check(board.textured === 0, `none of them textured yet — every card is on the DOM at rest (${board.textured})`);

  const idle0 = await page.evaluate(() => window.__renderRig.idle(2500));
  log(`idle (no promotions): ${JSON.stringify(idle0)}`);
  check(idle0.submits === 0 && idle0.copies === 0, `idle-zero before any promotion: ${idle0.submits} submits, ${idle0.copies} copies over ${idle0.frames} frames`);

  // ---- promote (D7): the same pixels, a different rasteriser
  const pts = await page.evaluate(() => window.__renderRig.points(0));
  log(`sample points: ${JSON.stringify(pts)}`);
  const bandBefore = await pagePixel(page, pts.band.sx, pts.band.sy);
  const interiorBefore = [];
  for (const p of pts.interior) interiorBefore.push(await pagePixel(page, p.sx, p.sy));
  const rectBefore = await pageRect(page, pts.rect);

  const promoted = await page.evaluate(() => window.__renderRig.promote(0));
  log(`promote: ${JSON.stringify(promoted)}`);
  check(promoted.target === "gpu" && promoted.onCanvas === true, `a card that asks for the GPU moves onto L1 (target ${promoted.target}, onCanvas ${promoted.onCanvas})`);
  // A refusal here is the DESIGNED first frame: the host has just been
  // reparented and the platform has no cached paint record for it yet. The
  // debt is kept and the next flush copies, which is what `copies` says.
  check(promoted.copies >= 1 && promoted.unavailable === 0, `the copy landed: ${promoted.copies} copies (${promoted.refused} thrown on an unpainted host and retried, ${promoted.unavailable} refused for want of the method)`);
  check(promoted.mode === "page", `and the card draws from its page layer (${promoted.mode})`);
  check(promoted.hostBox === promoted.expectBox, `the L1 host is sized at geometry().cssSize: ${promoted.hostBox} vs ${promoted.expectBox}`);
  check(promoted.slot === promoted.writtenPx, `and the slot Residency placed IS what the copy writes: ${promoted.slot} vs ${promoted.writtenPx}`);
  check(promoted.hitIsHost === true && promoted.pointerEvents === "auto", `hit truth survived the move: elementFromPoint names the host (${promoted.hitIsHost}, pointer-events ${promoted.pointerEvents || "(unset)"})`);

  const bandAfter = await pagePixel(page, pts.band.sx, pts.band.sy);
  const interiorAfter = [];
  for (const p of pts.interior) interiorAfter.push(await pagePixel(page, p.sx, p.sy));
  const rectAfter = await pageRect(page, pts.rect);
  check(near(bandBefore, bandAfter, 0), `D7 — the chrome band across a promote diffs 0: ${rgb(bandBefore)} → ${rgb(bandAfter)}`);
  let interiorMax = 0;
  for (let i = 0; i < interiorBefore.length; i++) {
    const d = Math.max(...interiorBefore[i].map((v, k) => Math.abs(v - interiorAfter[i][k])));
    interiorMax = Math.max(interiorMax, d);
  }
  check(interiorMax === 0, `D7 — the interior of a text-free card diffs ${interiorMax} across the promote: ${interiorBefore.map(rgb).join(" ")} → ${interiorAfter.map(rgb).join(" ")}`);
  // The card's WHOLE rect, then its interior. The rect includes the rounded
  // corners, where the DOM clip-path's antialiasing and the ground's SDF
  // coverage filter are two different filters over the same silhouette — a
  // boundary difference by construction, and chrome rather than content. The
  // INTERIOR (inset past the corner radius and the ring) is the exit number.
  const wholeCard = rectDiff(rectBefore, rectAfter, 3);
  log(`whole card (inset 3 px): ${JSON.stringify(wholeCard)}`);
  const interiorRect = rectDiff(rectBefore, rectAfter, INTERIOR_INSET);
  log(`card interior (inset ${INTERIOR_INSET} px): ${JSON.stringify(interiorRect)}`);
  check(interiorRect.error === null && interiorRect.max === 0, `D7 — the card's whole INTERIOR is identical across the promote: ${interiorRect.differing}/${interiorRect.total} px differ, max ${interiorRect.max} (at the rect's edges, where the clip and the SDF filter the same silhouette differently: ${wholeCard.differing}/${wholeCard.total}, reaching ${wholeCard.edge} px in)`);

  const demoted = await page.evaluate(() => window.__renderRig.demote(0));
  log(`demote: ${JSON.stringify(demoted)}`);
  check(demoted.target === "dom" && demoted.onCanvas === false, `back on the live DOM the host leaves L1 (target ${demoted.target}, onCanvas ${demoted.onCanvas})`);
  check(demoted.mode === "plate", `and the card stops sampling a texture it no longer owns (${demoted.mode})`);
  const bandBack = await pagePixel(page, pts.band.sx, pts.band.sy);
  const interiorBack = [];
  for (const p of pts.interior) interiorBack.push(await pagePixel(page, p.sx, p.sy));
  let backMax = Math.max(...bandBefore.map((v, k) => Math.abs(v - bandBack[k])));
  for (let i = 0; i < interiorBefore.length; i++) backMax = Math.max(backMax, ...interiorBefore[i].map((v, k) => Math.abs(v - interiorBack[i][k])));
  check(backMax === 0, `and coming back is the same picture again: max delta ${backMax}`);

  // ---- the STANDARD path, end to end: a Grab is a promotion (and a lift)
  const grabbed = await page.evaluate(() => window.__renderRig.grabPromote(3));
  log(`grab: ${JSON.stringify(grabbed)}`);
  check(grabbed.target === "gpu" && grabbed.onCanvas === true, `\`ice:surface.domAtRest\` answers a Grab with the GPU (target ${grabbed.target}, onCanvas ${grabbed.onCanvas})`);
  check(grabbed.mode === "page", `and the grabbed card draws from its page layer while it is held (${grabbed.mode})`);
  const settled = await page.evaluate(() => window.__renderRig.demote(3));
  check(settled.target === "dom", `releasing it settles back to the DOM (${settled.target})`);

  // ---- idle, with cards on the GPU
  const p1 = await page.evaluate(() => window.__renderRig.promote(1));
  const p2 = await page.evaluate(() => window.__renderRig.promote(2));
  check(p1.mode === "page" && p2.mode === "page", `two more cards promoted and drawn from their layers (${p1.mode}, ${p2.mode})`);
  const idle1 = await page.evaluate(() => window.__renderRig.idle(3000));
  log(`idle (3 promoted): ${JSON.stringify(idle1)}`);
  check(idle1.submits === 0 && idle1.copies === 0, `idle-zero holds with promoted cards: ${idle1.submits} submits, ${idle1.copies} copies over ${idle1.frames} frames (${idle1.dirtied} paint marks, ${idle1.resized} resizes, ${idle1.domWrites} DOM writes; wakes ${JSON.stringify(idle1.wakes)})`);

  // A card whose content animates: the copies follow the BUCKET, not the paint rate.
  await page.evaluate(() => window.__renderRig.spin(1, true));
  const spinning = await page.evaluate(() => window.__renderRig.idle(2500));
  const secs = spinning.frames / 60;
  const rate = spinning.copies / secs;
  const dirtRate = spinning.dirtied / secs;
  log(`animating card: ${JSON.stringify(spinning)} ⇒ ${rate.toFixed(1)} copies/s from ${dirtRate.toFixed(1)} paint marks/s`);
  check(spinning.copies > 0, `an animating card's content reaches the GPU (${spinning.copies} copies)`);
  check(rate <= 70, `and its rate is the demand bucket's, not its paint rate: ${rate.toFixed(1)} copies/s against ${dirtRate.toFixed(1)} paint marks/s`);

  await page.evaluate(() => window.__renderRig.pause(1, true));
  const paused = await page.evaluate(() => window.__renderRig.idle(2500));
  log(`paused, still animating: ${JSON.stringify(paused)}`);
  check(paused.copies === 0, `a PAUSED animating card copies nothing at all — parked, not merely throttled (${paused.copies} copies over ${paused.frames} frames)`);
  await page.evaluate(() => window.__renderRig.spin(1, false));

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "composited-next-render.png"), await page.screenshot());

  // ---- drift, one page per raster strategy
  for (const raster of ["band", "crisp"]) {
    await open(`?raster=${raster}`);
    const d = await page.evaluate(() => window.__renderRig.drift());
    log(`drift ${raster}: ${JSON.stringify(d)}`);
    check(d.copies >= 1 && d.refused === 0, `${raster}: the card at zoom ${d.zoom} (band ${d.band}) was copied (${d.copies} copies, ${d.refused} refused)`);
    check(d.inside > 0, `${raster}: and the slot is not blank — ${d.inside} of ${d.slot.w * d.slot.h} texels carry ink (the content guard)`);
    check(d.outside === 0, `${raster}: pixels written PAST the slot = ${d.outside} of ${d.ringTotal} sampled (the old leg wrote 40,272 here)`);
  }

  // ---- parity: the same board, two profiles, two pages
  await open("");
  await page.evaluate(() => window.__renderRig.board(6));
  const parityPts = await page.evaluate(() => window.__renderRig.points(0));
  // The CONTROL, captured before the promotion: the same card painted by the
  // browser under THIS profile. Diffed against the stratified twin below, it
  // says whether "browser-painted" means the same thing on both pages — without
  // it, a parity number is a claim about two variables at once.
  const nextDomRect = await pageRect(page, parityPts.rect);
  const pr = await page.evaluate(() => window.__renderRig.promote(0));
  check(pr.mode === "page", `parity arm: the card is drawn from its page layer (${pr.mode})`);
  const nextRect = await pageRect(page, parityPts.rect);

  await open("?profile=stratified");
  await page.evaluate(() => window.__renderRig.board(6));
  const stratRect = await pageRect(page, parityPts.rect);
  const control = rectDiff(nextDomRect, stratRect, 3);
  log(`parity control (browser-painted, both profiles, inset 3 px): ${JSON.stringify(control)}`);
  check(control.error === null && control.max === 0, `the A-vs-A control: the same card painted by the BROWSER is identical under both profiles — ${control.differing}/${control.total} px differ, max ${control.max}`);
  // Inset 3 CSS px: the card's own edges are where the ground's coverage filter
  // and the browser's box edge disagree by design — chrome, not content.
  const parityWhole = rectDiff(nextRect, stratRect, 3);
  const parity = rectDiff(nextRect, stratRect, INTERIOR_INSET);
  log(`parity whole card (inset 3 px): ${JSON.stringify(parityWhole)}`);
  log(`parity interior (inset ${INTERIOR_INSET} px): ${JSON.stringify(parity)}`);
  check(parity.error === null, parity.error ?? "the two arms captured the same rect");
  check(parity.max === 0, `S8 redefined — a text-free card's INTERIOR is identical promoted (composited-next) and live-DOM (stratified): ${parity.differing}/${parity.total} px differ, max ${parity.max} (with the chrome unmasked: ${parityWhole.differing}/${parityWhole.total}, reaching ${parityWhole.edge} px in)`);
} finally {
  await app.close();
}
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
