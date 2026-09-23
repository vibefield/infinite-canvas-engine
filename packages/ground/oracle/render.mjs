// The ground rendered HEADLESS in Node on raw WebGPU (Dawn via the `webgpu`
// package), from the same TypeScript passes and the same .wgsl files the
// browser build uses. No canvas: the colour target is a readable Target.
//
//   node test/oracle/render.mjs           → results/oracle-<scene>.rgba for ab.mjs oracle, plus the flight continuity checks
//   node test/oracle/render.mjs mirror    → the frame shader vs the CPU sdf mirror, per pixel
//
// If this matches Chrome, the engine is host-agnostic and the pixel oracle
// needs no browser. A nav scene draws BOTH frames of a flight through the
// ground's own `drawFrame`, from the same flight geometry the lab computes
// (src/nav/flight.ts) — and the continuity checks pin design-006's promise:
// at the cut, nothing outside the portal moved by a pixel.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { create, globals } from "webgpu";
import { ORACLE_SCENES, VIEW } from "./scenes.mjs";
import { acquire } from "../src/engine/device.ts";
import { beginPass, Target, readback } from "../src/engine/target.ts";
import { Field } from "../src/field/field.ts";
import { fieldShaders, FIELD_SHADER_FILES } from "../src/field/shaders.ts";
import { DEFAULT_FIELD_CONFIG, OPEN_RANGE } from "../src/field/layout.ts";
import { DEFAULT_MAT_CONFIG, HERO_MATRIX } from "../src/packs/mat/layout.ts";
import { cuttingMat, MAT_GLYPH, matPassOf } from "../src/packs/mat/index.ts";
import { needleGlyph } from "../src/packs/needle/index.ts";
import { vfFrame, vfSectionOf } from "../src/packs/vf-frame/index.ts";
import { MATERIAL } from "../src/card/geometry.ts";
import { NO_PART, shellProgram } from "../src/card/program.ts";
import { FramePass } from "../src/card/frame-pass.ts";
import { frameShaders, FRAME_SHADER_FILES } from "../src/card/shaders.ts";
import { portalContent, testResidency, TEST_PLATE } from "../src/card/content.ts";
import { sdInner as sdInnerOf, pick } from "../src/packs/vf-frame/sdf.ts";
import { FillPass, fillShaders, FILL_SHADER_FILES } from "../src/nav/fill-pass.ts";
import { drawFrame, prepareFrame, SlotPool } from "../src/compose/ground.ts";
import { soupOverlay, soupShaders, SOUP_SHADER_FILES } from "../src/compose/overlay.ts";
import { SoupBuilder } from "../src/compose/soup.ts";
import { arrivalCamera, boundsOf, departedCamera, enterFlight, exitFlight, FIT, flightAt, flightOpacity } from "../src/nav/flight.ts";
import { clipOf, faceRadius, faceRect, FOLDER_FACE, PORTAL_CAP, PORTAL_GATE, portalOf } from "../src/nav/portal.ts";
import { newMotion, pinMotion, toMotion } from "../src/card/motion.ts";
import { STYLES } from "../src/packs/vf-frame/sheet.ts";
import { sdFrame, sdInner, sdOuter, sdRoundBox } from "../src/packs/vf-frame/sdf.ts";
import { irradiance } from "../src/packs/vf-frame/heat.ts";
import { LINES } from "../src/theme.ts";
import { THEMES, surface } from "./fixtures/vf-theme.ts";
import { DAY_LIGHT, linearToSrgb, srgbToLinear } from "../src/packs/mat/night.ts";

Object.assign(globalThis, globals);   // GPUBufferUsage & friends, which the browser has for free
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");   // packages/ground
const results = resolve(root, "oracle/results");
mkdirSync(results, { recursive: true });
const wgsl = (rel) => readFileSync(resolve(root, "shaders", rel), "utf8");
const texts = (files) => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, wgsl(f)]));
const FORMAT = "rgba8unorm";

const t0 = performance.now();
const gpu = await acquire({ gpu: create([]), label: "oracle" });
console.log(`device ${(performance.now() - t0).toFixed(0)} ms · ${gpu.info.description || gpu.info.vendor}`);
const device = gpu.device;
// The engine's sets from disk, plus the packs the product registers (design-014): the needle and the mat as grids, VibeField's frame as the card program.
const fieldSet = fieldShaders(texts(FIELD_SHADER_FILES));
const pack = vfFrame();
const field = await Field.create(device, FORMAT, { ...fieldSet, glyphs: [...fieldSet.glyphs, needleGlyph, cuttingMat] });
const frames = await FramePass.create(device, FORMAT, frameShaders(texts(FRAME_SHADER_FILES)), pack);
// The engine's own card, the SHELL, on the same set — the scenes that say `program: "shell"` draw through it (design-014).
const shellFrames = await FramePass.create(device, FORMAT, frameShaders(texts(FRAME_SHADER_FILES)), shellProgram);
/** The card program the scene being rendered resolves through — `setOf` reads it. */
let program = pack;
const fill = await FillPass.create(device, FORMAT, fillShaders(texts(FILL_SHADER_FILES)));
// The mat's assets, the same bytes the lab fetches.
// The engine's assets (assets/: the blue noise) and the HOST's (oracle/fixtures/assets/: the gobo plates, the content-test plate — the product's look, a fixture here) — raw rgba8 either way.
const bytesOf = (dir, rel) => { const b = readFileSync(resolve(root, dir, rel)); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); };
const raw = (rel) => bytesOf("assets", rel);
const hostRaw = (rel) => bytesOf("oracle/fixtures/assets", rel);
const matPass = matPassOf(field);
matPass.setPlate("c", hostRaw("gobo-c.rgba")); matPass.setPlate("b", hostRaw("gobo-b.rgba")); matPass.setNoise(raw("blue-noise.rgba"));
// The content term's test residency — the same bytes, layers and uvs the lab builds (card/content.ts).
const plateBytes = hostRaw("content-test.rgba");
const residency = testResidency(device, plateBytes);
frames.setPages(residency.pagesView);
// The OVERLAYS (design-013 C1): the wires `under` the cards and the guides `over` them, registered on
// every slot set. A scene with no `overlays` gives them no data, so they prepare nothing and draw
// nothing — which is why the 47 scenes that predate the seam render byte for byte as they did.
const soupSet = soupShaders(texts(SOUP_SHADER_FILES));
const overlayPrograms = [soupOverlay("wires", "under", soupSet), soupOverlay("guides", "over", soupSet)];
const overlays = await Promise.all(overlayPrograms.map(async (o) => ({ name: o.name, stage: o.stage, pass: await o.create(device, FORMAT) })));
// The slots beyond the root — the departed frame's, the live portals' — from the same pool the ground keeps.
const rootSlot = { field, frames, fill, overlays };
const pool = new SlotPool(rootSlot);
const shellSlot = { field, frames: shellFrames, fill, overlays };
const shellPool = new SlotPool(shellSlot);
const W = VIEW.cssW * VIEW.dpr;
const H = VIEW.cssH * VIEW.dpr;
const out = new Target(device, { format: FORMAT, label: "oracle", readable: true }, W, H);
const VP = { width: VIEW.cssW, height: VIEW.cssH };

const rectOf = (c) => ({ x: c.x - c.w / 2, y: c.y - c.h / 2, width: c.w, height: c.h });
/** A folder's FACE — its content rect inset like the product folder's (nav/portal.ts FOLDER_FACE; the lab's `faceOf`) — and the hole cut to it (PORTAL.md §10). */
const faceOf = (c) => faceRect(rectOf(c), FOLDER_FACE);
const faceR = (c) => faceRadius(rectOf(c), FOLDER_FACE, c.r);
const portalFaceOf = (c) => { const K = faceOf(c); return { cx: K.x + K.width / 2, cy: K.y + K.height / 2, hx: K.width / 2, hy: K.height / 2, r: faceR(c) }; };
const viewOf = (cam) => ({ camX: cam.x, camY: cam.y, zoom: cam.zoom, width: VIEW.cssW, height: VIEW.cssH, dpr: VIEW.dpr });

/** A frame's cards resolved at rest — surfaces, motion, geometry. Exactly what lab/main.ts does per frame, minus the DOM. */
function setOf(specs, style, glyph) {
  pack.style = style;   // the pack resolves with the scene's style; a keyless resolve is a still — the lock closed, the buttons at rest
  const cards = specs.map((c) => ({ ...c, surface: surface(c.surface ?? "card"), motion: pinMotion(newMotion(c.selected ?? false), c) }));
  const geoms = cards.map((c) => program.resolve({ card: { centre: [c.x, c.y], contentHalf: [c.w * 0.5, c.h * 0.5], radius: c.r }, motion: toMotion(c.motion), material: MATERIAL, dt: 0, part: NO_PART }));
  return { cards, geoms, glyph };
}
const sourcesOf = (set, cam) => set.geoms.map((G, i) => ({ cx: (G.centre[0] - cam.x) * cam.zoom, cy: (G.centre[1] - cam.y) * cam.zoom, hx: G.half[0] * cam.zoom, hy: G.half[1] * cam.zoom, r: G.outerR * cam.zoom, strength: set.cards[i].strength }));
/** The frames of a set in paint order; a container in `holes` (by index) is drawn as a HOLE cut to its face over its live portal (content.ts `portalContent`). */
const framesOf = (set, opts, holes = new Set()) => set.geoms.map((geometry, i) => ({ geometry, surface: opts.surface ?? set.cards[i].surface, content: holes.has(i) ? portalContent(portalFaceOf(set.cards[i])) : residency.content(set.cards[i].content ?? "plate") }));
// a nav scene's container is a folder; with `portals` it carries the flight's child as its inside, so the REST frame shows the live portal
const withFolder = (s) => s.cards.map((c, i) => (i === s.nav.container ? { ...c, surface: "folder", ...(s.portals ? { inside: s.nav.child } : {}) } : c));

/**
 * The live portals of a set's folders under `cam` (PORTAL.md; the lab's `portalsOf`): a card with an `inside`
 * whose face passes the gate gets a slot — its inside resolved at rest under `portalOf`'s camera — and through
 * it, its own folders' portals. Returns the slot inputs and the container indices that are holes.
 */
function portalsOf(specs, set, cam, s, style, exclude = -1, depth = 0) {
  const inputs = [];
  const holes = new Set();
  if (!s.portals || depth > 4) return { inputs, holes };
  const gate = s.portalGate ?? PORTAL_GATE;
  const cands = [];
  specs.forEach((c, i) => {
    if (!c.inside || i === exclude) return;
    const live = portalOf(faceOf(c), faceR(c), boundsOf(c.inside.cards.map(rectOf)), cam, VP, FIT, gate);
    if (live) cands.push({ i, live });
  });
  cands.sort((a, b) => b.live.clip.hx * b.live.clip.hy - a.live.clip.hx * a.live.clip.hy);
  for (const { i, live } of cands.slice(0, PORTAL_CAP)) {   // the cap, largest faces first — the lab's rule
    const inside = specs[i].inside;
    const insideSet = setOf(inside.cards, style, inside.glyph);
    const sub = portalsOf(inside.cards, insideSet, live.cam, s, style, -1, depth + 1);
    holes.add(i);
    inputs.push({
      view: { ...viewOf(live.cam), box: live.box }, pointer: { x: 0, y: 0, on: false }, ext: { [MAT_GLYPH]: matOf(s) },
      ...(s.dress === false ? {} : { lodZoom: live.arrival.zoom }),   // dressed for its arrival (PORTAL.md §9)
      present: { opacity: live.presence, portal: live.clip },
      config: cfgFor(s, inside.glyph), sources: sourcesOf(insideSet, live.cam), frames: framesOf(insideSet, {}, sub.holes),
      ...(sub.inputs.length ? { portals: sub.inputs } : {}),
      at: i, plate: set.cards[i].surface,
    });
  }
  return { inputs, holes };
}

/** The flight a nav scene pins — the lab's setScene computes the same through nav/flight.ts. */
function navOf(s, style) {
  const cont = s.cards[s.nav.container];
  const K = faceOf(cont);
  const rootSpecs = withFolder(s);
  const rootSet = setOf(rootSpecs, style, s.glyph ?? "dot");
  const childSet = setOf(s.nav.child.cards, style, s.nav.child.glyph);
  const content = boundsOf(s.nav.child.cards.map(rectOf));
  const camScene = { x: s.camX, y: s.camY, zoom: s.zoom };
  let f;
  let arriving;
  let departed;
  let arrivingSpecs;
  let departedSpecs;
  if (s.nav.kind === "enter") {
    // from a live portal the flight starts at the portal's own camera — the cut is then bit for bit (PORTAL.md §2.4)
    const live = s.portals ? portalOf(K, cont.r, content, camScene, VP, FIT, s.portalGate ?? PORTAL_GATE) : null;
    f = enterFlight(K, content, camScene, VP, undefined, undefined, live?.cam); arriving = childSet; departed = rootSet; arrivingSpecs = s.nav.child.cards; departedSpecs = rootSpecs;
  } else { f = exitFlight(K, content, s.nav.innerCam ?? arrivalCamera(content, VP), camScene, VP); arriving = rootSet; departed = childSet; arrivingSpecs = rootSpecs; departedSpecs = s.nav.child.cards; }
  const cam = flightAt(f, s.nav.p, VP);
  const outCam = departedCamera(f, cam);
  const op = flightOpacity(f.kind, s.nav.p, f.frozen);
  // The portal lives in the PARENT frame: the departed one on enter, the arriving one on exit. A frozen flight has none — it is a dissolve.
  const clip = f.frozen ? null : clipOf(K, faceR(cont), f.kind === "enter" ? outCam : cam);
  const presentIn = { opacity: op.incoming, ...(clip && f.kind === "enter" ? { portal: clip } : {}) };
  const presentOut = { opacity: op.outgoing, ...(clip && f.kind === "exit" ? { portal: clip } : {}) };
  // an enter through a live portal is one tree through the container (`at`), the container a hole in the departed frame; an exit draws the inside over the whole parent (ground.ts)
  const at = clip && f.kind === "enter" ? s.nav.container : undefined;
  return { f, cam, outCam, clip, arriving, departed, arrivingSpecs, departedSpecs, presentIn, presentOut, order: f.kind === "enter" ? "under" : "over", at };
}
const matOf = (s) => ({ time: s.mat?.time ?? 0, goboTime: s.mat?.goboTime ?? 0, goboMatrix: HERO_MATRIX, noise: s.mat?.noise ?? [0, 0] });

/**
 * A scene's hand-built overlay soups (design-013 C1). The spec names the same
 * primitives the collectors emit — `rect` · `segment` · `polyline` · `disc`,
 * through the copied `SoupBuilder` — plus `tri`, a RAW triangle the builder has
 * no method for: the two windings D-C1.2's cull-none claim needs, appended to
 * the same arrays so they ride the same buffer and the same pipeline.
 */
function soupOf(spec) {
  const b = new SoupBuilder();
  const raw = [];
  for (const item of spec) {
    if (item.rect) b.rect(...item.rect);
    else if (item.segment) b.segment(...item.segment);
    else if (item.polyline) b.polyline(item.polyline[0], item.polyline[1], item.polyline[2]);
    else if (item.disc) b.disc(...item.disc);
    else if (item.tri) raw.push(item.tri);
    else throw new Error(`oracle: unknown soup primitive ${JSON.stringify(item)}`);
  }
  const built = b.build();
  if (raw.length === 0) return built;
  const n = built.vertexCount + raw.length * 3;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 4);
  positions.set(built.positions); colors.set(built.colors);
  raw.forEach((t, i) => {
    const c = t[6];
    for (let k = 0; k < 3; k++) {
      const v = built.vertexCount + i * 3 + k;
      positions[v * 3] = t[k * 2]; positions[v * 3 + 1] = t[k * 2 + 1]; positions[v * 3 + 2] = 0;
      for (let j = 0; j < 4; j++) colors[v * 4 + j] = c[j];
    }
  });
  return { positions, colors, vertexCount: n };
}
/** A scene's overlay inputs by name, in the ground's own shape. */
const soupsOf = (spec) => Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, soupOf(v)]));
/** The soups' triangles in DRAW order (wires `under` first, then guides `over`) — what the CPU raster composites. */
function trianglesOf(spec) {
  const out = [];
  for (const name of ["wires", "guides"]) {
    const soup = spec[name] === undefined ? null : soupOf(spec[name]);
    if (soup === null) continue;
    for (let t = 0; t < soup.vertexCount / 3; t++) {
      const p = [0, 1, 2].map((k) => [soup.positions[(t * 3 + k) * 3], soup.positions[(t * 3 + k) * 3 + 1]]);
      const c = [0, 1, 2, 3].map((k) => soup.colors[t * 3 * 4 + k]);
      // every primitive here is one colour per triangle; the raster below assumes it, so say so loudly
      for (let k = 1; k < 3; k++) for (let j = 0; j < 4; j++) {
        if (soup.colors[(t * 3 + k) * 4 + j] !== c[j]) throw new Error(`oracle: soup triangle ${t} of ${name} is not flat-coloured`);
      }
      out.push({ name, p, c });
    }
  }
  return out;
}
let cfgTheme = null;
function cfgFor(s, glyph, inkAlpha) {
  const theme = cfgTheme;
  const open = s.range === "open";
  return {
    ...DEFAULT_FIELD_CONFIG, glyph, reach: s.reach, halfLen: s.halfLen, ink: theme.fieldInk, inkAlpha: inkAlpha ?? s.inkAlpha ?? theme.fieldInkAlpha, fineSchedule: s.fine ?? "auto",
    dotRadius: open ? OPEN_RANGE : s.dotRadius ?? DEFAULT_FIELD_CONFIG.dotRadius,
    needleHalfLen: open ? OPEN_RANGE : s.needleHalfLen ?? DEFAULT_FIELD_CONFIG.needleHalfLen,
    needleHalfWidth: open ? OPEN_RANGE : s.needleHalfWidth ?? DEFAULT_FIELD_CONFIG.needleHalfWidth,
    fadeIn: s.fadeIn ?? DEFAULT_FIELD_CONFIG.fadeIn,
    ext: { [MAT_GLYPH]: { ...DEFAULT_MAT_CONFIG, gobo: { ...DEFAULT_MAT_CONFIG.gobo, opacity: s.mat?.opacity ?? DEFAULT_MAT_CONFIG.gobo.opacity, plate: s.mat?.plate ?? DEFAULT_MAT_CONFIG.gobo.plate } } },
  };
}

/**
 * Render one scene through the ground's own `prepareFrame` + `drawFrame` — the
 * root slot, its live portals (cards with an `inside`, when the scene says
 * `portals`), and a flight's departed slot through the container — exactly the
 * inputs the lab hands `ground.render()`.
 */
async function render(s, opts = {}) {
  const style = STYLES[s.style ?? "product"];
  const theme = opts.theme ?? THEMES[s.theme];
  cfgTheme = theme;
  const shell = s.program === "shell";
  program = shell ? shellProgram : pack;
  const slot = shell ? shellSlot : rootSlot;
  const slotPool = shell ? shellPool : pool;
  const framesPass = slot.frames;
  const mat = matOf(s);
  const pointer = { x: s.mouseX, y: s.mouseY, on: s.mouseOn };
  const drawFrames = s.drawFrames ?? true;
  framesPass.exact = s.exact ?? false;
  const bg = theme.canvasBg;
  const encoder = device.createCommandEncoder();
  let set;
  let cam;
  let sources;
  let nav = null;
  let inputs;
  if (s.nav) {
    nav = navOf(s, style);
    set = nav.arriving; cam = nav.cam;
    sources = sourcesOf(set, cam);
    const enter = nav.f.kind === "enter";
    // the arriving frame's own live portals (the inside's folders on enter; the root's other folders on exit) and the departed frame's
    const ap = portalsOf(nav.arrivingSpecs, set, cam, s, style);
    const dp = portalsOf(nav.departedSpecs, nav.departed, nav.outCam, s, style, enter ? (nav.at ?? -1) : -1);
    const holesIn = new Set(ap.holes);
    const holesOut = new Set(dp.holes);
    if (nav.at !== undefined) holesOut.add(nav.at);
    inputs = {
      view: viewOf(cam), pointer, ext: { [MAT_GLYPH]: mat }, present: nav.presentIn, theme, ...(s.overlays ? { overlays: soupsOf(s.overlays) } : {}),
      ...(s.dress === false ? {} : { lodZoom: nav.f.c1.zoom }),   // the arriving frame is dressed for its landing, the departed for the cut (PORTAL.md §9)
      config: cfgFor(s, set.glyph), sources, frames: drawFrames ? framesOf(set, opts, holesIn) : [],
      ...(ap.inputs.length ? { portals: ap.inputs } : {}),
      outgoing: {
        view: viewOf(nav.outCam), pointer: { x: 0, y: 0, on: false }, ext: { [MAT_GLYPH]: mat }, present: nav.presentOut,
        ...(s.dress === false ? {} : { lodZoom: nav.f.camPre.zoom }),
        config: cfgFor(s, nav.departed.glyph), sources: sourcesOf(nav.departed, nav.outCam), frames: drawFrames ? framesOf(nav.departed, opts, holesOut) : [],
        ...(dp.inputs.length ? { portals: dp.inputs } : {}),
        order: nav.order, ...(nav.at !== undefined ? { at: nav.at } : {}),
      },
    };
  } else {
    set = setOf(s.cards, style, s.glyph ?? "dot"); cam = { x: s.camX, y: s.camY, zoom: s.zoom };
    sources = sourcesOf(set, cam);
    const rp = portalsOf(s.cards, set, cam, s, style);
    inputs = { view: viewOf(cam), pointer, ext: { [MAT_GLYPH]: mat }, theme, ...(s.lodZoom !== undefined ? { lodZoom: s.lodZoom } : {}), config: cfgFor(s, set.glyph, s.rootInkAlpha), sources, frames: drawFrames ? framesOf(set, opts, rp.holes) : [], ...(rp.inputs.length ? { portals: rp.inputs } : {}), ...(s.overlays ? { overlays: soupsOf(s.overlays) } : {}) };
  }
  const prepared = prepareFrame(encoder, slot, slotPool, inputs);
  const pass = beginPass(encoder, out.view, [bg[0], bg[1], bg[2], 1]);
  if (opts.framesOnly) framesPass.draw(pass);
  else drawFrame(pass, { w: W, h: H }, VIEW.dpr, prepared.incoming, prepared.outgoing);
  pass.end();
  device.queue.submit([encoder.finish()]);
  return { px: await readback(device, out.texture, 4), f: { geoms: set.geoms, sources, cards: set.cards }, n: prepared.frames, theme, nav, runs: framesPass.runCount, portals: prepared.portals };
}

/**
 * The content term, as pixels (COMPOSE.md, design-013 §10.9). The scene's
 * 1:1 cards (content 64×64 world at zoom 1, dpr 2 = the 128² plate, one texel
 * per device px, pixel centres on texel centres) must show the plate's own
 * bytes wherever `pick()` says content — exact for a plain page or own texture,
 * within 1/255 through the `-srgb` round trip and in the half-alpha band where
 * the `over` lands between two bytes. And the CHROME must not know: the same
 * scene with every card a plate matches outside the interior, byte for byte.
 * For the z-runs scene the topmost card wins at every overlap.
 */
async function contentCheck(sc) {
  const s = sc.scene;
  const N = TEST_PLATE.size;
  const opts = sc.noShadow ? { theme: { ...THEMES[s.theme], shadow: 0 } } : {};
  const { px: B, f, theme, runs } = await render(s, opts);
  const { px: A } = await render({ ...s, cards: s.cards.map((c) => ({ ...c, content: "plate" })) }, opts);
  // the §2.3 hairline paints one world px inside the content edge at rest (no frame band until the reveal): step past it, and its AA
  const INSIDE = -(LINES.hairline + 1);
  const bg = theme.canvasBg;
  const world = (X, Y) => ({ wx: (X + 0.5) / VIEW.dpr / s.zoom + s.camX, wy: (Y + 0.5) / VIEW.dpr / s.zoom + s.camY });
  // a card is checked texel for texel only when it maps 1:1 (content extent × zoom × dpr = the plate); a magnified one is bilinear, parity's job
  const oneToOne = (G) => Math.abs(2 * G.ih[0] * s.zoom * VIEW.dpr - N) < 1e-6;
  // the byte a card's interior shows at a device px — the plate's texel over the surface, or the surface itself
  const expected = (card, G, wx, wy) => {
    const surBytes = card.surface.map((v) => Math.round(v * 255));   // setOf already resolved the surface to rgb
    if ((card.content ?? "plate") === "plate") return { rgb: surBytes, tol: 0 };
    const tx = (wx - (G.centre[0] - G.ih[0])) / (2 * G.ih[0]);
    const ty = (wy - (G.centre[1] - G.ih[1])) / (2 * G.ih[1]);
    const ix = Math.min(N - 1, Math.max(0, Math.floor(tx * N)));
    const iy = Math.min(N - 1, Math.max(0, Math.floor(ty * N)));
    const o = (iy * N + ix) * 4;
    const a = plateBytes[o + 3];
    // an -srgb texture decodes its (premultiplied) bytes on sampling; the pass encodes on UNPREMULTIPLIED colour (design-012 §4) —
    // a texel at alpha 1 round-trips its bytes, one at alpha ½ does not, and that is the conversion an island's target needs
    const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    const texel = (k) => card.content === "own-srgb" && a > 0 ? toSrgb(Math.min(1, toLin(plateBytes[o + k] / 255) / (a / 255))) * (a / 255) * 255 : plateBytes[o + k];
    const rgb = [0, 1, 2].map((k) => Math.round(texel(k) + surBytes[k] * (1 - a / 255)));
    return { rgb, tol: card.content === "own-srgb" ? (a < 255 ? 2 : 1) : a > 0 && a < 255 ? 1 : 0 };
  };
  let interior = 0;
  let interiorBad = 0;
  let interiorMax = 0;
  let chrome = 0;
  let chromeMax = 0;
  const bad = [];
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const { wx, wy } = world(X, Y);
    // the topmost card whose inner box holds the point, 1 world px (2 device px) clear of the edge
    let top = -1;
    for (let i = f.geoms.length - 1; i >= 0; i--) { if (sdInnerOf(f.geoms[i], wx, wy) < INSIDE && pick(f.geoms[i], wx, wy) === "content") { top = i; break; } }
    const o = (Y * W + X) * 4;
    if (top >= 0) {
      if (!oneToOne(f.geoms[top]) && (f.cards[top].content ?? "plate") !== "plate") continue;
      // a card ABOVE paints its hairline and its edge's AA over this one along its own edge: step around that band too
      let shadowed = false;
      for (let j = top + 1; j < f.geoms.length; j++) if (sdInnerOf(f.geoms[j], wx, wy) < -INSIDE) { shadowed = true; break; }
      if (shadowed) continue;
      const e = expected(f.cards[top], f.geoms[top], wx, wy);
      const d = Math.max(Math.abs(B[o] - e.rgb[0]), Math.abs(B[o + 1] - e.rgb[1]), Math.abs(B[o + 2] - e.rgb[2]));
      interior++; if (d > interiorMax) interiorMax = d; if (d > e.tol) { interiorBad++; if (bad.length < 3) bad.push(`(${X},${Y}) card ${top} ${f.cards[top].content}: got ${B[o]},${B[o + 1]},${B[o + 2]} want ${e.rgb.join(",")}`); }
    } else {
      // outside every interior by > 1 world px: chrome, shadow, grid — the content must not have touched it
      let near = false;
      for (const G of f.geoms) if (sdInnerOf(G, wx, wy) < -INSIDE) { near = true; break; }
      if (near) continue;
      const d = Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
      chrome++; if (d > chromeMax) chromeMax = d;
    }
  }
  const okRuns = sc.runs === undefined || sc.runs === runs;
  const ok = interiorBad === 0 && chromeMax === 0 && okRuns;
  console.log(`  ${ok ? "PASS" : "FAIL"}  content ${sc.name.padEnd(22)} interior ${interior.toLocaleString()} px = the plate's bytes (${interiorBad} off, maxΔ ${interiorMax}) · chrome ${chrome.toLocaleString()} px vs all-plate maxΔ ${chromeMax} · ${runs} run${runs === 1 ? "" : "s"}${sc.runs === undefined ? "" : ` (expected ${sc.runs})`}${bad.length ? `\n         ${bad.join("\n         ")}` : ""}`);
  return ok;
}

/**
 * The §7 heat, as pixels (GLOW.md §2). The target card alone, cold vs lit by a
 * source that is NOT drawn. Outside its outer silhouette by more than 3 device
 * px the two frames match byte for byte — the light never leaves the card (the
 * other card, the grid, the shadow skirt). Inside, every pixel is PREDICTED
 * from the field on the CPU: the cold pixel plus the light — the half-plane
 * irradiance through the source's rounded-rect field, masked to the card's own
 * coverage, in the glow colour at the tier's alpha — plus the rim (the ring's
 * line catching the same light), clamped. Light adds, so the prediction is
 * exact whatever lies under the card: ≤ 1/255 in the interior, ≤ 2 in the edge
 * band where the AA, the hairline and the rim meet. Then what a reader would
 * see: of the card's four quadrants the one nearest the source is the
 * brightest and the farthest the dimmest, and accept lights more than reject.
 */
async function heatCheck(sc) {
  const s = sc.scene;
  const idx = s.cards.findIndex((c) => c.hot);
  const S = s.cards[idx].hot;
  const { px: B, f, theme } = await render(s);
  const { px: A } = await render({ ...s, cards: s.cards.map((c) => ({ ...c, hot: undefined })) });
  const { px: C } = await render({ ...s, cards: s.cards.map((c) => (c.hot ? { ...c, hot: { ...c.hot, tier: 1 - c.hot.tier } } : c)) });
  const G = f.geoms[idx];
  const K = pack.heat;
  const tier = S.tier;
  const pxScale = 1 / (s.zoom * VIEW.dpr);
  const mix = (a, b, t) => a + (b - a) * t;
  const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
  const cov = (d) => clamp01(0.5 - d / pxScale);
  const insideLine = (d, w) => cov(d) - cov(d + w);
  const ga = mix(K.alpha[0], K.alpha[1], tier);
  const ra = mix(K.rim.alpha[0], K.rim.alpha[1], tier);
  const world = (X, Y) => ({ wx: (X + 0.5) / VIEW.dpr / s.zoom + s.camX, wy: (Y + 0.5) / VIEW.dpr / s.zoom + s.camY });
  let outside = 0;
  let outsideMax = 0;
  let inner = 0;
  let innerMax = 0;
  let band = 0;
  let bandMax = 0;
  let badN = 0;
  let tSum = 0;
  let cSum = 0;
  const Q = [[0, 0], [0, 0], [0, 0], [0, 0]];   // TL TR BR BL: sum of the light, count
  const bad = [];
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const { wx, wy } = world(X, Y);
    const o = (Y * W + X) * 4;
    const dO = sdOuter(G, wx, wy);
    const dAB = Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
    if (dO > 3 * pxScale) { outside++; if (dAB > outsideMax) outsideMax = dAB; continue; }
    const cF = cov(sdFrame(G, wx, wy));
    const cI = Math.min(cov(sdInner(G, wx, wy)), 1 - cF);
    const lit = irradiance(sdRoundBox(wx - S.x, wy - S.y, S.hx, S.hy, S.r), K.height);
    const gA = ga * lit * (cF + cI);
    const rA = ra * lit * insideLine(dO, K.rim.width);
    let err = 0;
    for (let k = 0; k < 3; k++) err = Math.max(err, Math.abs(B[o + k] - Math.min(255, A[o + k] + 255 * (vfSectionOf(theme).glow[k] * gA + vfSectionOf(theme).rim[k] * rA))));
    const interior = dO < -2 * pxScale;
    if (interior) { inner++; if (err > innerMax) innerMax = err; } else { band++; if (err > bandMax) bandMax = err; }
    if (err > (interior ? 1.5 : 2.5)) { badN++; if (bad.length < 3) bad.push(`(${X},${Y}) dO ${dO.toFixed(2)}: got ${B[o]},${B[o + 1]},${B[o + 2]} vs cold ${A[o]},${A[o + 1]},${A[o + 2]} err ${err.toFixed(2)}`); }
    if (interior) {
      const q = wy < G.centre[1] ? (wx < G.centre[0] ? 0 : 1) : wx < G.centre[0] ? 3 : 2;
      Q[q][0] += dAB; Q[q][1]++;
      const dAC = Math.max(Math.abs(A[o] - C[o]), Math.abs(A[o + 1] - C[o + 1]), Math.abs(A[o + 2] - C[o + 2]));
      tSum += tier === 1 ? dAB : dAC; cSum += tier === 1 ? dAC : dAB;
    }
  }
  const means = Q.map(([sum, n]) => sum / Math.max(n, 1));
  const names = ["TL", "TR", "BR", "BL"];
  const dist = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => Math.hypot(G.centre[0] + (sx * G.half[0]) / 2 - S.x, G.centre[1] + (sy * G.half[1]) / 2 - S.y));
  const near = dist.indexOf(Math.min(...dist));
  const far = dist.indexOf(Math.max(...dist));
  const tMean = tSum / Math.max(inner, 1);
  const cMean = cSum / Math.max(inner, 1);
  const ok = outsideMax === 0 && badN === 0 && means[near] === Math.max(...means) && means[far] === Math.min(...means) && tMean > cMean;
  console.log(`  ${ok ? "PASS" : "FAIL"}  heat ${sc.name.padEnd(28)} outside maxΔ ${outsideMax} over ${outside.toLocaleString()} px · predicted: interior max |err| ${innerMax.toFixed(2)}/255 over ${inner.toLocaleString()} px, edge band ${bandMax.toFixed(2)} over ${band.toLocaleString()} px (${badN} off) · quadrants ${names.map((n, i) => `${n} +${means[i].toFixed(1)}`).join(" ")} (nearest ${names[near]} brightest, farthest ${names[far]} dimmest) · accept +${tMean.toFixed(2)} vs reject +${cMean.toFixed(2)}${bad.length ? `\n         ${bad.join("\n         ")}` : ""}`);
  return ok;
}

/**
 * design-006's promise at the cut, as pixels. ENTER, p = 0: outside the portal
 * (the folder's face) the frame is the pre-cut frame, byte for byte — the
 * departed grid and cards under the outgoing camera ARE what was there — and
 * inside it the arriving frame shows. EXIT, p = 0: inside the portal the frame
 * is the inside as it was, byte for byte (the departed slot is opaque through
 * the portal), and around it the parent shows. Three device px of margin for
 * the portal's AA ramp.
 */
async function continuity(sc) {
  const s = sc.scene;
  const { px: B, nav } = await render(s);
  const before = sc.continuity === "enter"
    ? { ...s, nav: undefined, cards: withFolder(s) }
    : (() => { const c = s.nav.innerCam ?? arrivalCamera(boundsOf(s.nav.child.cards.map(rectOf)), VP); return { ...s, nav: undefined, cards: s.nav.child.cards, camX: c.x, camY: c.y, zoom: c.zoom, glyph: s.nav.child.glyph }; })();
  const { px: A } = await render(before);
  const c = nav.clip;
  const d = VIEW.dpr;
  const hx = c.hx * d;
  const hy = c.hy * d;
  const r = Math.min(c.r * d, hx, hy);
  const sd = (x, y) => { const qx = Math.abs(x - c.cx * d) - hx + r; const qy = Math.abs(y - c.cy * d) - hy + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
  const MARGIN = 3;
  let same = 0;
  let sameMax = 0;
  let other = 0;
  let otherDiff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const dist = sd(x + 0.5, y + 0.5);
    const delta = Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
    const mustMatch = sc.continuity === "enter" ? dist > MARGIN : dist < -MARGIN;
    const isOther = sc.continuity === "enter" ? dist < -MARGIN : dist > MARGIN;
    if (mustMatch) { same++; if (delta > sameMax) sameMax = delta; }
    else if (isOther) { other++; if (delta > 4) otherDiff++; }
  }
  // An exit whose portal covers the whole view (the inside was zoomed in past its arrival) has no "outside" to differ.
  const ok = sameMax === 0 && (other === 0 || otherDiff > 0);
  console.log(`  ${ok ? "PASS" : "FAIL"}  continuity ${sc.continuity.padEnd(5)} ${sc.name.padEnd(24)} ${sc.continuity === "enter" ? "outside" : "inside "} the portal maxΔ ${sameMax}/255 over ${same.toLocaleString()} px · ${other === 0 ? "the portal covers the view" : `${sc.continuity === "enter" ? "inside" : "outside"} differs on ${otherDiff.toLocaleString()} of ${other.toLocaleString()} px`}`);
  return ok;
}

/**
 * PORTAL.md §2.4, as pixels. A container's face shows its inside through a
 * LIVE PORTAL at rest; the flight starts from the portal's own camera. So an
 * ENTER at p = 0 renders the SAME FRAME as the rest before the cut — the whole
 * attachment, byte for byte, the departed frame under `camPre` around the
 * face and the arriving frame through it. And an EXIT before its fade (p 0.5)
 * IS the rest frame under the flying camera: the inside through the face,
 * the parent around it, byte for byte. The portal must be there to mean it:
 * against the same rest frame with portals OFF the face differs on most of
 * its pixels.
 */
async function portalCut(sc) {
  const s = sc.scene;
  const { px: B, nav, portals } = await render(s);
  const cam = sc.cut === "enter" ? { x: s.camX, y: s.camY, zoom: s.zoom } : flightAt(nav.f, s.nav.p, VP);
  // an exit's rest frame is dressed for the landing, as the arriving frame is mid-flight (§9); an enter's is the rest before the cut, dressed for itself
  const restScene = { ...s, nav: undefined, cards: withFolder(s), camX: cam.x, camY: cam.y, zoom: cam.zoom, ...(sc.cut === "exit" ? { lodZoom: nav.f.c1.zoom } : {}) };
  const { px: A, portals: restPortals } = await render(restScene);
  const { px: P } = await render({ ...restScene, portals: false });
  const c = nav.clip;
  const d = VIEW.dpr;
  const hx = c.hx * d;
  const hy = c.hy * d;
  const r = Math.min(c.r * d, hx, hy);
  const sd = (x, y) => { const qx = Math.abs(x - c.cx * d) - hx + r; const qy = Math.abs(y - c.cy * d) - hy + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
  // EXIT: the departed inside draws OVER the whole parent (ground.ts `at`), so two things rightly differ from the rest frame until the
  // landing fade: the parent's cards ABOVE the container inside the face (under the inside now, over the portal at rest — they appear
  // through the fade) and the container's own hairline band at the face's rim (the inside covers it now). Everything else must match.
  const pxScale = 1 / (cam.zoom * VIEW.dpr);
  // the rim band in DEVICE px: the §2.3 hairline (1 world unit inside the edge) plus its AA, at the flight's zoom
  const rim = Math.max(3, (LINES.hairline + 1.5) * cam.zoom * VIEW.dpr);
  const world = (X, Y) => ({ wx: (X + 0.5) * pxScale + cam.x, wy: (Y + 0.5) * pxScale + cam.y });
  const rootGeoms = sc.cut === "exit" ? (await render(restScene)).f.geoms : [];
  const above = (X, Y) => { const { wx, wy } = world(X, Y); for (let i = s.nav.container + 1; i < rootGeoms.length; i++) if (sdOuter(rootGeoms[i], wx, wy) < 3 * pxScale) return true; return false; };
  let max = 0;
  let inside = 0;
  let insideDiff = 0;
  let checked = 0;
  let excluded = 0;
  const dbg = { n: 0, x0: 1e9, x1: -1, y0: 1e9, y1: -1, in: 0, out: 0 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const dist = sd(x + 0.5, y + 0.5);
    if (sc.cut === "exit" && (Math.abs(dist) <= rim || (dist < 0 && above(x, y)))) { excluded++; continue; }
    checked++;
    const delta = Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
    if (delta > max) max = delta;
    if (delta > 0 && process.env.PORTAL_DEBUG) { dbg.n++; dbg.x0 = Math.min(dbg.x0, x); dbg.x1 = Math.max(dbg.x1, x); dbg.y0 = Math.min(dbg.y0, y); dbg.y1 = Math.max(dbg.y1, y); if (dist < 0) dbg.in++; else dbg.out++; if (dbg.n <= 5) console.log(`      Δ${delta} at (${x},${y}) dist ${dist.toFixed(1)} rest ${A[o]},${A[o + 1]},${A[o + 2]} flight ${B[o]},${B[o + 1]},${B[o + 2]}`); }
    if (dist < -3) { inside++; if (Math.max(Math.abs(A[o] - P[o]), Math.abs(A[o + 1] - P[o + 1]), Math.abs(A[o + 2] - P[o + 2])) > 4) insideDiff++; }
  }
  if (process.env.PORTAL_DEBUG) console.log(`      debug: ${dbg.n} px differ, bbox (${dbg.x0},${dbg.y0})–(${dbg.x1},${dbg.y1}), inside the face ${dbg.in}, outside ${dbg.out}; face centre (${(c.cx * d).toFixed(0)},${(c.cy * d).toFixed(0)}) half (${hx.toFixed(0)},${hy.toFixed(0)})`);
  const ok = max === 0 && restPortals >= 1 && insideDiff > inside * 0.5;
  console.log(`  ${ok ? "PASS" : "FAIL"}  portal cut ${sc.cut.padEnd(5)} ${sc.name.padEnd(24)} ${sc.cut === "enter" ? "the flight's first frame vs the rest frame before it: whole frame" : `the flight at p ${s.nav.p} vs the rest frame under its camera: outside the rim band (${rim.toFixed(1)} device px) and the cards above the container (${excluded.toLocaleString()} px)`} maxΔ ${max}/255 over ${checked.toLocaleString()} px · the rest frame has ${restPortals} live portal${restPortals === 1 ? "" : "s"}; inside the face it differs from the plate on ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} px · the flight frame drew ${portals} portal${portals === 1 ? "" : "s"} beside the departed`);
  return ok;
}

/**
 * PORTAL.md §10, as pixels — the CHAIN. Nothing at depth ≥ 2 may change a pixel outside
 * the depth-1 faces: the scene as it is, against the same scene with every inside's own
 * folders made plates, must match everywhere outside the root folders' faces — and differ
 * inside them (the nested portal is there, partly in view).
 */
async function chainCheck(sc) {
  const s = sc.scene;
  const strip = (c) => (c.inside ? { ...c, inside: { ...c.inside, cards: c.inside.cards.map(({ inside: _, ...k }) => k) } } : c);
  const { px: A, portals } = await render(s);
  const { px: B, portals: control } = await render({ ...s, cards: s.cards.map(strip) });
  const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
  const d = VIEW.dpr;
  const faces = s.cards.filter((c) => c.inside).map((c) => clipOf(faceOf(c), faceR(c), cam));
  const inFace = (x, y) => faces.some((c) => Math.abs(x / d - c.cx) <= c.hx + 1 && Math.abs(y / d - c.cy) <= c.hy + 1);
  let outside = 0;
  let outsideDiff = 0;
  let insideDiff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const delta = Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
    if (inFace(x, y)) { if (delta > 0) insideDiff++; } else { outside++; if (delta > 0) outsideDiff++; }
  }
  const ok = outsideDiff === 0 && insideDiff > 0 && portals > control;
  console.log(`  ${ok ? "PASS" : "FAIL"}  chain      ${sc.name.padEnd(24)} a depth-2 portal changes nothing outside the depth-1 faces: ${outsideDiff} of ${outside.toLocaleString()} px differ (inside them ${insideDiff.toLocaleString()} do) · ${portals} portals vs ${control} with the inner folders plates`);
  return ok;
}

/**
 * PORTAL.md §10, as pixels — the FACE. A container's interior is SEALED: the band between
 * the face and the card's interior edge is the plate (byte for byte the plate render), and
 * nothing under the container shows anywhere inside its content rect, edge pixels included —
 * the root's glyphs switched off must change no pixel there (the fill grown a device px and
 * the hole cut to the face partition every edge pixel between them).
 */
async function sealedCheck(sc) {
  const s = sc.scene;
  const { px: A, portals } = await render(s);
  const { px: B } = await render({ ...s, rootInkAlpha: 0 });
  const { px: P } = await render({ ...s, portals: false });
  const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
  const d = VIEW.dpr;
  const sdOf = (c) => (x, y) => { const hx = c.hx * d; const hy = c.hy * d; const r = Math.min(c.r * d, hx, hy); const qx = Math.abs(x - c.cx * d) - hx + r; const qy = Math.abs(y - c.cy * d) - hy + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
  const folders = s.cards.filter((c) => c.inside).map((c) => ({ content: sdOf(clipOf(rectOf(c), c.r, cam)), face: sdOf(clipOf(faceOf(c), faceR(c), cam)) }));
  let interior = 0;
  let leaked = 0;
  let band = 0;
  let bandOff = 0;
  let face = 0;
  let faceDiff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const X = x + 0.5;
    const Y = y + 0.5;
    for (const f of folders) {
      const dc = f.content(X, Y);
      const df = f.face(X, Y);
      if (dc >= 0) continue;
      interior++;
      if (A[o] !== B[o] || A[o + 1] !== B[o + 1] || A[o + 2] !== B[o + 2]) leaked++;
      const dP = Math.max(Math.abs(A[o] - P[o]), Math.abs(A[o + 1] - P[o + 1]), Math.abs(A[o + 2] - P[o + 2]));
      if (dc < -2 && df > 2) { band++; if (dP > 0) bandOff++; }
      else if (df < -2) { face++; if (dP > 4) faceDiff++; }
    }
  }
  const ok = leaked === 0 && bandOff === 0 && faceDiff > face * 0.5 && portals >= 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  sealed     ${sc.name.padEnd(24)} the root's glyphs off change ${leaked} of ${interior.toLocaleString()} interior px · the band round the face is the plate on all ${band.toLocaleString()} px (${bandOff} off) · the face differs from the plate on ${faceDiff.toLocaleString()} of ${face.toLocaleString()} px`);
  return ok;
}

/**
 * MAT.md — the NIGHT, as pixels. The same mat scene under the two lights. (1) The day's
 * chain is untouched by the night's presence: the dark theme handed the DAY's light equals
 * the light theme on every mat pixel (the frames' hairline is the theme's, so a band round
 * each card is excluded). (2) The night is darker than the day on every mat pixel, and no
 * channel falls under Eigengrau less the snow. (3) The Purkinje shift: the night is bluer
 * than the day (mean B/R up) and its dapples keep more of the green than its shadows —
 * over the day's brightest and darkest quarters of the mat, Σ(G−R)/Σ(B−R) is larger in
 * the Moon than in the palm's shadow — and the moonlit quarter sits near half the day's
 * luminance in linear light, the theme's one scale.
 */
async function nightCheck(sc) {
  const s = sc.scene;
  const { px: N, theme: night } = await render(s);
  const { px: D } = await render({ ...s, theme: "light" });
  const { px: D2 } = await render(s, { theme: { ...THEMES.dark, packs: { ...THEMES.dark.packs, [MAT_GLYPH]: { light: DAY_LIGHT } } } });
  const z = s.zoom * VIEW.dpr;
  const band = 4;   // device px round each card: the hairline and its AA
  const inCard = (x, y) => s.cards.some((c) => Math.abs(x - (c.x - s.camX) * z) <= (c.w / 2) * z + band && Math.abs(y - (c.y - s.camY) * z) <= (c.h / 2) * z + band);
  const lum = (o, P) => 0.2126 * P[o] + 0.7152 * P[o + 1] + 0.0722 * P[o + 2];
  const LIN = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));   // the one scale is a rule in LINEAR light
  const lin = (o, P) => 0.2126 * LIN[P[o]] + 0.7152 * LIN[P[o + 1]] + 0.0722 * LIN[P[o + 2]];
  const eig = night.packs[MAT_GLYPH].light.eigengrau.map((v) => Math.round(linearToSrgb(v) * 255));
  const floor = eig.map((v) => v - Math.ceil((night.packs[MAT_GLYPH].light.snow * 255) / 2) - 1);
  let mat = 0;
  let dayDiff = 0;
  let notDarker = 0;
  let underFloor = 0;
  let brN = 0;
  let brD = 0;
  const hist = new Uint32Array(256);
  const dayL = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (inCard(x, y)) continue;
    const o = (y * W + x) * 4; mat++;
    if (D[o] !== D2[o] || D[o + 1] !== D2[o + 1] || D[o + 2] !== D2[o + 2]) dayDiff++;
    const ld = lum(o, D); dayL[o >> 2] = ld; hist[Math.min(255, Math.round(ld))]++;
    if (lum(o, N) >= ld) notDarker++;
    if (N[o] < floor[0] || N[o + 1] < floor[1] || N[o + 2] < floor[2]) underFloor++;
    brN += N[o + 2] / Math.max(N[o], 1); brD += D[o + 2] / Math.max(D[o], 1);
  }
  // the day's darkest and brightest quarters of the mat: the palm's shadow and the Moon's dapples
  const q = (frac) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= frac * mat) return i; } return 255; };
  const lo = q(0.25);
  const hi = q(0.75);
  const S = { gr: 0, br: 0, n: 0, lum: 0, rgb: [0, 0, 0] };
  const M = { gr: 0, br: 0, n: 0, lum: 0, day: 0, rgb: [0, 0, 0] };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (inCard(x, y)) continue;
    const o = (y * W + x) * 4;
    const ld = dayL[o >> 2];
    const set = ld <= lo ? S : ld >= hi ? M : null;
    if (!set) continue;
    set.gr += N[o + 1] - N[o]; set.br += N[o + 2] - N[o]; set.n++; set.lum += lin(o, N); if (set === M) M.day += lin(o, D);
    for (let k = 0; k < 3; k++) set.rgb[k] += N[o + k];
  }
  const mean = (t) => t.rgb.map((v) => Math.round(v / Math.max(t.n, 1)));
  const greenMoon = M.gr / Math.max(M.br, 1);
  const greenShadow = S.gr / Math.max(S.br, 1);
  const litOverDay = (M.lum / Math.max(M.n, 1)) / (M.day / Math.max(M.n, 1));
  const ok = dayDiff === 0 && notDarker === 0 && underFloor === 0 && brN > brD && greenMoon > greenShadow && litOverDay > 0.35 && litOverDay < 0.65;
  console.log(`  ${ok ? "PASS" : "FAIL"}  night      ${sc.name.padEnd(24)} the day's chain with the night beside it: ${dayDiff} of ${mat.toLocaleString()} mat px differ · by night every mat px is darker (${notDarker} not) and none under Eigengrau ${eig} (${underFloor}) · B/R ${(brD / mat).toFixed(3)} → ${(brN / mat).toFixed(3)} · the Moon's quarter ${mean(M)} keeps green (G−R)/(B−R) ${greenMoon.toFixed(2)} vs the shadow's ${mean(S)} ${greenShadow.toFixed(2)} · the Moon's quarter at ${litOverDay.toFixed(2)}× the day's luminance`);
  return ok;
}

/**
 * The OVERLAY SOUP, as pixels (design-013 C1, D-C1.2). The pass has no
 * multisampling, so a triangle covers a device pixel exactly when the pixel's
 * CENTRE is inside it — which makes the whole frame predictable on the CPU, not
 * merely its interiors: composite every triangle whose centre-test says inside,
 * in draw order, straight-alpha "source over", onto the SAME scene rendered with
 * no overlay data at all. Nothing is excluded up front — instead every pixel
 * that disagrees by more than 1/255 is MEASURED against the nearest triangle
 * edge, and the check passes only if all of them sit inside the border band
 * where the rasteriser's top-left fill rule and a centre test may legitimately
 * differ (measured 2026-09-07: 12 px of 3,840,000, every one of them sitting
 * exactly ON an edge — under 1e-6 CSS px from it).
 *
 * The last two triangles of the wires soup are the CULL-NONE claim: one wound
 * clockwise in y-down screen px and one counter-clockwise. Under three that
 * needed `DoubleSide`; here both must simply land, so the check counts their
 * covered pixels separately and fails if either is empty.
 */
/** A mismatch is only excusable at a triangle's BORDER: half a device pixel, in CSS px. */
const EDGE_BAND = 0.5 / VIEW.dpr;
async function soupCheck(sc) {
  const s = sc.scene;
  const { px: B } = await render(s);
  const { px: A } = await render({ ...s, overlays: undefined });
  const tris = trianglesOf(s.overlays);
  const edge = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  let bad = 0;
  let maxErr = 0;
  let painted = 0;
  let deepest = 0;
  const cover = new Array(tris.length).fill(0);
  const wrong = [];
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const px = (X + 0.5) / VIEW.dpr;
    const py = (Y + 0.5) / VIEW.dpr;
    const o = (Y * W + X) * 4;
    const hits = [];
    let nearest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const e = [edge(t.p[0], t.p[1], px, py), edge(t.p[1], t.p[2], px, py), edge(t.p[2], t.p[0], px, py)];
      const L = [len(t.p[0], t.p[1]), len(t.p[1], t.p[2]), len(t.p[2], t.p[0])];
      for (let k = 0; k < 3; k++) if (L[k] > 0) nearest = Math.min(nearest, Math.abs(e[k]) / L[k]);
      if ((e[0] >= 0 && e[1] >= 0 && e[2] >= 0) || (e[0] <= 0 && e[1] <= 0 && e[2] <= 0)) { hits.push(i); cover[i]++; }
    }
    const dst = [A[o] / 255, A[o + 1] / 255, A[o + 2] / 255];
    for (const i of hits) {
      const t = tris[i];
      if (t.c[3] < 0.002) continue;   // the shader's discard
      for (let k = 0; k < 3; k++) dst[k] = t.c[k] * t.c[3] + dst[k] * (1 - t.c[3]);
    }
    if (hits.length > 0) painted++;
    let err = 0;
    for (let k = 0; k < 3; k++) err = Math.max(err, Math.abs(B[o + k] - Math.round(Math.min(1, Math.max(0, dst[k])) * 255)));
    if (err <= 1) { if (err > maxErr) maxErr = err; continue; }
    // A mismatch: the ONLY place one may live is a triangle's border, where the
    // rasteriser's top-left fill rule and this centre test can disagree about a
    // pixel whose centre sits on an edge. Measure how far in it reaches.
    bad++;
    if (nearest > deepest) deepest = nearest;
    if (wrong.length < 4) wrong.push(`(${X},${Y}) ${nearest.toFixed(6)} px from an edge, ${hits.length} hits: got ${B[o]},${B[o + 1]},${B[o + 2]} want ${dst.map((v) => Math.round(v * 255)).join(",")}`);
  }
  const cw = cover[cover.length - 2];
  const ccw = cover[cover.length - 1];
  const ok = deepest < EDGE_BAND && painted > 0 && cw > 0 && ccw > 0;
  console.log(`  ${ok ? "PASS" : "FAIL"}  soup       ${sc.name.padEnd(24)} ${tris.length} triangles over ${(W * H).toLocaleString()} px vs the CPU raster (no MSAA ⇒ the centre rule IS the rasteriser): maxΔ ${maxErr} everywhere but ${bad} px, each within ${deepest.toFixed(6)} CSS px of a triangle edge (the fill-rule band, ${EDGE_BAND} allowed) · ${painted.toLocaleString()} px carry soup · cull none: clockwise ${cw.toLocaleString()} px, counter-clockwise ${ccw.toLocaleString()} px${wrong.length ? `\n         ${wrong.join("\n         ")}` : ""}`);
  return ok;
}

/**
 * The two STAGES, as pixels (D-C1.1). The same board with a wires soup and a
 * guides soup crossing the cards: `under` means a card HIDES the wires (those
 * pixels equal the no-overlay frame byte for byte), `over` means the guides
 * paint on top of it (those pixels differ). Off the cards both soups show, so
 * the wires are not merely invisible.
 */
async function soupStackCheck(sc) {
  const s = sc.scene;
  const { px: B, f } = await render(s);
  const { px: A } = await render({ ...s, overlays: undefined });
  const wires = trianglesOf({ wires: s.overlays.wires });
  const guides = trianglesOf({ guides: s.overlays.guides });
  const edge = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const inside = (tris, x, y) => tris.some((t) => {
    const e = [edge(t.p[0], t.p[1], x, y), edge(t.p[1], t.p[2], x, y), edge(t.p[2], t.p[0], x, y)];
    return (e[0] >= 0 && e[1] >= 0 && e[2] >= 0) || (e[0] <= 0 && e[1] <= 0 && e[2] <= 0);
  });
  const MARGIN = 3 / (s.zoom * VIEW.dpr);   // world units: clear of every card's edge AA and its hairline
  let hidden = 0;
  let hiddenBad = 0;
  let shown = 0;
  let shownSame = 0;
  let free = 0;
  let freeSame = 0;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const sx = (X + 0.5) / VIEW.dpr;
    const sy = (Y + 0.5) / VIEW.dpr;
    const wx = sx / s.zoom + s.camX;
    const wy = sy / s.zoom + s.camY;
    const onWire = inside(wires, sx, sy);
    const onGuide = inside(guides, sx, sy);
    if (!onWire && !onGuide) continue;
    const o = (Y * W + X) * 4;
    const same = A[o] === B[o] && A[o + 1] === B[o + 1] && A[o + 2] === B[o + 2];
    // deep inside a card (past its edge band), or clear of every card by the same margin
    const over = f.geoms.some((G) => sdOuter(G, wx, wy) < -MARGIN);
    const clear = f.geoms.every((G) => sdOuter(G, wx, wy) > MARGIN);
    if (over && onWire && !onGuide) { hidden++; if (!same) hiddenBad++; }
    else if (over && onGuide) { shown++; if (same) shownSame++; }
    else if (clear) { free++; if (same) freeSame++; }
  }
  const ok = hidden > 0 && hiddenBad === 0 && shown > 0 && shownSame === 0 && free > 0 && freeSame === 0;
  console.log(`  ${ok ? "PASS" : "FAIL"}  stages     ${sc.name.padEnd(24)} \`under\`: a card hides the wires on all ${hidden.toLocaleString()} px it covers (${hiddenBad} showed through) · \`over\`: the guides paint on the cards on ${shown.toLocaleString()} px (${shownSame} unchanged) · clear of every card both soups show on ${free.toLocaleString()} px (${freeSame} unchanged)`);
  return ok;
}

/**
 * The portal CHAIN over an overlay (D-C1.2). A flight's ARRIVING frame is seen
 * only through the container's face, and its overlays must be too: with a soup
 * that spans the whole viewport on the root slot, every pixel that changed lies
 * inside the face — the scissor and `portal_cover` between them, exactly as for
 * the field. Three device px of margin for the face's AA ramp.
 */
async function soupClipCheck(sc) {
  const s = sc.scene;
  const { px: B, nav } = await render(s);
  const { px: A } = await render({ ...s, overlays: undefined });
  const c = nav.clip;
  const d = VIEW.dpr;
  const hx = c.hx * d;
  const hy = c.hy * d;
  const r = Math.min(c.r * d, hx, hy);
  const sd = (x, y) => { const qx = Math.abs(x - c.cx * d) - hx + r; const qy = Math.abs(y - c.cy * d) - hy + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
  const MARGIN = 3;
  let outside = 0;
  let leaked = 0;
  let inside = 0;
  let drew = 0;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const o = (Y * W + X) * 4;
    const dist = sd(X + 0.5, Y + 0.5);
    const same = A[o] === B[o] && A[o + 1] === B[o + 1] && A[o + 2] === B[o + 2];
    if (dist > MARGIN) { outside++; if (!same) leaked++; }
    else if (dist < -MARGIN) { inside++; if (!same) drew++; }
  }
  const ok = leaked === 0 && drew > 0;
  console.log(`  ${ok ? "PASS" : "FAIL"}  soup clip  ${sc.name.padEnd(24)} the arriving slot's soup stays inside the face: ${leaked} of ${outside.toLocaleString()} px outside it changed · inside it ${drew.toLocaleString()} of ${inside.toLocaleString()} px did`);
  return ok;
}

if (process.argv[2] === "mirror") {
  // One large card, exact path, no shadow, flat colours: every pixel's frame,
  // content and selection-ring coverage is predicted by the CPU mirror.
  // bg 0.2 · frame 1 · surface 0 · ring 1 (white, so it reads in the red channel) · hairline and buttons off.
  const style = STYLES.product;
  const s = { cards: [{ x: 0, y: 0, w: 400, h: 240, r: 14, strength: 1, selected: true }], camX: -300, camY: -200, zoom: 2, mouseX: 0, mouseY: 0, mouseOn: false, reach: 140, halfLen: 5.5, theme: "dark", style: "product", exact: true };
  // The flat colours live in two homes since design-014: the head (bg, hairline, ring) and the frame PACK's own
  // section (the chrome, the button fills) — a `frame` on the head is a key nothing reads, and the mirror then
  // predicts a white band the shader paints in the theme's chrome (a 217/255 miss over the whole ring).
  const flat = { ...THEMES.dark, canvasBg: [0.2, 0.2, 0.2], shadow: 0, hairline: [0, 0, 0, 0], select: [1, 1, 1], packs: { ...THEMES.dark.packs, "vf-frame": { ...vfSectionOf(THEMES.dark), frame: [1, 1, 1], fill: [0, 0, 0, 0], fillHover: [0, 0, 0, 0] } } };
  const { px, f } = await render(s, { theme: flat, framesOnly: true, surface: [0, 0, 0] });
  const G = f.geoms[0];
  const pxScale = 1 / (s.zoom * VIEW.dpr);
  const cov = (d) => Math.min(Math.max(0.5 - d / pxScale, 0), 1);
  let maxErr = 0;
  let sum = 0;
  let n = 0;
  let over2 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = (x + 0.5) * pxScale + s.camX;
    const wy = (y + 0.5) * pxScale + s.camY;
    // skip the button discs (a different primitive) with a 3 px margin
    if (Math.hypot(wx - G.closeC[0], wy - G.closeC[1]) < G.closeR + 3 * pxScale) continue;
    if (Math.hypot(wx - G.lockC[0], wy - G.lockC[1]) < G.lockR + 3 * pxScale) continue;
    const dO = sdOuter(G, wx, wy);
    const cF = cov(sdFrame(G, wx, wy));
    const cI = cov(sdInner(G, wx, wy));
    const ring = (cov(dO) - cov(dO + LINES.ring)) * G.ring;          // the §7 ring band, inside the outer edge
    const base = 0.2 * (1 - cF - cI) + 1 * cF;                        // premultiplied over the bg
    const expected = 1 * ring + base * (1 - ring);                    // then the ring over that; the swap chain's 8-bit
    const got = px[(y * W + x) * 4] / 255;
    const err = Math.abs(got - expected) * 255;
    if (err > maxErr) maxErr = err; if (err > 2) over2++; sum += err; n++;
  }
  console.log(`frame shader vs CPU mirror: ${n.toLocaleString()} px · mean |err| ${(sum / n).toFixed(4)}/255 · max ${maxErr.toFixed(2)} · >2: ${over2} (${(100 * over2 / n).toFixed(4)}%)`);
  console.log(`seam check at the border: ${(cov(sdFrame(G, G.centre[0], G.centre[1] - G.half[1] + style.thickness / 2)) + cov(sdInner(G, G.centre[0], G.centre[1] - G.half[1] + style.thickness / 2))).toFixed(9)} (must be 1)`);
} else {
  for (const sc of ORACLE_SCENES) {
    const t1 = performance.now();
    const { px, f, n, theme, nav } = await render(sc.scene);
    const bg = Math.round(theme.canvasBg[0] * 255);
    let ink = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - bg) + Math.abs(px[i + 1] - bg) + Math.abs(px[i + 2] - bg) > 12) ink++;
    writeFileSync(resolve(results, `oracle-${sc.name}.rgba`), px);
    const flight = nav ? ` · ${nav.f.kind} p ${sc.scene.nav.p}${nav.f.frozen ? " FROZEN" : ""} · ${nav.departed.glyph} → ${nav.arriving.glyph} · out ${nav.presentOut.opacity.toFixed(2)} in ${nav.presentIn.opacity.toFixed(2)}` : "";
    console.log(`${sc.name.padEnd(28)} ${f.sources.length} sources · ${n} frames · ${sc.scene.theme.padEnd(5)} · ${(performance.now() - t1).toFixed(0)} ms · ink ${(100 * ink / (W * H)).toFixed(1)}%${field.stats.surface ? ` · ${field.stats.surface}${field.stats.aux ? " ← aux" : ""}` : ""}${flight}`);
  }
  let failed = 0;
  for (const sc of ORACLE_SCENES) if (sc.continuity) { if (!(await continuity(sc))) failed += 1; }
  for (const sc of ORACLE_SCENES) if (sc.cut) { if (!(await portalCut(sc))) failed += 1; }
  for (const sc of ORACLE_SCENES) if (sc.chain) { if (!(await chainCheck(sc))) failed += 1; }
  for (const sc of ORACLE_SCENES) if (sc.sealed) { if (!(await sealedCheck(sc))) failed += 1; }
  for (const sc of ORACLE_SCENES) if (sc.content) { if (!(await contentCheck(sc))) failed += 1; }
  for (const sc of ORACLE_SCENES) if (sc.heat) { if (!(await heatCheck(sc))) failed += 1; }
  for (const sc of ORACLE_SCENES) if (sc.night) { if (!(await nightCheck(sc))) failed += 1; }
  for (const sc of ORACLE_SCENES) if (sc.soup) { if (!(await soupCheck(sc))) failed += 1; }
  for (const sc of ORACLE_SCENES) if (sc.soupStack) { if (!(await soupStackCheck(sc))) failed += 1; }
  for (const sc of ORACLE_SCENES) if (sc.soupClip) { if (!(await soupClipCheck(sc))) failed += 1; }
  if (failed) { console.log(`${failed} check(s) FAILED`); process.exitCode = 1; }
}
device.destroy();
