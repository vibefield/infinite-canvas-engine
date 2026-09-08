// @vitest-environment node
/**
 * The poles' pure part (design-010 §3.3 D3/D5; design-013 C2, D-C2.2) — the
 * rows `magnet-collect.test.ts` carried for the old collector, re-pointed at
 * `packPoles` and the field's own packer: a world pole projects through the
 * camera, a screen pole is verbatim, a pole at or under zero strength is
 * dropped, the DEGENERATE source (half extents 0, radius 0) packs as the
 * point charge, the first pointer-flagged pole rides the analytic term with
 * its strength and any further one is a source, and the two canned wirings
 * read what they say they read.
 */
import { CursorVisual, createWorld, LocalPointer, Pointer, PointerScreen, PointerWorld, Position } from "@ice/core";
import { describe, expect, it } from "vitest";
import { must } from "./must";
import { Card, DEFAULT_FIELD_CONFIG, packSources, uniformValues } from "../../src/field/layout";
import { cursorVisualPoles, localPointerPoles, NO_POINTER, packPoles, type Pole } from "../../src/compose/poles";

const CAM = { x: 100, y: 50, zoom: 2 };

describe("packPoles — poles onto the field's terms", () => {
  it("projects a world pole through the camera and takes a screen pole verbatim, as degenerate sources (D3)", () => {
    const poles: Pole[] = [
      { x: 150, y: 80, strength: 1, space: "world" },
      { x: 25, y: 35, strength: 0.5, space: "screen" },
      { x: 1, y: 2, strength: 0.25 },   // `space` defaults to world
    ];
    const { pointer, sources } = packPoles(poles, CAM);
    expect(pointer).toBe(NO_POINTER);
    expect(sources).toEqual([
      { cx: (150 - 100) * 2, cy: (80 - 50) * 2, hx: 0, hy: 0, r: 0, strength: 1 },
      { cx: 25, cy: 35, hx: 0, hy: 0, r: 0, strength: 0.5 },
      { cx: (1 - 100) * 2, cy: (2 - 50) * 2, hx: 0, hy: 0, r: 0, strength: 0.25 },
    ]);
  });

  it("skips a pole at or under zero strength (and a NaN one)", () => {
    const { sources } = packPoles([{ x: 0, y: 0, strength: 0 }, { x: 0, y: 0, strength: -1 }, { x: 0, y: 0, strength: Number.NaN }, { x: 3, y: 4, strength: 1, space: "screen" }], CAM);
    expect(sources).toEqual([{ cx: 3, cy: 4, hx: 0, hy: 0, r: 0, strength: 1 }]);
  });

  it("the FIRST pointer-flagged pole is the analytic cursor, strength and all; a second one packs as a source", () => {
    const { pointer, sources } = packPoles(
      [
        { x: 10, y: 20, strength: 0.4, space: "screen", pointer: true },
        { x: 30, y: 40, strength: 1, space: "screen", pointer: true },
        { x: 5, y: 6, strength: 1, space: "screen" },
      ],
      CAM,
    );
    expect(pointer).toEqual({ x: 10, y: 20, on: true, strength: 0.4 });
    expect(sources).toEqual([
      { cx: 30, cy: 40, hx: 0, hy: 0, r: 0, strength: 1 },
      { cx: 5, cy: 6, hx: 0, hy: 0, r: 0, strength: 1 },
    ]);
    // a pointer at zero strength is no pointer: the field's cursor term stays off
    expect(packPoles([{ x: 1, y: 1, strength: 0, pointer: true }], CAM).pointer).toBe(NO_POINTER);
  });

  it("a world pointer projects through the camera like any pole", () => {
    expect(packPoles([{ x: 150, y: 80, strength: 1, pointer: true }], CAM).pointer).toEqual({ x: 100, y: 60, on: true, strength: 1 });
  });
});

describe("the field's packer takes a degenerate source as the point charge", () => {
  it("packs [cx, cy, 0, 0] / [0, strength, 0, 0] — the old magnet grid's pole record, field for field", () => {
    const into = Card.alloc(4);
    const { sources } = packPoles([{ x: 150, y: 80, strength: 0.75 }], CAM);
    const n = packSources(sources, { width: 800, height: 600 }, 60, into);
    expect(n).toBe(1);
    const f32 = new Float32Array(into.bytes, 0, Card.size / 4);
    expect([...f32.slice(0, 4)]).toEqual([100, 60, 0, 0]);
    expect([...f32.slice(4, 8)]).toEqual([0, 0.75, 0, 0]);
  });

  it("a pole just off-screen still packs — the field's reach is the cull pad, scaled by √strength", () => {
    const into = Card.alloc(4);
    const near = packSources([{ cx: -20, cy: 300, hx: 0, hy: 0, r: 0, strength: 1 }], { width: 800, height: 600 }, 60, into);
    const far = packSources([{ cx: -900, cy: 300, hx: 0, hy: 0, r: 0, strength: 1 }], { width: 800, height: 600 }, 60, into);
    expect(near).toBe(1);
    expect(far).toBe(0);
  });

  // The packer truncates AT THE CAP, in order (`MAX_SOURCES` in the field's buffer, two here) —
  // so the order the host hands them in decides who survives a crowded board. D-C4.9 puts the
  // poles first: the cards at the far end drop, never the cursor the user is looking at.
  it("past the cap the LAST sources are the ones dropped", () => {
    const into = Card.alloc(2);
    const pole = { cx: 10, cy: 10, hx: 0, hy: 0, r: 0, strength: 1 };
    const cards = [1, 2, 3].map((i) => ({ cx: 100 * i, cy: 200, hx: 50, hy: 30, r: 8, strength: 1 }));
    expect(packSources([pole, ...cards], { width: 800, height: 600 }, 60, into)).toBe(2);
    const f32 = new Float32Array(into.bytes, 0, 2 * (Card.size / 4));
    expect([...f32.slice(0, 4)]).toEqual([10, 10, 0, 0]);            // the pole survived, first
    expect([...f32.slice(8, 12)]).toEqual([100, 200, 50, 30]);       // and one card behind it
  });
});

describe("the pointer's strength rides the uniforms (magnet.wgsl `u.flags.z`)", () => {
  it("packs the strength into flags.z, and 1 — the plain cursor, the old expression bit for bit — when none is given", () => {
    const view = { camX: 0, camY: 0, zoom: 1, width: 800, height: 600, dpr: 1 };
    expect(uniformValues({ view, pointer: { x: 10, y: 20, on: true, strength: 0.4 } }, DEFAULT_FIELD_CONFIG, 0).flags).toEqual([0, 1, 0.4, 0]);
    expect(uniformValues({ view, pointer: { x: 10, y: 20, on: true } }, DEFAULT_FIELD_CONFIG, 3).flags).toEqual([3, 1, 1, 0]);
    expect(uniformValues({ view, pointer: NO_POINTER }, DEFAULT_FIELD_CONFIG, 0).flags).toEqual([0, 0, 1, 0]);
  });
});

describe("the canned wirings (D5: the host imports neither)", () => {
  it("localPointerPoles reads LocalPointer + PointerScreen entities — the event cell, SCREEN-space, never the lagging derive — flagged as the pointer", () => {
    const world = createWorld();
    // the derive's world cell deliberately DISAGREES with the screen cell: the pole must be the screen's
    world.spawn({ components: [[Pointer, { id: "mouse-1", device: "mouse" }], [PointerScreen, { x: 12, y: 34 }], [PointerWorld, { x: 999, y: 999 }]], tags: [LocalPointer] });
    world.spawn({ components: [[Pointer, { id: "peer", device: "mouse" }], [PointerScreen, { x: 1, y: 1 }]] });   // not local: not a pole
    expect(localPointerPoles({ strength: 0.5 }).read(world)).toEqual([{ x: 12, y: 34, strength: 0.5, space: "screen", pointer: true }]);
  });

  it("cursorVisualPoles reads Position + CursorVisual entities — remote cursors — as plain sources", () => {
    const world = createWorld();
    world.spawn({ components: [[Position, { x: 7, y: 8 }], [CursorVisual, { kind: "remote", pressed: false }]] });
    world.spawn({ components: [[Position, { x: 1, y: 1 }]] });   // no visual: not a pole
    expect(cursorVisualPoles().read(world)).toEqual([{ x: 7, y: 8, strength: 1, space: "world" }]);
  });

  it("both subscribe to the world and hand back an inverse", () => {
    const world = createWorld();
    let woke = 0;
    const off = localPointerPoles().subscribe(world, () => { woke += 1; });
    const off2 = cursorVisualPoles().subscribe(world, () => { woke += 1; });
    expect(typeof off).toBe("function");
    expect(typeof off2).toBe("function");
    off();
    off2();
    expect(woke).toBe(0);
  });

  // D-C4.9. `Position` is the hot column: a system that DECLARES a write on it stamps the column
  // on every tick it runs, and a Tier-1 `observeQuery` fires for the stamp. So this source PULLS.
  it("cursorVisualPoles PULLS its dirt: `changed` drains a collector, and `subscribe` observes nothing", () => {
    const world = createWorld();
    const source = cursorVisualPoles();
    let woke = 0;
    const off = must(source.subscribe, "subscribe")(world, () => { woke += 1; });
    const changed = () => must(source.changed, "changed")(world);
    const cursor = world.spawn({ components: [[Position, { x: 7, y: 8 }], [CursorVisual, { kind: "remote", pressed: false }]] });

    expect(changed()).toBe(true);          // the spawn is dirt, drained here
    expect(changed()).toBe(false);         // …and it is a PULL: the same frame twice is not two facts
    for (let i = 0; i < 60; i++) expect(changed()).toBe(false);

    world.edit(cursor).set(Position, { x: 9, y: 8 });
    expect(changed()).toBe(true);
    expect(changed()).toBe(false);
    expect(woke).toBe(0);                  // …and the wake was never armed: nothing observes
    off();
  });
});
