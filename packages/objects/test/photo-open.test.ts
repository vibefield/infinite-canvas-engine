// @vitest-environment node
// THE PRINT OPENS (petition I55, 2026-11-19): double-click or ⏎ picks a print up into the hand, as the
// whiteboard. Its kind's opening is the smallest flat one — its own rect, an extent and its pixels and nothing else (no tools, no
// word, no motion, the wheel and Esc the hand's) — so `Photo` is openable and `ops.open` takes it; the double-tap router opens it.
// Its own pixels are its picture's `width` × `height` (a host's law that draws a border spreads them over the rect by the share the
// picture fills); a 0 × 0 print has none. Through the BUILDER: a small picture is posed at 1:1 device pixels, a large one fits the
// view, and the person's zoom rides on top. And the hand's GUARDS: while a print is in hand the desk is inert —
// core's held input tags every local pointer `HandledByWidget` and `WheelHandled` — so its carry never lifts it on a press-drag and
// the wheel never turns it (no `PressWheel`), each with its control once it is put down; and in hand it is drawn AT REST under the
// pose, never from its carry's body, which a double-click's own presses leave falling. Every row fails at v0.18.0, where the print
// declares no opening — `Photo.openable` is false and `ops.open` refuses it ("the target is not … whose kind opens") — the last
// because its kind drew a print in hand from that body and read the hand's turn as its facts.
import { Camera, createCanvasEngine, defineQuery, type Entity, Held, HeldView, HOLD_INPUT, type InputMods, LocalPointer, NO_MODS, Pointer, Position, PressWheel, Selected, Size, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder, DEFAULT_GRID, FLUX_REST, MAT_GRID, naturalCap, type ObjectContext, readingTarget } from "@ice/desk";
import { createPhotoCarry, Photo, PHOTO_TYPE, TWIST_PER_WHEEL } from "../src";
import { lampOf } from "../src/paper/paper";
import { borderOf } from "../src/photo/layout";
import { photoKind, type Prints, printRect } from "../src/photo/kind";
import { PHOTO } from "../src/photo/photo";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

/** A small picture: 640 × 427 — at the law's long side the print is 400 × 266.875, 1.6 of its pixels a unit. */
const SMALL = { width: 640, height: 427 };
const near = (a: number, b: number, eps = 1e-9): void => { expect(Math.abs(a - b)).toBeLessThanOrEqual(eps); };
const META: InputMods = { ...NO_MODS, meta: true };
const pointerQ = defineQuery([Pointer, LocalPointer]);
const VIEW = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
const lamp = lampOf(MAT_GRID.plane);

/** A print of `picture` laid centred on (cx, cy) on a fresh engine — the facts its rect is. */
function engineWith(picture: { readonly width: number; readonly height: number }, cx = 400, cy = 300) {
  const ce = createCanvasEngine({ widgets: [Photo], settings: { gestures: { wheel: "zoom" } } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 2 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });   // screen == world
  const at = printRect(cx, cy, picture.width, picture.height);
  const e = ce.ops.spawnWidget(PHOTO_TYPE, { x: at.x, y: at.y, w: at.w, h: at.h, props: { width: picture.width, height: picture.height }, undoable: false });
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(3);
  return { ce, world: ce.world, e, at, step };
}

describe("the print's opening (design-015 §8; petition I55)", () => {
  it("Photo is openable: its kind declares the smallest flat opening — an extent and its pixels, nothing else; no held tools, the wheel and Esc the hand's", () => {
    expect(Photo.openable).toBe(true);
    const open = must(photoKind().open, "the print's opening");
    expect(Object.keys(open).sort()).toEqual(["extent", "natural"]);   // no pose (camera), tools, tool, swatches, readout, openness, spread, page, cursor
    expect(Photo.heldTools).toEqual([]);
    expect([Photo.heldWheel, Photo.heldEscape]).toEqual(["hand", "desk"]);
  });

  it("the open extent is the print's own rect; its own pixels are its picture's width × height — a saved border changes nothing; 0 × 0 has none", () => {
    const open = must(photoKind().open, "the print's opening");
    const r = printRect(400, 300, SMALL.width, SMALL.height);
    const rect = { cx: r.cx, cy: r.cy, w: r.w, h: r.h };
    const props = { blob: "", width: SMALL.width, height: SMALL.height, border: 0.05, angle: 0.3 };
    expect(open.extent({ rect, props })).toEqual(rect);
    expect(must(open.natural)({ rect, props })).toEqual({ w: 640, h: 427 });
    // at the cap it covers its picture's pixels exactly: 400 units at 0.8 CSS px, two device px each — 640
    near(naturalCap(rect, must(open.natural)({ rect, props }), 2) * 2 * rect.w, 640, 1e-9);
    for (const none of [{ width: 0, height: 0 }, { width: 640, height: 0 }, {}, { width: -640, height: 427 }, { width: Number.NaN, height: 427 }]) {
      expect(must(open.natural)({ rect, props: none }), JSON.stringify(none)).toBeUndefined();
    }
  });

  it("a host's law that draws a border insets the picture: its pixels are spread over the rect by the share it fills, so the cap is the picture's own", () => {
    const law = { ...structuredClone(PHOTO), border: 0.05 };
    const open = must(photoKind({ law }).open, "the print's opening");
    const r = printRect(400, 300, SMALL.width, SMALL.height);
    const rect = { cx: r.cx, cy: r.cy, w: r.w, h: r.h };
    const n = must(must(open.natural)({ rect, props: { width: SMALL.width, height: SMALL.height } }), "its pixels");
    const b = 2 * borderOf(rect.w / 2, rect.h / 2, law);   // both sides, world units (photo.wgsl: the picture over the inner rect)
    expect(b).toBeGreaterThan(0);
    near(naturalCap(rect, n, 1), Math.min(SMALL.width / (rect.w - b), SMALL.height / (rect.h - b)), 1e-12);
  });

  it("ops.open no longer refuses a print: it is Held, selected, at the reading size; putDown lets it go", () => {
    const d = engineWith(SMALL);
    try {
      expect(() => d.ce.ops.open(d.e)).not.toThrow();
      expect(d.world.hasTag(d.e, Held)).toBe(true);
      expect(d.world.hasTag(d.e, Selected)).toBe(true);
      expect(d.world.get(d.e, HeldView)).toEqual({ zoom: 1, panX: 0, panY: 0 });
      d.ce.ops.putDown();
      expect(d.world.hasTag(d.e, Held)).toBe(false);
    } finally { d.ce.dispose(); }
  });

  it("two taps on a print open it — the double-tap router asks the catalog, which now says it opens", () => {
    const d = engineWith(SMALL);
    try {
      const mouse = (kind: "down" | "move" | "up", buttons: number): void => {
        d.ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: 400, screenY: 300, buttons, mods: NO_MODS });
        d.step();
      };
      const tap = (): void => { mouse("move", 0); mouse("down", 1); mouse("up", 0); };
      tap();
      expect(d.world.hasTag(d.e, Selected)).toBe(true);
      expect(d.world.hasTag(d.e, Held)).toBe(false);
      tap();
      expect(d.world.hasTag(d.e, Held)).toBe(true);
    } finally { d.ce.dispose(); }
  });
});

describe("the print in the builder's hand (petition I55): never past its own pixels", () => {
  const VP = { width: 1200, height: 800 };

  /** A print of `picture` picked up on a builder in Node at `dpr` and built until the pickup settles. */
  function held(picture: { readonly width: number; readonly height: number }, dpr: number) {
    const d = engineWith(picture);
    const builder = createDeskBuilder(d.world, { objects: [Photo] });
    const build = () => { builder.changed(); return builder.build({ x: 0, y: 0, zoom: 1 }, { ...VP, dpr }, 1 / 60, THEMES.light, DEFAULT_GRID, new Map()); };
    d.ce.ops.open(d.e);
    for (let i = 0; i < 160 && builder.hand()?.settled !== true; i++) build();
    const rect = { cx: d.at.cx, cy: d.at.cy, w: d.at.w, h: d.at.h };
    return { ...d, build, frame: must(builder.hand(), "the print in hand").frame, fit: readingTarget(rect, VP) };
  }

  it("a small picture opens at its own size: 1:1 device pixels at the frame's dpr, centred in the fit — never the fit's 2.518 (fails at v0.18.0)", () => {
    for (const [dpr, s] of [[2, 0.8], [1, 1.6]] as const) {
      const h = held(SMALL, dpr);
      try {
        near(h.fit.s, 672 / 266.875);
        near(h.frame.s, s);
        expect(2 * h.frame.hx * dpr, `${dpr}`).toBeLessThanOrEqual(SMALL.width + 1e-6);
        near(2 * h.frame.hx * dpr, SMALL.width, 1e-6);
        near(2 * h.frame.hy * dpr, SMALL.height, 1e-6);
        near(h.frame.cx, h.fit.cx);
        near(h.frame.cy, h.fit.cy);
      } finally { h.ce.dispose(); }
    }
  });

  it("the person's ⌘-wheel zoom rides ON TOP of the capped fit: HeldView.zoom 2 reads twice the cap", () => {
    const h = held(SMALL, 2);
    try {
      h.world.removeComponent(h.e, HeldView);
      h.world.addComponent(h.e, HeldView, { zoom: 2, panX: 0, panY: 0 });
      near(must(h.build().held, "the print in hand").frame.s, 1.6);
    } finally { h.ce.dispose(); }
  });

  it("a large picture fits the view as every kind does; a print with no picture size (0 × 0) opens to the fit alone", () => {
    for (const picture of [{ width: 6000, height: 4000 }, { width: 0, height: 0 }]) {
      const h = held(picture, 2);
      try { near(h.frame.s, h.fit.s); } finally { h.ce.dispose(); }
    }
  });
});

describe("the hand's guards on an open print (core's held input: the desk is inert while something is held)", () => {
  /**
   * A print on the REAL stack (the wheel zooms the desk, so a wheel the hand let through would show), its carry and its kind's
   * desk state as the layer drives them: a step is the engine's tick, then the carry, the kind's clock and the print resolved (so
   * there is a body to lift). The pose source puts the hand's frame over the print's own rect: a press there is on the object in
   * hand AND on its desk facts — the worst case for the guard.
   */
  function rig() {
    const d = engineWith(SMALL);
    const { world, e, at } = d;
    const kind = photoKind();
    const prints = must(kind.local)({ pass: () => undefined }) as Prints;
    const carry = createPhotoCarry({ world, docs: d.ce.docs, prints: () => prints, isPrint: (q) => q === e, props: Photo.groups[0]?.component, defer: () => {} });
    const ctx = (): ObjectContext => {
      const pos = must(world.get(e, Position));
      const size = must(world.get(e, Size));
      return { entity: e, rect: { cx: pos.x + size.w / 2, cy: pos.y + size.h / 2, w: size.w, h: size.h }, props: { width: SMALL.width, height: SMALL.height, angle: 0 }, flux: FLUX_REST, look: undefined, theme: THEMES.light, lamp, view: VIEW, grid: DEFAULT_GRID, dt: 1 / 60, local: prints };
    };
    let now = 2000;
    const step = (): void => { now += 16; d.ce.step(now); carry.follow(now); prints.tick?.(now); kind.resolve(ctx()); };
    for (let i = 0; i < 3; i++) step();
    d.ce.stack.heldPose.current = { frame: (q) => (q === e ? { cx: at.cx, cy: at.cy, hx: at.w / 2, hy: at.h / 2, s: 1, settled: true } : undefined) };
    let x = at.cx;
    let y = at.cy;
    const mouse = (kind: "down" | "move" | "up", px: number, py: number, buttons: number): void => {
      x = px; y = py;
      d.ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: px, screenY: py, buttons, mods: NO_MODS });
      step();
    };
    const wheel = (dy: number, buttons: number, mods: InputMods = NO_MODS): void => {
      d.ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods, wheel: { dx: 0, dy, pinch: 0 } });
      step();
    };
    const pointer = (): Entity => must(world.firstOf(pointerQ), "the mouse");
    const zoom = (): number => world.getResource(Camera)?.zoom ?? 1;
    return { ...d, prints, carry, mouse, wheel, pointer, zoom };
  }

  it("in hand, a press-drag on it is never the carry's — it is not lifted, its facts never move — and the wheel never turns it (no PressWheel); put down, the same gestures carry and turn it", () => {
    const r = rig();
    try {
      const home = { ...must(r.world.get(r.e, Position)) };
      r.ce.ops.open(r.e);
      r.mouse("move", r.at.cx, r.at.cy, 0);
      r.mouse("down", r.at.cx, r.at.cy, 1);
      expect(r.carry.held()).toEqual([]);
      for (let i = 1; i <= 6; i++) {
        r.mouse("move", r.at.cx + 10 * i, r.at.cy + 5 * i, 1);
        expect(r.carry.held(), `move ${i}`).toEqual([]);
        expect(r.prints.lifted(r.e), `move ${i}`).toBe(false);
      }
      // the plain wheel while the press holds it: no PressWheel, no turn, and the desk's camera never hears it
      r.wheel(100, 1);
      expect(r.world.has(r.pointer(), PressWheel)).toBe(false);
      const body = must(r.prints.body(r.e), "the print's body");
      expect([body.hold, body.h, body.angle]).toEqual([null, 0, 0]);
      expect(r.zoom()).toBe(1);
      // ⌘-wheel brings the HAND closer (HeldView.zoom, the hand's law) — still no turn
      r.wheel(-60, 1, META);
      near(must(r.world.get(r.e, HeldView)).zoom, Math.exp(60 * HOLD_INPUT.wheelRate));
      expect(must(r.prints.body(r.e)).angle).toBe(0);
      expect(r.world.has(r.pointer(), PressWheel)).toBe(false);
      r.mouse("up", r.at.cx + 60, r.at.cy + 30, 0);
      expect(r.world.hasTag(r.e, Held)).toBe(true);   // a drag, not a tap: still in hand
      expect(r.world.get(r.e, Position)).toEqual(home);
      expect(r.carry.commits()).toBe(0);
      expect(r.prints.lifted(r.e)).toBe(false);

      // THE CONTROL: put down, the same press is the carry's and the same wheel turns it about the finger
      r.ce.ops.putDown();
      for (let i = 0; i < 3; i++) r.mouse("move", r.at.cx, r.at.cy, 0);
      r.mouse("down", r.at.cx, r.at.cy, 1);
      expect(r.carry.held()).toEqual([r.e]);
      r.mouse("move", r.at.cx, r.at.cy, 1);
      r.wheel(100, 1);
      expect(r.world.get(r.pointer(), PressWheel)?.dy).toBe(100);
      expect(must(r.prints.body(r.e)).angle).toBeCloseTo(100 * TWIST_PER_WHEEL, 12);
      expect(r.zoom()).toBe(1);   // the carried print took the wheel from the camera too (press-wheel.ts)
      r.mouse("up", r.at.cx, r.at.cy, 0);
    } finally { r.ce.dispose(); }
  });

  it("in hand it is drawn AT REST under the pose — its rect, the pose's turn — never its carry's body: a print a double-click's press left falling opens flat, and lands at its facts owing no rest (fails at v0.18.0: drawn lifted at its desk turn, and a rest owed — a raise committed)", () => {
    const kind = photoKind();
    const prints = must(kind.local)({ pass: () => undefined }) as Prints;
    const r = printRect(400, 300, SMALL.width, SMALL.height);
    const e = 7 as Entity;
    const base = { entity: e, rect: { cx: r.cx, cy: r.cy, w: r.w, h: r.h }, flux: FLUX_REST, look: undefined, theme: THEMES.light, lamp, view: VIEW, grid: DEFAULT_GRID, dt: 1 / 60 };
    const desk: ObjectContext = { ...base, props: { width: SMALL.width, height: SMALL.height, angle: 0.1 }, local: prints };   // turned, as a paste lays it
    let now = 1000;
    const frame = (c: ObjectContext): void => { now += 16; prints.tick?.(now); kind.resolve(c); };
    // on the desk: met, then a tap's press lifts it (the carry's `hold`, at a still finger) and lets it go — a double-click's first half
    frame(desk);
    prints.hold(e, r.cx + 20, r.cy, now / 1000);
    for (let i = 0; i < 6; i++) frame(desk);
    prints.drop(e, now / 1000);
    expect(prints.lifted(e)).toBe(true);
    expect(must(prints.body(e), "the body").h).toBeGreaterThan(0);
    // opened: the builder hands it `held` and the pose's turn (0 once settled) — drawn as a flat print at rest, as with no desk state at all
    const inHand: ObjectContext = { ...base, props: { width: SMALL.width, height: SMALL.height, angle: 0 }, held: { e: 1, open: true, grow: 1, snap: false } };
    expect(kind.resolve({ ...inHand, local: prints })).toEqual(kind.resolve(inHand));
    // …while the body it left lands where its facts are (the desk's turn, 0.1), owing no rest: the carry would commit nothing
    for (let i = 0; i < 400 && prints.lifted(e); i++) frame({ ...inHand, local: prints });
    expect(prints.lifted(e)).toBe(false);
    expect(prints.owed()).toBe(0);
  });
});
