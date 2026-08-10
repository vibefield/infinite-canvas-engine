/**
 * The DOM widget host reflector (design-004 §2): host divs reconciled against
 * the engine mount store, change-only geometry, and drag-promote to the lifted
 * plane. The store here is a hand-rolled 2-method fake (the reflector consumes
 * only `subscribe`/`getSnapshot`); the real store lives in @ice/core.
 */
import {
  BoardRoot,
  ChildOf,
  Grab,
  NO_ENTITY,
  MeasuredSize,
  Opacity,
  Position,
  PrefabId,
  Size,
  StackZ,
  createEngine,
  createWorld,
  defineWidget,
  writeRuntimeResource,
  type Entity,
  type MountEntry,
  type World,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createPlanes } from "../src/planes";
import { createDomWidgetsReflector } from "../src/reflectors/dom-widgets";

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
    /** Test control — replace the snapshot (new identity) and notify. */
    set(entries: readonly MountEntry[]) {
      snapshot = entries;
      for (const l of listeners) l();
    },
  };
}

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const planes = createPlanes(host);
  const world = createWorld();
  const engine = createEngine(world);
  const store = fakeStore();
  const reflector = createDomWidgetsReflector(
    { contentPlane: planes.content, liftedPlane: planes.lifted },
    world,
    store,
  );
  engine.registerReflector(reflector);
  return { world, engine, planes, store, reflector };
}

function spawnBox(world: ReturnType<typeof createWorld>, x: number, y: number, w: number, h: number): Entity {
  return world.spawn({ components: [[Position, { x, y }], [Size, { w, h }]] });
}

describe("dom-widgets host reflector", () => {
  it("creates a host div per store entry with world-unit geometry + a content portal target", () => {
    const { world, engine, planes, store, reflector } = setup();
    const e = spawnBox(world, 10, 20, 30, 40);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);

    expect(reflector.hostCount()).toBe(1);
    const hostDiv = planes.content.firstElementChild as HTMLElement;
    expect(hostDiv.getAttribute("data-ice-entity")).toBe(String(e));
    expect(hostDiv.style.position).toBe("absolute");
    expect(hostDiv.style.left).toBe("10px");
    expect(hostDiv.style.top).toBe("20px");
    expect(hostDiv.style.width).toBe("30px");
    expect(hostDiv.style.height).toBe("40px");

    const content = hostDiv.querySelector("[data-ice-content]") as HTMLElement;
    expect(content).not.toBeNull();
    expect(reflector.hostFor(e)).toBe(content); // hostFor returns the portal target
  });

  it("prefers a non-zero MeasuredSize over Size for the host geometry (effective size)", () => {
    const { world, engine, store, reflector } = setup();
    const e = spawnBox(world, 0, 0, 30, 40);
    world.addComponent(e, MeasuredSize, { w: 55, h: 66 }); // auto-sized session rider
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const hostDiv = reflector.hostFor(e)?.parentElement as HTMLElement;
    expect(hostDiv.style.width).toBe("55px");
    expect(hostDiv.style.height).toBe("66px");
  });

  it("hides a culled-but-kept-mounted host with display:none (cull ≠ unmount)", () => {
    const { world, engine, store, reflector } = setup();
    const e = spawnBox(world, 0, 0, 10, 10);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const hostDiv = reflector.hostFor(e)?.parentElement as HTMLElement;
    expect(hostDiv.style.display).toBe("");

    store.set([{ entity: e, hidden: true }]);
    engine.step(1);
    expect(reflector.hostCount()).toBe(1); // still mounted
    expect(hostDiv.style.display).toBe("none");

    store.set([{ entity: e, hidden: false }]);
    engine.step(2);
    expect(hostDiv.style.display).toBe("");
  });

  it("removes the host div when its entry exits the store", () => {
    const { world, engine, planes, store, reflector } = setup();
    const e = spawnBox(world, 0, 0, 10, 10);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    expect(reflector.hostCount()).toBe(1);

    store.set([]);
    engine.step(1);
    expect(reflector.hostCount()).toBe(0);
    expect(planes.content.childElementCount).toBe(0);
    expect(reflector.hostFor(e)).toBeUndefined();
  });

  it("rewrites geometry change-only: one write per enter, one per moved host, zero when static", () => {
    const { world, engine, store, reflector } = setup();
    const a = spawnBox(world, 0, 0, 10, 10);
    const b = spawnBox(world, 5, 5, 10, 10);
    store.set([{ entity: a, hidden: false }, { entity: b, hidden: false }]);
    engine.step(0);
    expect(reflector.geometryWrites()).toBe(2); // both entered

    world.edit(a).set(Position, { x: 100, y: 100 });
    engine.step(1);
    expect(reflector.geometryWrites()).toBe(3); // only `a` moved → +1

    engine.step(2); // nothing changed → no geometry pass
    expect(reflector.geometryWrites()).toBe(3);
  });

  it("reflects the Opacity rider on the host: attach, value change, detach clears", () => {
    const { world, engine, store, reflector } = setup();
    const e = spawnBox(world, 0, 0, 10, 10);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const hostDiv = reflector.hostFor(e)?.parentElement as HTMLElement;
    expect(hostDiv.style.opacity).toBe(""); // no component = 1 = no inline style

    // f32-exact values throughout — String(a) must round-trip the cell.
    world.addComponent(e, Opacity, { a: 0.5 });
    engine.step(1);
    expect(hostDiv.style.opacity).toBe("0.5");

    world.edit(e).set(Opacity, { a: 0.75 });
    engine.step(2);
    expect(hostDiv.style.opacity).toBe("0.75");

    world.removeComponent(e, Opacity);
    engine.step(3);
    expect(hostDiv.style.opacity).toBe(""); // back to the default — property cleared
  });

  it("a host entering with Opacity already attached paints it at create", () => {
    const { world, engine, store, reflector } = setup();
    const e = spawnBox(world, 0, 0, 10, 10);
    world.addComponent(e, Opacity, { a: 0.25 });
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const hostDiv = reflector.hostFor(e)?.parentElement as HTMLElement;
    expect(hostDiv.style.opacity).toBe("0.25");
  });

  it("promotes a Grabbed host to the lifted plane + inerts content, restoring on release", () => {
    const { world, engine, planes, store, reflector } = setup();
    const e = spawnBox(world, 0, 0, 10, 10);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const content = reflector.hostFor(e) as HTMLElement;
    const hostDiv = content.parentElement as HTMLElement;
    expect(hostDiv.parentElement).toBe(planes.content); // starts in P1
    expect(planes.content.style.pointerEvents).toBe("");

    world.addComponent(e, Grab, { x: 0, y: 0, w: 10, h: 10, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    engine.step(1);
    expect(hostDiv.parentElement).toBe(planes.lifted); // re-parented to P3
    expect(content.parentElement).toBe(hostDiv); // the content node moved WITH the host (portal survives)
    // PLANE-LEVEL inert (review fix): two writes cover every widget, incl. the
    // lifted one; events fall through to the container so canvas facts flow.
    expect(planes.content.style.pointerEvents).toBe("none");
    expect(planes.lifted.style.pointerEvents).toBe("none");

    world.removeComponent(e, Grab);
    engine.step(2);
    expect(hostDiv.parentElement).toBe(planes.content); // back to P1
    expect(planes.content.style.pointerEvents).toBe(""); // inert cleared
    expect(planes.lifted.style.pointerEvents).toBe("");
  });

  it("dispose() tears down the private observers (a StrictMode remount must not stack subscriptions)", () => {
    const { world, engine, store, reflector } = setup();
    const e = spawnBox(world, 0, 0, 10, 10);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    expect(reflector.geometryWrites()).toBe(1); // entered

    reflector.dispose(); // unsubscribes the [Position,Size] / [MeasuredSize] / [Grab] observers

    // After dispose, a geometry change no longer arms the dirty flag, so the next
    // flush runs no geometry pass — the observers are truly gone. Without this the
    // InfiniteCanvas cleanup would leak a subscription set per StrictMode remount.
    world.edit(e).set(Position, { x: 999, y: 999 });
    engine.step(1);
    expect(reflector.geometryWrites()).toBe(1); // unchanged: observer gone, no re-measure
  });

  it("keeps the planes inert for a host that enters mid-drag", () => {
    const { world, engine, planes, store, reflector } = setup();
    const dragged = spawnBox(world, 0, 0, 10, 10);
    store.set([{ entity: dragged, hidden: false }]);
    engine.step(0);
    world.addComponent(dragged, Grab, { x: 0, y: 0, w: 10, h: 10, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    engine.step(1);

    // A second widget appears while the drag is Active.
    const late = spawnBox(world, 20, 20, 10, 10);
    store.set([{ entity: dragged, hidden: false }, { entity: late, hidden: false }]);
    engine.step(2);
    // Plane-level inert covers late entrants with ZERO per-host writes.
    expect(reflector.hostFor(late)).toBeTruthy();
    expect(planes.content.style.pointerEvents).toBe("none");

    world.removeComponent(dragged, Grab);
    engine.step(3);
    expect(planes.content.style.pointerEvents).toBe(""); // cleared on release
  });
});

describe("GL widgets' chrome hosts never promote (v1 CardChrome sandwich, 2026-07-13)", () => {
  it("a Grabbed gl-surface widget's host stays in the content plane (under its own model)", () => {
    // A gl widget's host carries DOM CHROME that must remain UNDER the GL
    // canvas — promoting to P3 would cover the widget's floating 3D content
    // with its own opaque card. The GL side pops renderOrder-top instead.
    defineWidget({
      type: "dw:gl-card",
      surface: "gl",
      component: () => null,
      defaultSize: { w: 10, h: 10 },
    });
    const { world, engine, planes, store, reflector } = setup();
    const e = world.spawn({
      components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }], [PrefabId, { id: "dw:gl-card" }]],
    });
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const hostDiv = (reflector.hostFor(e) as HTMLElement).parentElement as HTMLElement;
    expect(hostDiv.parentElement).toBe(planes.content);

    world.addComponent(e, Grab, { x: 0, y: 0, w: 10, h: 10, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    engine.step(1);
    expect(hostDiv.parentElement).toBe(planes.content); // NOT re-parented
    // …but it z-pops over its P1 neighbors (the within-plane twin of the
    // grabbed quad's renderOrder-top within P2).
    expect(hostDiv.style.zIndex).toBe("1000");
    // And a gl-only grab does not inert the planes (no promoted host exists).
    expect(planes.content.style.pointerEvents).toBe("");

    world.removeComponent(e, Grab);
    engine.step(2);
    expect(hostDiv.style.zIndex).toBe(""); // pop cleared on release
  });
});

describe("within-plane stacking = the frame's ChildOf sibling sequence (petition 8)", () => {
  const order = (plane: HTMLElement): string[] =>
    Array.from(plane.children).map((c) => c.getAttribute("data-ice-entity") ?? "?");

  /** The ordered regime by hand: componentless root, named by the resource. */
  const makeRoot = (world: World): Entity => {
    const root = world.spawn({});
    writeRuntimeResource(world, BoardRoot, { root });
    return root;
  };

  it("hosts are DOM-ordered by sibling sequence regardless of mount order", () => {
    const { world, engine, planes, store } = setup();
    const root = makeRoot(world);
    const top = spawnBox(world, 0, 0, 10, 10); // mounts FIRST but sits last in sequence
    const bottom = spawnBox(world, 20, 0, 10, 10); // mounts second, placed first
    world.setRelation(top, ChildOf, root, "last");
    world.setRelation(bottom, ChildOf, root, "first");
    store.set([
      { entity: top, hidden: false },
      { entity: bottom, hidden: false },
    ]);
    engine.step(0);
    expect(order(planes.content)).toEqual([String(bottom), String(top)]);
  });

  it("a pure moveRelation reorders the plane (the comment-under-members contract)", () => {
    const { world, engine, planes, store } = setup();
    const root = makeRoot(world);
    const a = spawnBox(world, 0, 0, 10, 10);
    const b = spawnBox(world, 20, 0, 10, 10);
    world.setRelation(a, ChildOf, root, "last");
    world.setRelation(b, ChildOf, root, "last");
    store.set([
      { entity: a, hidden: false },
      { entity: b, hidden: false },
    ]);
    engine.step(0);
    expect(order(planes.content)).toEqual([String(a), String(b)]);

    world.moveRelation(a, ChildOf, "last"); // a jumps above b — a PURE reorder
    engine.step(1); // the Related(ChildOf) wake + orderStamp rebuild
    expect(order(planes.content)).toEqual([String(b), String(a)]);
  });

  it("the lifted plane keeps sibling order for a promoted group (comment below its members)", () => {
    const { world, engine, planes, store } = setup();
    const root = makeRoot(world);
    const member = spawnBox(world, 0, 0, 10, 10); // mounts first
    const comment = spawnBox(world, 0, 0, 100, 100); // mounts LAST, placed first
    world.setRelation(member, ChildOf, root, "last");
    world.setRelation(comment, ChildOf, root, "first");
    store.set([
      { entity: member, hidden: false },
      { entity: comment, hidden: false },
    ]);
    engine.step(0);
    world.addComponent(comment, Grab, { x: 0, y: 0, w: 100, h: 100, parent: root, prev: NO_ENTITY, ord: 0 });
    world.addComponent(member, Grab, { x: 0, y: 0, w: 10, h: 10, parent: root, prev: NO_ENTITY, ord: 1 });
    engine.step(1);
    expect(order(planes.lifted)).toEqual([String(comment), String(member)]);
  });

  it("LEGACY fallback: no BoardRoot, no edges — hosts sort by (StackZ asc, entity asc)", () => {
    // The pre-schema-2 read-only world: v1 docs project their z cells and no
    // board root exists. The reflector must keep painting them z-correct.
    const { world, engine, planes, store } = setup();
    const top = spawnBox(world, 0, 0, 10, 10); // mounts FIRST but z 2
    const bottom = spawnBox(world, 20, 0, 10, 10); // mounts second, z 1
    world.addComponent(top, StackZ, { z: 2 });
    world.addComponent(bottom, StackZ, { z: 1 });
    store.set([
      { entity: top, hidden: false },
      { entity: bottom, hidden: false },
    ]);
    engine.step(0);
    expect(order(planes.content)).toEqual([String(bottom), String(top)]);
  });

  it("mixed plane: edge-less hosts sort ABOVE the ordinal-mapped set (documented choice)", () => {
    // Nominally impossible post-migration — pinned so a stray bare spawn lands
    // somewhere stable (see core ops/sibling-order.ts).
    const { world, engine, planes, store } = setup();
    const root = makeRoot(world);
    const ordinal = spawnBox(world, 0, 0, 10, 10);
    world.setRelation(ordinal, ChildOf, root, "last");
    const bare = spawnBox(world, 20, 0, 10, 10); // no edge — legacy fallback
    store.set([
      { entity: bare, hidden: false },
      { entity: ordinal, hidden: false },
    ]);
    engine.step(0);
    expect(order(planes.content)).toEqual([String(ordinal), String(bare)]);
  });

  it("marks a keyboard-claiming widget's host: data-canvas-keyboard + tabindex (design-007 §3.1)", () => {
    defineWidget({
      type: "dw:terminal",
      surface: "dom",
      component: () => null,
      interaction: { keyboard: "exclusive", keyboardEscape: "widget" },
      defaultSize: { w: 10, h: 10 },
    });
    const { world, engine, store, reflector } = setup();
    const claiming = world.spawn({
      components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }], [PrefabId, { id: "dw:terminal" }]],
    });
    const plain = spawnBox(world, 20, 0, 10, 10); // no PrefabId — never marked
    store.set([
      { entity: claiming, hidden: false },
      { entity: plain, hidden: false },
    ]);
    engine.step(0);

    const claimHost = (reflector.hostFor(claiming) as HTMLElement).parentElement as HTMLElement;
    expect(claimHost.getAttribute("data-canvas-keyboard")).toBe("escape"); // keyboardEscape:"widget"
    expect(claimHost.tabIndex).toBe(-1); // click-focusable fallback node
    const plainHost = (reflector.hostFor(plain) as HTMLElement).parentElement as HTMLElement;
    expect(plainHost.hasAttribute("data-canvas-keyboard")).toBe(false);
    expect(plainHost.hasAttribute("tabindex")).toBe(false);
  });

  it("keeps order dirt ARMED while the focused host parks its plane (2026-08-09 review fix)", () => {
    defineWidget({
      type: "dw:kb-order",
      surface: "dom",
      component: () => null,
      interaction: { keyboard: "exclusive" },
      defaultSize: { w: 10, h: 10 },
    });
    const { world, engine, planes, store, reflector } = setup();
    const root = makeRoot(world);
    const a = world.spawn({
      components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }], [PrefabId, { id: "dw:kb-order" }]],
    });
    world.setRelation(a, ChildOf, root, "last");
    const b = spawnBox(world, 20, 0, 10, 10);
    world.setRelation(b, ChildOf, root, "last");
    store.set([
      { entity: a, hidden: false },
      { entity: b, hidden: false },
    ]);
    engine.step(0);
    expect(order(planes.content)).toEqual([String(a), String(b)]);

    // Focus the claiming host — the steady state design-007 introduced.
    const hostA = (reflector.hostFor(a) as HTMLElement).parentElement as HTMLElement;
    hostA.focus();
    expect(document.activeElement).toBe(hostA);

    // Reorder while focused: the plane is parked (re-appending would blur),
    // so the DOM sequence must NOT change yet…
    world.setRelation(a, ChildOf, root, "last"); // move a above b
    engine.step(1);
    expect(order(planes.content)).toEqual([String(a), String(b)]);

    // …and the dirt stays armed: after blur, the next flush re-asserts the
    // order WITHOUT any new order write (the pre-fix bug dropped it here).
    hostA.blur();
    engine.step(2);
    expect(order(planes.content)).toEqual([String(b), String(a)]);
  });
});
