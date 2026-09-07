/**
 * INPUT through a promoted card — the old leg's `input` rig, PORTED to the new
 * profile at B8 (design-013 §8 B8, R7). The old driver graded design-012's S3
 * exit through `createDomSourceBinder` and the write-back; these rows ask the
 * same questions of `groundCompose` + `compositedNextProfile`, where the L1
 * host's geometry belongs to DomRender (B4 R6):
 *
 *   transform compose  — inside layoutsubtree the matrix REPLACES layout
 *   stale hit regions  — every mid-gesture click lands, max offset < 1 px
 *   camera overhead    — a 600-frame pure pan uploads ZERO bytes
 *   native input       — focus and typing work through the unpainted host
 *   the guard is a FILTER — typing still reaches the copy path
 *
 * Input is driven ONLY through this app's own `webContents.sendInputEvent`.
 * No OS-level injection: nothing here touches the machine's real input stack.
 *
 * Run: `pnpm --filter widgetlab-desktop input`
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");
const CARDS = Number(process.env.BOARD_CARDS ?? "6");
const PAN_FRAMES = Number(process.env.PAN_FRAMES ?? "600");
const TRACK_FRAMES = 120;
const GESTURE_SAMPLES = 24;

const log = (m) => console.log(`[input] ${m}`);
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
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.startsWith("[ice")) console.log(`  [renderer] ${t}`); });

  await page.goto(`file://${path.join(appDir, "dist", "composited-next-input.html")}`);
  await page.waitForFunction(() => window.__inputRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__inputRig.ready);

  // ---- boot
  const mounted = await page.evaluate(() => window.__inputRig.mount());
  log(`mount: ${JSON.stringify(mounted)}`);
  check(mounted.profile === "composited-next", `the NEW profile mounted (${mounted.profile})`);
  check(mounted.sourceCanvases === 1, `ONE L1 source canvas (${mounted.sourceCanvases})`);
  check(mounted.canvases === 1, `and ONE ground canvas beside it (${mounted.canvases})`);
  check(mounted.available === true, "Ground.create resolved on the app-owned device");
  check(mounted.gpuErrors === 0, `no uncaptured GPU errors (${mounted.gpuErrors})`);

  const board = await page.evaluate((n) => window.__inputRig.board(n), CARDS);
  log(`board: ${JSON.stringify(board)}`);
  check(board.promoted === CARDS, `all ${CARDS} cards asked for the GPU (${board.promoted})`);
  check(board.onCanvas === CARDS, `and all ${CARDS} hosts are immediate children of the L1 canvas (${board.onCanvas})`);
  check(board.copies >= CARDS, `each was copied at least once (${board.copies} copies)`);

  // ---- 1: the transform REPLACES layout, and tracks the camera
  const tracked = await page.evaluate((n) => window.__inputRig.transformTracks(n), TRACK_FRAMES);
  log(`TRACK ${tracked.frames} frames: maxOffset ${tracked.maxOffset.toFixed(3)}px, maxSizeError ${tracked.maxSizeError.toFixed(3)}px, inert rect ${JSON.stringify(tracked.inertRect)}`);
  check(
    tracked.inertRect.x === 0 && tracked.inertRect.y === 0,
    `left/top are INERT inside layoutsubtree — a host with no placement matrix sits at the canvas origin, not at its left/top (got ${tracked.inertRect.x},${tracked.inertRect.y})`,
  );
  check(tracked.sampled === TRACK_FRAMES, `the sweep sampled every frame (${tracked.sampled}/${TRACK_FRAMES})`);
  check(tracked.maxOffset < 1, `the placement matrix tracks the camera exactly: max ${tracked.maxOffset.toFixed(3)}px off over ${tracked.frames} frames`);
  check(tracked.maxSizeError < 1, `and the host's box stays the card's screen size: max ${tracked.maxSizeError.toFixed(3)}px off`);

  // ---- 2: stale hit regions
  const mid = await page.evaluate((n) => window.__inputRig.midGestureHits(n), GESTURE_SAMPLES);
  log(`MID-GESTURE: ${mid.landed}/${mid.checked} hits land while panning, max host offset ${mid.maxOffset.toFixed(3)}px`);
  if (mid.examples.length > 0) log(`     misses e.g. ${JSON.stringify(mid.examples)}`);
  check(mid.checked >= GESTURE_SAMPLES - 2, `the gesture probe actually sampled (${mid.checked}/${GESTURE_SAMPLES})`);
  check(mid.landed === mid.checked, `EXIT: every mid-gesture hit lands on the moving card (${mid.landed}/${mid.checked}) — deferring the write-back scored 0/24 on the old leg`);
  check(mid.maxOffset < 1, `hit regions track the camera exactly (max ${mid.maxOffset.toFixed(3)}px off)`);

  // ---- 3: a pure pan uploads nothing
  const pan = await page.evaluate((n) => window.__inputRig.panUpload(n), PAN_FRAMES);
  log(
    `PAN ${pan.frames} frames: copies=${pan.copies} dirtied=${pan.dirtied} (selfDirt ${pan.selfDirt}) resized=${pan.resized} ` +
      `redraws=${pan.redraws} submits=${pan.submits} parked=${pan.parked} refused=${pan.refused}`,
  );
  check(pan.pendingAtStart === 0, `the pan starts on a drained board (${pan.pendingAtStart} copies owed)`);
  check(pan.redraws > 0, `the pan did redraw the ground (${pan.redraws} frames, ${pan.submits} submits) — a still screen would prove nothing`);
  check(pan.copies === 0, `EXIT: a ${pan.frames}-frame pure pan uploads ZERO bytes (${pan.copies} copies)`);
  // The guard is LOAD-BEARING, not decorative: the placement writes really do
  // raise paint events naming the hosts, and every one of them was dropped.
  check(
    pan.selfDirt > 0 && pan.selfDirt === pan.dirtied,
    `and the §4.2 guard is what made it zero: all ${pan.dirtied} paint marks of the pan were this module's own placement writes (${pan.selfDirt} dropped)`,
  );
  check(pan.resized === 0, `and no host was re-sized by it (${pan.resized}) — a pan changes the matrix, never the box`);

  // ---- 4: native focus and typing through the unpainted host
  const target = await page.evaluate(() => window.__inputRig.focusTarget(0));
  log(`INPUT target at ${JSON.stringify(target)}`);
  check(target.w > 0 && target.h > 0, `the input has a real hit rect inside the promoted card (${target.w}x${target.h})`);

  const cx = Math.round(target.x + target.w / 2);
  const cy = Math.round(target.y + target.h / 2);
  const sendInput = (events) =>
    app.evaluate(async ({ BrowserWindow }, evts) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      for (const e of evts) wc.sendInputEvent(e);
      await new Promise((r) => setTimeout(r, 60));
    }, events);

  await sendInput([
    { type: "mouseDown", x: cx, y: cy, button: "left", clickCount: 1 },
    { type: "mouseUp", x: cx, y: cy, button: "left", clickCount: 1 },
  ]);
  const focused = await page.evaluate(() => window.__inputRig.inputState());
  log(`INPUT after click: ${JSON.stringify(focused)}`);
  check(focused.focused === true, "a synthesised click FOCUSES the real input inside the promoted card");
  check(focused.activeInsideCanvas === true, "the focused element is inside the L1 canvas subtree — hit-testing is native, with no router");

  const before = await page.evaluate(() => window.__inputRig.dirtCounters());
  const typed = "hello42";
  await sendInput([...typed].map((ch) => ({ type: "char", keyCode: ch })));
  const after = await page.evaluate(() => window.__inputRig.inputState());
  log(`INPUT after typing: ${JSON.stringify(after)}`);
  check(after.value === typed, `typing reaches the real input through the unpainted host ("${after.value}")`);

  // ---- 5: the guard is a FILTER, not a mute
  const afterTyping = await page.evaluate(() => window.__inputRig.dirtCounters());
  log(`DIRT across the typing: dirtied ${before.dirtied} → ${afterTyping.dirtied}, copies ${before.copies} → ${afterTyping.copies}`);
  check(
    afterTyping.copies > before.copies,
    `the pan guard is a FILTER, not a mute: typing is content and it reached the copy path (${afterTyping.copies - before.copies} copies)`,
  );

  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "composited-input.png"), await page.screenshot());
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await app.close().catch(() => {});
}

log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
