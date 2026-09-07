/**
 * The B2 exit (design-013 §8 B2): the new composited profile boots to a ground with no
 * cards on the app-owned device, submits nothing while idle, and answers a camera write
 * with one frame. Run: `pnpm --filter widgetlab-desktop next-boot`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const log = (m) => console.log(`[next-boot] ${m}`);
const failures = [];
const check = (ok, what) => { log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures.push(what); };

const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`); });
  await page.goto(`file://${path.join(appDir, "dist", "composited-next.html")}`);
  await page.waitForFunction(() => window.__nextRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__nextRig.ready);

  const mounted = await page.evaluate(() => window.__nextRig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.profile === "composited-next", `the NEW profile mounted through <InfiniteCanvas> (${mounted.profile})`);
  check(mounted.canvases === 1, `one canvas in the L0 slot — the ground's own (${mounted.canvases})`);
  check(mounted.available === true, "Ground.create resolved on the app-owned device");
  check(mounted.redraws >= 1, `the ground drew the empty board (${mounted.redraws} redraw${mounted.redraws === 1 ? "" : "s"})`);
  check(mounted.submits >= 1, `and submitted real work (${mounted.submits} submits)`);
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors (${mounted.gpuErrors})`);

  const idle = await page.evaluate(() => window.__nextRig.idle(4000));
  log(`idle 4 s: ${JSON.stringify(idle)}`);
  check(idle.submits === 0 && idle.redraws === 0, `idle-zero: ${idle.submits} submits, ${idle.redraws} redraws over ${idle.frames} frames`);

  const nudged = await page.evaluate(() => window.__nextRig.nudge());
  log(`camera write: ${JSON.stringify(nudged)}`);
  check(nudged.redraws >= 1 && nudged.submits >= 1, `a camera write is a frame: +${nudged.redraws} redraw, +${nudged.submits} submit`);

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "composited-next.png"), await page.screenshot());
} finally {
  await app.close();
}
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
