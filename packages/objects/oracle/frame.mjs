// The oracle's desk, shared by its two hosts: the Node oracle (render.mjs — Dawn, a readable
// Target, the .wgsl files and the fixtures read from disk) and apps/desk's parity page (Chrome —
// the canvas, the generated shader text, the fixtures fetched). This module builds the passes from
// the host's shader text and asset bytes and turns a scene (scenes.mjs) into exactly the inputs the
// ground's `prepareFrame` takes, then encodes the frame through `prepareFrame` + `drawFrame` — so
// both hosts draw a scene through ONE copy of the scene builder, and `rig:parity` compares pixels,
// not two builders. (design-015 D1b: the functions below moved here verbatim from render.mjs,
// where the prototype had them; its lab kept a copy of the same logic for Chrome.)
//
// The root slot is built from the KIND REGISTRY (design-015 D2a-render: `deskKinds(text)` — the
// note, the mini mat, the whiteboard, the photo print, the desk calendar and the notebook, on the
// host's shader text), and a desk's objects reach the ground as ONE list in paint order: its mini
// mats (sheets) first — so a mini mat's index among the mini mats is its index in `objects`, which
// is what a portal's `at` names —
// then its THINGS: the scene's own order where it gives one (`things`), else the prototype's — the
// whiteboards, the notes, the prints (its photo lab drew them over everything). The whiteboards
// and the prints are made as their prototype hosts make them (design-015 D3r-a): a board by the
// board bench's `BoardDesk` (lab/board.ts — at rest, its marker lying on it, its ink REPLAYED from
// a stroke list as `sketch` lays one), a print by the photo lab's `addRGBA` (lab/photo.ts — a body
// with its pose pinned, the committed picture). The notebooks and the desk calendars (design-015 D3r-b) are made as
// the prototype's main lab makes them (lab/notebook.ts `makeBook` → `resolveBooks` → `drawBooks`; lab/calendar.ts
// `add` + `reset` + `pose` → `renderLayer`'s draw), without their print: a pad's page tables name no tile (MISSING —
// its paper and its ruled grid). A book's pages carry the ink its spec writes on them (D3t-b — `ink`: strokes on pages, as
// the book's data children state them): through the notebook kind's own cache (notebook/pages.ts — the pages in view with
// ink on the pass's layers, each rastered by the pure raster from the strokes' f32s, as the world's children decode), so
// the Node oracle and the desk lay the same bytes. The two draw as composite runs (kinds/layer.ts): the
// pads beneath the sheets and the things, the books over every other thing, whatever the scene's order says.
//
// And the desk's MARKS (design-015 §7, D4a): a scene's `selected` objects wear the selection as the product
// does — brackets for one, member ticks and a union for several, knobs where the kind resizes — and its
// `locked` ones the tape; `marks` states the rest a still can pin (the lock-on's progress, the vellum, the
// fold, the laser from a real snap, the strike, the tape's press). The kinds' own ring is retired (their
// records carry ring 0, as the builder's do — the notebook's too, D3w); `prototypeRing` draws a still exactly
// as the prototype did — the kinds' ring, no marks — for the baseline check against the prototype's own renders. The books and the
// pads wear them too (D3w): each marks object is the frame its kind's world half draws — the whiteboard's, the print's, the
// notebook's and the desk calendar's (kinds `boardFrame`, `photoFrame`, `bookFrame`, `calendarFrame`), one function on both sides.
import { VIEW } from "./scenes.mjs";
import { beginPass } from "../../desk/src/engine/target.ts";
import { CuttingMat } from "../../desk/src/mat/mat-pass.ts";
import { matShaders, MAT_SHADER_FILES } from "../../desk/src/mat/shaders.ts";
import { DEFAULT_MAT_CONFIG, HERO_MATRIX } from "../../desk/src/mat/layout.ts";
import { DEFAULT_GRID } from "../../desk/src/mat/grid.ts";
import { DEFAULT_PAPER_LAW, lampOf, resolvePaper, tiltOf } from "../src/paper/paper.ts";
import { chipOf, DEFAULT_MINIMAT_LAW, faceClip, faceOf, resolveMiniMat } from "../src/minimat/minimat.ts";
import { flightLights, flightPresent, insidePresent } from "../../desk/src/kit/inside.ts";
import { insideView, miniMatInstance } from "../src/minimat/inside.ts";
import { createSlotSet, drawFrame, drawTray, prepareFrame, renderHeldFrame, SlotPool, tagsOf } from "../../desk/src/ground.ts";
import { DRAWER, drawerRect, drawerSize } from "../../desk/src/tray/drawer.ts";
import { SAMPLE_SIZE, samplePicture } from "../src/photo/sample.ts";
import { specimenFrames, TraySlots } from "../../desk/src/tray/specimens.ts";
import { objectKindOf } from "../../desk/src/object.ts";
import { looksOf } from "../../desk/src/compose/reflector.ts";
import { DESK_OBJECTS } from "../src/preset.ts";
import { deskPalette } from "../src/palette.ts";
import { HoldPass } from "../../desk/src/hold/focus.ts";
import { heldCamera, heldFocus, heldFrame, heldPose, HOLD, homePose, progressOf, readingTarget } from "../../desk/src/hold/pose.ts";
import { HOLD_SHADER_FILES, holdShaders } from "../../desk/src/hold/shaders.ts";
import { eyeOf } from "../../desk/src/kit/eye.ts";
import { BOARD_KIND, boardFrame, bookFrame, CALENDAR_KIND, calendarFrame, deskKinds, MINIMAT_KIND, miniMatFrame, NOTEBOOK_KIND, PAPER_KIND, paperFrame, PHOTO_KIND, photoFrame } from "../src/kinds.ts";
import { MarksPass } from "../../desk/src/marks/pass.ts";
import { MARKS_SHADER_FILES, marksShaders } from "../../desk/src/marks/shaders.ts";
import { TrayPass } from "../../desk/src/tray/pass.ts";
import { trayShaders } from "../../desk/src/tray/shaders.ts";
import { assembleMarks } from "../../desk/src/marks/assemble.ts";
import { computeSnapGuides, layTray } from "@ice/kernel";
import { arrivalCamera, boundsOf, departedCamera, enterFlight, exitFlight, FIT, flightAt } from "../../desk/src/nav/flight.ts";
import { PORTAL_CAP, PORTAL_GATE } from "../../desk/src/nav/portal.ts";
import { MAT_GRID } from "../../desk/src/theme.ts";
import { BOARD } from "../src/board/theme.ts";
import { MINIMAT } from "../src/minimat/theme.ts";
import { quadOf, resolveBoard, surfaceSize } from "../src/board/board.ts";
import { decodePoints, decodeTimes, encodePoints, encodeTimes, feedStroke, strokePen, strokeSeed } from "../src/board/data.ts";
import { inkPoints, pagesInView } from "../src/notebook/ink.ts";
import { PageInk, pageStrokeKey } from "../src/notebook/pages.ts";
import { BoardHistory } from "../src/board/history.ts";
import { penAtRest, penPose, stepPen } from "../src/board/pen.ts";
import { borderOf } from "../src/photo/layout.ts";
import { newBody, PHOTO, printSize, resolvePhoto } from "../src/photo/photo.ts";
import { NOTEBOOK } from "../src/notebook/law.ts";
import { buildMesh, MeshWriter } from "../src/notebook/mesh.ts";
import { newMotion, poseOf, withDesk } from "../src/notebook/motion.ts";
import { lampDir, rigidOf } from "../../desk/src/kit/place.ts";
import { frameOf, relaxOf, specOf, swingOf } from "../src/notebook/shape.ts";
import { CALENDAR } from "../src/calendar/law.ts";
import { monthKeyOf } from "../src/calendar/data.ts";
import { PrintTiles } from "../src/calendar/printing.ts";
import { tileGrid } from "../src/calendar/tiles.ts";
import { BLANK_SHEET } from "./prints.mjs";
import { dayOfKey, isWeekendCol, monthGrid, monthIndex, monthOfDay } from "../src/calendar/month.ts";
import { buildPad, padFrame } from "../src/calendar/pad.ts";
import { rollState } from "../src/calendar/roll.ts";
import { noteSlot, sheetOf } from "../src/calendar/sheet.ts";
import { boardLook, CALENDAR_LOOK, calendarLook, MARKERS, marker, notebookLook, notebookRuleInk, pen, THEMES, surface } from "./fixtures/vf-theme.ts";

// ---------------------------------------------------------------- the notebooks and the desk calendars (design-015 D3r-b)

/** The one lamp over the desk the lab's notebooks and calendars are lit by (lab/notebook.ts `LAMP`; main.ts's `lamp()` at the product's plane). */
const LAMP = lampOf(MAT_GRID.plane);
const bookHash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
/** The lab's book ids never repeat (its `nextId`): a mesh's buffers are kept under its id, so an id is never another mesh's. */
let nextBook = 1;
/** A book is an object that lives across frames (the lab's `Book`): the same spec object is the same book — its id, its mesh — so a host drawing it again re-uploads nothing (the cost rig's steady state). */
const booksBySpec = new WeakMap();
/** The pose each drawn book was built for (its pages in view — D3t-b), kept beside the record rather than in it. */
const posesByDraw = new WeakMap();
/** A book's turn on the mat: the spec's, else its seed's (the lab's `makeBook` — never set down quite square). */
const bookAngleOf = (b) => b.angle ?? (bookHash(b.seed ?? 7) - 0.5) * 0.06;

/**
 * A notebook as the lab's `drawBooks` hands it to the pass, from a scene's spec (lab/notebook.ts `BookSceneSpec`): `makeBook` — its spec
 * and frame, its motion pinned as the spec says (a swing, a sheet mid-turn, the peek, held, tilted, selected) — then `resolveBooks` (the
 * pose, its mesh, the placement, the lamp) and the draw (the swing, the relax, the look, the ruling). No ink. A still: its springs stand.
 */
export function notebookDraw(b) {
  const had = booksBySpec.get(b);
  if (had) return had;
  const law = NOTEBOOK;
  const seed = b.seed ?? 7;
  const spec = specOf(law, { sheets: b.sheets ?? law.block.sheets });
  const frame = frameOf(spec);
  const left = Math.min(Math.max(b.left ?? 0, 0), spec.sheets);
  const motion = newMotion(spec.sheets, left, b.open === true || (typeof b.open === "number" && b.open >= 0.5));
  if (typeof b.open === "number") { motion.theta = b.open * Math.PI; motion.fluttered = true; }
  if (b.turn) {
    const i = b.turn.dir === 1 ? motion.sheets.findIndex((q) => q.side === 0) : motion.sheets.map((q) => q.side).lastIndexOf(1);
    const q = motion.sheets[i];
    if (q) { q.air = true; q.side = b.turn.dir === 1 ? 1 : 0; q.phi = b.turn.phi; q.psi = b.turn.psi; q.tw = b.turn.twist ?? 0; }
  }
  if (b.peek !== undefined) { motion.peek = b.peek; motion.peekOn = b.peek > 0; }
  if (b.held) { motion.held = true; motion.lift = 1; }
  if (b.tilt) { motion.tiltX = b.tilt[0]; motion.tiltY = b.tilt[1]; }
  if (b.selected) { motion.selected = true; motion.ring = b.held || motion.opened ? 0 : 1; }
  const angle = bookAngleOf(b);
  // resolveBooks: held it rises and tilts; opening, it rises while the cover stands; IN HAND it rises toward the desk eye by `rise` (D4b)
  const swing = Math.min(Math.max(swingOf(motion.theta), 0), Math.PI);
  // biome-ignore lint/style/useExponentiationOperator: the lab's arithmetic (lab/notebook.ts `placementOf`), verbatim — it feeds a record
  const opening = law.lift.open * Math.pow(Math.sin(swing), 0.85);
  const place = { cx: b.x, cy: b.y, angle, lift: motion.lift * law.lift.held + motion.hover * law.lift.hover + opening + (b.rise ?? 0), tiltX: motion.tiltX, tiltY: motion.tiltY, zc: frame.b + frame.T / 2 };
  const pose = withDesk(poseOf(motion, law), place.lift);
  const mesh = buildMesh(new MeshWriter(), frame, pose, law);
  const sw = swingOf(motion.theta);
  const draw = {
    id: nextBook++, mesh, version: 1, frame, rigid: rigidOf(place), lamp: lampDir(LAMP, b.x, b.y, law.shadow.slopeMax),
    theta: motion.theta, gamma: relaxOf(motion.theta), look: notebookLook(b.cover ?? "orbit"), ruling: b.ruling ?? "dots", seed: seed % 97, ring: motion.ring,
    selfShadow: pose.airs.length > 0 || (sw > 0.02 && sw < Math.PI - 0.02), ink: { pages: [], layers: [] },
  };
  booksBySpec.set(b, draw);
  posesByDraw.set(draw, pose);
  return draw;
}

/** The pad's frame and its one mesh, as the lab's calendar desk builds them once (its `meshVersion` 1). */
const PAD = padFrame(CALENDAR);
const PAD_MESH = buildPad(new MeshWriter(2048, 8192), PAD, CALENDAR);
const monthOfKey = (key) => { const [y, m] = key.split("-").map(Number); return monthIndex(y, m); };
/** A sheet as the pass draws it: where its grid is printed, its rows, weekends and days, its page table's slot. */
function sheetDrawOf(month, weekStart, slot) {
  const L = sheetOf(monthGrid(month, weekStart), CALENDAR);
  const g = L.grid;
  let weekends = 0;
  for (let col = 0; col < 7; col++) if (isWeekendCol(g, col)) weekends |= 1 << col;
  return { x0: L.x0, y0: L.y0, cw: L.cw, ch: L.ch, rows: L.rows, weekends, lead: g.lead, days: g.days, slot };
}

/**
 * The i-th desk calendar as the lab's `renderLayer` hands it to the pass, from a scene's spec `{ x, y, month, weekStart, pose, tape, pen }`:
 * `reset` (where, which month, nothing written, nothing selected, nothing lifted), `pose` (the roll pinned part-way — `{ dir, p, tilt }` —
 * or the corner's peek), then `sheetsOf` (the month on the pad and the one in motion, the roll) and the draw. No marks.
 */
export function calendarDraw(c, i) {
  const law = CALENDAR;
  const shown = monthOfKey(c.month ?? "2026-09");
  const weekStart = c.weekStart ?? 1;
  const pose = c.pose ?? {};
  const roll = (p, tilt) => rollState(p, { rest: law.roll.rest + 0.6, tau: law.roll.tau }, PAD.L, PAD.W, tilt);
  let sh = { base: shown, moving: null, roll: null, marksOn: 0 };
  if (pose.p !== undefined) sh = (pose.dir ?? 1) === 1 ? { base: shown + 1, moving: shown, roll: roll(pose.p, pose.tilt ?? 0), marksOn: 1 } : { base: shown, moving: shown - 1, roll: roll(pose.p, pose.tilt ?? 0), marksOn: 0 };
  else if ((pose.peek ?? 0) > 1e-3) sh = { base: shown + 1, moving: shown, roll: roll((pose.peek * law.roll.peek) / (PAD.L - law.roll.rest), -law.roll.tilt), marksOn: 1 };
  const look = calendarLook(c.tape ?? "ink");
  return {
    id: i + 1, frame: PAD, mesh: PAD_MESH, version: 1, rigid: rigidOf({ cx: c.x, cy: c.y, angle: 0, lift: 0, tiltX: 0, tiltY: 0, zc: 0 }),
    lamp: lampDir(LAMP, c.x, c.y, law.shadow.slopeMax), lift: 0, ring: 0,
    base: sheetDrawOf(sh.base, weekStart, i * 2), moving: sh.moving !== null ? sheetDrawOf(sh.moving, weekStart, i * 2 + 1) : null, roll: sh.roll, marksOn: sh.marksOn,
    sel: [], mark: null, drop: null, caret: null, wipe: null,
    colours: { paper: look.paper, ink: look.ink, muted: look.muted, weekend: look.weekend, hot: look.hot, chipboard: look.chipboard, cloth: look.cloth, foil: look.foil, pen: pen(c.pen ?? "felt") },
  };
}

/** Where a note stuck to `day` on a calendar lies (the lab's `slotOf`): its day's slot on the month that day is in, in the world. */
export function pinnedAt(c, day) {
  const n = dayOfKey(day);
  const L = sheetOf(monthGrid(monthOfDay(n), c.weekStart ?? 1), CALENDAR);
  const k = n - L.grid.first;
  if (k < 0 || k >= L.rows * 7) throw new Error(`oracle: ${day} is not on its month's sheet`);
  const s = noteSlot(L, Math.floor(k / 7), k % 7, CALENDAR);
  return { x: c.x - PAD.W / 2 + s.x, y: c.y - PAD.H / 2 + s.y };
}

/**
 * The desk both hosts draw: the root's passes on `device` in `format`, composed from `text(files)` — a shader-file map
 * (`MAT_SHADER_FILES`, …) to its text: the .wgsl files on disk in Node, the generated module in a browser — and the
 * fixtures' bytes (`assets`: the engine's blue noise; the host's gobo plates, the rulers' glyph atlas, the note's
 * committed ink raster and the prints' picture, each with its metadata; a missing atlas, raster or picture is `null`
 * and the desk draws without it).
 */
export async function createOracleDesk({ device, format, text, assets, log = console.log }) {
  const mat = await CuttingMat.create(device, format, matShaders(text(MAT_SHADER_FILES)));
  // The root slot from the kind registry: every desk kind's pass on the root's mat — the sticky notes (STICKY.md), the mini mats
  // (MINIMAT.md), the whiteboards (BOARD.md), the prints (PHOTO.md), the desk calendars (CALENDAR.md) and the notebooks
  // (NOTEBOOK.md) — and the passes a scene reaches into: the notes' (the ink pages, the law), the mini mats', the boards', …
  const rootSlot = await createSlotSet(device, format, mat, deskKinds(text));
  const passOf = (name) => { const k = rootSlot.kinds.get(name); if (!k) throw new Error(`oracle: the registry has no "${name}" kind`); return k.pass.pass; };
  const papers = passOf(PAPER_KIND);
  const minimats = passOf(MINIMAT_KIND);
  const boards = passOf(BOARD_KIND);
  const photos = passOf(PHOTO_KIND);
  // the notebook's and the calendar's looks — the product's: the ruling's ink, the print's presences — as the lab hands its passes them
  const kindOf = (name) => rootSlot.kinds.get(name).pass;
  kindOf(NOTEBOOK_KIND).ruleInk = notebookRuleInk();
  kindOf(CALENDAR_KIND).alpha = CALENDAR_LOOK.alpha;
  const notebooks = passOf(NOTEBOOK_KIND);
  /** The notebooks' page layers (D3t-b): the kind's cache, made afresh for each scene. */
  let pageInk = new PageInk();
  const calendars = passOf(CALENDAR_KIND);
  // the whiteboard's materials, as the bench's BoardDesk hands its pass them (lab/board.ts)
  const look = boardLook();
  boards.look = { barrel: look.barrel, felt: look.felt, wood: look.wood };
  // The engine's asset (the blue noise) and the HOST's (the gobo plates, the rulers' glyphs, the note's ink — the product's, a fixture here) — raw bytes either way.
  mat.setPlate("c", assets.goboC); mat.setPlate("b", assets.goboB); mat.setNoise(assets.noise);
  const glyphMeta = assets.glyphMeta;
  if (glyphMeta && glyphMeta.count >= 12) mat.setGlyphs(assets.glyphs, glyphMeta);
  else log("no glyph atlas (oracle/fixtures/assets/glyphs-mono-2x.*): the rulers print ticks and lines, no labels");
  const inkMeta = assets.inkMeta;
  const inkBytes = inkMeta && inkMeta.w > 0 ? assets.ink : null;
  if (!inkBytes) log("no ink raster (oracle/fixtures/assets/ink-note-1.*): the notes draw blank");
  const photoMeta = assets.photoMeta;
  const photoBytes = photoMeta && photoMeta.w > 0 ? assets.photo : null;
  if (!photoBytes) log("no picture (oracle/fixtures/assets/photo-1.*): the prints draw their paper alone");
  const lamp = lampOf(MAT_GRID.plane);
  // the desk's chrome (D4a): the marks pass on the root's mat (it prints with the rulers' atlas)
  const marks = await MarksPass.create(device, format, marksShaders(text(MARKS_SHADER_FILES)), mat);
  // the hand (D4b): the focus behind an object in hand and the object over it — the same pass the ground makes
  const hold = await HoldPass.create(device, format, holdShaders(text(HOLD_SHADER_FILES)));
  // the pegboard tray (design-017, K3): the drawer over the marks — the same pass the ground makes
  const tray = await TrayPass.create(device, format, trayShaders(text), mat);
  // …and its specimens (design-017 §8, K5a): the six kinds' tray entries, each in its own slot — a composite kind's pass made now, as the
  // ground makes it the first time the tray shows one
  const hung = DESK_OBJECTS.filter((t) => t.tray !== undefined);
  const traySlots = new TraySlots(device, format, rootSlot, deskKinds(text));
  await traySlots.ready(hung.map((t) => [t.type, objectKindOf(t).name]));
  /** The prototype's own selection ring (its stills drew it) — on only for the baseline check; the product's selection is the marks. */
  let prototypeRing = false;

  // The slots beyond the root — the departed desk's, the live insides — from the same pool the ground keeps.
  const pool = new SlotPool(rootSlot);
  const VP = { width: VIEW.cssW, height: VIEW.cssH };
  /** A scene's view: the oracle's one, unless the scene names its own (a phone's portrait still, D4b). */
  const viewSpecOf = (s) => s?.view ?? VIEW;
  const vpOf = (s) => { const v = viewSpecOf(s); return { width: v.cssW, height: v.cssH }; };
  const viewOf = (cam, s) => { const v = viewSpecOf(s); return { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: v.cssW, height: v.cssH, dpr: v.dpr }; };
  const matOf = (s) => ({ time: s.mat?.time ?? 0, goboTime: s.mat?.goboTime ?? 0, goboMatrix: HERO_MATRIX, noise: s.mat?.noise ?? [0, 0] });

  /** A desk's grid: the mat with the scene's gobo; the rulers print on the ROOT of a scene that says `ruler` (RULER.md). `ground` = a mini mat's inside of another colour. */
  // biome-ignore lint/style/useDefaultParameterLast: the prototype's signature, moved verbatim — dropping the default would change what an explicit `undefined` means (design-015 D1)
  function gridFor(s, rootSlot = false, ground) {
    return {
      fadeIn: s.fadeIn ?? DEFAULT_GRID.fadeIn,   // a still may state its lattice's fade-in window (the zoom sweep's sparse one — D5a)
      mat: {
        ...DEFAULT_MAT_CONFIG,
        ...(ground ? { ground } : {}),
        gobo: { ...DEFAULT_MAT_CONFIG.gobo, opacity: s.mat?.opacity ?? DEFAULT_MAT_CONFIG.gobo.opacity, plate: s.mat?.plate ?? DEFAULT_MAT_CONFIG.gobo.plate },
        ruler: { ...DEFAULT_MAT_CONFIG.ruler, ...(s.ruler ?? {}), on: rootSlot && s.ruler !== undefined },
      },
    };
  }

  // ---------------------------------------------------------------- the desk's objects, as the lab makes them

  const NOTE = DEFAULT_PAPER_LAW;
  const noteGeometry = (n) => {
    const seed = n.seed ?? 1;
    return resolvePaper({ cx: n.x, cy: n.y, w: n.w ?? NOTE.size, h: n.h ?? NOTE.size, angle: n.angle ?? tiltOf(seed, NOTE.tilt) }, { held: n.held ? 1 : 0, ring: prototypeRing && n.selected ? 1 : 0, fade: 1 }, NOTE, lamp);
  };
  /** The committed raster, placed once per render — as the lab keeps one raster per note, however many desks draw it. */
  let inkRaster = null;
  /** A desk's notes as the pass takes them: each resolved under the one lamp, the committed raster where a note carries it. */
  function notesOf(specs = []) {
    return specs.map((n) => {
      if (n.asset === "note-1" && inkBytes && !inkRaster) { const rect = papers.alloc(inkMeta.w, inkMeta.h); if (rect) inkRaster = { layer: rect.layer, uv: papers.write(rect, inkBytes) }; }
      const raster = n.asset === "note-1" ? inkRaster : null;
      return { geometry: noteGeometry(n), paper: surface(n.paper ?? "note"), ink: pen(n.pen ?? "felt"), ...(raster ? { raster } : {}) };
    });
  }
  const matGeometry = (m) => resolveMiniMat({ cx: m.x, cy: m.y, w: m.w ?? MINIMAT.size.w, h: m.h ?? MINIMAT.size.h }, { held: m.held ? 1 : 0, hover: 0, ring: prototypeRing && m.selected ? 1 : 0, fade: 1 }, DEFAULT_MINIMAT_LAW, lamp);
  const insideOf = (m) => m.inside ?? { notes: [], minimats: [] };
  /**
   * A desk's THINGS in paint order, each `{ kind: "note" | "board" | "print" | "book", …its spec }`: the scene's own list where
   * it gives one (`things` — a print laid between two notes), else the prototype's order: the whiteboards, the notes, the prints,
   * the notebooks. A note stuck to a calendar's day (`pin: { pad, day }`) lies where the lab's calendar snaps it: its day's slot.
   */
  const thingsOf = (desk) => (desk.things ?? [...(desk.boards ?? []).map((b) => ({ ...b, kind: "board" })), ...(desk.notes ?? []).map((n) => ({ ...n, kind: "note" })), ...(desk.prints ?? []).map((p) => ({ ...p, kind: "print" })), ...(desk.books ?? []).map(bookThing)]).map((t) => (t.pin ? { ...t, ...pinnedAt((desk.calendars ?? [])[t.pin.pad ?? 0], t.pin.day) } : t));
  /** A book spec's thing — the same object for the same spec, so the book it is keeps its id and mesh from frame to frame (`notebookDraw`). */
  const bookThings = new WeakMap();
  function bookThing(b) { let t = bookThings.get(b); if (!t) { t = { ...b, kind: "book" }; bookThings.set(b, t); } return t; }
  const notesIn = (desk) => (desk.things ? desk.things.filter((t) => t.kind === "note") : (desk.notes ?? []));
  const printsIn = (desk) => thingsOf(desk).filter((t) => t.kind === "print");
  /** The bounds of a desk's content (its notes, its prints and its mini mats) — what its arrival is framed on; a control may pin them (`bounds`). */
  const contentOf = (desk) => desk.bounds ?? boundsOf([...notesIn(desk).map((n) => ({ x: n.x - (n.w ?? NOTE.size) / 2, y: n.y - (n.h ?? NOTE.size) / 2, width: n.w ?? NOTE.size, height: n.h ?? NOTE.size })), ...printsIn(desk).map((p) => { const s = printSizeOf(); return { x: p.x - s.w / 2, y: p.y - s.h / 2, width: s.w, height: s.h }; }), ...(desk.minimats ?? []).map((m) => ({ x: m.x - (m.w ?? MINIMAT.size.w) / 2, y: m.y - (m.h ?? MINIMAT.size.h) / 2, width: m.w ?? MINIMAT.size.w, height: m.h ?? MINIMAT.size.h }))]);
  /** A desk's children as the far LOD draws them (minimat.ts `ChildShape`), in the desk's own frame — a print has no chip yet (the far LOD's kinds are D2b's). */
  function childrenOf(desk) {
    const out = [];
    for (const m of desk.minimats ?? []) { const G = matGeometry(m); out.push({ kind: "mat", cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: 0, radius: G.radius, colour: DEFAULT_MAT_CONFIG.ground, height: G.thick, margin: G.margin }); }
    for (const n of notesIn(desk)) {
      const G = noteGeometry(n);
      const w = n.greek ? { ink: pen(n.pen ?? "felt"), x0: 16, em: 24, lines: n.greek.map(([y, width]) => ({ y, width })) } : undefined;
      out.push({ kind: "paper", cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: G.angle, radius: G.radius, colour: surface(n.paper ?? "note"), height: G.curl * 0.5, ...(w ? { writing: w } : {}) });
    }
    return out;
  }

  // ---------------------------------------------------------------- the prints, as the photo lab makes them (lab/photo.ts)

  /** The committed picture, made once on the photo pass (a picture is the pass's resource, shared by every slot) — null without the fixture. */
  let picture = null;
  const pictureOf = (name) => {
    if (name === null || !photoBytes) return null;
    if (name !== "photo-1") throw new Error(`oracle: no picture "${name}" (the fixture is photo-1)`);
    picture ??= photos.picture(photoBytes, photoMeta.w, photoMeta.h);
    return picture;
  };
  /** A print's size: the long side the law's, the picture's aspect (photo.ts `printSize`, as the lab's `addPicture` sizes one). */
  const printSizeOf = () => printSize(photoMeta?.w ?? 3, photoMeta?.h ?? 2, PHOTO.long);
  /**
   * A print as the lab's `addRGBA` leaves it — `newBody` at its point, turned 0, at `height`, still and whole — with the scene's
   * pose pinned over it: its turn, its slope, its bend, its anchor, the hand holding it (the grab point in its frame, the finger
   * in the world). Resolved under the one lamp; its border the law's for its size.
   */
  function printOf(p) {
    const { w, h } = printSizeOf();
    const body = newBody(p.x, p.y, w, h, 0, p.height ?? 0);
    for (const k of ["angle", "sx", "sy", "bend", "ax", "ay"]) if (p[k] !== undefined) body[k] = p[k];
    if (p.hold) body.hold = { gx: p.hold.gx, gy: p.hold.gy, px: p.hold.px, py: p.hold.py, vx: 0, vy: 0, ax: 0, ay: 0, trail: [[0, p.hold.px, p.hold.py]] };
    return { geometry: resolvePhoto(body, PHOTO, lamp), border: borderOf(w / 2, h / 2, PHOTO), picture: pictureOf(p.picture === undefined ? "photo-1" : p.picture) };
  }

  // ---------------------------------------------------------------- the whiteboards, as the board bench makes them (lab/board.ts)

  /** The rasters this frame's boards drew with — each scene's boards get fresh ones (the bench's first `instances()` makes them). */
  const rastered = new Set();
  let nextBoard = 1;
  /** A stroke's pen, or a throw: every scene's ink is one the fixture names. */
  const must = (b) => { if (b === undefined) throw new Error("oracle: a board's stroke names no ink the palette has"); return b; };
  /** The palette's markers as a replay takes them (kinds/board.ts `theme` — the fixture's inks and coverages). */
  const MARKER_INKS = Object.fromEntries(Object.keys(MARKERS).map((name) => [name, { color: marker(name), opacity: MARKERS[name].opacity }]));
  /**
   * A board's history from a stroke list, as the bench's `sketch` lays one: each stroke a path of melamine points (world units
   * from its top-left) at a pace — or, timed (D3t-a), at its samples' own times — through the StrokeBuilder with the bench's
   * seed, committed dry; then what a replay needs. The same feed as the world's replay (board/data.ts `feedStroke`).
   */
  function opsOf(strokes = []) {
    const history = new BoardHistory();
    for (const s of strokes) {
      const builder = must(strokePen(s, MARKER_INKS, strokeSeed(history.done.length)));
      feedStroke(builder, s.points, s.times ?? null, s.speed ?? 400);
      history.push({ kind: "stroke", tool: builder.tool, stamps: builder.stamps(), ...(s.erase ? {} : { ink: s.ink ?? "black" }) });
    }
    return history.replay;
  }
  /**
   * A board as the bench draws it, all but its raster: resolved under the one lamp, its ring the prototype's alone (`prototypeRing`
   * — the desk's selection is its marks), the world rect it may paint, the eye straight over it (the parallax at rest), and THE
   * marker (board/pen.ts — the kind's own law): lying capped where a hand put it down, or — the board IN HAND (`inHand`, D3t-a) —
   * its flux snapped as a still's is (`stepPen`): taken up once the board is open, at the scene's pen (a desk point) over the
   * melamine, hovering or pressed; with no pen stated the hand is off the board and the marker taken up is not shown.
   */
  function boardPoseOf(b) {
    const w = b.w ?? BOARD.spec.width;
    const h = b.h ?? BOARD.spec.height;
    const G = resolveBoard({ cx: b.x, cy: b.y, w, h }, { held: 0, ring: prototypeRing && b.selected ? 1 : 0, fade: 1 }, lamp);
    const pen = penAtRest();
    const hand = b.inHand?.pen;
    if (b.inHand !== undefined) stepPen(pen, { held: b.inHand.open, erasing: hand?.erase === true, over: hand !== undefined, pressing: hand?.press === true }, 0, true);
    const pose = penPose(G, w, h, b.tip ?? "bullet", marker((b.inHand !== undefined ? hand?.ink : undefined) ?? b.cap ?? "black"), pen, hand !== undefined ? [hand.x, hand.y] : null);
    const par = [0, 0];
    const k = BOARD.surface.parallax;
    return {
      geometry: G, surface: look.surface, metal: look.frame, quad: quadOf(G, pose.box), sheen: [par[0] * k * 5, -par[1] * k * 5], pen: pose.pen,
      ...(pose.eraser !== undefined ? { eraser: pose.eraser } : {}),
    };
  }
  /**
   * A board as the pass takes it: its pose, and its raster made and its ink REPLAYED (`ensure` + `replay` — the raster is a cache of
   * the history); then (D3t-a, a still of the pen at work) its `wet` stroke laid LIVE and committed wet, and its `live` one mid-draw —
   * the first `upto` samples in the stroke layer — each at the seed of the op it would be: `BoardInk.sketch`'s own steps.
   */
  function boardOf(b) {
    const pose = boardPoseOf(b);
    const id = nextBoard++;
    boards.ensure(id, surfaceSize(pose.geometry));
    boards.replay(id, opsOf(b.strokes));
    rastered.add(id);
    let n = (b.strokes ?? []).length;
    const lay = (spec, upto) => {
      const builder = must(strokePen(spec, MARKER_INKS, strokeSeed(n)));
      feedStroke(builder, spec.points, spec.times ?? null, spec.speed ?? 400, upto);
      boards.lay(id, builder.tool, builder.pending());
      n += 1;
      return builder;
    };
    if (b.wet !== undefined) { const w = lay(b.wet); boards.commit(id, w.tool); }
    let stroke;
    if (b.live !== undefined) { const l = lay(b.live, b.live.upto); stroke = { color: l.tool.color, erase: l.tool.mode === "erase" }; }
    return { id, ...pose, ...(stroke !== undefined ? { stroke } : {}) };
  }

  /**
   * A desk's inputs under `cam` (the lab's `deskInputs`): its objects — its mini mats, each with its inside's embedding, the lattice
   * its face shows and its children as chips, then its things in paint order (the prototype's: the whiteboards, the notes, the
   * prints), so mini mat `i` is object `i` — and the live insides of the mini mats whose faces pass the gate, largest first up to
   * the cap, recursing through them (a belt of 4). `skip` = a mini mat whose inside is the flight's arriving desk.
   */
  function deskInputs(desk, cam, s, depth = 0, skip = -1) {
    const gate = s.portalGate ?? PORTAL_GATE;
    const things = thingsOf(desk);
    const notes = notesOf(things.filter((t) => t.kind === "note"));   // first, as ever: the ink pages are carved in the order the notes come
    const minis = [];
    const portals = [];
    const cands = [];
    (desk.minimats ?? []).forEach((m, i) => {
      const G = matGeometry(m);
      const inside = insideOf(m);
      const view = insideView(G, contentOf(inside), cam, vpOf(s), FIT, gate);
      const grid = gridFor(s, false, m.ground);
      minis.push(miniMatInstance(G, view, grid, childrenOf(inside).map((c) => chipOf(c, view.M)), m.name, s.dress !== false));
      if (s.portals !== false && depth < 4 && i !== skip && view.presence > 0) cands.push({ i, view, inside, grid });
    });
    cands.sort((a, b) => b.view.clip.hx * b.view.clip.hy - a.view.clip.hx * a.view.clip.hy);
    for (const { i, view, inside, grid } of cands.slice(0, PORTAL_CAP)) {
      const sub = deskInputs(inside, view.cam, s, depth + 1);
      portals.push({
        view: { ...viewOf(view.cam, s), box: view.box }, mat: matOf(s),
        ...(s.dress === false ? {} : { lodZoom: view.arrival.zoom }),   // dressed for its arrival (PORTAL.md §9)
        present: insidePresent(view), grid,
        objects: sub.objects, ...(sub.portals.length ? { portals: sub.portals } : {}),
        at: i,   // mini mat i is object i: the mini mats come first
      });
    }
    let n = 0;
    const thingObjects = things.map((t) => (t.kind === "note" ? { kind: PAPER_KIND, record: notes[n++] } : t.kind === "board" ? { kind: BOARD_KIND, record: boardOf(t) } : t.kind === "print" ? { kind: PHOTO_KIND, record: printOf(t) } : t.kind === "book" ? { kind: NOTEBOOK_KIND, record: bookOf(t) } : thingError(t)));
    // the desk calendars lie in the pads stratum, beneath everything whatever their place in the list (`padsFirst` puts them before the things)
    const pads = (desk.calendars ?? []).map((c, i) => ({ kind: CALENDAR_KIND, record: calendarDraw(c, i) }));
    if (depth === 0) pinPrints(desk.calendars ?? []);
    const objects = [...minis.map((record) => ({ kind: MINIMAT_KIND, record })), ...(s.padsFirst ? pads : []), ...thingObjects, ...(s.padsFirst ? [] : pads)];
    return { objects, portals };
  }
  const thingError = (t) => { throw new Error(`oracle: a desk's thing is a note, a board, a print or a book — not "${t.kind}"`); };
  /**
   * The desk calendars' PRINTS (D3t-c): each pad's sheets in play — the month on it and the one in motion, as `calendarDraw` lays
   * them in its table slots (2i, 2i + 1) — pinned with the COMMITTED print its scene names for that month (`print: { "YYYY-MM":
   * name }`, prints.mjs), else BLANK (every tile missing: the paper and its grid, as every pad before D3t-c); the tile driver is the
   * world's own (calendar/printing.ts), so both hosts write the same tables and the same bytes.
   */
  const printTiles = new PrintTiles({ grid: tileGrid(PAD.W, PAD.H) });
  function pinPrints(pads) {
    if (pads.length === 0) return;
    printTiles.begin(calendars);
    pads.forEach((c, i) => {
      const shown = monthOfKey(c.month ?? "2026-09");
      const pose = c.pose ?? {};
      const up = pose.p !== undefined ? (pose.dir ?? 1) === 1 : (pose.peek ?? 0) > 1e-3;
      const sheets = pose.p === undefined && !up ? [[shown, i * 2]] : up ? [[shown + 1, i * 2], [shown, i * 2 + 1]] : [[shown, i * 2], [shown - 1, i * 2 + 1]];
      for (const [month, slot] of sheets) {
        const name = c.print?.[monthKeyOf(month)];
        const sheet = name === undefined ? BLANK_SHEET : assets.prints?.[name];
        if (sheet === undefined) throw new Error(`oracle: no committed print "${name}" (oracle/fixtures/assets/${name}.json + .bin — apps/desk scripts/print-fixture.mjs --write)`);
        printTiles.pin(calendars, `${i + 1}:${month}`, slot, sheet);
      }
    });
    printTiles.end(calendars);
  }

  /**
   * A book as a desk draws it: the lab's (`notebookDraw` — the same object for the same spec, its id and mesh kept) with its own
   * selection ring RETIRED, as the builder hands every kind ring 0 (D4a: a selection is the desk's marks); `prototypeRing` keeps the
   * lab's ring for the baseline against the prototype's own renders.
   */
  function bookOf(t) {
    const d = notebookDraw(t);
    const drawn = prototypeRing || d.ring === 0 ? d : { ...d, ring: 0 };
    return Array.isArray(t.ink) && t.ink.length > 0 ? { ...drawn, ink: bookInk(t, d) } : drawn;
  }

  /**
   * A book's pages in view with ink, each on a layer (D3t-b): the notebook kind's own cache — a fresh one each scene, as a fresh
   * desk's — its strokes as the world's children decode them (the codec's f32 points and times), each pen's ink the palette's.
   */
  function bookInk(t, d) {
    const byPage = new Map();
    for (const s of t.ink) {
      const points = decodePoints(encodePoints(s.points));
      const timed = Array.isArray(s.times) && s.times.length === s.points.length;
      const times = timed ? decodeTimes(encodeTimes(s.times)) : null;
      const list = byPage.get(s.page) ?? [];
      list.push({ key: pageStrokeKey(s.pen ?? "fountain", encodePoints(s.points), timed ? encodeTimes(s.times) : "", s.speed ?? 400), ink: s.pen ?? "fountain", points: inkPoints(points, times, s.speed ?? 400) });
      byPage.set(s.page, list);
    }
    return pageInk.table(d.id, pagesInView(posesByDraw.get(d), swingOf(d.theta)), (p) => byPage.get(p) ?? [], null, (ink) => pen(ink), "oracle", notebooks, d.frame.Wo, d.frame.Hp);
  }

  // ---------------------------------------------------------------- the desk's marks (D4a) — the builder's rules on a still

  /**
   * A desk's objects in paint order as their marks need them (marks/assemble.ts): the frame its kind draws, ICE's rect, the still's
   * facts. The builder's order: the pads' stratum beneath the sheets, the sheets beneath the things (a note pinned to a pad's day
   * lies where the pad puts it).
   */
  function markedObjects(desk, M) {
    const rectOf = (o, w, h) => ({ x0: o.x - w / 2, y0: o.y - h / 2, x1: o.x + w / 2, y1: o.y + h / 2 });
    const facts = (o, frame, rect, resizable) => ({
      frame, rect, selected: o.selected === true, locked: o.locked === true, moving: o.held === true, resizable,
      lock: o.selected === true ? { t: M.t ?? 1, a: M.alpha ?? 1 } : { t: 0, a: 0 },
      tape: { press: M.press ?? [1, 1], a: o.locked === true ? 1 : 0 },
    });
    const out = [];
    for (const c of desk.calendars ?? []) out.push(facts(c, calendarFrame(c.x, c.y), rectOf(c, PAD.W, PAD.H), false));
    for (const m of desk.minimats ?? []) out.push(facts(m, miniMatFrame(matGeometry(m)), rectOf(m, m.w ?? MINIMAT.size.w, m.h ?? MINIMAT.size.h), false));
    for (const t of thingsOf(desk)) {
      if (t.kind === "note") out.push(facts(t, paperFrame(noteGeometry(t)), rectOf(t, t.w ?? NOTE.size, t.h ?? NOTE.size), false));
      else if (t.kind === "board") out.push(facts(t, boardFrame(boardPoseOf(t).geometry), rectOf(t, t.w ?? BOARD.spec.width, t.h ?? BOARD.spec.height), true));
      else if (t.kind === "print") { const size = printSizeOf(); out.push(facts(t, photoFrame(printOf(t).geometry), rectOf(t, size.w, size.h), true)); }
      else if (t.kind === "book") { const d = bookOf(t); out.push(facts(t, bookFrame(d.frame, d.theta, t.x, t.y, bookAngleOf(t)), rectOf(t, NOTEBOOK.cover.width, NOTEBOOK.cover.height), false)); }
    }
    return out;
  }

  /**
   * A still's marks: its `selected` and `locked` objects, and what `marks` pins — `t`/`alpha` (the lock-on), `unionT`,
   * `marquee` (a world rect mid-drag, `pointer` on screen), `fold` (`rect` on screen, `t`), `snap` (the kernel's law on the
   * scene's rects: the `held` objects are the dragged set), `strike`, `press` (the tape's two strips). The rulers' band
   * follows the scene's own rulers.
   */
  function marksOf(s, cam, theme = THEMES[s.theme]) {
    const M = s.marks ?? {};
    // the root desk as `encode` builds it — its books and pads too (a note pinned to a pad's day lies where the pad puts it)
    const desk = { notes: s.notes ?? [], minimats: s.minimats ?? [], ...(s.boards ? { boards: s.boards } : {}), ...(s.prints ? { prints: s.prints } : {}), ...(s.books ? { books: s.books } : {}), ...(s.calendars ? { calendars: s.calendars } : {}), ...(s.things ? { things: s.things } : {}) };
    const objects = markedObjects(desk, M);
    let guides = [];
    let bars = [];
    if (M.snap) {
      const box = (o) => ({ x: o.rect.x0, y: o.rect.y0, width: o.rect.x1 - o.rect.x0, height: o.rect.y1 - o.rect.y0 });
      const dragged = objects.filter((o) => o.moving).map(box);
      const x0 = Math.min(...dragged.map((b) => b.x));
      const y0 = Math.min(...dragged.map((b) => b.y));
      const x1 = Math.max(...dragged.map((b) => b.x + b.width));
      const y1 = Math.max(...dragged.map((b) => b.y + b.height));
      const res = computeSnapGuides({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, objects.filter((o) => !o.moving).map(box), 5 / cam.zoom);
      guides = res.guides.map((g) => ({ axis: g.axis, at: g.position, type: g.type }));
      bars = res.spacings.flatMap((sp) => sp.segments.map((seg) => ({ axis: sp.axis, from: seg.from, to: seg.to, perp: sp.perpPosition, gap: sp.gap })));
    }
    const rulers = s.ruler === undefined ? null : { ...DEFAULT_MAT_CONFIG.ruler, ...s.ruler };
    const q = M.marquee;
    return assembleMarks({
      view: { width: VIEW.cssW, height: VIEW.cssH, dpr: VIEW.dpr }, cam, night: theme.name === "dark", objects,
      union: { t: M.unionT ?? 1, a: 1 },
      marquee: q ? { rect: { x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1 }, pointer: q.pointer ?? { x: (q.x1 - cam.x) * cam.zoom, y: (q.y1 - cam.y) * cam.zoom } } : null,
      fold: M.fold ?? null, guides, bars, strike: M.strike ?? 0,
      ruler: rulers === null ? null : { margin: rulers.margin, band: rulers.band },
    });
  }

  /** The flight a nav scene pins — the lab's setScene computes the same. */
  function navOf(s) {
    const gate = s.portalGate ?? PORTAL_GATE;
    const cont = s.minimats[s.nav.container];
    const G = matGeometry(cont);
    const K = faceOf(G);
    const inside = insideOf(cont);
    const content = contentOf(inside);
    const camScene = { x: s.camX, y: s.camY, zoom: s.zoom };
    const rootDesk = { notes: s.notes ?? [], minimats: s.minimats };
    let f;
    if (s.nav.kind === "enter") f = enterFlight(K, content, camScene, VP, undefined, undefined, insideView(G, content, camScene, VP, FIT, gate).cam);   // the flight starts at the inside's own camera: the cut is bit for bit
    else f = exitFlight(K, content, s.nav.innerCam ?? arrivalCamera(content, VP), camScene, VP);
    f.p = s.nav.p;   // pinned at the scene's progress — the camera, the opacities and the lamps all read it
    const cam = flightAt(f, s.nav.p, VP);
    const outCam = departedCamera(f, cam);
    const enter = f.kind === "enter";
    // the face lives in the PARENT desk: the departed one on enter, the arriving one on exit. A frozen flight has none — it is a dissolve.
    const clip = f.frozen ? undefined : faceClip(G, enter ? outCam : cam);
    const pres = flightPresent(f, clip, gate);
    const lights = flightLights(f, cam, outCam);
    const at = clip && enter ? s.nav.container : undefined;
    return { f, cam, outCam, clip, pres, lights, at, enter, arriving: enter ? inside : rootDesk, departed: enter ? rootDesk : inside, G };
  }

  /** The control for the light check: every inside lit by its OWN lamp (the old portal's miniature desk), not the host's. */
  function litOwn(inp) {
    return { ...inp, ...(inp.portals ? { portals: inp.portals.map((p) => litOwn({ ...p, light: { a: { x: p.view.camX, y: p.view.camY, zoom: p.view.zoom } } })) } : {}) };
  }

  /**
   * Encode one scene into `encoder`, drawn into `target` (`size` device px) through the ground's own `prepareFrame` +
   * `drawFrame` — the root desk, the live insides of its mini mats, and a flight's departed desk through the mini mat —
   * exactly the inputs the lab hands `ground.render()`. The host submits; the Node oracle then reads the target back.
   */
  /** The last held frame's pose on screen (the check reads it): the shown extent's box, CSS px, the grow and the rise. */
  let heldFrameDrawn = null;

  /**
   * A HELD FRAME (design-015 §8; D4b): the scene's `hold` names the object in hand (`book`/`board`/`pad`: an index), the carry `e`,
   * the cover's target (`open`, default: past 42 % of the pickup), the user's zoom and pan, and `empty` (the hand drawn with nothing
   * in it — the check's "the blurred desk alone"). The pose is hold/pose.ts's — the SAME pure math the builder runs — and the frame
   * goes through `renderHeldFrame`, the ground's own path: the desk copy (this scene without the held object) blurred, the hand's
   * one object under the pose's camera, the two composites. It submits its own encoders; the caller's stays empty.
   */
  function encodeHeld(target, size, s, theme, rootGrid, m) {
    const h = s.hold;
    const vp = vpOf(s);
    const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
    const e = Math.min(Math.max(h.e, 0), 1);
    const openTarget = h.open ?? progressOf(e) >= HOLD.openAt;
    const user = { zoom: h.zoom ?? 1, panX: h.panX ?? 0, panY: h.panY ?? 0 };
    // the held object: its rect, its open extent (its own units, unturned), its turn, whether it rises toward the eye
    let rect;
    let extentLocal;
    let angle = 0;
    let eye = false;
    let spread = false;
    let handDesk;
    let restDesk;
    if (h.book !== undefined) {
      const b = s.books[h.book];
      rect = { cx: b.x, cy: b.y, w: NOTEBOOK.cover.width, h: NOTEBOOK.cover.height };
      extentLocal = { cx: rect.cx - rect.w / 2, cy: rect.cy, w: rect.w * 2, h: rect.h };
      angle = bookAngleOf(b);
      eye = true;
      spread = true;
      restDesk = { ...s, books: s.books.filter((_, i) => i !== h.book) };
      handDesk = (pose, rise) => ({ books: [{ ...b, angle: pose.angle, open: openTarget ? 1 : 0, rise, held: false, selected: false }] });
    } else if (h.board !== undefined) {
      const b = s.boards[h.board];
      rect = { cx: b.x, cy: b.y, w: b.w ?? BOARD.spec.width, h: b.h ?? BOARD.spec.height };
      extentLocal = rect;
      restDesk = { ...s, boards: s.boards.filter((_, i) => i !== h.board) };
      // in hand its marker is the pen law's (D3t-a): taken up once the board is open, at the scene's pen if it states one
      handDesk = () => ({ boards: [{ ...b, selected: false, held: false, inHand: { open: openTarget, ...(h.pen !== undefined ? { pen: h.pen } : {}) } }] });
    } else {
      const c = s.calendars[h.pad];
      rect = { cx: c.x, cy: c.y, w: PAD.W, h: PAD.H };
      extentLocal = rect;
      restDesk = { ...s, calendars: s.calendars.filter((_, i) => i !== h.pad) };
      handDesk = () => ({ calendars: [{ ...c, selected: false }] });
    }
    const target1 = readingTarget(extentLocal, vp, spread);
    const ox = extentLocal.cx - rect.cx;
    const oy = extentLocal.cy - rect.cy;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const extentWorld = { cx: rect.cx + ca * ox - sa * oy, cy: rect.cy + sa * ox + ca * oy, w: extentLocal.w, h: extentLocal.h };
    const pose = heldPose(homePose(extentWorld, angle, cam), target1, user, e);
    const { cam: heldCam, grow } = heldCamera(pose, rect, extentLocal, cam.zoom, eye, vp);
    // the eye kind rises by H·(1 − 1/grow) under the held camera's own eye — the notebook kind's arithmetic
    const rise = eye && grow > 1 ? eyeOf(heldCam, vp, NOTEBOOK.eye).h * (1 - 1 / grow) : 0;
    const hand = h.empty === true ? { notes: [{ x: 1e6, y: 1e6, seed: 1, text: "" }] } : handDesk(pose, rise);   // an empty hand: a note a million units away, culled
    const handInputs = deskInputs({ notes: [], minimats: [], ...hand }, heldCam, s, 0);
    const heldObject = handInputs.objects[handInputs.objects.length - 1];
    // the desk without it
    const r = deskInputs({ notes: restDesk.notes ?? [], minimats: restDesk.minimats ?? [], ...(restDesk.boards ? { boards: restDesk.boards } : {}), ...(restDesk.prints ? { prints: restDesk.prints } : {}), ...(restDesk.books ? { books: restDesk.books } : {}), ...(restDesk.calendars ? { calendars: restDesk.calendars } : {}), ...(restDesk.things ? { things: restDesk.things } : {}) }, cam, s, 0);
    const inputs = { view: viewOf(cam, s), mat: m, theme, ...(s.lodZoom !== undefined ? { lodZoom: s.lodZoom } : {}), grid: rootGrid, objects: r.objects, ...(r.portals.length ? { portals: r.portals } : {}) };
    const heldGrid = { ...rootGrid, mat: { ...rootGrid.mat, gobo: { ...rootGrid.mat.gobo, opacity: 0 } } };
    const held = { object: heldObject, view: viewOf(heldCam, s), grid: heldGrid, e, ...heldFocus(e, vp, theme), stamp: `oracle ${Date.now()} ${Math.random()}` };
    heldFrameDrawn = { ...heldFrame(pose, extentLocal, target1.single), grow, rise, cam: heldCam };
    const stats = renderHeldFrame(device, hold, rootSlot, pool, rootGrid, { view: () => target, size: () => size }, inputs, held, { stamp: null, stats: null, copies: 0 });
    return { theme, nav: null, prepared: { incoming: { stats: { k0: stats.k0, fade: stats.fade, wind: stats.wind } }, portals: stats.portals }, marks: [] };
  }

  /**
   * A still's tray (design-017 §8, K5a): its slide, lift and shown scroll, and — unless it is `bare` — the six kinds laid by the lattice
   * law across the drawer, recorded by their own kinds exactly as the product's reflector records them (tray/specimens.ts): each its
   * widget's props at their defaults under its entry's, the calendar's month the still's (its clock is the day it is drawn). K5b — THE
   * FACES, as the product's stage pins them: the note's the committed raster (the one a desk note carries — Node has no text raster),
   * the print's the kind's sample picture (made from arithmetic, alike on both hosts); the pad's month is the live print's alone (the
   * committed print holds level 2, the specimen samples far coarser — D-K5b.5): unprinted here, and on the product's stage too.
   */
  function trayInputsOf(s, view, theme, grid) {
    const t = s.tray;
    const base = { p: t.p ?? 1, lift: t.lift ?? 0, scroll: t.scroll ?? 0 };
    if (t.bare === true) return base;
    const items = hung.map((w) => ({ type: w.type, hang: w.tray.hang, category: w.tray.category ?? "", order: w.tray.order ?? 0 }));
    const laid = layTray(items, drawerSize(view.width, view.height).w, DRAWER.pitch);
    const kinds = hung.map((w) => objectKindOf(w));
    const specimens = laid.placed.map((q, i) => {
      const w = hung.find((x) => x.type === q.type);
      const props = {};
      for (const g of w.groups) { const cell = w.prefab.components.find(([c]) => c === g.component); for (const name of Object.keys(g.fields)) props[name] = cell?.[1][name]; }
      Object.assign(props, w.tray.props, q.type === "desk.calendar" ? { month: "2026-09" } : {});
      const asset = q.type === "desk.note" ? committedInk() : null;
      return { key: i + 1, type: q.type, kind: objectKindOf(w), natural: w.defaultSize, rect: { x: q.x, y: q.y, w: q.w, h: q.h }, props, accessory: w.tray.hang.accessory, pegs: w.tray.hang.pegs, label: w.tray.label, ...(asset ? { asset } : {}) };
    });
    const frames = specimenFrames(specimens, { rect: drawerRect(view.width, view.height, base.p, base.lift), scroll: base.scroll }, { view, theme, grid, looks: looksOf(kinds, deskPalette(theme.name), theme), lift: () => 0 });
    return { ...base, specimens: frames.map((f) => (f.type === "desk.photo" ? { ...f, record: { ...f.record, picture: samplePictureOf() } } : f)) };
  }
  /** The committed ink raster, placed once (a desk note's and the note specimen's alike). */
  function committedInk() {
    if (inkBytes && !inkRaster) { const rect = papers.alloc(inkMeta.w, inkMeta.h); if (rect) inkRaster = { layer: rect.layer, uv: papers.write(rect, inkBytes) }; }
    return inkRaster;
  }
  /** The print specimen's picture (K5b): the photo kind's sample, made once on the photo pass. */
  let samplePic = null;
  function samplePictureOf() {
    samplePic ??= photos.picture(samplePicture(SAMPLE_SIZE.w, SAMPLE_SIZE.h), SAMPLE_SIZE.w, SAMPLE_SIZE.h);
    return samplePic;
  }

  function encode(encoder, target, size, s, opts = {}) {
    prototypeRing = opts.prototypeRing === true;
    const theme = opts.theme ?? THEMES[s.theme];
    const m = matOf(s);
    // the hand (D4b): a carry above 0 is the held frame's own path; at 0 the frame is the rest frame, byte for byte
    if (s.hold !== undefined && s.hold.e > 0) {
      papers.law = DEFAULT_PAPER_LAW; papers.chain = false;
      papers.reset(); inkRaster = null;
      pageInk = new PageInk();
      for (const id of rastered) boards.release(id);
      rastered.clear(); nextBoard = 1;
      return encodeHeld(target, size, s, theme, gridFor(s, true), m);
    }
    papers.law = DEFAULT_PAPER_LAW; papers.chain = s.paper?.chain ?? false;
    papers.reset(); inkRaster = null;   // the ink pages carved afresh, so a scene's rasters land where the lab's do
    pageInk = new PageInk();   // …and the notebooks' page layers handed out afresh (D3t-b)
    for (const id of rastered) boards.release(id);   // and the boards' rasters: each scene's boards replay into fresh ones
    rastered.clear(); nextBoard = 1;
    const bg = theme.canvasBg;
    const rootGrid = { ...gridFor(s, true), ...(opts.rootGround ? { mat: { ...gridFor(s, true).mat, ground: opts.rootGround } } : {}) };
    let inputs;
    let nav = null;
    if (s.nav) {
      nav = navOf(s);
      const a = deskInputs(nav.arriving, nav.cam, s, 0);
      const d = deskInputs(nav.departed, nav.outCam, s, 0, nav.enter ? (nav.at ?? -1) : -1);
      inputs = {
        view: viewOf(nav.cam, s), mat: m, theme, present: nav.pres.incoming, ...(nav.lights.incoming ? { light: nav.lights.incoming } : {}),
        ...(s.dress === false ? {} : { lodZoom: nav.f.c1.zoom }),   // the arriving desk is dressed for its landing, the departed for the cut (PORTAL.md §9)
        grid: nav.enter ? gridFor(s, false) : rootGrid, objects: a.objects, ...(a.portals.length ? { portals: a.portals } : {}),
        outgoing: {
          view: viewOf(nav.outCam, s), mat: m, present: nav.pres.outgoing, ...(nav.lights.outgoing ? { light: nav.lights.outgoing } : {}),
          ...(s.dress === false ? {} : { lodZoom: nav.f.camPre.zoom }),
          grid: nav.enter ? rootGrid : gridFor(s, false), objects: d.objects, ...(d.portals.length ? { portals: d.portals } : {}),
          order: nav.enter ? "under" : "over", ...(nav.at !== undefined ? { at: nav.at } : {}),
        },
      };
    } else {
      const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
      const r = deskInputs({ notes: s.notes ?? [], minimats: s.minimats ?? [], ...(s.boards ? { boards: s.boards } : {}), ...(s.prints ? { prints: s.prints } : {}), ...(s.books ? { books: s.books } : {}), ...(s.calendars ? { calendars: s.calendars } : {}), ...(s.things ? { things: s.things } : {}) }, cam, s, 0);
      inputs = { view: viewOf(cam, s), mat: m, theme, ...(s.lodZoom !== undefined ? { lodZoom: s.lodZoom } : {}), grid: rootGrid, objects: r.objects, ...(r.portals.length ? { portals: r.portals } : {}), ...(opts.light ? { light: opts.light } : {}) };
    }
    if (opts.ownLitInsides) inputs = litOwn(inputs);
    // the pegboard drawer (design-017): a still's slide, lip and shown scroll, over the marks — and its specimens (K5a)
    const trayIn = s.tray === undefined || s.nav ? undefined : trayInputsOf(s, inputs.view, theme, rootGrid);
    const trayed = trayIn === undefined ? 0 : tray.prepare(inputs.view, theme, rootGrid, m, trayIn);
    const prepared = prepareFrame(encoder, rootSlot, pool, trayIn === undefined ? inputs : { ...inputs, tray: trayIn }, rootGrid, undefined, trayed > 0 ? traySlots : undefined);
    // the desk's marks (stratum 5): a still's — a flight's chrome waits for its landing; off for a check that measures the objects alone
    // (the tray's name tags ride the marks pass either way)
    const tags = trayed > 0 ? { view: inputs.view, tags: tagsOf(trayIn), night: theme.matLight.night } : undefined;
    const marked = opts.marks === false || prototypeRing || s.nav ? (tags === undefined ? 0 : marks.prepare(undefined, tags)) : marks.prepare(marksOf(s, { x: s.camX, y: s.camY, zoom: s.zoom }, theme), tags);
    const pass = beginPass(encoder, target, [bg[0], bg[1], bg[2], 1]);
    drawFrame(pass, size, viewSpecOf(s).dpr, prepared.incoming, prepared.outgoing);
    if (marked > 0) marks.draw(pass);
    if (trayed > 0) drawTray(pass, size, viewSpecOf(s).dpr, tray, prepared.tray, marks);
    pass.end();
    return { theme, nav, prepared, marks: marked > 0 ? marks.laid : [] };
  }

  return { mat, papers, minimats, boards, photos, notebooks, calendars, marks, tray, traySlots, marksOf, rootSlot, pool, VP, noteGeometry, notesOf, matGeometry, insideOf, contentOf, childrenOf, thingsOf, printOf, boardPoseOf, bookOf, pages: () => pageInk, encode, heldFrame: () => heldFrameDrawn };
}
