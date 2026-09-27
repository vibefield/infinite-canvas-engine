// The ground rendered HEADLESS in Node on raw WebGPU (Dawn via the `webgpu`
// package), from the same TypeScript passes and the same .wgsl files the
// browser build uses. No canvas: the colour target is a readable Target.
//
//   pnpm --filter @ice/desk oracle              → oracle/results/oracle-<scene>.rgba for apps/desk rig:parity, and every check —
//                                                  among them THE GOLDEN: every scene's sha-256 against the COMMITTED
//                                                  oracle/shas.json (design-015 D7): a pixel that moves, a scene with no
//                                                  entry or an entry with no scene is a FAIL (gate:landing runs this)
//   ORACLE_BLESS=1 pnpm --filter @ice/desk oracle   → re-bless: write the drawn shas into oracle/shas.json (a deliberate
//                                                  event — a diff of that file IS the pixel change; commit it with its why)
//   BASELINE_DIR=<dir> pnpm --filter @ice/desk oracle   → also: the `baseline` stills byte for byte against <dir>
//                                                  (the renders the engine made before the cards and the dot and
//                                                  needle retired — MINIMAT.md §1: what stayed must not move); a
//                                                  missing file is a FAIL, never a skip
//
// The golden is Dawn's bytes on the host that blessed it: another GPU or driver may round differently, and a re-bless
// there is the same deliberate event.
//
// If this matches Chrome, the engine is host-agnostic and the pixel oracle
// needs no browser. A nav scene draws BOTH desks of a flight through the
// ground's own `prepareFrame` / `drawFrame`, from the same flight geometry
// the lab computes — and the checks pin design-006's promise: at the cut,
// nothing moved by a pixel. The desk itself — the passes, the fixtures on
// them, the scene builder — is frame.mjs, which apps/desk's parity page runs
// in Chrome (design-015 D1b); this file is the Node host and the checks.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { create, globals } from "webgpu";
import { ORACLE_SCENES, VIEW } from "./scenes.mjs";
import { createOracleDesk } from "./frame.mjs";
import { PRINT_FIXTURES, printSheetOf } from "./prints.mjs";
import { inflateRawSync } from "node:zlib";
import { acquire } from "../src/engine/device.ts";
import { Target, readback } from "../src/engine/target.ts";
import { DEFAULT_MAT_CONFIG } from "../src/mat/layout.ts";
import { labelReach, labelsAlong, rulerLevels } from "../src/lattice/ruler.ts";
import { lod } from "../src/lattice/lod.ts";
import { localOf, sdPaper, shadowReach } from "../src/paper/paper.ts";
import { chipOf, faceClip, faceOf, sdMiniMat } from "../src/minimat/minimat.ts";
import { insideView } from "../src/minimat/inside.ts";
import { arrivalCamera, FIT } from "../src/nav/flight.ts";
import { PORTAL_GATE } from "../src/nav/portal.ts";
import { THEMES, surface } from "./fixtures/vf-theme.ts";
import { DAY_LIGHT, linearToSrgb, srgbToLinear } from "../src/mat/night.ts";
import { sdRoundBox, unproject } from "../src/photo/photo.ts";
import { sdBoard, sdSurface } from "../src/board/board.ts";
import { cssColor, MARKS } from "../src/theme.ts";
import { markDistance } from "../src/marks/mirror.ts";

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
// The engine's assets (assets/: the blue noise) and the HOST's (oracle/fixtures/assets/: the gobo plates, the rulers' glyphs, the note's ink — the product's, a fixture here) — raw bytes either way.
const bytesOf = (dir, rel) => { const b = readFileSync(resolve(root, dir, rel)); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); };
const raw = (rel) => bytesOf("assets", rel);
const hostRaw = (rel) => bytesOf("oracle/fixtures/assets", rel);
const glyphMetaPath = resolve(root, "oracle/fixtures/assets/glyphs-mono-2x.json");
const glyphMeta = existsSync(glyphMetaPath) ? JSON.parse(readFileSync(glyphMetaPath, "utf8")) : null;
const inkMetaPath = resolve(root, "oracle/fixtures/assets/ink-note-1.json");
const inkMeta = existsSync(inkMetaPath) ? JSON.parse(readFileSync(inkMetaPath, "utf8")) : null;
const photoMetaPath = resolve(root, "oracle/fixtures/assets/photo-1.json");
const photoMeta = existsSync(photoMetaPath) ? JSON.parse(readFileSync(photoMetaPath, "utf8")) : null;
// the desk calendars' committed prints (D3t-c — prints.mjs): the live print's tiles, read back from the world in Chrome
const prints = {};
for (const name of PRINT_FIXTURES) {
  const metaPath = resolve(root, `oracle/fixtures/assets/${name}.json`);
  if (!existsSync(metaPath)) { console.log(`no committed print ${name} (oracle/fixtures/assets/${name}.*): its scenes cannot be drawn`); continue; }
  const bin = inflateRawSync(readFileSync(resolve(root, `oracle/fixtures/assets/${name}.bin`)));
  prints[name] = printSheetOf(JSON.parse(readFileSync(metaPath, "utf8")), new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength));
}
// THE ERROR-SCOPE PROBE (design-015 D3r-b): every GPU error the desk's creation and every frame after it raises — a validation
// error, an out-of-memory, an internal one — is caught in a scope of its own and counted; a single one fails the run. (The notebook's
// and the calendar's passes watched their first four frames themselves; as kinds they record into the frame's encoder, so the host
// that submits the frame watches it.)
const SCOPES = ["validation", "out-of-memory", "internal"];
const probe = { frames: 0, errors: [] };
const scoped = async (what, fn) => {
  for (const f of SCOPES) device.pushErrorScope(f);
  const out = await fn();
  for (const f of [...SCOPES].reverse()) { const e = await device.popErrorScope(); if (e) probe.errors.push(`${what} (${f}): ${e.message}`); }
  return out;
};
// The desk both hosts draw (frame.mjs), on Dawn's device, composed from the .wgsl files on disk.
const desk = await scoped("creation", () => createOracleDesk({
  device, format: FORMAT, text: texts,
  assets: {
    noise: raw("blue-noise.rgba"), goboC: hostRaw("gobo-c.rgba"), goboB: hostRaw("gobo-b.rgba"),
    glyphMeta, glyphs: glyphMeta && glyphMeta.count >= 12 ? hostRaw("glyphs-mono-2x.r8") : null,
    inkMeta, ink: inkMeta && inkMeta.w > 0 ? hostRaw("ink-note-1.r8") : null,
    photoMeta, photo: photoMeta && photoMeta.w > 0 ? hostRaw("photo-1.rgba") : null,
    prints,
  },
}));
const { mat, VP, noteGeometry, notesOf, matGeometry, insideOf, contentOf, childrenOf, thingsOf, printOf, boardPoseOf } = desk;
const W = VIEW.cssW * VIEW.dpr;
const H = VIEW.cssH * VIEW.dpr;
const out = new Target(device, { format: FORMAT, label: "oracle", readable: true }, W, H);
/** A scene's own view (a phone's portrait still, D4b) gets a readable target of its size; the rest share `out`. */
const targets = new Map();
const targetOf = (s) => {
  const v = s.view;
  if (!v) return { target: out, w: W, h: H };
  const key = `${v.cssW}x${v.cssH}@${v.dpr}`;
  let t = targets.get(key);
  if (!t) { t = new Target(device, { format: FORMAT, label: `oracle ${key}`, readable: true }, v.cssW * v.dpr, v.cssH * v.dpr); targets.set(key, t); }
  return { target: t, w: t.width, h: t.height };
};

/**
 * Render one scene through frame.mjs's `encode` into the readable target — the frame inside the probe's scopes — and read it
 * back. The desk's marks (D4a) are OFF unless asked: every check but the marks' own measures the objects alone; the saved render
 * (rig:parity's) has them.
 */
async function render(s, opts = {}) {
  const { target, w, h } = targetOf(s);
  const { theme, nav, prepared, marks } = await scoped(`frame ${++probe.frames}`, () => {
    const encoder = device.createCommandEncoder();
    const r = desk.encode(encoder, target.view, { w, h }, s, { marks: false, ...opts });
    device.queue.submit([encoder.finish()]);
    return r;
  });
  return { px: await readback(device, target.texture, 4), theme, nav, portals: prepared.portals, stats: prepared.incoming.stats, marks, w, h };
}

// ---------------------------------------------------------------- the checks

const lum = (P, o) => 0.2126 * P[o] + 0.7152 * P[o + 1] + 0.0722 * P[o + 2];
const delta = (A, B, o) => Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
/** A clip's rounded-rect distance in DEVICE px at a device-px point. */
const sdClip = (c) => {
  const d = VIEW.dpr;
  const hx = c.hx * d;
  const hy = c.hy * d;
  const r = Math.min(c.r * d, hx, hy);
  return (x, y) => {
    const qx = Math.abs(x - c.cx * d) - hx + r;
    const qy = Math.abs(y - c.cy * d) - hy + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
};

/**
 * MINIMAT.md §1: what stayed must not move — a still the engine drew before the cards and the dot and the needle retired, byte
 * for byte. A still with a selection is drawn as the prototype drew it (the kinds' own ring, no marks — D4a retired the ring in
 * the product, `prototypeRing` keeps the engine's path to it), so the witness holds for every scene.
 */
async function baselineCheck(sc, drawn) {
  const selects = (d) => [...(d.notes ?? []), ...(d.minimats ?? []), ...(d.boards ?? [])].some((o) => o.selected);
  const px = selects(sc.scene) ? (await render(sc.scene, { prototypeRing: true })).px : drawn;
  const dir = process.env.BASELINE_DIR;
  const file = resolve(dir, `oracle-${sc.name}.rgba`);
  // a witness that is not there has seen nothing: a missing file (a typo'd dir, a scene never captured) FAILS (D7)
  if (!existsSync(file)) { console.log(`  FAIL  baseline   ${sc.name.padEnd(24)} no ${file}`); return false; }
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
    : (() => {
      const cont = s.minimats[s.nav.container];
      const inside = insideOf(cont);
      const c = s.nav.innerCam ?? arrivalCamera(contentOf(inside), VP);
      return { ...s, nav: undefined, minimats: inside.minimats, notes: inside.notes, camX: c.x, camY: c.y, zoom: c.zoom };
    })();
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
  if (dbg.length) {
    const xs = dbg.map((v) => v[0]);
    const ys = dbg.map((v) => v[1]);
    console.log(`      debug: ${dbg.length} px, x ${Math.min(...xs.slice(0, 50000))}–${Math.max(...xs.slice(0, 50000))}, y ${Math.min(...ys.slice(0, 50000))}–${Math.max(...ys.slice(0, 50000))}; first ${dbg.slice(0, 4).map((v) => v.join(",")).join(" | ")}`);
  }
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
  const covered = (x, y) => {
    const wx = (x + 0.5) * pxScale + cam.x;
    const wy = (y + 0.5) * pxScale + cam.y;
    return over.some((G) => sdPaper(G, wx, wy) < shadowReach(G) + 3 * pxScale);
  };
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
  if (dbg.length) {
    let x0 = 1e9;
    let x1 = -1;
    let y0 = 1e9;
    let y1 = -1;
    for (const [x, y] of dbg) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    console.log(`      debug: bbox (${x0},${y0})–(${x1},${y1}); face ${JSON.stringify(nav.clip)}; first ${dbg.slice(0, 3).map((v) => v.join(",")).join(" | ")}`);
    writeFileSync(resolve(results, `debug-${sc.name}-flight.rgba`), B); writeFileSync(resolve(results, `debug-${sc.name}-rest.rgba`), A);
  }
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
  const corr = (a, b) => {
    const n = a.length;
    const ma = a.reduce((p, v) => p + v, 0) / n;
    const mb = b.reduce((p, v) => p + v, 0) / n;
    let c = 0;
    let va = 0;
    let vb = 0;
    for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
    return c / Math.sqrt(va * vb + 1e-12);
  };
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
    if (sdMin > 1.5 * pxScale) {
      shadowN++;
      const la = lum(A, o);
      const lb = lum(B, o);
      if (la > lb + 1) shadowBright++;
      if (la < lb - 2) shadowDark++;
    }
  }
  const ok = outsideMax === 0 && insideDiff > inside * 0.5 && shadowBright === 0 && shadowDark > 0 && (!sc.token || (stripOff === 0 && strip > 100));
  console.log(`  ${ok ? "PASS" : "FAIL"}  paper      ${sc.name.padEnd(24)} beyond the sheets and their shadows maxΔ ${outsideMax}/255 over ${outside.toLocaleString()} px · inside ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} differ · the shadow band ${shadowDark.toLocaleString()} of ${shadowN.toLocaleString()} darker, ${shadowBright} brighter${sc.token ? ` · the flat strip is the token's byte within ${stripMax}/255 over ${strip.toLocaleString()} px (${stripOff} off)` : ""}`);
  return ok;
}

// ---------------------------------------------------------------- the prints and the whiteboards (design-015 D3r-a)

/** A device pixel's centre in the scene's world. */
const worldAt = (s, x, y) => { const k = 1 / (s.zoom * VIEW.dpr); return [(x + 0.5) * k + s.camX, (y + 0.5) * k + s.camY]; };
/** The print's sheet as the eye sees it at a world point: its signed distance in the sheet's own units (photo.ts `hitPhoto`'s). */
const sdPrint = (G, wx, wy) => { const [u, v] = unproject(G, wx, wy); return sdRoundBox(u, v, G.half[0], G.half[1], G.radius); };
/** Is a world point inside a print's quad (its sheet as seen and its shadow), grown by `m` world units? */
const inBounds = (G, wx, wy, m) => wx > G.bounds.x0 - m && wx < G.bounds.x1 + m && wy > G.bounds.y0 - m && wy < G.bounds.y1 + m;

/**
 * PHOTO.md, as pixels. The same still with its prints and without: (1) outside every print's quad (its sheet as seen and its
 * shadow, `resolvePhoto`'s bounds, + 3 device px) byte for byte — a print paints nothing it does not own; (2) inside the sheets
 * most pixels differ; (3) around the sheets, inside their quads, the shadow only darkens.
 */
async function photoCheck(sc) {
  const s = sc.scene;
  const { px: A } = await render(s);
  const { px: B } = await render({ ...s, prints: [] });
  const geoms = s.prints.map((p) => printOf(p).geometry);
  const k = 1 / (s.zoom * VIEW.dpr);
  let outside = 0;
  let outsideMax = 0;
  let inside = 0;
  let insideDiff = 0;
  let band = 0;
  let bandDark = 0;
  let bandBright = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [wx, wy] = worldAt(s, x, y);
    const o = (y * W + x) * 4;
    const d = delta(A, B, o);
    if (!geoms.some((G) => inBounds(G, wx, wy, 3 * k))) { outside++; if (d > outsideMax) outsideMax = d; continue; }
    const sd = Math.min(...geoms.map((G) => sdPrint(G, wx, wy)));
    if (sd < -1.5 * k) { inside++; if (d > 0) insideDiff++; continue; }
    if (sd > 1.5 * k) { band++; const la = lum(A, o); const lb = lum(B, o); if (la > lb + 1) bandBright++; if (la < lb - 2) bandDark++; }
  }
  const ok = outsideMax === 0 && outside > 100000 && insideDiff > inside * 0.5 && bandBright === 0 && bandDark > 0;
  console.log(`  ${ok ? "PASS" : "FAIL"}  photo      ${sc.name.padEnd(24)} outside the prints' quads maxΔ ${outsideMax}/255 over ${outside.toLocaleString()} px · inside the sheets ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} differ · around them ${bandDark.toLocaleString()} of ${band.toLocaleString()} darker, ${bandBright} brighter`);
  return ok;
}

/**
 * design-015 §4.2, as pixels — PAINT ORDER across kinds: the desk's things are runs of one kind in the desk's own order. Each thing,
 * inside its own sheet (1.5 device px in) and outside the reach of every thing laid after it, is byte for byte the same thing
 * lying ALONE on the desk: an opaque sheet shows itself whatever lies under it — so a note under the print and a note over it
 * each hold only if the three runs drew in the order the list gave.
 */
async function orderCheck(sc) {
  const s = sc.scene;
  const { px: A } = await render(s);
  const things = thingsOf(s);
  const k = 1 / (s.zoom * VIEW.dpr);
  // each thing's sheet (signed distance, world) and its reach (what it may paint: a note's sheet and shadow, a print's quad)
  const shapes = things.map((t) => {
    if (t.kind === "note") { const G = noteGeometry(t); return { sd: (wx, wy) => sdPaper(G, wx, wy), reach: (wx, wy) => sdPaper(G, wx, wy) < shadowReach(G) + 3 * k }; }
    const G = printOf(t).geometry;
    return { sd: (wx, wy) => sdPrint(G, wx, wy), reach: (wx, wy) => inBounds(G, wx, wy, 3 * k) };
  });
  const rows = [];
  let ok = true;
  for (let i = 0; i < things.length; i++) {
    const { px: L } = await render({ ...s, things: [things[i]] });
    let n = 0;
    let max = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [wx, wy] = worldAt(s, x, y);
      if (!(shapes[i].sd(wx, wy) < -1.5 * k)) continue;
      if (shapes.slice(i + 1).some((sh) => sh.reach(wx, wy))) continue;
      n++;
      const d = delta(A, L, (y * W + x) * 4);
      if (d > max) max = d;
    }
    if (!(max === 0 && n > 1000)) ok = false;
    rows.push(`${things[i].kind} ${i} maxΔ ${max} over ${n.toLocaleString()} px`);
  }
  console.log(`  ${ok ? "PASS" : "FAIL"}  order      ${sc.name.padEnd(24)} each thing on its own sheet, clear of those laid after it, is itself alone: ${rows.join(" · ")}`);
  return ok;
}

/**
 * BOARD.md, as pixels. The same still with its whiteboards and without (the note beside it kept): (1) outside every board's quad
 * (the slab, its shadow's reach, the marker lying on it — `quadOf`, + 3 device px) byte for byte; (2) inside the boards most
 * pixels differ.
 */
async function boardCheck(sc) {
  const s = sc.scene;
  const { px: A } = await render(s);
  const { px: B } = await render({ ...s, boards: [] });
  const poses = s.boards.map((b) => boardPoseOf(b));
  const k = 1 / (s.zoom * VIEW.dpr);
  let outside = 0;
  let outsideMax = 0;
  let inside = 0;
  let insideDiff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [wx, wy] = worldAt(s, x, y);
    const d = delta(A, B, (y * W + x) * 4);
    const m = 3 * k;
    if (!poses.some(({ quad: q }) => wx > q.x0 - m && wx < q.x1 + m && wy > q.y0 - m && wy < q.y1 + m)) { outside++; if (d > outsideMax) outsideMax = d; continue; }
    if (poses.some(({ geometry: G }) => sdBoard(G, wx, wy) < -1.5 * k)) { inside++; if (d > 0) insideDiff++; }
  }
  const ok = outsideMax === 0 && outside > 100000 && insideDiff > inside * 0.5;
  console.log(`  ${ok ? "PASS" : "FAIL"}  board      ${sc.name.padEnd(24)} outside the boards' quads maxΔ ${outsideMax}/255 over ${outside.toLocaleString()} px · inside the boards ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} differ`);
  return ok;
}

/**
 * BOARD.md §4, as pixels — the INK is the history replayed into the melamine and nowhere else: the same board with its strokes and
 * with none differs only on the melamine (1.5 device px of its edge's AA aside), and there on the strokes' pixels.
 */
async function inkCheck(sc) {
  const s = sc.scene;
  const { px: A } = await render(s);
  const { px: B } = await render({ ...s, boards: s.boards.map((b) => ({ ...b, strokes: [] })) });
  const poses = s.boards.map((b) => boardPoseOf(b));
  const k = 1 / (s.zoom * VIEW.dpr);
  let off = 0;
  let offMax = 0;
  let on = 0;
  let onDiff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [wx, wy] = worldAt(s, x, y);
    const d = delta(A, B, (y * W + x) * 4);
    if (poses.some(({ geometry: G }) => sdSurface(G, wx, wy) < 1.5 * k)) { on++; if (d > 0) onDiff++; } else { off++; if (d > offMax) offMax = d; }
  }
  const ok = offMax === 0 && onDiff > 1000;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ink        ${sc.name.padEnd(24)} off the melamine maxΔ ${offMax}/255 over ${off.toLocaleString()} px · on it ${onDiff.toLocaleString()} of ${on.toLocaleString()} px carry the replayed strokes`);
  return ok;
}

// ---------------------------------------------------------------- the marks (D4a)

/** A scene with nothing selected, taped or marked — the marks check's control. */
const unmarked = (s) => {
  const strip = (o) => ({ ...o, selected: false, locked: false });
  return { ...s, marks: undefined, notes: (s.notes ?? []).map(strip), minimats: (s.minimats ?? []).map(strip), ...(s.boards ? { boards: s.boards.map(strip) } : {}), ...(s.prints ? { prints: s.prints.map(strip) } : {}), ...(s.things ? { things: s.things.map(strip) } : {}) };
};
/** The device px a mark may touch: its quad, grown by one. */
const quadPixels = (m, visit) => {
  const d = VIEW.dpr;
  const [x0, y0, x1, y1] = m.quad;
  for (let Y = Math.max(0, Math.floor(y0 * d) - 1); Y <= Math.min(H - 1, Math.ceil(y1 * d) + 1); Y++) for (let X = Math.max(0, Math.floor(x0 * d) - 1); X <= Math.min(W - 1, Math.ceil(x1 * d) + 1); X++) visit(X, Y);
};
/** The pixel nearest a CSS point: its offset, or −1 off screen. */
const pixelAt = (x, y) => { const X = Math.floor(x * VIEW.dpr); const Y = Math.floor(y * VIEW.dpr); return X < 0 || Y < 0 || X >= W || Y >= H ? -1 : (Y * W + X) * 4; };
const byteOf = (c) => [0, 1, 2].map((i) => Math.round(c[i] * 255));
const exact = (P, o, want) => o >= 0 && P[o] === want[0] && P[o + 1] === want[1] && P[o + 2] === want[2];
/** Points on a SOLID pencil stroke's centre line (full coverage there: the stroke is 1.5 px, three device px) — a bracket's runs' middles, a ring's sides'. */
function strokeSamples(m) {
  const [cx, cy, angle, r] = m.centre;
  const [X, Y] = m.half;
  const L = m.shape[3];
  const local = m.shape[0] === 2
    ? [[1, 1], [1, -1], [-1, 1], [-1, -1]].flatMap(([sx, sy]) => [[sx * (X - (L + r) / 2), sy * Y], [sx * X, sy * (Y - (L + r) / 2)]])
    : [[0, -Y], [0, Y], [-X, 0], [X, 0]];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return local.map(([x, y]) => [cx + c * x - s * y, cy + s * x + c * y]);
}

/**
 * *Marks on the Mat* as pixels: the marks change the frame ONLY inside their band (every pixel within one device px of a mark's
 * ink, by the marks' CPU mirror — a frame's brackets reach the object's edge, never its middle) —
 * against the same desk with nothing selected, taped or marked, maxΔ 0 outside it, so the objects under a selection are the
 * unselected objects' pixels exactly (the kinds' own ring is gone) — and inside it they are the page's inks: the pencil's byte
 * (MARKS.inks.pencil) wherever a 1.5 px stroke is solid and nothing is drawn over it; a knob's face the paper's byte; a laser pill's fill the
 * laser's byte beside its numerals.
 */
async function marksCheck(sc) {
  const s = sc.scene;
  const { px: A, marks } = await render(s, { marks: true });
  const { px: B } = await render(unmarked(s));
  const band = new Uint8Array(W * H);
  const d = VIEW.dpr;
  for (const m of marks) quadPixels(m, (X, Y) => { if (markDistance(m, (X + 0.5) / d, (Y + 0.5) / d) <= 1 / d) band[Y * W + X] = 1; });
  let outside = 0;
  let outsideMax = 0;
  let inside = 0;
  let insideDiff = 0;
  for (let i = 0; i < W * H; i++) { const dd = delta(A, B, i * 4); if (band[i]) { inside++; if (dd > 0) insideDiff++; } else { outside++; if (dd > outsideMax) outsideMax = dd; } }
  // later marks' quads: a stroke's sample under one is not the stroke's alone
  const covered = (k, x, y) => marks.slice(k + 1).some((m) => x >= m.quad[0] && x <= m.quad[2] && y >= m.quad[1] && y <= m.quad[3]);
  const pencil = byteOf(cssColor(MARKS.inks.pencil.css));
  const paper = byteOf(cssColor(MARKS.inks.paper.css));
  const laser = byteOf(cssColor(MARKS.inks.laser.css));
  const inkIs = (m, css) => [0, 1, 2].every((i) => Math.abs(m.colour[i] - cssColor(css)[i]) < 1e-6) && m.colour[3] === 1;
  const isPencil = (m) => inkIs(m, MARKS.inks.pencil.css);
  let strokes = 0;
  let strokesOff = 0;
  let faces = 0;
  let facesOff = 0;
  let pills = 0;
  let pillsOff = 0;
  marks.forEach((m, k) => {
    if ((m.shape[0] === 2 || m.shape[0] === 0) && m.shape[2] === MARKS.select.stroke && isPencil(m)) {
      for (const [x, y] of strokeSamples(m)) { if (covered(k, x, y) || pixelAt(x, y) < 0) continue; strokes++; if (!exact(A, pixelAt(x, y), pencil)) strokesOff++; }
    }
    if (m.shape[0] === 1 && m.centre[3] === MARKS.select.knob && inkIs(m, MARKS.inks.paper.css)) { faces++; if (!exact(A, pixelAt(m.centre[0], m.centre[1]), paper)) facesOff++; }
    if (m.shape[0] === 1 && m.centre[3] === MARKS.pill.radius && m.half[1] * 2 === MARKS.pill.height && inkIs(m, MARKS.inks.laser.css)) { pills++; if (!exact(A, pixelAt(m.centre[0] - m.half[0] + 2, m.centre[1]), laser)) pillsOff++; }
  });
  const ok = marks.length > 0 && outsideMax === 0 && insideDiff > 0 && strokesOff === 0 && facesOff === 0 && pillsOff === 0 && (strokes > 0 || s.marks?.t !== undefined);
  console.log(`  ${ok ? "PASS" : "FAIL"}  marks      ${sc.name.padEnd(24)} ${marks.length} marks · outside their band maxΔ ${outsideMax}/255 over ${outside.toLocaleString()} px (inside ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} differ) · the pencil's byte on ${strokes - strokesOff}/${strokes} solid samples · knob faces ${faces - facesOff}/${faces} · laser pills ${pills - pillsOff}/${pills}`);
  return ok;
}

/** By night (Q-k): the pencil and the laser are light — the pencil's byte where it is solid, as by day — and the tape is moonlit: darker than the same tape by day. */
async function unlitCheck(sc) {
  const s = sc.scene;
  const night = await render(s, { marks: true });
  const day = await render(s, { marks: true, theme: THEMES.light });
  const pencil = byteOf(cssColor(MARKS.inks.pencil.css));
  let solid = 0;
  let solidOff = 0;
  let tape = 0;
  let tapeDarker = 0;
  night.marks.forEach((m, k) => {
    if (m.shape[0] === 2 && m.shape[2] === MARKS.select.stroke && m.colour[3] === 1) {
      for (const [x, y] of strokeSamples(m)) { const o = pixelAt(x, y); if (o < 0) continue; solid++; if (!exact(night.px, o, pencil) || !exact(day.px, o, pencil)) solidOff++; }
    }
    if (m.shape[0] === 7) {
      const o = pixelAt(m.centre[0], m.centre[1]);
      if (o >= 0) { tape++; if (lum(night.px, o) < lum(day.px, o) - 20) tapeDarker++; }
    }
  });
  const ok = solid > 0 && solidOff === 0 && tape > 0 && tapeDarker === tape;
  console.log(`  ${ok ? "PASS" : "FAIL"}  unlit      ${sc.name.padEnd(24)} the pencil's byte by night and by day on ${solid - solidOff}/${solid} solid samples · the tape moonlit (darker than by day) at ${tapeDarker}/${tape} strips`);
  return ok;
}

/**
 * MINIMAT.md §4 for a PRINT, as pixels — a print inside a mini mat's face is lit by the lamp of the desk the mini mat lies on (the
 * photo pass's LIT_ELSEWHERE pipeline): over the print's sheet (4 device px in), its SHADE (gobo on ÷ off) follows the bare desk's
 * own shade at the same pixels (r ≥ 0.9); the control — the inside under its own lamp — does not (lower by 0.2 or more).
 */
async function litCheck(sc) {
  const s = sc.scene;
  const off = { ...s, mat: { ...s.mat, opacity: 0 } };
  const [{ px: MA }, { px: MB }, { px: DA }, { px: DB }, { px: OA }, { px: OB }] = [await render(s), await render(off), await render({ ...s, minimats: [] }), await render({ ...off, minimats: [] }), await render(s, { ownLitInsides: true }), await render(off, { ownLitInsides: true })];
  const m = s.minimats[0];
  const cam = { x: s.camX, y: s.camY, zoom: s.zoom };
  const view = insideView(matGeometry(m), contentOf(insideOf(m)), cam, VP, FIT, s.portalGate ?? PORTAL_GATE);
  const G = printOf(insideOf(m).prints[0]).geometry;
  const k = 1 / (view.cam.zoom * VIEW.dpr);   // the inside's world units per device px
  const shade = (A, B, o) => lum(A, o) / Math.max(lum(B, o), 1);
  const xs = [];
  const ys = [];
  const zs = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const wx = (x + 0.5) * k + view.cam.x;
    const wy = (y + 0.5) * k + view.cam.y;
    if (!(sdPrint(G, wx, wy) < -4 * k)) continue;
    const o = (y * W + x) * 4;
    xs.push(shade(DA, DB, o)); ys.push(shade(MA, MB, o)); zs.push(shade(OA, OB, o));
  }
  const corr = (a, b) => {
    const n = a.length;
    const ma = a.reduce((p, v) => p + v, 0) / n;
    const mb = b.reduce((p, v) => p + v, 0) / n;
    let c = 0;
    let va = 0;
    let vb = 0;
    for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
    return c / Math.sqrt(va * vb + 1e-12);
  };
  const host = corr(xs, ys);
  const own = corr(xs, zs);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of xs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const ok = xs.length > 10000 && view.presence === 1 && hi - lo > 0.2 && host >= 0.9 && own < host - 0.2;
  console.log(`  ${ok ? "PASS" : "FAIL"}  lit        ${sc.name.padEnd(24)} over ${xs.length.toLocaleString()} px of the print through the face (presence ${view.presence}; the desk's shade spans ${(hi - lo).toFixed(2)}): the print's shade follows the desk's at r = ${host.toFixed(3)}; lit by its own lamp instead, r = ${own.toFixed(3)}`);
  return ok;
}

// ---------------------------------------------------------------- the notebooks and the desk calendars (design-015 D3r-b)

/** Is a device pixel inside a device-px box [x, y, w, h]? */
const inBox = (b, x, y) => x >= b[0] && x < b[0] + b[2] && y >= b[1] && y < b[1] + b[3];

/**
 * NOTEBOOK.md §9, as pixels — the books are ONE layer laid inside their screen box: the same still with its books and without,
 * (1) outside the box the pass lays (`screenBox`: the books and their shadows' reach, device px) byte for byte; (2) inside it the
 * books and their shadows change the frame.
 */
async function bookCheck(sc) {
  const s = sc.scene;
  const { px: A } = await render(s);
  const box = desk.notebooks.screenBox;
  const { px: B } = await render({ ...s, books: [] });
  if (!box) { console.log(`  FAIL  book       ${sc.name.padEnd(24)} no layer was laid`); return false; }
  let outside = 0;
  let outsideMax = 0;
  let inside = 0;
  let insideDiff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = delta(A, B, (y * W + x) * 4);
    if (!inBox(box, x, y)) { outside++; if (d > outsideMax) outsideMax = d; } else { inside++; if (d > 0) insideDiff++; }
  }
  const ok = outsideMax === 0 && outside > 100000 && insideDiff > inside * 0.3;
  console.log(`  ${ok ? "PASS" : "FAIL"}  book       ${sc.name.padEnd(24)} outside the books' box [${box.join(", ")}] maxΔ ${outsideMax}/255 over ${outside.toLocaleString()} px · inside it ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} differ`);
  return ok;
}

/**
 * design-015 §4.2 for a COMPOSITE kind, as pixels — the books' layer is the things' LAST run: (1) a note laid before the book and a
 * note laid after it give the same frame, byte for byte; (2) where the book is opaque (its coverage with the mat under it switched
 * off — the pass's debug bit 64 — 2 device px in) and the note lies under it, the frame is the book alone: the note never shows.
 */
async function bookOrderCheck(sc) {
  const s = sc.scene;
  const things = thingsOf(s);
  const { px: R1 } = await render(s);
  const { px: R2 } = await render({ ...s, things: [...things].reverse() });
  let orderMax = 0;
  for (let o = 0; o < R1.length; o += 4) { const d = delta(R1, R2, o); if (d > orderMax) orderMax = d; }
  const books = things.filter((t) => t.kind === "book");
  const notes = things.filter((t) => t.kind === "note");
  const { px: D } = await render({ ...s, things: [] });
  const { px: N } = await render({ ...s, things: notes });
  const { px: Bk } = await render({ ...s, things: books });
  desk.notebooks.debug = 64;   // the books alone in their layer: no mat under them, so what differs from the bare desk is the books
  const { px: C } = await render({ ...s, things: books });
  desk.notebooks.debug = 0;
  const cover = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) cover[i] = delta(C, D, i * 4) > 0 ? 1 : 0;
  const core = (x, y) => { for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const X = x + u; const Y = y + v; if (X < 0 || Y < 0 || X >= W || Y >= H || !cover[Y * W + X]) return false; } return true; };
  let under = 0;
  let underMax = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (delta(N, D, o) === 0 || !core(x, y)) continue;   // where the note lies, and the book is opaque over it
    under++;
    const d = delta(R1, Bk, o);
    if (d > underMax) underMax = d;
  }
  const ok = orderMax === 0 && underMax === 0 && under > 1000;
  console.log(`  ${ok ? "PASS" : "FAIL"}  bookOrder  ${sc.name.padEnd(24)} the note before the book and after it: maxΔ ${orderMax}/255 · where the book lies opaque over the note (${under.toLocaleString()} px) the frame is the book alone: maxΔ ${underMax}/255`);
  return ok;
}

/**
 * CALENDAR.md §6, as pixels — the pads are ONE layer laid beneath everything: the same still with its pads and without, (1) outside the
 * box the pass lays (`screenBox`, device px) byte for byte; (2) inside it the pads change the frame.
 */
async function padCheck(sc) {
  const s = sc.scene;
  const { px: A } = await render(s);
  const box = desk.calendars.screenBox;
  const { px: B } = await render({ ...s, calendars: [] });
  if (!box) { console.log(`  FAIL  pad        ${sc.name.padEnd(24)} no layer was laid`); return false; }
  let outside = 0;
  let outsideMax = 0;
  let inside = 0;
  let insideDiff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = delta(A, B, (y * W + x) * 4);
    if (!inBox(box, x, y)) { outside++; if (d > outsideMax) outsideMax = d; } else { inside++; if (d > 0) insideDiff++; }
  }
  const ok = outsideMax === 0 && outside > 50000 && insideDiff > inside * 0.5;
  console.log(`  ${ok ? "PASS" : "FAIL"}  pad        ${sc.name.padEnd(24)} outside the pads' box [${box.join(", ")}] maxΔ ${outsideMax}/255 over ${outside.toLocaleString()} px · inside it ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} differ`);
  return ok;
}

/**
 * THE PRINT (D3t-c), as pixels — the committed print a still pins (prints.mjs; rig:world holds the live print to its bytes) is
 * what the pads show: the frame with it and the same frame with every month blank differ inside the pads' box alone (outside it
 * maxΔ 0), over the print's ink; mid-roll BOTH sheets carry theirs — each month blanked alone changes the frame.
 */
async function printCheck(sc) {
  const s = sc.scene;
  const months = Object.keys(s.calendars[0].print ?? {});
  const keeping = (keep) => ({ ...s, calendars: s.calendars.map((c) => ({ ...c, print: Object.fromEntries(Object.entries(c.print ?? {}).filter(([m]) => keep.includes(m))) })) });
  const { px: A } = await render(s);
  const box = desk.calendars.screenBox;
  const { px: B } = await render(keeping([]));
  let outside = 0;
  let inked = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = delta(A, B, (y * W + x) * 4);
    if (!inBox(box, x, y)) { if (d > outside) outside = d; } else if (d > 0) inked++;
  }
  let ok = outside === 0 && inked > 30000;
  let each = "";
  if (sc.bothSheets) {
    for (const m of months) {
      const { px: C } = await render(keeping(months.filter((k) => k !== m)));
      let n = 0;
      for (let i = 0; i < W * H; i++) if (delta(A, C, i * 4) > 0) n++;
      each += ` · ${m} blanked alone: ${n.toLocaleString()} px change`;
      ok &&= n > 10000;
    }
  }
  console.log(`  ${ok ? "PASS" : "FAIL"}  print      ${sc.name.padEnd(24)} the committed print vs every month blank: outside the pads' box maxΔ ${outside}/255 · inside it ${inked.toLocaleString()} px of ink${each}`);
  return ok;
}

/**
 * design-015 §4.2 for the PADS, as pixels — a note stuck to a day lies ON the pad: (1) the pads listed before the things and after
 * them give the same frame, byte for byte (the pads are the first stratum whatever the list says); (2) inside every note's sheet
 * (1.5 device px in) the frame is the same notes with no pad under them — the pad beneath a note leaves the note's pixels alone.
 */
async function padNoteCheck(sc) {
  const s = sc.scene;
  const notes = thingsOf(s).filter((t) => t.kind === "note").map(({ pin: _pin, kind: _kind, ...n }) => n);   // where the pins put them
  const { px: A } = await render(s);
  const { px: A2 } = await render({ ...s, padsFirst: true });
  const { px: B } = await render({ ...s, calendars: [], notes });
  let orderMax = 0;
  for (let o = 0; o < A.length; o += 4) { const d = delta(A, A2, o); if (d > orderMax) orderMax = d; }
  const geoms = notes.map((n) => noteGeometry(n));
  const k = 1 / (s.zoom * VIEW.dpr);
  let on = 0;
  let onMax = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [wx, wy] = worldAt(s, x, y);
    if (!geoms.some((G) => sdPaper(G, wx, wy) < -1.5 * k)) continue;
    on++;
    const d = delta(A, B, (y * W + x) * 4);
    if (d > onMax) onMax = d;
  }
  const ok = orderMax === 0 && onMax === 0 && on > 10000;
  console.log(`  ${ok ? "PASS" : "FAIL"}  padNote    ${sc.name.padEnd(24)} the pads before the things and after them: maxΔ ${orderMax}/255 · on the ${notes.length} notes' sheets (${on.toLocaleString()} px) the frame is the notes with no pad: maxΔ ${onMax}/255`);
  return ok;
}

// ---------------------------------------------------------------- run

const only = process.env.ORACLE_ONLY ? new RegExp(process.env.ORACLE_ONLY) : null;
const scenes = only ? ORACLE_SCENES.filter((sc) => only.test(sc.name)) : ORACLE_SCENES;
let failed = 0;
/**
 * THE TRAY (design-017, K3) as pixels: beyond the drawer and its shadows' reach the frame is the tray-less frame dimmed — every byte
 * × (1 − dim), the premultiplied black laid over it, to the rounding — and the drawer's face is the pegboard's: its holes darken a
 * stadium's share of it (0.157 of a cell).
 */
async function trayCheck(sc) {
  const s = sc.scene;
  const { px: A, w, h } = await render(s, { marks: true });
  const laid = desk.tray.laid;
  const { tray: _tray, ...bare } = s;
  const { px: B } = await render(bare, { marks: true });
  const d = (s.view ?? VIEW).dpr;
  const reach = 3 * 18 + 8 + 2;   // the lamp's shadow's σ, its push, and a pixel's margin (tray/drawer.ts DRAWER.shadow)
  const r = laid.rect;
  let outside = 0;
  let worst = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x / d;
      const cy = y / d;
      if (cx > r.x - reach && cx < r.x + r.w + reach && cy > r.y - reach) continue;
      outside++;
      for (let c = 0; c < 3; c++) { const i = (y * w + x) * 4 + c; worst = Math.max(worst, Math.abs((A[i] ?? 0) - (B[i] ?? 0) * (1 - laid.dim))); }
    }
  }
  // a hole is darker than 0.6 of the face's own median — by day and under the Moon alike
  const lum = (i) => 0.2126 * (A[i] ?? 0) + 0.7152 * (A[i + 1] ?? 0) + 0.0722 * (A[i + 2] ?? 0);
  const ls = [];
  for (let y = Math.ceil((r.y + 40) * d); y < h; y += 2) for (let x = Math.ceil((r.x + 40) * d); x < (r.x + r.w - 40) * d; x += 2) ls.push(lum((y * w + x) * 4));
  const face = ls.length;
  const median = [...ls].sort((a, b) => a - b)[Math.floor(face / 2)] ?? 0;
  const holes = ls.filter((l) => l < 0.6 * median).length / Math.max(face, 1);
  const ok = outside > 0 && worst <= 1 && (face < 4000 || (holes > 0.12 && holes < 0.19));
  console.log(`  ${ok ? "PASS" : "FAIL"}  tray       ${sc.name.padEnd(24)} beyond the drawer ${outside.toLocaleString()} px = the desk × ${(1 - laid.dim).toFixed(2)} (max |Δ| ${worst.toFixed(2)}) · the face ${face.toLocaleString()} px, holes ${(holes * 100).toFixed(1)} %`);
  return ok;
}

/** THE GOLDEN (design-015 D7): every scene's pixels, pinned by sha-256 in the committed oracle/shas.json. */
const GOLDEN = resolve(root, "oracle/shas.json");
const bless = process.env.ORACLE_BLESS === "1";
const golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, "utf8")) : {};
const drawnShas = {};
let goldenOff = 0;
for (const sc of scenes) {
  const t1 = performance.now();
  const { px, nav, portals, stats } = await render(sc.scene, { marks: true });
  writeFileSync(resolve(results, `oracle-${sc.name}.rgba`), px);
  const sha = createHash("sha256").update(px).digest("hex");
  drawnShas[sc.name] = sha;
  if (!bless && golden[sc.name] !== sha) {
    goldenOff += 1;
    console.log(`  FAIL  golden     ${sc.name.padEnd(24)} ${golden[sc.name] === undefined ? "has no entry in oracle/shas.json" : `drew ${sha.slice(0, 12)}, the golden is ${golden[sc.name].slice(0, 12)}`}`);
  }
  const flight = nav ? ` · ${nav.f.kind} p ${sc.scene.nav.p}${nav.f.frozen ? " FROZEN" : ""} · in ${nav.pres.incoming.opacity.toFixed(2)}${nav.pres.incoming.objects !== undefined ? ` (objects ${nav.pres.incoming.objects.toFixed(2)})` : ""} out ${nav.pres.outgoing.opacity.toFixed(2)}` : "";
  const things = thingsOf(sc.scene);
  const count = (kind) => things.filter((t) => t.kind === kind).length;
  console.log(`${sc.name.padEnd(28)} ${(sc.scene.minimats ?? []).length} mini mats · ${count("note")} notes${count("board") ? ` · ${count("board")} boards` : ""}${count("print") ? ` · ${count("print")} prints` : ""}${count("book") ? ` · ${count("book")} books` : ""}${sc.scene.calendars?.length ? ` · ${sc.scene.calendars.length} pads` : ""} · ${portals} live insides · ${sc.scene.theme.padEnd(5)} · ${(performance.now() - t1).toFixed(0)} ms · k0 ${stats.k0}${stats.wind ? " · wind" : ""}${flight}`);
  if (sc.baseline && process.env.BASELINE_DIR && !(await baselineCheck(sc, px))) failed += 1;
}
/**
 * design-015 §8 (D4b), the opening as pixels: at a carry of 0 the frame is the REST frame byte for byte (the held path is never
 * taken); above 0, outside the held object's box on screen (the shown extent, grown by the kind's reach and the risen book's long
 * shadow) the frame equals the BLURRED DESK ALONE (the same still with the hand drawn empty) to the byte — the desk copy is one
 * render, the hand is laid over it; inside the box the object is there (a share of the pixels differ from the empty hand); and two
 * renders of the same still are identical (the copy path is deterministic).
 */
async function heldCheck(sc) {
  const s = sc.scene;
  const e = s.hold.e;
  const { px: A, w, h } = await render(s);
  const label = `held       ${sc.name.padEnd(24)}`;
  if (e === 0) {
    const { hold: _h, ...rest } = s;
    const { px: R } = await render(rest);
    let maxD = 0;
    for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i] - R[i]); if (d > maxD) maxD = d; }
    console.log(`  ${maxD === 0 ? "PASS" : "FAIL"}  ${label} carry 0: the rest frame byte for byte (maxΔ ${maxD})`);
    return maxD === 0;
  }
  const f = desk.heldFrame();
  const { px: B } = await render({ ...s, hold: { ...s.hold, empty: true } });
  const { px: A2 } = await render(s);
  const dpr = s.view?.dpr ?? VIEW.dpr;
  // the held box in device px; a differing pixel's EXCURSION past it is the object's reach on screen — its shadow under the lamp, long
  // when a book stands high toward the eye (the slope is capped), short for a flat kind — and must stay within the bound
  const bound = (f.rise > 0 ? 320 : 160) * dpr;
  const bx0 = (f.cx - f.hx) * dpr;
  const by0 = (f.cy - f.hy) * dpr;
  const bx1 = (f.cx + f.hx) * dpr;
  const by1 = (f.cy + f.hy) * dpr;
  let inside = 0; let insideDiff = 0; let same = true; let farthest = 0; let differ = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const d = delta(A, B, o);
    if (A[o] !== A2[o] || A[o + 1] !== A2[o + 1] || A[o + 2] !== A2[o + 2]) same = false;
    const inBox = x >= bx0 && x < bx1 && y >= by0 && y < by1;
    if (inBox) { inside++; if (d > 0) insideDiff++; }
    if (d > 0) { differ++; if (!inBox) farthest = Math.max(farthest, Math.max(bx0 - x, x - bx1, by0 - y, y - by1)); }
  }
  const ok = farthest <= bound && insideDiff > inside * 0.05 && same;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} the object's pixels vs the blurred desk alone: ${differ.toLocaleString()} differ, reaching ${(farthest / dpr).toFixed(0)} CSS px past its box [${Math.round(bx0)}, ${Math.round(by0)}, ${Math.round(bx1)}, ${Math.round(by1)}] (bound ${bound / dpr}) · inside it ${insideDiff.toLocaleString()} of ${inside.toLocaleString()} · twice ${same ? "identical" : "DIFFERENT"} · grow ${f.grow.toFixed(3)} rise ${f.rise.toFixed(1)}`);
  return ok;
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
for (const sc of scenes) if (sc.photo) { if (!(await photoCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.order) { if (!(await orderCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.board) { if (!(await boardCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.ink) { if (!(await inkCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.marks) { if (!(await marksCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.unlit) { if (!(await unlitCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.lit) { if (!(await litCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.book) { if (!(await bookCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.bookOrder) { if (!(await bookOrderCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.pad) { if (!(await padCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.padNote) { if (!(await padNoteCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.printed) { if (!(await printCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.held) { if (!(await heldCheck(sc))) failed += 1; }
for (const sc of scenes) if (sc.trayed) { if (!(await trayCheck(sc))) failed += 1; }
// THE GOLDEN's verdict: every scene drawn as committed — or, blessing, the drawn shas written (ORACLE_ONLY merges its scenes in)
if (bless) {
  const next = only ? { ...golden, ...drawnShas } : drawnShas;
  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  writeFileSync(GOLDEN, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`BLESS  golden     ${Object.keys(drawnShas).length} scene(s) written to oracle/shas.json — commit the diff with its why`);
} else {
  // an entry whose scene is gone is a golden that pins nothing (only on a full run: ORACLE_ONLY draws a subset)
  const stale = only ? [] : Object.keys(golden).filter((k) => !(k in drawnShas));
  console.log(`${goldenOff || stale.length ? "FAIL" : "PASS"}  golden     ${scenes.length - goldenOff} of ${scenes.length} scene(s) drawn byte for byte as oracle/shas.json pins them${stale.length ? ` · ${stale.length} entr${stale.length === 1 ? "y" : "ies"} with no scene: ${stale.slice(0, 5).join(", ")}` : ""}`);
  if (goldenOff || stale.length) failed += 1;
}
// the probe's verdict: creation and every frame drawn above, in scopes of their own
console.log(`${probe.errors.length ? "FAIL" : "PASS"}  error scopes (validation · out-of-memory · internal) over the desk's creation and ${probe.frames} frames: ${probe.errors.length} error${probe.errors.length === 1 ? "" : "s"}${probe.errors.length ? `\n  ${probe.errors.slice(0, 5).join("\n  ")}` : ""}`);
if (probe.errors.length) failed += 1;
if (failed) { console.log(`${failed} check(s) FAILED`); process.exitCode = 1; }
device.destroy();
