/**
 * The GL-LEG EXIT: islands reach the screen through the real React path.
 *
 * S5's island-parity rig proved three's island OUTPUT is correct by reading
 * render targets directly — it could not prove anything was ever drawn,
 * because the compositor had no `gl` leg. This grades the rest of that chain:
 * a real `<Canvas gl={islandRendererFactory}>` with a real
 * `<GLViews compositor={…}>`, mounted by React, whose islands ground's
 * `WidgetQuadPass` composites onto the compositor's own target.
 *
 * ORIENTATION IS MEASURED HERE, and the measurement overturned the brief.
 *
 * The instruction that reached this slice was to y-flip the island sample,
 * citing S5's "513 vs 9,531 px". Those numbers are real and they say the
 * opposite: S5's rig normalises WebGL's bottom-up reader against WebGPU's
 * top-down one FIRST, and after that the as-is arm scores 513 and the flipped
 * arm 9,531 — its own PASS line reads "the normalised (unflipped) compare
 * beats the flipped one". That flip reconciles two READERS (witness law b); it
 * is not one the compositor owes.
 *
 * So this rig drives the same pass both ways and grades two independent
 * signals — where the scene's bright bar lands, and which orientation of the
 * island's own pixels the composite agrees with. Both say: no flip.
 *
 * Run: `pnpm --filter widgetlab-desktop app-witness`
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");

const log = (m) => console.log(`[gl-leg] ${m}`);
const failures = [];
const check = (ok, what) => {
  log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

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
    if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`);
  });

  await page.goto(`file://${path.join(appDir, "dist", "composited-app.html")}`);
  await page.waitForFunction(() => window.__appRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__appRig.ready);

  // --- the React path really came up ----------------------------------------
  const mounted = await page.evaluate(() => window.__appRig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.islandKind === "gl", `<GLViews> published the island as a gl source (${mounted.islandKind})`);
  check(
    mounted.islandHasTexture === true,
    `three rendered into it — the getter resolves a GPUTexture (${mounted.islandTextureSize})`,
  );
  check(
    mounted.gpuErrors === 0,
    `no uncaptured GPU errors while React, three and the compositor shared one device (${mounted.gpuErrors})`,
  );
  check(mounted.submits > 0, `the compositor submitted real work (${mounted.submits})`);
  check(mounted.canvasHosts === 1, `the dom card is composited alongside it (${mounted.canvasHosts})`);

  fs.mkdirSync(shotDir, { recursive: true });

  // --- the island is actually ON the compositor's target ---------------------
  const shipped = await page.evaluate(() => window.__appRig.gradeIsland(false));
  log(
    `AS-IS   (production): ink=${shipped.ink}/${shipped.area} distinct=${shipped.distinct} ` +
      `topMinusBottom=${shipped.topMinusBottom.toFixed(1)} ` +
      `agreeAsIs=${shipped.agreeAsIs?.toFixed(2)} agreeFlipped=${shipped.agreeFlipped?.toFixed(2)} ` +
      `target=${shipped.targetSize} rect=${JSON.stringify(shipped.rect)}`,
  );
  fs.writeFileSync(path.join(shotDir, "gl-leg-composited.png"), await page.screenshot());

  check(
    shipped.ink > shipped.area * 0.2,
    `the island occupies its screen rect on the compositor target (${shipped.ink}/${shipped.area} px)`,
  );
  check(
    shipped.distinct > 4,
    `and it is a real picture, not a flat fill (${shipped.distinct} distinct colours)`,
  );

  // --- orientation, measured on THIS leg -------------------------------------
  const control = await page.evaluate(() => window.__appRig.gradeIsland(true));
  log(
    `FLIPPED (control)   : topMinusBottom=${control.topMinusBottom.toFixed(1)} ` +
      `agreeAsIs=${control.agreeAsIs?.toFixed(2)} agreeFlipped=${control.agreeFlipped?.toFixed(2)}`,
  );
  log(
    `island target itself: topMinusBottom=${shipped.targetTopMinusBottom?.toFixed(1)} (as three stored it, read top-down like the compositor target — both WebGPU, so no row-order normalisation applies)`,
  );

  // The scene authors a BRIGHT bar above centre in island space (y-up), so a
  // correctly oriented composite is brighter on top.
  // The island's own target, read top-down, already has the bright bar on top —
  // three has put it in the compositor's row order. So the SHIPPED arm (no
  // flip) must agree with it and the flipped arm must invert it.
  check(
    (shipped.targetTopMinusBottom ?? 0) > 20,
    `the island target itself has the bright bar on top when read top-down (${shipped.targetTopMinusBottom?.toFixed(1)}) — three delivers the compositor's row order`,
  );
  check(
    shipped.topMinusBottom > 20,
    `EXIT: the shipped composite puts the scene's bright bar ON TOP, as authored (${shipped.topMinusBottom.toFixed(1)})`,
  );
  check(
    control.topMinusBottom < -20,
    `and flipping it turns the island UPSIDE DOWN (${control.topMinusBottom.toFixed(1)}) — the two arms DISAGREE, so this measures the orientation rather than assuming it`,
  );
  // Second, independent signal: agreement with the island's own pixels.
  check(
    shipped.agreeAsIs < shipped.agreeFlipped,
    `the shipped composite agrees with the island's own pixels AS-IS (${shipped.agreeAsIs?.toFixed(2)} vs ${shipped.agreeFlipped?.toFixed(2)} mean channel delta)`,
  );
  check(
    control.agreeFlipped < control.agreeAsIs,
    `and the flipped control agrees with them flipped (${control.agreeFlipped?.toFixed(2)} vs ${control.agreeAsIs?.toFixed(2)}) — the comparison discriminates`,
  );
  // Colour agreement is the sRGB round trip: sampling an -srgb target decodes
  // to linear, the shader re-encodes for a non-srgb swap chain, and the bytes
  // should land back where they started. Compared on a downsampled grid, so an
  // upscaled island's interpolation does not read as a colour error.
  check(
    shipped.agreeAsIs < 20,
    `sRGB round trip holds — composited island vs its own target differ by ${shipped.agreeAsIs?.toFixed(2)}/255 mean channel (a missing re-encode reads washed out, tens of levels off)`,
  );

  // --- true z across kinds, in ONE pass --------------------------------------
  const z = await page.evaluate(() => window.__appRig.mixedZ());
  log(`MIXED-Z: ${JSON.stringify(z)}`);
  check(z.overlaps === true, "the dom card and the island really overlap (or the z test proves nothing)");
  // The card is opaque #d94f4f and ordered after the island.
  const [r, g, b, a] = z.rgba;
  check(
    a > 200 && r > 150 && g < 120 && b < 120,
    `EXIT: a dom card at a later sibling ordinal covers the GL island in the SAME pass — true z across kinds (rgba ${r},${g},${b},${a})`,
  );

  // --- THE S6 WITNESS: a dragged card passes UNDER a GL widget --------------
  const drag = await page.evaluate(() => window.__appRig.dragUnder(24));
  log(
    `DRAG: promoted=${drag.promoted} afterDrop=${drag.afterDrop} frames=${drag.frames.length} ` +
      `refusedDuringPromote=${drag.refusedDuringPromote} atlasSlotPixel=${drag.slotSample}`,
  );
  fs.writeFileSync(path.join(shotDir, "s6-drag-under-gl.png"), await page.screenshot());

  const covering = drag.frames.filter((f) => f.coversIsland);
  const onSide = drag.frames.filter((f) => f.coversSide);
  const isCard = (c) => c[0] > 150 && c[1] < 120 && c[2] < 120 && c[3] > 200;
  const zPops = covering.filter((f) => isCard(f.island));
  const drewOnSide = onSide.filter((f) => isCard(f.side));
  log(
    `  frames over the island: ${covering.length}, of which z-pops: ${zPops.length}` +
      ` | frames over P_SIDE: ${onSide.length}, of which show the card: ${drewOnSide.length}`,
  );
  log(`  island sample across the drag: ${JSON.stringify(covering.slice(0, 3).map((f) => f.island))}`);
  log(`  card-centre sample: ${JSON.stringify(drag.frames.slice(0, 4).map((f) => f.cardCentre))}`);
  log(`  card rect (device px): ${JSON.stringify(drag.frames.slice(0, 4).map((f) => f.cardRect))}`);
  log(
    `  pass state: ${JSON.stringify(
        drag.frames.slice(0, 4).map((f) => ({
          drawn: f.drawn,
          skipped: f.skipped,
          reg: f.registered,
          res: f.residency,
        })),
      )}`,
  );
  log(`  host: ${drag.frames[0]?.host}`);
  log(`  host (mid-drag): ${drag.frames[12]?.host}`);
  log(`  slot: ${drag.frames[0]?.slotRect}`);
  log(`  lift scale across the drag: ${JSON.stringify(drag.frames.slice(0, 6).map((f) => f.lift))}`);

  // The POLICY promoted it — nothing in the rig called setPresentation.
  check(drag.promoted === "composited", `grabbing the card PROMOTED it (${drag.promoted})`);
  check(
    drag.afterDrop === "composited",
    `and dropping it does not demote on the release edge (${drag.afterDrop}) — the settle window is still open`,
  );
  // The lift ran as a per-quad fact: one ease, no CSS spring involved.
  const lifted = drag.frames.some((f) => f.lift > 1.001);
  check(lifted, `the lift ran as a per-quad fact (max scale ${Math.max(...drag.frames.map((f) => f.lift))})`);

  check(covering.length > 4, `the card really crossed the island (${covering.length} frames over it)`);
  // THE GUARD: if the card never drew anywhere, "the island wins" is vacuous.
  check(
    drewOnSide.length > 0,
    `the dragged card IS composited — it paints where the island is not (${drewOnSide.length}/${onSide.length} frames)`,
  );
  check(
    zPops.length === 0,
    `EXIT: NO Z-POP — across ${covering.length} frames of the card crossing the GL widget, not one shows the card on top (${zPops.length} z-pop frames)`,
  );

  // --- S7: the video kind ---------------------------------------------------
  // ORDER MATTERS HERE. The as-is arm runs first and the window witness and
  // the screenshot follow it immediately, so both see the SHIPPING
  // orientation with the source registered; the two control arms — which
  // deliberately leave the surface upside down and then unregistered — come
  // after, and `videoIdle` re-registers for itself.
  const vid = await page.evaluate(() => window.__appRig.videoProbe(24, false));
  log(
    `VIDEO as-is: frames=${vid.frames} covered=${vid.covered} produced=${vid.produced} ` +
      `topMinusBottom=${vid.topMinusBottom.toFixed(1)} distinctCentreColours=${vid.distinctCentreColours}`,
  );

  // WITNESS TWO, at a different layer: the window as the OS presented it,
  // sampled at the SAME COORDINATES as the readback. Two witnesses looking at
  // different places cannot disagree, and disagreement is the whole mechanism
  // — the spike's 15%-defect was caught by capturePage reading ground colour
  // at the surface centre while a readback read surface colour there. It runs
  // HERE, before the control arms, so it sees the shipping orientation.
  const windowWitness = await app.evaluate(
    async ({ BrowserWindow }, { taps, canvas }) => {
      const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
      const size = img.getSize();
      const buf = img.toBitmap(); // BGRA, `size` wide
      // The capture's own resolution, never an assumed dpr.
      const sx = size.width / canvas.width;
      const sy = size.height / canvas.height;
      const modal = (px, py) => {
        const counts = new Map();
        for (let y = Math.round(py * sy) - 4; y <= Math.round(py * sy) + 4; y++) {
          for (let x = Math.round(px * sx) - 16; x <= Math.round(px * sx) + 16; x++) {
            if (x < 0 || y < 0 || x >= size.width || y >= size.height) continue;
            const i = (y * size.width + x) * 4;
            const key = (buf[i + 2] << 16) | (buf[i + 1] << 8) | buf[i];
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
        let best = 0;
        let bestN = -1;
        for (const [k, n] of counts) {
          if (n > bestN) {
            best = k;
            bestN = n;
          }
        }
        return [(best >>> 16) & 0xff, (best >>> 8) & 0xff, best & 0xff];
      };
      const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const top = modal(taps.top.x, taps.top.y);
      const bottom = modal(taps.bottom.x, taps.bottom.y);
      return { size, top, bottom, topMinusBottom: lum(top) - lum(bottom) };
    },
    { taps: vid.taps, canvas: vid.canvas },
  );
  log(
    `VIDEO window witness (${windowWitness.size.width}x${windowWitness.size.height}): ` +
      `top=${JSON.stringify(windowWitness.top)} bottom=${JSON.stringify(windowWitness.bottom)} ` +
      `topMinusBottom=${windowWitness.topMinusBottom.toFixed(1)}`,
  );
  fs.writeFileSync(path.join(shotDir, "s7-video-composited.png"), await page.screenshot());

  // --- the two control arms, which both leave the board in a wrong state ----
  const vidFlipped = await page.evaluate(() => window.__appRig.videoProbe(12, true));
  // THE NULL CONTROL: every grade above, run with NO source registered. A
  // witness that cannot come out negative is not measuring anything, and the
  // compositor clears its target on every dirty frame, so an absent surface
  // has somewhere honest to read as absent.
  const vidNone = await page.evaluate(() => window.__appRig.videoProbe(8, false, false));
  log(
    `VIDEO flipped (control): topMinusBottom=${vidFlipped.topMinusBottom.toFixed(1)} ` +
      `covered=${vidFlipped.covered}/${vidFlipped.frames}`,
  );
  log(
    `VIDEO unregistered (null control): covered=${vidNone.covered}/${vidNone.frames} ` +
      `topMinusBottom=${vidNone.topMinusBottom.toFixed(1)} sample=${JSON.stringify(vidNone.sample)}`,
  );

  check(vid.produced > 1, `the fixture really produced frames (${vid.produced})`);
  // THE COVERAGE EXIT. The spike's 15%-defect was invisible to any single
  // witness; this is witness one, at one coordinate, every painted frame.
  check(
    vid.covered === vid.frames,
    `EXIT: the live surface composites on 100% of painted frames (${vid.covered}/${vid.frames})`,
  );
  check(
    vidNone.covered === 0,
    `and with NO source registered it composites on NONE (${vidNone.covered}/${vidNone.frames}) — the coverage grade can fail`,
  );
  // LIVENESS: a surface frozen on its first frame would score 100% coverage.
  // The colour-cycling centre band is what tells the two apart.
  check(
    vid.distinctCentreColours > 1,
    `and it is LIVE, not one frame held forever (${vid.distinctCentreColours} distinct centre colours across the run)`,
  );
  // ORIENTATION, measured both ways rather than inherited.
  check(
    vid.topMinusBottom > 20,
    `EXIT: the surface is the right way up — the fixture's bright band is on top (${vid.topMinusBottom.toFixed(1)})`,
  );
  check(
    vidFlipped.topMinusBottom < -20,
    `and flipping inverts it (${vidFlipped.topMinusBottom.toFixed(1)}) — the arms DISAGREE, so this measures the orientation`,
  );

  check(
    windowWitness.topMinusBottom > 20,
    `WITNESS TWO: the window capture AGREES at the same coordinates — bright band on top there too (${windowWitness.topMinusBottom.toFixed(1)} vs the readback's ${vid.topMinusBottom.toFixed(1)})`,
  );

  // Idle-zero with the surface PAUSED — the other half of the S7 exit.
  const vidIdle = await page.evaluate(() => window.__appRig.videoIdle(2500));
  log(
    `VIDEO idle (paused): frames=${vidIdle.frames} submits=${vidIdle.submits} registered=${vidIdle.registered}`,
  );
  check(vidIdle.frames > 60, `the idle window ran frames (${vidIdle.frames})`);
  check(
    vidIdle.registered === 1,
    `the surface is still REGISTERED across the idle window (${vidIdle.registered}) — idle-zero on an absent source proves nothing`,
  );
  check(
    vidIdle.submits === 0,
    `EXIT: a PAUSED live surface costs 0 submits (${vidIdle.submits}) — idle-zero survives the video kind`,
  );

  // --- S8: external-frame arrival as a REAL dirty source ---------------------
  //
  // Everything above marks `"video"` dirt by hand, on purpose — that is what
  // lets composites outrun productions 3:1 while coverage is graded. So the
  // wiring design-012 §4 asks for had never run. This arm marks NOTHING: the
  // only thing that can wake the compositor in its live window is the source's
  // own arrival hook. Two arms over ONE registration, and they must disagree —
  // a single arm cannot tell "arrival wakes it" from "something else was
  // waking it all along".
  const arrival = await page.evaluate(() => window.__appRig.videoArrival(1500));
  log(
    `VIDEO arrival: produced=${arrival.produced} live=${arrival.liveFrames}f/${arrival.liveSubmits}s ` +
      `paused=${arrival.pausedFrames}f/${arrival.pausedSubmits}s registered=${arrival.registered}`,
  );
  check(arrival.produced > 0, `the fixture produced frames in the live window (${arrival.produced})`);
  check(
    arrival.registered === 1,
    `ONE registration spans both arms (${arrival.registered}) — the difference is production, not membership`,
  );
  check(
    arrival.liveSubmits > 0,
    `EXIT: a PRODUCING surface wakes the compositor BY ITSELF — ${arrival.liveSubmits} submits over ${arrival.liveFrames} frames with nothing hand-marking dirt`,
  );
  check(
    arrival.pausedSubmits === 0,
    `and a PAUSED one returns to idle-zero (${arrival.pausedSubmits} submits over ${arrival.pausedFrames} frames) — the arms DISAGREE, so this measures arrival`,
  );
  check(
    arrival.liveSubmits <= arrival.produced + 2,
    `and it composites PER ARRIVAL, not continuously (${arrival.liveSubmits} submits for ${arrival.produced} productions across ${arrival.liveFrames} frames) — a stuck-awake compositor would also pass the line above`,
  );

  await page.evaluate(() => window.__appRig.teardown());
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await app.close().catch(() => {});
}

console.log(
  failures.length === 0
    ? "[gl-leg] ALL PASS"
    : `[gl-leg] ${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
