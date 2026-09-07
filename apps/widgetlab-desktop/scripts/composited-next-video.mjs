/**
 * The B6 exit (design-013 §8, §9 Q5 RULED): a live surface on the NEW composited profile.
 *
 * S8's coverage numbers, re-witnessed under the registered-stable-texture contract — every
 * production is ONE copy and ONE compose frame, a paused card copies and submits nothing while
 * its producer keeps producing, a stopped producer leaves the board at idle-zero, and a card
 * registered but never fed draws the plate (the null control that proves the rest can come out
 * negative). Plus the orientation the copy has to get right, measured on both axes.
 *
 * Run: `pnpm --filter widgetlab-desktop next-video`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const log = (m) => console.log(`[next-video] ${m}`);
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
  await page.goto(`file://${path.join(appDir, "dist", "composited-next-video.html")}`);
  await page.waitForFunction(() => window.__videoRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__videoRig.ready);

  // ---- the boot
  const mounted = await page.evaluate(() => window.__videoRig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.profile === "composited-next", `the NEW profile mounted through <InfiniteCanvas> (${mounted.profile})`);
  check(mounted.canvases === 1, `one canvas in the L0 slot — the ground's own (${mounted.canvases})`);
  check(mounted.available === true, "Ground.create resolved on the app-owned device");
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors (${mounted.gpuErrors})`);

  const boot = await page.evaluate(() => window.__videoRig.boot());
  log(`boot: ${JSON.stringify(boot)}`);
  check(boot.note === undefined, boot.note ?? "the board settled (3 video cards)");
  check(boot.cards === 3, `3 video cards drawn (${boot.cards})`);
  check(boot.registered === 3 && boot.handles.every((h) => h > 0), `3 producers hold a stable-texture handle (${JSON.stringify(boot.handles)})`);
  check(boot.textured >= 1, `the ground draws the live card from its own texture, not the plate (textured ${boot.textured})`);
  check(boot.copies >= 1, `the first arrival was copied once (${boot.copies})`);
  check(boot.gpuErrors === 0, `no uncaptured GPU errors with a live surface on the board (${boot.gpuErrors})`);

  // ---- coverage: every production is one copy and one compose frame (S8's 46/46, re-witnessed)
  const cov = await page.evaluate(() => window.__videoRig.coverage(181));
  log(`coverage: ${JSON.stringify(cov)}`);
  check(cov.arrivals === cov.produced, `every production reached the ingest: ${cov.arrivals}/${cov.produced}`);
  check(cov.copies === cov.arrivals, `every arrival is ONE copy: ${cov.copies}/${cov.arrivals}`);
  check(cov.submits === cov.copies, `every copy is ONE compose frame: ${cov.submits}/${cov.copies} submits over ${cov.frames} frames (${cov.ms} ms)`);
  check(cov.dropped === 0, `nothing dropped while the card is live and inside its bucket (${cov.dropped})`);
  check(cov.gpuErrors === 0, `no uncaptured GPU errors across the run (${cov.gpuErrors})`);

  // ---- liveness and orientation, off the ground's own pixels
  const look = await page.evaluate(() => window.__videoRig.look(8));
  log(`look: ${JSON.stringify(look)}`);
  check(look.distinctCentreColours > 1, `the card is LIVE, not frozen on its first frame: ${look.distinctCentreColours} distinct centre colours over ${look.samples} productions`);
  check(luma(look.top) - luma(look.bottom) > 100, `the fixture's own top-to-bottom contrast is in the card: top ${rgb(look.top)} vs bottom ${rgb(look.bottom)}`);
  check(near(look.markerTL, look.expect.marker, 6), `the fixture's TOP-LEFT marker lands top-left: ${rgb(look.markerTL)} vs ${rgb(look.expect.marker)}`);
  check(near(look.markerTR, look.expect.top, 6), `and not top-right — that stays the bright band: ${rgb(look.markerTR)} vs ${rgb(look.expect.top)}`);
  check(near(look.markerBL, look.expect.bottom, 6), `and not bottom-left — that stays the dark band (no flipY): ${rgb(look.markerBL)} vs ${rgb(look.expect.bottom)}`);

  // ---- paused: the demand clamp refuses the frames a producer keeps making
  const paused = await page.evaluate(() => window.__videoRig.paused(181));
  log(`paused: ${JSON.stringify(paused)}`);
  check(paused.produced > 0, `the producer kept producing into the paused card (${paused.produced} productions over ${paused.frames} frames)`);
  check(paused.copies === 0, `a paused card copies nothing: ${paused.copies}/${paused.produced}`);
  check(paused.submits === 0, `and costs no compose frame at all: ${paused.submits} submits over ${paused.frames} frames`);
  check(paused.paused === paused.arrivals && paused.dropped === paused.arrivals, `every arrival was dropped BY THE CLAMP and closed: paused ${paused.paused}, dropped ${paused.dropped}, arrivals ${paused.arrivals}`);

  // ---- idle-zero: the producer stops and the board goes quiet
  const idle = await page.evaluate(() => window.__videoRig.idle(3000));
  log(`idle 3 s: ${JSON.stringify(idle)}`);
  check(idle.submits === 0 && idle.redraws === 0 && idle.copies === 0, `idle-zero with a live surface on the board: ${idle.submits} submits, ${idle.redraws} redraws, ${idle.copies} copies over ${idle.frames} frames`);

  // ---- the null control: registered, never fed
  const nul = await page.evaluate(() => window.__videoRig.nullControl());
  log(`null control: ${JSON.stringify(nul)}`);
  check(near(nul.centre, nul.plate, 4), `a card registered but never fed draws the PLATE, never an empty texture: ${rgb(nul.centre)} vs --vf-card ${rgb(nul.plate)}`);
  check(nul.textured === 1, `and is not counted as textured — only the live card is (${nul.textured} of 3)`);

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "composited-next-video.png"), await page.screenshot());
} finally {
  await app.close();
}
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
