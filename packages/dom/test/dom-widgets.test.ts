/**
 * The DOM widget host reflector (design-004 §2): host divs reconciled against
 * the engine mount store, change-only geometry, and drag-promote to the lifted
 * plane. The store here is a hand-rolled 2-method fake (the reflector consumes
 * only `subscribe`/`getSnapshot`); the real store lives in @ice/core.
 */
import { Grab, MeasuredSize, type MountEntry, Position, Size, createEngine, createWorld, type Entity } from "@ice/core";
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

  it("promotes a Grabbed host to the lifted plane + inerts content, restoring on release", () => {
    const { world, engine, planes, store, reflector } = setup();
    const e = spawnBox(world, 0, 0, 10, 10);
    store.set([{ entity: e, hidden: false }]);
    engine.step(0);
    const content = reflector.hostFor(e) as HTMLElement;
    const hostDiv = content.parentElement as HTMLElement;
    expect(hostDiv.parentElement).toBe(planes.content); // starts in P1
    expect(content.style.pointerEvents).toBe("");

    world.addComponent(e, Grab, { x: 0, y: 0, w: 10, h: 10, z: 0 });
    engine.step(1);
    expect(hostDiv.parentElement).toBe(planes.lifted); // re-parented to P3
    expect(content.parentElement).toBe(hostDiv); // the content node moved WITH the host (portal survives)
    expect(content.style.pointerEvents).toBe("none"); // inert while any host is lifted

    world.removeComponent(e, Grab);
    engine.step(2);
    expect(hostDiv.parentElement).toBe(planes.content); // back to P1
    expect(content.style.pointerEvents).toBe(""); // inert cleared
  });

  it("inerts a host that enters mid-drag while another is lifted", () => {
    const { world, engine, store, reflector } = setup();
    const dragged = spawnBox(world, 0, 0, 10, 10);
    store.set([{ entity: dragged, hidden: false }]);
    engine.step(0);
    world.addComponent(dragged, Grab, { x: 0, y: 0, w: 10, h: 10, z: 0 });
    engine.step(1);

    // A second widget appears while the drag is Active.
    const late = spawnBox(world, 20, 20, 10, 10);
    store.set([{ entity: dragged, hidden: false }, { entity: late, hidden: false }]);
    engine.step(2);
    expect(reflector.hostFor(late)?.style.pointerEvents).toBe("none"); // honors the inert contract on entry

    world.removeComponent(dragged, Grab);
    engine.step(3);
    expect(reflector.hostFor(late)?.style.pointerEvents).toBe(""); // cleared for all on release
  });
});
