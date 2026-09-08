/**
 * D-C4.5 — the facade re-seeds the runtime resources IT owns across a document
 * close (Phase C review, 2026-09-07: "the facade's document lifecycle").
 *
 * `docs.close()` runs `session.close()` → `doc-kit.ts` `world.reset()`, whose
 * contract clears RESOURCES as well as entities. `createCanvasEngine` seeds
 * eight resources at construction (Camera · Viewport · ActiveTool ·
 * CameraLimits · GestureSettings · PointerSettings · SnapConfig ·
 * ChromeSettings) and mirrors a ninth out of ECS (StageMode, from the
 * `stageHolds` map) — before this fix `closeDoc` republished only
 * `CanvasSession` and `previews`, so every one of them came back `undefined`
 * on a mounted engine and BOTH ground hosts were unable to paint until the
 * next ResizeObserver fire (`ensureBuilt`, ground `host.ts`).
 *
 * The host's box and the user's view are not the document's, and the settings
 * are "construction seeds; live-tunable after" (design-005 §4) — so the LIVE
 * values survive, not the construction ones.
 */
import { describe, expect, it } from "vitest";
import {
  ActiveTool,
  Camera,
  CameraLimits,
  ChromeSettings,
  GestureSettings,
  PointerSettings,
  SnapConfig,
  StageMode,
  Viewport,
  createCanvasEngine,
  defineWidget,
  widgets,
  writeRuntimeResource,
} from "../src";
import type { CanvasEngine } from "../src";

const BOX =
  widgets.get("reseed:box") ??
  defineWidget({
    type: "reseed:box",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 80 },
  });

/** Every resource the facade seeds or mirrors, read back as one snapshot. */
function snapshot(ce: CanvasEngine): Record<string, unknown> {
  const w = ce.world;
  return {
    Camera: w.getResource(Camera),
    Viewport: w.getResource(Viewport),
    ActiveTool: w.getResource(ActiveTool),
    CameraLimits: w.getResource(CameraLimits),
    GestureSettings: w.getResource(GestureSettings),
    PointerSettings: w.getResource(PointerSettings),
    SnapConfig: w.getResource(SnapConfig),
    ChromeSettings: w.getResource(ChromeSettings),
    StageMode: w.getResource(StageMode),
  };
}

/**
 * A MOUNTED engine with a live document: the react facade's viewport write
 * (`infinite-canvas.tsx` `syncViewport`), a moved camera, a chosen tool, a
 * live stage hold, and a live re-tune of each settings resource (they are
 * seeds, not constants — a host that tunes them after construction must not
 * lose the tuning to a document switch).
 */
function mounted(): { ce: CanvasEngine; release: () => void } {
  const ce = createCanvasEngine({ widgets: [BOX] });
  ce.docs.create();
  writeRuntimeResource(ce.world, Viewport, { w: 1440, h: 900, dpr: 2 });
  ce.ops.panTo(120, -45);
  ce.ops.zoomTo(1.75);
  ce.ops.setTool("select");
  // Live tunes — deliberately unlike the construction defaults.
  writeRuntimeResource(ce.world, CameraLimits, { minZoom: 0.2, maxZoom: 8 });
  writeRuntimeResource(ce.world, GestureSettings, {
    ...(ce.world.getResource(GestureSettings) ?? {}),
    tapMaxMs: 123,
  } as never);
  writeRuntimeResource(ce.world, PointerSettings, {
    ...(ce.world.getResource(PointerSettings) ?? {}),
    hitSlopPx: 7,
  } as never);
  writeRuntimeResource(ce.world, SnapConfig, { enabled: true, thresholdPx: 11 });
  writeRuntimeResource(ce.world, ChromeSettings, { liftScale: 1.42 });
  const release = ce.stage.background("reseed-overlay");
  return { ce, release };
}

describe("D-C4.5 the facade's resources survive a document close", () => {
  it("create() over a live document preserves every facade-seeded resource", () => {
    const { ce, release } = mounted();
    const before = snapshot(ce);

    ce.docs.create(); // closeDoc() → world.reset() → adopt the new session

    expect(snapshot(ce)).toEqual(before);
    release();
    ce.dispose();
  });

  it("open(bytes) over a live document preserves every facade-seeded resource", () => {
    const { ce, release } = mounted();
    const bytes = ce.docs.current()?.exportEnvelope() as Uint8Array;
    const before = snapshot(ce);

    const opened = ce.docs.open(bytes);
    expect(opened.ok).toBe(true);

    expect(snapshot(ce)).toEqual(before);
    release();
    ce.dispose();
  });

  it("close() alone leaves the resources standing, and a later create() keeps them", () => {
    const { ce, release } = mounted();
    const before = snapshot(ce);

    ce.docs.close();
    expect(snapshot(ce)).toEqual(before);

    ce.docs.create();
    expect(snapshot(ce)).toEqual(before);
    release();
    ce.dispose();
  });

  it("the live stage hold survives: StageMode still mirrors the out-of-ECS map", () => {
    const { ce, release } = mounted();
    expect(ce.world.getResource(StageMode)?.backgroundHolds).toBe(1);

    ce.docs.create();

    // The holds map is out of ECS and untouched by the reset — the resource
    // the compositor reads (`compositor-pass.ts`, `island-render.ts`) must
    // still say so, or the background silently un-freezes on a doc switch.
    expect(ce.stage.isBackgrounded()).toBe(true);
    expect(ce.world.getResource(StageMode)?.backgroundHolds).toBe(1);
    release();
    expect(ce.world.getResource(StageMode)?.backgroundHolds).toBe(0);
    ce.dispose();
  });

  it("the seeds are still SEEDS: a construction-time settings option is not resurrected over a live tune", () => {
    const ce = createCanvasEngine({ widgets: [BOX], settings: { zoom: { min: 0.5, max: 2 } } });
    ce.docs.create();
    expect(ce.world.getResource(CameraLimits)).toEqual({ minZoom: 0.5, maxZoom: 2 });
    writeRuntimeResource(ce.world, CameraLimits, { minZoom: 0.25, maxZoom: 6 });

    ce.docs.create();

    expect(ce.world.getResource(CameraLimits)).toEqual({ minZoom: 0.25, maxZoom: 6 });
    ce.dispose();
  });
});
