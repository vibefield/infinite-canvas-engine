/**
 * The C1 exit (design-013 §8): pixel parity of a wires/guides scene, the OLD
 * renderer against the NEW ground — one Electron page, headless, both sides
 * drawn from the same world and read back through their own canvases.
 *
 * Three phases, each a preview state (none · dashed · solid) so both branches of
 * the connect preview are measured, and each against an A-vs-A control taken in
 * the same run.
 *
 * Both sides are predicted from the SAME triangles by a CPU raster in the page,
 * each through its own colour chain, and each claim is made on the band where it
 * can be made honestly:
 *   DEEP  — flat 3×3 AND a CSS px clear of every triangle edge, seams included.
 *           Both sides must match their own prediction here. This is the exit.
 *   SEAM  — flat, but within a CSS px of an edge. The new pass matches its
 *           prediction here too; the old one does not, because MSAA samples the
 *           sub-pixel wedge where two stroke quads of a polyline meet.
 *   EDGE  — a boundary in the neighbourhood. Reported, never asserted on.
 * GEOMETRY is asserted separately and side-independently: neither renderer may
 * leave bare a pixel the raster says carries soup. That is the claim the port is
 * actually about, and no colour difference can hide a misplaced triangle from it.
 *
 * The old leg dies at C2, and this rig dies with it.
 *
 * Run: `pnpm --filter widgetlab-desktop parity`.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (m) => console.log(`[parity] ${m}`);
const failures = [];
const check = (ok, what) => { log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures.push(what); };
const band = (b) => `${b.differing.toLocaleString()}/${b.px.toLocaleString()} differ, max ${b.max}, mean ${b.mean}`;

const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`); });
  await page.goto(`file://${path.join(appDir, "dist", "overlay-parity.html")}`);
  await page.waitForFunction(() => window.__parityRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__parityRig.ready);

  const mounted = await page.evaluate(() => window.__parityRig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.oldReady === true, `the OLD ground is up on ${mounted.oldBackend}`);
  check(mounted.newReady === true, "the NEW ground resolved on the app-owned device");
  check(mounted.device[0] === Math.round(mounted.css[0] * mounted.dpr) && mounted.device[1] === Math.round(mounted.css[1] * mounted.dpr),
    `both canvases are ${mounted.device.join("×")} device px at dpr ${mounted.dpr} (${mounted.css.join("×")} CSS)`);
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors at the mount (${mounted.gpuErrors})`);

  let worstSoup = 0;
  for (const preview of ["none", "dashed", "solid"]) {
    const drawn = await page.evaluate((k) => window.__parityRig.draw(k), preview);
    log(`draw ${preview}: ${JSON.stringify(drawn)}`);
    check(drawn.wires > 0 && drawn.guides > 0, `${preview}: both collectors emitted geometry (${drawn.wires} wire verts, ${drawn.guides} guide verts)`);
    // The blank-readback guard: a WebGPU canvas can read back empty and a diff of
    // two blanks passes every threshold. Both sides must carry ink of their own.
    check(drawn.inkA > 50_000 && drawn.inkB > 50_000, `${preview}: neither readback is blank (ink A ${drawn.inkA.toLocaleString()} px, B ${drawn.inkB.toLocaleString()} px)`);
    check(drawn.gpuErrors === 0, `${preview}: no uncaptured GPU errors (${drawn.gpuErrors})`);

    const ctlA = await page.evaluate(() => window.__parityRig.controlA());
    const ctlB = await page.evaluate(() => window.__parityRig.controlB());
    log(`${preview} control A (the old canvas drawn twice): soup ${band(ctlA.soup)} · edge ${band(ctlA.edge)}`);
    log(`${preview} control B (the new canvas drawn twice): soup ${band(ctlB.soup)} · edge ${band(ctlB.edge)}`);
    check(ctlA.soup.max === 0 && ctlA.edge.max === 0 && ctlB.soup.max === 0 && ctlB.edge.max === 0,
      `${preview}: the A-vs-A floor is 0 on both sides, edges included — the readback and each rasteriser are deterministic`);

    const d = await page.evaluate(() => window.__parityRig.diff());
    log(`${preview} A vs B: ${d.size} · soup interior ${band(d.soup)} · bare ${band(d.bare)} · edge ${band(d.edge)} · raster says ${d.painted.toLocaleString()} px carry soup, ${d.coverPx.toLocaleString()} of them interior`);
    log(`${preview} DEEP (a CSS px clear of every edge, seams included) vs the CPU raster: NEW (colour as configured) ${band(d.newVsRaster)} · OLD (through three's output encode) ${band(d.oldVsSrgbRaster)}`);
    log(`${preview} SEAM band (flat, but within a CSS px of an edge) vs the same raster: NEW ${band(d.newSeam)} · OLD ${band(d.oldSeam)}`);
    if (d.worstOld !== null) log(`${preview} worst DEEP px for the OLD chain (${d.worstOld.at.join(",")}): old ${d.worstOld.a.join(",")} · predicted ${d.worstOld.srgbRaster.join(",")} · raster ${d.worstOld.raster.join(",")}`);
    if (d.worst !== null) log(`${preview} worst DEEP soup px (${d.worst.at.join(",")}): old ${d.worst.a.join(",")} · new ${d.worst.b.join(",")} · raster ${d.worst.raster.join(",")} · raster+encode ${d.worst.srgbRaster.join(",")}`);
    check(!d.size.includes(" vs "), `${preview}: the two readbacks are the same size (${d.size})`);
    check(d.coverPx > 20_000, `${preview}: the interior soup band is big enough to mean something (${d.coverPx.toLocaleString()} px)`);
    check(d.bare.max === 0, `${preview}: away from the soup entirely the two grounds agree byte for byte (${band(d.bare)})`);
    // GEOMETRY — the claim the port is actually about, in BOTH directions: every pixel the
    // CPU raster says carries soup is painted by both rasterisers, and no pixel it says is
    // empty is painted by either. A misplaced or mis-sized triangle fails one or the other.
    check(d.coverA === 0 && d.coverB === 0 && d.spillA === 0 && d.spillB === 0,
      `${preview}: GEOMETRY parity — neither side left an interior soup pixel bare (old ${d.coverA}, new ${d.coverB} of ${d.coverPx.toLocaleString()}) and neither painted one the raster says is empty (old ${d.spillA}, new ${d.spillB} of ${d.spillPx.toLocaleString()})`);
    // COLOUR — each side against its own chain's prediction from the same triangles.
    check(d.newVsRaster.px > 20_000 && d.newVsRaster.max === 0, `${preview}: the NEW ground writes the colour the config names, BYTE FOR BYTE, on every deep pixel (${band(d.newVsRaster)})`);
    check(d.oldVsSrgbRaster.max <= 1, `${preview}: and the OLD renderer draws the same geometry through three's chain — a LINEAR composite of the same colours, encoded on output (${band(d.oldVsSrgbRaster)}; the 1 is the encode's own 8-bit rounding)`);
    // The new pass matches the raster in the SEAM band too — it has no seams to speak of.
    // The old one does not, and that is the second finding: MSAA samples the sub-pixel wedge
    // where two stroke quads of a polyline meet, so the old leg's joins carry faint dark seams.
    check(d.newSeam.max <= 1, `${preview}: the new pass has no seam artifact — it matches the raster in the seam band too (${band(d.newSeam)})`);
    worstSoup = Math.max(worstSoup, d.soup.max);
  }
  log(`the two colour chains differ by up to ${worstSoup}/255 on interior soup pixels — the C1 finding, and C2's to settle`);
} finally {
  await app.close();
}
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
