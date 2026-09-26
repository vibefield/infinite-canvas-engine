// A STILL, as the oracle states it (packages/desk/oracle/scenes.mjs), spawned INTO THE WORLD: the
// scene's objects become entities in ONE `undoable: false` transaction in the prototype's paint
// order (the mini mats, then the notes), the camera is written, the mat's clocks and plate are pinned
// on the layer's handle (never in durable props — the brief's pinned detail), the rulers become the
// app's mat config, the committed ink raster is pinned on its note, the theme is set — and the
// desk draws the oracle's frame from the world (`rig:world` holds it to Dawn at maxΔ 0). `held`
// is a FLUX PIN (the lift's target), not a `Grab`: a Grab would also carry the object to the top
// (S1's rule), which the oracle's still does not do. `selected` is the real `Selected` tag.
//
// The minimat and nav scenes state insides and flights — D2b's; a scene naming them throws here so a
// rig never compares a half-drawn frame.

import { attachSpawnBehaviors, attachSpawnParent, Camera, type CanvasEngine, cascadeDestroy, type Entity, guardedTransaction, Position, PrefabId, Size, widgetSpawnInits, writeRuntimeResource, defineQuery, Active } from "@ice/core";
import { DEFAULT_MAT_CONFIG, type DeskLayerHandle } from "@ice/desk/host";
import { MINIMAT_TYPE, MiniMat, NOTE_TYPE, Note } from "@ice/desk/objects";
import { MINIMAT, PAPER, type ThemeName } from "@ice/desk/theme";
import type { PaperKind } from "@ice/desk/kinds";
import { oracleFixtures } from "./fixtures";

/** A scene as scenes.mjs states one — the mat, ruler and paper scenes' fields (the rest is D2b's). */
export interface OracleScene {
  readonly camX: number;
  readonly camY: number;
  readonly zoom: number;
  readonly theme: ThemeName;
  readonly mat?: { readonly time?: number; readonly goboTime?: number; readonly noise?: readonly [number, number]; readonly opacity?: number; readonly plate?: "c" | "b"; readonly wind?: number };
  readonly ruler?: Readonly<Record<string, unknown>>;
  readonly notes?: readonly OracleNote[];
  readonly minimats?: readonly OracleMiniMat[];
  readonly paper?: { readonly chain?: boolean };
  readonly fadeIn?: readonly [number, number];
  readonly nav?: unknown;
  readonly portals?: boolean;
  readonly lodZoom?: number;
}
export interface OracleNote {
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  readonly seed?: number;
  readonly text?: string;
  readonly pen?: string;
  readonly paper?: string;
  readonly selected?: boolean;
  readonly held?: boolean;
  readonly asset?: string;
  readonly angle?: number;
}
export interface OracleMiniMat {
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  readonly name?: string;
  readonly tone?: string;
  readonly selected?: boolean;
  readonly held?: boolean;
  readonly inside?: unknown;
}

const widgetsQ = defineQuery([Position, Size, PrefabId]);

/** Every widget on the desk, gone in ONE non-undoable transaction (a scene replaces the desk). */
export function clearDesk(engine: CanvasEngine): void {
  const session = engine.docs.current();
  if (session === undefined) throw new Error("desk: no document");
  const all: Entity[] = [];
  engine.world.query(widgetsQ).each((b) => { for (const r of b) all.push(b.entity(r)); });
  engine.ops.clearSelection();
  if (all.length === 0) return;
  // the store's own transaction, not the guarded one: `cascadeDestroy` takes strata's Mutator (the facade's `deleteSelection` does the same)
  session.store.transaction((tx) => { for (const e of all) if (engine.world.isAlive(e)) cascadeDestroy(tx, engine.world, e); }, { undoable: false });
}

export interface SpawnSpec {
  readonly type: string;
  /** The CENTRE, world units (the prototype's convention) — converted to ICE's top-left here. */
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  readonly props: Readonly<Record<string, unknown>>;
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
      attachSpawnParent(tx, world, e, {});
      attachSpawnBehaviors(tx, widget, e);
      out.push(e);
    }
  }, undoable ? undefined : { undoable: false });
  // `Active` is derived in the tick; the facade's own spawn stamps it for a spawn into the open frame, so the scope-filtered ops see it now
  for (const e of out) if (!world.hasTag(e, Active)) world.addTag(e, Active);
  return out;
}

/** The scene's note as a spawn: the oracle's defaults (`seed ?? 1`, `pen ?? "felt"`, the product's one paper, 200²). */
const noteSpec = (n: OracleNote): SpawnSpec => {
  if (n.angle !== undefined) throw new Error("desk: a scene note with an explicit angle — the tilt is the seed's (no angle prop)");
  return { type: NOTE_TYPE, cx: n.x, cy: n.y, w: n.w ?? PAPER.size, h: n.h ?? PAPER.size, props: { seed: n.seed ?? 1, pen: n.pen ?? "felt", paper: "yellow", text: n.text ?? "" } };
};
const matSpec = (m: OracleMiniMat): SpawnSpec => ({ type: MINIMAT_TYPE, cx: m.x, cy: m.y, w: m.w ?? MINIMAT.size.w, h: m.h ?? MINIMAT.size.h, props: { name: m.name ?? "", vinyl: m.tone ?? "sage" } });

export interface SceneHost {
  readonly engine: CanvasEngine;
  readonly handle: DeskLayerHandle;
  setTheme(name: ThemeName, pin: boolean): void;
}

/** Spawn the scene, pin the mat, the rasters and the flux, set the camera and the theme. Resolves once every asset is uploaded. */
export async function setScene(host: SceneHost, s: OracleScene): Promise<{ readonly notes: Entity[]; readonly minimats: Entity[] }> {
  const { engine, handle } = host;
  if (s.nav !== undefined) throw new Error("desk: a nav scene needs D2b (the flight, the departed desk)");
  if ((s.minimats ?? []).some((m) => m.inside !== undefined && Object.keys(m.inside as object).some((k) => ((m.inside as Record<string, unknown[]>)[k] ?? []).length > 0))) throw new Error("desk: a scene with a mini mat's inside needs D2b (the live insides, the chips)");
  if (s.portals === false || s.lodZoom !== undefined) throw new Error("desk: a scene with portals/lodZoom needs D2b");
  // the ground must be here: the paper pass takes the raster, the mat the plates
  while (!handle.available()) { if (handle.status().state === "failed") throw new Error(`desk: ${handle.status().message}`); await new Promise((r) => requestAnimationFrame(r)); }
  const fx = await oracleFixtures();
  // 1. a fresh desk: every object gone, the rasters forgotten and the pages carved afresh, the pins lifted
  clearDesk(engine);
  handle.clearRasters();
  handle.pinMat(null);
  handle.clearFlux();
  // 2. the theme, pinned (the OS no longer leads)
  host.setTheme(s.theme, true);
  // 3. the objects, in the prototype's paint order — the mini mats (sheets), then the notes (things) — one transaction
  const mats = s.minimats ?? [];
  const notes = s.notes ?? [];
  const spawned = spawnAll(engine, [...mats.map(matSpec), ...notes.map(noteSpec)], false);
  const matEntities = spawned.slice(0, mats.length);
  const noteEntities = spawned.slice(mats.length);
  // 4. the facts and the flux a still states: selected → the tag; held → the lift's target pinned (never a Grab: no raise)
  const selected = [...mats.flatMap((m, i) => (m.selected ? [matEntities[i] as Entity] : [])), ...notes.flatMap((n, i) => (n.selected ? [noteEntities[i] as Entity] : []))];
  engine.ops.setSelection(selected, "replace");
  mats.forEach((m, i) => { if (m.held) handle.pinFlux(matEntities[i] as Entity, { lift: 1 }); });
  notes.forEach((n, i) => { if (n.held) handle.pinFlux(noteEntities[i] as Entity, { lift: 1 }); });
  // 5. the camera: the prototype's camX/camY/zoom ARE ICE's Camera
  writeRuntimeResource(engine.world, Camera, { x: s.camX, y: s.camY, zoom: s.zoom, gesturing: false });
  // 6. the mat: the oracle's fixtures on it (its plates, its committed glyphs), its config from the engine's defaults with the scene's
  //    gobo and rulers (the rulers print on the ROOT of a scene that says `ruler`), its clocks pinned (a still: wind 0)
  handle.setPlate("c", fx.goboC);
  handle.setPlate("b", fx.goboB);
  handle.setGlyphs(fx.glyphs, fx.glyphMeta);
  handle.configureMat({ ...DEFAULT_MAT_CONFIG, ruler: { ...DEFAULT_MAT_CONFIG.ruler, ...(s.ruler ?? {}), on: s.ruler !== undefined } });
  handle.configureFadeIn(s.fadeIn ?? [10, 20]);
  handle.pinMat({ time: s.mat?.time ?? 0, goboTime: s.mat?.goboTime ?? 0, noise: s.mat?.noise ?? [0, 0], opacity: s.mat?.opacity ?? DEFAULT_MAT_CONFIG.gobo.opacity, plate: s.mat?.plate ?? DEFAULT_MAT_CONFIG.gobo.plate, wind: 0 });
  // 7. the paper's law and chain (the oracle's `papers.law = DEFAULT; papers.chain = s.paper?.chain ?? false`)
  const paper = handle.ground()?.pass("paper") as PaperKind | undefined;
  if (paper !== undefined) paper.pass.chain = s.paper?.chain ?? false;
  // 8. the committed ink raster on the note that carries it — allocated first, so it lands where the oracle's did
  notes.forEach((n, i) => {
    if (n.asset === "note-1" && fx.inkMeta.w > 0) {
      const ok = handle.pinRaster(noteEntities[i] as Entity, fx.ink, { w: fx.inkMeta.w, h: fx.inkMeta.h });
      if (!ok) throw new Error("desk: the ink pages refused the committed raster");
    } else if (n.asset !== undefined) throw new Error(`desk: unknown note asset "${n.asset}"`);
  });
  return { notes: noteEntities, minimats: matEntities };
}

export { MiniMat, Note };
