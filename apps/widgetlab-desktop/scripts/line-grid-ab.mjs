/**
 * The C1d RECORD (design-013 §8, D-C1.4 · D-C2.1): the OLD TSL line grid and the
 * NEW engine `line` glyph, in one headless Electron page, on one device, at three
 * zooms from the same camera — read back and compared.
 *
 * The delta is RECORDED, never gated: D-C2.1 ruled that the new glyph's LOD is
 * the engine's lattice and not the old ladder, so the two draw different lines
 * by construction and the glyph is not tuned to close the gap. What this script
 * fails on is a broken measurement: a GPU error, an arm with no ink in it (a
 * blank readback would agree with anything), or an A-vs-A control above 0.
 *
 * Run: `TMPDIR=/tmp pnpm --filter widgetlab-desktop line-ab`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const log = (m) => console.log(`[line-ab] ${m}`);
const failures = [];
const check = (ok, what) => { log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures.push(what); };
const n2 = (x) => x.toFixed(2);

const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`); });
  await page.goto(`file://${path.join(appDir, "dist", "line-grid-ab.html")}`);
  await page.waitForFunction(() => window.__lineAb !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__lineAb.ready);

  const r = await page.evaluate(() => window.__lineAb.run());
  log(`${r.width}×${r.height} device px (dpr ${r.dpr}) · camera (${r.cam.x}, ${r.cam.y}) · three backend ${r.backend}`);

  for (const row of r.rows) {
    const arm = (a) => `ink ${n2(a.inkPct)}% · peak ${a.peak} rgb(${a.peakRgb.join(",")}) · strongest rung every ${n2(a.pitchX)}×${n2(a.pitchY)} device px (${a.linesX}×${a.linesY} lines) · finest live rung every ${n2(a.finePitchX)} px (${a.fineLinesX} lines)`;
    log(`zoom ${row.zoom}`);
    log(`  old  ${arm(row.old)}`);
    log(`  new  ${arm(row.new)}`);
    log(`  A/B  colour maxΔ ${row.ab.maxRgbDelta}/255 · ${n2(row.ab.differingPct)}% of pixels differ · mean |Δ| ${row.ab.meanAbsRgbDelta.toFixed(3)} · alpha maxΔ ${row.ab.maxAlphaDelta}`);
    log(`  phase  the worst new line to the nearest old one: ${n2(row.alignX)} px across, ${n2(row.alignY)} px down (only meaningful where the pitches agree)`);
    log(`  control  old-vs-old colour maxΔ ${row.controlOld.maxRgbDelta} alpha maxΔ ${row.controlOld.maxAlphaDelta} · new-vs-new colour maxΔ ${row.controlNew.maxRgbDelta} alpha maxΔ ${row.controlNew.maxAlphaDelta}`);

    // the measurement's own gates
    check(row.controlOld.maxRgbDelta === 0 && row.controlOld.maxAlphaDelta === 0, `zoom ${row.zoom}: the OLD arm repeats itself exactly (A-vs-A maxΔ ${row.controlOld.maxRgbDelta})`);
    check(row.controlNew.maxRgbDelta === 0 && row.controlNew.maxAlphaDelta === 0, `zoom ${row.zoom}: the NEW arm repeats itself exactly (A-vs-A maxΔ ${row.controlNew.maxRgbDelta})`);
    check(row.old.inkPct > 0.2 && row.old.peak > 8, `zoom ${row.zoom}: the OLD arm drew a grid, not a blank (${n2(row.old.inkPct)}% ink, peak ${row.old.peak})`);
    check(row.new.inkPct > 0.2 && row.new.peak > 8, `zoom ${row.zoom}: the NEW arm drew a grid, not a blank (${n2(row.new.inkPct)}% ink, peak ${row.new.peak})`);
    check(row.new.pitchX > 0 && row.old.pitchX > 0, `zoom ${row.zoom}: both arms have a measurable rung pitch (old ${n2(row.old.pitchX)} px, new ${n2(row.new.pitchX)} px)`);
    check(Math.abs(row.old.pitchX - row.old.pitchY) < 1 && Math.abs(row.new.pitchX - row.new.pitchY) < 1, `zoom ${row.zoom}: each arm's lattice is square — its across and down pitches agree (old ${n2(row.old.pitchX)}/${n2(row.old.pitchY)}, new ${n2(row.new.pitchX)}/${n2(row.new.pitchY)})`);
    check(row.surface === "line" && row.baked === false, `zoom ${row.zoom}: the new arm's field drew the LINE surface program and baked no atlas (surface ${row.surface}, baked ${row.baked})`);
  }

  fs.mkdirSync(shotDir, { recursive: true });
  for (const s of r.shots) {
    for (const arm of ["old", "new"]) {
      const file = path.join(shotDir, `line-ab-z${s.zoom}-${arm}.png`);
      fs.writeFileSync(file, Buffer.from(s[arm].slice(s[arm].indexOf(",") + 1), "base64"));
    }
  }
  log(`pictures: ${path.relative(appDir, shotDir)}/line-ab-z<zoom>-{old,new}.png`);

  check(r.gpuErrors.length === 0, `no uncaptured GPU errors over ${r.rows.length * 4} captures (${r.gpuErrors.join(" · ") || "none"})`);
} finally {
  await app.close();
}
log(failures.length === 0 ? "RECORDED" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
