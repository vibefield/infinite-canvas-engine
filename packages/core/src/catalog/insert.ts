/**
 * Tray-insert ghosts (2026-07-19, James: the widget tray — "the widget
 * duplicate … and user drag it to canvas and drop").
 *
 * A ghost is a DRAFT spawn (design-001 §3 two-phase promote; instantiate's
 * `{ draft: true }` world-path opt-in): a full, live, runtime-only instance of
 * a durable widget prefab that exists ONLY for the adoption drag. It is picked,
 * lifted, snapped and drop-evaluated exactly like a projected widget — the
 * whole point — and it NEVER touches the document: a successful release
 * promotes it through the gesture's single `create` commit (one tx, one undo
 * step) and the reap system swaps it for the projected twin; a cancel or a
 * rejected drop flies it back to the tray and despawns it, zero undo footprint.
 */
import { field } from "@vibecook/strata-ecs";
import { defineComponent, defineTag } from "../schema/meta";

/**
 * The ghost marker + its promote payload, attached at `ops.insertByDrag`:
 * `type`/`props` (JSON) rebuild the widget in the commit's `CommitCreate`;
 * `screenX/screenY` remember the tray press point IN SCREEN SPACE so the
 * cancel fly-back re-projects it through the CURRENT camera — the ghost
 * returns to the tray on screen even if the user zoomed mid-drag.
 */
export const InsertGhost = defineComponent("InsertGhost", {
  type: "string",
  props: field("string", { default: "{}" }),
  screenX: "f32",
  screenY: "f32",
});

/**
 * Set by moveBehavior when the ghost's gesture committed its `create` intent.
 * The reap system despawns the ghost ONE tick later — the projected twin lands
 * at the next sync, so the swap happens inside a single reflect flush (no
 * one-frame blink of neither).
 */
export const GhostCommitted = defineTag("GhostCommitted");

/**
 * Set on the cancel / rejected-drop paths together with the fly-back
 * `TransformTween`: the reap system despawns the ghost when the tween lands
 * (component removed on arrival — camera-sim).
 */
export const GhostRetiring = defineTag("GhostRetiring");
