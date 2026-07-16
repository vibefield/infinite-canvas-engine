/**
 * L1 + remaining-L3 frame traces (M4 Opus-1; design-003 red-team scenarios).
 * Each asserts tick-by-tick outcomes against the real loop with REAL picking:
 *   (a) snap non-oscillation — the dragged box stays glued to the guide across
 *       consecutive frames as the pointer moves, and Position == intended + snap;
 *   (b) picking dual pick — radiused Targets hits a nearby box while the exact
 *       TouchesExact falls back to canvas;
 *   (c) marquee single commit — selection flips exactly ONCE at Ended;
 *   (d) resize about anchor — an se-handle drag grows w/h with the nw corner
 *       fixed; cancel restores.
 */
import { describe, expect, it } from "vitest";
import {
  ClaimedBy,
  Drag,
  DropTarget,
  Grab,
  GuideLine,
  OverlapCandidate,
  Position,
  Selected,
  SelectionVersion,
  Size,
  SnapState,
  Targets,
  TouchesExact,
  TransformTween,
  Viewport,
  cancelActiveGestures,
  defineQuery,
} from "../../src";
import { createFullRig } from "./rig-full";

const guideQ = defineQuery([GuideLine]);

describe("trace: snap non-oscillation (design-003 §5.2)", () => {
  it("keeps the dragged box glued to the guide across frames; Position == intended + snap", () => {
    const rig = createFullRig();
    const a = rig.spawnBox({ x: 100, y: 100, w: 80, h: 60, snapSource: true });
    // B is a static SnapTarget; not selectable/movable so it never joins the drag.
    rig.spawnBox({ x: 300, y: 100, w: 80, h: 60, snapTarget: true, selectable: false, movable: false });

    rig.down("mouse", 140, 130); // inside A [100,180]×[100,160]
    rig.step(); // recognizers Possible; picking captures A
    rig.move("mouse", 156, 130); // 16px > slop → Active; origin re-measured at (156,130); A grabbed
    rig.step();
    expect(rig.world.hasTag(a, Selected)).toBe(true); // select-on-grab
    expect(rig.world.read(a, Position)).toEqual({ x: 100, y: 100 }); // no jump on claim

    // Drag A's left edge across the guide at B.left = 300, 1px/frame, staying in threshold.
    // intended.left = Grab.x(100) + (screenX − 156); the guide pins A.left at 300.
    const xs = [353, 354, 355, 356, 357]; // intended.left = 297..301
    const posX: number[] = [];
    const posY: number[] = [];
    for (const sx of xs) {
      rig.move("mouse", sx, 130);
      rig.step();
      posX.push(rig.world.read(a, Position).x);
      posY.push(rig.world.read(a, Position).y);
    }
    // Fixed, non-oscillating: glued to the guide every frame (the bug would flip snapped/unsnapped).
    expect(posX).toEqual([300, 300, 300, 300, 300]);
    expect(posY).toEqual([100, 100, 100, 100, 100]); // top-top aligned → snapDy 0

    // Position == intended + snap, same frame (read the live recognizer state).
    const pointer = rig.pointerEntity("mouse");
    expect(pointer).toBeDefined();
    if (pointer === undefined) return;
    const rec = rig.world.getRelation(pointer, ClaimedBy);
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    const d = rig.world.read(rec, Drag);
    const snap = rig.world.read(rec, SnapState);
    const g = rig.world.read(a, Grab);
    expect(rig.world.read(a, Position).x).toBe(g.x + d.totalX / d.zoomAtClaim + snap.dx);
    expect(snap.dx).not.toBe(0); // snap is actually engaged
  });
});

describe("trace: snap guide chrome pool (design-003 §6; P0 as-built 2026-07-16)", () => {
  /** Live GuideLine entities with their values, in query order. */
  function readGuides(rig: ReturnType<typeof createFullRig>) {
    const out: Array<{ e: number; axis: string; at: number }> = [];
    rig.world.query(guideQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        const g = rig.world.read(e, GuideLine);
        out.push({ e, axis: g.axis, at: g.at });
      }
    });
    return out;
  }

  it("pools GuideLine entities while snapped, holds them stable across frames, reaps on release", () => {
    const rig = createFullRig();
    rig.spawnBox({ x: 100, y: 100, w: 80, h: 60, snapSource: true });
    rig.spawnBox({ x: 300, y: 100, w: 80, h: 60, snapTarget: true, selectable: false, movable: false });

    rig.down("mouse", 140, 130);
    rig.step();
    rig.move("mouse", 156, 130); // past slop → Active, grabbed at origin (no snap yet: 144px apart)
    rig.step();
    expect(readGuides(rig)).toEqual([]); // out of threshold — no guide chrome

    rig.move("mouse", 356, 130); // intended.left = 300 → left-right + y alignment
    rig.step();
    const snapped = readGuides(rig);
    expect(snapped.length).toBeGreaterThan(0);
    expect(snapped.some((g) => g.axis === "x" && g.at === 300)).toBe(true); // the glue line

    // Same pointer position next frame: the pool holds the SAME entities (no
    // per-frame respawn churn — the change-only contract).
    rig.step();
    const held = readGuides(rig);
    expect(held).toEqual(snapped);

    // Release: the pool reaps on the drag-ended frame (the tick system runs
    // with an empty recognizer query — exactly why it is a tick system).
    rig.up("mouse", 356, 130);
    rig.step(2); // Ended frame + reap/cleanup
    expect(readGuides(rig)).toEqual([]);
  });

  it("a DISTANT same-axis edge in the viewport contributes a guide (design-003 §5.2 intended ∪ viewport)", () => {
    const rig = createFullRig();
    // The widgetlab field check (2026-07-16): the target is 400px BELOW the
    // dragged rect — zero AABB overlap, so the intended-rect-only query never
    // saw it. The viewport union is what makes edge-alignment work across the
    // whole visible board (Figma behavior).
    rig.world.setResource(Viewport, { w: 1700, h: 1000, dpr: 1 });
    const a = rig.spawnBox({ x: 100, y: 100, w: 80, h: 60, snapSource: true });
    rig.spawnBox({ x: 300, y: 500, w: 80, h: 60, snapTarget: true, selectable: false, movable: false });

    rig.down("mouse", 140, 130);
    rig.step();
    rig.move("mouse", 156, 130); // past slop → Active; origin re-measured at 156
    rig.step();

    rig.move("mouse", 353, 130); // intended left = 297 — 3px inside the band of 300
    rig.step();
    expect(rig.world.read(a, Position).x).toBe(300); // snapped to the distant edge
    const guides = readGuides(rig);
    expect(guides.some((g) => g.axis === "x" && g.at === 300)).toBe(true);
  });
});

describe("trace: picking dual pick (design-003 §3)", () => {
  it("radiused Targets hits a nearby box; exact TouchesExact falls back to canvas", () => {
    const rig = createFullRig();
    const box = rig.spawnBox({ x: 100, y: 100, w: 80, h: 60 }); // [100,180]×[100,160]

    // Touch pointer (radius 12px): 6px left of the left edge — inside the disc, outside the box.
    rig.down("touch:1", 94, 130);
    rig.step();
    const p = rig.pointerEntity("touch:1");
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(rig.world.getRelation(p, Targets)).toBe(box); // radiused → hits
    expect(rig.world.getRelation(p, TouchesExact)).toBe(rig.canvasSurface); // exact → misses → canvas
  });
});

describe("trace: marquee single commit (design-003 §5.7)", () => {
  it("previews hits every frame but flips selection exactly once at Ended", () => {
    const rig = createFullRig();
    const a = rig.spawnBox({ x: 100, y: 100, w: 60, h: 60 });
    const b = rig.spawnBox({ x: 200, y: 100, w: 60, h: 60 });

    rig.down("mouse", 40, 40); // empty canvas
    rig.step();
    rig.move("mouse", 60, 60); // > slop → Active drag on canvas → RoutedMarquee
    rig.step();
    const vStart = rig.world.getResource(SelectionVersion)?.v ?? 0;

    rig.move("mouse", 280, 180); // marquee now covers both boxes
    rig.step();
    // Preview shows both; selection NOT committed yet; version unchanged during the drag.
    expect(rig.marqueeBuffer.hits).toHaveLength(2);
    expect(rig.marqueeBuffer.hits).toContain(a);
    expect(rig.marqueeBuffer.hits).toContain(b);
    expect(rig.world.hasTag(a, Selected)).toBe(false);
    expect(rig.world.hasTag(b, Selected)).toBe(false);
    expect(rig.world.getResource(SelectionVersion)?.v ?? 0).toBe(vStart);

    const before = rig.world.getResource(SelectionVersion)?.v ?? 0;
    rig.up("mouse", 280, 180);
    rig.step(); // Ended → commit ONCE
    expect(rig.world.hasTag(a, Selected)).toBe(true);
    expect(rig.world.hasTag(b, Selected)).toBe(true);
    const after = rig.world.getResource(SelectionVersion)?.v ?? 0;
    expect(after).toBe(before + 1);
    expect(rig.marqueeBuffer.rect).toBeNull(); // buffer cleared on terminal

    rig.step(2); // reap window — no further bumps
    expect(rig.world.getResource(SelectionVersion)?.v ?? 0).toBe(after);
  });
});

describe("trace: resize about anchor (design-003 §5 item 6)", () => {
  it("se-handle drag grows w/h with the nw corner fixed; cancel restores", () => {
    const rig = createFullRig();
    const box = rig.spawnBox({ x: 100, y: 100, w: 80, h: 60, resizable: true, selected: true });
    // se handle over the box's bottom-right corner (180,160).
    rig.spawnHandle({ anchor: "se", x: 175, y: 155, w: 10, h: 10 });

    rig.down("mouse", 180, 160); // picking → HandleSpec priority → captures the handle
    rig.step();
    rig.move("mouse", 195, 160); // 15px > slop → Active; RoutedResize; resizeClaim attaches Grab
    rig.step();
    expect(rig.world.has(box, Grab)).toBe(true);
    expect(rig.world.read(box, Size)).toEqual({ w: 80, h: 60 }); // no jump on claim

    rig.move("mouse", 215, 180); // total (20,20) from the slop-exit origin
    rig.step();
    expect(rig.world.read(box, Size)).toEqual({ w: 100, h: 80 }); // se grows both
    expect(rig.world.read(box, Position)).toEqual({ x: 100, y: 100 }); // nw corner fixed

    cancelActiveGestures(rig.world);
    rig.step(); // Cancelled → restore from Grab
    expect(rig.world.read(box, Size)).toEqual({ w: 80, h: 60 });
    expect(rig.world.read(box, Position)).toEqual({ x: 100, y: 100 });
    expect(rig.world.has(box, Grab)).toBe(false);
  });
});

/** Drag a provider card into a container and read the drop signals + the move outcome. */
function dragCardOntoContainer(provides: string[]) {
  const rig = createFullRig();
  const card = rig.spawnBox({ x: 100, y: 100, w: 60, h: 60, z: 1, provides });
  const container = rig.spawnBox({
    x: 300,
    y: 100,
    w: 200,
    h: 200,
    z: 0,
    container: true,
    accepts: ["card"],
    selectable: false,
    movable: false,
  });
  rig.down("mouse", 130, 130); // inside the card
  rig.step();
  rig.move("mouse", 145, 130); // slop exit → Active; RoutedMove; origin (145,130)
  rig.step();
  rig.move("mouse", 395, 180); // total (250,50) → card at (350,150), inside the container
  rig.step(); // move applies, THEN dropSystem publishes DropTarget/OverlapCandidate
  const pointer = rig.pointerEntity("mouse");
  const rec = pointer !== undefined ? rig.world.getRelation(pointer, ClaimedBy) : undefined;
  return { rig, card, container, rec };
}

describe("trace: drop consume vs fly-back (design-003 §5 items 4/5)", () => {
  it("accepts-match → DropTarget + OverlapCandidate → consume (reparent intent)", () => {
    const { rig, card, container, rec } = dragCardOntoContainer(["card"]);
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    expect(rig.world.getRelation(rec, DropTarget)).toBe(container); // set regardless of match
    expect(rig.world.hasTag(container, OverlapCandidate)).toBe(true); // accepts ∩ provides ≠ ∅

    rig.up("mouse", 395, 180);
    rig.step(); // Ended → consume
    expect(rig.sink.intents).toHaveLength(1);
    const intent = rig.sink.intents[0];
    expect(intent?.kind).toBe("consume");
    expect(intent?.reparents).toContainEqual({ entity: card, container });
    // Signals cleared on the terminal path.
    expect(rig.world.hasTag(container, OverlapCandidate)).toBe(false);
    expect(rig.world.getRelation(rec, DropTarget)).toBeUndefined();
  });

  it("accepts-mismatch → DropTarget but no OverlapCandidate → fly-back (no commit)", () => {
    const { rig, card, container, rec } = dragCardOntoContainer(["other"]);
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    expect(rig.world.getRelation(rec, DropTarget)).toBe(container); // still set
    expect(rig.world.hasTag(container, OverlapCandidate)).toBe(false); // no accepts match

    rig.up("mouse", 395, 180);
    rig.step(); // Ended → fly-back: NO commit, tween holds the claim
    expect(rig.sink.intents).toHaveLength(0);
    expect(rig.world.has(card, TransformTween)).toBe(true);
  });
});
