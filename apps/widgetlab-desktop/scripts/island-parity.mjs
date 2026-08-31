/**
 * The S5 exit witness (design-012 §9 S5): islands render on the app-owned
 * WebGPU device, resolve to real GPUTextures with the formats the compositor's
 * shader will be guarded on, and carry the same pixels as the WebGL islands
 * they replace.
 *
 * It launches Electron on `dist/island-parity.html` and runs both arms in ONE
 * window, so geometry and DPR cannot drift between them. Each arm is captured
 * three times — COLD (the renderer's first paint) then two WARM repaints —
 * because on the WebGPU side those are not the same image:
 *
 *   composited: cold → warm → warm'      stratified: cold → warm → warm'
 *
 * THE CONTROL COMES FIRST. warm-vs-warm' on each arm is the noise floor, and
 * every other number is read against it. Without it, "WebGL and WebGPU differ
 * by 2%" is a confident number about nothing.
 *
 * THE FIRST-PAINT TRANSIENT. cold-vs-warm is NOT noise on the composited arm:
 * a freshly built WebGPURenderer's first island paint differs from every later
 * one, and the WebGL arm shows nothing of the kind. That is reported as a
 * finding with its bound, not averaged away — see the rig module's
 * `WARMUP_PAINTS` comment for how it was pinned down.
 *
 * WHAT A CROSS-BACKEND DIFF MEANS. composited-vs-stratified compares a WebGL
 * render against a WebGPU render — genuinely different rasterisers, different
 * precision, and (per S1's finding 2) different MSAA states. They are NOT
 * expected to be bit-identical, and asserting that they were would be dishonest
 * about what the swap actually is. So that number is REPORTED, and only two
 * things are asserted on it: that the images are structurally the same picture
 * (orientation and ink mass agree), and that the difference is small enough to
 * be rasteriser noise rather than a different scene.
 *
 * Run: `pnpm --filter widgetlab-desktop island-parity`
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COST_ROUNDS = 12;
/**
 * Cross-backend tolerance. A WebGL and a WebGPU rasteriser disagree on edge
 * coverage and on the last bit of a lit surface; what they must NOT disagree on
 * is WHAT was drawn. 2% of pixels differing beyond 1/255 is comfortably above
 * antialiasing noise on a 256² island with two objects and comfortably below
 * "this is a different image".
 */
const CROSS_BACKEND_MAX_PCT = 2;

const log = (m) => console.log(`[island-parity] ${m}`);
const failures = [];
const check = (ok, what) => {
  log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

log(`loadavg at start: ${os.loadavg().map((n) => n.toFixed(2)).join(" ")} (${os.cpus().length} cpus)`);

const app = await _electron.launch({
  executablePath: require("electron"),
  args: [appDir],
  env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" },
});

try {
  const page = await app.firstWindow();
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("[rig]") || t.startsWith("[ice]")) console.log(`  [renderer] ${t}`);
  });
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));

  await page.goto(`file://${path.join(appDir, "dist", "island-parity.html")}`);
  await page.waitForFunction(() => window.__islandParityRig !== undefined, null, { timeout: 30_000 });
  log("rig loaded");

  const runArm = async (variant) => {
    const s = await page.evaluate((v) => window.__islandParityRig.run(v), variant);
    log(
      `${variant}[${s.id}]: ${s.width}x${s.height} distinctColors=${s.distinctColors} ink=${s.inkPixels} ` +
        `hash=${s.hash} centroid=(${s.inkCentroidX.toFixed(4)}, ${s.inkCentroidY.toFixed(4)}) ` +
        `nativeRows=${s.nativeRowOrder}`,
    );
    if (s.deviceAdopted !== undefined) {
      log(
        `  device: adopted=${s.deviceAdopted} compatibilityMode=${s.compatibilityMode} ` +
          `srgbFormat=${s.srgbFormat} multisampled=${s.multisampled} ` +
          `sources=${s.sourcesRegistered} resolves=${s.sourceResolves} gpuErrors=${s.gpuErrors}`,
      );
    }
    return s;
  };

  const rerun = async (variant) => {
    const s = await page.evaluate(() => window.__islandParityRig.rerun());
    log(
      `${variant}[${s.id}] (same renderer, repainted): ink=${s.inkPixels} hash=${s.hash} ` +
        `centroid=(${s.inkCentroidX.toFixed(4)}, ${s.inkCentroidY.toFixed(4)})`,
    );
    return s;
  };

  const report = (label, d) =>
    log(
      `${label}: ${d.differingPixels}/${d.totalPixels} px (${d.differingPct.toFixed(4)}%) ` +
        `beyond1=${d.differingBeyond1} [edges ${d.differingOnEdges}, interior ${d.differingInInterior}] ` +
        `maxDelta=${d.maxChannelDelta} mean=${d.meanAbsDelta.toFixed(5)}`,
    );

  // COLD = the renderer's first paint. WARM = a repaint one event-loop turn
  // later. They are captured separately because on the WebGPU arm they are NOT
  // the same image — see the FIRST-PAINT TRANSIENT section below. Every
  // comparison that is meant to be about the RENDERERS uses warm captures on
  // both sides; the cold pair is measured on its own terms.
  const aCold = await runArm("composited");
  const aWarm = await rerun("composited");
  const aWarm2 = await rerun("composited");
  const bCold = await runArm("stratified");
  const bWarm = await rerun("stratified");
  const bWarm2 = await rerun("stratified");
  // NO SCREENSHOT here, unlike the S1 ground rig. This rig never presents to a
  // canvas — it reads render targets — so the page is a blank #101010 field by
  // construction, and committing that as an "exit artifact" would be a picture
  // of nothing filed as evidence. The numbers below are the witness.

  // --- the blank guard ------------------------------------------------------
  // Two empty images compare perfectly equal. Everything below is void without
  // this, and S1's ground rig already paid for the lesson once.
  for (const s of [aCold, aWarm, aWarm2, bCold, bWarm, bWarm2]) {
    check(s.distinctColors > 1, `${s.variant}[${s.id}]: NOT a flat fill (distinctColors=${s.distinctColors})`);
    check(
      s.inkPixels > s.width * s.height * 0.01,
      `${s.variant}[${s.id}]: real island content (ink=${s.inkPixels} of ${s.width * s.height})`,
    );
  }

  // --- the device claims ----------------------------------------------------
  check(aCold.deviceAdopted === true, "composited: three ADOPTED the app-owned device (reference identity)");
  check(
    aCold.sourcesRegistered === 1,
    `composited: the island registered a gl source (${aCold.sourcesRegistered})`,
  );
  check(aCold.sourceResolves === true, "composited: the registered source resolves a real GPUTexture");
  check(aCold.gpuErrors === 0, `composited: zero uncaptured GPU errors (${aCold.gpuErrors})`);

  // The two gotchas, measured rather than assumed.
  check(
    aCold.srgbFormat === true,
    "sRGB LAW: the island target's ACTUAL format is -srgb, so the compositor must re-encode",
  );
  check(
    aCold.compatibilityMode === false,
    "MSAA TRAP: three is NOT in compatibilityMode (it would have force-set _samples = 0)",
  );
  check(
    aCold.multisampled === true,
    "MSAA: the backend really allocated a multisample surface for the island",
  );

  // --- the noise floor ------------------------------------------------------
  const diff = (x, y) => page.evaluate(([p, q]) => window.__islandParityRig.diff(p, q), [x, y]);

  const floorGpu = await diff(aWarm.id, aWarm2.id);
  const floorGl = await diff(bWarm.id, bWarm2.id);
  report("NOISE FLOOR composited (two warm repaints)", floorGpu);
  report("NOISE FLOOR stratified (two warm repaints)", floorGl);
  check(floorGpu.differingPixels === 0, "NOISE FLOOR: a warm composited island renders bit-identically");
  check(floorGl.differingPixels === 0, "NOISE FLOOR: a warm stratified island renders bit-identically");

  // --- the first-paint transient, characterised not swept ---------------------
  // A freshly built WebGPURenderer's FIRST island paint is not its steady-state
  // image; every paint after it is. The WebGL arm has no such transient. This is
  // reported with its numbers and asserted only on the two things that make it
  // safe to live with: it is small, and it converges.
  const coldGpu = await diff(aCold.id, aWarm.id);
  const coldGl = await diff(bCold.id, bWarm.id);
  report("FIRST-PAINT TRANSIENT composited (cold vs warm)", coldGpu);
  report("FIRST-PAINT TRANSIENT stratified (cold vs warm)", coldGl);
  check(
    coldGl.differingPixels === 0,
    "FIRST-PAINT: the WebGL arm has NO transient — its first paint is already steady state, " +
      "which is what makes the WebGPU one a finding about three rather than about this rig",
  );
  check(
    coldGpu.differingPct < 1,
    `FIRST-PAINT: the composited transient is bounded (${coldGpu.differingPct.toFixed(4)}% of pixels, ` +
      `maxDelta ${coldGpu.maxChannelDelta}) — a marginally different FIRST frame, not a wrong one`,
  );
  check(
    floorGpu.differingPixels === 0,
    "FIRST-PAINT: it CONVERGES — every paint after the first is bit-identical, so any island that " +
      "repaints once is correct forever (a paint-once static island keeps the transient; see the report)",
  );

  // --- orientation: measured, not assumed -----------------------------------
  // WebGL reads bottom-up and WebGPU reads top-down; the rig normalises both to
  // row 0 = top. If that normalisation is right, the UNFLIPPED cross-backend
  // diff is the smaller one and both arms put the scene's heavy mass (the knot,
  // authored ABOVE centre) in the upper half.
  const cross = await diff(aWarm.id, bWarm.id);
  const crossFlipped = await page.evaluate(
    ([x, y]) => window.__islandParityRig.diffFlipped(x, y),
    [aWarm.id, bWarm.id],
  );
  report("COMPARE composited-vs-stratified (as-is)", cross);
  report("COMPARE composited-vs-stratified (B flipped)", crossFlipped);

  check(
    cross.differingBeyond1 < crossFlipped.differingBeyond1,
    "Y-FLIP: the normalised (unflipped) compare beats the flipped one — the two readers' row " +
      "conventions are reconciled correctly (WebGL bottom-up vs WebGPU top-down)",
  );
  // The scene authors its heavy mass ABOVE centre, so a correctly oriented
  // capture reads a centroid above the midline. Asserted on BOTH arms: this is
  // what makes the flip a fact about the image rather than about the diff.
  const MASS_IS_UP = "the scene's mass is authored above centre, so a flipped capture would read > 0.5";
  for (const s of [aWarm, bWarm]) {
    check(
      s.inkCentroidY < 0.5,
      `${s.variant}: ink centroid is in the UPPER half (${s.inkCentroidY.toFixed(4)}) — ${MASS_IS_UP}`,
    );
  }
  const dy = Math.abs(aWarm.inkCentroidY - bWarm.inkCentroidY);
  const dx = Math.abs(aWarm.inkCentroidX - bWarm.inkCentroidX);
  check(
    dy < 0.02 && dx < 0.02,
    `both profiles place the island's mass at the same spot (Δy=${dy.toFixed(4)}, Δx=${dx.toFixed(4)})`,
  );

  // --- the cross-backend exit, stated honestly ------------------------------
  const crossPct = (cross.differingBeyond1 / cross.totalPixels) * 100;
  const NOT_BIT_IDENTITY =
    "NOTE: WebGL vs WebGPU are different rasterisers with different MSAA states — bit-identity is not the claim and never was.";
  check(
    crossPct < CROSS_BACKEND_MAX_PCT,
    `EXIT: composited islands match the stratified render within ${CROSS_BACKEND_MAX_PCT}% (${crossPct.toFixed(4)}% of pixels differ beyond 1/255). ${NOT_BIT_IDENTITY}`,
  );

  // --- cost -----------------------------------------------------------------
  const cost = await page.evaluate((r) => window.__islandParityRig.cost(r), COST_ROUNDS);
  const delta = cost.island.medianMs - cost.nullControl.medianMs;
  const islandMs = cost.island.medianMs.toFixed(4);
  const controlMs = cost.nullControl.medianMs.toFixed(4);
  log(
    `COST over ${COST_ROUNDS} interleaved rounds — island paint median ${islandMs} ms, null-submit control median ${controlMs} ms, delta ${delta.toFixed(4)} ms`,
  );
  log(`  island samples: ${cost.island.samples.map((n) => n.toFixed(3)).join(", ")}`);
  log(`  control samples: ${cost.nullControl.samples.map((n) => n.toFixed(3)).join(", ")}`);
  log(`  loadavg now: ${os.loadavg().map((n) => n.toFixed(2)).join(" ")}`);
  // Reported against the ~1.2 ms whole-frame class budget from design-012 §1.2.
  // NOT asserted as a hard gate: this is ONE 256² island on a shared laptop,
  // not the spike's 2880×1856 reference load, so the comparable claim is only
  // that a single island is a small fraction of that budget.
  const COST_METHOD =
    "within the ~1.2 ms whole-frame class budget (design-012 §1.2). Wall-clock around a drained queue, medians of interleaved rounds against a per-round null control.";
  check(
    delta < 1.2,
    `COST: one 256² MSAA island paint costs ${delta.toFixed(4)} ms above a null submit — ${COST_METHOD}`,
  );

  await page.evaluate(() => window.__islandParityRig.teardown());
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await app.close().catch(() => {});
}

console.log(
  failures.length === 0
    ? "[island-parity] ALL PASS"
    : `[island-parity] ${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
