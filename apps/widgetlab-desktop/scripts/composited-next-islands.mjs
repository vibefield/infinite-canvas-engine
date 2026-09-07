/**
 * The B5 exit (design-013 §8): under the NEW composited profile a `gl` island renders into
 * the PRIVATE target Residency allocated for it, and the ground draws that texture as the
 * card's content in `own` mode.
 *
 * Six phases, in order: boot (the island rendered, the residency wrote, the ground drew it
 * textured, the z-runs split) · pixels (the ink at the centre, the PLATE where the island is
 * transparent, the top-left mark landing top-left) · parity (the island's own target against a
 * WebGL render of the same scene, noise floor first; and the ground's drawn pixel against the
 * island's own) · idle-zero · demand (a bucket is a ceiling; paused renders nothing) · resize
 * (30 frames of Size writes leave ONE target and no GPU errors — the pin-blind-resize class).
 *
 * THE CONTROL COMES FIRST, as in island-parity: the noise floor (two warm repaints) is measured
 * before any cross-arm number is read, and a blank guard runs before both — two empty images
 * compare perfectly equal.
 *
 * Run: `pnpm --filter widgetlab-desktop next-islands`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");

/**
 * Cross-backend tolerance, island-parity's number and its reasoning: a WebGL and a WebGPU
 * rasteriser disagree on edge coverage and on the last bit of a surface; what they must NOT
 * disagree on is WHAT was drawn.
 */
const CROSS_BACKEND_MAX_PCT = 2;

const log = (m) => console.log(`[next-islands] ${m}`);
const failures = [];
const check = (ok, what) => {
  log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};
const rgb = (c) => `(${c.join(",")})`;
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const report = (label, d) =>
  log(
    `${label}: ${d.differingPixels}/${d.totalPixels} px (${d.differingPct.toFixed(4)}%) ` +
      `beyond1=${d.differingBeyond1} maxDelta=${d.maxChannelDelta} mean=${d.meanAbsDelta.toFixed(5)}`,
  );

log(`loadavg at start: ${os.loadavg().map((n) => n.toFixed(2)).join(" ")} (${os.cpus().length} cpus)`);

const app = await _electron.launch({
  executablePath: require("electron"),
  args: [appDir],
  env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" },
});
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || t.startsWith("[ice") || t.startsWith("[rig")) console.log(`  [renderer] ${t}`);
  });
  await page.goto(`file://${path.join(appDir, "dist", "composited-next-islands.html")}`);
  await page.waitForFunction(() => window.__b5Rig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__b5Rig.ready);

  // ---- 1. boot
  const mounted = await page.evaluate(() => window.__b5Rig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.profile === "composited-next", `the NEW profile mounted (${mounted.profile})`);
  check(mounted.available === true, "Ground.create resolved on the app-owned device");
  // Two canvases: the ground's in the L0 slot, and the R3F one that presents NOTHING.
  check(mounted.canvases === 2, `the ground's canvas plus the island Canvas that never presents (${mounted.canvases})`);
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors at boot (${mounted.gpuErrors})`);

  const boot = await page.evaluate(() => window.__b5Rig.boot());
  log(`boot: ${JSON.stringify(boot)}`);
  check(boot.note === undefined, boot.note ?? "the island rendered into a textured card");
  check(boot.rendered >= 2, `IslandRender rendered both islands (${boot.rendered} renders)`);
  check(boot.targets === 2, `one target per island, for the handles the world names (${boot.targets})`);
  check(boot.written >= 2 && boot.realized >= 2, `the residency holds a realised handle and a written destination per island (realized ${boot.realized}, written ${boot.written})`);
  check(boot.ownMode === "own", `the ground draws the card from its OWN texture (mode "${boot.ownMode}")`);
  check(boot.srgb === true, `sRGB LAW: the ANSWER is an -srgb format, so the compose re-encodes (srgb ${boot.srgb})`);
  check(boot.textured >= 2, `the builder counted the textured cards (${boot.textured} of ${boot.cards})`);
  check(
    boot.targetSize[0] === boot.rasterSize[0] && boot.targetSize[1] === boot.rasterSize[1],
    `the target IS the destination Residency sized: ${boot.targetSize.join("x")} vs rasterSize ${boot.rasterSize.join("x")}`,
  );
  // A plate card reads no own texture and rides whichever run it falls in, so the witness is
  // TWO islands with a plate card between them: the second own texture is what breaks the run.
  check(boot.runs >= 2, `the z-run split is real — two own textures with a plate card between them draw as ${boot.runs} runs`);
  check(boot.gpuErrors === 0, `no uncaptured GPU errors with the island on the board (${boot.gpuErrors})`);

  // ---- 2. pixels, off the ground canvas
  const px = await page.evaluate(() => window.__b5Rig.pixels());
  log(`pixels: ${JSON.stringify(px)}`);
  check(near(px.ink, px.expect.ink, 6), `the island's ink is on the ground at the card's centre: ${rgb(px.ink)} vs ${rgb(px.expect.ink)}`);
  check(
    near(px.clear, px.expect.plate, 6),
    `where the island's texture is TRANSPARENT the card's plate shows through (§10.2's second over): ${rgb(px.clear)} vs plate ${rgb(px.expect.plate)}`,
  );
  check(near(px.mark, px.expect.mark, 6), `the island's TOP-LEFT mark lands top-left — islands are not flipped: ${rgb(px.mark)} vs ${rgb(px.expect.mark)}`);
  check(!near(px.antiMark, px.expect.mark, 24), `and its mirror point is not the mark: ${rgb(px.antiMark)}`);

  const ground = await page.evaluate(() => window.__b5Rig.compareGroundToIsland());
  log(`ground vs island texel: ${JSON.stringify(ground)}`);
  check(
    ground.delta <= 4,
    `what the compose DRAWS is what three RENDERED: ground ${rgb(ground.ink)} vs the island's own texel ${rgb(ground.own)} (maxΔ ${ground.delta})`,
  );

  // ---- 3. parity, island-parity's grades on B5's two arms
  // COLD = the island's FIRST paint (an idle island renders once and stops, so this capture is
  // literally it). WARM = a forced repaint into the same target. They are captured separately
  // because on the WebGPU arm S5 found they are not the same image.
  const aCold = await page.evaluate(() => window.__b5Rig.captureIsland("composited-next cold"));
  const a1 = await page.evaluate(() => window.__b5Rig.captureIsland("composited-next", true));
  const a2 = await page.evaluate(() => window.__b5Rig.captureIsland("composited-next", true));
  const b1 = await page.evaluate(() => window.__b5Rig.captureStratified("stratified"));
  const b2 = await page.evaluate(() => window.__b5Rig.captureStratified("stratified"));
  for (const s of [aCold, a1, a2, b1, b2]) {
    log(
      `${s.arm}[${s.id}]: ${s.width}x${s.height} distinctColors=${s.distinctColors} ink=${s.inkPixels} ` +
        `hash=${s.hash} centroid=(${s.inkCentroidX.toFixed(4)}, ${s.inkCentroidY.toFixed(4)})`,
    );
  }
  // The blank guard: two empty images compare perfectly equal, and S1's ground rig paid for
  // that lesson once already.
  for (const s of [aCold, a1, a2, b1, b2]) {
    check(s.distinctColors > 1, `${s.arm}[${s.id}]: NOT a flat fill (distinctColors=${s.distinctColors})`);
    check(s.inkPixels > s.width * s.height * 0.05, `${s.arm}[${s.id}]: real island content (ink=${s.inkPixels} of ${s.width * s.height})`);
  }
  // THE CONTROL: the noise floor, before any cross-arm number is read.
  const floorA = await page.evaluate(([x, y]) => window.__b5Rig.diff(x, y), [a1.id, a2.id]);
  const floorB = await page.evaluate(([x, y]) => window.__b5Rig.diff(x, y), [b1.id, b2.id]);
  report("NOISE FLOOR composited-next (two warm reads of the live target)", floorA);
  report("NOISE FLOOR stratified (two warm WebGL renders)", floorB);
  check(floorA.differingPixels === 0, "NOISE FLOOR: the live island target reads back bit-identically");
  check(floorB.differingPixels === 0, "NOISE FLOOR: a warm stratified render is bit-identical");

  // The FIRST-PAINT TRANSIENT, asked here rather than inherited: S5 measured one on a freshly
  // built WebGPURenderer. Reported with its numbers either way — a zero is a finding too.
  const coldA = await page.evaluate(([x, y]) => window.__b5Rig.diff(x, y), [aCold.id, a1.id]);
  report("FIRST-PAINT TRANSIENT composited-next (cold vs warm)", coldA);
  check(
    coldA.differingPct < 1,
    `FIRST-PAINT: the transient is bounded (${coldA.differingPct.toFixed(4)}% of pixels, maxDelta ${coldA.maxChannelDelta}) — a marginally different FIRST frame, not a wrong one`,
  );

  const MASS_IS_UP = "the scene's mass is authored above centre, so a flipped capture would read > 0.5";
  for (const s of [a1, b1]) {
    check(s.inkCentroidY < 0.5, `${s.arm}: ink centroid is in the UPPER half (${s.inkCentroidY.toFixed(4)}) — ${MASS_IS_UP}`);
  }
  const dy = Math.abs(a1.inkCentroidY - b1.inkCentroidY);
  const dx = Math.abs(a1.inkCentroidX - b1.inkCentroidX);
  check(dy < 0.02 && dx < 0.02, `both backends place the island's mass at the same spot (Δy=${dy.toFixed(4)}, Δx=${dx.toFixed(4)})`);

  const cross = await page.evaluate(([x, y]) => window.__b5Rig.diff(x, y), [a1.id, b1.id]);
  report("COMPARE composited-next vs stratified", cross);
  const crossPct = (cross.differingBeyond1 / cross.totalPixels) * 100;
  const NOT_BIT_IDENTITY =
    "NOTE: WebGL vs WebGPU are different rasterisers with different MSAA states — bit-identity is not the claim and never was.";
  check(
    crossPct < CROSS_BACKEND_MAX_PCT,
    `EXIT: the island under composited-next matches the stratified render within ${CROSS_BACKEND_MAX_PCT}% (${crossPct.toFixed(4)}% of pixels differ beyond 1/255). ${NOT_BIT_IDENTITY}`,
  );

  // ---- 4. idle-zero
  const idle = await page.evaluate(() => window.__b5Rig.idle(3000));
  log(`idle 3 s: ${JSON.stringify(idle)}`);
  check(
    idle.submits === 0 && idle.rendered === 0,
    `idle-zero with a still island: ${idle.submits} submits, ${idle.rendered} island renders over ${idle.frames} frames`,
  );

  // ---- 5. demand
  const live = await page.evaluate(() => window.__b5Rig.animate(15, 2500));
  log(`animating at 15 fps: ${JSON.stringify(live)}`);
  const expected15 = (live.ms / 1000) * 15;
  check(
    live.rendered >= expected15 * 0.6 && live.rendered <= expected15 * 1.4,
    `an animating island renders at its BUCKET: ${live.rendered} renders in ${Math.round(live.ms)} ms (≈${expected15.toFixed(1)} at 15 fps), ${live.skippedBudget} frames clamped`,
  );
  check(live.ticks >= 1, `and its paint-attributed callback ticked with it (${live.ticks} ticks)`);

  const paused = await page.evaluate(() => window.__b5Rig.pause(2500));
  log(`paused: ${JSON.stringify(paused)}`);
  check(paused.rendered === 0, `a PAUSED card renders nothing over ${Math.round(paused.ms)} ms (${paused.rendered} renders, ${paused.skippedPaused} skips)`);

  // ---- 6. resize: the pin-blind-resize class
  const resize = await page.evaluate(() => window.__b5Rig.resize(30));
  log(`resize: ${JSON.stringify(resize)}`);
  check(resize.handles > 5, `a resize drag really re-mints handles (${resize.handles} distinct over ${resize.frames} frames)`);
  check(resize.staleTargets === 0 && resize.currentLive, `and leaves ONE live target for this island — ${resize.staleTargets} retired handles still hold one, current live ${resize.currentLive} (${resize.targets} across the board's islands)`);
  check(resize.disposed === resize.handles - 1, `every handle the table forgot took its target with it (${resize.disposed} disposed of ${resize.handles - 1} retired)`);
  check(resize.liveEveryFrame === true, "no frame sampled a disposed texture — the current ref always named a live target");
  check(resize.gpuErrors === 0, `no uncaptured GPU errors through the drag (${resize.gpuErrors})`);

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "composited-next-islands.png"), await page.screenshot());
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await app.close().catch(() => {});
}
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
