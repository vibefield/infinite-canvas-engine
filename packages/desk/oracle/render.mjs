// The ground rendered HEADLESS in Node on raw WebGPU (Dawn via the `webgpu`
// package), from the same TypeScript passes and the same .wgsl files the
// browser build uses. No canvas: the colour target is a readable Target.
//
//   pnpm --filter @ice/desk oracle              → oracle/results/oracle-<scene>.rgba for apps/desk rig:parity, and every check
//   BASELINE_DIR=<dir> pnpm --filter @ice/desk oracle   → also: the `baseline` stills byte for byte against <dir>
//                                                  (the renders the engine made before the cards and the dot and
//                                                  needle retired — MINIMAT.md §1: what stayed must not move)
//
// If this matches Chrome, the engine is host-agnostic and the pixel oracle
// needs no browser. A nav scene draws BOTH desks of a flight through the
// ground's own `prepareFrame` / `drawFrame`, from the same flight geometry
// the lab computes — and the checks pin design-006's promise: at the cut,
// nothing moved by a pixel.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { create, globals } from "webgpu";
import { ORACLE_SCENES, VIEW } from "./scenes.mjs";
import { acquire } from "../src/engine/device.ts";
import { beginPass, Target, readback } from "../src/engine/target.ts";
import { MatPass } from "../src/mat/mat-pass.ts";
import { matShaders, MAT_SHADER_FILES } from "../src/mat/shaders.ts";
import { DEFAULT_MAT_CONFIG, HERO_MATRIX } from "../src/mat/layout.ts";
import { DEFAULT_GRID } from "../src/mat/grid.ts";
import { labelReach, labelsAlong, rulerLevels } from "../src/lattice/ruler.ts";
import { lod } from "../src/lattice/lod.ts";
import { PaperPass } from "../src/paper/paper-pass.ts";
import { paperShaders, PAPER_SHADER_FILES } from "../src/paper/shaders.ts";
import { DEFAULT_PAPER_LAW, lampOf, localOf, resolvePaper, sdPaper, shadowReach, tiltOf } from "../src/paper/paper.ts";
import { MiniMatPass } from "../src/minimat/pass.ts";
import { miniMatShaders, MINIMAT_SHADER_FILES } from "../src/minimat/shaders.ts";
import { chipOf, DEFAULT_MINIMAT_LAW, faceClip, faceOf, resolveMiniMat, sdMiniMat } from "../src/minimat/minimat.ts";
import { flightLights, flightPresent, insidePresent, insideView, miniMatInstance } from "../src/minimat/inside.ts";
import { drawFrame, prepareFrame, SlotPool } from "../src/ground.ts";
import { arrivalCamera, boundsOf, departedCamera, enterFlight, exitFlight, FIT, flightAt } from "../src/nav/flight.ts";
import { PORTAL_CAP, PORTAL_GATE } from "../src/nav/portal.ts";
import { MAT_GRID, MINIMAT } from "../src/theme.ts";
import { pen, THEMES, surface } from "./fixtures/vf-theme.ts";
import { DAY_LIGHT, linearToSrgb, srgbToLinear } from "../src/mat/night.ts";

Object.assign(globalThis, globals);   // GPUBufferUsage & friends, which the browser has for free
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");   // packages/desk
const results = resolve(root, "oracle/results");
mkdirSync(results, { recursive: true });
const wgsl = (rel) => readFileSync(resolve(root, "shaders", rel), "utf8");
const texts = (files) => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, wgsl(f)]));
const FORMAT = "rgba8unorm";

const t0 = performance.now();
const gpu = await acquire({ gpu: create([]), label: "oracle" });
console.log(`device ${(performance.now() - t0).toFixed(0)} ms · ${gpu.info.description || gpu.info.vendor}`);
const device = gpu.device;
const mat = await MatPass.create(device, FORMAT, matShaders(texts(MAT_SHADER_FILES)));
// The sticky notes (STICKY.md) and the mini mats (MINIMAT.md), on the root's mat.
const papers = await PaperPass.create(device, FORMAT, paperShaders(texts(PAPER_SHADER_FILES)), mat);
const minimats = await MiniMatPass.create(device, FORMAT, miniMatShaders(texts(MINIMAT_SHADER_FILES)), mat);
// The engine's assets (assets/: the blue noise) and the HOST's (oracle/fixtures/assets/: the gobo plates, the rulers' glyphs, the note's ink — the product's, a fixture here) — raw bytes either way.
const bytesOf = (dir, rel) => { const b = readFileSync(resolve(root, dir, rel)); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); };
const raw = (rel) => bytesOf("assets", rel);
const hostRaw = (rel) => bytesOf("oracle/fixtures/assets", rel);
mat.setPlate("c", hostRaw("gobo-c.rgba")); mat.setPlate("b", hostRaw("gobo-b.rgba")); mat.setNoise(raw("blue-noise.rgba"));
const glyphMetaPath = resolve(root, "oracle/fixtures/assets/glyphs-mono-2x.json");
const glyphMeta = existsSync(glyphMetaPath) ? JSON.parse(readFileSync(glyphMetaPath, "utf8")) : null;
if (glyphMeta && glyphMeta.count >= 12) mat.setGlyphs(hostRaw("glyphs-mono-2x.r8"), glyphMeta);
else console.log("no glyph atlas (oracle/fixtures/assets/glyphs-mono-2x.*): the rulers print ticks and lines, no labels");
const inkMetaPath = resolve(root, "oracle/fixtures/assets/ink-note-1.json");
const inkMeta = existsSync(inkMetaPath) ? JSON.parse(readFileSync(inkMetaPath, "utf8")) : null;
const inkBytes = inkMeta && inkMeta.w > 0 ? hostRaw("ink-note-1.r8") : null;
if (!inkBytes) console.log("no ink raster (oracle/fixtures/assets/ink-note-1.*): the notes draw blank");
const lamp = lampOf(MAT_GRID.plane);

// The slots beyond the root — the departed desk's, the live insides — from the same pool the ground keeps.
const rootSlot = { mat, papers, minimats };
const pool = new SlotPool(rootSlot);
const W = VIEW.cssW * VIEW.dpr;
const H = VIEW.cssH * VIEW.dpr;
const out = new Target(device, { format: FORMAT, label: "oracle", readable: true }, W, H);
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

/**
 * Render one scene through the ground's own `prepareFrame` + `drawFrame` — the root desk, the live insides of its mini mats,
 * and a flight's departed desk through the mini mat — exactly the inputs the lab hands `ground.render()`.
 */
async function render(s, opts = {}) {
  const theme = opts.theme ?? THEMES[s.theme];
  const m = matOf(s);
  papers.law = DEFAULT_PAPER_LAW; papers.chain = s.paper?.chain ?? false;
  papers.reset(); inkRaster = null;   // the ink pages carved afresh, so a scene's rasters land where the lab's do
  const bg = theme.canvasBg;
  const encoder = device.createCommandEncoder();
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
  const pass = beginPass(encoder, out.view, [bg[0], bg[1], bg[2], 1]);
  drawFrame(pass, { w: W, h: H }, VIEW.dpr, prepared.incoming, prepared.outgoing);
  pass.end();
  device.queue.submit([encoder.finish()]);
  return { px: await readback(device, out.texture, 4), theme, nav, portals: prepared.portals, stats: prepared.incoming.stats };
}
/** The control for the light check: every inside lit by its OWN lamp (the old portal's miniature desk), not the host's. */
function litOwn(inp) {
  return { ...inp, ...(inp.portals ? { portals: inp.portals.map((p) => litOwn({ ...p, light: { a: { x: p.view.camX, y: p.view.camY, zoom: p.view.zoom } } })) } : {}) };
}

// ---------------------------------------------------------------- the checks

const lum = (P, o) => 0.2126 * P[o] + 0.7152 * P[o + 1] + 0.0722 * P[o + 2];
const delta = (A, B, o) => Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
/** A clip's rounded-rect distance in DEVICE px at a device-px point. */
const sdClip = (c) => { const d = VIEW.dpr;
const hx = c.hx * d;
const hy = c.hy * d;
const r = Math.min(c.r * d, hx, hy); return (x, y) => { const qx = Math.abs(x - c.cx * d) - hx + r;
const qy = Math.abs(y - c.cy * d) - hy + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; }; };

/** MINIMAT.md §1: what stayed must not move — a still the engine drew before the cards and the dot and the needle retired, byte for byte. */
function baselineCheck(sc, px) {
  const dir = process.env.BASELINE_DIR;
  const file = resolve(dir, `oracle-${sc.name}.rgba`);
  if (!existsSync(file)) { console.log(`  SKIP  baseline   ${sc.name.padEnd(24)} no ${file}`); return true; }
  const B = readFileSync(file);
  let n = 0;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) { const d = delta(px, B, i); if (d > 0) n++; if (d > max) max = d; }
  const ok = B.length === px.length && n === 0;
  console.log(`  ${ok ? "PASS" : "FAIL"}  baseline   ${sc.name.padEnd(24)} ${n.toLocaleString()} of ${(W * H).toLocaleString()} px differ from before the retirement (maxΔ ${max})`);
  return ok;
}

/**
 * design-006's promise at the cut, as pixels. ENTER, p = 0: outside the face the frame is the pre-cut frame, byte for byte —
 * the departed desk under the outgoing camera IS what was there. EXIT, p = 0: inside the face it is the inside as it was, byte
 * for byte, and around it the parent shows. Three device px of margin for the face's AA ramp.
 */
async function continuity(sc) {
  const s = sc.scene;
  const { px: B, nav } = await render(s);
  const before = sc.continuity === "enter"
    ? { ...s, nav: undefined }
    : (() => { const cont = s.minimats[s.nav.container];
const inside = insideOf(cont); const c = s.nav.innerCam ?? arrivalCamera(contentOf(inside), VP); return { ...s, nav: undefined, minimats: inside.minimats, notes: inside.notes, camX: c.x, camY: c.y, zoom: c.zoom }; })();
  const { px: A } = await render(before);
  const sd = sdClip(nav.clip);
  const MARGIN = 3;
  let same = 0;
  let sameMax = 0;
  let other = 0;
  let otherDiff = 0;
  const dbg = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const dist = sd(x + 0.5, y + 0.5);
    const d = delta(A, B, o);
    const mustMatch = sc.continuity === "enter" ? dist > MARGIN : dist < -MARGIN;
    const isOther = sc.continuity === "enter" ? dist < -MARGIN : dist > MARGIN;
    if (mustMatch) { same++; if (d > sameMax) sameMax = d; if (d > 0 && process.env.ORACLE_DEBUG) dbg.push([x, y, d, A[o], A[o + 1], A[o + 2], B[o], B[o + 1], B[o + 2]]); } else if (isOther) { other++; if (d > 4) otherDiff++; }
  }
  if (dbg.length) { const xs = dbg.map((v) => v[0]);
const ys = dbg.map((v) => v[1]); console.log(`      debug: ${dbg.length} px, x ${Math.min(...xs.slice(0, 50000))}–${Math.max(...xs.slice(0, 50000))}, y ${Math.min(...ys.slice(0, 50000))}–${Math.max(...ys.slice(0, 50000))}; first ${dbg.slice(0, 4).map((v) => v.join(",")).join(" | ")}`); }
  const ok = sameMax === 0 && (other === 0 || otherDiff > 0 || sc.continuity === "enter");
  console.log(`  ${ok ? "PASS" : "FAIL"}  continuity ${sc.continuity.padEnd(5)} ${sc.name.padEnd(22)} ${sc.continuity === "enter" ? "outside" : "inside "} the face maxΔ ${sameMax}/255 over ${same.toLocaleString()} px · ${other === 0 ? "the face covers the view" : `${sc.continuity === "enter" ? "inside" : "outside"} differs on ${otherDiff.toLocaleString()} of ${other.toLocaleString()} px`}`);
  return ok;
}

/**
 * PORTAL.md §2.4 / MINIMAT.md §3, as pixels. An ENTER at p = 0 renders the SAME FRAME as the rest before the cut — the whole
 * attachment, byte for byte: the departed desk around the face and the arriving desk through it, whose first frame is the live
 * inside's last. From the far LOD (`enter-far`, a face under the gate) the inside's mat comes in whole at the cut over the face's
 * own lattice and the chips are redrawn over it — the same lattice by the same lamp, the same chips: within 2/255. An EXIT before
 * its landing fade (p 0.5) IS the rest frame under the flying camera, outside the face's rim band and the objects over the mini mat.
 */
async function portalCut(sc) {
  const s = sc.scene;
  const { px: B, nav, portals } = await render(s);
  const cam = sc.cut.startsWith("enter") ? { x: s.camX, y: s.camY, zoom: s.zoom } : nav.cam;
  const rest = { ...s, nav: undefined, camX: cam.x, camY: cam.y, zoom: cam.zoom, ...(sc.cut === "exit" ? { lodZoom: nav.f.c1.zoom } : {}) };
  const { px: A, portals: restPortals } = await render(rest);
  const sd = sdClip(nav.clip);
  const rim = sc.cut === "exit" ? 3 : 0;
  // EXIT: the departed inside draws OVER the whole parent until the landing fade — the parent's objects over the mini mat's face
  // (a note of the desk lying on it) are under the inside now, over it at rest; they appear through the fade (Q-e). Stepped round.
  const over = sc.cut === "exit" ? notesOf(s.notes).map((p) => p.geometry) : [];
  const pxScale = 1 / (cam.zoom * VIEW.dpr);
  const covered = (x, y) => { const wx = (x + 0.5) * pxScale + cam.x;
const wy = (y + 0.5) * pxScale + cam.y; return over.some((G) => sdPaper(G, wx, wy) < shadowReach(G) + 3 * pxScale); };
  let max = 0;
  let n = 0;
  let checked = 0;
  let excluded = 0;
  const dbg = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (rim && (Math.abs(sd(x + 0.5, y + 0.5)) <= rim || (sd(x + 0.5, y + 0.5) < 0 && covered(x, y)))) { excluded++; continue; }
    checked++;
    const d = delta(A, B, o);
    if (d > max) max = d; if (d > 0) n++;
    if (d > 0 && process.env.ORACLE_DEBUG && dbg.length < 200000) dbg.push([x, y, d]);
  }
  if (dbg.length) { let x0 = 1e9;
let x1 = -1;
let y0 = 1e9;
let y1 = -1; for (const [x, y] of dbg) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } console.log(`      debug: bbox (${x0},${y0})–(${x1},${y1}); face ${JSON.stringify(nav.clip)}; first ${dbg.slice(0, 3).map((v) => v.join(",")).join(" | ")}`); writeFileSync(resolve(results, `debug-${sc.name}-flight.rgba`), B); writeFileSync(resolve(results, `debug-${sc.name}-rest.rgba`), A); }
  const tol = sc.cut === "enter-far" ? 2 : 0;
  // the mini mat flown into: past the gate at rest for a live cut, under it for the far one
  const cont = s.minimats[s.nav.container];
  const contView = insideView(matGeometry(cont), contentOf(insideOf(cont)), { x: s.camX, y: s.camY, zoom: s.zoom }, VP, FIT, s.portalGate ?? PORTAL_GATE);
  const ok = max <= tol && (sc.cut === "enter-far" ? contView.presence === 0 : sc.cut === "enter" ? contView.presence === 1 : restPortals >= 1);
  console.log(`  ${ok ? "PASS" : "FAIL"}  cut        ${sc.cut.padEnd(9)} ${sc.name.padEnd(20)} ${sc.cut.startsWith("enter") ? "the flight's first frame vs the rest before it" : `the flight at p ${s.nav.p} vs the rest under its camera (${excluded.toLocaleString()} px of rim and objects over the face stepped round)`}: maxΔ ${max}/255 (${n.toLocaleString()} px differ) over ${checked.toLocaleString()} px, tolerance ${tol} · the rest frame has ${restPortals} live inside${restPortals === 1 ? "" : "s"}, the flight frame ${portals}`);
  return ok;
}

/** PORTAL.md §10, as pixels — the CHAIN: nothing at depth 2 may change a pixel outside the depth-1 faces (and inside them it does). */
async function chainCheck(sc) {
  const s = sc.scene;
  // the inner mini mats taken away, the inside's bounds kept — so its arrival, and the border's ruler that reads it, do not move
  const strip = (m) => ({ ...m, inside: { ...insideOf(m), minimats: [], bounds: contentOf(insideOf(m)) } });
  const { px: A, portals } = await render(s);
  const { px: B, portals: control } = await render({ ...s, minimats: s.minimats.map(strip) });
  const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
  const faces = s.minimats.map((m) => sdClip(faceClip(matGeometry(m), cam)));
  let outside = 0;
  let outsideDiff = 0;
  let insideDiff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const d = delta(A, B, o);
    if (faces.some((f) => f(x + 0.5, y + 0.5) < 1)) { if (d > 0) insideDiff++; } else { outside++; if (d > 0) outsideDiff++; }
  }
  const ok = outsideDiff === 0 && insideDiff > 0 && portals > control;
  console.log(`  ${ok ? "PASS" : "FAIL"}  chain      ${sc.name.padEnd(24)} depth 2 changes nothing outside the depth-1 faces: ${outsideDiff} of ${outside.toLocaleString()} px differ (inside them ${insideDiff.toLocaleString()} do) · ${portals} live insides vs ${control} with the inner mini mats taken away`);
  return ok;
}

/**
 * MINIMAT.md §3, as pixels — SEALED: a mini mat is opaque, face and all; nothing of the desk under it shows. The same scene with
 * the ROOT's mat dyed another colour (the insides keep theirs) must change no pixel inside any mini mat's sheet (1 device px in
 * from its edge) that no object of the desk lies over.
 */
async function sealedCheck(sc) {
  const s = sc.scene;
  const { px: A } = await render(s);
  const { px: B } = await render(s, { rootGround: [0.9, 0.2, 0.3] });
  const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
  const pxScale = 1 / (cam.zoom * VIEW.dpr);
  const mats = s.minimats.map(matGeometry);
  const notes = notesOf(s.notes).map((p) => p.geometry);
  let inside = 0;
  let leaked = 0;
  let outside = 0;
  let dyed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const wx = (x + 0.5) * pxScale + cam.x;
    const wy = (y + 0.5) * pxScale + cam.y;
    if (notes.some((G) => sdPaper(G, wx, wy) < shadowReach(G) + 3 * pxScale)) continue;
    const d = Math.min(...mats.map((G) => sdMiniMat(G, wx, wy)));
    if (d < -pxScale) { inside++; if (delta(A, B, o) > 0) leaked++; } else if (d > 30) { outside++; if (delta(A, B, o) > 4) dyed++; }
  }
  const ok = leaked === 0 && dyed > outside * 0.9;
  console.log(`  ${ok ? "PASS" : "FAIL"}  sealed     ${sc.name.padEnd(24)} the desk dyed under the mini mats changes ${leaked} of ${inside.toLocaleString()} px inside their sheets (and ${dyed.toLocaleString()} of ${outside.toLocaleString()} of the bare desk)`);
  return ok;
}

/**
 * MINIMAT.md §5, as pixels — the LOD's seam: the face's own drawing (the far LOD: the inside's lattice as the live inside would
 * draw it) against the live inside's mat, on a mini mat past the gate — its face, away from every object and chip: they must be
 * the same lattice by the same lamp (mean under 0.5/255, 99.9 % within 2), so a live inside coming in whole over the far LOD is
 * seen as its objects arriving, nothing else.
 */
async function lodCheck(sc) {
  const s = sc.scene;
  const { px: A } = await render(s);
  const { px: B } = await render({ ...s, portals: false });
  const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
  const pxScale = 1 / (cam.zoom * VIEW.dpr);
  const m = s.minimats[0];
  const G = matGeometry(m);
  const F = faceOf(G);
  const view = insideView(G, contentOf(insideOf(m)), cam, VP, FIT, s.portalGate ?? PORTAL_GATE);
  const kids = childrenOf(insideOf(m)).map((c) => chipOf(c, view.M));
  const deskNotes = notesOf(s.notes).map((p) => p.geometry);
  let n = 0;
  let sum = 0;
  let over2 = 0;
  let max = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = (x + 0.5) * pxScale + cam.x;
    const wy = (y + 0.5) * pxScale + cam.y;
    if (wx < F.x + 3 * pxScale || wx > F.x + F.width - 3 * pxScale || wy < F.y + 3 * pxScale || wy > F.y + F.height - 3 * pxScale) continue;
    if (kids.some((c) => Math.abs(wx - c.centre[0]) < c.half[0] + c.half[1] * 0.2 + 12 && Math.abs(wy - c.centre[1]) < c.half[1] + c.half[0] * 0.2 + 12)) continue;
    if (deskNotes.some((Gn) => sdPaper(Gn, wx, wy) < shadowReach(Gn) + 3 * pxScale)) continue;
    const o = (y * W + x) * 4;
    const d = delta(A, B, o);
    n++; sum += d; if (d > 2) over2++; if (d > max) max = d;
  }
  const mean = sum / Math.max(n, 1);
  const ok = n > 10000 && mean < 0.5 && over2 <= n * 0.001;
  console.log(`  ${ok ? "PASS" : "FAIL"}  lod        ${sc.name.padEnd(24)} the face's own lattice vs the live inside's mat over ${n.toLocaleString()} px of bare face: mean ${mean.toFixed(3)}/255, max ${max}, ${over2} px over 2`);
  return ok;
}

/**
 * MINIMAT.md §4, as pixels — the LIGHT: a mini mat's face takes the dapple of the desk it lies on. Against the bare desk (no
 * mini mat) and with the gobo on and off, the face's SHADE (lit ÷ unlit luminance) follows the desk's own shade at the same
 * pixels (their correlation over the face ≥ 0.9); the control — the inside under its own lamp, the old portal's miniature
 * desk with a miniature canopy — does not.
 */
async function lightCheck(sc) {
  const s = sc.scene;
  const off = { ...s, mat: { ...s.mat, opacity: 0 } };
  const [{ px: MA }, { px: MB }, { px: DA }, { px: DB }, { px: OA }] = [await render(s), await render(off), await render({ ...s, minimats: [] }), await render({ ...off, minimats: [] }), await render(s, { ownLitInsides: true })];
  const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
  const pxScale = 1 / (cam.zoom * VIEW.dpr);
  const F = faceOf(matGeometry(s.minimats[0]));
  const shade = (A, B, o) => lum(A, o) / Math.max(lum(B, o), 1);
  const xs = [];
  const ys = [];
  const zs = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const wx = (x + 0.5) * pxScale + cam.x;
    const wy = (y + 0.5) * pxScale + cam.y;
    if (wx < F.x + 4 || wx > F.x + F.width - 4 || wy < F.y + 4 || wy > F.y + F.height - 4) continue;
    const o = (y * W + x) * 4;
    xs.push(shade(DA, DB, o)); ys.push(shade(MA, MB, o)); zs.push(shade(OA, MB, o));
  }
  const corr = (a, b) => { const n = a.length;
const ma = a.reduce((p, v) => p + v, 0) / n;
const mb = b.reduce((p, v) => p + v, 0) / n; let c = 0;
let va = 0;
let vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb + 1e-12); };
  const host = corr(xs, ys);
  const own = corr(xs, zs);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY; for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const spread = hi - lo;
  const ok = spread > 0.2 && host >= 0.9 && own < host - 0.2;
  console.log(`  ${ok ? "PASS" : "FAIL"}  light      ${sc.name.padEnd(24)} over ${xs.length.toLocaleString()} face px (the desk's shade spans ${spread.toFixed(2)}): the face's shade follows the desk's at r = ${host.toFixed(3)}; lit by its own lamp instead, r = ${own.toFixed(3)}`);
  return ok;
}

/**
 * MAT.md — the NIGHT, as pixels. The same mat under the two lights: (1) the day's chain is untouched by the night's presence;
 * (2) the night is darker than the day on every pixel, never under Eigengrau less the snow; (3) the Purkinje shift: bluer, the
 * dapples keeping more green than the shadows, the moonlit quarter near half the day's luminance in linear light.
 */
async function nightCheck(sc) {
  const s = sc.scene;
  const { px: N, theme: night } = await render(s);
  const { px: D } = await render({ ...s, theme: "light" });
  const { px: D2 } = await render(s, { theme: { ...THEMES.dark, matLight: DAY_LIGHT } });
  const LIN = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
  const lin = (o, P) => 0.2126 * LIN[P[o]] + 0.7152 * LIN[P[o + 1]] + 0.0722 * LIN[P[o + 2]];
  const eig = night.matLight.eigengrau.map((v) => Math.round(linearToSrgb(v) * 255));
  const floor = eig.map((v) => v - Math.ceil((night.matLight.snow * 255) / 2) - 1);
  let n = 0;
  let dayDiff = 0;
  let notDarker = 0;
  let underFloor = 0;
  let brN = 0;
  let brD = 0;
  const hist = new Uint32Array(256);
  const dayL = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4; n++;
    if (D[o] !== D2[o] || D[o + 1] !== D2[o + 1] || D[o + 2] !== D2[o + 2]) dayDiff++;
    const ld = lum(D, o); dayL[i] = ld; hist[Math.min(255, Math.round(ld))]++;
    if (lum(N, o) >= ld) notDarker++;
    if (N[o] < floor[0] || N[o + 1] < floor[1] || N[o + 2] < floor[2]) underFloor++;
    brN += N[o + 2] / Math.max(N[o], 1); brD += D[o + 2] / Math.max(D[o], 1);
  }
  const q = (frac) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= frac * n) return i; } return 255; };
  const lo = q(0.25);
  const hi = q(0.75);
  const S = { gr: 0, br: 0, n: 0 };
  const M = { gr: 0, br: 0, n: 0, lum: 0, day: 0 };
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const ld = dayL[i];
    const set = ld <= lo ? S : ld >= hi ? M : null;
    if (!set) continue;
    set.gr += N[o + 1] - N[o]; set.br += N[o + 2] - N[o]; set.n++;
    if (set === M) { M.lum += lin(o, N); M.day += lin(o, D); }
  }
  const greenMoon = M.gr / Math.max(M.br, 1);
  const greenShadow = S.gr / Math.max(S.br, 1);
  const litOverDay = M.lum / Math.max(M.day, 1e-9);
  const ok = dayDiff === 0 && notDarker === 0 && underFloor === 0 && brN > brD && greenMoon > greenShadow && litOverDay > 0.35 && litOverDay < 0.65;
  console.log(`  ${ok ? "PASS" : "FAIL"}  night      ${sc.name.padEnd(24)} the day's chain with the night beside it: ${dayDiff} of ${n.toLocaleString()} px differ · darker by night everywhere (${notDarker} not), none under Eigengrau (${underFloor}) · B/R ${(brD / n).toFixed(3)} → ${(brN / n).toFixed(3)} · green kept in the Moon ${greenMoon.toFixed(2)} vs the shadow ${greenShadow.toFixed(2)} · the Moon's quarter at ${litOverDay.toFixed(2)}× the day`);
  return ok;
}

/**
 * RULER.md, as pixels. The same still with the rulers on and off: (1) the print changes nothing outside its own region; (2) at
 * every label the CPU mirror lays out, a major tick stands on the band's inner line at the site, none a quarter pitch along;
 * (3) the label's box holds ink; on both bands. Scenes are chosen with every presence at 0 or 1.
 */
async function rulerCheck(sc) {
  const s = sc.scene;
  const d = VIEW.dpr;
  const { px: A, theme } = await render(s);
  const { px: B } = await render({ ...s, ruler: undefined });
  const law = { ...DEFAULT_MAT_CONFIG.ruler, ...(s.ruler ?? {}) };
  const m = law.margin * d;
  const band = law.band * d;
  const inner = m + band;
  const right = (VIEW.cssW - law.margin) * d;
  const bottom = (VIEW.cssH - law.margin) * d;
  const near = (v, line) => Math.abs(v - line) <= 2 + d;
  const printed = (x, y) => {
    const X = x + 0.5;
    const Y = y + 0.5;
    if ((near(X, m) || near(X, right)) && Y >= m - 3 && Y <= bottom + 3) return true;
    if ((near(Y, m) || near(Y, bottom)) && X >= m - 3 && X <= right + 3) return true;
    if (near(X, inner) && Y >= m - 3 && Y <= bottom + 3) return true;
    if (near(Y, inner) && X >= m - 3 && X <= right + 3) return true;
    if (Y >= m - 3 && Y <= inner + 3 && X >= m - 3 && X <= right + 3) return true;
    if (X >= m - 3 && X <= inner + 3 && Y >= m - 3 && Y <= bottom + 3) return true;
    return false;
  };
  let outside = 0;
  let outsideMax = 0;
  let inside = 0;
  let insideDiff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const dd = delta(A, B, o);
    if (printed(x, y)) { inside++; if (dd > 0) insideDiff++; } else { outside++; if (dd > outsideMax) outsideMax = dd; }
  }
  const L = (P, x, y) => lum(P, (y * W + x) * 4);
  const view = { camX: s.camX, camY: s.camY, zoom: s.zoom, width: VIEW.cssW, height: VIEW.cssH };
  const levels = rulerLevels(lod(view), s.zoom, law, Math.max(labelReach(s.camX, s.zoom, VIEW.cssW), labelReach(s.camY, s.zoom, VIEW.cssH)));
  const glyphs = mat.glyphs;
  const texel = glyphs.scale / d;
  const capBottom = law.text.top * d + glyphs.cap / texel;
  const majorTop = band - law.tick[2] * d;
  const mediumTop = band - law.tick[1] * d;
  const probeAcross = Math.floor(Math.max(capBottom + 2, majorTop + 2, (majorTop + mediumTop) / 2));
  let ticks = 0;
  let ticksOff = 0;
  let controls = 0;
  let controlsOff = 0;
  let labels = 0;
  let labelsOff = 0;
  const INK = theme.name === "dark" ? 3 : 20;
  for (const axis of ["x", "y"]) {
    const list = labelsAlong(axis === "x" ? s.camX : s.camY, s.zoom, axis === "x" ? VIEW.cssW : VIEW.cssH, levels, law);
    for (let i = 0; i < list.length; i++) {
      const Lb = list[i];
      const at = Math.round(Lb.at * d);
      if (Lb.alpha < 1) continue;
      const px = (along, across) => (axis === "x" ? [along, across] : [across, along]);
      const [tx, ty] = px(at, m + probeAcross);
      ticks++; if (L(A, tx, ty) - L(B, tx, ty) < INK) ticksOff++;
      if (i + 1 < list.length) {
        const q = Math.round((Lb.at + (list[i + 1].at - Lb.at) * 0.25) * d);
        const [cx, cy] = px(q, m + probeAcross);
        controls++; if (Math.abs(L(A, cx, cy) - L(B, cx, cy)) > 0) controlsOff++;
      }
      const x0 = at + Math.round(law.text.gap * d);
      const x1 = x0 + Math.ceil(Lb.text.length * glyphs.advance / texel);
      if (x1 > (axis === "x" ? right : bottom)) continue;
      const y0 = Math.floor(m + law.text.top * d);
      const y1 = Math.ceil(y0 + glyphs.cap / texel);
      let best = 0;
      for (let along = x0; along < x1; along++) for (let across = y0; across <= y1; across++) { const [X, Y] = px(along, across); if (X < 0 || Y < 0 || X >= W || Y >= H) continue; best = Math.max(best, L(A, X, Y) - L(B, X, Y)); }
      labels++; if (best < INK) labelsOff++;
    }
  }
  const ok = outsideMax === 0 && insideDiff > 0 && ticksOff === 0 && controlsOff === 0 && labelsOff === 0 && ticks > 4;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ruler      ${sc.name.padEnd(24)} outside the print maxΔ ${outsideMax}/255 over ${outside.toLocaleString()} px (inside ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} differ) · ${ticks} major ticks at the mirror's sites (${ticksOff} missing), ${controls} quarter-pitch controls clean (${controlsOff} inked) · ${labels} labels hold ink (${labelsOff} empty) · ${theme.name}`);
  return ok;
}

/**
 * STICKY.md, as pixels. The same still with its notes and without: (1) beyond every sheet and its shadow's reach (+3 device px)
 * byte for byte; (2) inside the sheets most pixels differ; (3) the shadow band only darkens; (4) with no light on the desk
 * (`token`) the flat strip of an unwritten sheet is the note token's bytes within the fibre (a configured byte is the drawn byte).
 */
async function paperCheck(sc) {
  const s = sc.scene;
  const d = VIEW.dpr;
  const { px: A } = await render(s);
  const { px: B } = await render({ ...s, notes: [] });
  const geoms = s.notes.map(noteGeometry);
  const pxScale = 1 / (s.zoom * d);
  const token = surface("note").map((v) => Math.round(v * 255));
  let outside = 0;
  let outsideMax = 0;
  let inside = 0;
  let insideDiff = 0;
  let shadowN = 0;
  let shadowBright = 0;
  let shadowDark = 0;
  let strip = 0;
  let stripOff = 0;
  let stripMax = 0;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const wx = (X + 0.5) * pxScale + s.camX;
    const wy = (Y + 0.5) * pxScale + s.camY;
    const o = (Y * W + X) * 4;
    const dd = delta(A, B, o);
    let sdMin = Number.POSITIVE_INFINITY;
    let reachMin = Number.POSITIVE_INFINITY;
    let gi = -1;
    for (let i = 0; i < geoms.length; i++) { const sd = sdPaper(geoms[i], wx, wy); if (sd < sdMin) { sdMin = sd; gi = i; } reachMin = Math.min(reachMin, sd - shadowReach(geoms[i])); }
    if (reachMin > 3 * pxScale) { outside++; if (dd > outsideMax) outsideMax = dd; continue; }
    if (sdMin < -1.5 * pxScale) {
      inside++; if (dd > 0) insideDiff++;
      if (sc.token && !s.notes[gi].asset) {
        const G = geoms[gi];
        const [qx, qy] = localOf(G, wx, wy);
        const flat = -G.half[1] + G.glue * 2 * G.half[1];
        if (qy < flat - 2 && qy > -G.half[1] + 3 && Math.abs(qx) < G.half[0] - 3) { strip++; const dv = Math.max(Math.abs(A[o] - token[0]), Math.abs(A[o + 1] - token[1]), Math.abs(A[o + 2] - token[2])); if (dv > stripMax) stripMax = dv; if (dv > 6) stripOff++; }
      }
      continue;
    }
    if (sdMin > 1.5 * pxScale) { shadowN++; const la = lum(A, o);
const lb = lum(B, o); if (la > lb + 1) shadowBright++; if (la < lb - 2) shadowDark++; }
  }
  const ok = outsideMax === 0 && insideDiff > inside * 0.5 && shadowBright === 0 && shadowDark > 0 && (!sc.token || (stripOff === 0 && strip > 100));
  console.log(`  ${ok ? "PASS" : "FAIL"}  paper      ${sc.name.padEnd(24)} beyond the sheets and their shadows maxΔ ${outsideMax}/255 over ${outside.toLocaleString()} px · inside ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} differ · the shadow band ${shadowDark.toLocaleString()} of ${shadowN.toLocaleString()} darker, ${shadowBright} brighter${sc.token ? ` · the flat strip is the token's byte within ${stripMax}/255 over ${strip.toLocaleString()} px (${stripOff} off)` : ""}`);
  return ok;
}

// ---------------------------------------------------------------- run

const only = process.env.ORACLE_ONLY ? new RegExp(process.env.ORACLE_ONLY) : null;
const scenes = only ? ORACLE_SCENES.filter((sc) => only.test(sc.name)) : ORACLE_SCENES;
let failed = 0;
for (const sc of scenes) {
  const t1 = performance.now();
  const { px, nav, portals, stats } = await render(sc.scene);
  writeFileSync(resolve(results, `oracle-${sc.name}.rgba`), px);
  const flight = nav ? ` · ${nav.f.kind} p ${sc.scene.nav.p}${nav.f.frozen ? " FROZEN" : ""} · in ${nav.pres.incoming.opacity.toFixed(2)}${nav.pres.incoming.objects !== undefined ? ` (objects ${nav.pres.incoming.objects.toFixed(2)})` : ""} out ${nav.pres.outgoing.opacity.toFixed(2)}` : "";
  console.log(`${sc.name.padEnd(28)} ${(sc.scene.minimats ?? []).length} mini mats · ${(sc.scene.notes ?? []).length} notes · ${portals} live insides · ${sc.scene.theme.padEnd(5)} · ${(performance.now() - t1).toFixed(0)} ms · k0 ${stats.k0}${stats.wind ? " · wind" : ""}${flight}`);
  if (sc.baseline && process.env.BASELINE_DIR && !baselineCheck(sc, px)) failed += 1;
}
for (const sc of scenes) if (sc.continuity) { if (!(await continuity(sc))) failed += 1; }
for (const sc of scenes) if (sc.cut) { if (!(await portalCut(sc))) failed += 1; }
for (const sc of scenes) if (sc.chain) { if (!(await chainCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.sealed) { if (!(await sealedCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.lod) { if (!(await lodCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.light) { if (!(await lightCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.night) { if (!(await nightCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.ruler) { if (!(await rulerCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.paper) { if (!(await paperCheck(sc))) failed += 1; }
if (failed) { console.log(`${failed} check(s) FAILED`); process.exitCode = 1; }
device.destroy();
