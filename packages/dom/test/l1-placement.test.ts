/**
 * TARGET-DRIVEN PLACEMENT on L1 (design-013 §6 step 8, B4 R5) — what the dom
 * host reflector does when there IS a source canvas, and what it deliberately
 * does not do.
 *
 * The placement rule itself is `effectiveTarget(SurfaceKind, SurfaceTarget)`
 * and it is tested next door (`dom-widgets.test.ts`, "the target is READ from
 * the world"). This file pins the three things B4 leans on:
 *
 *  1. the reparent is portal-PRESERVING — `appendChild` moves the node, so the
 *     content element React portals into survives the promotion with whatever
 *     is inside it;
 *  2. geometry CUSTODY changes hands cleanly — a host arriving on L1 carries no
 *     plane transform, and one coming back is re-written in world units rather
 *     than trusted from a cache taken under the other owner;
 *  3. pointer custody: on a mixed board the L1 canvas may be transparent to the
 *     pointer, so the hosts it adopts turn pointer events back on and clear
 *     them when they leave.
 *
 * Without a source canvas — the stratified profile, and every unit test that
 * builds no L1 — none of it fires and the file below is the file it always was.
 */
import {
  createEngine,
  createWorld,
  defineWidget,
  Position,
  PrefabId,
  Size,
  SurfaceKind,
  SurfaceTarget,
  type Entity,
  type MountEntry,
  type World,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createPlanes } from "../src/planes";
import { createDomWidgetsReflector } from "../src/reflectors/dom-widgets";
import { createSourceCanvas, type SourceCanvasEffects } from "../src/source-canvas";

defineWidget({ type: "l1p:card", surface: "dom", component: () => null, defaultSize: { w: 10, h: 10 } });

/** Minimal WidgetMountStore: snapshot identity changes only when the test replaces it. */
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

/** The HiC seam, faked: no origin trial, and the attribute is all this file needs. */
const effects: SourceCanvasEffects = {
  markAsSourceCanvas: (canvas) => canvas.setAttribute("layoutsubtree", ""),
  onPaint: () => () => {},
  changedElements: () => [],
};

function setup(opts: { l1: boolean; pointerEvents?: "auto" | "none" }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const planes = createPlanes(host);
  const l1 = opts.l1
    ? createSourceCanvas(container, effects, {
        size: { width: 800, height: 600, dpr: 2 },
        ...(opts.pointerEvents !== undefined ? { pointerEvents: opts.pointerEvents } : {}),
      })
    : undefined;
  const world = createWorld();
  const engine = createEngine(world);
  const store = fakeStore();
  const reflector = createDomWidgetsReflector(
    {
      contentPlane: planes.content,
      liftedPlane: planes.lifted,
      ...(l1 !== undefined ? { sourceCanvas: l1.canvas } : {}),
    },
    world,
    store,
    {},
  );
  engine.registerReflector(reflector);
  return { world, engine, planes, l1, store, reflector, container };
}

const spawnCard = (world: World): Entity =>
  world.spawn({
    components: [
      [Position, { x: 12, y: 34 }],
      [Size, { w: 10, h: 10 }],
      [PrefabId, { id: "l1p:card" }],
      [SurfaceKind, { kind: "dom" }],
      [SurfaceTarget, { target: "dom" }],
    ],
  });

describe("L1 placement (B4)", () => {
  it("the reparent is portal-preserving: the content node and everything inside it move with the host", () => {
    const { world, engine, l1, store, reflector } = setup({ l1: true });
    const e = spawnCard(world);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const content = reflector.hostFor(e) as HTMLElement;
    // What React would have mounted into the portal target.
    const mounted = document.createElement("span");
    mounted.textContent = "state that must survive a promotion";
    content.appendChild(mounted);

    world.edit(e).set(SurfaceTarget, { target: "gpu" });
    engine.step(1);
    const hostEl = reflector.hostElementFor(e) as HTMLElement;
    expect(hostEl.parentElement).toBe(l1?.canvas);
    expect(reflector.hostFor(e)).toBe(content); // the SAME node — never re-created
    expect(content.parentElement).toBe(hostEl);
    expect(content.firstChild).toBe(mounted);

    world.edit(e).set(SurfaceTarget, { target: "dom" });
    engine.step(2);
    expect(reflector.hostFor(e)).toBe(content);
    expect(content.firstChild).toBe(mounted);
  });

  it("hands geometry custody over: no plane transform arrives on L1, and a demoted host is re-written in world units", () => {
    const { world, engine, store, reflector } = setup({ l1: true });
    const e = spawnCard(world);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const hostEl = reflector.hostElementFor(e) as HTMLElement;
    expect([hostEl.style.left, hostEl.style.top]).toEqual(["12px", "34px"]);

    world.edit(e).set(SurfaceTarget, { target: "gpu" });
    engine.step(1);
    expect(hostEl.style.transform).toBe(""); // the plane's placement does not follow it onto L1

    // The L1 owner (`compose/dom-render.ts` under composited, `domWriteback`
    // under the old profile) sizes and places it while it is canvas-side.
    hostEl.style.width = "19px";
    hostEl.style.height = "19px";
    hostEl.style.transform = "matrix(1.9,0,0,1.9,100,200)";

    world.edit(e).set(SurfaceTarget, { target: "dom" });
    engine.step(2);
    // Back on the plane: the transform is cleared and the world-unit box is
    // re-asserted, even though `Size` never changed — the cache was taken
    // under a different owner and must not be trusted.
    expect(hostEl.style.transform).toBe("");
    expect([hostEl.style.width, hostEl.style.height]).toEqual(["10px", "10px"]);
  });

  it("hands pointer custody over: a host adopted by a pointer-transparent L1 takes hits, and gives them back on demotion", () => {
    const { world, engine, l1, store, reflector } = setup({ l1: true, pointerEvents: "none" });
    expect(l1?.canvas.style.pointerEvents).toBe("none");
    const e = spawnCard(world);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const hostEl = reflector.hostElementFor(e) as HTMLElement;
    expect(hostEl.style.pointerEvents).toBe(""); // a plane host: the plane's business

    world.edit(e).set(SurfaceTarget, { target: "gpu" });
    engine.step(1);
    expect(hostEl.style.pointerEvents).toBe("auto");

    world.edit(e).set(SurfaceTarget, { target: "dom" });
    engine.step(2);
    expect(hostEl.style.pointerEvents).toBe("");
  });

  it("a host BORN on L1 is adopted whole — parented, registered as a source, and hit-taking", () => {
    const { world, engine, l1, store, reflector } = setup({ l1: true, pointerEvents: "none" });
    const e = spawnCard(world);
    world.edit(e).set(SurfaceTarget, { target: "gpu" }); // promoted before it ever mounted
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const hostEl = reflector.hostElementFor(e) as HTMLElement;
    expect(hostEl.parentElement).toBe(l1?.canvas);
    expect(hostEl.style.pointerEvents).toBe("auto");
    expect(reflector.compositedEntities()).toEqual([e]);
  });

  it("the canvas keeps pointer events by default — the old leg's rigs are unchanged", () => {
    const { world, engine, l1, store, reflector } = setup({ l1: true });
    expect(l1?.canvas.style.pointerEvents).toBe("auto");
    const e = spawnCard(world);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    world.edit(e).set(SurfaceTarget, { target: "gpu" });
    engine.step(1);
    // The host still opts in; on an `auto` canvas that changes nothing.
    expect((reflector.hostElementFor(e) as HTMLElement).style.pointerEvents).toBe("auto");
  });

  it("without a source canvas nothing is promoted at all: the target is read, and there is nowhere to go", () => {
    const { world, engine, planes, store, reflector } = setup({ l1: false });
    const e = spawnCard(world);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    world.edit(e).set(SurfaceTarget, { target: "gpu" });
    engine.step(1);
    const hostEl = reflector.hostElementFor(e) as HTMLElement;
    expect(hostEl.parentElement).toBe(planes.content);
    expect(hostEl.style.pointerEvents).toBe("");
    expect(reflector.compositedEntities()).toEqual([]);
  });
});
