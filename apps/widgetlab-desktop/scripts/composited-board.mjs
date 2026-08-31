/**
 * The S2 exit (design-012 §9 S2): a static all-composited board pixel-compares
 * against the stratified render of the same board; the board costs 0 paint
 * events/s and 0 submits while idle; the atlas reports its waste.
 *
 * Arms run in ONE window so geometry and DPR cannot drift between them:
 *
 *   A1 = stratified  →  A2 = stratified  →  B = composited
 *
 * A1-vs-A2 is the CONTROL. "A1 and B differ by 0.3 %" is a confident number
 * about nothing without knowing what two identical renders score; the control
 * establishes the floor and only then is the compare a finding.
 *
 * Two witnesses, because a single one can agree with itself about a defect:
 * the window capture (main process, raw BGRA) and the compositor's own colour
 * target read straight off the GPU. Every capture is content-guarded first —
 * two blanks compare perfectly equal.
 *
 * Run: `pnpm --filter widgetlab-desktop board`
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const CARDS = Number(process.env.BOARD_CARDS ?? "12");
const IDLE_MS = 4000;

const log = (m) => console.log(`[board] ${m}`);
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

let atlas = null;
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().startsWith("[ice]")) console.log(`  [renderer] ${m.text()}`);
  });

  await page.goto(`file://${path.join(appDir, "dist", "composited-board.html")}`);
  await page.waitForFunction(() => window.__boardRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__boardRig.ready);
  log("rig loaded");
  fs.mkdirSync(shotDir, { recursive: true });

  /**
   * WITNESS 1: the window as the OS compositor presented it, captured in the
   * MAIN process as a raw bitmap — no PNG decode, no renderer involvement.
   * Bitmaps stay in the main process; only numbers cross the wire.
   */
  const captureWindow = (key) =>
    app.evaluate(async ({ BrowserWindow }, k) => {
      const win = BrowserWindow.getAllWindows()[0];
      const img = await win.webContents.capturePage();
      globalThis.__shots ??= {};
      const buf = img.toBitmap();
      globalThis.__shots[k] = buf;
      const size = img.getSize();
      const counts = new Map();
      for (let i = 0; i < buf.length; i += 4) {
        const px = (buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3];
        counts.set(px, (counts.get(px) ?? 0) + 1);
      }
      let mode = 0;
      for (const n of counts.values()) if (n > mode) mode = n;
      const total = buf.length / 4;
      return { width: size.width, height: size.height, distinct: counts.size, ink: total - mode, total };
    }, key);

  const diffWindows = (ka, kb) =>
    app.evaluate((_electron, [x, y]) => {
      const a = globalThis.__shots[x];
      const b = globalThis.__shots[y];
      if (a.length !== b.length) throw new Error("window capture size mismatch");
      let differing = 0;
      let maxDelta = 0;
      for (let i = 0; i < a.length; i += 4) {
        let d = 0;
        for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
        if (d > 0) differing++;
        if (d > maxDelta) maxDelta = d;
      }
      return { differing, maxDelta, total: a.length / 4 };
    }, [ka, kb]);

  const runArm = async (variant, key, shot, text = true) => {
    const s = await page.evaluate(
      ([v, n, t]) => window.__boardRig.run(v, n, t),
      [variant, CARDS, text],
    );
    const win = await captureWindow(key);
    if (shot) fs.writeFileSync(path.join(shotDir, shot), await page.screenshot());
    log(
      `${variant}: cards=${s.cards} canvasHosts=${s.canvasHosts} sources=${s.sources} ` +
        `writebacks=${s.writebackWrites} composites=${s.composites} copies=${s.copies} ` +
        `pending=${s.pendingCopies} refused=${s.refusedCopies}`,
    );
    log(
      `  compositor target: ${s.width}x${s.height} distinct=${s.compositorDistinct} ink=${s.compositorInk}`,
    );
    log(`  window capture: ${win.width}x${win.height} distinct=${win.distinct} ink=${win.ink}`);
    return { ...s, window: win };
  };

  // PASS 1 — a text-free board. Geometry, colour and blending have no fidelity
  // licence, so this is the STRICT exit.
  const n1 = await runArm("stratified", "n1", "s2-board-notext-stratified.png", false);
  const n2 = await runArm("stratified", "n2", null, false);
  const nb = await runArm("composited", "nb", "s2-board-notext-composited.png", false);

  // PASS 2 — the same board WITH text, which measures the accepted seam.
  const a1 = await runArm("stratified", "a1", "s2-board-stratified.png");
  const a2 = await runArm("stratified", "a2", null);
  const b = await runArm("composited", "b", "s2-board-composited.png");

  // --- the board is really composited ---------------------------------------
  check(a1.canvasHosts === 0, "stratified: no host is canvas-side");
  check(a1.sources === 0, "stratified: nothing is registered as a compositor source");
  check(b.canvasHosts === CARDS, `composited: all ${CARDS} hosts are immediate canvas children (${b.canvasHosts})`);
  check(b.sources === CARDS, `composited: all ${CARDS} hosts registered as dom sources (${b.sources})`);
  check(b.copies >= CARDS, `composited: every card was copied into its atlas slot (${b.copies} copies)`);
  check(b.pendingCopies === 0, `composited: no copy is still owed (${b.pendingCopies})`);
  check(b.writebackWrites >= CARDS, `composited: every host got an absolute placement (${b.writebackWrites})`);
  // A refused copy is the one-frame warm-up after a promotion (no paint record
  // yet). Bounded: it must not keep growing, or the retry is a spin.
  check(
    b.refusedCopies <= CARDS * 3,
    `composited: refused copies stay a warm-up, not a spin (${b.refusedCopies} for ${CARDS} cards)`,
  );

  // --- the blank guard: a pixel test comparing two blanks passes -------------
  for (const s of [a1, a2, b]) {
    check(
      s.window.distinct > 4,
      `${s.variant}: the window capture is not a flat fill (distinct=${s.window.distinct})`,
    );
    check(
      s.window.ink > s.window.total * 0.005,
      `${s.variant}: the window capture has real board content (ink=${s.window.ink})`,
    );
  }
  // Witness 2 must be blank in the stratified arm (nothing is composited) and
  // full in the composited arm. That asymmetry is itself a proof the arms are
  // really different programs and not the same one twice.
  check(a1.compositorInk === 0, `stratified: the compositor drew nothing (ink=${a1.compositorInk})`);
  check(
    b.compositorInk > b.compositorTotal * 0.005 && b.compositorDistinct > 4,
    `composited: the compositor target carries the board (distinct=${b.compositorDistinct} ink=${b.compositorInk})`,
  );

  // --- the control, then the two questions ----------------------------------
  const pct = (d) => ((d.differing / d.total) * 100).toFixed(4);

  const noTextControl = await diffWindows("n1", "n2");
  const noTextCompare = await diffWindows("n1", "nb");
  log(`CONTROL  no-text stratified-vs-stratified: ${noTextControl.differing}/${noTextControl.total} px (${pct(noTextControl)}%) maxDelta=${noTextControl.maxDelta}`);
  log(`COMPARE  no-text stratified-vs-composited: ${noTextCompare.differing}/${noTextCompare.total} px (${pct(noTextCompare)}%) maxDelta=${noTextCompare.maxDelta}`);
  check(noTextControl.differing === 0, "CONTROL: two stratified renders are bit-identical (noise floor = 0)");
  check(
    noTextCompare.differing === 0,
    `EXIT: a text-free composited board is PIXEL-IDENTICAL to its stratified twin (${pct(noTextCompare)}% differ, maxDelta=${noTextCompare.maxDelta})`,
  );

  // The accepted seam, MEASURED rather than asserted away (design-012 §5: the
  // privacy-preserving paint strips subpixel AA, so composited glyphs are
  // grayscale-AA). Reported as a number, and bounded so a real regression
  // cannot hide behind the word "text".
  const control = await diffWindows("a1", "a2");
  const compare = await diffWindows("a1", "b");
  log(`CONTROL  with-text stratified-vs-stratified: ${control.differing}/${control.total} px (${pct(control)}%) maxDelta=${control.maxDelta}`);
  log(`COMPARE  with-text stratified-vs-composited: ${compare.differing}/${compare.total} px (${pct(compare)}%) maxDelta=${compare.maxDelta}`);
  check(control.differing === 0, "CONTROL (with text): two stratified renders are bit-identical");
  check(
    compare.differing > 0,
    `the text seam is REAL and this rig can see it (${compare.differing} px) — a zero here would mean the arms are not actually different`,
  );
  check(
    compare.differing < compare.total * 0.005,
    `TEXT SEAM: glyph AA only — under 0.5% of the frame (${pct(compare)}%, ${compare.differing} px)`,
  );
  check(
    compare.maxDelta <= 32,
    `TEXT SEAM: shallow, as antialiasing is (maxDelta=${compare.maxDelta}); a geometry or colour error would saturate`,
  );

  // --- the SDF, against an oracle that is not a copy of the shader ----------
  // A rounded rect's area is w·h − (4−π)r². Summing composited alpha gives the
  // covered area including antialiased partial coverage, so the shader's
  // rounding is checked against MATHEMATICS rather than a second transcription
  // of itself. The parity board above runs radius 0 (a DOM card's own
  // border-radius lives in its atlas pixels), so without this the SDF path
  // would ship unvalidated.
  const sharp = await page.evaluate(() => window.__boardRig.roundedArea(0, 1));
  const round = await page.evaluate(() => window.__boardRig.roundedArea(16, 1));
  const faded = await page.evaluate(() => window.__boardRig.roundedArea(16, 0.5));
  const err = (m) => Math.abs(m.coveredArea - m.expectedArea) / m.expectedArea;
  for (const [name, m] of [["radius 0", sharp], ["radius 16", round], ["radius 16 @ opacity 0.5", faded]]) {
    log(
      `SDF ${name}: covered=${m.coveredArea.toFixed(0)} px expected=${m.expectedArea.toFixed(0)} px ` +
        `(${(err(m) * 100).toFixed(3)}% off, r=${m.radiusDevice} device px)`,
    );
  }
  check(err(sharp) < 0.002, `SDF: a zero radius covers the full rect (${(err(sharp) * 100).toFixed(3)}% off)`);
  check(
    err(round) < 0.01,
    `SDF: a 16px radius removes exactly (4−π)r² per corner (${(err(round) * 100).toFixed(3)}% off)`,
  );
  // The rounding must actually happen — an ignored radius would still pass an
  // area check that expected no rounding, so compare the two arms directly.
  check(
    round.coveredArea < sharp.coveredArea * 0.999,
    `SDF: the radius really removes area (${sharp.coveredArea.toFixed(0)} → ${round.coveredArea.toFixed(0)} px)`,
  );
  check(
    err(faded) < 0.01,
    `BLEND: opacity scales premultiplied alpha linearly (${(err(faded) * 100).toFixed(3)}% off half the area)`,
  );

  // --- idle: 0 paints/s, 0 submits ------------------------------------------
  const idle = await page.evaluate((ms) => window.__boardRig.idle(ms), IDLE_MS);
  log(
    `IDLE ${IDLE_MS}ms: frames=${idle.frames} submits=${idle.submits} paintEvents=${idle.paintEvents} quiet=${idle.quiet}`,
  );
  check(idle.frames > 100, `idle window actually ran frames (${idle.frames})`);
  check(idle.submits === 0, `EXIT: 0 submits across ${IDLE_MS}ms idle, measured at queue.submit (${idle.submits})`);
  check(idle.paintEvents === 0, `EXIT: a static composited board costs 0 paint events (${idle.paintEvents})`);

  // --- the waste instrument (Q3's named deliverable) ------------------------
  atlas = await page.evaluate(() => window.__boardRig.atlas());
  log(
    `ATLAS: pages=${atlas.pages} slots=${atlas.slots} ` +
      `packingWaste=${atlas.packingWastePct.toFixed(2)}% allocationWaste=${atlas.allocationWastePct.toFixed(2)}% ` +
      `occupied=${(atlas.occupiedBytes / 1e6).toFixed(2)}MB allocated=${(atlas.allocatedBytes / 1e6).toFixed(2)}MB`,
  );
  check(atlas.slots === CARDS, `atlas holds one slot per card (${atlas.slots})`);
  check(atlas.pages >= 1, `atlas opened at least one page (${atlas.pages})`);
  // Reported, and bounded against the spike's uniform-card figure (19.5 %).
  check(
    atlas.packingWastePct < 20,
    `atlas packing waste is at or under the spike's 19.5% gutter figure (${atlas.packingWastePct.toFixed(2)}%)`,
  );

  await page.evaluate(() => window.__boardRig.teardown());
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await app.close().catch(() => {});
}

console.log(
  failures.length === 0
    ? "[board] ALL PASS"
    : `[board] ${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
