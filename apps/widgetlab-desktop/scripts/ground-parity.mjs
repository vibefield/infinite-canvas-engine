/**
 * The S1 exit witness (design-012 §9 S1): composited boot renders ground alone,
 * pixel-compared against the stratified render of the same ground config, and
 * idle costs zero submits.
 *
 * It launches Electron on `dist/ground-parity.html` (flags on) and runs, in ONE
 * window so geometry and DPR cannot drift between arms:
 *
 *   A1 = stratified   →   A2 = stratified   →   B = composited
 *
 * A1-vs-A2 is the CONTROL. Without it, "A1 and B differ by 0.4%" is a confident
 * number about nothing: it could be the profile, or it could be what any two
 * renders of this scene score. The control establishes the floor; the A1-vs-B
 * number is only meaningful against it.
 *
 * It also refuses to grade a blank. Two empty canvases compare perfectly equal,
 * so every capture must show real content (distinct colours and ink pixels)
 * before any diff is believed.
 *
 * Run: `pnpm --filter widgetlab-desktop parity`
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const IDLE_MS = 4000;

const log = (m) => console.log(`[parity] ${m}`);
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
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("[rig]") || t.startsWith("[ice]")) console.log(`  [renderer] ${t}`);
  });
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));

  // Straight to the rig page — it mounts ground itself, with no product around
  // it, so what the canvas holds is ground and nothing else.
  await page.goto(`file://${path.join(appDir, "dist", "ground-parity.html")}`);
  await page.waitForFunction(() => window.__groundParityRig !== undefined, null, { timeout: 30_000 });
  log("rig loaded");

  fs.mkdirSync(shotDir, { recursive: true });

  /**
   * WITNESS 2, at a different layer: the window as the compositor actually
   * presented it, captured in the MAIN process as a raw BGRA bitmap (no PNG
   * decode, no renderer involvement). Kept because witness 1 reads the canvas
   * through the renderer's own snapshot path — and a single witness can agree
   * with itself about a defect. The bitmaps stay in the main process; only
   * numbers cross the wire.
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

  // NOTE the leading parameter: electronApplication.evaluate hands the Electron
  // MODULE as the first argument and the caller's value as the second.
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

  const runArm = async (variant, key, shot) => {
    const stats = await page.evaluate((v) => window.__groundParityRig.run(v), variant);
    const win = await captureWindow(key);
    if (shot) fs.writeFileSync(path.join(shotDir, shot), await page.screenshot());
    const injected =
      stats.coreFeatures === undefined
        ? ""
        : ` ourDeviceCoreFeatures=${stats.coreFeatures} adopted=${stats.deviceAdopted}`;
    log(
      `${variant}: ${stats.width}x${stats.height} redraws=${stats.redraws} available=${stats.available} distinctColors=${stats.distinctColors} ink=${stats.inkPixels} hash=${stats.hash} adoptedHasCoreFeatures=${stats.adoptedHasCoreFeatures}${injected}`,
    );
    log(`  window capture: ${win.width}x${win.height} distinct=${win.distinct} ink=${win.ink}`);
    return { ...stats, window: win };
  };

  const a1 = await runArm("stratified", "a1", "s1-ground-stratified.png");
  const a2 = await runArm("stratified", "a2", null);
  const b = await runArm("composited", "b", "s1-ground-composited.png");

  // --- the blank guard: a pixel test that compares two empty images passes ---
  for (const s of [a1, a2, b]) {
    check(s.available === true, `${s.variant}[${s.id}]: the ground layer reported itself available`);
    check(s.redraws > 0, `${s.variant}[${s.id}]: ground actually painted (redraws=${s.redraws})`);
    check(
      s.distinctColors > 1,
      `${s.variant}[${s.id}]: the capture is NOT a flat fill (distinctColors=${s.distinctColors})`,
    );
    check(
      s.inkPixels > s.width * s.height * 0.001,
      `${s.variant}[${s.id}]: the capture has real ground content (ink=${s.inkPixels})`,
    );
    check(
      s.window.ink > s.window.total * 0.001,
      `${s.variant}[${s.id}]: the WINDOW capture agrees there is content (ink=${s.window.ink})`,
    );
  }

  // --- adoption: the composited arm must be on OUR device -------------------
  check(b.deviceAdopted === true, "composited: three ADOPTED the app-owned device");
  check(
    b.coreFeatures === true && b.adoptedHasCoreFeatures === true,
    "composited: the adopted device has core-features-and-limits (three is NOT in compatibilityMode)",
  );
  // The two paths' devices really are different, and the pixel result above is
  // therefore a finding rather than a tautology. Reported, not asserted: if
  // three's own device also carried core features, the parity result would be
  // less interesting, and that is worth SEEING rather than assuming either way.
  log(
    `device delta — stratified core-features=${a1.adoptedHasCoreFeatures}, composited core-features=${b.adoptedHasCoreFeatures}`,
  );

  // --- the control, then the question --------------------------------------
  const control = await page.evaluate(([x, y]) => window.__groundParityRig.diff(x, y), [a1.id, a2.id]);
  const compare = await page.evaluate(([x, y]) => window.__groundParityRig.diff(x, y), [a1.id, b.id]);
  log(
    `CONTROL stratified-vs-stratified: ${control.differingPixels}/${control.totalPixels} px ` +
      `(${control.differingPct.toFixed(4)}%) maxDelta=${control.maxChannelDelta} mean=${control.meanAbsDelta.toFixed(5)}`,
  );
  log(
    `COMPARE stratified-vs-composited: ${compare.differingPixels}/${compare.totalPixels} px ` +
      `(${compare.differingPct.toFixed(4)}%) maxDelta=${compare.maxChannelDelta} mean=${compare.meanAbsDelta.toFixed(5)}`,
  );

  check(control.differingPixels === 0, "CONTROL: two stratified renders are bit-identical (noise floor = 0)");
  // The exit as design-012 §9 states it. If this fails while the control is
  // clean, the difference is REAL and the number above is the finding — most
  // likely MSAA, which three disables on its own compatibility device and
  // keeps on our core one.
  check(
    compare.differingPixels === 0,
    `EXIT: composited ground is pixel-identical to stratified ground (${compare.differingPct.toFixed(4)}% differ)`,
  );

  // Witness 2, same two questions, at the window layer.
  const winControl = await diffWindows("a1", "a2");
  const winCompare = await diffWindows("a1", "b");
  log(`CONTROL (window): ${winControl.differing}/${winControl.total} px maxDelta=${winControl.maxDelta}`);
  log(`COMPARE (window): ${winCompare.differing}/${winCompare.total} px maxDelta=${winCompare.maxDelta}`);
  check(winControl.differing === 0, "CONTROL (window): two stratified window captures are identical");
  check(winCompare.differing === 0, "EXIT (window): composited window is identical to stratified");

  // --- idle-zero, instrumented at queue.submit -----------------------------
  const idle = await page.evaluate((ms) => window.__groundParityRig.idleSubmits(ms), IDLE_MS);
  log(`IDLE ${IDLE_MS}ms: submits=${idle.submits} frames=${idle.frames} groundRedraws=${idle.redraws}`);
  check(idle.frames > 100, `idle window actually ran frames (${idle.frames} in ${IDLE_MS}ms)`);
  check(idle.submits === 0, `EXIT: 0 submits across ${IDLE_MS}ms of idle (measured at queue.submit)`);
  check(idle.redraws === 0, "idle: ground drew zero frames (its own dirty union held)");

  await page.evaluate(() => window.__groundParityRig.teardown());
} catch (err) {
  fail(err);
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await app.close().catch(() => {});
}

function fail(_e) {
  /* diagnostics already printed */
}

console.log(
  failures.length === 0
    ? "[parity] ALL PASS"
    : `[parity] ${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
