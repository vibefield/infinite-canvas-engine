/**
 * M4 spine frame traces (implementation-plan M4 exit; design-003 red-team
 * scenarios). Each trace asserts TICK-BY-TICK outcomes against the real loop:
 * quick tap + shift-tap single toggle, drag claim-frame riders + no-jump,
 * escape one-tick cancel + restore, two concurrent touch drags → two commits,
 * remote-despawn-mid-drag survivor commit, pinch suspension + lift.
 */
import { describe, expect, it } from "vitest";
import {
  ClaimedBy,
  Drag,
  Drags,
  GesturePhases,
  GestureSuspended,
  Grab,
  Position,
  Selected,
  Watches,
  cancelActiveGestures,
} from "../../src";
import { CancelRequest } from "../../src/catalog";
import { createTraceRig } from "./rig";

const P = GesturePhases;

describe("trace: quick tap + shift-tap", () => {
  it("tap selects on the recognition frame; shift-tap toggles exactly once", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100 });
    const b = rig.spawnBox({ x: 300, y: 100 });

    rig.target("mouse", a);
    rig.down("mouse", 110, 110);
    rig.step(); // frame 1: down fact, recognizers spawn (Possible)
    expect(rig.world.hasTag(a, Selected)).toBe(false); // not yet — tap needs the up

    rig.up("mouse", 112, 111); // within slop & window
    rig.step(); // frame 2: WentUp → Recognized → selectBehavior
    expect(rig.world.hasTag(a, Selected)).toBe(true);

    rig.step(2); // reap window passes — no double-fire
    expect(rig.world.hasTag(a, Selected)).toBe(true);

    // Shift-tap b: adds. Shift-tap b again: removes — exactly once.
    rig.target("mouse", b);
    rig.down("mouse", 310, 110, { mods: { shift: true } });
    rig.step();
    rig.up("mouse", 310, 110, { mods: { shift: true } });
    rig.step();
    expect(rig.world.hasTag(a, Selected)).toBe(true);
    expect(rig.world.hasTag(b, Selected)).toBe(true);

    rig.down("mouse", 310, 110, { mods: { shift: true } });
    rig.step();
    rig.up("mouse", 310, 110, { mods: { shift: true } });
    rig.step(); // toggle fires on the marker frame…
    expect(rig.world.hasTag(b, Selected)).toBe(false);
    rig.step(2); // …and never again through the reap window
    expect(rig.world.hasTag(b, Selected)).toBe(false);
    expect(rig.world.hasTag(a, Selected)).toBe(true);
  });
});

describe("trace: drag claim frame", () => {
  it("slop exit claims, attaches riders, selects, and applies the first (no-jump) write SAME frame", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100 });
    const top = rig.spawnBox({ x: 700, y: 700 }); // above a — makes the elevate observable
    rig.target("mouse", a);

    rig.down("mouse", 500, 500);
    rig.step(); // frame 1: recognizers Possible
    expect(rig.world.hasTag(a, Selected)).toBe(false);

    rig.move("mouse", 511, 500); // 11px > 10px slop
    rig.step(); // frame 2: THE claim frame
    const pointer = rig.pointerEntity("mouse");
    expect(pointer).toBeDefined();
    if (pointer === undefined) return;
    const claimant = rig.world.getRelation(pointer, ClaimedBy);
    expect(claimant).toBeDefined();
    if (claimant === undefined) return;
    expect(rig.world.hasTag(claimant, P.tags.Active)).toBe(true);
    expect(rig.world.getRelations(claimant, Drags)).toEqual([a]);
    expect(rig.world.has(a, Grab)).toBe(true);
    expect(rig.world.hasTag(a, Selected)).toBe(true); // select-on-grab
    // Origin measured from dead-zone exit — NO position jump on the claim frame.
    expect(rig.world.read(a, Position)).toEqual({ x: 100, y: 100 });
    // Sibling order elevated as part of the divergence (petition 8): the
    // dragged box moves to the frame tail; the Grab memo remembers it was first.
    expect(rig.stack()).toEqual([top, a]);
    expect(rig.world.read(a, Grab).ord).toBe(0);

    rig.move("mouse", 531, 505); // totals (20, 5) at zoomAtClaim 1
    rig.step(); // frame 3
    expect(rig.world.read(a, Position)).toEqual({ x: 120, y: 105 });

    rig.up("mouse", 531, 505);
    rig.step(); // frame 4: Ended → ONE commit intent; riders removed
    expect(rig.sink.intents).toHaveLength(1);
    const intent = rig.sink.intents[0];
    expect(intent?.kind).toBe("move");
    expect(intent?.writes).toContainEqual(
      expect.objectContaining({ entity: a, value: { x: 120, y: 105 } }),
    );
    expect(rig.world.has(a, Grab)).toBe(false);
    expect(rig.world.getRelations(claimant, Drags)).toEqual([]);

    rig.step(); // frame 5: terminal +1 → reaped
    expect(rig.world.isAlive(claimant)).toBe(false);
  });
});

describe("trace: escape one-tick cancel", () => {
  it("cancels the gesture, restores Position AND sibling order, clears the request, and future gestures work", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100 });
    const top = rig.spawnBox({ x: 700, y: 700 }); // above a — the elevate/restore witness
    rig.target("mouse", a);

    rig.down("mouse", 500, 500);
    rig.step();
    rig.move("mouse", 540, 520); // exits slop — origin re-measures HERE (no jump)
    rig.step();
    rig.move("mouse", 560, 530); // +20/+10 past the dead-zone exit
    rig.step();
    expect(rig.world.read(a, Position)).toEqual({ x: 120, y: 110 });

    cancelActiveGestures(rig.world); // app handler between frames (escape)
    rig.step(); // sweep → Cancelled; behavior restores; cleanup clears the flag
    expect(rig.world.read(a, Position)).toEqual({ x: 100, y: 100 });
    expect(rig.stack()).toEqual([a, top]); // sibling order restored from the memo
    expect(rig.world.has(a, Grab)).toBe(false);
    expect(rig.world.getResource(CancelRequest)?.active).toBe(false); // one-tick, not latched

    // A latched cancel would kill this next gesture (design-003 §4.1).
    rig.up("mouse", 540, 520);
    rig.step(2);
    rig.down("mouse", 500, 500);
    rig.step();
    rig.move("mouse", 515, 500);
    rig.step();
    const pointer = rig.pointerEntity("mouse");
    expect(pointer).toBeDefined();
    if (pointer === undefined) return;
    const claimant = rig.world.getRelation(pointer, ClaimedBy);
    expect(claimant).toBeDefined();
    if (claimant === undefined) return;
    expect(rig.world.hasTag(claimant, P.tags.Active)).toBe(true);
  });
});

describe("trace: two concurrent touch drags (design-003 §9)", () => {
  it("two pointers → two claims → two rider sets → two independent commits", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100 });
    const b = rig.spawnBox({ x: 400, y: 100 });
    rig.target("touch:1", a);
    rig.target("touch:2", b);

    rig.down("touch:1", 110, 110);
    rig.step();
    rig.move("touch:1", 125, 110); // drag 1 claims touch:1 (15px > slop)
    rig.step();

    rig.down("touch:2", 410, 110); // partner is CLAIMED → no pinch, drag 2 spawns free
    rig.step();
    rig.move("touch:2", 410, 130); // drag 2 claims touch:2
    rig.step();

    rig.move("touch:1", 145, 110); // +20 from ITS OWN dead-zone exit
    rig.move("touch:2", 410, 150); // +20 from its exit
    rig.step();
    expect(rig.world.read(a, Position)).toEqual({ x: 120, y: 100 });
    expect(rig.world.read(b, Position)).toEqual({ x: 400, y: 120 });

    rig.up("touch:1", 145, 110);
    rig.step();
    rig.up("touch:2", 410, 150);
    rig.step();

    expect(rig.sink.intents).toHaveLength(2); // two gestures, two commits, two undo steps at M5
    const [first, second] = rig.sink.intents;
    expect(first?.writes.some((w) => w.entity === a)).toBe(true);
    expect(first?.writes.some((w) => w.entity === b)).toBe(false);
    expect(second?.writes.some((w) => w.entity === b)).toBe(true);
    expect(second?.writes.some((w) => w.entity === a)).toBe(false);
  });
});

describe("trace: remote despawn mid-drag (design-003 §8)", () => {
  it("one dead widget never aborts the gesture — survivors keep moving and commit", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100 });
    const b = rig.spawnBox({ x: 300, y: 100 });
    // Select both, then grab a — both drag.
    rig.target("mouse", a);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.up("mouse", 110, 110);
    rig.step(2); // tap → a selected; recognizer reaped
    rig.target("mouse", b);
    rig.down("mouse", 310, 110, { mods: { shift: true } });
    rig.step();
    rig.up("mouse", 310, 110, { mods: { shift: true } });
    rig.step(2); // shift-tap → both selected

    rig.target("mouse", a);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.move("mouse", 125, 110);
    rig.step(); // claim frame: Drags → {a, b}
    expect(rig.world.has(a, Grab)).toBe(true);
    expect(rig.world.has(b, Grab)).toBe(true);

    rig.world.destroy(b); // "remote" delete between frames — edge auto-clears

    rig.move("mouse", 145, 110);
    rig.step(); // survivor keeps moving; nothing throws
    expect(rig.world.read(a, Position)).toEqual({ x: 120, y: 100 });

    rig.up("mouse", 145, 110);
    rig.step();
    expect(rig.sink.intents).toHaveLength(1);
    const intent = rig.sink.intents[0];
    expect(intent?.writes.some((w) => w.entity === a)).toBe(true);
    expect(intent?.writes.some((w) => w.entity === b)).toBe(false); // dead widget: no ghost write
  });
});

describe("trace: pinch suspension (suspend, don't kill)", () => {
  it("second free touch suspends singles; losing it pre-activation lifts suspension and the drag still claims", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100 });
    rig.target("touch:1", a);

    rig.down("touch:1", 110, 110);
    rig.step(); // frame 1: singles for touch:1 (Possible)
    const t1 = rig.pointerEntity("touch:1");
    expect(t1).toBeDefined();
    if (t1 === undefined) return;
    const singles = rig.world.getReverse(t1, Watches);
    expect(singles.length).toBeGreaterThan(0);

    rig.down("touch:2", 200, 200); // second FREE touch
    rig.step(); // frame 2: pinch spawns; t1's singles suspended
    const suspendedNow = singles.filter((rec) => rig.world.hasTag(rec, GestureSuspended));
    expect(suspendedNow.length).toBe(singles.length);

    rig.up("touch:2", 200, 200); // lost before activation (spread never changed)
    rig.step(); // frame 3: pinch → Cancelled
    rig.step(); // frame 4: integrity lifts suspension (pinch terminal)
    const stillSuspended = singles.filter(
      (rec) => rig.world.isAlive(rec) && rig.world.hasTag(rec, GestureSuspended),
    );
    expect(stillSuspended).toHaveLength(0);

    rig.move("touch:1", 125, 110); // resume: drag exits slop with its ACCUMULATED context
    rig.step();
    const claimant = rig.world.getRelation(t1, ClaimedBy);
    expect(claimant).toBeDefined();
    if (claimant === undefined) return;
    expect(rig.world.has(claimant, Drag)).toBe(true);
    expect(rig.world.hasTag(claimant, P.tags.Active)).toBe(true);
  });
});
