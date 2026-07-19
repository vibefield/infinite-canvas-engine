/**
 * The insert-ghost reap (cleanup phase; catalog/insert.ts, 2026-07-19).
 *
 * Three exits for a tray-insert ghost, all owned here so nothing transient
 * crosses frames unaccounted (design-002 §2 cleanup law):
 *
 *  - PROMOTED (`GhostCommitted`, set by moveBehavior at the create commit):
 *    despawned ONE tick after the commit — the projected twin lands at the
 *    NEXT sync, so waiting one tick makes the swap happen inside a single
 *    reflect flush (twin mounts, ghost unmounts, same frame — no blink).
 *    Selection rides the same beat: the doc sink parked the twin ids in its
 *    out-of-ECS hand-off (`drainCreatedSelections`); they are drained on the
 *    commit tick and applied HERE one tick later, when the projection is
 *    alive — the select-on-grab the ghost held transfers to the real widget.
 *
 *  - RETIRING (`GhostRetiring`, cancel / rejected drop): despawned when the
 *    fly-back `TransformTween` lands (camera-sim removes it on arrival).
 *
 *  - STRANDED (no Grab, no tween, no live recognizer still capturing it): a
 *    clean click on a tray tile (the drag never formed), or an integrity
 *    cancel that raced the claim. Despawned silently — it never left the
 *    press point under the tray.
 */
import type { Entity, System, SystemCtx, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import {
  Captures,
  GesturePhases,
  GhostCommitted,
  GhostRetiring,
  Grab,
  InsertGhost,
  Selected,
  TransformTween,
} from "../catalog";
import { drainCreatedSelections } from "../doc/doc-commit-sink";
import { SelectionVersion, bumpVersion } from "../helpers/version-stamps";
import { selectedEntities } from "../ops/selection";

const P = GesturePhases;
const ghostQ = defineQuery([InsertGhost]);

/** Terminal recognizer phases — a capture from one no longer holds the ghost. */
function isTerminal(ctx: SystemCtx, rec: Entity): boolean {
  return (
    ctx.hasTag(rec, P.tags.Ended) ||
    ctx.hasTag(rec, P.tags.Failed) ||
    ctx.hasTag(rec, P.tags.Cancelled) ||
    ctx.hasTag(rec, P.tags.Recognized)
  );
}

export function createInsertGhostReap(world: World): System {
  // Commit-tick memory (both live exactly one tick, and only while the ghost
  // is still alive — the zero-match chunk skip can never starve them):
  // ghosts sighted GhostCommitted last tick → despawn now; twin ids drained
  // last tick → their projection is alive now, select them.
  const committedSeen = new Set<Entity>();
  let pendingSelect: Entity[] = [];

  return defineSystem(
    ghostQ,
    (b, ctx) => {
      if (pendingSelect.length > 0) {
        const live = pendingSelect.filter((e) => ctx.isAlive(e));
        pendingSelect = [];
        if (live.length > 0) {
          const keep = new Set(live);
          for (const s of selectedEntities(world)) {
            if (!keep.has(s)) ctx.removeTag(s, Selected);
          }
          for (const e of live) {
            if (!ctx.hasTag(e, Selected)) ctx.addTag(e, Selected);
          }
          bumpVersion(world, SelectionVersion);
        }
      }

      for (const r of b) {
        const ghost = b.entity(r);
        if (ctx.hasTag(ghost, GhostCommitted)) {
          if (committedSeen.has(ghost)) {
            committedSeen.delete(ghost);
            ctx.destroy(ghost); // twin projected THIS tick's sync — same-flush swap
          } else {
            committedSeen.add(ghost); // commit tick — twin lands next sync
          }
          continue;
        }
        if (ctx.hasTag(ghost, GhostRetiring)) {
          if (!ctx.has(ghost, TransformTween)) ctx.destroy(ghost); // tween landed
          continue;
        }
        if (ctx.has(ghost, Grab) || ctx.has(ghost, TransformTween)) continue;
        const held = ctx.getReverse(ghost, Captures).some((rec) => !isTerminal(ctx, rec));
        if (!held) ctx.destroy(ghost); // stranded — click-no-drag or a raced cancel
      }

      // Drained on the COMMIT tick (sink wrote it in ctl:behave, this phase is
      // cleanup — same tick); applied at the top of the NEXT pass, above.
      const created = drainCreatedSelections(world);
      if (created.length > 0) pendingSelect.push(...created);
    },
    { name: "insertGhostReap" },
  );
}
