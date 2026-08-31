/**
 * L1 — the composited profile's DOM interaction layer (design-012 §5).
 *
 * Three things are pinned here, and each of them is something a screenshot
 * could not tell you:
 *
 *  1. Composited hosts are IMMEDIATE children of the source canvas. The
 *     platform refuses to copy anything deeper ("Only immediate children of
 *     the <canvas> element can be passed to copyElementImageToTexture()"), so
 *     a wrapper div appearing between them is a silent loss of every card's
 *     pixels, not a cosmetic difference.
 *  2. Registration and parentage move TOGETHER. The compositor may hold a host
 *     only while that host is a canvas child; a registration that outlives the
 *     reparent is an element the copy will refuse, and one that arrives early
 *     is the same bug a frame sooner.
 *  3. Promotion does not remount. The portal target must be the SAME node
 *     before and after, because that identity is the whole reason widget state
 *     survives a promotion (plan §2).
 */
import {
  Camera,
  Grab,
  MeasuredSize,
  NO_ENTITY,
  Position,
  PrefabId,
  Size,
  Viewport,
  createCompositorSourceRegistry,
  createEngine,
  createWorld,
  defineWidget,
  type Entity,
  type MountEntry,
} from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import { createCanvasHost } from "../src/host";
import { createPlanes } from "../src/planes";
import { createPresentationRegistry } from "../src/presentation-mode";
import { createDomWidgetsReflector } from "../src/reflectors/dom-widgets";
import {
  createDomWritebackReflector,
  type DomWritebackOptions,
} from "../src/reflectors/dom-writeback";
import { createSourceCanvas, type SourceCanvasEffects } from "../src/source-canvas";

// Module scope: the widget registry is process-global and these names are
// file-unique. Three declarations the seeding step has to tell apart.
defineWidget({
  type: "l1:pinned-composited",
  surface: "dom",
  component: null,
  presentation: { pin: "composited" },
});
defineWidget({ type: "l1:plain", surface: "dom", component: null });
defineWidget({ type: "l1:island", surface: "gl", component: null });

/** Minimal WidgetMountStore (the reflector consumes only these two methods). */
function fakeStore() {
  let snapshot: readonly MountEntry[] = [];
  const listeners = new Set<() => void>();
  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
    set(entries: readonly MountEntry[]) {
      snapshot = entries;
      for (const l of listeners) l();
    },
  };
}

/**
 * A fake HiC seam. The point of the injection is exactly this: L1 is testable
 * without Electron, without the origin-trial flag, and without @ice/dom ever
 * naming a HiC symbol.
 */
function fakeEffects() {
  const marked: HTMLCanvasElement[] = [];
  const handlers = new Map<HTMLCanvasElement, (e: Event) => void>();
  let changed: readonly Element[] = [];
  const effects: SourceCanvasEffects = {
    markAsSourceCanvas: (c) => {
      marked.push(c);
      c.setAttribute("layoutsubtree", "");
    },
    onPaint: (c, h) => {
      handlers.set(c, h);
      return () => handlers.delete(c);
    },
    changedElements: () => changed,
  };
  return {
    effects,
    marked,
    subscribed: () => handlers.size,
    /** Raise a paint event naming `elements`. */
    paint(canvas: HTMLCanvasElement, elements: readonly Element[]) {
      changed = elements;
      handlers.get(canvas)?.(new Event("paint"));
    },
  };
}

function setup(options: { withCanvas?: boolean } = {}) {
  const withCanvas = options.withCanvas ?? true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const planes = createPlanes(host);
  const world = createWorld();
  const engine = createEngine(world);
  const store = fakeStore();
  const presentation = createPresentationRegistry();
  const sources = createCompositorSourceRegistry();
  const hic = fakeEffects();
  const dirty: Array<readonly Element[]> = [];
  const l1 = withCanvas
    ? createSourceCanvas(container, hic.effects, { onDirty: (hosts) => dirty.push(hosts) })
    : undefined;
  const reflector = createDomWidgetsReflector(
    {
      contentPlane: planes.content,
      liftedPlane: planes.lifted,
      ...(l1 !== undefined ? { sourceCanvas: l1.canvas } : {}),
    },
    world,
    store,
    { presentation, sources },
  );
  engine.registerReflector(reflector);
  return { container, world, engine, planes, store, reflector, presentation, sources, l1, hic, dirty };
}

const spawnBox = (
  world: ReturnType<typeof createWorld>,
  x: number,
  y: number,
  w: number,
  h: number,
): Entity => world.spawn({ components: [[Position, { x, y }], [Size, { w, h }]] });

/** A rig with the placement reflector registered, and a camera to move. */
function withWriteback(options: DomWritebackOptions = {}, viewport?: { w: number; h: number }) {
  const s = setup();
  if (viewport !== undefined) {
    s.world.setResource(Viewport, { w: viewport.w, h: viewport.h, dpr: 1 });
  }
  s.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const writeback = createDomWritebackReflector(
    {
      hostElementFor: (e) => s.reflector.hostElementFor(e),
      compositedEntities: () => s.reflector.compositedEntities(),
      compositedRevision: () => s.reflector.compositedRevision(),
    },
    s.world,
    options,
  );
  s.engine.registerReflector(writeback);
  return { ...s, writeback };
}

describe("the L1 source canvas", () => {
  it("marks the canvas through the injected seam and parks it in the container", () => {
    const { container, l1, hic } = setup();
    expect(hic.marked).toEqual([l1?.canvas]);
    expect(l1?.canvas.getAttribute("layoutsubtree")).toBe("");
    expect(l1?.canvas.parentElement).toBe(container);
    expect(l1?.canvas.getAttribute("data-ice-source-canvas")).toBe("");
  });

  it("sizes its BACKING STORE, because that is where paint records are cached", () => {
    // Measured 2026-08-31 (scripts/hic-paint-record.mjs). The bitmap is what
    // element paint records are recorded AGAINST: at the default 300x150 over
    // a 1280x808 box a card copied 684 ink px of the 23,988 it copies at
    // 2560x1616 — no throw, no validation error, just a degraded picture. An
    // earlier revision left the default to save memory and made the whole S2
    // board composite blank. (Host POSITION is not the variable: with the
    // bitmap sized, straddling, outside and far-parked hosts all copy 100%.)
    const { l1 } = setup();
    l1?.resize(800, 600, 2);
    expect(l1?.canvas.width).toBe(1600);
    expect(l1?.canvas.height).toBe(1200);
    expect(l1?.canvas.style.width).toBe("100%");
  });

  it("declines a no-op resize, which would clear the records it just made", () => {
    const { l1 } = setup();
    expect(l1?.resize(800, 600, 2)).toBe(true);
    expect(l1?.resize(800, 600, 2)).toBe(false);
    expect(l1?.resize(801, 600, 2)).toBe(true);
  });

  it("reports a changed DESCENDANT as its immediate-child host, deduped", () => {
    const { l1, hic, dirty } = setup();
    const canvas = l1?.canvas as HTMLCanvasElement;
    const hostA = document.createElement("div");
    const hostB = document.createElement("div");
    const deep = document.createElement("span");
    hostA.appendChild(deep);
    canvas.append(hostA, hostB);

    // Two mutations inside ONE host plus one in another: two hosts, once each.
    hic.paint(canvas, [deep, hostA, hostB]);
    expect(dirty).toHaveLength(1);
    expect(dirty[0]).toEqual([hostA, hostB]);
  });

  it("drops changed elements that are not inside the canvas at all", () => {
    const { l1, hic, dirty } = setup();
    const canvas = l1?.canvas as HTMLCanvasElement;
    const mine = document.createElement("div");
    canvas.appendChild(mine);
    const foreign = document.createElement("div");
    document.body.appendChild(foreign);
    hic.paint(canvas, [foreign, mine]);
    expect(dirty[0]).toEqual([mine]);
  });

  it("still reports a paint event that named nothing (the write-back signature)", () => {
    // A transform write-back costs 2 paint events/frame naming no elements
    // (hic-bench §3). The consumer must SEE them to be able to filter them.
    const { l1, hic, dirty } = setup();
    hic.paint(l1?.canvas as HTMLCanvasElement, []);
    expect(dirty).toEqual([[]]);
    expect(l1?.paintEvents()).toBe(1);
  });

  it("unsubscribes and detaches on dispose", () => {
    const { l1, hic } = setup();
    expect(hic.subscribed()).toBe(1);
    l1?.dispose();
    expect(hic.subscribed()).toBe(0);
    expect(l1?.canvas.parentElement).toBeNull();
  });
});

describe("presentation mode — the one door", () => {
  it("defaults to live-dom and reports whether a write actually changed anything", () => {
    const p = createPresentationRegistry();
    const e = 7 as unknown as Entity;
    expect(p.get(e)).toBe("live-dom");
    expect(p.set(e, "composited")).toBe(true);
    expect(p.set(e, "composited")).toBe(false); // an unchanged write is not dirt
    expect(p.get(e)).toBe("composited");
  });

  it("wakes listeners only on real changes", () => {
    const p = createPresentationRegistry();
    const seen = vi.fn();
    p.onChange(seen);
    const e = 1 as unknown as Entity;
    p.set(e, "composited");
    p.set(e, "composited");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(p.revision()).toBe(1);
  });

  it("stores nothing for the default, so entries track what is promoted", () => {
    const p = createPresentationRegistry();
    const e = 1 as unknown as Entity;
    p.set(e, "composited");
    expect([...p.entries()]).toHaveLength(1);
    p.set(e, "live-dom");
    expect([...p.entries()]).toHaveLength(0);
  });
});

describe("a widget type's DECLARED presentation", () => {
  // `defineWidget({ presentation })`, landed at S8 (design-012 §6.3). Seeded
  // where the host's parent is chosen, so a declared mode costs no promote
  // pass and no reparent on a second frame.
  const spawnTyped = (world: ReturnType<typeof createWorld>, type: string): Entity =>
    world.spawn({
      components: [
        [Position, { x: 0, y: 0 }],
        [Size, { w: 30, h: 40 }],
        [PrefabId, { id: type }],
      ],
    });

  it("puts a pinned-composited card on the canvas in its FIRST flush", () => {
    const { world, engine, store, l1, sources, reflector, presentation } = setup();
    const e = spawnTyped(world, "l1:pinned-composited");
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    // One step, and it is already a canvas child with a source registered —
    // the mode and the parentage were decided together.
    expect(reflector.hostElementFor(e)?.parentElement).toBe(l1?.canvas);
    expect(sources.get(e)?.kind).toBe("dom");
    expect(presentation.get(e)).toBe("composited");
  });

  it("leaves an undeclared card in the content plane — seeding is not blanket", () => {
    // The control without which the test above passes for the wrong reason.
    const { world, engine, store, planes, sources, reflector } = setup();
    const e = spawnTyped(world, "l1:plain");
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    expect(reflector.hostElementFor(e)?.parentElement).toBe(planes.content);
    expect(sources.size()).toBe(0);
  });

  it("never seeds a GL widget onto the canvas, whatever its kind's default is", () => {
    // A gl widget's host IS its DOM chrome and belongs under the island in the
    // content plane (design-004 §1's sandwich). Seeding it canvas-side would
    // register that chrome as a `dom` source on top of the island's own `gl`
    // registration — both are keyed by entity, and `register` replaces.
    const { world, engine, store, planes, sources, reflector } = setup();
    const e = spawnTyped(world, "l1:island");
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    expect(reflector.hostElementFor(e)?.parentElement).toBe(planes.content);
    expect(sources.size()).toBe(0);
  });
});

describe("composited hosts", () => {
  it("parents a composited host as an IMMEDIATE child of the canvas", () => {
    const { world, engine, store, presentation, l1, reflector } = setup();
    const e = spawnBox(world, 10, 20, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const hostEl = reflector.hostElementFor(e) as HTMLElement;

    presentation.set(e, "composited");
    engine.step(1);

    expect(hostEl.parentElement).toBe(l1?.canvas);
    expect(reflector.canvasHostCount()).toBe(1);
    // The copy addresses THIS node — never the inner portal target.
    expect(reflector.hostFor(e)?.parentElement).toBe(hostEl);
  });

  it("registers the HOST element as a dom source, in the flush that parents it", () => {
    const { world, engine, store, presentation, sources, reflector } = setup();
    const e = spawnBox(world, 0, 0, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    expect(sources.size()).toBe(0); // live-dom registers nothing

    presentation.set(e, "composited");
    engine.step(1);
    const source = sources.get(e);
    expect(source?.kind).toBe("dom");
    // The host, not the content div: a nested descendant is refused by the
    // platform, and the content div is exactly that.
    expect((source as { host: unknown }).host).toBe(reflector.hostElementFor(e));
  });

  it("unregisters and reparents on demotion", () => {
    const { world, engine, store, presentation, sources, planes, reflector } = setup();
    const e = spawnBox(world, 0, 0, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    expect(sources.size()).toBe(1);

    presentation.set(e, "live-dom");
    engine.step(1);
    expect(sources.size()).toBe(0);
    expect(reflector.hostElementFor(e)?.parentElement).toBe(planes.content);
    expect(reflector.canvasHostCount()).toBe(0);
  });

  it("PRESERVES the portal target across promotion and demotion (no remount)", () => {
    // This identity IS the promotion mechanism (plan §2). React portals target
    // the content node; moving a portal's CONTAINER does not remount it, so a
    // widget's state survives promotion. If this node were ever recreated, the
    // card would remount on every promote and lose scroll, caret and hook
    // state — the whole reason promotion can be automatic.
    const { world, engine, store, presentation, reflector, l1, planes } = setup();
    const e = spawnBox(world, 0, 0, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);

    const contentBefore = reflector.hostFor(e) as HTMLElement;
    const hostBefore = reflector.hostElementFor(e) as HTMLElement;
    // Stand in for whatever React mounted into the portal target.
    const mounted = document.createElement("p");
    mounted.textContent = "widget state";
    contentBefore.appendChild(mounted);

    presentation.set(e, "composited");
    engine.step(1);
    expect(reflector.hostFor(e)).toBe(contentBefore);
    expect(reflector.hostElementFor(e)).toBe(hostBefore);
    expect(contentBefore.contains(mounted)).toBe(true);
    expect(hostBefore.parentElement).toBe(l1?.canvas);

    presentation.set(e, "live-dom");
    engine.step(2);
    expect(reflector.hostFor(e)).toBe(contentBefore);
    expect(contentBefore.contains(mounted)).toBe(true);
    expect(hostBefore.parentElement).toBe(planes.content);
  });

  it("drops the registration when the widget leaves the store", () => {
    const { world, engine, store, presentation, sources } = setup();
    const e = spawnBox(world, 0, 0, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    expect(sources.size()).toBe(1);

    store.set([]);
    engine.step(1);
    expect(sources.size()).toBe(0);
  });

  it("keeps a composited host out of the lifted plane while it is grabbed", () => {
    // Its lift is a per-quad GPU fact at true z (design-012 §7 retires P3), so
    // moving it to P3 would be the stratified answer to a solved question.
    const { world, engine, store, presentation, l1, reflector } = setup();
    const e = spawnBox(world, 0, 0, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);

    world.addComponent(e, Grab, { x: 0, y: 0, w: 30, h: 40, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    engine.step(1);
    expect(reflector.hostElementFor(e)?.parentElement).toBe(l1?.canvas);
  });

  it("leaves plane hosts and the whole stratified path untouched without a canvas", () => {
    const { world, engine, store, presentation, sources, planes, reflector } = setup({
      withCanvas: false,
    });
    const e = spawnBox(world, 5, 6, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    // Even asking for composited cannot promote: there is nowhere to promote to.
    presentation.set(e, "composited");
    engine.step(0);
    expect(reflector.hostElementFor(e)?.parentElement).toBe(planes.content);
    expect(sources.size()).toBe(0);
    expect(reflector.canvasHostCount()).toBe(0);
  });

  it("stops writing plane geometry for a canvas host, and resumes on demotion", () => {
    // Inside layoutsubtree, left/top are inert and the host must be sized in
    // SCREEN px, not world units — so plane geometry must not keep writing it.
    const { world, engine, store, presentation, reflector } = setup();
    const e = spawnBox(world, 10, 20, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const el = reflector.hostElementFor(e) as HTMLElement;
    expect(el.style.width).toBe("30px");

    presentation.set(e, "composited");
    engine.step(1);
    world.edit(e).set(Size, { w: 99, h: 99 });
    engine.step(2);
    // Untouched by the plane writer: domWriteback owns this host's geometry.
    expect(el.style.width).toBe("30px");

    presentation.set(e, "live-dom");
    engine.step(3);
    expect(el.style.width).toBe("99px");
  });
});

describe("domWriteback — absolute placements for canvas hosts", () => {
  it("writes an ABSOLUTE screen placement, not a delta from layout", () => {
    // Inside layoutsubtree the transform REPLACES layout (hic-bench §3), so a
    // camera write-back is the absolute screen position of the card.
    const { world, engine, store, presentation, reflector } = withWriteback();
    const e = spawnBox(world, 100, 50, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    const el = reflector.hostElementFor(e) as HTMLElement;
    // Camera at the origin, zoom 1 ⇒ the world position IS the screen position.
    expect(el.style.transform).toBe("matrix(1,0,0,1,100,50)");
    expect(el.style.width).toBe("30px");
  });

  it("sizes the host in SCREEN px so the copy rasterises at the zoomed size", () => {
    const { world, engine, store, presentation, reflector } = withWriteback();
    const e = spawnBox(world, 10, 10, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    const el = reflector.hostElementFor(e) as HTMLElement;
    expect(el.style.width).toBe("30px");
    expect(el.style.height).toBe("40px");
  });

  it("prefers a non-zero MeasuredSize, exactly as the host pipeline does", () => {
    const { world, engine, store, presentation, reflector } = withWriteback();
    const e = spawnBox(world, 0, 0, 30, 40);
    world.addComponent(e, MeasuredSize, { w: 55, h: 66 });
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    const el = reflector.hostElementFor(e) as HTMLElement;
    expect(el.style.width).toBe("55px");
    expect(el.style.height).toBe("66px");
  });

  it("writes ALL composited hosts, never only the visible ones", () => {
    // Visible-only write-backs leave stale off-screen hit regions that steal
    // clicks — 25 of 28 in hic-bench §3. Parking is the other complete fix and
    // lands at S3; until then, all N.
    const { world, engine, store, presentation, writeback } = withWriteback();
    const near = spawnBox(world, 0, 0, 30, 40);
    const faraway = spawnBox(world, 50_000, 50_000, 30, 40);
    store.set([
      { entity: near, hidden: false },
      { entity: faraway, hidden: false },
    ]);
    presentation.set(near, "composited");
    presentation.set(faraway, "composited");
    engine.step(0);
    expect(writeback.writes()).toBe(2);
  });

  it("is change-only: a still camera and a still board write nothing", () => {
    const { world, engine, store, presentation, writeback } = withWriteback();
    const e = spawnBox(world, 0, 0, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    const after = writeback.writes();
    engine.step(1);
    engine.step(2);
    expect(writeback.writes()).toBe(after);
    expect(writeback.quiet()).toBeGreaterThan(0);
  });

  it("forgets a host that leaves L1, so a later promotion rewrites it", () => {
    const { world, engine, store, presentation, reflector, writeback } = withWriteback();
    const e = spawnBox(world, 3, 4, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    const el = reflector.hostElementFor(e) as HTMLElement;

    presentation.set(e, "live-dom");
    engine.step(1);
    el.style.transform = ""; // the plane owner clears it
    const before = writeback.writes();

    presentation.set(e, "composited");
    engine.step(2);
    expect(writeback.writes()).toBe(before + 1);
    expect(el.style.transform).toBe("matrix(1,0,0,1,3,4)");
  });
});

/**
 * PARKING (design-012 §5 law 2, hic-bench §3).
 *
 * The measured table is the whole reason this exists:
 *
 *   write only the visible hosts  →   3/28 clicks land   (25 stolen)
 *   write all N every frame       →  28/28
 *   park off-screen hosts         →  28/28
 *
 * So "visible only" is a correctness defect and the other two are complete
 * fixes. Parking is the cheap one: one write per departure instead of
 * 1.46 µs × N at 120 Hz. What must never happen is a host being left at a
 * stale on-screen transform — which is what these tests actually check.
 */
describe("domWriteback — parking off-screen hosts", () => {
  const spawnAt = (world: ReturnType<typeof createWorld>, x: number, y: number) =>
    spawnBox(world, x, y, 100, 50);

  it("parks an off-screen host with ONE write, then stops touching it", () => {
    const { world, engine, store, presentation, reflector, writeback } = withWriteback({}, { w: 800, h: 600 });
    const far = spawnAt(world, 5000, 5000);
    store.set([{ entity: far, hidden: false }]);
    presentation.set(far, "composited");
    engine.step(0);

    const el = reflector.hostElementFor(far) as HTMLElement;
    expect(el.style.transform).toBe("matrix(1,0,0,1,-100000,-100000)");
    expect(writeback.parked()).toBe(1);
    const after = writeback.writes();

    // Pan, repeatedly. The host stays off-screen, so it must cost nothing.
    for (let i = 1; i <= 5; i++) {
      world.setResource(Camera, { x: i * 10, y: 0, zoom: 1, gesturing: true });
      engine.step(i);
    }
    expect(writeback.writes()).toBe(after);
    expect(writeback.parkWrites()).toBe(1);
  });

  it("a parked host CANNOT hold a stale on-screen transform", () => {
    // The defect the bench found: a host that was visible, then left, keeping
    // the transform it had — sitting on top of the visible cards and stealing
    // their clicks (25/28).
    const { world, engine, store, presentation, reflector } = withWriteback({}, { w: 800, h: 600 });
    const e = spawnAt(world, 100, 100);
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    const el = reflector.hostElementFor(e) as HTMLElement;
    expect(el.style.transform).toBe("matrix(1,0,0,1,100,100)");

    // Pan far enough that the card leaves the viewport.
    world.setResource(Camera, { x: 4000, y: 0, zoom: 1, gesturing: true });
    engine.step(1);
    expect(el.style.transform).toBe("matrix(1,0,0,1,-100000,-100000)");
  });

  it("restores a real placement when a parked host comes back into view", () => {
    const { world, engine, store, presentation, reflector, writeback } = withWriteback({}, { w: 800, h: 600 });
    const e = spawnAt(world, 100, 100);
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    const el = reflector.hostElementFor(e) as HTMLElement;

    world.setResource(Camera, { x: 4000, y: 0, zoom: 1, gesturing: true });
    engine.step(1);
    expect(writeback.parked()).toBe(1);

    // Back to where it started: the cached tx/ty match the pre-park values, so
    // a naive change-only guard would skip this write and leave it parked.
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    engine.step(2);
    expect(el.style.transform).toBe("matrix(1,0,0,1,100,100)");
    expect(writeback.parked()).toBe(0);
    expect(el.style.width).toBe("100px");
  });

  it("keeps a host straddling the edge LIVE, so a slow pan cannot flap it", () => {
    const { world, engine, store, presentation, reflector } = withWriteback(
      { parkMargin: 64 },
      { w: 800, h: 600 },
    );
    const e = spawnAt(world, 790, 100); // 10px of a 100px card on screen
    store.set([{ entity: e, hidden: false }]);
    presentation.set(e, "composited");
    engine.step(0);
    expect(reflector.hostElementFor(e)?.style.transform).toBe("matrix(1,0,0,1,790,100)");
  });

  it("writes ALL N when parking is off — the other complete fix", () => {
    const { world, engine, store, presentation, reflector, writeback } = withWriteback(
      { park: false },
      { w: 800, h: 600 },
    );
    const near = spawnAt(world, 10, 10);
    const far = spawnAt(world, 5000, 5000);
    store.set([
      { entity: near, hidden: false },
      { entity: far, hidden: false },
    ]);
    presentation.set(near, "composited");
    presentation.set(far, "composited");
    engine.step(0);
    expect(writeback.writes()).toBe(2);
    expect(writeback.parked()).toBe(0);
    // Its true placement, not a park — off-screen but honestly positioned.
    expect(reflector.hostElementFor(far)?.style.transform).toBe("matrix(1,0,0,1,5000,5000)");
  });

  it("never parks without a Viewport, because it cannot know what off-screen means", () => {
    const { world, engine, store, presentation, reflector, writeback } = withWriteback({});
    const far = spawnAt(world, 5000, 5000);
    store.set([{ entity: far, hidden: false }]);
    presentation.set(far, "composited");
    engine.step(0);
    expect(writeback.parked()).toBe(0);
    expect(reflector.hostElementFor(far)?.style.transform).toBe("matrix(1,0,0,1,5000,5000)");
  });
});
