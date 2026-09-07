// @vitest-environment node
/**
 * THE FULL-BOARD REPAINT MUST NOT EXIST — carried onto the new leg at B8.
 *
 * This claim was made against the old compositor's dom source binder
 * (`test/no-full-board-path.test.ts`, design-012 §8 gate 2), which B8 deletes.
 * The path it forbids is not the old binder's: it is the SHAPE of a board
 * repaint, and the new leg has the same shape — Residency writes a
 * `TextureRef` and DomRender copies into the destination that ref names. So
 * the claim is re-expressed here, against `Residency` + `DomRender`, and the
 * argument that made it two tests is unchanged:
 *
 *  1. BEHAVIOURAL — the render is driven over a settled board and must copy
 *     nothing the second time and every time after. This is the check that
 *     matters: the real defect it caught was a per-frame re-allocation that
 *     marked every resident slot stale, so the whole board re-uploaded on
 *     every composite — the forbidden path arriving by accident.
 *  2. GREP — no exported "repaint everything" verb exists to invite one. A
 *     behavioural test cannot see an API nobody calls yet. The old grep swept
 *     `src/compositor/`; this one sweeps `src/compose/`, which is where such a
 *     verb would now be written.
 *
 * The banding arms are the same property one level down: a pure PAN never
 * re-slots, a zoom inside the band's hysteresis window never re-slots, and a
 * zoom that LEAVES the band re-slots exactly once — the honest exception
 * without which the first two would pass for the wrong reason.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  alwaysGpu,
  Camera,
  createCanvasEngine,
  createResidencyStore,
  defineCanvasType,
  defineWidget,
  type Entity,
  installSurfaceInfra,
  TextureRef,
  tools,
  Viewport,
  widgets,
} from "@ice/core";
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

// vitest runs with the package root as cwd; `import.meta.url` is not a file URL under happy-dom.
const composeDir = join(process.cwd(), "src", "compose");

// One widget type per FILE (global registry; no test reset).
const CARD = widgets.get("nfb:card") ?? defineWidget({ type: "nfb:card", surface: "dom", component: null, defaultSize: { w: 100, h: 60 }, behaviors: [alwaysGpu] });
const ROOT = defineCanvasType({
  id: "nfb:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [CARD] } },
  presentation: { camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom } },
});
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];

// Two layouts, both fully on screen at the zoom their arms use — a CULLED card
// is not `Visible`, so it never re-bands, and a board half off screen would
// grade the culler rather than the copy path.
const WIDE = { cols: 4, px: 150, py: 110 };   // 12 cards inside 1600x1200 at zoom 1, with room to pan
const TIGHT = { cols: 3, px: 110, py: 80 };   // 6 cards still inside it at zoom 3

/** A device that hands back inspectable textures and swallows the encode. */
function fakeDevice() {
  let n = 0;
  return {
    createTexture(d: GPUTextureDescriptor) {
      const size = d.size as number[];
      const name = `${String(d.label ?? "tex")}#${n++}`;
      let views = 0;
      return {
        label: name,
        format: "rgba8unorm",
        width: size[0] ?? 1,
        height: size[1] ?? 1,
        depthOrArrayLayers: size[2] ?? 1,
        createView: (v?: GPUTextureViewDescriptor) => ({ label: `${name}#${views++}`, dimension: v?.dimension ?? "2d" }) as unknown as GPUTextureView,
        destroy: () => {},
      } as unknown as GPUTexture;
    },
    createCommandEncoder: () => ({
      copyTextureToTexture: () => {},
      finish: () => ({}) as unknown as GPUCommandBuffer,
    }) as unknown as GPUCommandEncoder,
    queue: { submit: () => {} },
  } as unknown as GPUDevice;
}

/** A grid that fits the viewport: `cols` columns at `px` x `py` pitch, centred on the camera. */
function board(n: number, grid: { cols: number; px: number; py: number }, dpr = 2) {
  const ce = createCanvasEngine({ widgets: [CARD], canvasTypes: [ROOT], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 1200, dpr });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const store = createResidencyStore({});
  installSurfaceInfra(ce.engine, { residency: { table: store.table, allocator: store.allocator, raster: () => "band" } });

  const residency = createContentResidency(ce.world);
  residency.attach(store.table);

  const els = new Map<Entity, HTMLElement>();
  const copies: Entity[] = [];
  const copy: ElementCopy = (_queue, element) => {
    copies.push(must(entityOfHost(element), "the host's entity"));
    return true;
  };
  let clock = 0;
  const render = createDomRender({
    device: fakeDevice(),
    world: ce.world,
    residency,
    hosts: { hostOf: (e: Entity) => els.get(e) },
    raster: () => "band",
    now: () => clock,
    copy,
  });

  const cards: Entity[] = [];
  const ox = ((grid.cols - 1) * grid.px) / 2;
  const oy = ((Math.ceil(n / grid.cols) - 1) * grid.py) / 2;
  for (let i = 0; i < n; i++) {
    const x = (i % grid.cols) * grid.px - ox;
    const y = Math.floor(i / grid.cols) * grid.py - oy;
    const e = ce.ops.spawnWidget("nfb:card", { x, y, w: 100, h: 60, undoable: false }) as Entity;
    els.set(e, { style: { width: "100px", height: "60px" } as unknown as CSSStyleDeclaration, getAttribute: (k: string) => (k === "data-ice-entity" ? String(e) : null) } as unknown as HTMLElement);
    cards.push(e);
  }

  let frame = 0;
  const drive = (times = 1): void => {
    for (let i = 0; i < times; i++) {
      frame += 16;
      clock = frame;
      ce.step(frame);
      render.flush(ce.world);
    }
  };
  const camera = (cam: { x?: number; y?: number; zoom?: number }): void => {
    const now = must(ce.world.getResource(Camera), "the camera");
    ce.world.setResource(Camera, { ...now, ...cam });
  };
  /** The slot's width in texels, read back off the uv over the page-array side. */
  const slotWidth = (e: Entity): number => {
    const ref = must(ce.world.get(e, TextureRef), "a TextureRef");
    const side = must(store.table.describe(store.table.pages()), "the pages entry");
    return Math.round((ref.u1 - ref.u0) * (side as { size: number }).size);
  };
  return { ce, cards, copies, drive, camera, slotWidth, stats: () => render.stats(), dispose: () => render.dispose() };
}

describe("no full-board repaint path exists (carried from the old leg at B8)", () => {
  it("copies each card ONCE, then nothing, however many times it is driven", () => {
    const b = board(12, WIDE);
    b.drive(6); // the promotions land, the refs are written, the copies happen
    const afterFirst = b.copies.length;
    expect(afterFirst).toBe(12);
    expect(new Set(b.copies).size).toBe(12); // once EACH, not 12 copies of one card
    // …and every card is LIVE: a culled card's demand is paused and it parks
    // without copying, which would make "nothing more was copied" true for the
    // wrong reason.
    expect(b.stats().parked).toBe(0);

    b.drive(30);
    // THE PROPERTY: a settled board owes nothing. On the old leg, before the
    // fix, this read 744.
    expect(b.copies.length).toBe(afterFirst);
    expect(b.stats().pending).toBe(0);
    b.dispose();
  });

  it("does not re-copy while the camera PANS — only a zoom changes slot sizes", () => {
    const b = board(12, WIDE);
    b.drive(6);
    const settled = b.copies.length;
    expect(settled).toBe(12);
    for (let i = 1; i <= 60; i++) {
      b.camera({ x: i * 7, y: i * 3 });
      b.drive();
    }
    expect(b.copies.length).toBe(settled);
    b.dispose();
  });

  it("does not re-copy for a zoom INSIDE the band's window — hysteresis", () => {
    // Bands are powers of two and each covers a 4x display range, so zooming
    // from 1 to 2 stays in band. The card samples the same slot at a different
    // scale, which is what the linear filter and the gutters are for. Without
    // bands, every frame of a continuous zoom re-slots and re-copies the board.
    const b = board(6, TIGHT);
    b.drive(6);
    const settled = b.copies.length;
    const slot = b.slotWidth(must(b.cards[0], "a card"));
    for (const zoom of [1.1, 1.5, 1.9, 2]) {
      b.camera({ zoom });
      b.drive();
    }
    expect(b.copies.length).toBe(settled);
    expect(b.slotWidth(must(b.cards[0], "a card"))).toBe(slot);
    b.dispose();
  });

  it("DOES re-copy when the zoom leaves the band — the honest exception", () => {
    // The counterpart: if nothing ever re-copied, the arms above would pass for
    // the wrong reason. Crossing the edge re-bands and re-slots ONCE, and then
    // holds the new band across the rest of the gesture.
    const b = board(6, TIGHT);
    b.drive(6);
    const settled = b.copies.length;
    const before = b.slotWidth(must(b.cards[0], "a card"));
    b.camera({ zoom: 3 });
    b.drive(2);
    expect(b.copies.length).toBe(settled + 6);
    // 100 world px at dpr 2, band 1 -> 200; band 4 -> 800.
    expect(before).toBe(200);
    expect(b.slotWidth(must(b.cards[0], "a card"))).toBe(800);

    const afterBand = b.copies.length;
    for (const zoom of [3.5, 4, 5, 6, 7.9]) {
      b.camera({ zoom });
      b.drive();
    }
    expect(b.copies.length).toBe(afterBand);
    b.dispose();
  });

  it("exposes no 'repaint everything' verb for anyone to reach for", () => {
    // A behavioural test cannot see an API that nothing calls YET. This can.
    // The sweep moved from `src/compositor/` to `src/compose/` at B8 with the
    // leg it guards.
    const forbidden =
      /\b(repaintAll|redrawAll|refreshAll|markAllDirty|invalidateAllSlots|uploadAll|copyAllSlots|recopyBoard|fullRepaint)\b/;
    const offenders: string[] = [];
    for (const file of readdirSync(composeDir)) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(join(composeDir, file), "utf8");
      if (forbidden.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
    // …and the sweep really is looking at the new leg's files.
    expect(readdirSync(composeDir).filter((f) => f.endsWith(".ts")).length).toBeGreaterThan(4);
  });

  it("never scans the board for unwritten destinations — the debt arrives NAMED", () => {
    // The old leg's equivalent was `atlas.flush(budget)` never being called
    // bare (a bare flush drains at Infinity — a full-board upload in one
    // frame). DomRender's shape of the same rule: the only source of work is
    // the `TextureRef` change journal and the paint latch, so no code path
    // iterates every entity looking for something to copy.
    const source = readFileSync(join(composeDir, "dom-render.ts"), "utf8");
    expect(source).toMatch(/collector\.drain\(\)/);
    expect(source).not.toMatch(/world\.query\(/);
    expect(source).not.toMatch(/\.each\(/);
  });
});
