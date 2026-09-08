// @vitest-environment node
// The content residency (design-013 §4, §5, §10.2 — B4a, the trunk B4/B5/B6 build on): a
// card's `TextureRef`, written by core's Residency system, becomes the record's content
// term — `own` for a gl island's private target, `page` for a promoted dom card's atlas
// slot — once a render reflector has REALISED the handle on the ground's device and WROTE
// the destination; until then the plate (`empty` is never sampled). Pinned: the target
// through `effectiveTarget`; the sRGB variant from the texture's ACTUAL format; the page
// array's view re-derived on re-realisation, the old array destroyed only at `collect`
// (after the submit); a dead card's own texture destroyed through the table's drain; the
// builder's `content` wake and its `textured` count; the profile owning the table.
import { describe, expect, it } from "vitest";
import {
  alwaysGpu,
  createCanvasEngine,
  createResidencyStore,
  defineCanvasType,
  defineWidget,
  installSurfaceInfra,
  NO_TEXTURE,
  TextureRef,
  Viewport,
  tools,
  widgets,
  type Entity,
} from "@ice/core";
import { createFrameBuilder } from "../../src/compose/frame-inputs";
import { createContentResidency, refKeyOf, targetOf } from "../../src/compose/residency";
import { DEFAULT_FIELD_CONFIG } from "../../src/field/layout";
import { FIT } from "../../src/nav/flight";
import { THEMES } from "../../oracle/fixtures/vf-theme";
import { must } from "./must";

// One widget type per FILE (global registry; no test reset).
const DOM = widgets.get("cr:dom") ?? defineWidget({ type: "cr:dom", surface: "dom", component: null, defaultSize: { w: 200, h: 120 } });
const PROMOTED = widgets.get("cr:promoted") ?? defineWidget({ type: "cr:promoted", surface: "dom", component: null, defaultSize: { w: 200, h: 120 }, behaviors: [alwaysGpu] });
const ISLAND = widgets.get("cr:island") ?? defineWidget({ type: "cr:island", surface: "gl", component: null, defaultSize: { w: 240, h: 160 } });
const ROOT = defineCanvasType({
  id: "cr:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [DOM, PROMOTED, ISLAND] } },
  presentation: { camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom } },
});
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];
const VP = { width: 1600, height: 900, dpr: 1 };
const CAM = { x: 0, y: 0, zoom: 1 };

/** A GPUTexture stand-in: the residency only reads `format`, makes views and destroys. */
function fakeTexture(format: GPUTextureFormat, log: string[], name: string): GPUTexture {
  let views = 0;
  return {
    format,
    createView: (d?: GPUTextureViewDescriptor) => ({ label: `${name}#${views++}`, dimension: d?.dimension ?? "2d" }) as unknown as GPUTextureView,
    destroy: () => { log.push(`destroy ${name}`); },
  } as unknown as GPUTexture;
}

function makeBoard() {
  const ce = createCanvasEngine({ widgets: [DOM, PROMOTED, ISLAND], canvasTypes: [ROOT], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: 1 });
  const store = createResidencyStore({});
  const uninstall = installSurfaceInfra(ce.engine, { residency: { table: store.table, allocator: store.allocator } });
  const dom = ce.ops.spawnWidget("cr:dom", { x: 100, y: 100, w: 200, h: 120, undoable: false });
  const promoted = ce.ops.spawnWidget("cr:promoted", { x: 400, y: 100, w: 200, h: 120, undoable: false });
  const island = ce.ops.spawnWidget("cr:island", { x: 700, y: 100, w: 240, h: 160, undoable: false });
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  ce.world.sync();
  step(5); // membership, cull, band, demand, residency
  const residency = createContentResidency(ce.world);
  const builder = createFrameBuilder(ce.world, { residency });
  const build = () => builder.build(CAM, VP, 1 / 60, THEMES.dark, DEFAULT_FIELD_CONFIG);
  const ref = (e: Entity) => must(ce.world.get(e, TextureRef), "a TextureRef");
  return { ce, world: ce.world, step, store, uninstall, residency, builder, build, ref, dom, promoted, island };
}

describe("the content residency · the two doors the C4 backoff needs (D-C4.7)", () => {
  it("`unwrote` is the inverse of `wrote`: the card draws its plate again, and the frame is told", () => {
    const { store, residency, ref, island } = makeBoard();
    residency.attach(store.table);
    residency.realize(ref(island).texture, fakeTexture("rgba8unorm", [], "island"));
    expect(residency.wrote(island)).toBe(true);
    expect(residency.contentOf(island).mode).toBe("own");
    let woke = 0;
    const off = residency.onTouch(() => { woke += 1; });
    residency.unwrote(island);
    expect(residency.isWritten(island)).toBe(false);
    expect(residency.contentOf(island).mode).toBe("plate");
    expect(woke).toBe(1);                       // the pixels a frame shows changed: the builder wakes
    residency.unwrote(island);
    expect(woke).toBe(1);                       // …and a card that owed nothing is not a change
    off();
  });

  it("`revision` is the table's — the number a producer's registration moves, which no journal carries", () => {
    const { store, residency, island } = makeBoard();
    expect(residency.revision()).toBe(0);       // before the attach there is no table to ask
    residency.attach(store.table);
    const before = residency.revision();
    expect(before).toBe(store.table.revision());
    store.table.register(island, { width: 8, height: 8, srgb: false });
    expect(residency.revision()).toBe(store.table.revision());
    expect(residency.revision()).toBeGreaterThan(before);
  });
});

describe("the content residency · what a handle is on the ground (B4a)", () => {
  it("names the target through effectiveTarget: dom stays dom, gl is gpu, a card without surface facts is dom", () => {
    const { world, dom, promoted, island } = makeBoard();
    expect(targetOf(world, dom)).toBe("dom");
    expect(targetOf(world, promoted)).toBe("gpu");
    expect(targetOf(world, island)).toBe("gpu");
    expect(targetOf(world, 999_999 as Entity)).toBe("dom");
  });

  it("Residency wrote the facts: the island owns a private handle, the promoted card a page slot, the dom card none", () => {
    const { store, ref, dom, promoted, island } = makeBoard();
    expect(ref(dom).texture).toBe(NO_TEXTURE);
    const own = ref(island);
    expect(own.texture).not.toBe(NO_TEXTURE);
    expect(store.table.describe(own.texture)?.kind).toBe("own");
    expect([own.u0, own.v0, own.u1, own.v1]).toEqual([0, 0, 1, 1]);
    const page = ref(promoted);
    expect(store.table.describe(page.texture)?.kind).toBe("pages");
    expect(page.u1).toBeGreaterThan(page.u0);
    expect(page.v1).toBeGreaterThan(page.v0);
  });

  it("draws the plate until the handle is realised AND the destination written; then `own` with the sRGB variant from the ACTUAL format", () => {
    const { store, residency, ref, island } = makeBoard();
    const log: string[] = [];
    // before attach: nothing is a texture
    expect(residency.contentOf(island).mode).toBe("plate");
    residency.attach(store.table);
    expect(residency.contentOf(island).mode).toBe("plate");                // known handle, not realised
    const tex = fakeTexture("rgba8unorm-srgb", log, "island");
    expect(residency.realize(ref(island).texture, tex)).toBe(true);
    expect(residency.contentOf(island).mode).toBe("plate");                // realised, never written: `empty` is never sampled
    expect(residency.isWritten(island)).toBe(false);
    expect(residency.wrote(island)).toBe(true);
    const c = residency.contentOf(island);
    expect(c.mode).toBe("own");
    if (c.mode !== "own") throw new Error("unreachable");
    expect(c.srgb).toBe(true);                                             // the texture's format, not the table's flag (design-012 §4)
    expect(c.uv).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
    expect(residency.textureOf(ref(island).texture)).toBe(tex);
    expect(residency.stats()).toMatchObject({ realized: 1, written: 1, destroyed: 0 });
    // the same texture again is a no-op; a plain one flips the variant
    expect(residency.realize(ref(island).texture, tex)).toBe(true);
    expect(residency.stats().realized).toBe(1);
    // an unknown handle: refused, the texture destroyed here
    expect(residency.realize(9999, fakeTexture("rgba8unorm", log, "stray"))).toBe(false);
    expect(log).toEqual(["destroy stray"]);
  });

  it("a promoted dom card samples its page layer and written rect through the ONE page array; the array's view follows a re-realisation, the old array dying at collect", () => {
    const { store, residency, ref, promoted } = makeBoard();
    residency.attach(store.table);
    const log: string[] = [];
    expect(residency.pagesView()).toBeNull();
    const pages0 = fakeTexture("rgba8unorm", log, "pages0");
    expect(residency.realize(store.table.pages(), pages0)).toBe(true);
    const v0 = residency.pagesView();
    expect(v0).not.toBeNull();
    expect((v0 as unknown as { dimension: string }).dimension).toBe("2d-array");
    expect(residency.contentOf(promoted).mode).toBe("plate");
    residency.wrote(promoted);
    const c = residency.contentOf(promoted);
    const r = ref(promoted);
    expect(c).toEqual({ mode: "page", layer: r.layer, uv: { u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1 } });
    // growth (D-B4.1): a new array replaces the old; the view is new; the old array is destroyed AFTER the frame, at collect
    const pages1 = fakeTexture("rgba8unorm", log, "pages1");
    residency.realize(store.table.pages(), pages1);
    expect(residency.pagesView()).not.toBe(v0);
    expect(log).toEqual([]);
    expect(residency.collect()).toBe(1);
    expect(log).toEqual(["destroy pages0"]);
    expect(residency.contentOf(promoted).mode).toBe("page");               // the written debt survives growth: same handle, layer, rect
  });

  it("a dead card's own texture is destroyed through the table's drain at collect; the written set is swept with it", () => {
    const { ce, step, store, residency, ref, island } = makeBoard();
    residency.attach(store.table);
    const log: string[] = [];
    const h = ref(island).texture;
    residency.realize(h, fakeTexture("rgba8unorm", log, "island"));
    residency.wrote(island);
    expect(residency.stats()).toMatchObject({ realized: 1, written: 1 });
    ce.world.destroy(island);
    ce.world.sync();
    step(2);
    expect(residency.collect()).toBe(1);
    expect(log).toEqual(["destroy island"]);
    expect(residency.stats()).toMatchObject({ realized: 0, written: 0, destroyed: 1 });
    expect(residency.textureOf(h)).toBeUndefined();
  });

  it("the builder draws `own` and `page` records from the residency, counts them, names the target on the host entry, and wakes on a write (`content`)", () => {
    const { store, residency, builder, build, ref, dom, promoted, island } = makeBoard();
    residency.attach(store.table);
    const log: string[] = [];
    let f = build();
    expect(f.stats.cards).toBe(3);
    expect(f.stats.textured).toBe(0);
    expect(f.frames.every((fr) => fr.content?.mode === "plate")).toBe(true);
    expect(builder.entries().map((e) => [e.entity, e.target])).toEqual([[dom, "dom"], [promoted, "gpu"], [island, "gpu"]]);
    const before = builder.wakes().content;
    residency.realize(ref(island).texture, fakeTexture("rgba8unorm", log, "island"));
    residency.realize(store.table.pages(), fakeTexture("rgba8unorm", log, "pages"));
    residency.wrote(island);
    residency.wrote(promoted);
    expect(builder.wakes().content).toBeGreaterThan(before);
    f = build();
    expect(f.stats.textured).toBe(2);
    const modes = new Map(builder.entries().map((e, i) => [e.entity, f.frames[i]?.content?.mode]));
    expect(modes.get(dom)).toBe("plate");
    expect(modes.get(promoted)).toBe("page");
    expect(modes.get(island)).toBe("own");
    builder.dispose();
    residency.dispose();
    expect(log).toEqual(["destroy island", "destroy pages"]);
  });

  it("a private texture's written debt survives a lost ref (a culled card comes back owing nothing); a page slot's does not", () => {
    const { ce, world, step, store, residency, ref, island, promoted } = makeBoard();
    residency.attach(store.table);
    const log: string[] = [];
    residency.realize(ref(island).texture, fakeTexture("rgba8unorm", log, "island"));
    residency.realize(store.table.pages(), fakeTexture("rgba8unorm", log, "pages"));
    residency.wrote(island);
    residency.wrote(promoted);
    const ownKey = ref(island);
    // both cards scroll off: Residency writes no destination for the video/gl path when not Visible… a gl card KEEPS
    // its held key while culled, so force the ref away as an eviction would, then bring the same destination back
    world.edit(island).set(TextureRef, { texture: NO_TEXTURE, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 });
    world.edit(promoted).set(TextureRef, { texture: NO_TEXTURE, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 });
    ce.world.sync();
    residency.collect();
    expect(residency.stats().written).toBe(1);                              // the island's debt survives; the page slot's is dropped
    world.edit(island).set(TextureRef, { ...ownKey });
    ce.world.sync();
    expect(residency.isWritten(island)).toBe(true);
    expect(residency.contentOf(island).mode).toBe("own");
    step();
    void promoted;
  });

  it("refKeyOf names every field of a ref, so a new destination is a new debt", () => {
    expect(refKeyOf({ texture: 3, layer: 1, u0: 0.5, v0: 0.25, u1: 0.75, v1: 0.5 })).toBe("3|1|0.5|0.25|0.75|0.5");
    expect(refKeyOf({ texture: 3, layer: 2, u0: 0.5, v0: 0.25, u1: 0.75, v1: 0.5 })).not.toBe(refKeyOf({ texture: 3, layer: 1, u0: 0.5, v0: 0.25, u1: 0.75, v1: 0.5 }));
  });
});
