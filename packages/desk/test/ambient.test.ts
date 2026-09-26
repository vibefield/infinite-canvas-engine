// The AMBIENT policy (design-015 §4.6, D-D9; D2a-world) on a fake clock: the wind runs while the
// desk was touched within `idleMs`, then its SPEED eases to zero over `settleMs` and the desk
// wants no frame; a touch revives it; `live` never idles; `still` (and reduced motion) never
// blows and never tilts; a pinned still is the scene's clocks and wants no frame; the tilt
// follows the pointer and settles.
import { describe, expect, it } from "vitest";
import { AMBIENT_DEFAULTS, createAmbient } from "../src/compose/ambient";
import { HERO_MATRIX } from "../src/mat/layout";
import { MAT_GRID } from "../src/theme";

const DT = 1 / 60;
/** Step `n` frames at 60 fps from `t0` ms; returns the last step and the clock. */
function run(amb: ReturnType<typeof createAmbient>, t0: number, n: number, pointer: readonly [number, number] | null = null) {
  let now = t0;
  let last = amb.step(DT, now, pointer);
  for (let i = 1; i < n; i++) { now += 1000 * DT; last = amb.step(DT, now, pointer); }
  return { last, now };
}

describe("the ambient (design-015 §4.6)", () => {
  it("idle (the default): the wind blows within idleMs of a touch, eases to still over settleMs, then wants no frame; a touch revives it", () => {
    let r = 0.25;
    const amb = createAmbient({ idleMs: 1000, settleMs: 2000, random: () => { r = (r + 0.37) % 1; return r; } });
    expect(amb.state()).toMatchObject({ mode: "idle", speed: 0, pinned: false });
    expect(AMBIENT_DEFAULTS).toEqual({ mode: "idle", idleMs: 20_000, settleMs: 2_000 });
    // untouched: nothing blows, no frame wanted, the clocks stand
    let s = amb.step(DT, 0, null);
    expect(s.live).toBe(false);
    expect(s.frame.goboTime).toBe(0);
    expect(amb.state().phase).toBe("still");
    // touched at 0: full speed — the clocks advance at the wind's rate, the noise re-rolls, a frame is wanted every step
    amb.touch(0);
    s = amb.step(DT, 0, null);
    expect(s.live).toBe(true);
    expect(amb.state().speed).toBe(1);
    expect(s.frame.goboTime).toBeCloseTo(DT * MAT_GRID.gobo.wind, 9);
    expect(s.frame.time).toBeCloseTo(DT, 9);
    const noise0 = s.frame.noise;
    s = amb.step(DT, 16, null);
    expect(s.frame.noise).not.toEqual(noise0);
    // still blowing at 900 ms; easing at 2 000 (half way: speed ½); still at 3 100
    expect(amb.step(DT, 900, null).live).toBe(true);
    expect(amb.state().phase).toBe("live");
    const before = amb.clocks().goboTime;
    const easing = amb.step(DT, 2000, null);
    expect(amb.state().phase).toBe("easing");
    expect(amb.state().speed).toBeCloseTo(0.5, 9);
    expect(easing.live).toBe(true);
    expect(amb.clocks().goboTime - before).toBeCloseTo(DT * MAT_GRID.gobo.wind * 0.5, 9);   // the ease is on the clock's RATE: half speed
    amb.step(DT, 3100, null);
    expect(amb.state().phase).toBe("still");
    expect(amb.state().speed).toBe(0);
    const frozen = amb.step(DT, 3200, null);
    expect(frozen.live).toBe(false);
    expect(frozen.frame.goboTime).toBe(amb.clocks().goboTime);   // the clock stands: a still
    const noise1 = frozen.frame.noise;
    expect(amb.step(DT, 3300, null).frame.noise).toEqual(noise1);   // and the noise no longer re-rolls
    // a touch revives the wind at once
    amb.touch(3300);
    expect(amb.step(DT, 3300, null).live).toBe(true);
    expect(amb.state().phase).toBe("live");
  });

  it("the ease is monotonic: the speed never rises without a touch, and reaches exactly 0 at idleMs + settleMs", () => {
    const amb = createAmbient({ idleMs: 500, settleMs: 1000, random: () => 0.5 });
    amb.touch(0);
    let last = 1;
    for (let now = 0; now <= 1500; now += 25) { amb.step(DT, now, null); const s = amb.state().speed; expect(s).toBeLessThanOrEqual(last + 1e-12); last = s; }
    expect(last).toBe(0);
    expect(amb.state().phase).toBe("still");
  });

  it("live never idles: the wind blows a minute after the last touch; still never blows nor tilts — and reduced motion is still whatever the mode", () => {
    const live = createAmbient({ mode: "live", random: () => 0.5 });
    live.touch(0);
    expect(run(live, 60_000, 3).last.live).toBe(true);
    expect(live.state().phase).toBe("live");
    const still = createAmbient({ mode: "still", random: () => 0.5 });
    still.touch(0);
    const s = run(still, 0, 3, [0.8, -0.4]).last;
    expect(s.live).toBe(false);
    expect(s.frame.goboTime).toBe(0);
    expect(s.frame.goboMatrix).toBe(HERO_MATRIX);   // no tilt: the baked projector
    const reduced = createAmbient({ mode: "live", reducedMotion: true, random: () => 0.5 });
    reduced.touch(0);
    expect(run(reduced, 0, 3, [0.5, 0.5]).last.live).toBe(false);
    expect(reduced.state()).toMatchObject({ mode: "live", reducedMotion: true, phase: "still" });
    reduced.configure({ reducedMotion: false });
    expect(run(reduced, 0, 1).last.live).toBe(true);
  });

  it("a pin is the scene's clocks, the baked projector and no frame wanted; unpinned, the policy resumes", () => {
    const amb = createAmbient({ idleMs: 1000, random: () => 0.5 });
    amb.touch(0);
    amb.step(DT, 0, [0.3, 0.3]);
    amb.pin({ time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] });
    const s = amb.step(DT, 100, [0.9, 0.9]);
    expect(s.live).toBe(false);
    expect(s.frame).toEqual({ time: 3.7, goboTime: 57.14, goboMatrix: HERO_MATRIX, noise: [0.37, 0.61] });
    expect(amb.state()).toMatchObject({ phase: "pinned", pinned: true, speed: 0 });
    amb.pin(null);
    expect(amb.step(DT, 200, null).live).toBe(true);
  });

  it("the tilt follows the pointer through the second-order filter WITHIN the wind's window — a ringing over frames, not a jump — and rides the wind's liveness", () => {
    const amb = createAmbient({ mode: "idle", idleMs: 60_000, settleMs: 2000, random: () => 0.5 });
    amb.touch(0);
    const first = amb.step(DT, 0, [0.6, -0.2]);
    expect(first.live).toBe(true);
    expect(first.frame.goboMatrix).not.toBe(HERO_MATRIX);   // the follower has started toward the pointer
    // it rings: the matrix keeps moving over the next frames …
    const mid = run(amb, 16, 30, [0.6, -0.2]);
    expect(mid.last.frame.goboMatrix).not.toEqual(first.frame.goboMatrix);
    // … and converges: two late frames agree to the filter's own tolerance while the wind still blows
    const late = run(amb, mid.now + 1000 * DT, 300, [0.6, -0.2]);
    const later = run(amb, late.now + 1000 * DT, 60, [0.6, -0.2]);
    for (let i = 0; i < 6; i++) expect(Math.abs((later.last.frame.goboMatrix[i] as number) - (late.last.frame.goboMatrix[i] as number))).toBeLessThan(1e-3);
    expect(later.last.live).toBe(true);   // the wind's frame, not the tilt's
    expect(amb.state().phase).toBe("live");
    // a moved pointer re-aims it
    const moved = amb.step(DT, later.now + 1000 * DT, [-0.6, 0.2]);
    expect(moved.frame.goboMatrix).not.toEqual(later.last.frame.goboMatrix);
  });

  it("the tilt settles WITH the wind: past idleMs + settleMs the follower snaps to its target and wants no frame — no tail after the ease (the idle-zero witness)", () => {
    const amb = createAmbient({ mode: "idle", idleMs: 1000, settleMs: 2000, random: () => 0.5 });
    amb.touch(0);
    // the pointer sits off-centre: the follower (f = 1 Hz, ζ = 0.3) rings for seconds on its own — longer than the 3 s policy
    const eased = run(amb, 0, 181, [0.6, -0.2]);   // 3.0 s: the wind reaches exactly 0 here
    expect(amb.state().speed).toBe(0);
    expect(amb.state().phase).toBe("still");
    const after = amb.step(DT, eased.now + 1000 * DT, [0.6, -0.2]);
    expect(after.live).toBe(false);   // the frame after the ease: nothing wanted
    // and the frame it settled on is the frame that stays: the same matrix, no further wake, for as long as the pointer rests
    const { last } = run(amb, eased.now + 2000 * DT, 240, [0.6, -0.2]);
    expect(last.live).toBe(false);
    expect(last.frame.goboMatrix).toEqual(after.frame.goboMatrix);
    expect(last.frame.goboMatrix).not.toEqual(HERO_MATRIX);   // it snapped to the pointer's tilt, not home
    // the wind (live mode) never snaps: the follower keeps ringing while it moves
    const live = createAmbient({ mode: "live", random: () => 0.5 });
    expect(live.step(DT, 0, [0.6, -0.2]).live).toBe(true);
  });
});
