/**
 * Band (infra) — the ONE writer of `SurfaceBand` (design-013 §5, §6 step 2).
 *
 * A card's pixels are held at a zoom BAND, not at the live zoom, and the band
 * is held with hysteresis: it changes only when the zoom leaves
 * `[band × 0.5, band × 2]`. Bands are powers of two, each covering a 4× display
 * range (`@ice/kernel/zoom-bands`, ported from v1's RFC-002).
 *
 * ── The rule, credited ─────────────────────────────────────────────────────
 * This is `ground/src/compositor/dom-source-binder.ts`'s band block, moved into
 * the world unchanged. Its own comment, verbatim:
 *
 *   > BAND, with hysteresis: keep the one this slot was sized for until the
 *   > zoom leaves its 4× window, then step to the band for the current zoom.
 *   > `isOutOfBand` returns false for a slot that has never been banded, so the
 *   > `?? 0` first sight always takes the else branch.
 *
 * and the reason the ladder is not re-derived, also its:
 *
 *   > design-004 §3's band semantics are the vocabulary for BOTH surface kinds,
 *   > and r3f's island pool already allocates its FBOs through
 *   > `fboPixelSize`/`isOutOfBand`. Two different quantisations would mean a dom
 *   > card and a GL widget on one board re-rasterising at different moments
 *   > during the same pinch — visibly, and for no reason anyone could name.
 *
 * What CHANGES is where the answer lives. The binder held bands in a private
 * `Map<Entity, number>` beside the atlas, which made it one of two writers of
 * the number the write-back also computed — the zoom drift (its ERRATA
 * 2026-08-31 / the M18 open item, CONFIRMED 2026-09-06). The band is now a
 * world fact with one writer, and `kernel/surface-geometry.ts` is the one place
 * it turns into pixels. The binder keeps running on its own map until B4 takes
 * it; nothing here reads or writes that map.
 *
 * ── What it walks, and what it leaves alone ────────────────────────────────
 *  - Only cards whose `effectiveTarget` is `gpu`. A dom-target card stays at
 *    band 0 forever: it has no texture, so it has no resolution to choose.
 *  - CULLED cards keep their band. Retention is per `(entity, band)` (§4), and
 *    dropping the band off-screen would throw away the key that makes coming
 *    back a cache hit.
 *  - Kind strategy does NOT enter here. Band is the retention key for `band`
 *    and `crisp` alike; `geometry()` is where the strategies differ (D9).
 *
 * ── The gate ───────────────────────────────────────────────────────────────
 * The guard is a real `runIf` (`helpers/churn-guard.ts`), never a body
 * early-out: this system declares `access.write`, and strata blanket-stamps a
 * declared write for any system that RUNS — including one that returns
 * immediately. A pan changes neither zoom nor dpr nor any subscribed component,
 * so a pan frame does not enter the body at all.
 */
import type { Entity, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import { isOutOfBand, selectBand } from "@ice/kernel";
import { Camera, Culled, Viewport, Visible } from "../catalog/camera-derived";
import { Size } from "../catalog/scene";
import {
  SurfaceBand,
  SurfaceKind,
  SurfaceTarget,
  effectiveTarget,
} from "../catalog/surface";
import { devGuardsEnabled } from "../guards/dev";
import { makeChurnGuard } from "../helpers/churn-guard";

const bandableQ = defineQuery([SurfaceKind, SurfaceTarget, SurfaceBand, Visible]);

export function createSurfaceBandSystem(world: World): TickSystem {
  // `extra`: the camera zoom and the viewport dpr are RESOURCES, so no
  // collector journals them — they are compared by value here, every frame, so
  // the cache stays current whether or not the gate fires (the breakpoint
  // system's precedent).
  let lastZoom: number | undefined;
  let lastDpr: number | undefined;
  const guard = makeChurnGuard(
    world,
    { components: [Size, SurfaceTarget], tags: [Visible, Culled], coarse: false },
    () => {
      const zoom = world.getResource(Camera)?.zoom;
      const dpr = world.getResource(Viewport)?.dpr;
      const changed = zoom !== lastZoom || dpr !== lastDpr;
      lastZoom = zoom;
      lastDpr = dpr;
      return changed;
    },
  );

  return defineTickSystem(
    (ctx) => {
      const work = guard.take();
      if (work === undefined) return; // runIf false — unreachable with the guard wired
      const zoom = ctx.getResource(Camera)?.zoom ?? 1;

      const reband = (e: Entity): void => {
        const kindCell = ctx.get(e, SurfaceKind);
        const targetCell = ctx.get(e, SurfaceTarget);
        const bandCell = ctx.get(e, SurfaceBand);
        if (kindCell === undefined || targetCell === undefined || bandCell === undefined) return;
        const kind = kindCell.kind as "dom" | "gl" | "video";
        const declared = targetCell.target as "dom" | "gpu";
        // D5's dev guard. A gl island and a video surface ARE textures — they
        // have no live-DOM mode — so a behaviour that wrote `dom` on one has a
        // bug that would otherwise show up as a card that never bands, never
        // allocates and draws plate-only forever. Loud in dev, coerced in prod
        // by `effectiveTarget`, never blank.
        if (devGuardsEnabled() && kind !== "dom" && declared === "dom") {
          throw new Error(
            `ice: entity ${e} has SurfaceKind "${kind}" but SurfaceTarget "dom" — a "${kind}" surface has no live-DOM mode (design-013 D5). Its kind behaviour must write gpu.`,
          );
        }
        if (effectiveTarget(kind, declared) !== "gpu") return;
        const held = bandCell.band;
        // The binder's rule, one writer now. `isOutOfBand` answers false for a
        // never-banded card, so the `band === 0` term is what gives it a first
        // band at all.
        const next = held === 0 || isOutOfBand(zoom, held) ? selectBand(zoom) : held;
        if (next !== held) ctx.edit(e).set(SurfaceBand, { band: next });
      };

      if (work.full) {
        ctx.query(bandableQ).each((b) => {
          for (const r of b) reband(b.entity(r));
        });
        return;
      }
      for (const e of work.changed) {
        // Journaled entities are re-read entity-wise; the query terms are
        // re-checked because a delta record says only "something moved".
        if (!ctx.isAlive(e) || !ctx.hasTag(e, Visible)) continue;
        reband(e);
      }
    },
    { name: "surfaceBand", access: { write: [SurfaceBand] }, runIf: guard.runIf },
  );
}
