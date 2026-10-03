// A STILL, as the oracle states it (packages/objects/oracle/scenes.mjs), spawned INTO THE WORLD: the
// scene's objects become entities in ONE `undoable: false` transaction in the prototype's paint
// order (the mini mats, the desk calendars, then the things in the oracle's `thingsOf` order — the
// whiteboards, the notes, the prints, the notebooks (D3w, scene-kinds.ts); each mini mat's inside
// as its CHILDREN, recursively, in the inside's own units), a whiteboard's strokes as ITS children
// (D3w), the camera is written, the mat's clocks and plate are pinned on the layer's handle (never
// in durable props — the brief's pinned detail), the rulers become the app's mat config, the
// committed ink raster is pinned on its note, a note's greeked writing on it too (the chips' lines
// — a still states them; the live text's layout is D2c's), the theme is set — and the desk draws
// the oracle's frame from the world (`rig:world` holds it to Dawn at maxΔ 0). `held` is a FLUX PIN
// (the lift's target), not a `Grab`: a Grab would also carry the object to the top (S1's rule),
// which the oracle's still does not do. `selected` is the real `Selected` tag.
//
// A NAV scene (D2b) flies for real: the desk draws the still once so the mini mat's face is AS DRAWN
// (the flight starts from it — design-015 §9), then `enterContainer` (or a `none` enter onto the
// inside's arrival and `exitContainer` back), and the flight is PINNED at the scene's progress by the
// host's `pinFlight` — the camera and the resource held there every tick, the frame a still.
//
// The RIGS' module since design-015 D7 (D-D7-C.3): src/rig/, loaded by rig.html's harness only — the product page
// reaches `setScene` through the door src/rig-door.ts declares and refuses without it; the spawn itself is src/scene.ts.

import { abortNavFlight, Camera, type CanvasEngine, cascadeDestroy, type Entity, HeldView, Not, Position, PrefabId, Size, Specimen, specimensOf, trayEntity, writeRuntimeResource, defineQuery } from "@ice/core";
import { DEFAULT_MAT_CONFIG, type DeskLayerHandle } from "@ice/desk";
import { Calendar, CALENDAR_TYPE, MINIMAT_TYPE, MiniMat, NOTE_TYPE, Note, type PaperDriver } from "@ice/objects";
import { HAND, type ThemeName } from "@ice/desk";
import { MINIMAT, PAPER, type BoardInk, type PaperAsset, type PaperKind } from "@ice/objects";
import { oracleFixtures } from "./oracle-fixtures";
import { deskRig, type SceneHost, type Staged } from "../rig-door";
import { type SpawnSpec, spawnAll } from "../scene";
import { boardSpec, bookSpec, type KindScene, layBookInk, layEvents, layPins, layStrokes, type OracleBoard, type OracleBook, type OracleObject, type OraclePrint, type OracleThing, padSpec, pinBooks, pinPadPrints, pinPads, pinPrints, pinSpecimenPrint, printFixture, type PrintFixture, printSpec, generatedPicture, strokeSpecOf, thingsOf } from "./scene-kinds";

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
  /** An object IN HAND (design-015 §8, D4b): one of the scene's books, boards or pads by index, the carry pinned at `e`, the cover's target, the user's zoom and pan. */
  readonly hold?: OracleHold;
  /** The scene's own view (a phone's portrait still, D4b): the rig sets the page's metrics to it before spawning. */
  readonly view?: { readonly cssW: number; readonly cssH: number; readonly dpr: number };
  /**
   * The pegboard drawer (design-017, K3): its slide, the board's scroll — pinned. Absent: no tray drawn (every other scene's still).
   * `foot` (petition I21): the host's foot inset the still is drawn under — a MOUNT option of the layer, so the page must have been
   * mounted with it (`rig.html?trayFoot=…`); a still on a page with another foot is refused by name.
   */
  readonly tray?: { readonly p?: number; readonly scroll?: number; readonly foot?: number };
}
export interface OracleNav { readonly kind: "enter" | "exit"; readonly container: number; readonly p: number }
export interface OracleHold {
  readonly book?: number; readonly board?: number; readonly pad?: number; readonly e: number; readonly open?: boolean; readonly zoom?: number; readonly panX?: number; readonly panY?: number;
  /** The hand over a board in hand (D3t-a): a desk point, pressed or hovering, the eraser, the ink — pinned on the board kind's pen. */
  readonly pen?: { readonly x: number; readonly y: number; readonly press?: boolean; readonly erase?: boolean; readonly ink?: string };
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

/**
 * The calendar SPECIMEN shows the still's month, as the oracle pins it (K5a — a specimen has no local, so the calendar's clock pin never
 * reaches it; left alone it shows today's, and a still would move with the month).
 */
function pinSpecimenMonth(engine: CanvasEngine, month: string): void {
  const w = engine.world;
  const tray = trayEntity(w);
  const group = Calendar.groups.find((g) => g.name === Calendar.propToGroup.month);
  if (tray === undefined || group === undefined) return;
  for (const e of specimensOf(w, tray)) {
    if (w.get(e, PrefabId)?.id !== CALENDAR_TYPE) continue;
    const cell = w.get(e, group.component) as Record<string, unknown> | undefined;
    if (cell !== undefined && cell.month !== month) w.edit(e).set(group.component, { ...cell, month });
  }
}

/** A still's specimen faces (K5b): the note's committed raster (its word blanked); the pad unprinted (its month is the live print's alone — D-K5b.5). */
async function pinSpecimenFaces(engine: CanvasEngine, handle: DeskLayerHandle, ink: Uint8Array<ArrayBuffer>, inkMeta: { readonly w: number; readonly h: number }, noteDriver: () => PaperDriver | undefined): Promise<void> {
  const w = engine.world;
  const tray = trayEntity(w);
  if (tray === undefined) return;
  const text = Note.groups.find((g) => g.name === Note.propToGroup.text);
  for (const e of specimensOf(w, tray)) {
    const type = w.get(e, PrefabId)?.id;
    if (type === NOTE_TYPE && inkMeta.w > 0 && text !== undefined) {
      const cell = w.get(e, text.component) as Record<string, unknown> | undefined;
      if (cell !== undefined && cell.text !== "") w.edit(e).set(text.component, { ...cell, text: "" });
      if (noteDriver()?.writing()?.pin(e, ink, { w: inkMeta.w, h: inkMeta.h }) !== true) throw new Error("desk: the ink pages refused the specimen's committed raster");
    }
    // the pad's month is the live print's alone (D-K5b.5: the committed print holds level 2, the specimen samples far coarser): unprinted, as the oracle's
    if (type === CALENDAR_TYPE) await pinSpecimenPrint(handle, e, "2026-09", null);
  }
  handle.desk.wake("pin");
}

/** The desk's widgets — never the tray's specimens (K5a: runtime entities with a `PrefabId`, not the document's). */
const widgetsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

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

/** The scene's note as a spawn: the oracle's defaults (`seed ?? 1`, `pen ?? "felt"`, the product's one paper, 200²). */
const noteSpec = (n: OracleNote, parent?: Entity): SpawnSpec => {
  if (n.angle !== undefined) throw new Error("desk: a scene note with an explicit angle — the tilt is the seed's (no angle prop)");
  return { type: NOTE_TYPE, cx: n.x, cy: n.y, w: n.w ?? PAPER.size, h: n.h ?? PAPER.size, props: { seed: n.seed ?? 1, pen: n.pen ?? "felt", paper: "yellow", text: n.text ?? "" }, ...(parent === undefined ? {} : { parent }) };
};
const matSpec = (m: OracleMiniMat, parent?: Entity): SpawnSpec => ({ type: MINIMAT_TYPE, cx: m.x, cy: m.y, w: m.w ?? MINIMAT.size.w, h: m.h ?? MINIMAT.size.h, props: { name: m.name ?? "", vinyl: m.tone ?? "sage" }, ...(parent === undefined ? {} : { parent }) });

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));


/** A thing as a spawn (the oracle's `thingsOf` order) into `parent` — a whiteboard and a notebook are ROOT objects (D-D18): never a mini mat's children; a print nests. */
function thingSpec(t: OracleThing, parent: Entity | undefined, photo: PrintFixture | null, gen: ReadonlyMap<OracleThing, PrintFixture>): SpawnSpec {
  if (t.kind === "note") return noteSpec(t, parent);
  if (t.kind === "board") {
    if (parent !== undefined) throw new Error("desk: a whiteboard is a ROOT object (D-D18) — a scene cannot lay one inside a mini mat");
    return boardSpec(t);
  }
  if (t.kind === "print" && photo !== null) return { ...printSpec(t, typeof t.picture === "object" && t.picture !== null ? (gen.get(t) as PrintFixture) : photo), ...(parent === undefined ? {} : { parent }) };
  if (t.kind === "book") {
    if (parent !== undefined) throw new Error("desk: a notebook is a ROOT object (D-D18) — a scene cannot lay one inside a mini mat");
    return bookSpec(t);
  }
  throw new Error(`desk: a scene's "${t.kind}" needs its D3w world half`);
}

/** A plugin's object as a spawn (K8b): its type must be registered on the page (rig.html `?plugins`); its size, its type's unless stated. */
function objectSpec(engine: CanvasEngine, o: OracleObject, parent: Entity | undefined): SpawnSpec {
  const widget = engine.catalog.widget(o.type);
  if (widget === undefined) throw new Error(`desk: the scene lays a "${o.type}" and this page registered no such type (rig.html?plugins)`);
  return { type: o.type, cx: o.x, cy: o.y, w: o.w ?? widget.defaultSize.w, h: o.h ?? widget.defaultSize.h, props: o.props ?? {}, ...(parent === undefined ? {} : { parent }) };
}

/**
 * Spawn a desk's mini mats, desk calendars and things into `parent` (the open frame, or a mini mat), recursing
 * into every mini mat's inside: the mats first (sheets), then the pads, then the things in the oracle's `thingsOf`
 * order — one transaction per desk, the children's after their parent's (its entity must exist to be their
 * `ChildOf`); the whiteboards' strokes and the pads' pins their children, in one more each (D3w). Pins the flux,
 * the rasters and the greeked writing as it goes. Returns the desk's own entities in spawn order.
 */
async function spawnDesk(host: SceneHost, fx: Awaited<ReturnType<typeof oracleFixtures>>, desk: OracleInside, parent: Entity | undefined, selected: Entity[]): Promise<Staged> {
  const noteDriver = (): PaperDriver | undefined => host.handle.driver(NOTE_TYPE) as PaperDriver | undefined;
  const { engine, handle } = host;
  const mats = desk.minimats ?? [];
  const things = thingsOf(desk);
  const photo = things.some((t) => t.kind === "print") ? await printFixture(handle) : null;   // the picture in the store and on the device first
  // …and the GENERATED pictures (K6a): made, stored and decoded by the product's decoder before the spawn, one per size and seed
  const gen = new Map<OracleThing, PrintFixture>();
  // (in turn: a 4096² canvas is 64 MB of the page's memory while it encodes)
  for (const t of things) if (t.kind === "print" && typeof t.picture === "object" && t.picture !== null) gen.set(t, await generatedPicture(handle, t.picture));
  const padSpecs = desk.calendars ?? [];
  if (parent !== undefined && padSpecs.length > 0) throw new Error("desk: a desk calendar is a ROOT object (D-D18) — a scene cannot lay one inside a mini mat");
  const spawned = spawnAll(engine, [...mats.map((m) => matSpec(m, parent)), ...padSpecs.map(padSpec), ...things.map((t) => (t.kind === "object" ? objectSpec(engine, t, parent) : thingSpec(t, parent, photo, gen)))], false);
  const matEntities = spawned.slice(0, mats.length);
  const padEntities = spawned.slice(mats.length, mats.length + padSpecs.length);
  const thingEntities = spawned.slice(mats.length + padSpecs.length);
  const of = <K extends OracleThing["kind"]>(kind: K) => things.flatMap((t, i) => (t.kind === kind ? [{ entity: thingEntities[i] as Entity, spec: t as Extract<OracleThing, { kind: K }> }] : []));
  const notes = of("note");
  const boards = of("board").map((b) => ({ entity: b.entity, spec: b.spec as OracleBoard }));
  layStrokes(engine, boards);
  const prints = of("print").map((p) => ({ entity: p.entity, spec: p.spec as OraclePrint }));
  const books = of("book").map((b) => ({ entity: b.entity, spec: b.spec as OracleBook }));
  layBookInk(engine, books);   // a book's writing: its strokes as its children, each on its page (D3t-b)
  layPins(engine, padEntities, notes);   // a note stuck to a day: a pin, a child of its pad (D3w)
  const padPairs = padSpecs.map((c, i) => ({ entity: padEntities[i] as Entity, spec: c }));
  layEvents(engine, padPairs);   // its entries: events, children of their pad (D3t-c)
  await pinPadPrints(handle, padPairs);   // …today pinned, the committed print (or none: blank) on each month it may show
  // the facts and the flux a still states: selected → the tag (one `setSelection` for the scene); held → the lift's target pinned (never a Grab: no raise)
  const flagged = [...mats.map((m, i) => ({ entity: matEntities[i] as Entity, spec: m as { selected?: boolean; held?: boolean } })), ...padSpecs.map((c, i) => ({ entity: padEntities[i] as Entity, spec: c as { selected?: boolean; held?: boolean } })), ...things.map((t, i) => ({ entity: thingEntities[i] as Entity, spec: t as { selected?: boolean; held?: boolean } }))];
  for (const f of flagged) {
    if (f.spec.selected) selected.push(f.entity);
    if (f.spec.held) handle.pinFlux(f.entity, { lift: 1 });
  }
  // a plugin's objects (K8b): the asset its kind defines, through the handle's generic door (the desk clock's pinned time), and the facts
  for (const { entity: e, spec: o } of of("object")) {
    if (o.asset !== undefined) handle.pinAsset(e, o.asset);
    if (o.selected) selected.push(e);
    if (o.held) handle.pinFlux(e, { lift: 1 });
  }
  pinPrints(handle, prints);   // a print's pose is its body's (height, slope, bend, the hand) — pinned on the photo kind
  pinBooks(handle, books);   // a book's (open, mid-turn, peeking, tilted) — pinned on the notebook kind
  pinPads(handle, padSpecs.map((c, i) => ({ entity: padEntities[i] as Entity, spec: c })));   // a pad's roll — on the calendar kind
  for (const { entity: e, spec: n } of notes) {
    // the committed ink raster on the note that carries it — allocated in scene order, so it lands where the oracle's did
    if (n.asset === "note-1" && fx.inkMeta.w > 0) {
      // through the note's writing (its driver's — D-D7-A.3): allocated NOW, in call order (the oracle's texels), given back when the note leaves the desk
      const ok = noteDriver()?.writing()?.pin(e, fx.ink, { w: fx.inkMeta.w, h: fx.inkMeta.h }) ?? false;
      handle.desk.wake("pin");
      if (!ok) throw new Error("desk: the ink pages refused the committed raster");
    } else if (n.asset !== undefined) throw new Error(`desk: unknown note asset "${n.asset}"`);
    // the writing the far LOD greeks (frame.mjs `childrenOf`: x0 = the hand's pad, em = its size) — and NONE where the still states
    // none: since K7b a small note greeks its own text's layout, which Node (no text metrics) cannot lay out — a still's lines are the
    // lines; through the handle's generic door (K8a — `pinAsset`): the asset is the paper kind's own shape (`PaperAsset`), never the desk's
    handle.pinAsset(e, { greek: { x0: HAND.pad, em: HAND.size, lines: (n.greek ?? []).map(([y, width]) => ({ y, width })) } } satisfies PaperAsset);
  }
  for (let i = 0; i < mats.length; i++) {
    const inside = mats[i]?.inside;
    if (inside === undefined) continue;
    await spawnDesk(host, fx, inside, matEntities[i] as Entity, selected);
  }
  return { notes: notes.map((n) => n.entity), minimats: matEntities, boards: boards.map((b) => b.entity), prints: prints.map((p) => p.entity), books: books.map((b) => b.entity), pads: padEntities, plugins: of("object").map((o) => o.entity) };
}

/** Spawn the scene, pin the mat, the rasters and the flux, set the camera and the theme; fly and pin a nav scene. Resolves once every asset is uploaded. */
export async function setScene(host: SceneHost, s: OracleScene): Promise<Staged> {
  const { engine, handle } = host;
  const noteDriver = (): PaperDriver | undefined => handle.driver(NOTE_TYPE) as PaperDriver | undefined;
  // the ground must be here: the paper pass takes the raster, the mat the plates
  while (!handle.available()) { if (handle.status().state === "failed") throw new Error(`desk: ${handle.status().message}`); await frame(); }
  const fx = await oracleFixtures();
  // 1. a fresh desk at the root: any flight ENDED (unpinned, a pinned exit flight at depth 0 would fly on and drive the camera through
  //    this scene's setup), any frame left, every object gone, the rasters forgotten and the pages carved afresh, every pin lifted
  host.pinFlight(null);
  abortNavFlight(engine.world);
  while (engine.nav.depth() > 0) engine.ops.exitContainer({ transition: "none" });
  clearDesk(engine);
  noteDriver()?.writing()?.reset();
  handle.desk.wake("pin");
  handle.pinMat(null);
  handle.clearFlux();
  handle.setPortals(s.portals !== false);
  handle.pinLodZoom(s.lodZoom ?? null);
  handle.freeze(false);
  handle.holdRedress(false);
  engine.ops.putDown();   // the hand lets go of the last scene's object (D4b)
  handle.pinHold(null);
  // the pegboard drawer (design-017): closed, and PINNED — hidden unless the scene draws it, so every other still stays the oracle's;
  // its foot is the page's mount option (I21): a still drawn under another than the page's would be a different still
  const pageFoot = deskRig().layer?.tray?.foot ?? 0;
  if (s.tray !== undefined && (s.tray.foot ?? 0) !== pageFoot) throw new Error(`desk: the still's drawer has a foot of ${s.tray.foot ?? 0} px and this page's layer ${pageFoot} — open rig.html?trayFoot=${s.tray.foot ?? 0}`);
  handle.tray.close();
  handle.tray.scroll(s.tray?.scroll ?? 0);
  handle.tray.pin(s.tray === undefined ? { hidden: true } : { p: s.tray.p ?? 1, band: 0 });
  if (s.tray !== undefined) pinSpecimenMonth(engine, "2026-09");
  (handle.local("board") as BoardInk | undefined)?.pinStill(false);   // the board's ink dries again (D3t-a)
  // 2. the theme, pinned (the OS no longer leads)
  host.setTheme(s.theme, true);
  // 3. the objects, in the prototype's paint order — the mini mats (sheets), the desk calendars (pads), then the things (the
  //    oracle's `thingsOf`: the whiteboards, the notes, the prints, the notebooks) — and every inside as children; the boards'
  //    strokes and the pads' pins their children (D3w)
  const selected: Entity[] = [];
  const root = await spawnDesk(host, fx, s, undefined, selected);
  // …and the tray's SPECIMEN faces as the oracle draws them (K5b), after the scene's own rasters: the note's the committed raster (its
  // word blanked — Node has no text raster), the pad's the committed print of the still's month; the print's sample is made alike on both
  if (s.tray !== undefined) await pinSpecimenFaces(engine, handle, fx.ink, fx.inkMeta, noteDriver);
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
  // 9. THE HAND (design-015 §8, D4b): the named object is picked up — `Held` the fact, through the op — the user's zoom and pan
  //    written, and the carry PINNED at the scene's `e` with the cover snapped to its target (a still of the opening)
  if (s.hold !== undefined) {
    const h = s.hold;
    const target = h.book !== undefined ? root.books[h.book] : h.board !== undefined ? root.boards[h.board] : h.pad !== undefined ? root.pads[h.pad] : undefined;
    if (target === undefined) throw new Error("desk: the hold scene names an object the scene does not have");
    for (let i = 0; i < 2; i++) await frame();   // drawn at rest once: the pickup starts from where it lies
    engine.ops.open(target);
    engine.ops.clearSelection();   // a still states its selection itself (the op selects what it picks up; the oracle's hold stills select nothing)
    if (h.zoom !== undefined || h.panX !== undefined || h.panY !== undefined) {
      engine.world.removeComponent(target, HeldView);
      engine.world.addComponent(target, HeldView, { zoom: h.zoom ?? 1, panX: h.panX ?? 0, panY: h.panY ?? 0 });
    }
    handle.pinHold({ e: h.e, ...(h.open !== undefined ? { open: h.open } : {}) });
    // THE WHITEBOARD AT WORK (D3t-a): the hand pinned on the pen; the board's wet stroke laid live and committed wet and its live one
    // mid-draw (`BoardInk.sketch` — the oracle's `boardOf` steps), the ink held still (no drying) for the still
    const ink = handle.local("board") as BoardInk | undefined;
    if (h.board !== undefined && ink !== undefined) {
      const spec = s.boards?.[h.board];
      if (h.pen !== undefined) ink.pinPen(target, h.pen);
      if (spec?.wet !== undefined || spec?.live !== undefined) {
        const work = { ...(spec.wet !== undefined ? { wet: strokeSpecOf(spec.wet) } : {}), ...(spec.live !== undefined ? { live: { ...strokeSpecOf(spec.live), upto: spec.live.upto } } : {}) };
        for (let i = 0; i < 60 && !ink.sketch(target, work); i++) await frame();
        ink.pinStill(true);
      }
    }
  }
  return root;
}

export { MiniMat, Note };
