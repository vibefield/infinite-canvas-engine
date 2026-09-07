/**
 * The B2 + B3a exit (design-013 §8): the new composited profile boots on the app-owned
 * device, submits nothing while idle, answers a camera write with one frame — and then
 * draws a board of real widgets from the world: the counts, the pixels off the ground
 * canvas (a card's plate, the ground in a gap, a folder's face as a HOLE over its inside),
 * idle-zero with cards on the board, the reveal on selection, the lift on Grab, the heat on
 * the drop pair. Run: `pnpm --filter widgetlab-desktop next-boot`.
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
const rgb = (c) => `(${c.join(",")})`;
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const app = await _electron.launch({ executablePath: require("electron"), args: [appDir], env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`); });
  await page.goto(`file://${path.join(appDir, "dist", "composited-next.html")}`);
  await page.waitForFunction(() => window.__nextRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__nextRig.ready);

  // ---- B2: the boot
  const mounted = await page.evaluate(() => window.__nextRig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.profile === "composited-next", `the NEW profile mounted through <InfiniteCanvas> (${mounted.profile})`);
  check(mounted.canvases === 1, `one canvas in the L0 slot — the ground's own (${mounted.canvases})`);
  check(mounted.available === true, "Ground.create resolved on the app-owned device");
  check(mounted.redraws >= 1, `the ground drew (${mounted.redraws} redraw${mounted.redraws === 1 ? "" : "s"})`);
  check(mounted.submits >= 1, `and submitted real work (${mounted.submits} submits)`);
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors (${mounted.gpuErrors})`);

  const idle = await page.evaluate(() => window.__nextRig.idle(3000));
  log(`idle 3 s: ${JSON.stringify(idle)}`);
  check(idle.submits === 0 && idle.redraws === 0, `idle-zero: ${idle.submits} submits, ${idle.redraws} redraws over ${idle.frames} frames`);

  const nudged = await page.evaluate(() => window.__nextRig.nudge());
  log(`camera write: ${JSON.stringify(nudged)}`);
  check(nudged.redraws >= 1 && nudged.submits >= 1, `a camera write is a frame: +${nudged.redraws} redraw, +${nudged.submits} submit`);

  // ---- B3a: the board
  const board = await page.evaluate(() => window.__nextRig.board());
  log(`board: ${JSON.stringify(board)}`);
  check(board.note === undefined, board.note ?? "the board settled (7 cards, 1 portal)");
  check(board.cards === 7 && board.containers === 1, `7 cards drawn, 1 of them the folder (${board.cards} cards, ${board.containers} containers)`);
  check(board.portals === 1 && board.inside === 3, `the folder's face carries a live portal with its 3 cards inside (${board.portals} portal, ${board.inside} inside)`);
  check(board.capped === 0, `nothing past the record cap (${board.capped})`);
  check(board.gpuErrors === 0, `no uncaptured GPU errors with cards on the board (${board.gpuErrors})`);
  check(near(board.pixels.card, board.expect.card, 4), `a card's centre is the plate: ${rgb(board.pixels.card)} vs --vf-card ${rgb(board.expect.card)}`);
  check(near(board.pixels.gap, board.expect.bg, 4), `the gap between two cards is the ground: ${rgb(board.pixels.gap)} vs --vf-canvas-bg ${rgb(board.expect.bg)}`);
  check(near(board.pixels.face, board.expect.bg, 4), `the folder's face shows its inside's ground — a hole, not a plate: ${rgb(board.pixels.face)}`);
  check(near(board.pixels.bar, board.expect.card, 4), `the folder's bar is the plate: ${rgb(board.pixels.bar)}`);

  const idleCards = await page.evaluate(() => window.__nextRig.idle(2000));
  log(`idle 2 s with cards: ${JSON.stringify(idleCards)}`);
  check(idleCards.submits === 0 && idleCards.redraws === 0, `idle-zero holds with cards on the board: ${idleCards.submits} submits, ${idleCards.redraws} redraws over ${idleCards.frames} frames`);

  // ---- the springs
  const sel = await page.evaluate(() => window.__nextRig.select(0));
  log(`select: ${JSON.stringify(sel)}`);
  check(sel.reveal === 1 && sel.ring === 1 && sel.live === false, `selection reveals: reveal ${sel.reveal}, ring ${sel.ring}, settled ${!sel.live}`);
  const idleSel = await page.evaluate(() => window.__nextRig.idle(1500));
  log(`idle 1.5 s after the reveal: ${JSON.stringify(idleSel)}`);
  check(idleSel.submits === 0, `idle-zero after the spring settles: ${idleSel.submits} submits over ${idleSel.frames} frames (woken by ${JSON.stringify(idleSel.wakes)})`);

  const grab = await page.evaluate(() => window.__nextRig.grab(1));
  log(`grab: ${JSON.stringify(grab)}`);
  check(grab.lift === 1 && Math.abs(grab.scale - 1.05) < 1e-6, `Grab lifts: lift ${grab.lift}, scale ${grab.scale.toFixed(4)} (ChromeSettings.liftScale 1.05)`);
  check(grab.liftAfter === 0 && grab.scaleAfter === 1, `losing Grab sets it down: lift ${grab.liftAfter}, scale ${grab.scaleAfter}`);

  const heat = await page.evaluate(() => window.__nextRig.heat(2, 1));
  log(`heat: ${JSON.stringify(heat)}`);
  check(heat.hot === 1 && heat.tier === 1, `the drop pair lights the target at the accept tier: presence ${heat.hot}, tier ${heat.tier}`);
  check(luma(heat.lit) > luma(heat.cold) + 1, `the plate under the light reads brighter: lit ${rgb(heat.lit)} vs cold ${rgb(heat.cold)}`);
  check(heat.hotAfter === 0, `clearing the pair fades the light out (presence ${heat.hotAfter})`);

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "composited-next.png"), await page.screenshot());
} finally {
  await app.close();
}
log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
