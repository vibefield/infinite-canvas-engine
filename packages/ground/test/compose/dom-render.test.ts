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
import type { TextureHandle } from "@ice/core";
import { geometry, type RasterStrategy } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import { createDomRender, type ElementCopy, entityOfHost } from "../../src/compose/dom-render";
import { type ContentResidency, createContentResidency } from "../../src/compose/residency";
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
  /** The page side (a card past it takes a private `own` texture — the Q10 path). */
  readonly pageSide?: number;
  /** The device limit Residency clamps an `own` texture to. */
  readonly maxTextureSize?: number;
  /** Wrap the residency the render is handed (the refusal rig above). */
  readonly wrap?: (base: ContentResidency) => ContentResidency;
}

/**
 * The board's residency with `realize` REFUSED for the handles `refuse` names — the table's own
 * answer for a handle it does not know. It deliberately does not destroy the texture the way the
 * real `realize` does on a refusal: DomRender's three `next.destroy()` calls are exactly what these
 * rows measure, and a second destroy would hide whether they ran.
 */
function refusingResidency(base: ContentResidency, refuse: (h: TextureHandle) => boolean, revision: () => number): ContentResidency {
  return {
    get table() { return base.table; },
    attach: (t) => base.attach(t),
    realize: (h, tex, opts) => (refuse(h) ? false : base.realize(h, tex, opts)),
    textureOf: (h) => base.textureOf(h),
    wrote: (e) => base.wrote(e),
    unwrote: (e) => base.unwrote(e),
    isWritten: (e) => base.isWritten(e),
    touch: () => base.touch(),
    onTouch: (cb) => base.onTouch(cb),
    onForget: (cb) => base.onForget(cb),
    contentOf: (e) => base.contentOf(e),
    pagesView: () => base.pagesView(),
    revision,
    collect: () => base.collect(),
    stats: () => base.stats(),
    dispose: () => base.dispose(),
  };
}

function makeBoard(o: BoardOpts = {}) {
  const dpr = o.dpr ?? 1;
  const ce = createCanvasEngine({ widgets: [PROMOTED, PAUSED, SLOW], canvasTypes: [ROOT], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: o.zoom ?? 1, gesturing: false });
  const store = createResidencyStore(o.pageSide === undefined ? {} : { layerSize: o.pageSide });
  const raster = o.raster ?? "band";
  installSurfaceInfra(ce.engine, { residency: { table: store.table, allocator: store.allocator, raster: () => raster, ...(o.maxTextureSize === undefined ? {} : { maxTextureSize: o.maxTextureSize }) } });

  const log: string[] = [];
  const gpu = fakeDevice(log);
  const base = createContentResidency(ce.world);
  base.attach(store.table);
  const residency = o.wrap?.(base) ?? base;

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

  it("a destination SMALLER than the host's raster is refused, counted, and never claimed — the clamped Q10 texture (B9 review blocker 2)", () => {
    // A card past the page side takes a private texture; Residency clamps it to the device limit UNIFORMLY, while
    // the L1 copy writes the element's whole raster (`geometry().written`). Copying past the edge is a validation
    // error, and claiming that write would draw garbage for good — the drift class, reopened.
    const b = makeBoard({ pageSide: 256, maxTextureSize: 300 });
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    expect(b.stats().copies).toBe(1); // a page slot first: 200×120 fits a 256 page
    b.world.edit(card).set(Size, { w: 400, h: 260 }); // past the page: an own texture, clamped 400×260 → 300×195
    b.step(3);
    const entry = must(b.store.table.describe(b.ref(card).texture), "the own entry");
    if (entry.kind !== "own") throw new Error(`expected an own entry, got ${entry.kind}`);
    expect([entry.width, entry.height]).toEqual([300, 195]);
    expect(b.residency.isWritten(card)).toBe(false);
    b.flush(); // the host's box moved: placed this flush, copied on the next
    b.flush();
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, oversize: 1, refused: 0, pending: 0 });
    expect(b.residency.isWritten(card)).toBe(false); // never claimed: the card draws the plate, not garbage
    expect(b.residency.contentOf(card).mode).toBe("plate");
  });

  // D-C4.7. The row above changes DESTINATION on the way (a page slot, then a private texture), so
  // the write it does not claim was never owed. This is the case the B9 review actually named: a
  // card that COPIED, then grew INSIDE its band. `ownFor` clamps the bigger size back to the same
  // numbers, so the handle, the uv and therefore the whole `TextureRef` are identical — nothing in
  // the world says the raster stopped fitting, and the standing write drew the old pixels
  // STRETCHED over the card for as long as it stayed that size.
  it("an oversize refusal CLEARS a standing write — a card that grew inside its band draws its plate, not a stale raster stretched", () => {
    const b = makeBoard({ pageSide: 256, maxTextureSize: 300 });
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.world.edit(card).set(Size, { w: 300, h: 260 });   // past the 256 page: a private texture, unclamped at 300
    b.step(3);
    const entry = must(b.store.table.describe(b.ref(card).texture), "the own entry");
    if (entry.kind !== "own") throw new Error(`expected an own entry, got ${entry.kind}`);
    expect([entry.width, entry.height]).toEqual([300, 260]);
    b.flush();   // the host's box moved: placed this flush
    b.flush();   // …and copied on the next, off the new paint record
    expect(b.stats()).toMatchObject({ copies: 1, oversize: 0 });
    expect(b.residency.isWritten(card)).toBe(true);
    expect(b.residency.contentOf(card).mode).toBe("own");

    const before = { ...b.ref(card) };
    b.world.edit(card).set(Size, { w: 600, h: 520 });   // clamped back to 300×260: the SAME handle
    b.step(3);
    expect({ ...b.ref(card) }).toEqual(before);          // the world says nothing changed
    expect(b.residency.isWritten(card)).toBe(true);      // …so the write still stands here
    b.flush();   // the box moved with the card
    b.flush();   // the copy is refused: 600×520 of raster into a 300×260 destination
    expect(b.stats()).toMatchObject({ copies: 1, oversize: 1 });
    expect(b.residency.isWritten(card)).toBe(false);
    expect(b.residency.contentOf(card).mode).toBe("plate");
  });

  it("the PAGES arm refuses too: a destination rect smaller than the host's raster is never copied into", () => {
    const b = makeBoard();
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, oversize: 0 });
    // A page slot HALF the rect Residency placed. The allocator never writes one (the slot is
    // `geometry().slotSize`, the same call the copy sizes itself from) — this is the arm's proof
    // that the guard is on `dest`, not on the entry's kind.
    const r = b.ref(card);
    b.world.edit(card).set(TextureRef, { ...r, u1: r.u0 + (r.u1 - r.u0) / 2 });
    b.advance(50);   // past the bucket, so the new debt is due rather than deferred
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, oversize: 1 });
    expect(b.residency.isWritten(card)).toBe(false);
  });
});

describe("DomRender · a refused realisation backs off (D-C4.7)", () => {
  // Every flush used to mint a full destination and destroy it again while the table refused —
  // a page array per frame, for as long as the refusal stood. `realize` is a function of the
  // handle and the table's state, so while neither moves there is nothing to try.
  it("mints ONCE over five flushes, destroys what it minted, and keeps the debt", () => {
    let rev = 0;
    const b = makeBoard({ wrap: (base) => refusingResidency(base, () => true, () => rev) });
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    for (let i = 0; i < 5; i++) b.flush();
    const minted = must(b.gpu.made[0], "the page array the first flush minted");
    expect(b.gpu.made).toHaveLength(1);
    expect(b.log).toEqual([`destroy ${minted.name}`]);   // `ensurePages`' own hand, on the create path
    expect(b.stats()).toMatchObject({ copies: 0, backedOff: 4, pending: 1 });
    expect(b.residency.isWritten(card)).toBe(false);

    // The table's revision is the door: a producer registering is not a world change, so nothing
    // journals it — this number is how the render hears about it.
    rev += 1;
    b.flush();
    expect(b.gpu.made).toHaveLength(2);
    b.flush();
    b.flush();
    expect(b.gpu.made).toHaveLength(2);   // …and then it backs off again
    expect(b.stats()).toMatchObject({ copies: 0, backedOff: 6 });
  });

  it("a new HANDLE is a new answer: a re-slot retries without waiting for the revision", () => {
    const b = makeBoard({ wrap: (base) => refusingResidency(base, () => true, () => 0) });
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    b.flush();
    expect(b.gpu.made).toHaveLength(1);
    // a re-size past the page takes a private `own` handle — a destination the refusal never named
    b.world.edit(card).set(Size, { w: 4000, h: 2600 });
    b.step(3);
    b.flush();
    b.flush();
    expect(b.gpu.made.length).toBeGreaterThan(1);
    expect(must(b.gpu.made[1], "the own texture").label).toContain("own");
  });

  it("the GROWTH path destroys the array it grew when the realisation is refused, and grows no more", () => {
    let refuseAfter = false;
    const b = makeBoard({ wrap: (base) => refusingResidency(base, () => refuseAfter, () => 0) });
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    const first = must(b.gpu.made[0], "the first page array");
    expect(b.stats()).toMatchObject({ copies: 1, growths: 0 });

    refuseAfter = true;
    b.store.table.setPageLayers(3);
    b.advance(50);
    b.render.markDirtyHosts([b.paintOf(card)]);
    b.flush();
    const grown = must(b.gpu.made[1], "the grown page array");
    expect(grown.depthOrArrayLayers).toBe(3);
    expect(b.log).toEqual([`destroy ${grown.name}`]);   // the grown array is nobody's
    expect(b.stats()).toMatchObject({ growths: 0, copies: 1 });
    expect(b.log).not.toContain(`destroy ${first.name}`);
    // and the layer copy is not paid for again on the next flushes
    b.flush();
    b.flush();
    expect(b.gpu.made).toHaveLength(2);
    expect(b.stats().backedOff).toBe(2);
  });

  it("the OWN path destroys its refused texture, once", () => {
    const b = makeBoard({ pageSide: 256, wrap: (base) => refusingResidency(base, (h) => base.table?.describe(h)?.kind === "own", () => 0) });
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.world.edit(card).set(Size, { w: 400, h: 260 });   // past the page side: a private texture
    b.step(3);
    b.flush();
    b.flush();
    b.flush();
    const own = must(b.gpu.made.find((t) => t.name.includes("own")), "the own texture");
    expect(b.gpu.made.filter((t) => t.name.includes("own"))).toHaveLength(1);
    expect(b.log).toEqual([`destroy ${own.name}`]);
    // three flushes: the first placed the resized host, the second minted and was refused, the third backed off
    expect(b.stats()).toMatchObject({ copies: 0, backedOff: 1, pending: 1 });
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

  it("a PAUSED card takes its FIRST picture when the world names its destination, then parks: paint marks buy nothing", () => {
    // THE STILL (2026-09-09): `domAtRest` holds the board on the GPU for a drag as paused
    // cards, and a paused card with no pixels must show the picture it had, not the plate.
    // The first copy is owed to the WORLD's debt (the promotion journaled through
    // `TextureRef`); after it the card is as parked as it ever was.
    const b = makeBoard();
    const card = b.spawn("dr:paused", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, stills: 1, parked: 0, deferred: 0, pending: 0 });
    expect(b.residency.contentOf(card).mode).toBe("page");
    const touches = b.residency.stats().touches;
    // A paint mark on the still: parked, no copy, no wake.
    b.render.markDirtyHosts([b.paintOf(card)]);
    b.flush();
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 1, stills: 1, parked: 1, deferred: 0, pending: 0 });
    expect(b.residency.stats().touches).toBe(touches);
    // The ONE door out of parked: demand comes back to a live bucket.
    b.world.edit(card).set(RequestedDemand, { mode: "live", fpsBucket: 60, interactive: false });
    b.step(3);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 2, stills: 1, parked: 0 });
  });

  it("a paused card RE-SLOTTED by the world takes one new picture; a paint mark still does not", () => {
    const b = makeBoard();
    const card = b.spawn("dr:paused", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    expect(b.stats().copies).toBe(1);
    // A resize is a re-slot: Residency names a new destination, DomRender re-boxes the host
    // and copies off the next paint record — the still's rule owes exactly that one picture.
    b.world.edit(card).set(Size, { w: 300, h: 120 });
    b.step(2);
    b.flush();   // the box moves; the copy waits for the relayout
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 2, stills: 2 });
    expect(b.residency.isWritten(card)).toBe(true);
    b.render.markDirtyHosts([b.paintOf(card)]);
    b.flush();
    expect(b.stats()).toMatchObject({ copies: 2, parked: 1 });
  });

  it("a paused surface's paint must not spin the ground — over a HUNDRED ticks, not one flush (carried from demand-parking at B8)", () => {
    // The old leg's `demand-parking.test.ts` was written for a real defect: a
    // dateless mark counted as PENDING turned one off-screen paint into a
    // composite on every rAF, forever. A single flush cannot see that class —
    // the cost is per frame and the state that carries it is `pending`. So the
    // loop, with a live card beside the paused one so the board is genuinely
    // running rather than empty.
    const b = makeBoard();
    const paused = b.spawn("dr:paused", 100);
    const live = b.spawn("dr:promoted", 400);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    const settled = b.stats().copies;   // the live card's first copy, and the paused card's FIRST PICTURE (the still's rule)
    expect(settled).toBe(2);
    expect(b.stats().stills).toBe(1);
    const touches = b.residency.stats().touches;

    let maxPending = 0;
    for (let i = 0; i < 120; i++) {
      b.step();
      b.render.markDirtyHosts([b.paintOf(paused)]);   // an off-screen paint, every frame
      b.flush();
      maxPending = Math.max(maxPending, b.stats().pending);
    }
    // THE PROPERTY: nothing is ever owed, so nothing keeps the ground awake.
    expect(maxPending).toBe(0);
    expect(b.stats()).toMatchObject({ copies: settled, parked: 1, deferred: 0, pending: 0 });
    expect(b.residency.stats().touches).toBe(touches);
    // …and the marks really did arrive: 120 of them, all clamped.
    expect(b.stats().dirtied).toBeGreaterThanOrEqual(120);
    expect(b.residency.contentOf(paused).mode).toBe("page"); // the still it took at promotion, held
    expect(b.residency.contentOf(live).mode).toBe("page");
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

  it("a settled card's host still tracks the camera — placement is NOT a function of the copy debt (B8 R7)", () => {
    // Found by the ported `input` rig: until B8 `placeHost` was reached only
    // through `attempt`, so a card owing no copy was never re-placed and its
    // host stayed where the last copy left it. An L1 host is never painted, so
    // nothing looked wrong — but it IS the hit-test, focus and IME truth, and
    // the rig measured 7 of 24 mid-gesture hits landing, the host up to 540 px
    // from its card.
    const b = makeBoard();
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    expect(b.stats().copies).toBe(1);
    expect(b.styleOf(card).transform).toBe("matrix(1,0,0,1,100,100)");
    expect(b.stats().pending).toBe(0); // nothing owes a copy from here on

    b.world.setResource(Camera, { x: 40, y: 25, zoom: 1, gesturing: true });
    b.step();
    b.flush();
    expect(b.styleOf(card).transform).toBe("matrix(1,0,0,1,60,75)"); // (pos − cam) × zoom
    expect(b.stats().copies).toBe(1); // …and moving a card is not re-rasterising it
    expect(b.stats().resized).toBe(0); // a pan changes the matrix, never the box
  });

  it("this module's OWN placement write never becomes a copy — but a content mark still does (the §4.2 guard, B8 R7)", () => {
    // A placement write raises a paint event, and `changedElements` names the
    // DRAWABLE — the host — never the descendant that mutated. So a placement
    // and a content edit are indistinguishable in SHAPE, and the guard has to
    // be temporal, kept by the writer that knows what it wrote.
    const b = makeBoard();
    const card = b.spawn("dr:promoted", 100);
    b.ce.world.sync();
    b.step(5);
    b.flush();
    const settled = b.stats().copies;
    for (let i = 1; i <= 30; i++) {
      b.world.setResource(Camera, { x: i * 4, y: 0, zoom: 1, gesturing: true });
      b.step();
      b.flush();
      b.render.markDirtyHosts([b.paintOf(card)]); // the placement write's own paint event
    }
    b.flush();
    expect(b.stats().copies).toBe(settled); // THE PROPERTY: a pan uploads nothing
    expect(b.stats().selfDirt).toBe(30); // …and it is the GUARD that made it zero
    expect(b.stats().dirtied).toBe(30); // the marks really arrived
    expect(b.stats().pending).toBe(0);

    // The window is ONE flush: a placement whose paint event never arrived
    // cannot swallow a real content change later. The camera is still now, so
    // nothing is re-placed and the last entry simply ages out.
    b.flush();
    b.flush();
    b.render.markDirtyHosts([b.paintOf(card)]);
    b.flush();
    expect(b.stats().copies).toBe(settled + 1); // a FILTER, not a mute
    expect(b.stats().selfDirt).toBe(30);
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
