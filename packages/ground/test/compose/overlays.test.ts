// @vitest-environment node
/**
 * The OVERLAY seam (design-013 C1) in two halves, both without a GPU.
 *
 * §1 the SLOT — `prepareFrame` and `drawSlot` over recording fakes: the two
 * stages land where D-C1.1 says (field → `under` → frames → `over`), an overlay
 * with no data is never prepared and never drawn, a nested portal slot and a
 * flight's departed slot carry none (D-C1.3), the pool spawns one instance per
 * slot, and — the seam's own witness — a ground with NO overlays registered
 * records exactly the draw calls it recorded before the seam existed.
 *
 * §2 the DRIVER — `createOverlays`: the canvas type's gate, the PULLED dirt (a
 * still world wakes nothing, however many frames pass), and the camera as the
 * other half of a collector's input.
 */
import {
  type CanvasType,
  GuideLine,
  Position,
  PrefabId,
  Selected,
  Size,
  SpacingBar,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  createWorld,
  defineWidget,
  type Entity,
  widgets,
  type World,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import type { Field } from "../../src/field/field";
import type { FieldFrame } from "../../src/field/layout";
import type { FramePass } from "../../src/card/frame-pass";
import type { FillPass } from "../../src/nav/fill-pass";
import { drawFrame, prepareFrame, SlotPool, type GroundFrameInputs, type SlotOverlay, type SlotSet } from "../../src/compose/ground";
import { type OverlayPass, type OverlayStage, wiresOverlay } from "../../src/compose/overlay";
import { createOverlays } from "../../src/compose/overlays";
import { THEMES } from "../../oracle/fixtures/vf-theme";
import { must } from "./must";
import { installGpuGlobals, stubDevice } from "./stub-gpu";

// ---------------------------------------------------------------- §1 the slot

/** Every draw call the frame recorded, in order — one shared log across every fake. */
type Log = string[];

const fakeField = (log: Log, tag: string): Field => {
  const self = {
    config: undefined as unknown,
    stats: { rungs: 0, instances: 0, bakes: 0, surface: "", aux: false },
    prepare: () => {},
    draw: () => { log.push(`${tag}:field`); },
    spawn: () => fakeField(log, `${tag}/child`),
    dispose: () => {},
  };
  return self as unknown as Field;
};
const fakeFrames = (log: Log, tag: string): FramePass => {
  const self = {
    exact: false,
    lines: true,
    prepare: (_v: unknown, _t: unknown, frames: readonly unknown[]) => frames.length,
    drawRange: (_p: unknown, from: number, to: number) => { log.push(`${tag}:frames[${from},${to === Number.MAX_SAFE_INTEGER ? "∞" : to})`); },
    spawn: () => fakeFrames(log, `${tag}/child`),
    dispose: () => {},
  };
  return self as unknown as FramePass;
};
const fakeFill = (log: Log, tag: string): FillPass => {
  const self = { prepare: () => {}, draw: () => { log.push(`${tag}:fill`); }, spawn: () => fakeFill(log, `${tag}/child`), dispose: () => {} };
  return self as unknown as FillPass;
};

interface FakeOverlay extends OverlayPass { readonly calls: { prepares: number; draws: number } }
const fakeOverlay = (log: Log, tag: string, name: string, empty = false): FakeOverlay => {
  const calls = { prepares: 0, draws: 0 };
  const self: FakeOverlay = {
    calls,
    prepare(_e, _f, _d, _t) { calls.prepares += 1; return !empty; },
    draw() { calls.draws += 1; log.push(`${tag}:${name}`); },
    spawn: () => fakeOverlay(log, `${tag}/child`, name, empty),
    dispose() {},
  };
  return self;
};

const slotSet = (log: Log, tag: string, overlays: readonly SlotOverlay[] = []): SlotSet => ({
  field: fakeField(log, tag),
  frames: fakeFrames(log, tag),
  fill: fakeFill(log, tag),
  ...(overlays.length ? { overlays } : {}),
});

const THEME = THEMES.dark;
const VIEW = { camX: 0, camY: 0, zoom: 1, width: 800, height: 600, dpr: 2 };
const POINTER = { x: 0, y: 0, on: false };
const SOUP = { positions: new Float32Array([0, 0, 0]), colors: new Float32Array([1, 1, 1, 1]), vertexCount: 3 };
const encoder = {} as GPUCommandEncoder;
const passEncoder = { setScissorRect() {} } as unknown as GPURenderPassEncoder;
const SIZE = { w: 1600, h: 1200 };

/** Record one whole frame: prepare, then draw. Returns the log. */
function record(root: SlotSet, inputs: GroundFrameInputs, log: Log): Log {
  const pool = new SlotPool(root);
  const prepared = prepareFrame(encoder, root, pool, inputs);
  drawFrame(passEncoder, SIZE, inputs.view.dpr, prepared.incoming, prepared.outgoing);
  return log;
}

const base = (over: Partial<GroundFrameInputs> = {}): GroundFrameInputs => ({
  view: VIEW, pointer: POINTER, sources: [], frames: [{}, {}, {}] as never, theme: THEME, ...over,
});

describe("the overlay seam · the slot", () => {
  it("with NO overlays registered the frame records exactly what it recorded before the seam", () => {
    const log: Log = [];
    // the control: a slot set built the way every caller built one before C1
    expect(record(slotSet(log, "root"), base(), log)).toEqual(["root:field", "root:frames[0,∞)"]);
  });

  it("with overlays registered but no data, neither is prepared and neither draws", () => {
    const log: Log = [];
    const wires = fakeOverlay(log, "root", "wires");
    const guides = fakeOverlay(log, "root", "guides");
    const root = slotSet(log, "root", [{ name: "wires", stage: "under", pass: wires }, { name: "guides", stage: "over", pass: guides }]);
    expect(record(root, base(), log)).toEqual(["root:field", "root:frames[0,∞)"]);
    expect([wires.calls, guides.calls]).toEqual([{ prepares: 0, draws: 0 }, { prepares: 0, draws: 0 }]);
  });

  it("the two STAGES: `under` between the field and the frames, `over` after them", () => {
    const log: Log = [];
    const root = slotSet(log, "root", [
      { name: "wires", stage: "under", pass: fakeOverlay(log, "root", "wires") },
      { name: "guides", stage: "over", pass: fakeOverlay(log, "root", "guides") },
    ]);
    expect(record(root, base({ overlays: { wires: SOUP, guides: SOUP } }), log)).toEqual([
      "root:field", "root:wires", "root:frames[0,∞)", "root:guides",
    ]);
  });

  it("an overlay whose `prepare` says it has nothing (an empty soup) is prepared but not drawn", () => {
    const log: Log = [];
    const wires = fakeOverlay(log, "root", "wires", true);
    const root = slotSet(log, "root", [{ name: "wires", stage: "under", pass: wires }]);
    expect(record(root, base({ overlays: { wires: SOUP } }), log)).toEqual(["root:field", "root:frames[0,∞)"]);
    expect(wires.calls).toEqual({ prepares: 1, draws: 0 });
  });

  it("registration ORDER is draw order within a stage", () => {
    const log: Log = [];
    const root = slotSet(log, "root", [
      { name: "a", stage: "over", pass: fakeOverlay(log, "root", "a") },
      { name: "b", stage: "over", pass: fakeOverlay(log, "root", "b") },
    ]);
    expect(record(root, base({ overlays: { a: SOUP, b: SOUP } }), log)).toEqual(["root:field", "root:frames[0,∞)", "root:a", "root:b"]);
  });

  it("a nested PORTAL slot carries none — the root's overlays draw, the inside's do not (D-C1.3)", () => {
    const log: Log = [];
    const root = slotSet(log, "root", [{ name: "wires", stage: "under", pass: fakeOverlay(log, "root", "wires") }]);
    const portal = { cx: 400, cy: 300, hx: 120, hy: 90, r: 8 };
    const inputs = base({
      overlays: { wires: SOUP },
      frames: [{}, {}, {}] as never,
      portals: [{
        view: { ...VIEW, box: { x: 280, y: 210, w: 240, h: 180 } }, pointer: POINTER, config: {} as never,
        sources: [], frames: [{}] as never, at: 1, plate: [0, 0, 0], present: { opacity: 1, portal },
        // the inside asks for wires; the ground only ever gives its own slot the data it was handed,
        // and the compose host hands a nested slot none — this proves the ground does not invent them
      }],
    });
    const out = record(root, inputs, log);
    expect(out.filter((l) => l.includes("wires"))).toEqual(["root:wires"]);
    // the child drew: its fill, its field and its one frame, and no overlay of its own
    expect(out).toEqual([
      "root:field", "root:wires", "root:frames[0,1)",
      "root/child:fill", "root/child:field", "root/child:frames[0,∞)",
      "root:frames[1,∞)",
    ]);
  });

  it("a flight's DEPARTED slot carries none: only the arriving frame's overlays draw (D-C1.3)", () => {
    const log: Log = [];
    const root = slotSet(log, "root", [{ name: "guides", stage: "over", pass: fakeOverlay(log, "root", "guides") }]);
    const out = record(root, base({
      overlays: { guides: SOUP },
      outgoing: { view: VIEW, pointer: POINTER, config: {} as never, sources: [], frames: [{}] as never, order: "over" },
    }), log);
    expect(out.filter((l) => l.includes("guides"))).toEqual(["root:guides"]);
    expect(out).toEqual(["root:field", "root:frames[0,∞)", "root:guides", "root/child:field", "root/child:frames[0,∞)"]);
  });

  it("the POOL spawns one overlay instance per slot — never the root's own pass twice", () => {
    const log: Log = [];
    const rootPass = fakeOverlay(log, "root", "wires");
    const root = slotSet(log, "root", [{ name: "wires", stage: "under", pass: rootPass }]);
    const pool = new SlotPool(root);
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a.overlays?.[0]?.pass).not.toBe(rootPass);
    expect(b.overlays?.[0]?.pass).not.toBe(a.overlays?.[0]?.pass);
    expect(a.overlays?.[0]?.name).toBe("wires");
    expect(a.overlays?.[0]?.stage).toBe("under" satisfies OverlayStage);
    // and a reset hands the SAME instances back out — no churn per frame
    pool.reset();
    expect(pool.acquire().overlays?.[0]?.pass).toBe(a.overlays?.[0]?.pass);
  });

  it("the pass is handed the SLOT's frame — its view, and its presentation for the chain", () => {
    const log: Log = [];
    let seen: FieldFrame | null = null;
    const pass: OverlayPass = {
      prepare(_e, frame) { seen = frame; return true; },
      draw() { log.push("root:wires"); }, spawn: () => pass, dispose() {},
    };
    const root = slotSet(log, "root", [{ name: "wires", stage: "under", pass }]);
    const present = { opacity: 0.5, portal: { cx: 100, cy: 100, hx: 40, hy: 30, r: 4 } };
    record(root, base({ overlays: { wires: SOUP }, present }), log);
    expect(seen).not.toBeNull();
    expect((seen as unknown as FieldFrame).view).toBe(VIEW);
    expect((seen as unknown as FieldFrame).present).toBe(present);
  });
});

// ---------------------------------------------------------------- §2 the driver

const NODE =
  widgets.get("overlays:test-node") ??
  defineWidget({
    type: "overlays:test-node", surface: "dom", component: null, defaultSize: { w: 100, h: 60 },
    ports: [{ id: "out", side: "e" }, { id: "in", side: "w" }],
  });

const FRAME = { width: 800, height: 600, dpr: 1, camera: { x: 0, y: 0, zoom: 1 } };

function boardWorld(): { world: World; a: Entity; b: Entity } {
  const world = createWorld();
  const spawn = (x: number, y: number) => world.spawn({ components: [[PrefabId, { id: NODE.type }], [Position, { x, y }], [Size, { w: 100, h: 60 }]] });
  const a = spawn(0, 0);
  const b = spawn(300, 40);
  const wire = world.spawn({ components: [[WirePorts, { from: "out", to: "in" }]], tags: [Wire] });
  world.setRelation(wire, WireFrom, a);
  world.setRelation(wire, WireTo, b);
  world.spawn({ components: [[GuideLine, { axis: "x", at: 150, from: 0, to: 0 }]] });
  world.spawn({ components: [[SpacingBar, { axis: "x", from: 100, to: 300, perp: 200, gap: 200 }]] });
  return { world, a, b };
}

/** A canvas seam whose type the test swaps under it (the facade's `engine.canvas`, mirrored). */
function fakeCanvas(initial: CanvasType | undefined) {
  let type = initial;
  const subs = new Set<() => void>();
  return {
    seam: { type: () => type, subscribe: (cb: () => void) => { subs.add(cb); return () => subs.delete(cb); } },
    set(next: CanvasType | undefined) { type = next; for (const cb of subs) cb(); },
  };
}
const typeWith = (ground: { wires?: boolean; guides?: boolean }): CanvasType =>
  ({ id: "t", semanticVersion: 1, semantic: { placement: { widgets: [] } }, presentation: { ground: { glyph: "dot", ...ground } }, __canvasType: true }) as unknown as CanvasType;

describe("the overlay seam · a pooled slot's overlay allocates lazily", () => {
  // D-C1.3 gives a nested portal slot and the flight's departed slot NO overlay data, ever — and
  // every one of them used to mint a uniform buffer and a bind group per registered overlay the
  // moment the pool spawned it. A board flying into a folder pays that for wires and guides it
  // will not draw. The instance is the slot's; the MEMORY is the first prepare with data.
  it("acquiring a pooled slot mints nothing; the first prepare WITH data mints the buffer and the group, once", async () => {
    installGpuGlobals();
    const gpu = stubDevice();
    const root = await wiresOverlay().create(gpu.device, "rgba8unorm");
    expect([gpu.buffers, gpu.bindGroups]).toEqual([0, 0]);   // the root pass itself allocates nothing at create

    const log: Log = [];
    const pool = new SlotPool(slotSet(log, "root", [{ name: "wires", stage: "under", pass: root }]));
    const slot = pool.acquire();
    const spawned = must(slot.overlays?.[0], "the pooled slot's wires instance").pass;
    expect(spawned).not.toBe(root);
    expect([gpu.buffers, gpu.bindGroups]).toEqual([0, 0]);   // …and neither does the slot it spawned

    // a slot with no data prepares nothing and still allocates nothing
    expect(spawned.prepare(encoder, { view: VIEW, pointer: POINTER }, undefined, THEME)).toBe(false);
    expect([gpu.buffers, gpu.bindGroups]).toEqual([0, 0]);

    // the first prepare with data: the two vertex buffers, the uniform buffer, one bind group
    expect(spawned.prepare(encoder, { view: VIEW, pointer: POINTER }, SOUP, THEME)).toBe(true);
    expect(gpu.buffers).toBe(3);
    expect(gpu.bindGroups).toBe(1);
    // and never again for the same soup
    expect(spawned.prepare(encoder, { view: VIEW, pointer: POINTER }, SOUP, THEME)).toBe(true);
    expect([gpu.buffers, gpu.bindGroups]).toEqual([3, 1]);
    spawned.dispose();
    root.dispose();
  });
});

describe("the overlay seam · the driver", () => {
  it("collects both soups on the first build, under the names the ground knows", () => {
    const { world } = boardWorld();
    const d = createOverlays(world);
    const out = d.build(FRAME);
    expect(Object.keys(out ?? {}).sort()).toEqual(["guides", "wires"]);
    expect(d.stats().wires).toBeGreaterThan(0);
    expect(d.stats().guides).toBeGreaterThan(0);
    d.dispose();
  });

  it("the canvas type's GATE turns each one off on its own, and a switch flips it live", () => {
    const { world } = boardWorld();
    const canvas = fakeCanvas(typeWith({ wires: false }));
    const d = createOverlays(world, { canvas: canvas.seam });
    let woke = 0;
    const disarm = d.observe(() => { woke += 1; });
    expect(Object.keys(d.build(FRAME) ?? {})).toEqual(["guides"]);
    expect(d.stats().wiresOn).toBe(false);

    canvas.set(typeWith({ guides: false }));
    expect(woke).toBe(1);
    expect(Object.keys(d.build(FRAME) ?? {})).toEqual(["wires"]);

    canvas.set(typeWith({}));
    expect(Object.keys(d.build(FRAME) ?? {}).sort()).toEqual(["guides", "wires"]);
    // a switch that changes neither boolean does NOT wake the ground
    const before = woke;
    canvas.set(typeWith({ wires: true, guides: true }));
    expect(woke).toBe(before);
    disarm();
    d.dispose();
  });

  it("a type with no ground declaration leaves both ON (the default the old host reconciled to)", () => {
    const { world } = boardWorld();
    const canvas = fakeCanvas(undefined);
    const d = createOverlays(world, { canvas: canvas.seam });
    expect(d.stats().wiresOn && d.stats().guidesOn).toBe(true);
    d.dispose();
  });

  it("the dirt is PULLED: a still world wakes nothing however many frames pass — and one write does", () => {
    const { world, a } = boardWorld();
    const d = createOverlays(world);
    d.changed();                       // drain the spawns
    d.build(FRAME);
    expect(d.stats().collects).toBe(1);
    for (let i = 0; i < 120; i++) { expect(d.changed()).toBe(false); d.build(FRAME); }
    expect(d.stats().collects).toBe(1);   // idle-zero: 120 frames, no re-collection

    world.edit(a).set(Position, { x: 40, y: 0 });
    expect(d.changed()).toBe(true);
    d.build(FRAME);
    expect(d.stats().collects).toBe(2);
    d.dispose();
  });

  it("a selection is a wake (the wires widen), and so is a guide appearing", () => {
    const { world, a } = boardWorld();
    const d = createOverlays(world);
    d.changed();
    d.build(FRAME);
    world.addTag(a, Selected);
    expect(d.changed()).toBe(true);
    world.spawn({ components: [[GuideLine, { axis: "y", at: 90, from: 0, to: 0 }]] });
    expect(d.changed()).toBe(true);
    d.dispose();
  });

  it("the CAMERA is the other half of the input: a pan re-collects without any world dirt", () => {
    const { world } = boardWorld();
    const d = createOverlays(world);
    d.changed();
    const at0 = d.build(FRAME);
    expect(d.stats().collects).toBe(1);
    const at1 = d.build({ ...FRAME, camera: { x: 120, y: 0, zoom: 1 } });
    expect(d.stats().collects).toBe(2);
    expect(at1).not.toBe(at0);
    // …and the same camera again re-uses the very soups, so the pass skips its upload
    const at1again = d.build({ ...FRAME, camera: { x: 120, y: 0, zoom: 1 } });
    expect(at1again).toBe(at1);
    expect(d.stats().collects).toBe(2);
    d.dispose();
  });

  it("the connect PREVIEW reaches the collector", () => {
    const { world } = boardWorld();
    const plain = createOverlays(world);
    const withPreview = createOverlays(world, { readWirePreview: () => ({ active: true, compatible: false, sx: 0, sy: 0, tx: 400, ty: 200 }) });
    const a = plain.build(FRAME)?.wires as { vertexCount: number };
    const b = withPreview.build(FRAME)?.wires as { vertexCount: number };
    expect(b.vertexCount).toBeGreaterThan(a.vertexCount);
    plain.dispose();
    withPreview.dispose();
  });

  it("an empty world draws nothing at all — no entry, so no pass prepares", () => {
    const d = createOverlays(createWorld());
    expect(d.build(FRAME)).toBeUndefined();
    d.dispose();
  });

  it("dispose stops it dead: no more dirt, no more builds", () => {
    const { world, a } = boardWorld();
    const d = createOverlays(world);
    d.build(FRAME);
    d.dispose();
    world.edit(a).set(Position, { x: 999, y: 0 });
    expect(d.changed()).toBe(false);
    expect(d.build(FRAME)).toBeUndefined();
  });
});

describe("the overlay seam · an EMPTY board is a cached answer", () => {
  // The ordinary board has no wires and no guides. `undefined` is its collection's honest result,
  // and it was also the cache's "nothing cached" sentinel — so both soups were re-collected on
  // EVERY painted frame, for as long as the board stayed empty. `collects`'s own doc said it never
  // ran once per frame.
  it("collects ONCE over a hundred painted frames, and still re-collects when the camera or a fact moves", () => {
    const world = createWorld();
    const d = createOverlays(world);
    d.changed();
    expect(d.build(FRAME)).toBeUndefined();
    expect(d.stats().collects).toBe(1);
    for (let i = 0; i < 100; i++) expect(d.build(FRAME)).toBeUndefined();
    expect(d.stats().collects).toBe(1);

    // the cache is still a cache, not a latch: the camera is half the input
    expect(d.build({ ...FRAME, camera: { x: 40, y: 0, zoom: 1 } })).toBeUndefined();
    expect(d.stats().collects).toBe(2);
    // …and a guide appearing on the empty board is collected and drawn
    world.spawn({ components: [[GuideLine, { axis: "x", at: 150, from: 0, to: 0 }]] });
    expect(d.changed()).toBe(true);
    expect(Object.keys(d.build(FRAME) ?? {})).toEqual(["guides"]);
    expect(d.stats().collects).toBe(3);
    d.dispose();
  });
});
