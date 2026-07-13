/**
 * @ice/devtools — the strata-tools wrapper: both first-party panels mount and
 * dispose cleanly, the on/off flags hold, the engine describe labels entities
 * by ROLE (widget type / recognizer kind + phase / pointer device), and the
 * facade exposes the durable inspection seam the observer's durable tab reads.
 * Runs under happy-dom; devtools reads the world outside the tick.
 */
import { describe, expect, it } from "vitest";
import {
  Drag,
  GesturePhases,
  GestureSuspended,
  Pointer,
  PrefabId,
  createCanvasEngine,
  createWorld,
} from "@ice/core";
import { attachDevtools, engineDescribe } from "../src";

describe("attachDevtools: strata observer + profiler lifecycle", () => {
  it("mounts both panels; detach removes both and is idempotent", () => {
    const ce = createCanvasEngine();
    const handle = attachDevtools(ce);
    expect(document.querySelector(".strata-obs")).not.toBeNull();
    expect(document.querySelector(".strata-prof")).not.toBeNull();
    expect(handle.observer).not.toBeNull();
    expect(handle.profiler).not.toBeNull();

    handle.detach();
    expect(document.querySelector(".strata-obs")).toBeNull();
    expect(document.querySelector(".strata-prof")).toBeNull();
    handle.detach(); // idempotent
    ce.dispose();
  });

  it("observer/profiler flags omit their panel; lane() is a safe no-op without the profiler", () => {
    const ce = createCanvasEngine();
    const handle = attachDevtools(ce, { observer: false, profiler: false });
    expect(handle.observer).toBeNull();
    expect(handle.profiler).toBeNull();
    expect(document.querySelector(".strata-obs")).toBeNull();
    expect(document.querySelector(".strata-prof")).toBeNull();
    handle.lane("paint", 1.5); // must not throw
    handle.detach();
    ce.dispose();
  });
});

describe("engineDescribe: role labels, not component-name composition", () => {
  it("labels widgets by type, recognizers by kind + live phase, pointers by device", () => {
    const world = createWorld();

    const widget = world.spawn({ components: [[PrefabId, { id: "dt:card" }]] });
    expect(engineDescribe(world, widget).label).toBe("dt:card");

    const drag = world.spawn({ components: [[Drag, {}]], tags: [GesturePhases.tags.Active] });
    const dd = engineDescribe(world, drag);
    expect(dd.label).toBe("drag");
    expect(dd.phase).toBe("active");

    // Suspended rides OUTSIDE the phase set (pinch-frozen) and wins the label.
    world.addTag(drag, GestureSuspended);
    expect(engineDescribe(world, drag).phase).toBe("suspended");

    const pointer = world.spawn({ components: [[Pointer, { id: "m1", device: "mouse" }]] });
    expect(engineDescribe(world, pointer).label).toBe("pointer:mouse");
  });
});

describe("the durable inspection seam (observer durable tab feed)", () => {
  it("DocSession exposes store docId + attachment baseline; the getter shape tracks docs.current()", () => {
    const ce = createCanvasEngine();
    ce.docs.create();
    const s = ce.docs.current();
    expect(s).toBeDefined();
    if (s === undefined) return;
    expect(typeof s.store.docId).toBe("string"); // ObserverDurableSource.store
    // `baseline` is @internal in the published Attachment type but present at
    // runtime — the exact structural mirror the observer durable tab consumes.
    const attachment = s.attachment as unknown as { baseline: unknown };
    expect(attachment.baseline).toBeDefined(); // ObserverDurableSource.attachment
    ce.docs.close();
    expect(ce.docs.current()).toBeUndefined(); // getter side → durable tab shows its placeholder
    ce.dispose();
  });
});
