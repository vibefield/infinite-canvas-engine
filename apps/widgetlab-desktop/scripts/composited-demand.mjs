/**
 * The S4 exit (design-012 §9 S4): dirty-driven uploads, demand buckets for
 * self-animating dom, and boot staggering.
 *
 * The numbers this is measured against, from `hic-bench` §5:
 *
 *   static board                     0 paint events/s
 *   one CSS-keyframe card        239.9 paint events/s   (2 per 120 Hz tick)
 *
 * Demand throttles UPLOADS, not paint events — Chromium raises those either
 * way and the main-thread paint cost stays. So the rig counts both, and the
 * claim it makes is the narrow one that is actually true.
 *
 * Run: `pnpm --filter widgetlab-desktop demand`
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARDS = Number(process.env.BOARD_CARDS ?? "24");
const WINDOW_MS = Number(process.env.DEMAND_MS ?? "2500");

const log = (m) => console.log(`[demand] ${m}`);
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
  await page.goto(`file://${path.join(appDir, "dist", "composited-board.html")}`);
  await page.waitForFunction(() => window.__boardRig !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__boardRig.ready);
  const board = await page.evaluate((n) => window.__boardRig.run("composited", n, true), CARDS);
  check(board.canvasHosts === CARDS, `${CARDS} cards composited (${board.canvasHosts})`);

  // --- the static floor, as the control -------------------------------------
  const still = await page.evaluate((ms) => window.__boardRig.animationProbe(0, 60, ms), WINDOW_MS);
  log(
    `STATIC   (control): ${still.paintEventsPerSecond.toFixed(1)} paint events/s, ` +
      `${still.copiesPerSecond.toFixed(1)} uploads/s over ${still.frames} frames`,
  );
  check(
    still.copies === 0,
    `a static composited board uploads NOTHING (${still.copies} copies in ${(still.ms / 1000).toFixed(1)}s)`,
  );

  // --- unthrottled: the hazard must be real ---------------------------------
  await page.evaluate(() => window.__boardRig.animateCard(0, true));
  const free = await page.evaluate((ms) => window.__boardRig.animationProbe(0, 60, ms), WINDOW_MS);
  log(
    `ANIMATED @60      : ${free.paintEventsPerSecond.toFixed(1)} paint events/s, ` +
      `${free.copiesPerSecond.toFixed(1)} uploads/s, ${free.namedHosts} hosts named`,
  );
  // A paint event that names nothing throttles for free and would make every
  // bucket below look like a success. Prove the events carry dirt first.
  check(
    free.namedHosts > 0,
    `the animation's paint events actually NAME the card (${free.namedHosts}) — an event naming nothing costs no uploads whatever the bucket`,
  );
  check(
    free.copiesPerSecond > 20,
    `a CSS-keyframe card free-runs when nothing throttles it (${free.copiesPerSecond.toFixed(1)} uploads/s) — the hazard is real, not hypothetical`,
  );

  // --- clamped ---------------------------------------------------------------
  const buckets = [30, 10, 2];
  const results = {};
  for (const bucket of buckets) {
    const r = await page.evaluate(
      ([b, ms]) => window.__boardRig.animationProbe(0, b, ms),
      [bucket, WINDOW_MS],
    );
    results[bucket] = r;
    log(
      `ANIMATED @${String(bucket).padStart(2)}      : ${r.paintEventsPerSecond.toFixed(1)} paint events/s, ` +
        `${r.copiesPerSecond.toFixed(1)} uploads/s, ${r.namedHosts} named, ${r.throttled} deferred`,
    );
  }
  for (const bucket of buckets) {
    const r = results[bucket];
    // A bucket is a CEILING. Allowing 25% headroom over it absorbs the frame
    // quantisation of a 120 Hz rAF loop without letting a real breach pass.
    check(
      r.copiesPerSecond <= bucket * 1.25,
      `EXIT: the keyframe card is clamped to its ${bucket} fps bucket (${r.copiesPerSecond.toFixed(1)} uploads/s)`,
    );
    check(
      r.copies > 0,
      `and it is CLAMPED, not stopped — a throttled card is behind, never frozen (${r.copies} uploads at ${bucket} fps)`,
    );
  }
  check(
    results[2].copiesPerSecond < results[30].copiesPerSecond,
    `the buckets are ordered — 2 fps uploads less than 30 fps (${results[2].copiesPerSecond.toFixed(1)} vs ${results[30].copiesPerSecond.toFixed(1)})`,
  );
  // Throttling must not be mistaken for suppressing the paint events; it does
  // not, and this states the honest limit of what demand buys.
  log(
    `NOTE: paint events barely move across buckets (${free.paintEventsPerSecond.toFixed(1)} → ${results[2].paintEventsPerSecond.toFixed(1)}/s): demand buys GPU bandwidth, not main-thread paint. Continuous animation still belongs in WGSL.`,
  );

  await page.evaluate(() => window.__boardRig.animateCard(0, false));

  // --- boot staggering -------------------------------------------------------
  const stagger = await page.evaluate(
    ([budget, maxFrames]) => window.__boardRig.bootStagger(budget, maxFrames),
    [4, 60],
  );
  log(
    `STAGGER budget=${stagger.budget}: ${stagger.copied} copies over ${stagger.frames} frames, ` +
      `max ${stagger.maxPerFrame}/frame, ${stagger.stillOwed} still owed, ${stagger.refused} refused`,
  );
  check(
    stagger.maxPerFrame <= stagger.budget,
    `EXIT: bulk arrival respects the per-composite budget (max ${stagger.maxPerFrame} ≤ ${stagger.budget})`,
  );
  check(
    stagger.frames > 1,
    `and it actually STAGGERED rather than completing in one frame (${stagger.frames} frames for ${stagger.owedAtStart} cards)`,
  );
  // The half a budget quietly breaks: leftover copies stranded because the
  // compositor went quiet. It must stay awake while it owes work.
  check(
    stagger.stillOwed === 0,
    `and the board still COMPLETES — the compositor stays awake while copies are owed (${stagger.stillOwed} owed)`,
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
    ? "[demand] ALL PASS"
    : `[demand] ${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
