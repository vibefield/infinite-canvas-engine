/**
 * THE ZOOM-DRIFT DRIVER — open item (a) of the design-012 M18 fix wave.
 *
 * Launches the real app (which sets the `CanvasDrawElement` switches before
 * `app.whenReady`), navigates a window to the zoom-drift page, and grades:
 *
 *   A1  the element's actual RASTER EXTENT, measured into an oversized probe
 *       texture — swept over the zoom axis and over the L1 bitmap scale, so
 *       "which scale governs" is a measurement and not the ledger's guess;
 *   A2  whether a card whose LIVE zoom drifted to just under 2× its band
 *       writes past its atlas slot, into the gutters and into a neighbour —
 *       run N times, with the medians reported;
 *   A2c the SAME path with the live zoom sitting AT the band. The A-vs-A
 *       control: a contamination count means nothing until this scores zero.
 *
 * THE LIVENESS GUARD IS NOT OPTIONAL. This host's smokes are software-rendered
 * and the GL bind flaps per launch; a dead world keeps its DOM, mounts nothing,
 * and every pixel count reads a clean zero. So card A's OWN slot is graded for
 * ink and colour variety first, and a launch that fails that is RELAUNCHED (up
 * to 3) rather than graded.
 *
 * Run: `pnpm --filter widgetlab-desktop zoom-drift`
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const RUNS = Number(process.env.DRIFT_RUNS ?? "5");
/** Just under the `isOutOfBand` threshold of 2 — drifted, and NOT re-banded. */
const DRIFT = Number(process.env.DRIFT ?? "1.9");
const MAX_LAUNCHES = 3;

const log = (m) => console.log(`[drift] ${m}`);
const failures = [];
const check = (ok, what) => {
  log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

/** The rig's card, in device px at an unscaled placement — the A1 reference. */
const CARD_DEVICE_W = (dpr) => 80 * dpr;
const CARD_DEVICE_H = (dpr) => 48 * dpr;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** One full measurement pass in one window. Throws on a dead-world launch. */
async function measureOnce() {
  const app = await _electron.launch({
    executablePath: require("electron"),
    args: [appDir],
    env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" },
  });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") console.error(`  [renderer:console] ${m.text()}`);
    });

    await page.goto(`file://${path.join(appDir, "dist", "zoom-drift.html")}`);
    await page.waitForFunction(() => window.__zoomDrift !== undefined, null, { timeout: 30_000 });
    await page.evaluate(() => window.__zoomDrift.ready);

    const host = await page.evaluate(() => window.__zoomDrift.host());
    if (host.device !== true) throw new Error("dead world: no compositor device");
    if (host.hostLaidOut !== true) throw new Error("dead world: layoutsubtree did not lay out");

    const raster = await page.evaluate(() => window.__zoomDrift.rasterExtent());
    const overflow = await page.evaluate(() => window.__zoomDrift.overflowDestination());
    const bandMath = await page.evaluate((d) => window.__zoomDrift.bandMath(d), DRIFT);

    const control = [];
    const drifted = [];
    const boundary = [];
    for (let i = 0; i < RUNS; i++) {
      control.push(await page.evaluate(() => window.__zoomDrift.contamination(1)));
      drifted.push(await page.evaluate((d) => window.__zoomDrift.contamination(d), DRIFT));
      // Exactly 2× the band — `isOutOfBand` tests `ratio > 2`, so this is the
      // LAST zoom the hysteresis still holds, and the worst case inside the
      // ladder rather than a number picked for being alarming.
      boundary.push(await page.evaluate(() => window.__zoomDrift.contamination(2)));
    }

    // THE LIVENESS GUARD. A blank atlas contaminates nothing.
    const alive = [...control, ...drifted, ...boundary].every(
      (r) => r.slotAInk > 0 && r.slotADistinct > 2,
    );
    if (!alive) throw new Error("dead world: card A's own slot carries no content");

    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, "zoom-drift.png"), await page.screenshot());
    return { host, raster, overflow, bandMath, control, drifted, boundary };
  } finally {
    await app.close().catch(() => {});
  }
}

let out = null;
let lastError = null;
for (let attempt = 1; attempt <= MAX_LAUNCHES; attempt++) {
  try {
    out = await measureOnce();
    break;
  } catch (error) {
    lastError = error;
    log(`launch ${attempt}/${MAX_LAUNCHES} unusable — ${error.message}`);
  }
}

if (out === null) {
  console.error(lastError);
  failures.push(`no usable launch in ${MAX_LAUNCHES}: ${lastError?.message}`);
} else {
  const { host, raster, overflow, bandMath, control, drifted, boundary } = out;
  log(
    `host: Electron ${host.electron} / Chromium ${host.chrome} · dpr ${host.dpr} · ` +
      `L1 bitmap ${host.l1Bitmap.width}x${host.l1Bitmap.height} · maxTex ${host.maxTextureDimension2D}`,
  );

  // ── A1 — the raster extent ────────────────────────────────────────────────
  log("A1 — element raster extent, measured into a 1024² probe:");
  for (const r of raster) {
    log(
      `  ${r.label.padEnd(22)} css ${r.cssW}x${r.cssH} bitmap×${r.bitmapScale} → ` +
        `bbox ${r.bbox ? `${r.bbox.x},${r.bbox.y} ${r.bbox.w}x${r.bbox.h}` : "NONE"} ` +
        `scale ${r.scaleX === null ? "—" : `${r.scaleX.toFixed(3)}x${r.scaleY.toFixed(3)}`} ` +
        `written=${r.written} distinct=${r.distinct}` +
        `${r.validationError ? ` ERR ${r.validationError.slice(0, 120)}` : ""}`,
    );
  }
  const landed = raster.filter((r) => r.bbox !== null);
  check(landed.length === raster.length, `every A1 row rasterised something (${landed.length}/${raster.length})`);
  const dprRows = raster.filter((r) => r.bitmapScale === host.dpr && r.bbox !== null);
  const tracksCss =
    dprRows.length > 1 && dprRows.every((r) => Math.abs(r.scaleX - dprRows[0].scaleX) < 0.02);
  check(
    tracksCss,
    `the raster scale is CONSTANT across the zoom axis (${dprRows.map((r) => r.scaleX?.toFixed(3)).join(", ")})`,
  );
  if (tracksCss) {
    log(`  ⇒ raster = CSS box × ${dprRows[0].scaleX.toFixed(3)} (dpr is ${host.dpr})`);
  }
  const scaled = raster.find((r) => r.label === "band box + 1.9 scale");
  if (scaled?.bbox) {
    const baked = Math.abs(scaled.bbox.w - CARD_DEVICE_W(host.dpr) * 1.9) < 4;
    log(
      `  transform scale ${baked ? "IS" : "is NOT"} baked into the raster — ` +
        `a band-sized box under a 1.9× placement matrix rasterised ${scaled.bbox.w}x${scaled.bbox.h} ` +
        `(unscaled reference ${CARD_DEVICE_W(host.dpr)}x${CARD_DEVICE_H(host.dpr)})`,
    );
  }

  // ── A1b — what the platform does when the raster overruns the destination ──
  log("A1b — raster larger than the destination texture (the `clampToPage` shape):");
  for (const r of overflow) {
    log(
      `  ${r.label.padEnd(34)} → written=${r.written} ` +
        `bbox ${r.bbox ? `${r.bbox.x},${r.bbox.y} ${r.bbox.w}x${r.bbox.h}` : "NONE"}` +
        `${r.validationError ? ` ERR ${r.validationError.slice(0, 160)}` : " no validation error"}`,
    );
  }

  // ── A2 — the control, then the claim ─────────────────────────────────────
  log(
    `A2 band math at drift ${DRIFT}: band ${bandMath.band} · live zoom ${bandMath.liveZoom} · ` +
      `reBanded=${bandMath.reBanded} · slot ${bandMath.slotW}x${bandMath.slotH} · ` +
      `predicted raster ${bandMath.predictedRasterW}x${bandMath.predictedRasterH}`,
  );
  check(bandMath.reBanded === false, `live zoom ${bandMath.liveZoom} does NOT cross the re-band threshold`);

  const report = (label, runs) => {
    const esc = runs.map((r) => r.escaped);
    const nb = runs.map((r) => r.intoNeighbour);
    const gut = runs.map((r) => r.intoGutter);
    const r0 = runs[0];
    log(
      `  ${label}: slotA ${r0.slotA.w}x${r0.slotA.h} @ ${r0.slotA.x},${r0.slotA.y} · ` +
        `slotB ${r0.slotB.w}x${r0.slotB.h} @ ${r0.slotB.x},${r0.slotB.y} · ` +
        `host CSS ${r0.hostACss.w}x${r0.hostACss.h} · reBanded=${r0.reBanded} · ` +
        `paints during drift ${r0.paintsDuringDrift}`,
    );
    log(
      `  ${label}: slotA ink=${r0.slotAInk}/${r0.slotA.w * r0.slotA.h} distinct=${r0.slotADistinct} · ` +
        `copies=${r0.copies} refused=${r0.refused}` +
        `${r0.copyError ? ` copyError=${r0.copyError.slice(0, 120)}` : ""}` +
        `${r0.validationError ? ` VALIDATION=${r0.validationError.slice(0, 160)}` : ""}`,
    );
    log(
      `  ${label}: escaped median ${median(esc)} (${esc.join("/")}) · ` +
        `into neighbour median ${median(nb)} (${nb.join("/")}) · ` +
        `into gutter median ${median(gut)} (${gut.join("/")}) · ` +
        `escaped bbox ${r0.escapedBbox ? `${r0.escapedBbox.x},${r0.escapedBbox.y} ${r0.escapedBbox.w}x${r0.escapedBbox.h}` : "NONE"}`,
    );
    return { escaped: median(esc), neighbour: median(nb), gutter: median(gut) };
  };

  const c = report("CONTROL (zoom == band)", control);
  const d = report(`DRIFT   (zoom == ${DRIFT}× band)`, drifted);
  const b = report("BOUNDARY(zoom == 2.0× band)", boundary);

  check(c.escaped === 0, `CONTROL: zero pixels escape card A's slot (median ${c.escaped})`);
  check(
    b.escaped >= d.escaped,
    `the worst case is AT the hysteresis boundary (2.0×: ${b.escaped} px ≥ ${DRIFT}×: ${d.escaped} px)`,
  );
  log(
    d.escaped > 0
      ? `VERDICT: CONFIRMED — a drifted card writes ${d.escaped} px past its slot ` +
          `(${d.neighbour} of them into the neighbour's, ${d.gutter} into the gutter ring)`
      : "VERDICT: REFUTED — a drifted card writes 0 px past its slot; " +
          "the raster is pinned by something other than the CSS box",
  );

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(
    path.join(shotDir, "zoom-drift.json"),
    `${JSON.stringify(out, null, 2)}\n`,
  );
}

console.log(
  failures.length === 0
    ? "[drift] ALL CHECKS PASS — read the VERDICT line for the answer"
    : `[drift] ${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
