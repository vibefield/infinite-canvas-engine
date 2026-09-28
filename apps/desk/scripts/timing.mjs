// THE GATE'S TIMING ROWS (ICE M21, K-H) — how a row that asserts a TIME tells the truth on a host at load 150–290. A row that
// goes red under load and green alone costs every grade a re-run and teaches everyone to re-run; a row loosened to pass lets a
// regression through. So a timing row follows this pattern, and a new one (K7b's, K8's, anyone's) follows it too:
//
//   WARM      an untimed batch of the same work first — the GPU comes to a batch after idle rows (a settle, a second of nothing
//             submitted) and its first saturated batch pays the clock's ramp back (K7a found the desk copy's slow mode was that);
//   DRAINED   `queue.onSubmittedWorkDone()` before the clock starts and after it stops (it covers ALL prior work: an undrained
//             start bills the previous batch) — the in-page measures (holdCost, tray.cost, kindCost) already do;
//   N ≥ 5     rounds, each its own drained batches, the variants of a comparison INTERLEAVED in every round (they share the
//             round's load), the host's load average printed beside the numbers (`hostLoad()`);
//   MIN       a COST bound asserts on the minimum over the rounds (`minOf`): load only ever ADDS time to a drained batch, so
//             a minimum over the bound is a real regression and a minimum under it is a real pass. A marginal cost (the copy
//             over the hand) is min(arm) − min(control), the two interleaved round by round. Never a median or a mean of a
//             loaded host — a median is exactly what a load burst moves;
//   METHOD    a CONTROL (an A/A: the same frame measured as a variant of its own) is judged against its OWN run's spread,
//             never against the machine's noise level: `aaVerdict` (D-KH.2);
//   TWO       a statistical row that fails re-measures ONCE and fails only when the second witness fails too, both printed
//             (`twoWitnesses`, D-KH.3) — a real regression fails every witness; a burst fails one;
//   FRAMES    a verdict read from the page is ONE frame's state, read in ONE evaluate (never a value from one round trip
//             compared against a value from the next while the desk may draw between them); input whose meaning depends on
//             its spacing (a double-click) is dispatched as one batch (`dblClick`);
//   NO RAISE  no bound is raised to make a row pass: a wrong bound is changed deliberately, with numbers, in its own commit.
import { loadavg } from "node:os";

/** The host's load averages (1, 5, 15 min) — printed beside every timed number. */
export const hostLoad = () => loadavg().map((v) => v.toFixed(0)).join("/");

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? Number.NaN : s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const minOf = (xs) => Math.min(...xs);
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

/**
 * The A/A control judged by the METHOD, never by the machine (D-KH.2). `ablateKinds` reads a kind's cost PAIRED — the median over
 * rounds of base − without-k within a round — so its control is read the same way: T = median over rounds of control − base.
 * Two identical variants must read T consistent with zero against THEIR OWN RUN's spread: z = |T| ÷ (1.858 · MAD ÷ √R), MAD =
 * the median |d − T| (1.858 · MAD ÷ √R is the sampling deviation of a median of R draws). A mismatched control (a variant that
 * is NOT the base: a kind left out, the held object in) is a systematic offset every round shares — z runs to tens; load only
 * widens the spread, which widens the allowance with it. The old read — median(control) − median(base), UNPAIRED, against
 * median |control − base|, PAIRED — mixed the rounds' spread (which load inflates) into one side only; and a paired offset
 * can never exceed its own floor (|median d| ≤ median |d| for an odd count), so that half of D-K2.5 could not fail a
 * mismatch at all. The verdict: FAIL when the offset is both SIGNIFICANT (z > 4) and MATERIAL (over 2 % of the frame, D-K2.5's
 * own allowance — a 0.3 % position habit on a silent host is not a broken method); or not below every cost the tool calls real;
 * or nothing clears; or the desk drew frames of its own meanwhile (`redraws` > 0 — what D-K2.5's "floor ≤ 10 % of the frame"
 * stood in for: a desk drawing beside the batches, not a loaded host).
 */
export function aaVerdict(kc, { redraws = 0, pool } = {}) {
  // a second witness judges the POOLED rounds of both runs (D-KH.3): each round's pair is its own, so the rounds of two runs stand together
  const b = [...(pool?.samples.base ?? []), ...kc.samples.base];
  const c = [...(pool?.samples.control ?? []), ...kc.samples.control];
  const R = b.length;
  const d = c.map((x, r) => x - b[r]);
  const T = median(d);
  const mad = median(d.map((x) => Math.abs(x - T)));
  const se = (1.858 * mad) / Math.sqrt(R);
  const z = se > 0 ? Math.abs(T) / se : Math.abs(T) > 0 ? Number.POSITIVE_INFINITY : 0;
  const frame = kc.base.median;
  const real = Object.values(kc.kinds).filter((k) => k.clears).map((k) => k.ms);
  const smallest = real.length > 0 ? minOf(real) : Number.NaN;
  const offset = z > 4 && Math.abs(T) > 0.02 * frame;
  const ok = !offset && real.length > 0 && Math.abs(T) < smallest && redraws === 0;
  const why = [offset ? `the offset is real (z ${fmt(z, 1)} > 4 and ${fmt(Math.abs(T), 4)} > 2 % of the frame)` : "", real.length === 0 ? "no kind clears the floor" : "", real.length > 0 && Math.abs(T) >= smallest ? `the offset is not below the smallest real cost ${fmt(smallest)}` : "", redraws > 0 ? `the desk drew ${redraws} frames of its own meanwhile` : ""].filter(Boolean).join("; ");
  return {
    ok,
    T,
    mad,
    z,
    R,
    frame,
    smallest,
    real: real.length,
    text: `A/A ${fmt(T, 4)} ms paired (z ${fmt(z, 1)}, its spread ${fmt(mad, 4)} ms over ${R} rounds; the tool's floor ${fmt(kc.noise, 4)} ms) · the frame ${fmt(frame)} ms · the smallest real cost ${fmt(smallest)} ms${why ? ` — ${why}` : ""}`,
  };
}

/**
 * A statistical row's two witnesses (D-KH.3): measure, judge; on a failure measure ONCE more and judge again — `judge(result,
 * earlier)` is handed the first witness's result, so a row whose evidence pools (the A/A's rounds) judges both runs together: a
 * burst that failed one run is diluted by a clean one, a real offset only grows. Returns `{ ok, first, second? }` and a text
 * that names a failed first witness, so a pass on the second is never silent.
 */
export async function twoWitnesses(measure, judge) {
  const r1 = await measure(1);
  const first = judge(r1);
  if (first.ok) return { ok: true, first, text: first.text };
  const second = judge(await measure(2), r1);
  return { ok: second.ok, first, second, text: `${second.text} (the second witness, pooled — the first failed: ${first.text})` };
}

/**
 * A double-click as ONE batch (K-H): the four mouse events sent back to back without awaiting each other, so they reach the
 * page in order with no round trip between them — the desk pairs its two taps on the frames that RECOGNISE them (nav-tap.ts,
 * held.ts: ≤ `multiTapWindowMs` 280 ms of `now`), and four awaited round trips with a 16 ms sleep after each spent that window
 * on a loaded host. Measured on the calendar's tape (the rig:open row, 80 trials a build at load 17–137): the batch reaches the
 * page in 4–31 ms and the desk recognises the two taps a frame or two apart, as it does the awaited four. The events carry their
 * own timestamps 20 ms apart (a person's quick double-click). `move`: a mouseMoved to the point first (rig:open's helper had one;
 * rig:nav's and rig:interact's did not). Resolves when Chrome has acknowledged all four.
 */
export async function dblClick(tab, x, y, { move = true, ...extra } = {}) {
  if (move) await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, ...extra });
  const t = Date.now() / 1000;
  const steps = [["mousePressed", 1], ["mouseReleased", 1], ["mousePressed", 2], ["mouseReleased", 2]];
  await Promise.all(steps.map(([type, clickCount], i) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount, timestamp: t + i * 0.02, ...extra })));
}

/**
 * A PROGRESS watchdog (K-H): the rig exits 2 when `quietMs` pass with no row reported — `kick()`, called by every row — or the whole
 * run outlasts `totalMs` (four quiet spans by default: a loop that reports forever is still a hang). A rig's watchdog was ONE span for
 * the whole run, so a loaded host that slowed every row killed a rig that was making progress: rig:parity reached 63 of its 106
 * scenes in 1,230 s at load 280 (19.5 s a scene, two captures each), bound for its 1,800 s watchdog. A hang still ends in `quietMs`.
 */
export function watchdog(quietMs, cleanup, { totalMs = 4 * quietMs } = {}) {
  const t0 = Date.now();
  let last = t0;
  const timer = setInterval(async () => {
    const now = Date.now();
    if (now - last <= quietMs && now - t0 <= totalMs) return;
    clearInterval(timer);
    console.log(`WATCHDOG — ${now - last > quietMs ? `no row in ${((now - last) / 1000).toFixed(0)} s` : `the run past ${(totalMs / 1000).toFixed(0)} s`}`);
    await cleanup();
    process.exit(2);
  }, 1000);
  timer.unref();
  return () => { last = Date.now(); };
}
