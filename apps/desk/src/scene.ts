// The desk's SPAWN (the app's, and every door that puts an object down — the paste, the dev panel, the rigs' `spawn`):
// objects in ONE transaction at their CENTRES (the prototype's convention), in the order given. The oracle's scenes —
// `setScene`, the stills the rigs stage — are the RIGS' (src/rig/stage.ts, loaded by rig.html only: design-015 D7,
// D-D7-C.3); this module is the product's and imports only the published surface.

import { Active, attachSpawnBehaviors, attachSpawnParent, type CanvasEngine, type Entity, guardedTransaction, widgetSpawnInits } from "@ice/core";

export interface SpawnSpec {
  readonly type: string;
  /** The CENTRE, world units (the prototype's convention) — converted to ICE's top-left here. In a container, the inside's own units. */
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  readonly props: Readonly<Record<string, unknown>>;
  /** The container it goes INTO (a mini mat's child); absent = the open frame. */
  readonly parent?: Entity;
}

/** Spawn objects in ONE transaction (undoable or not), in the order given (= the sibling order = the paint order within a stratum). */
export function spawnAll(engine: CanvasEngine, specs: readonly SpawnSpec[], undoable: boolean): Entity[] {
  const session = engine.docs.current();
  if (session === undefined) throw new Error("desk: no document");
  const { world } = engine;
  const out: Entity[] = [];
  guardedTransaction(session.store, world, (tx) => {
    for (const s of specs) {
      const widget = engine.catalog.widget(s.type);
      if (widget === undefined) throw new Error(`desk: no object type "${s.type}"`);
      const { prefab, overrides } = widgetSpawnInits(s.type, { x: s.cx - s.w / 2, y: s.cy - s.h / 2, w: s.w, h: s.h, props: s.props }, widget);
      const e = tx.spawnPrefab(prefab, overrides);
      attachSpawnParent(tx, world, e, s.parent === undefined ? {} : { parent: s.parent });
      attachSpawnBehaviors(tx, widget, e);
      out.push(e);
    }
  }, undoable ? undefined : { undoable: false });
  // `Active` is derived in the tick; the facade's own spawn stamps it for a spawn into the open frame, so the scope-filtered ops see it
  // now — a mini mat's child is NOT a member of the open frame and waits for the tick's word
  specs.forEach((s, i) => { const e = out[i] as Entity; if (s.parent === undefined && !world.hasTag(e, Active)) world.addTag(e, Active); });
  return out;
}

