/**
 * Gesture-clock regressions (2026-07-17, the widgetlab click-quirk field find):
 * tap/long-press windows measure the ACCUMULATED CLAMPED clock
 * (FrameInfo.clock), never raw rAF `now` and never event timestamps — rAF
 * timestamps lag wall time by seconds under throttling/headless/software
 * rendering, so any cross-clock `held` evaluates garbage (a real 120 ms click
 * failed to select while an instant one worked).
 *
 * Pinned here:
 *  1. split-frame tap on a LongPressDrag card selects (the widgetlab card
 *     profile — spine.test's tap trace covers only the plain-drag profile);
 *  2. a STALLED frame inside the press contributes ≤ dtClampMs to the tap
 *     window (pre-fix: a 700 ms rAF gap failed a 32 ms-held tap);
 *  3. long-press needs ~500 ms of ENGINE-EXPERIENCED time across stalled
 *     frames (never fires early off one wall-clock jump).
 */
import { describe, expect, it } from "vitest";
import { Grab, LongPressDrag, Selected } from "../../src";
import { createTraceRig } from "./rig";

describe("trace: gesture clock (clamped accumulation)", () => {
  it("split-frame tap on a LongPressDrag card selects", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 100, y: 100 });
    rig.world.addTag(box, LongPressDrag);
    rig.target("mouse", box);
    rig.down("mouse", 110, 110);
    rig.step(8); // ~128 ms held across frames
    rig.up("mouse", 110, 110);
    rig.step(2);
    expect(rig.world.hasTag(box, Selected)).toBe(true);
  });

  it("a stalled frame mid-press does not eat the tap window", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 100, y: 100 });
    rig.world.addTag(box, LongPressDrag);
    rig.target("mouse", box);

    let t = 1000;
    const stepBy = (dt: number): void => {
      t += dt;
      rig.engine.step(t);
    };
    stepBy(16); // baseline frame (rig events land next step)
    rig.down("mouse", 110, 110);
    stepBy(16); // ingest the down
    stepBy(700); // ONE stalled frame — clock advances ≤ 64 ms
    rig.up("mouse", 110, 110);
    stepBy(16); // up: engine-experienced hold ≈ 80 ms < tapMax
    stepBy(16);
    expect(rig.world.hasTag(box, Selected)).toBe(true);
  });

  it("long-press needs engine-experienced time — one wall-clock jump never fires it", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 100, y: 100 });
    rig.world.addTag(box, LongPressDrag);
    rig.target("mouse", box);

    let t = 1000;
    const stepBy = (dt: number): void => {
      t += dt;
      rig.engine.step(t);
    };
    stepBy(16);
    rig.down("mouse", 110, 110);
    stepBy(16); // ingest
    stepBy(600); // wall says 600 ms held; clock says ≤ 64+16
    stepBy(16);
    // Not yet: the hold-to-lift hand-off has NOT happened (no armed drag/Grab).
    expect(rig.world.has(box, Grab)).toBe(false);

    // Accumulate real engine time past 500 ms → hand-off arms; a move drags.
    for (let i = 0; i < 40; i++) stepBy(16);
    rig.move("mouse", 140, 130); // past the dead zone → drag Active → Grab rider
    stepBy(16);
    stepBy(16);
    expect(rig.world.has(box, Grab)).toBe(true);
  });
});
