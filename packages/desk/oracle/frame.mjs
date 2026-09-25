// The oracle's desk, shared by its two hosts: the Node oracle (render.mjs — Dawn, a readable
// Target, the .wgsl files and the fixtures read from disk) and apps/desk's parity page (Chrome —
// the canvas, the generated shader text, the fixtures fetched). This module builds the passes from
// the host's shader text and asset bytes and turns a scene (scenes.mjs) into exactly the inputs the
// ground's `prepareFrame` takes, then encodes the frame through `prepareFrame` + `drawFrame` — so
// both hosts draw a scene through ONE copy of the scene builder, and `rig:parity` compares pixels,
// not two builders. (design-015 D1b: the functions below moved here verbatim from render.mjs,
// where the prototype had them; its lab kept a copy of the same logic for Chrome.)
import { VIEW } from "./scenes.mjs";
import { beginPass } from "../src/engine/target.ts";
import { MatPass } from "../src/mat/mat-pass.ts";
import { matShaders, MAT_SHADER_FILES } from "../src/mat/shaders.ts";
import { DEFAULT_MAT_CONFIG, HERO_MATRIX } from "../src/mat/layout.ts";
import { DEFAULT_GRID } from "../src/mat/grid.ts";
import { PaperPass } from "../src/paper/paper-pass.ts";
import { paperShaders, PAPER_SHADER_FILES } from "../src/paper/shaders.ts";
import { DEFAULT_PAPER_LAW, lampOf, resolvePaper, tiltOf } from "../src/paper/paper.ts";
import { MiniMatPass } from "../src/minimat/pass.ts";
import { miniMatShaders, MINIMAT_SHADER_FILES } from "../src/minimat/shaders.ts";
import { chipOf, DEFAULT_MINIMAT_LAW, faceClip, faceOf, resolveMiniMat } from "../src/minimat/minimat.ts";
import { flightLights, flightPresent, insidePresent, insideView, miniMatInstance } from "../src/minimat/inside.ts";
import { drawFrame, prepareFrame, SlotPool } from "../src/ground.ts";
import { arrivalCamera, boundsOf, departedCamera, enterFlight, exitFlight, FIT, flightAt } from "../src/nav/flight.ts";
import { PORTAL_CAP, PORTAL_GATE } from "../src/nav/portal.ts";
import { MAT_GRID, MINIMAT } from "../src/theme.ts";
import { pen, THEMES, surface } from "./fixtures/vf-theme.ts";

/**
 * The desk both hosts draw: the root's passes on `device` in `format`, composed from `text(files)` — a shader-file map
 * (`MAT_SHADER_FILES`, …) to its text: the .wgsl files on disk in Node, the generated module in a browser — and the
 * fixtures' bytes (`assets`: the engine's blue noise; the host's gobo plates, the rulers' glyph atlas and the note's
 * committed ink raster, each with its metadata; a missing atlas or raster is `null` and the desk draws without it).
 */
export async function createOracleDesk({ device, format, text, assets, log = console.log }) {
  const mat = await MatPass.create(device, format, matShaders(text(MAT_SHADER_FILES)));
  // The sticky notes (STICKY.md) and the mini mats (MINIMAT.md), on the root's mat.
  const papers = await PaperPass.create(device, format, paperShaders(text(PAPER_SHADER_FILES)), mat);
  const minimats = await MiniMatPass.create(device, format, miniMatShaders(text(MINIMAT_SHADER_FILES)), mat);
  // The engine's asset (the blue noise) and the HOST's (the gobo plates, the rulers' glyphs, the note's ink — the product's, a fixture here) — raw bytes either way.
  mat.setPlate("c", assets.goboC); mat.setPlate("b", assets.goboB); mat.setNoise(assets.noise);
  const glyphMeta = assets.glyphMeta;
  if (glyphMeta && glyphMeta.count >= 12) mat.setGlyphs(assets.glyphs, glyphMeta);
  else log("no glyph atlas (oracle/fixtures/assets/glyphs-mono-2x.*): the rulers print ticks and lines, no labels");
  const inkMeta = assets.inkMeta;
  const inkBytes = inkMeta && inkMeta.w > 0 ? assets.ink : null;
  if (!inkBytes) log("no ink raster (oracle/fixtures/assets/ink-note-1.*): the notes draw blank");
  const lamp = lampOf(MAT_GRID.plane);

  // The slots beyond the root — the departed desk's, the live insides — from the same pool the ground keeps.
  const rootSlot = { mat, papers, minimats };
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
  /** The bounds of a desk's content (its notes and mini mats) — what its arrival is framed on; a control may pin them (`bounds`). */
  const contentOf = (desk) => desk.bounds ?? boundsOf([...(desk.notes ?? []).map((n) => ({ x: n.x - (n.w ?? NOTE.size) / 2, y: n.y - (n.h ?? NOTE.size) / 2, width: n.w ?? NOTE.size, height: n.h ?? NOTE.size })), ...(desk.minimats ?? []).map((m) => ({ x: m.x - (m.w ?? MINIMAT.size.w) / 2, y: m.y - (m.h ?? MINIMAT.size.h) / 2, width: m.w ?? MINIMAT.size.w, height: m.h ?? MINIMAT.size.h }))]);
  /** A desk's children as the far LOD draws them (minimat.ts `ChildShape`), in the desk's own frame. */
  function childrenOf(desk) {
    const out = [];
    for (const m of desk.minimats ?? []) { const G = matGeometry(m); out.push({ kind: "mat", cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: 0, radius: G.radius, colour: DEFAULT_MAT_CONFIG.ground, height: G.thick, margin: G.margin }); }
    for (const n of desk.notes ?? []) {
      const G = noteGeometry(n);
      const w = n.greek ? { ink: pen(n.pen ?? "felt"), x0: 16, em: 24, lines: n.greek.map(([y, width]) => ({ y, width })) } : undefined;
      out.push({ kind: "paper", cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: G.angle, radius: G.radius, colour: surface(n.paper ?? "note"), height: G.curl * 0.5, ...(w ? { writing: w } : {}) });
    }
    return out;
  }

  /**
   * A desk's inputs under `cam` (the lab's `deskInputs`): its notes, its mini mats — each with its inside's embedding, the lattice
   * its face shows and its children as chips — and the live insides of the mini mats whose faces pass the gate, largest first up
   * to the cap, recursing through them (a belt of 4). `skip` = a mini mat whose inside is the flight's arriving desk.
   */
  function deskInputs(desk, cam, s, depth = 0, skip = -1) {
    const gate = s.portalGate ?? PORTAL_GATE;
    const out = { papers: notesOf(desk.notes), minimats: [], portals: [] };
    const cands = [];
    (desk.minimats ?? []).forEach((m, i) => {
      const G = matGeometry(m);
      const inside = insideOf(m);
      const view = insideView(G, contentOf(inside), cam, VP, FIT, gate);
      const grid = gridFor(s, false, m.ground);
      out.minimats.push(miniMatInstance(G, view, grid, childrenOf(inside).map((c) => chipOf(c, view.M)), m.name, s.dress !== false));
      if (s.portals !== false && depth < 4 && i !== skip && view.presence > 0) cands.push({ i, view, inside, grid });
    });
    cands.sort((a, b) => b.view.clip.hx * b.view.clip.hy - a.view.clip.hx * a.view.clip.hy);
    for (const { i, view, inside, grid } of cands.slice(0, PORTAL_CAP)) {
      const sub = deskInputs(inside, view.cam, s, depth + 1);
      out.portals.push({
        view: { ...viewOf(view.cam), box: view.box }, mat: matOf(s),
        ...(s.dress === false ? {} : { lodZoom: view.arrival.zoom }),   // dressed for its arrival (PORTAL.md §9)
        present: insidePresent(view), grid,
        papers: sub.papers, minimats: sub.minimats, ...(sub.portals.length ? { portals: sub.portals } : {}),
        at: i,
      });
    }
    return out;
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
  function encode(encoder, target, size, s, opts = {}) {
    const theme = opts.theme ?? THEMES[s.theme];
    const m = matOf(s);
    papers.law = DEFAULT_PAPER_LAW; papers.chain = s.paper?.chain ?? false;
    papers.reset(); inkRaster = null;   // the ink pages carved afresh, so a scene's rasters land where the lab's do
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
        grid: nav.enter ? gridFor(s, false) : rootGrid, papers: a.papers, minimats: a.minimats, ...(a.portals.length ? { portals: a.portals } : {}),
        outgoing: {
          view: viewOf(nav.outCam), mat: m, present: nav.pres.outgoing, ...(nav.lights.outgoing ? { light: nav.lights.outgoing } : {}),
          ...(s.dress === false ? {} : { lodZoom: nav.f.camPre.zoom }),
          grid: nav.enter ? rootGrid : gridFor(s, false), papers: d.papers, minimats: d.minimats, ...(d.portals.length ? { portals: d.portals } : {}),
          order: nav.enter ? "under" : "over", ...(nav.at !== undefined ? { at: nav.at } : {}),
        },
      };
    } else {
      const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
      const r = deskInputs({ notes: s.notes ?? [], minimats: s.minimats ?? [] }, cam, s, 0);
      inputs = { view: viewOf(cam), mat: m, theme, ...(s.lodZoom !== undefined ? { lodZoom: s.lodZoom } : {}), grid: rootGrid, papers: r.papers, minimats: r.minimats, ...(r.portals.length ? { portals: r.portals } : {}), ...(opts.light ? { light: opts.light } : {}) };
    }
    if (opts.ownLitInsides) inputs = litOwn(inputs);
    const prepared = prepareFrame(encoder, rootSlot, pool, inputs, rootGrid);
    const pass = beginPass(encoder, target, [bg[0], bg[1], bg[2], 1]);
    drawFrame(pass, size, VIEW.dpr, prepared.incoming, prepared.outgoing);
    pass.end();
    return { theme, nav, prepared };
  }

  return { mat, papers, minimats, rootSlot, pool, VP, noteGeometry, notesOf, matGeometry, insideOf, contentOf, childrenOf, encode };
}
