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

describe("the GL metrics panel (comprehensive r3f profiling, 2026-07-13)", () => {
  const STATS = {
    cpuMs: 1.2,
    gpuMs: 5.5,
    fps: 60,
    drawCalls: 42,
    triangles: 123456,
    points: 0,
    lines: 0,
    programs: 7,
    geometries: 12,
    textures: 18,
    renderTargets: 14,
    renderMegaPixels: 6.2,
    fboBytes: 40 * 1048576,
    fboBudgetBytes: 256 * 1048576,
    islands: { total: 14, hot: 2, warm: 9, waking: 1, cold: 1, dormant: 1 },
    bandHistogram: { "×1": 6, "×0.5": 8 },
    repainted: 2,
    pendingPaints: 1,
    evicted: 0,
    zoom: 0.45,
    band: 0.5,
    effectiveDpr: 1,
    visibleWidgets: 18,
    culledWidgets: 12,
  };

  it("mounts lazily on the first glStats push, renders the census, disposes with detach", () => {
    const ce = createCanvasEngine();
    const handle = attachDevtools(ce, { observer: false, profiler: false, glPanel: { expanded: true } });
    expect(document.querySelector(".ice-gl")).toBeNull(); // lazy — no pushes yet

    handle.glStats(STATS);
    const panel = document.querySelector(".ice-gl");
    expect(panel).not.toBeNull();
    const text = panel?.textContent ?? "";
    expect(text).toContain("14 targets · 6.2 MP total");
    expect(text).toContain("40MB / 256MB");
    expect(text).toContain("2 hot");
    expect(text).toContain("9 warm");
    expect(text).toContain("zoom 45% → band ×0.5 → paint dpr 1.00");
    expect(text).toContain("×0.5: 8");
    expect(text).toContain("18 visible · 12 culled");
    expect(text).toContain("123.5k"); // triangles, k-formatted

    handle.detach();
    expect(document.querySelector(".ice-gl")).toBeNull();
    ce.dispose();
  });

  it("glPanel: false makes glStats a no-op", () => {
    const ce = createCanvasEngine();
    const handle = attachDevtools(ce, { observer: false, profiler: false, glPanel: false });
    handle.glStats(STATS);
    expect(document.querySelector(".ice-gl")).toBeNull();
    handle.detach();
    ce.dispose();
  });
});
