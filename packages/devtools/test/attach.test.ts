/**
 * @ice/devtools — the strata-tools wrapper: both first-party panels mount and
 * dispose cleanly, the on/off flags hold, the engine describe labels entities
 * by ROLE (widget type / recognizer kind + phase / pointer device), and the
 * facade exposes the durable inspection seam the observer's durable tab reads.
 * Runs under happy-dom; devtools reads the world outside the tick.
 */
import { beforeEach, describe, expect, it } from "vitest";
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
  it("mounts both panels inside ONE dock; detach removes everything and is idempotent", () => {
    const ce = createCanvasEngine();
    const handle = attachDevtools(ce);
    expect(document.querySelectorAll(".ice-dock").length).toBe(1);
    const obs = document.querySelector(".strata-obs");
    const prof = document.querySelector(".strata-prof");
    expect(obs?.closest(".ice-dock")).not.toBeNull();
    expect(prof?.closest(".ice-dock")).not.toBeNull();
    expect(handle.observer).not.toBeNull();
    expect(handle.profiler).not.toBeNull();

    handle.detach();
    expect(document.querySelector(".ice-dock")).toBeNull();
    expect(document.querySelector(".strata-obs")).toBeNull();
    expect(document.querySelector(".strata-prof")).toBeNull();
    handle.detach(); // idempotent
    ce.dispose();
  });

  it("the reflect lane REPORTS (it read a non-existent phase key and never fired until 2026-08-15)", () => {
    const ce = createCanvasEngine();
    const handle = attachDevtools(ce);
    const lanes: Array<{ name: string; ms: number }> = [];
    const profiler = handle.profiler;
    if (profiler === null) throw new Error("profiler expected");
    const realLane = profiler.lane.bind(profiler);
    profiler.lane = (name: string, ms: number) => {
      lanes.push({ name, ms });
      realLane(name, ms);
    };

    ce.engine.registerReflector({
      name: "spin",
      always: true,
      flush: () => {
        const until = performance.now() + 2;
        while (performance.now() < until) {
          /* burn a measurable slice */
        }
      },
    });

    // Teardown in `finally`: a failing assertion here would otherwise leave the
    // dock mounted and cascade into every later DOM-counting test.
    try {
      // Frame 1 flushes the reflector; the lane is read at the NEXT frame's
      // publish (post-tick, pre-reflect), so it carries a one-frame lag.
      ce.step(16);
      ce.step(32);

      const reflect = lanes.filter((l) => l.name === "reflect");
      expect(reflect.length).toBeGreaterThan(0);
      expect(reflect[0]?.ms ?? 0).toBeGreaterThan(0);
    } finally {
      handle.detach();
      ce.dispose();
    }
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

// One plausible frame of GlPanelStats — shared by the GL panel + dock suites.
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

describe("the GL metrics panel (comprehensive r3f profiling, 2026-07-13)", () => {
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

describe("the dock: one draggable panel for all three tools (2026-07-13)", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("hosts all three tools in fixed slot order (strips first, observer last)", () => {
      const ce = createCanvasEngine();
      const handle = attachDevtools(ce);
      handle.glStats(STATS);

      expect(document.querySelectorAll(".ice-dock").length).toBe(1);
      const slots = Array.from(document.querySelectorAll<HTMLElement>(".ice-dock-slot"));
      expect(slots.map((s) => s.dataset.slot)).toEqual(["profiler", "gl", "observer"]);
      expect(slots[0]?.querySelector(".strata-prof")).not.toBeNull();
      expect(slots[1]?.querySelector(".ice-gl")).not.toBeNull();
      expect(slots[2]?.querySelector(".strata-obs")).not.toBeNull();

      handle.detach();
      expect(document.querySelector(".ice-dock")).toBeNull();
      ce.dispose();
    });

    it("mounts lazily: no dock until the first tool needs it", () => {
      const ce = createCanvasEngine();
      const handle = attachDevtools(ce, { observer: false, profiler: false });
      expect(document.querySelector(".ice-dock")).toBeNull(); // gl is push-lazy
      handle.glStats(STATS);
      expect(document.querySelector(".ice-dock")).not.toBeNull();
      handle.detach();
      ce.dispose();
    });

    it("drags by its header and persists the position", () => {
      const ce = createCanvasEngine();
      const handle = attachDevtools(ce);
      const dock = document.querySelector<HTMLElement>(".ice-dock");
      const head = document.querySelector<HTMLElement>(".ice-dock-head");
      expect(dock).not.toBeNull();
      expect(head).not.toBeNull();
      if (dock === null || head === null) return;
      const before = { left: dock.style.left, top: dock.style.top };

      const ev = (type: string, x: number, y: number): PointerEvent =>
        new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true });
      head.dispatchEvent(ev("pointerdown", 500, 20));
      expect(dock.classList.contains("dragging")).toBe(true);
      head.dispatchEvent(ev("pointermove", 400, 70)); // −100, +50
      head.dispatchEvent(ev("pointerup", 400, 70));

      expect(dock.classList.contains("dragging")).toBe(false);
      expect(dock.style.left).not.toBe(before.left);
      expect(dock.style.top).not.toBe(before.top);
      const saved = JSON.parse(localStorage.getItem("ice-dock:layout") ?? "{}") as { x?: number; y?: number };
      expect(typeof saved.x).toBe("number");
      expect(typeof saved.y).toBe("number");

      handle.detach();
      ce.dispose();
    });

    it("collapses via the header button (state persisted)", () => {
      const ce = createCanvasEngine();
      const handle = attachDevtools(ce);
      const dock = document.querySelector<HTMLElement>(".ice-dock");
      const btn = document.querySelector<HTMLButtonElement>(".ice-dock-btn");
      expect(dock?.classList.contains("collapsed")).toBe(false);
      btn?.click();
      expect(dock?.classList.contains("collapsed")).toBe(true);
      const saved = JSON.parse(localStorage.getItem("ice-dock:layout") ?? "{}") as { open?: boolean };
      expect(saved.open).toBe(false);
      btn?.click();
      expect(dock?.classList.contains("collapsed")).toBe(false);
      handle.detach();
      ce.dispose();
    });

    it("dock: false restores the classic scattered corners", () => {
      const ce = createCanvasEngine();
      const handle = attachDevtools(ce, { dock: false });
      handle.glStats(STATS);
      expect(document.querySelector(".ice-dock")).toBeNull();
      expect(document.querySelector(".strata-obs")?.parentElement).toBe(document.body);
      expect(document.querySelector(".strata-prof")?.parentElement).toBe(document.body);
      expect(document.querySelector(".ice-gl")?.parentElement).toBe(document.body);
      handle.detach();
      ce.dispose();
    });
});
