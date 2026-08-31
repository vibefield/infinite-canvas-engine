/**
 * GATE ZERO for design-012 S2 (plan §6, S0 finding 5).
 *
 * The direct-copy signature in the evidence — `queue.copyElementImageToTexture(
 * {source}, {destination:{texture}})`, arity 2 — was recovered on Chromium 152.
 * This app pins Electron 43.1.1 / Chromium 150. S2 binds the paged atlas
 * allocator to that copy, so the copy has to be proven on THIS Chromium first:
 * the accepted call shape, the pixels, and whether destination `origin` really
 * moves the copy (the atlas addresses its slots with it).
 *
 * Launches the real app (which sets the CanvasDrawElement switches before
 * app.whenReady) and navigates its window to the gate page.
 *
 * Run: `pnpm --filter widgetlab-desktop hic:copy-gate`
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");

const log = (m) => console.log(`[gate0] ${m}`);
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

let out = null;
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.error(`  [renderer:console] ${m.text()}`);
  });

  await page.goto(`file://${path.join(appDir, "hic-copy-gate.html")}`);
  await page.waitForFunction(() => window.__gate !== undefined, null, { timeout: 30_000 });
  out = await page.evaluate(() => window.__gate.run());

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "gate0-direct-copy.png"), await page.screenshot());

  log(`host: Electron ${out.host.electron} / Chromium ${out.host.chrome} · dpr ${out.host.dpr} · card ${out.host.deviceW}x${out.host.deviceH} device px`);
  log(`caps: ${JSON.stringify(out.host.caps)}`);
  log(`layoutsubtree child laid out: ${JSON.stringify(out.host.layoutSubtree)}`);

  // --- Q1: the call shape ---------------------------------------------------
  log(`copyElementImageToTexture.length = ${out.signature.arity}`);
  for (const a of out.signature.attempts) {
    const why = a.throw ?? a.validation ?? "";
    log(`  ${a.ok ? "ACCEPT" : "reject"}  ${a.label}${why ? `  — ${String(why).slice(0, 160)}` : ""}`);
  }
  check(out.host.caps.copyElementImageToTexture === true, "copyElementImageToTexture exists on GPUQueue");
  check(
    out.signature.benchShapeAccepted === true,
    `the BENCH signature ({source},{destination:{texture}}) is accepted on Chromium ${out.host.chrome}`,
  );
  check(out.signature.nestedRefused === true, "a nested descendant is REFUSED (immediate children only)");

  // --- Q2: the pixels -------------------------------------------------------
  if (out.pixels.compare) {
    log(`direct : distinct=${out.pixels.direct.distinct} ink=${out.pixels.direct.ink}/${out.pixels.direct.total} bbox=${JSON.stringify(out.pixels.direct.bbox)}`);
    log(`oracle : distinct=${out.pixels.oracle.distinct} ink=${out.pixels.oracle.ink}/${out.pixels.oracle.total} bbox=${JSON.stringify(out.pixels.oracle.bbox)}`);
    log(`oracle drawElementImage matrix: ${JSON.stringify(out.pixels.oracleMatrix)}`);
    log(`COMPARE direct-vs-oracle: ${JSON.stringify(out.pixels.compare)}`);
    // Content guard FIRST: a blank compares equal to a blank.
    check(out.pixels.directHasContent === true, "the direct copy produced real content (not blank/flat)");
    check(out.pixels.oracleHasContent === true, "the 2D oracle produced real content (not blank/flat)");
    check(out.pixels.copyValidationError === null, `the direct copy raised no validation error (${out.pixels.copyValidationError})`);
    check(out.pixels.compare.differing === 0, `direct copy is PIXEL-IDENTICAL to the 2D route (${out.pixels.compare.differing} px differ, maxDelta=${out.pixels.compare.maxDelta})`);
  }

  // --- Q3: destination origin ----------------------------------------------
  log(`subrect: ${JSON.stringify(out.subrect)}`);
  check(out.subrect.validationError === null && out.subrect.threw === null, "a destination-origin copy is accepted");
  check(
    out.subrect.landedAtOrigin === true,
    `destination origin MOVES the copy (bottom-right quadrant only) — quadrants ${JSON.stringify(out.subrect.quadrants)}`,
  );
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await app.close().catch(() => {});
}

fs.writeFileSync(
  path.join(appDir, "screenshots", "gate0-direct-copy.json"),
  `${JSON.stringify(out, null, 2)}\n`,
);

console.log(
  failures.length === 0
    ? "[gate0] ALL PASS — the direct path is live on this Chromium; S2 builds on it"
    : `[gate0] ${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
