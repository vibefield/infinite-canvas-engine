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
// note, the mini mat, the whiteboard and the photo print, on the host's shader text), and a desk's
// objects reach the ground as ONE list in paint order: its mini mats (sheets) first — so a mini
// mat's index among the mini mats is its index in `objects`, which is what a portal's `at` names —
// then its THINGS: the scene's own order where it gives one (`things`), else the prototype's — the
// whiteboards, the notes, the prints (its photo lab drew them over everything). The whiteboards
// and the prints are made as their prototype hosts make them (design-015 D3r-a): a board by the
// board bench's `BoardDesk` (lab/board.ts — at rest, its marker lying on it, its ink REPLAYED from
// a stroke list as `sketch` lays one), a print by the photo lab's `addRGBA` (lab/photo.ts — a body
// with its pose pinned, the committed picture).
import { VIEW } from "./scenes.mjs";
import { beginPass } from "../src/engine/target.ts";
import { MatPass } from "../src/mat/mat-pass.ts";
import { matShaders, MAT_SHADER_FILES } from "../src/mat/shaders.ts";
import { DEFAULT_MAT_CONFIG, HERO_MATRIX } from "../src/mat/layout.ts";
import { DEFAULT_GRID } from "../src/mat/grid.ts";
import { DEFAULT_PAPER_LAW, lampOf, resolvePaper, tiltOf } from "../src/paper/paper.ts";
import { chipOf, DEFAULT_MINIMAT_LAW, faceClip, faceOf, resolveMiniMat } from "../src/minimat/minimat.ts";
import { flightLights, flightPresent, insidePresent, insideView, miniMatInstance } from "../src/minimat/inside.ts";
import { createSlotSet, drawFrame, prepareFrame, SlotPool } from "../src/ground.ts";
import { BOARD_KIND, deskKinds, MINIMAT_KIND, PAPER_KIND, PHOTO_KIND } from "../src/kinds/index.ts";
import { arrivalCamera, boundsOf, departedCamera, enterFlight, exitFlight, FIT, flightAt } from "../src/nav/flight.ts";
import { PORTAL_CAP, PORTAL_GATE } from "../src/nav/portal.ts";
import { BOARD, MAT_GRID, MINIMAT } from "../src/theme.ts";
import { quadOf, resolveBoard, surfaceSize } from "../src/board/board.ts";
import { BoardHistory } from "../src/board/history.ts";
import { ERASER_TOOL, markerTool, StrokeBuilder, TIPS } from "../src/board/stroke.ts";
import { linear } from "../src/mat/night.ts";
import { borderOf } from "../src/photo/layout.ts";
import { newBody, PHOTO, printSize, resolvePhoto } from "../src/photo/photo.ts";
import { boardLook, MARKERS, marker, pen, THEMES, surface } from "./fixtures/vf-theme.ts";

/**
 * The desk both hosts draw: the root's passes on `device` in `format`, composed from `text(files)` — a shader-file map
 * (`MAT_SHADER_FILES`, …) to its text: the .wgsl files on disk in Node, the generated module in a browser — and the
 * fixtures' bytes (`assets`: the engine's blue noise; the host's gobo plates, the rulers' glyph atlas, the note's
 * committed ink raster and the prints' picture, each with its metadata; a missing atlas, raster or picture is `null`
 * and the desk draws without it).
 */
export async function createOracleDesk({ device, format, text, assets, log = console.log }) {
  const mat = await MatPass.create(device, format, matShaders(text(MAT_SHADER_FILES)));
  // The root slot from the kind registry: every desk kind's pass on the root's mat — the sticky notes (STICKY.md), the mini mats
  // (MINIMAT.md) and the whiteboards (BOARD.md, no scene holds one yet) — and the two passes a scene reaches into: the notes'
  // (the ink pages, the law) and the mini mats'.
  const rootSlot = await createSlotSet(device, format, mat, deskKinds(text));
  const passOf = (name) => { const k = rootSlot.kinds.get(name); if (!k) throw new Error(`oracle: the registry has no "${name}" kind`); return k.pass.pass; };
  const papers = passOf(PAPER_KIND);
  const minimats = passOf(MINIMAT_KIND);
  const boards = passOf(BOARD_KIND);
  const photos = passOf(PHOTO_KIND);
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

  // The slots beyond the root — the departed desk's, the live insides — from the same pool the ground keeps.
  const pool = new SlotPool(rootSlot);
  const VP = { width: VIEW.cssW, height: VIEW.cssH };
  const viewOf = (cam) => ({ camX: cam.x, camY: cam.y, zoom: cam.zoom, width: VIEW.cssW, height: VIEW.cssH, dpr: VIEW.dpr });
  const matOf = (s) => ({ time: s.mat?.time ?? 0, goboTime: s.mat?.goboTime ?? 0, goboMatrix: HERO_MATRIX, noise: s.mat?.noise ?? [0, 0] });

  /** A desk's grid: the mat with the scene's gobo; the rulers print on the ROOT of a scene that says `ruler` (RULER.md). `ground` = a mini mat's inside of another colour. */
  // biome-ignore lint/style/useDefaultParameterLast: the prototype's signature, moved verbatim — dropping the default would change what an explicit `undefined` means (design-015 D1)
  function gridFor(s, rootSlot = false, ground) {
    return {
      fadeIn: DEFAULT_GRID.fadeIn,
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
    return resolvePaper({ cx: n.x, cy: n.y, w: n.w ?? NOTE.size, h: n.h ?? NOTE.size, angle: n.angle ?? tiltOf(seed, NOTE.tilt) }, { held: n.held ? 1 : 0, ring: n.selected ? 1 : 0, fade: 1 }, NOTE, lamp);
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
  const matGeometry = (m) => resolveMiniMat({ cx: m.x, cy: m.y, w: m.w ?? MINIMAT.size.w, h: m.h ?? MINIMAT.size.h }, { held: m.held ? 1 : 0, hover: 0, ring: m.selected ? 1 : 0, fade: 1 }, DEFAULT_MINIMAT_LAW, lamp);
  const insideOf = (m) => m.inside ?? { notes: [], minimats: [] };
  /**
   * A desk's THINGS in paint order, each `{ kind: "note" | "board" | "print", …its spec }`: the scene's own list where it
   * gives one (`things` — a print laid between two notes), else the prototype's order: the whiteboards, the notes, the prints.
   */
  const thingsOf = (desk) => desk.things ?? [...(desk.boards ?? []).map((b) => ({ ...b, kind: "board" })), ...(desk.notes ?? []).map((n) => ({ ...n, kind: "note" })), ...(desk.prints ?? []).map((p) => ({ ...p, kind: "print" }))];
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
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  /** A right hand holds a marker with its barrel rising away to the upper right (lab/board.ts). */
  const HAND_ANGLE = Math.atan2(-0.8, 0.6);
  /**
   * A board's history from a stroke list, as the bench's `sketch` lays one: each stroke a path of melamine points (world units
   * from its top-left) at a pace, through the StrokeBuilder with the bench's seed, committed dry — then what a replay needs.
   */
  function opsOf(strokes = []) {
    const history = new BoardHistory();
    for (const s of strokes) {
      const ink = s.ink ?? "black";
      const tool = s.erase ? ERASER_TOOL : markerTool(linear(marker(ink)), MARKERS[ink].opacity, TIPS[s.tip ?? "bullet"]);
      const builder = new StrokeBuilder(tool, (history.done.length * 97.13) % 1000);
      const speed = s.speed ?? 400;   // world units / s
      let t = 0;
      s.points.forEach(([x, y], i) => {
        if (i === 0) { builder.begin(x, y, t); return; }
        const [px, py] = s.points[i - 1];
        t += (Math.hypot(x - px, y - py) / speed) * 1000;
        builder.move(x, y, t);
      });
      builder.end();
      history.push({ kind: "stroke", tool, stamps: builder.stamps(), ...(s.erase ? {} : { ink }) });
    }
    return history.replay;
  }
  /**
   * A board at rest as the bench draws it (`BoardDesk.instances` + `poseOf` with no board open), all but its raster: resolved under
   * the one lamp, its ring as its selection says, the capped marker lying where a hand put it down, the world rect it may paint,
   * the eye straight over it (the parallax at rest).
   */
  function boardPoseOf(b) {
    const w = b.w ?? BOARD.spec.width;
    const h = b.h ?? BOARD.spec.height;
    const G = resolveBoard({ cx: b.x, cy: b.y, w, h }, { held: 0, ring: b.selected ? 1 : 0, fade: 1 }, lamp);
    // THE marker, lying on the board (the bench's `poseOf` with nothing taken up: every hand term at e = 0, kept as it computes them)
    const P = BOARD.pen;
    const R = P.radius;
    const L = P.length;
    const e = 0;
    const rest = { x: w * 0.16, y: h * 0.5 - BOARD.spec.frame - BOARD.pen.radius - 13, angle: -0.07 };
    const ar = rest.angle;
    const mid = [G.centre[0] + rest.x * G.scale, G.centre[1] + rest.y * G.scale];
    const at = [mid[0] - Math.cos(ar) * L * 0.5, mid[1] - Math.sin(ar) * L * 0.5];
    const hand = at;
    let da = HAND_ANGLE - ar;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const gap = P.hover;
    const penPose = {
      x: at[0] + (hand[0] - at[0]) * e, y: at[1] + (hand[1] - at[1]) * e, angle: ar + da * e,
      height: R + (gap - R) * e + 34 * Math.sin(Math.PI * e), rise: P.rise * e,
      cap: smooth(0.3, 0.85, e), nib: TIPS[b.tip ?? "bullet"].half[1],
      presence: 1 + (0 - 1) * smooth(0.85, 1, e),
      ink: marker(b.cap ?? "black"),
    };
    const slope = Math.hypot(G.slope[0], G.slope[1]);
    const r = L * 1.3 + 60 + slope * (penPose.height + L * penPose.rise + 12);
    const box = { x0: penPose.x - r, y0: penPose.y - r, x1: penPose.x + r, y1: penPose.y + r };
    const par = [0, 0];
    const k = BOARD.surface.parallax;
    return { geometry: G, surface: look.surface, metal: look.frame, quad: quadOf(G, box), sheen: [par[0] * k * 5, -par[1] * k * 5], pen: penPose };
  }
  /** A board as the pass takes it: its pose, and its raster made and its ink REPLAYED (`ensure` + `replay` — the raster is a cache of the history). */
  function boardOf(b) {
    const pose = boardPoseOf(b);
    const id = nextBoard++;
    boards.ensure(id, surfaceSize(pose.geometry));
    boards.replay(id, opsOf(b.strokes));
    rastered.add(id);
    return { id, ...pose };
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
      const view = insideView(G, contentOf(inside), cam, VP, FIT, gate);
      const grid = gridFor(s, false, m.ground);
      minis.push(miniMatInstance(G, view, grid, childrenOf(inside).map((c) => chipOf(c, view.M)), m.name, s.dress !== false));
      if (s.portals !== false && depth < 4 && i !== skip && view.presence > 0) cands.push({ i, view, inside, grid });
    });
    cands.sort((a, b) => b.view.clip.hx * b.view.clip.hy - a.view.clip.hx * a.view.clip.hy);
    for (const { i, view, inside, grid } of cands.slice(0, PORTAL_CAP)) {
      const sub = deskInputs(inside, view.cam, s, depth + 1);
      portals.push({
        view: { ...viewOf(view.cam), box: view.box }, mat: matOf(s),
        ...(s.dress === false ? {} : { lodZoom: view.arrival.zoom }),   // dressed for its arrival (PORTAL.md §9)
        present: insidePresent(view), grid,
        objects: sub.objects, ...(sub.portals.length ? { portals: sub.portals } : {}),
        at: i,   // mini mat i is object i: the mini mats come first
      });
    }
    let n = 0;
    const thingObjects = things.map((t) => (t.kind === "note" ? { kind: PAPER_KIND, record: notes[n++] } : t.kind === "board" ? { kind: BOARD_KIND, record: boardOf(t) } : t.kind === "print" ? { kind: PHOTO_KIND, record: printOf(t) } : thingError(t)));
    const objects = [...minis.map((record) => ({ kind: MINIMAT_KIND, record })), ...thingObjects];
    return { objects, portals };
  }
  const thingError = (t) => { throw new Error(`oracle: a desk's thing is a note, a board or a print — not "${t.kind}"`); };

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
  function encode(encoder, target, size, s, opts = {}) {
    const theme = opts.theme ?? THEMES[s.theme];
    const m = matOf(s);
    papers.law = DEFAULT_PAPER_LAW; papers.chain = s.paper?.chain ?? false;
    papers.reset(); inkRaster = null;   // the ink pages carved afresh, so a scene's rasters land where the lab's do
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
        view: viewOf(nav.cam), mat: m, theme, present: nav.pres.incoming, ...(nav.lights.incoming ? { light: nav.lights.incoming } : {}),
        ...(s.dress === false ? {} : { lodZoom: nav.f.c1.zoom }),   // the arriving desk is dressed for its landing, the departed for the cut (PORTAL.md §9)
        grid: nav.enter ? gridFor(s, false) : rootGrid, objects: a.objects, ...(a.portals.length ? { portals: a.portals } : {}),
        outgoing: {
          view: viewOf(nav.outCam), mat: m, present: nav.pres.outgoing, ...(nav.lights.outgoing ? { light: nav.lights.outgoing } : {}),
          ...(s.dress === false ? {} : { lodZoom: nav.f.camPre.zoom }),
          grid: nav.enter ? rootGrid : gridFor(s, false), objects: d.objects, ...(d.portals.length ? { portals: d.portals } : {}),
          order: nav.enter ? "under" : "over", ...(nav.at !== undefined ? { at: nav.at } : {}),
        },
      };
    } else {
      const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
      const r = deskInputs({ notes: s.notes ?? [], minimats: s.minimats ?? [], ...(s.boards ? { boards: s.boards } : {}), ...(s.prints ? { prints: s.prints } : {}), ...(s.things ? { things: s.things } : {}) }, cam, s, 0);
      inputs = { view: viewOf(cam), mat: m, theme, ...(s.lodZoom !== undefined ? { lodZoom: s.lodZoom } : {}), grid: rootGrid, objects: r.objects, ...(r.portals.length ? { portals: r.portals } : {}), ...(opts.light ? { light: opts.light } : {}) };
    }
    if (opts.ownLitInsides) inputs = litOwn(inputs);
    const prepared = prepareFrame(encoder, rootSlot, pool, inputs, rootGrid);
    const pass = beginPass(encoder, target, [bg[0], bg[1], bg[2], 1]);
    drawFrame(pass, size, VIEW.dpr, prepared.incoming, prepared.outgoing);
    pass.end();
    return { theme, nav, prepared };
  }

  return { mat, papers, minimats, boards, photos, rootSlot, pool, VP, noteGeometry, notesOf, matGeometry, insideOf, contentOf, childrenOf, thingsOf, printOf, boardPoseOf, encode };
}
