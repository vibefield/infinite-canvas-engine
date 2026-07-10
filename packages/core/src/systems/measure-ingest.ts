/**
 * Measurement ingest (design-004 §2; `input` phase).
 *
 * Drains the {@link MeasureQueue} once per tick and folds each auto-sized
 * widget's latest content-box measurement into the `MeasuredSize` session rider
 * — the effective-size source cull/hit/breakpoint consume where a widget is
 * auto-sized (`MeasuredSize` where present and >0, else `Size`). Auto-sized
 * widgets never commit `Size`; the doc stores authorial intent only.
 *
 * Scheduled on the CANVAS-SURFACE anchor query (exactly one such entity,
 * guaranteed by install) — like `pointerIngest` — because the body must run on
 * frames where no measured widget exists yet, and a tag-only query matches every
 * archetype, so the `if (b.count === 0) return` guard runs the drain exactly
 * once per frame BY CONSTRUCTION.
 *
 * Two guards keep a hidden widget's `display:none` collapse out of the rider
 * (the §2 double wall): the adapter never enqueues a `0×0` sample, and ingest
 * skips `w===0 && h===0` again here. Real changes clear a **±1 px dead-band**
 * against the current rider so sub-pixel RO jitter never restamps (which would
 * churn breakpoint/cull downstream). Within one drain, samples fold last-wins
 * per entity so a same-tick pair never double-`addComponent`s (strata's
 * flush-time duplicate policy).
 */
import type { Entity, System, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import { CanvasSurface, MeasuredSize } from "../catalog";
import type { MeasureQueue } from "../input/measure-queue";

const anchorQ = defineQuery([CanvasSurface]);

/** Sub-pixel dead-band (px): a change must exceed this on either axis to restamp. */
const MEASURE_DEAD_BAND_PX = 1;

export function createMeasureIngest(world: World, queue: MeasureQueue): System {
  return defineSystem(
    anchorQ,
    (b, ctx) => {
      // Tag-only anchor query matches every archetype; do the drain exactly once
      // for the batch actually holding the canvas surface (mirrors pointerIngest).
      if (b.count === 0) return;
      const events = queue.drain();
      if (events.length === 0) return;

      // Fold last-wins per entity: one add/set per entity per tick (addComponent
      // defers, so a same-tick pair would otherwise duplicate at flush).
      const folded = new Map<Entity, { w: number; h: number }>();
      for (const ev of events) folded.set(ev.entity, { w: ev.w, h: ev.h });

      for (const [e, m] of folded) {
        if (m.w === 0 && m.h === 0) continue; // hidden-measure corruption guard (§2)
        if (!ctx.isAlive(e)) continue; // measured entity despawned between RO fire and ingest
        const cur = ctx.get(e, MeasuredSize);
        if (cur === undefined) {
          ctx.addComponent(e, MeasuredSize, { w: m.w, h: m.h });
          continue;
        }
        if (
          Math.abs(m.w - cur.w) > MEASURE_DEAD_BAND_PX ||
          Math.abs(m.h - cur.h) > MEASURE_DEAD_BAND_PX
        ) {
          ctx.edit(e).set(MeasuredSize, { w: m.w, h: m.h });
        }
      }
    },
    {
      name: "measureIngest",
      access: { write: [MeasuredSize] },
      runIf: () => queue.size() > 0,
    },
  );
}
