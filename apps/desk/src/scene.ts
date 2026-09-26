// A STILL, as the oracle states it (packages/desk/oracle/scenes.mjs), spawned INTO THE WORLD: the
// scene's objects become entities in ONE `undoable: false` transaction in the prototype's paint
// order (the mini mats, then the things in the oracle's `thingsOf` order — the whiteboards, the
// notes, the prints (D3w, scene-kinds.ts); each mini mat's inside as its CHILDREN, recursively, in
// the inside's own units), a whiteboard's strokes as ITS children (D3w), the camera is written, the
// mat's clocks and plate are pinned on the layer's handle (never in durable props — the brief's
// pinned detail), the rulers become the app's mat config, the committed ink raster is pinned on its
// note, a note's greeked writing on it too (the chips' lines — a still states them; the live text's
// layout is D2c's), the theme is set — and the desk draws the oracle's frame from the world
// (`rig:world` holds it to Dawn at maxΔ 0). `held` is a FLUX PIN (the lift's target), not a `Grab`:
// a Grab would also carry the object to the top (S1's rule), which the oracle's still does not do.
// `selected` is the real `Selected` tag.
//
// A NAV scene (D2b) flies for real: the desk draws the still once so the mini mat's face is AS DRAWN
// (the flight starts from it — design-015 §9), then `enterContainer` (or a `none` enter onto the
// inside's arrival and `exitContainer` back), and the flight is PINNED at the scene's progress by the
// host's `pinFlight` — the camera and the resource held there every tick, the frame a still.

import { abortNavFlight, attachSpawnBehaviors, attachSpawnParent, Camera, type CanvasEngine, cascadeDestroy, type Entity, guardedTransaction, Position, PrefabId, Size, widgetSpawnInits, writeRuntimeResource, defineQuery, Active } from "@ice/core";
import { DEFAULT_MAT_CONFIG, type DeskLayerHandle } from "@ice/desk/host";
import { MINIMAT_TYPE, MiniMat, NOTE_TYPE, Note } from "@ice/desk/objects";
import { HAND, MINIMAT, PAPER, type ThemeName } from "@ice/desk/theme";
import type { PaperKind } from "@ice/desk/kinds";
import { oracleFixtures } from "./fixtures";
import { boardSpec, type KindScene, layStrokes, type OracleBoard, type OraclePrint, type OracleThing, pinPrints, printFixture, type PrintFixture, printSpec, thingsOf } from "./scene-kinds";

/** A scene as scenes.mjs states one — the mat, ruler, paper, minimat and nav scenes' fields, the D3w kinds' (scene-kinds.ts). */
export interface OracleScene extends KindScene {
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
  /** A flight pinned at `p`: into (`enter`) or out of (`exit`) the mini mat at `container` (an index into `minimats`). */
  readonly nav?: OracleNav;
  /** Live insides on (the default); false = every face draws its far LOD alone. */
  readonly portals?: boolean;
  /** The root's dressing pinned. */
  readonly lodZoom?: number;
}
export interface OracleNav { readonly kind: "enter" | "exit"; readonly container: number; readonly p: number }
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
  /** The note's lines of writing as the far LOD greeks them: [baseline, width], note units (scenes.mjs). */
  readonly greek?: readonly (readonly [number, number])[];
}
export interface OracleInside extends KindScene {
  readonly minimats?: readonly OracleMiniMat[];
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
  readonly inside?: OracleInside;
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

/** The scene's note as a spawn: the oracle's defaults (`seed ?? 1`, `pen ?? "felt"`, the product's one paper, 200²). */
const noteSpec = (n: OracleNote, parent?: Entity): SpawnSpec => {
  if (n.angle !== undefined) throw new Error("desk: a scene note with an explicit angle — the tilt is the seed's (no angle prop)");
  return { type: NOTE_TYPE, cx: n.x, cy: n.y, w: n.w ?? PAPER.size, h: n.h ?? PAPER.size, props: { seed: n.seed ?? 1, pen: n.pen ?? "felt", paper: "yellow", text: n.text ?? "" }, ...(parent === undefined ? {} : { parent }) };
};
const matSpec = (m: OracleMiniMat, parent?: Entity): SpawnSpec => ({ type: MINIMAT_TYPE, cx: m.x, cy: m.y, w: m.w ?? MINIMAT.size.w, h: m.h ?? MINIMAT.size.h, props: { name: m.name ?? "", vinyl: m.tone ?? "sage" }, ...(parent === undefined ? {} : { parent }) });

export interface SceneHost {
  readonly engine: CanvasEngine;
  readonly handle: DeskLayerHandle;
  setTheme(name: ThemeName, pin: boolean): void;
  /** Hold the flight on at progress `p` every tick (a still of a flight frame); `null` lets it fly. */
  pinFlight(p: number | null): void;
}

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** What a desk's spawn made, by kind, in the scene's own order. */
export interface Staged { readonly notes: Entity[]; readonly minimats: Entity[]; readonly boards: Entity[]; readonly prints: Entity[] }

/** A thing as a spawn (the oracle's `thingsOf` order) into `parent` — a whiteboard is a ROOT object (D-D18): never a mini mat's child; a print nests. */
function thingSpec(t: OracleThing, parent: Entity | undefined, photo: PrintFixture | null): SpawnSpec {
  if (t.kind === "note") return noteSpec(t, parent);
  if (t.kind === "board") {
    if (parent !== undefined) throw new Error("desk: a whiteboard is a ROOT object (D-D18) — a scene cannot lay one inside a mini mat");
    return boardSpec(t);
  }
  if (t.kind === "print" && photo !== null) return { ...printSpec(t, photo), ...(parent === undefined ? {} : { parent }) };
  throw new Error(`desk: a scene's "${t.kind}" needs its D3w world half`);
}

/**
 * Spawn a desk's mini mats and things into `parent` (the open frame, or a mini mat), recursing into every
 * mini mat's inside: the mats first (sheets), then the things in the oracle's `thingsOf` order — one
 * transaction per desk, the children's after their parent's (its entity must exist to be their `ChildOf`);
 * the whiteboards' strokes their children, in one more (D3w). Pins the flux, the rasters and the greeked
 * writing as it goes. Returns the desk's own entities in spawn order.
 */
async function spawnDesk(host: SceneHost, fx: Awaited<ReturnType<typeof oracleFixtures>>, desk: OracleInside, parent: Entity | undefined, selected: Entity[]): Promise<Staged> {
  const { engine, handle } = host;
  const mats = desk.minimats ?? [];
  const things = thingsOf(desk);
  const photo = things.some((t) => t.kind === "print") ? await printFixture(handle) : null;   // the picture in the store and on the device first
  const spawned = spawnAll(engine, [...mats.map((m) => matSpec(m, parent)), ...things.map((t) => thingSpec(t, parent, photo))], false);
  const matEntities = spawned.slice(0, mats.length);
  const thingEntities = spawned.slice(mats.length);
  const of = <K extends OracleThing["kind"]>(kind: K) => things.flatMap((t, i) => (t.kind === kind ? [{ entity: thingEntities[i] as Entity, spec: t as Extract<OracleThing, { kind: K }> }] : []));
  const notes = of("note");
  const boards = of("board").map((b) => ({ entity: b.entity, spec: b.spec as OracleBoard }));
  layStrokes(engine, boards);
  const prints = of("print").map((p) => ({ entity: p.entity, spec: p.spec as OraclePrint }));
  // the facts and the flux a still states: selected → the tag (one `setSelection` for the scene); held → the lift's target pinned (never a Grab: no raise)
  const flagged = [...mats.map((m, i) => ({ entity: matEntities[i] as Entity, spec: m as { selected?: boolean; held?: boolean } })), ...things.map((t, i) => ({ entity: thingEntities[i] as Entity, spec: t as { selected?: boolean; held?: boolean } }))];
  for (const f of flagged) {
    if (f.spec.selected) selected.push(f.entity);
    if (f.spec.held) handle.pinFlux(f.entity, { lift: 1 });
  }
  pinPrints(handle, prints);   // a print's pose is its body's (height, slope, bend, the hand) — pinned on the photo kind
  for (const { entity: e, spec: n } of notes) {
    // the committed ink raster on the note that carries it — allocated in scene order, so it lands where the oracle's did
    if (n.asset === "note-1" && fx.inkMeta.w > 0) {
      const ok = handle.pinRaster(e, fx.ink, { w: fx.inkMeta.w, h: fx.inkMeta.h });
      if (!ok) throw new Error("desk: the ink pages refused the committed raster");
    } else if (n.asset !== undefined) throw new Error(`desk: unknown note asset "${n.asset}"`);
    // the writing the far LOD greeks (frame.mjs `childrenOf`: x0 = the hand's pad, em = its size)
    if (n.greek !== undefined && n.greek.length > 0) handle.pinGreek(e, { x0: HAND.pad, em: HAND.size, lines: n.greek.map(([y, width]) => ({ y, width })) });
  }
  for (let i = 0; i < mats.length; i++) {
    const inside = mats[i]?.inside;
    if (inside === undefined) continue;
    await spawnDesk(host, fx, inside, matEntities[i] as Entity, selected);
  }
  return { notes: notes.map((n) => n.entity), minimats: matEntities, boards: boards.map((b) => b.entity), prints: prints.map((p) => p.entity) };
}

/** Spawn the scene, pin the mat, the rasters and the flux, set the camera and the theme; fly and pin a nav scene. Resolves once every asset is uploaded. */
export async function setScene(host: SceneHost, s: OracleScene): Promise<Staged> {
  const { engine, handle } = host;
  // the ground must be here: the paper pass takes the raster, the mat the plates
  while (!handle.available()) { if (handle.status().state === "failed") throw new Error(`desk: ${handle.status().message}`); await frame(); }
  const fx = await oracleFixtures();
  // 1. a fresh desk at the root: any flight ENDED (unpinned, a pinned exit flight at depth 0 would fly on and drive the camera through
  //    this scene's setup), any frame left, every object gone, the rasters forgotten and the pages carved afresh, every pin lifted
  host.pinFlight(null);
  abortNavFlight(engine.world);
  while (engine.nav.depth() > 0) engine.ops.exitContainer({ transition: "none" });
  clearDesk(engine);
  handle.clearRasters();
  handle.pinMat(null);
  handle.clearFlux();
  handle.setPortals(s.portals !== false);
  handle.pinLodZoom(s.lodZoom ?? null);
  handle.freeze(false);
  handle.holdRedress(false);
  // 2. the theme, pinned (the OS no longer leads)
  host.setTheme(s.theme, true);
  // 3. the objects, in the prototype's paint order — the mini mats (sheets), then the things (the oracle's `thingsOf`: the
  //    whiteboards, the notes, the prints) — and every inside as children; the boards' strokes their children (D3w)
  const selected: Entity[] = [];
  const root = await spawnDesk(host, fx, s, undefined, selected);
  // 4. the facts a still states: selected → the tag (the flux pins were made as the objects were spawned)
  engine.ops.setSelection(selected, "replace");
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
  // 8. a NAV scene: the desk draws the still once — the mini mat's face is then AS DRAWN, and the flight starts from it (design-015 §9,
  //    the seam) — then the op, and the flight pinned at the scene's progress
  if (s.nav !== undefined) {
    const container = root.minimats[s.nav.container];
    if (container === undefined) throw new Error(`desk: the nav scene names mini mat ${s.nav.container}, which the scene does not have`);
    for (let i = 0; i < 3; i++) await frame();
    if (s.nav.kind === "enter") engine.ops.enterContainer(container);
    else {
      // the way back out: in as a cut onto the inside's arrival (the oracle's innerCam), then the exit flight to the scene's camera
      engine.ops.enterContainer(container, { transition: "none" });
      for (let i = 0; i < 2; i++) await frame();
      engine.ops.exitContainer();
    }
    host.pinFlight(s.nav.p);
  }
  return root;
}

export { MiniMat, Note };
