/**
 * The S3 exit (design-012 §9 S3): camera, absolute write-backs, parking, and
 * native input through a composited card.
 *
 * Every row here is a `hic-bench` result turned into a standing regression
 * test against the REAL implementation rather than the spike's rig:
 *
 *   §3 transform-compose  — inside layoutsubtree the transform REPLACES layout
 *   §3 stale hit regions  — visible-only 3/28, write-all 28/28, park 28/28
 *   §3 mid-gesture        — never defer; deferring landed 0/24
 *   §3 camera overhead    — a pure pan uploads ZERO bytes
 *   §5 interactive        — focus and typing work through the unpainted host
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
const CARDS = Number(process.env.BOARD_CARDS ?? "100");
const PAN_FRAMES = Number(process.env.PAN_FRAMES ?? "600");
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
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [renderer] ${m.text()}`);
  });

  await page.goto(`file://${path.join(appDir, "dist", "composited-board.html")}`);
  await page.waitForFunction(() => window.__boardRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__boardRig.ready);
  const board = await page.evaluate((n) => window.__boardRig.run("composited", n, true), CARDS);
  log(`board: ${board.cards} cards, ${board.canvasHosts} canvas-side, ${board.copies} copies`);
  check(board.canvasHosts === CARDS, `all ${CARDS} cards are composited (${board.canvasHosts})`);
  fs.mkdirSync(shotDir, { recursive: true });

  // --- §5 law 1: the transform REPLACES layout ------------------------------
  const sem = await page.evaluate(() => window.__boardRig.transformSemantics());
  log(`SEMANTICS left/top ${sem.left},${sem.top} → no-transform rect ${JSON.stringify(sem.noTransform)}`);
  log(`          matrix(1,0,0,1,120,60) → rect ${JSON.stringify(sem.translated)}`);
  check(
    sem.noTransform.x === 0 && sem.noTransform.y === 0,
    `left/top are INERT inside layoutsubtree — a host with no transform sits at (0,0), not at its left/top (got ${sem.noTransform.x},${sem.noTransform.y})`,
  );
  check(
    sem.translated.x === 120 && sem.translated.y === 60,
    `the transform REPLACES layout rather than composing with it (got ${sem.translated.x},${sem.translated.y}, would be ${120 + 300},${60 + 200} if it composed)`,
  );

  // --- §5 law 2: stale hit regions ------------------------------------------
  const policies = {};
  for (const policy of ["visible-only", "write-all", "park"]) {
    const r = await page.evaluate((p) => window.__boardRig.hitTest(p), policy);
    policies[policy] = r;
    log(
      `HIT ${policy.padEnd(12)}: ${r.correct}/${r.checked} land` +
        ` (stolen by off-screen cards: ${r.stolenByOffscreen}, hit nothing: ${r.hitNothing},` +
        ` off-screen hosts intruding into the viewport: ${r.potentialThieves})`,
    );
    if (r.examples.length > 0) log(`     e.g. ${JSON.stringify(r.examples[0])}`);
  }
  // The DEFECT must reproduce, or the two fixes below prove nothing: a rig
  // where every policy passes is a rig that is not staging the problem.
  // Grade the STAGING first: if no off-screen host intrudes, "visible-only
  // passed" means the rig failed to reproduce the defect, and the two fixes
  // below would then be proving nothing.
  check(
    policies["visible-only"].potentialThieves > 0,
    `the rig reproduces the stale-region setup — ${policies["visible-only"].potentialThieves} off-screen hosts sit inside the viewport`,
  );
  check(
    policies["visible-only"].correct < policies["visible-only"].checked,
    `visible-only write-back IS a defect on this implementation too (${policies["visible-only"].correct}/${policies["visible-only"].checked} land)`,
  );
  check(
    policies.park.potentialThieves === 0,
    `parking removes every intruder (${policies.park.potentialThieves} left)`,
  );
  check(
    policies["write-all"].correct === policies["write-all"].checked,
    `write-all-N is a complete fix (${policies["write-all"].correct}/${policies["write-all"].checked})`,
  );
  check(
    policies.park.correct === policies.park.checked,
    `PARKING is a complete fix (${policies.park.correct}/${policies.park.checked})`,
  );

  // --- §5 law 3: never defer during a gesture -------------------------------
  const mid = await page.evaluate((n) => window.__boardRig.midGestureHits(n), GESTURE_SAMPLES);
  log(`MID-GESTURE: ${mid.landed}/${mid.checked} clicks land while panning, max host offset ${mid.maxOffset.toFixed(1)}px`);
  check(
    mid.checked >= GESTURE_SAMPLES - 2,
    `the gesture probe actually sampled (${mid.checked}/${GESTURE_SAMPLES})`,
  );
  check(
    mid.landed === mid.checked,
    `EXIT: every mid-gesture click lands (${mid.landed}/${mid.checked}) — deferring the write-back scored 0/24`,
  );
  check(mid.maxOffset < 1, `hit regions track the camera exactly (max ${mid.maxOffset.toFixed(2)}px off)`);

  // --- what does changedElements actually NAME? -----------------------------
  const dirtShape = await page.evaluate(() => window.__boardRig.characterizeContentDirt());
  log(
    `CONTENT DIRT: a pure content edit named ${dirtShape.named} element(s) — ` +
      `the host itself ${dirtShape.namedTheHost}x, a descendant ${dirtShape.namedADescendant}x`,
  );
  log(`              samples: ${JSON.stringify(dirtShape.samples)}`);
  check(dirtShape.named > 0, `a content edit raises a paint event naming something (${dirtShape.named})`);
  // This is what forces the guard to be temporal rather than structural: there
  // is no descendant in the event to key off.
  check(
    dirtShape.namedADescendant === 0 && dirtShape.namedTheHost > 0,
    `changedElements names the DRAWABLE, never the mutated descendant (host ${dirtShape.namedTheHost}x, descendant ${dirtShape.namedADescendant}x)`,
  );

  // --- §4.2 guard: a pure pan uploads nothing -------------------------------
  const pan = await page.evaluate((n) => window.__boardRig.panUpload(n), PAN_FRAMES);
  log(
    `PAN ${pan.frames} frames: copies=${pan.copies} paintEvents=${pan.paintEvents} ` +
      `namedAsSelf=${pan.selfNamed} namedAsContent=${pan.contentNamed} ` +
      `submits=${pan.submits} parked=${pan.parked} refused=${pan.refused} ` +
      `firstCopyOnFrame=${pan.firstCopyFrame} framesWithCopies=${pan.copyFrameCount}`,
  );
  check(
    pan.pendingAtStart === 0,
    `the pan starts on a drained atlas (${pan.pendingAtStart} copies owed) — an arm that starts dirty is charged for the previous one`,
  );
  check(
    pan.copies === 0,
    `EXIT: a ${pan.frames}-frame pan uploads ZERO bytes (${pan.copies} copies)`,
  );
  // The characterisation §4.2 asked for: the write-back's paint events DO name
  // the hosts it wrote. They are filtered structurally (named-as-self), not by
  // a timing window.
  check(
    pan.selfNamed > 0,
    `§4.2 characterised: the write-back's own paint events DO name the hosts it wrote (${pan.selfNamed}) — the guard is load-bearing, not decorative`,
  );
  check(
    pan.contentNamed === 0,
    `§4.2 guard: none of them reach the upload path as content dirt (${pan.contentNamed})`,
  );
  check(pan.submits > 0, `the pan did composite (${pan.submits} submits) — a still frame would prove nothing`);

  // --- §5: native focus and typing through the unpainted host ---------------
  const target = await page.evaluate(() => window.__boardRig.addInput(0));
  log(`INPUT target at ${JSON.stringify(target)}`);
  check(target.w > 0 && target.h > 0, `the input has a real hit rect inside the composited card (${target.w}x${target.h})`);

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
  const focused = await page.evaluate(() => window.__boardRig.inputState());
  log(`INPUT after click: ${JSON.stringify(focused)}`);
  check(focused.focused === true, "a synthesised click FOCUSES the real input inside the composited card");
  check(
    focused.activeInsideCanvas === true,
    "the focused element is inside the L1 canvas subtree — hit-testing is native, with no router",
  );

  const typed = "hello42";
  await sendInput([...typed].map((ch) => ({ type: "char", keyCode: ch })));
  const after = await page.evaluate(() => window.__boardRig.inputState());
  log(`INPUT after typing: ${JSON.stringify(after)}`);
  check(after.value === typed, `typing reaches the real input through the unpainted host ("${after.value}")`);

  // THE OTHER HALF OF THE GUARD. A filter that suppressed everything would also
  // pass the zero-upload check, so prove real content still uploads: typing
  // changes a DESCENDANT, which must reach the atlas.
  const afterTyping = await page.evaluate(() => window.__boardRig.dirtCounters());
  log(`DIRT after typing: namedAsContent=${afterTyping.contentNamed} copies=${afterTyping.copies}`);
  check(
    afterTyping.contentNamed > 0,
    `the guard is a FILTER, not a mute: typing named a descendant and reached the upload path (${afterTyping.contentNamed})`,
  );

  // The typed text must also reach the PIXELS: the mutation self-schedules a
  // paint event, the slot is re-copied, and the card composites with it.
  await page.evaluate(() => window.__boardRig.readCompositor());
  fs.writeFileSync(path.join(shotDir, "s3-composited-input.png"), await page.screenshot());
  const afterTypeBoard = await page.evaluate(() => window.__boardRig.atlas());
  log(`atlas after typing: pages=${afterTypeBoard.pages} slots=${afterTypeBoard.slots}`);

  await page.evaluate(() => window.__boardRig.teardown());
} catch (err) {
  console.error(err);
  failures.push(`threw: ${err.message}`);
} finally {
  await app.close().catch(() => {});
}

console.log(
  failures.length === 0
    ? "[input] ALL PASS"
    : `[input] ${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
