/**
 * M6 exit criterion (a): the pinned widget-event contract, end to end.
 *
 * A real host div holds a portaled TodoCard. A `pointerdown` on the card's title
 * <input> is marked `surfaceHandled` by the L0 adapter (native interactive), so
 * NO recognizer claims it and NO drag starts — the card does not move. A
 * `pointerdown` on the card BODY picks the widget and a drag moves it, committing
 * once. Proves natives opt out of canvas gestures while the body stays draggable.
 */
import { Grab, Position, spawnWidget } from "@ice/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeRig } from "./rig";
import "../src/todo-card"; // registers the widget type (side effect)

afterEach(() => {
  document.body.innerHTML = "";
});

const MOUSE = { pointerType: "mouse", pointerId: 1 };

describe("card-board M6 exit (a): widget-event contract", () => {
  it("opts a native <input> out of canvas drags; the card body still drags", () => {
    const rig = makeRig();
    const e = spawnWidget(rig.session.store, rig.world, "todo-card", { x: 100, y: 100 });
    rig.step(4); // project → equip → cull → mount → host div
    rig.render(); // portal the card content into the host
    rig.step();

    const input = rig.title();
    expect(input).not.toBeNull();
    expect(rig.world.read(e, Position).x).toBe(100);

    // (1) OPT-OUT: down on the title input → surfaceHandled → recognizer skips.
    rig.fire(input as HTMLInputElement, "pointerdown", { ...MOUSE, clientX: 150, clientY: 150, buttons: 1 });
    rig.step();
    rig.fire(input as HTMLInputElement, "pointermove", { ...MOUSE, clientX: 185, clientY: 150, buttons: 1 });
    rig.step();
    expect(rig.world.has(e, Grab)).toBe(false); // never claimed
    expect(rig.world.read(e, Position).x).toBe(100); // never moved
    rig.fire(input as HTMLInputElement, "pointerup", { ...MOUSE, clientX: 185, clientY: 150, buttons: 0 });
    rig.step(2); // release + despawn the pointer

    // (2) BODY DRAG: down on the card body → picks the widget → drag moves it.
    const body = rig.card() as HTMLElement;
    rig.fire(body, "pointerdown", { ...MOUSE, clientX: 150, clientY: 150, buttons: 1 });
    rig.step();
    rig.fire(body, "pointermove", { ...MOUSE, clientX: 190, clientY: 150, buttons: 1 });
    rig.step(); // > drag slop → Active, RoutedMove, Grab + select-on-grab
    expect(rig.world.has(e, Grab)).toBe(true);
    rig.fire(body, "pointermove", { ...MOUSE, clientX: 230, clientY: 150, buttons: 1 });
    rig.step();
    expect(rig.world.read(e, Position).x).toBeGreaterThan(100); // moved right
    rig.fire(body, "pointerup", { ...MOUSE, clientX: 230, clientY: 150, buttons: 0 });
    rig.step(2); // Ended → one move commit

    expect(rig.sink.intents.at(-1)?.kind).toBe("move");
  });
});
