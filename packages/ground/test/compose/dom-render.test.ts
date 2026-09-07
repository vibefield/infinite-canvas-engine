// @vitest-environment node
// DomRender (design-013 §8 B4, §6 reflector 5): a promoted DOM card's pixels copied from its
// L1 host into the destination Residency named in its `TextureRef`, and declared written to the
// content residency so the ground draws `page`/`own` instead of the plate. Pinned here, with a
// fake device and a fake element copy — the origin trial is the rig's business, the BOOKKEEPING
// is this file's:
//
//  · the origin is the ref's own numbers — `u0 · side`, `v0 · side`, `z = layer` — and the copy
//    happens ONCE per destination, because a written debt is discharged;
//  · a re-slot is a NEW destination and therefore a new copy;
//  · the demand clamp: paused PARKS (no copy, no wake, outside `pending`), a bucket DEFERS until
//    due, and a live card copies now;
//  · a refused copy (the unpainted host's `InvalidStateError`) is counted and the debt KEPT;
//  · growth (D-B4.1): a bigger array, every live layer copied in one encoder, the new array
//    realised, the old one destroyed only at `collect`;
//  · the zoom-drift proof, as arithmetic: the host box this module writes is `geometry().cssSize`
//    and `ceil(cssSize × dpr)` is `geometry().written`, which is the slot Residency placed — under
//    BOTH raster strategies, at three zooms, from one function.
import {
  alwaysGpu,
  Camera,
  createCanvasEngine,
  createResidencyStore,
  defineCanvasType,
  defineWidget,
  type Entity,
  installSurfaceInfra,
  RequestedDemand,
  Size,
  SurfaceBand,
  SurfaceTarget,
  TextureRef,
  tools,
  Viewport,
  widgets,
} from "@ice/core";
import { geometry, type RasterStrategy } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import { createDomRender, type ElementCopy, entityOfHost } from "../../src/compose/dom-render";
import { createContentResidency } from "../../src/compose/residency";
import { FIT } from "../../src/nav/flight";
import { must } from "./must";

// `createPages` reads the browser's usage-flag namespace; this module loads in Node.
(globalThis as unknown as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= {
  TEXTURE_BINDING: 4,
  COPY_DST: 8,
  COPY_SRC: 2,
  RENDER_ATTACHMENT: 16,
};

// One widget type per FILE (global registry; no test reset).
const PROMOTED = widgets.get("dr:promoted") ?? defineWidget({ type: "dr:promoted", surface: "dom", component: null, defaultSize: { w: 200, h: 120 }, behaviors: [alwaysGpu] });
const PAUSED = widgets.get("dr:paused") ?? defineWidget({ type: "dr:paused", surface: "dom", component: null, defaultSize: { w: 200, h: 120 }, behaviors: [alwaysGpu.with({ paused: true })] });
const SLOW = widgets.get("dr:slow") ?? defineWidget({ type: "dr:slow", surface: "dom", component: null, defaultSize: { w: 200, h: 120 }, behaviors: [alwaysGpu.with({ requestedFps: 5 })] });
const ROOT = defineCanvasType({
  id: "dr:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [PROMOTED, PAUSED, SLOW] } },
  presentation: { camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom } },
});
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];

interface FakeTexture extends GPUTexture {
  readonly name: string;
}
/** A GPUTexture stand-in carrying the three fields this module reads. */
function fakeTexture(name: string, width: number, height: number, layers: number, log: string[]): FakeTexture {
  let views = 0;
  return {
    name,
    label: name,
    format: "rgba8unorm",
    width,
    height,
    depthOrArrayLayers: layers,
    createView: (d?: GPUTextureViewDescriptor) => ({ label: `${name}#${views++}`, dimension: d?.dimension ?? "2d" }) as unknown as GPUTextureView,
    destroy: () => { log.push(`destroy ${name}`); },
  } as unknown as FakeTexture;
}

interface CopyRecord { entity: Entity; texture: string; x: number; y: number; z: number }

/** A device that records what was asked of it and hands back inspectable textures. */
function fakeDevice(log: string[]) {
  const made: FakeTexture[] = [];
  const layerCopies: { from: string; to: string; layer: number; w: number; h: number }[] = [];
  const submits: number[] = [];
  const device = {
    createTexture(d: GPUTextureDescriptor) {
      const size = d.size as number[];
      const t = fakeTexture(`${String(d.label ?? "tex")}#${made.length}`, size[0] ?? 1, size[1] ?? 1, size[2] ?? 1, log);
      made.push(t);
      return t;
    },
    createCommandEncoder() {
      const mine: typeof layerCopies = [];
      return {
        copyTextureToTexture(src: { texture: FakeTexture; origin: { z: number } }, dst: { texture: FakeTexture }, size: { width: number; height: number }) {
          mine.push({ from: src.texture.name, to: dst.texture.name, layer: src.origin.z, w: size.width, h: size.height });
        },
        finish: () => ({ commands: mine }) as unknown as GPUCommandBuffer,
      } as unknown as GPUCommandEncoder;
    },
    queue: {
      submit(list: GPUCommandBuffer[]) {
        for (const b of list) {
          const cmds = (b as unknown as { commands: typeof layerCopies }).commands;
          layerCopies.push(...cmds);
        }
        submits.push(list.length);
      },
    },
  } as unknown as GPUDevice;
  return { device, made, layerCopies, submits };
}

interface BoardOpts {
  readonly raster?: RasterStrategy;
  readonly dpr?: number;
  readonly zoom?: number;
  /** Entities whose copy throws the unpainted-host error. */
  readonly unpainted?: Set<Entity>;
}

function makeBoard(o: BoardOpts = {}) {
  const dpr = o.dpr ?? 1;
  const ce = createCanvasEngine({ widgets: [PROMOTED, PAUSED, SLOW], canvasTypes: [ROOT], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: o.zoom ?? 1, gesturing: false });
  const store = createResidencyStore({});
  const raster = o.raster ?? "band";
  installSurfaceInfra(ce.engine, { residency: { table: store.table, allocator: store.allocator, raster: () => raster } });

  const log: string[] = [];
  const gpu = fakeDevice(log);
  const residency = createContentResidency(ce.world);
  residency.attach(store.table);

  const els = new Map<Entity, HTMLElement>();
  const styleOf = (e: Entity) => (must(els.get(e), "a host").style as unknown as Record<string, string>);
  const hostOf = (e: Entity): HTMLElement | undefined => els.get(e);
  const copies: CopyRecord[] = [];
  let refuse = false;
  const copy: ElementCopy = (_queue, element, texture, origin) => {
    const e = must(entityOfHost(element), "the host's entity");
    if (o.unpainted?.has(e) === true) throw new Error("InvalidStateError: No cached paint record for element");
    if (refuse) return false;
    copies.push({ entity: e, texture: (texture as FakeTexture).name, x: origin.x, y: origin.y, z: origin.z ?? 0 });
    return true;
  };

  let clock = 0;
  const render = createDomRender({
    device: gpu.device,
    world: ce.world,
    residency,
    hosts: { hostOf },
    raster: () => raster,
    now: () => clock,
    copy,
  });

  const spawn = (type: string, x: number): Entity => {
    const e = ce.ops.spawnWidget(type, { x, y: 100, w: 200, h: 120, undoable: false }) as Entity;
    // The dom reflector writes a host's WORLD-unit box the moment it creates it
    // (`createHost` → `writeGeom`); the fake mirrors that, so a card whose band
    // space IS world units (band 1) is copyable on the first flush, as in
    // production, and one whose box really moves waits a frame for the relayout.
    const style: Record<string, string> = { width: "200px", height: "120px" };
    els.set(e, { style, getAttribute: (k: string) => (k === "data-ice-entity" ? String(e) : null) } as unknown as HTMLElement);
    return e;
  };

  let frame = 0;
  // The clamp's clock IS the frame clock here, so a per-frame flush is never
  // throttled by a stopped watch; `advance` moves it on its own for the
  // deferral arm, which needs sub-bucket steps.
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { frame += 16; clock = frame; ce.step(frame); } };
  const flush = (): void => { render.flush(ce.world); };
  const ref = (e: Entity) => must(ce.world.get(e, TextureRef), "a TextureRef");
  const side = must(store.table.describe(store.table.pages()), "the pages entry");

  /** What a paint event hands the latch: the host element, named by its own stamp. */
  const paintOf = (e: Entity): Element => must(els.get(e), "a host") as unknown as Element;

  return {
    ce, world: ce.world, store, residency, render, gpu, log, copies, ref, spawn, step, flush, styleOf, paintOf, side,
    dpr,
    raster,
    advance: (ms: number) => { clock += ms; },
    setRefuse: (v: boolean) => { refuse = v; },
    stats: () => render.stats(),
  };
}

describe("DomRender · the copy the world asked for (B4)", () => {
  it("copies a promoted card ONCE, at the origin its TextureRef names, and says it wrote that destination", () => {
    const b = makeBoard();
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    const r = b.ref(card);
    expect(r.texture).not.toBe(0);
    expect(b.residency.isWritten(card)).toBe(false); // owed
    b.flush();
    const side = (b.side as { size: number }).size;
    expect(b.copies).toEqual([{ entity: card, texture: b.gpu.made[0]?.name, x: Math.round(r.u0 * side), y: Math.round(r.v0 * side), z: r.layer }]);
    expect(b.residency.isWritten(card)).toBe(true);
    expect(b.residency.contentOf(card).mode).toBe("page");
    // The debt is discharged: a second flush with nothing new copies nothing.
    b.flush();
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, refused: 0, unavailable: 0, pending: 0, parked: 0, deferred: 0, growths: 0 });
    expect(b.stats().pagesLayers).toBeGreaterThanOrEqual(1);
  });

  it("a re-slot is a new destination and therefore a new copy — the debt is per DESTINATION, not per card", () => {
    const b = makeBoard();
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    expect(b.stats().copies).toBe(1);
    const before = b.ref(card);
    // A resize re-slots: Residency writes a new rect for the same card.
    b.world.edit(card).set(Size, { w: 400, h: 260 });
    b.step(3);
    const after = b.ref(card);
    expect([after.u1 - after.u0, after.v1 - after.v0]).not.toEqual([before.u1 - before.u0, before.v1 - before.v0]);
    expect(b.residency.isWritten(card)).toBe(false);
    b.flush(); // the host box moved with the card: this flush sizes it
    b.flush(); // …and this one copies off the new paint record
    expect(b.stats().copies).toBe(2);
    // Exactly ONE host box was written: the first was already right (band 1 is
    // world units, which the dom reflector had written), the re-size moved it.
    expect(b.stats().resized).toBe(1);
    expect(b.residency.isWritten(card)).toBe(true);
  });

  it("a PAUSED demand parks the card: no copy, no touch, and nothing pending for a clock to release", () => {
    const b = makeBoard();
    const card = b.spawn("dr:paused", 100);
    b.ce.world.sync();
    b.step(5);
    const touches = b.residency.stats().touches;
    b.flush();
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 0, parked: 1, deferred: 0, pending: 0 });
    expect(b.residency.stats().touches).toBe(touches); // no wake for a card nobody can see
    expect(b.residency.contentOf(card).mode).toBe("plate"); // the plate is the honest picture
    // The ONE door out: demand comes back to a live bucket.
    b.world.edit(card).set(RequestedDemand, { mode: "live", fpsBucket: 60, interactive: false });
    b.step(3);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, parked: 0 });
    expect(b.residency.contentOf(card).mode).toBe("page");
  });

  it("a bucket DEFERS the copy to the moment it allows, and counts it pending until then", () => {
    const b = makeBoard();
    const card = b.spawn("dr:slow", 100); // 5 fps ⇒ 200 ms between copies
    b.ce.world.sync();
    b.step(5);
    b.flush();
    expect(b.stats().copies).toBe(1); // the first is due immediately
    // A repaint 50 ms later is deferred, not dropped.
    b.advance(50);
    b.render.markDirtyHosts([b.paintOf(card)]);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, deferred: 1, pending: 1 });
    b.advance(100);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, deferred: 1 }); // still early
    b.advance(60);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 2, deferred: 0, pending: 0 }); // behind, never wrong
  });

  it("a refused copy is counted and the debt KEPT — a card is briefly absent, never permanently plate", () => {
    const b = makeBoard();
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    // The platform has no method (an old Chromium): `copyElementToTexture`
    // returns false rather than throwing, and the card owes its copy still.
    b.setRefuse(true);
    b.flush();
    // A MISSING METHOD is not a retry: it is counted apart, because no later
    // flush will find one and every promoted card would draw its plate for good.
    expect(b.stats()).toMatchObject({ copies: 0, refused: 0, unavailable: 1, pending: 1 });
    expect(b.residency.isWritten(card)).toBe(false);
    b.setRefuse(false);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, refused: 0, unavailable: 1, pending: 0 });
    expect(b.residency.isWritten(card)).toBe(true);
  });

  it("the platform's own throw (`No cached paint record`) never escapes the flush", () => {
    const unpainted = new Set<Entity>();
    const b = makeBoard({ unpainted });
    const card = b.spawn("dr:promoted", 100);
    unpainted.add(card);
    b.ce.world.sync();
    b.step(5);
    expect(() => b.flush()).not.toThrow();
    expect(b.stats()).toMatchObject({ copies: 0, refused: 1, unavailable: 0, pending: 1 });
    unpainted.delete(card);
    b.flush();
    expect(b.stats().copies).toBe(1);
  });

  it("growth (D-B4.1): a bigger array, every live layer copied in ONE encoder, the new array realised — and the old one destroyed only at collect", () => {
    const b = makeBoard();
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    const first = must(b.gpu.made[0], "the first page array");
    expect(first.depthOrArrayLayers).toBe(1);
    expect(b.stats()).toMatchObject({ pagesLayers: 1, growths: 0 });
    // Residency publishes the allocator's layer count each tick; force more layers.
    b.store.table.setPageLayers(3);
    b.advance(50); // past the 60 fps bucket, so the repaint is due
    b.render.markDirtyHosts([b.paintOf(card)]);
    b.flush();
    const second = must(b.gpu.made[1], "the grown page array");
    expect(second.depthOrArrayLayers).toBe(3);
    expect(b.gpu.layerCopies).toEqual([{ from: first.name, to: second.name, layer: 0, w: first.width, h: first.height }]);
    expect(b.gpu.submits).toEqual([1]); // one encoder, one submit
    expect(b.stats()).toMatchObject({ pagesLayers: 3, growths: 1 });
    expect(b.log).toEqual([]); // nothing destroyed under a command that reads it
    expect(b.residency.collect()).toBe(1);
    expect(b.log).toEqual([`destroy ${first.name}`]);
  });

  it("a DEMOTED card is forgotten — every side table goes with it, so a later promotion starts clean", () => {
    const b = makeBoard();
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    expect(b.stats().copies).toBe(1);
    // Back to the live DOM: no destination, nothing to copy.
    b.world.edit(card).set(SurfaceTarget, { target: "dom" });
    b.step(3);
    b.render.markDirtyHosts([b.paintOf(card)]);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, pending: 0, parked: 0, deferred: 0 });
    expect(b.residency.contentOf(card).mode).toBe("plate");
    // …and a re-promotion copies again, off a slot that is new to this module.
    b.world.edit(card).set(SurfaceTarget, { target: "gpu" });
    b.step(3);
    b.flush();
    b.flush();
    expect(b.stats().copies).toBe(2);
  });

  it("a destroyed card leaves nothing behind", () => {
    const b = makeBoard();
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    b.world.destroy(card);
    b.world.sync();
    b.step(2);
    b.flush();
    expect(b.stats()).toMatchObject({ pending: 0, parked: 0, deferred: 0 });
  });

  it("entityOfHost reads the dom reflector's own stamp, and nothing else", () => {
    expect(entityOfHost({ getAttribute: () => "42" } as unknown as Element)).toBe(42);
    expect(entityOfHost({ getAttribute: () => null } as unknown as Element)).toBeUndefined();
    expect(entityOfHost({ getAttribute: () => "not-a-number" } as unknown as Element)).toBeUndefined();
  });
});

describe("DomRender · the host box IS the slot (the zoom-drift proof, design-013 D9 + §9 Q1)", () => {
  for (const raster of ["band", "crisp"] as const) {
    for (const zoom of [1, 1.9, 3]) {
      it(`${raster} @ zoom ${zoom}: the host CSS box is geometry().cssSize, and ceil(box × dpr) is the slot Residency placed`, () => {
        const b = makeBoard({ raster, dpr: 2, zoom });
        const card = b.spawn("dr:promoted", 100);
        b.ce.world.sync();
        b.step(6);
        // Up to two flushes: the first writes the box, the second copies off the new paint record.
        b.flush();
        b.flush();
        expect(b.stats().copies).toBe(1);

        const size = must(b.world.get(card, Size), "Size");
        const band = must(b.world.get(card, SurfaceBand), "SurfaceBand").band;
        const geo = geometry({ w: size.w, h: size.h }, band, 2, zoom, raster);
        const style = b.styleOf(card);
        expect(style.width).toBe(`${geo.cssSize.w}px`);
        expect(style.height).toBe(`${geo.cssSize.h}px`);
        // The copy takes NO extent: it writes the box × the L1 bitmap's scale.
        expect({ w: Math.ceil(geo.cssSize.w * geo.backingScale), h: Math.ceil(geo.cssSize.h * geo.backingScale) }).toEqual(geo.written);
        // …and that is exactly the rect Residency reserved, read back off the uv.
        const r = b.ref(card);
        const side = (b.side as { size: number }).size;
        expect({ w: Math.round((r.u1 - r.u0) * side), h: Math.round((r.v1 - r.v0) * side) }).toEqual(geo.slotSize);
        // The placement matrix carries the rest — zoom/band under `band`, 1 under `crisp`.
        expect(style.transformOrigin).toBe("0 0");
        expect(style.transform).toBe(`matrix(${geo.placement.w / geo.cssSize.w},0,0,${geo.placement.w / geo.cssSize.w},${100 * zoom},${100 * zoom})`);
      });
    }
  }
});
