// M24 LT1 (design-019 §3.4): THE SIGHT — where a kind's faces were drawn, folded into one fact per entity per frame: `seen` (drawn in
// the last frame — not in the desk copy behind the hand, not in a capture), `px` (the largest device-px extent there), `held` (drawn in
// the hand). Its FRAME BOUNDARY is the desk's count of frames drawn (`KindHost.frames`): a kind with no records in a slot is never
// prepared and a kind is ticked on steps that draw nothing, so without the count "not asked" cannot tell "culled" from "no frame".
import type { Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import type { RenderTarget, SlotContext } from "../src/kind";
import { createSight, type Seen } from "../src/kit/live";

/** A slot as the sight reads it: its view's zoom and dpr, and the render it is prepared for. */
const slot = (zoom: number, dpr: number, target?: RenderTarget): SlotContext =>
  ({ view: { camX: 0, camY: 0, zoom, width: 1200, height: 800, dpr }, ...(target !== undefined ? { target } : {}) }) as unknown as SlotContext;
const face = { cx: 0, cy: 0, w: 400, h: 250 };
const A = 11 as Entity;
const B = 12 as Entity;
const facts = (m: ReadonlyMap<Entity, Seen>): Record<number, Seen> => Object.fromEntries([...m].map(([e, s]) => [e as number, s]));

/** The desk's count of frames drawn, as `KindHost.frames` answers it: `draw` is one frame — its prepares run while the count reads n, then it is n + 1. */
function desk() {
  let n = 0;
  return { frames: () => n, draw(prepare: () => void = () => {}) { prepare(); n += 1; } };
}

describe("the sight (design-019 §3.4)", () => {
  it("a frame's prepares fold into one fact per entity: seen, its device px through the slot's view, held in the hand", () => {
    const d = desk();
    const sight = createSight(d.frames);
    d.draw(() => { sight.saw(A, slot(1, 2), face); sight.saw(B, slot(0.5, 2, "frame"), face); });
    expect(facts(sight.step())).toEqual({ 11: { seen: true, px: [800, 500], held: false }, 12: { seen: true, px: [400, 250], held: false } });
    expect(sight.of(A)).toEqual({ seen: true, px: [800, 500], held: false });
    // the hand: a carried object drawn under the held camera
    d.draw(() => { sight.saw(A, slot(1.5, 2, "hand"), face); sight.saw(B, slot(0.5, 2), face); });
    expect(facts(sight.step())).toEqual({ 11: { seen: true, px: [1200, 750], held: true } });
  });

  it("CHANGE-ONLY: a step after an unchanged frame says nothing; a zoom moves px", () => {
    const d = desk();
    const sight = createSight(d.frames);
    d.draw(() => sight.saw(A, slot(1, 1), face));
    expect(sight.step().size).toBe(1);
    d.draw(() => sight.saw(A, slot(1, 1), face));
    expect(sight.step().size).toBe(0);
    d.draw(() => sight.saw(A, slot(0.25, 1), face));
    expect(facts(sight.step())).toEqual({ 11: { seen: true, px: [100, 63], held: false } });   // 62.5 → whole device px
  });

  it("THE FRAME BOUNDARY: a step with no frame drawn since says nothing; a frame that did not prepare the kind (culled) says unseen", () => {
    const d = desk();
    const sight = createSight(d.frames);
    d.draw(() => sight.saw(A, slot(1, 1), face));
    sight.step();
    // two input steps in a row that draw nothing (a pointer over the bare mat ticks every kind): nothing moved
    expect(sight.owed()).toBe(false);
    expect(sight.step().size).toBe(0);
    expect(sight.step().size).toBe(0);
    expect(sight.of(A)?.seen).toBe(true);
    // a render OUTSIDE the desk's count (an instrument's batch — the cost rig's `holdCost`, the profiler's ablation — prepares the
    // passes with no frame counted): no frame was drawn for the eye, so nothing moves — and what it prepared is no frame's fact
    sight.saw(A, slot(3, 1), face);
    sight.saw(B, slot(1, 1), face);
    expect(sight.step().size).toBe(0);
    expect(sight.of(A)).toEqual({ seen: true, px: [400, 250], held: false });
    expect(sight.of(B)).toBeUndefined();
    // a frame drawn with A culled — the kind has no records, so its pass is never asked — is the step's word: unseen
    d.draw();
    expect(sight.owed(), "a frame was drawn since the last step: the kind is due").toBe(true);
    expect(facts(sight.step())).toEqual({ 11: { seen: false, px: [0, 0], held: false } });
    expect(sight.owed()).toBe(false);
    // several frames before a step: the LAST frame's prepares are the fact
    d.draw(() => sight.saw(A, slot(1, 1), face));
    d.draw();
    expect(sight.step().size, "seen two frames ago, culled in the last: still unseen, nothing moved").toBe(0);
    d.draw();
    d.draw(() => sight.saw(A, slot(2, 1), face));
    expect(facts(sight.step())).toEqual({ 11: { seen: true, px: [800, 500], held: false } });
  });

  it("…which a sight with no count cannot tell: every step is taken as a frame, so a step after none reads every face unseen (why `KindHost.frames` exists)", () => {
    const sight = createSight();
    sight.saw(A, slot(1, 1), face);
    expect(sight.step().get(A)?.seen).toBe(true);
    expect(sight.step().get(A)?.seen, "a tick on an input step that drew nothing").toBe(false);
    expect(sight.owed()).toBe(false);
  });

  it("the DESK COPY behind a carried object and a CAPTURE are not frames the eye sees: a face behind the hand reads unseen (design-019 §6)", () => {
    const d = desk();
    const sight = createSight(d.frames);
    d.draw(() => sight.saw(A, slot(1, 1), face));
    sight.step();
    // another object picked up: the held frame prepares the copy (once per stamp) and the hand (the carried object alone)
    d.draw(() => { sight.saw(A, slot(1, 0.5, "copy"), face); sight.saw(B, slot(2, 1, "hand"), face); });
    expect(facts(sight.step())).toEqual({ 11: { seen: false, px: [0, 0], held: false }, 12: { seen: true, px: [800, 500], held: true } });
    // a capture between frames prepares again outside any frame: nothing of it is folded
    sight.saw(A, slot(1, 2, "capture"), face);
    d.draw(() => sight.saw(B, slot(2, 1, "hand"), face));
    expect(sight.step().size).toBe(0);
  });

  it("drawn in two slots in one frame (an inside, a departed desk): the larger extent, held if either was", () => {
    const d = desk();
    const sight = createSight(d.frames);
    d.draw(() => { sight.saw(A, slot(0.2, 2), face); sight.saw(A, slot(0.9, 2), face); sight.saw(A, slot(0.5, 2), face); });
    expect(facts(sight.step())).toEqual({ 11: { seen: true, px: [720, 450], held: false } });
  });

  it("forget drops an entity's fact and what the frame saw of it", () => {
    const d = desk();
    const sight = createSight(d.frames);
    d.draw(() => { sight.saw(A, slot(1, 1), face); sight.saw(B, slot(1, 1), face); });
    sight.forget(B);
    expect([...sight.step().keys()]).toEqual([A]);
    sight.forget(A);
    expect(sight.of(A)).toBeUndefined();
    d.draw();
    expect(sight.step().size).toBe(0);
  });
});
