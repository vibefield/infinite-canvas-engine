/**
 * The tray's preview SANDBOX (2026-07-19, James: tiles should be "real
 * previews of the widget … render them as native react component directly").
 *
 * Widget components depend on exactly (world, entity) — so a real preview is
 * just the real component mounted against a PRIVATE engine: one lazy
 * module-level instance, its own in-memory doc, one spawned widget per type
 * with default props, and (almost) never stepped — no adapters, no
 * reflectors, no rAF loop. The preview entities never receive Selected/Grab/
 * overlap tags, so chrome (CardShell) renders its resting state permanently:
 * "static" falls out of the sandbox, no per-widget preview mode exists.
 * Interaction is killed at the tile wrapper (`inert` + pointer-events none).
 *
 * Module singleton on purpose: StrictMode double-mounts share it, the tray
 * can unmount/remount freely, and the ~20 spawned entities live for the
 * session (a dev-HMR leak of one small world is accepted).
 */
import { createCanvasEngine, widgets, type CanvasEngine, type Entity } from "@ice/core";

export interface PreviewSandbox {
  readonly ce: CanvasEngine;
  readonly entities: ReadonlyMap<string, Entity>;
}

let sandbox: PreviewSandbox | null = null;

export function getPreviewSandbox(): PreviewSandbox {
  if (sandbox !== null) return sandbox;
  const defs = widgets.all();
  const ce = createCanvasEngine({ widgets: defs });
  ce.docs.create();
  const entities = new Map<string, Entity>();
  for (const def of defs) {
    if (def.surface === "gl") continue; // GL tiles are baked snapshots, not live mounts
    entities.set(def.type, ce.ops.spawnWidget(def.type, { x: 0, y: 0, undoable: false }));
  }
  ce.world.sync();
  // Two settle ticks (equip stamps, membership) — then the sandbox idles
  // forever; component-internal timers (the clock) tick on wall time.
  ce.step(16);
  ce.step(32);
  sandbox = { ce, entities };
  return sandbox;
}
