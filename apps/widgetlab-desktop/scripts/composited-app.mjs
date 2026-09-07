/**
 * The C0 exit (design-013 §8, Phase C's opening slice): the PRODUCT's seven GL
 * cards draw on the ground's device, LIT.
 *
 * Seven phases, in order: mount (the composited profile, the ground on the
 * app-owned device, and the WEBGPU environment generator taken — `three`'s WebGL
 * PMREM is what B8's attempt died on) · board (a private target, a realised handle
 * and a written destination per GL card, drawn in `own` mode) · lit (not one of the
 * seven is blank or black) · parity (the gold knot and the matte sphere against a
 * WebGL control rendering THE SAME `Scene` object, noise floors first, and the
 * environment proved load-bearing by a control with it switched off) · ground (what
 * the compose draws is what three rendered) · idle-zero · strict (a StrictMode
 * double mount builds ONE renderer; a real unmount disposes it).
 *
 * THE CONTROL COMES FIRST, as everywhere in this suite: both noise floors are read
 * before any cross-arm number, and a blank guard runs before both — two empty
 * images compare perfectly equal.
 *
 * Run: `pnpm --filter widgetlab-desktop app`.
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
 * Cross-backend tolerance. The islands rig grades an UNLIT scene at 2% of pixels
 * differing beyond 1/255; a LIT one costs more and the number says so, because the
 * shading is a TSL node graph on one arm and a GLSL chunk on the other and their
 * specular comes off mip chains built with different filters. Measured here over five
 * runs: the metal card 1.896–1.913%, the matte card 0.340% (bit-stable). 3 is that
 * range with headroom, not a number chosen to make a red go green.
 */
const CROSS_BACKEND_MAX_PCT = 3;

/**
 * …and the SHARP number, which is the claim that actually matters: pixels differing by
 * more than 16/255 — ones that are a different COLOUR rather than a last-bit haze.
 * Measured 0.2456% (metal) and 0.2331% (matte), and those are the silhouette and
 * specular-rim texels. A backend that shaded the card wrongly could not sit here.
 */
const CROSS_BACKEND_SHARP_PCT = 1;

/** The two cards the cross-backend grade runs on. */
const GRADED = ["gold-knot-card", "matte-sphere-card"];

const log = (m) => console.log(`[app] ${m}`);
const failures = [];
const check = (ok, what) => {
  log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};
const rgb = (c) => `(${c.join(",")})`;
const report = (label, d) =>
  log(
    `${label}: ${d.differingPixels}/${d.totalPixels} px (${d.differingPct.toFixed(4)}%) ` +
      `beyond1=${d.differingBeyond1} (${d.beyond1Pct.toFixed(4)}%) beyond16=${d.differingBeyond16} (${d.beyond16Pct.toFixed(4)}%) ` +
      `maxDelta=${d.maxChannelDelta} mean=${d.meanAbsDelta.toFixed(5)}`,
  );
const shot = (s) =>
  `${s.type} ${s.arm}[${s.id}]: ${s.width}x${s.height} distinctColors=${s.distinctColors} ` +
  `ink=${s.inkPixels} meanLuma=${s.meanLuma.toFixed(2)} hash=${s.hash} ` +
  `centroid=(${s.inkCentroidX.toFixed(4)}, ${s.inkCentroidY.toFixed(4)})`;

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
  await page.goto(`file://${path.join(appDir, "dist", "composited-app.html")}`);
  await page.waitForFunction(() => window.__c0Rig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__c0Rig.ready);

  // ---- 1. mount
  const mounted = await page.evaluate(() => window.__c0Rig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.profile === "composited", `the NEW profile mounted (${mounted.profile})`);
  check(mounted.available === true, "Ground.create resolved on the app-owned device");
  // Two canvases: the ground's in the L0 slot, and the R3F one that presents NOTHING.
  check(mounted.canvases === 2, `the ground's canvas plus the island Canvas that never presents (${mounted.canvases})`);
  check(
    mounted.envBackend === "webgpu",
    `D-C0.1: EnvLoader took the WEBGPU PMREM (took "${mounted.envBackend}") — the branch is on the BACKEND, and three's WebGL generator reads renderer.state.buffers, which a WebGPURenderer has not got`,
  );
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors at boot (${mounted.gpuErrors})`);

  // ---- 2. the board
  const board = await page.evaluate(() => window.__c0Rig.board());
  log(`board: seeded=${board.seeded} glCards=${board.glCards} cards=${board.cards} textured=${board.textured} rendered=${board.rendered} targets=${board.targets} unrealised=${board.unrealised} written=${board.written} realized=${board.realized} gpuErrors=${board.gpuErrors}`);
  for (const f of board.facts) {
    log(`  ${f.type}: found=${f.found} handle=${f.handle} mode=${f.mode} srgb=${f.srgb} world=${f.worldSize.join("x")} target=${f.targetSize.join("x")} texture=${f.textureSize.join("x")} rasterScale=${f.rasterScale.toFixed(3)}`);
  }
  check(board.note === undefined, board.note ?? "every GL card reached a textured card");
  check(board.seeded >= 21, `the REAL demo board seeded (${board.seeded} widget entities)`);
  check(board.glCards === 7, `all seven GL card types are on it (${board.glCards})`);
  check(board.facts.every((f) => f.found), "every GL type resolved to a board entity");
  check(
    board.facts.every((f) => f.mode === "own"),
    `every GL card draws from its OWN texture (${board.facts.map((f) => `${f.type}=${f.mode}`).join(" ")})`,
  );
  check(
    board.facts.every((f) => f.srgb === true),
    "sRGB LAW: every island target's ANSWER is an -srgb format, so the compose re-encodes",
  );
  check(
    board.facts.every((f) => f.targetSize[0] === f.textureSize[0] && f.targetSize[1] === f.textureSize[1]),
    `the target three rendered into IS the texture the residency holds, per card (${board.facts.map((f) => `${f.type}=${f.targetSize.join("x")}`).join(" ")})`,
  );
  // The scale each destination came out at is dpr × the card's BAND, and the board is
  // framed to fit, so it is REPORTED, never asserted: Residency sizes from
  // `geometry().rasterSize` and the number moves with the zoom.
  log(`raster scales: ${board.facts.map((f) => `${f.type}=${f.rasterScale.toFixed(3)}`).join(" ")}`);
  check(board.rendered >= 7, `IslandRender rendered every GL card (${board.rendered} renders)`);
  check(board.unrealised === 0, `no island was marked painted without a realised texture (${board.unrealised})`);
  check(board.written >= 7 && board.realized >= 7, `the residency holds a realised handle and a written destination per card (realized ${board.realized}, written ${board.written})`);
  check(board.gpuErrors === 0, `no uncaptured GPU errors with the board up (${board.gpuErrors})`);

  // ---- 3. freeze: five of the seven animate, and a moving scene cannot be graded
  const frozen = await page.evaluate(() => window.__c0Rig.freeze());
  log(`freeze: ${JSON.stringify(frozen)}`);
  check(frozen.paused === 7, `every GL card's demand paused (${frozen.paused})`);
  check(frozen.renderedAfter === 0, `and nothing renders after it — the scenes are frozen (${frozen.renderedAfter} renders over 30 frames)`);

  // ---- 4. lit: not one of the seven is blank or black
  const LIT = [
    "matte-sphere-card",
    "crystal-widget",
    "torus-knot-card",
    "floating-cube-widget",
    "gold-knot-card",
    "shapes-card",
    "orbit-cube-card",
  ];
  for (const type of LIT) {
    const s = await page.evaluate((t) => window.__c0Rig.captureIsland(t, "composited"), type);
    log(shot(s));
    check(s.distinctColors > 1, `${type}: NOT a flat fill (distinctColors=${s.distinctColors})`);
    check(s.inkPixels > s.width * s.height * 0.02, `${type}: real island content (ink=${s.inkPixels} of ${s.width * s.height})`);
    check(s.meanLuma > 6, `${type}: LIT, not a black silhouette (mean luma over its ink ${s.meanLuma.toFixed(2)}/255)`);
  }

  // ---- 5. parity, per graded card
  for (const type of GRADED) {
    log(`--- parity: ${type}`);
    const a1 = await page.evaluate((t) => window.__c0Rig.captureIsland(t, "composited"), type);
    const a2 = await page.evaluate((t) => window.__c0Rig.captureIsland(t, "composited"), type);
    const b1 = await page.evaluate((t) => window.__c0Rig.captureControl(t, "webgl control", true), type);
    const b2 = await page.evaluate((t) => window.__c0Rig.captureControl(t, "webgl control", true), type);
    const bNoEnv = await page.evaluate((t) => window.__c0Rig.captureControl(t, "webgl control, no env", false), type);
    for (const s of [a1, b1, bNoEnv]) log(shot(s));

    // The blank guard: two empty images compare perfectly equal.
    for (const s of [a1, a2, b1, b2]) {
      check(s.distinctColors > 1, `${type} ${s.arm}[${s.id}]: NOT a flat fill (distinctColors=${s.distinctColors})`);
      check(s.inkPixels > s.width * s.height * 0.02, `${type} ${s.arm}[${s.id}]: real content (ink=${s.inkPixels})`);
    }

    // THE CONTROLS, before any cross-arm number.
    const floorA = await page.evaluate(([x, y]) => window.__c0Rig.diff(x, y), [a1.id, a2.id]);
    const floorB = await page.evaluate(([x, y]) => window.__c0Rig.diff(x, y), [b1.id, b2.id]);
    report(`${type} NOISE FLOOR composited (two reads of the frozen target)`, floorA);
    report(`${type} NOISE FLOOR control (two WebGL renders of the same Scene)`, floorB);
    check(floorA.differingPixels === 0, `${type}: the frozen island target reads back bit-identically`);
    check(floorB.differingPixels === 0, `${type}: a repeated control render is bit-identical`);

    // The environment DISCRIMINATES: without it the same control is a different
    // picture, so a cross-backend match is a statement about PMREM sampling and
    // not about two renderers agreeing on an unlit blob.
    const envDelta = await page.evaluate(([x, y]) => window.__c0Rig.diff(x, y), [b1.id, bNoEnv.id]);
    report(`${type} ENVIRONMENT CONTROL (control with env vs control with none)`, envDelta);

    const cross = await page.evaluate(([x, y]) => window.__c0Rig.diff(x, y), [a1.id, b1.id]);
    report(`${type} COMPARE composited vs WebGL control`, cross);
    const dy = Math.abs(a1.inkCentroidY - b1.inkCentroidY);
    const dx = Math.abs(a1.inkCentroidX - b1.inkCentroidX);
    check(dy < 0.02 && dx < 0.02, `${type}: both backends place the card's mass at the same spot (Δy=${dy.toFixed(4)}, Δx=${dx.toFixed(4)})`);
    check(
      envDelta.beyond1Pct > cross.beyond1Pct,
      `${type}: the environment is LOAD-BEARING — dropping it moves ${envDelta.beyond1Pct.toFixed(4)}% of pixels, ` +
        `more than the ${cross.beyond1Pct.toFixed(4)}% the backend swap moves`,
    );
    check(
      cross.beyond1Pct < CROSS_BACKEND_MAX_PCT,
      `EXIT ${type}: the card under composited matches the WebGL control within ${CROSS_BACKEND_MAX_PCT}% (${cross.beyond1Pct.toFixed(4)}% of pixels differ beyond 1/255, maxDelta ${cross.maxChannelDelta}). NOTE: WebGL vs WebGPU are different rasterisers with different shading graphs — bit-identity is not the claim.`,
    );
    check(
      cross.beyond16Pct < CROSS_BACKEND_SHARP_PCT,
      `EXIT ${type} (sharp): only ${cross.beyond16Pct.toFixed(4)}% of pixels are a different COLOUR (beyond 16/255), under the ${CROSS_BACKEND_SHARP_PCT}% ceiling — the disagreement is silhouette and specular rim, not shading`,
    );
  }

  // ---- 6. what the compose DRAWS is what three RENDERED
  for (const type of GRADED) {
    const g = await page.evaluate((t) => window.__c0Rig.groundVsIsland(t), type);
    log(`ground vs island texel: ${JSON.stringify(g)}`);
    check(g.realised === true, `${type}: the destination was realised again after the camera move`);
    check(
      g.centre[0] > 0 && g.centre[1] > 0 && g.centre[0] < g.canvas[0] && g.centre[1] < g.canvas[1],
      `${type}: the probe point ${g.centre.join(",")} is inside the ground canvas ${g.canvas.join("x")} — a clamped probe would read the background and call it a bug`,
    );
    check(
      g.delta <= 6,
      `${type}: the ground draws what three rendered — ground ${rgb(g.ground)} vs the card's own centre texel ${rgb(g.own)} (maxΔ ${g.delta})`,
    );
  }

  // ---- 7. idle-zero
  const idle = await page.evaluate(() => window.__c0Rig.idle(3000));
  log(`idle 3 s: ${JSON.stringify(idle)}`);
  check(
    idle.submits === 0 && idle.rendered === 0,
    `idle-zero on a settled board: ${idle.submits} submits, ${idle.rendered} island renders over ${idle.frames} frames`,
  );

  // ---- 8. the StrictMode / remount census (D-C0.4)
  const boot = await page.evaluate(() => window.__c0Rig.census());
  log(`renderer census after the StrictMode boot: ${JSON.stringify(boot)}`);
  check(
    boot.created === 1 && boot.live === 1,
    `D-C0.4: the StrictMode double mount left ONE WebGPURenderer on the shared device (created ${boot.created}, disposed ${boot.disposed}, live ${boot.live}). This witnesses the OUTCOME, not the lease's memo: R3F gates configure() on a measured container, so on this host the double invoke is over before the factory is called once (mutation probe P3 — removing the memo leaves this green)`,
  );

  const re = await page.evaluate(() => window.__c0Rig.remountGl());
  log(`remount: ${JSON.stringify(re)}`);
  check(re.islandGone === true, "unmounting the GL root cleared the ground's island slot");
  check(
    re.afterUnmount.live === 0 && re.afterUnmount.disposed === 1,
    `a REAL unmount disposes the renderer (created ${re.afterUnmount.created}, disposed ${re.afterUnmount.disposed}, live ${re.afterUnmount.live})`,
  );
  check(
    re.afterRemount.created === 2 && re.afterRemount.live === 1,
    `and the remount builds exactly one more (created ${re.afterRemount.created}, disposed ${re.afterRemount.disposed}, live ${re.afterRemount.live})`,
  );
  check(
    re.renderedAgain >= 7 && re.texturedAgain >= 7,
    `the board draws again after the remount — the SECOND mount's own IslandRender counter (${re.renderedAgain} renders, ${re.texturedAgain} textured)`,
  );
  check(re.gpuErrors === 0, `no uncaptured GPU errors through the remount (${re.gpuErrors})`);

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "composited-app.png"), await page.screenshot());
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await app.close().catch(() => {});
}
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
