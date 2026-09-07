// @vitest-environment node
// The frame builder (design-013 §8 B3a): the world's cards as the ground's
// records. A real engine, a real document, real widgets — the builder reads
// the facts (Position/Size, the sibling order, Selected, Grab, the drop pair
// with the recognizer's DragBounds, Container, the preview snapshot) and runs
// the flux (the springs) outside the world. Pinned: paint order; the cull; a
// live portal from the preview store at rest under the flight's exact camera
// (`portalAt` ≡ `portalOf` on the same arrival — the cut stays bit for bit);
// the reveal, the lift and the heat as springs on world facts; the dirty
// union; a card out of sight forgets its flux; dispose lets the preview go.
import { describe, expect, it } from "vitest";
import {
  ChromeSettings,
  DragBounds,
  DropTarget,
  Grab,
  NO_ENTITY,
  OverlapCandidate,
  OverlapRejected,
  Position,
  Viewport,
  createCanvasEngine,
  defineCanvasType,
  defineContainer,
  defineWidget,
  tools,
  widgets,
  type Entity,
} from "@ice/core";
import { MATERIAL, REST, resolve } from "../../src/card/choreography";
import { PRODUCT, PRODUCT_CORNER } from "../../src/card/sheet";
import { createFrameBuilder, faceOfSnapshot, heatSourceOf, offscreen, portalFaceOf, sizeOf } from "../../src/compose/frame-inputs";
import { DEFAULT_FIELD_CONFIG } from "../../src/field/layout";
import { arrivalCamera, boundsOf, FIT } from "../../src/nav/flight";
import { FOLDER_FACE, PORTAL_GATE, portalAt, portalOf } from "../../src/nav/portal";
import { THEMES } from "../../oracle/fixtures/vf-theme";
import { must } from "./must";

// One widget type per FILE (global registry; no test reset).
const CARD = widgets.get("fb:card") ?? defineWidget({ type: "fb:card", surface: "dom", component: null, defaultSize: { w: 200, h: 120 } });
const INSIDE = defineCanvasType({
  id: "fb:inside",
  semanticVersion: 1,
  semantic: { placement: { widgets: [CARD] } },
  // the ground's FIT band, so the preview's arrival is the flight's
  presentation: { camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom } },
});
const FOLDER = widgets.get("fb:folder") ?? defineContainer({
  type: "fb:folder", canvas: INSIDE, component: null, defaultSize: { w: 329, h: 345 },
  portal: { top: FOLDER_FACE.top, right: FOLDER_FACE.right, bottom: FOLDER_FACE.bottom, left: FOLDER_FACE.left }, provides: ["widget"],
});
const ROOT = defineCanvasType({
  id: "fb:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [CARD, FOLDER] } },
  presentation: { camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom } },
});

// typed Canvas SDK mode (a container with a canvas type) wants an explicit tools list
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];

const VP = { width: 1600, height: 900, dpr: 1 };
const CAM = { x: 0, y: 0, zoom: 1 };
const DT = 1 / 60;

function makeBoard() {
  const ce = createCanvasEngine({ widgets: [CARD, FOLDER], canvasTypes: [ROOT, INSIDE], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS, settings: { chrome: { liftScale: 1.05 } } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: 1 });
  const a = ce.ops.spawnWidget("fb:card", { x: 100, y: 100, w: 200, h: 120, undoable: false });
  const b = ce.ops.spawnWidget("fb:card", { x: 400, y: 100, w: 200, h: 120, undoable: false });
  const far = ce.ops.spawnWidget("fb:card", { x: 5000, y: 5000, w: 200, h: 120, undoable: false });
  const folder = ce.ops.spawnWidget("fb:folder", { x: 700, y: 100, w: 329, h: 345, undoable: false });
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  ce.world.sync();
  step(); // the container compiles on a tick before it can take children
  const c1 = ce.ops.spawnWidget("fb:card", { x: 0, y: 0, w: 200, h: 120, parent: folder, undoable: false });
  const c2 = ce.ops.spawnWidget("fb:card", { x: 300, y: 200, w: 200, h: 120, parent: folder, undoable: false });
  ce.world.sync();
  step(5); // membership stamps Active at root
  const builder = createFrameBuilder(ce.world, { previews: ce.previews });
  const build = (cam = CAM, dt = DT) => builder.build(cam, VP, dt, THEMES.dark, DEFAULT_FIELD_CONFIG);
  /** Build until the springs settle (bounded). */
  const settle = (cam = CAM): number => { let n = 0; do { build(cam); n += 1; } while (builder.live() && n < 600); return n; };
  return { ce, world: ce.world, step, builder, build, settle, a, b, far, folder, c1, c2 };
}

describe("the frame builder · the board (design-013 §8 B3a)", () => {
  it("draws every Active card on screen in paint order, over the theme's plate, with a source each; the far card is culled", () => {
    const { builder, build, a, b, folder } = makeBoard();
    const f = build();
    expect(f.stats.active).toBe(4);            // a, b, far, folder — the folder's children are its inside, not Active here
    expect(f.stats.cards).toBe(3);             // far is off screen
    expect(f.frames).toHaveLength(3);
    expect(f.sources).toHaveLength(3);
    expect(must(f.frames[0]).geometry.centre).toEqual([200, 160]);
    expect(must(f.frames[1]).geometry.centre).toEqual([500, 160]);
    expect(must(f.frames[2]).geometry.centre).toEqual([864.5, 272.5]);
    for (const fr of f.frames) expect(fr.surface).toBe(THEMES.dark.card);
    // the source is the resolved silhouette in screen px
    const s0 = must(f.sources[0]);
    const G = must(builder.geometryOf(a));
    expect([s0.cx, s0.cy, s0.hx, s0.hy, s0.r, s0.strength]).toEqual([G.centre[0], G.centre[1], G.half[0], G.half[1], G.outerR, 1]);
    expect(builder.geometryOf(b)).toBeDefined();
    expect(builder.geometryOf(folder)).toBeDefined();
    expect(builder.stats().portals).toBe(1);
  });

  it("a card at rest resolves as REST: reveal 0, no ring, the resting shadow, scale 1", () => {
    const { build, builder, a } = makeBoard();
    build();
    const G = must(builder.geometryOf(a));
    const rest = resolve(PRODUCT, { centre: [200, 160], contentHalf: [100, 60], radius: PRODUCT_CORNER.radius }, { ...REST, reveal: 0 }, MATERIAL);
    expect(G).toEqual(rest);
    expect(G.ring).toBe(0);
    expect(G.scale).toBe(1);
    expect(G.shadowSigma).toBe(MATERIAL.shadow.rest.sigma);
  });

  it("the container is a HOLE cut to its face, and its portal is the preview's inside at rest under the flight's exact camera", () => {
    const { ce, build, folder, c1, c2 } = makeBoard();
    const f = build();
    expect(f.portals).toHaveLength(1);
    const p = must(f.portals[0]);
    expect(p.at).toBe(2);                                   // the folder's index among the frames
    const hole = must(f.frames[2]);
    expect(hole.content).toEqual({ mode: "portal", face: { cx: 864.5, cy: 259.5, hx: 154.5, hy: 149.5, r: FOLDER_FACE.radius } });
    expect(p.plate).toBe(THEMES.dark.card);
    const present = must(p.present, "the portal's presentation");
    expect(present.opacity).toBe(1);                        // 309×299 CSS px on screen: past the gate
    expect(present.portal).toEqual({ cx: 864.5, cy: 259.5, hx: 154.5, hy: 149.5, r: FOLDER_FACE.radius });
    expect(p.frames).toHaveLength(2);
    expect(p.sources).toHaveLength(2);
    // the inside at REST: each child's geometry is the resting resolve of its rect in the inside's frame
    const r1 = resolve(PRODUCT, { centre: [100, 60], contentHalf: [100, 60], radius: PRODUCT_CORNER.radius }, REST, MATERIAL);
    expect(must(p.frames[0]).geometry).toEqual(r1);
    expect(must(p.frames[1]).geometry.centre).toEqual([400, 260]);
    // the flight's own camera: `portalOf` on the same content bounds lands on the same record, bit for bit
    const K = { x: 710, y: 110, width: 309, height: 299 };
    const snap = ce.previews.snapshot(folder);
    const content = boundsOf([{ x: 0, y: 0, width: 200, height: 120 }, { x: 300, y: 200, width: 200, height: 120 }]);
    expect(snap.resolvedView).toEqual(arrivalCamera(content, VP, FIT));
    const viaFlight = must(portalOf(K, FOLDER_FACE.radius, content, CAM, VP, FIT, PORTAL_GATE));
    const viaPreview = must(portalAt(K, FOLDER_FACE.radius, snap.resolvedView, CAM, VP, PORTAL_GATE));
    expect(viaPreview).toEqual(viaFlight);
    expect([p.view.camX, p.view.camY, p.view.zoom]).toEqual([viaFlight.cam.x, viaFlight.cam.y, viaFlight.cam.zoom]);
    expect(p.view.box).toEqual(viaFlight.box);
    expect(p.lodZoom).toBe(viaFlight.arrival.zoom);         // dressed for its arrival (PORTAL.md §9)
    expect(p.config).toBe(DEFAULT_FIELD_CONFIG);
    expect(ce.previews.stats().activeFrames).toBe(1);        // the builder holds the one subscription
    expect(c1).not.toBe(c2);
  });

  it("under the gate the container is a plate: zoomed out, no portal, no hole, no subscription needed", () => {
    const { build, builder } = makeBoard();
    const f = build({ x: 0, y: 0, zoom: 0.2 });              // the face's short side: 299 × 0.2 ≈ 60 CSS px < 80
    expect(f.portals).toHaveLength(0);
    expect(f.frames.every((fr) => fr.content === undefined)).toBe(true);
    expect(builder.stats().containers).toBe(1);
  });

  it("selection is a spring: the reveal rises to 1 and the ring arrives; settled, the builder is no longer live", () => {
    const { ce, build, builder, settle, a, step } = makeBoard();
    build();
    expect(must(builder.motionOf(a)).reveal).toBe(0);
    ce.ops.setSelection([a]);
    step();
    const first = build();
    expect(first.stats.live).toBe(true);
    const m = must(builder.motionOf(a));
    expect(m.selected).toBe(true);
    expect(m.reveal).toBeGreaterThan(0);
    expect(m.reveal).toBeLessThan(1);
    const n = settle();
    expect(n).toBeLessThan(600);
    expect(builder.live()).toBe(false);
    expect(must(builder.motionOf(a)).reveal).toBe(1);
    expect(must(builder.geometryOf(a)).ring).toBe(1);
    // settled and selected, the board is quiet: no dirt from the frames that follow
    builder.changed();
    step(3);
    expect(builder.changed()).toBe(false);
    // deselect: back to 0
    ce.ops.setSelection([]);
    step();
    settle();
    expect(must(builder.motionOf(a)).reveal).toBe(0);
  });

  it("Grab IS the lift: the card scales by ChromeSettings.liftScale and takes the lifted shadow; losing Grab sets it down", () => {
    const { world, build, builder, settle, a } = makeBoard();
    build();
    expect(world.getResource(ChromeSettings)?.liftScale).toBe(1.05);
    world.addComponent(a, Grab, { x: 100, y: 100, w: 200, h: 120, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
    settle();
    const m = must(builder.motionOf(a));
    expect(m.held).toBe(true);
    expect(m.lift).toBe(1);
    const G = must(builder.geometryOf(a));
    expect(G.scale).toBeCloseTo(1.05, 12);
    expect(G.half).toEqual([100 * 1.05, 60 * 1.05]);   // unrevealed: no chrome band yet, the outer box IS the content box, lifted
    expect(G.shadowSigma).toBeCloseTo(MATERIAL.shadow.lifted.sigma * 1.05, 12);
    expect(G.frameAlpha).toBe(MATERIAL.lift.opacity);
    world.removeComponent(a, Grab);
    settle();
    expect(must(builder.motionOf(a)).lift).toBe(0);
    expect(must(builder.geometryOf(a)).scale).toBe(1);
  });

  it("the heat is the drop pair + the recognizer's DragBounds: accept lights at tier 1, reject at tier 0, clear fades out", () => {
    const { world, build, builder, settle, a, b } = makeBoard();
    build();
    // a recognizer targeting b, carrying the dragged set's post-move union (a's rect, moved over b)
    const rec = world.spawn({ components: [[DragBounds, { minX: 380, minY: 90, maxX: 580, maxY: 210 }]] });
    world.setRelation(rec, DropTarget, b);
    world.addTag(b, OverlapCandidate);
    settle();
    const m = must(builder.motionOf(b));
    expect(m.hotTarget).toBe(true);
    expect(m.hotTier).toBe(1);
    expect(m.hot).toBe(1);
    expect(m.tierK).toBe(1);
    expect(m.hotAt).toEqual([480, 150]);
    const T = PRODUCT.thickness;
    expect(m.hotHalf).toEqual([(100 + T) * 1.05, (60 + T) * 1.05]);
    expect(m.hotR).toBe((PRODUCT.outerR ?? PRODUCT_CORNER.radius + T) * 1.05);
    const G = must(builder.geometryOf(b));
    expect(G.hot).toEqual([480, 150, 1, 1]);
    expect(G.src).toEqual([(100 + T) * 1.05, (60 + T) * 1.05, m.hotR, 0]);
    expect(builder.motionOf(a)?.hotTarget).toBe(false);
    // the source follows the drag: a DragBounds write moves the light
    world.edit(rec).set(DragBounds, { minX: 400, minY: 100, maxX: 600, maxY: 220 });
    build();
    expect(must(builder.motionOf(b)).hotAt).toEqual([500, 160]);
    // reject: the tier cross-fades to 0 while the light stays
    world.removeTag(b, OverlapCandidate);
    world.addTag(b, OverlapRejected);
    settle();
    expect(must(builder.motionOf(b)).hotTier).toBe(0);
    expect(must(builder.motionOf(b)).tierK).toBe(0);
    expect(must(builder.geometryOf(b)).hot[2]).toBe(1);
    // clear: the presence springs out; the source is held for the fade
    world.removeTag(b, OverlapRejected);
    world.removeRelation(rec, DropTarget);
    const mid = build();
    expect(mid.stats.live).toBe(true);
    expect(must(builder.motionOf(b)).hotAt).toEqual([500, 160]);
    settle();
    expect(must(builder.motionOf(b)).hot).toBe(0);
    expect(must(builder.geometryOf(b)).hot[2]).toBe(0);
  });

  it("the dirt is pulled, entity-exact: a move, a selection, a Grab, a drop tag, a DragBounds write dirty it; a quiet frame — even a SELECTED one — does not", () => {
    const { ce, world, builder, build, step, a, b } = makeBoard();
    build();
    const fire = (f: () => void): boolean => { f(); ce.world.sync(); step(); return builder.changed(); };
    expect(fire(() => {})).toBe(false);
    expect(fire(() => world.edit(a).set(Position, { x: 105, y: 100 }))).toBe(true);
    expect(fire(() => {})).toBe(false);
    expect(fire(() => ce.ops.setSelection([b]))).toBe(true);
    // THE claim behind idle-zero: the selection chrome runs every frame a selection exists and DECLARES a
    // Position/Size write (a column-wide stamp for a Tier-1 observer) — the journal sees no entity change
    expect(fire(() => {})).toBe(false);
    expect(fire(() => {})).toBe(false);
    expect(fire(() => world.addComponent(a, Grab, { x: 105, y: 100, w: 200, h: 120, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 }))).toBe(true);
    expect(fire(() => world.addTag(b, OverlapCandidate))).toBe(true);
    let rec = 0 as Entity;
    expect(fire(() => { rec = world.spawn({ components: [[DragBounds, { minX: 0, minY: 0, maxX: 10, maxY: 10 }]] }); })).toBe(true);
    expect(fire(() => world.edit(rec).set(DragBounds, { minX: 1, minY: 0, maxX: 11, maxY: 10 }))).toBe(true);
    expect(fire(() => world.removeTag(b, OverlapCandidate))).toBe(true);
    expect(fire(() => world.removeComponent(a, Grab))).toBe(true);
    expect(fire(() => {})).toBe(false);
    // the out-of-world wake: a settings write
    let wakes = 0;
    const off = builder.observe(() => { wakes += 1; });
    expect(fire(() => world.setResource(ChromeSettings, { liftScale: 1.1 }))).toBe(false);
    expect(wakes).toBe(1);
    off();
    expect(builder.wakes().world).toBeGreaterThan(0);
    expect(builder.wakes().chrome).toBe(1);
  });

  it("a container's preview change wakes the builder on the next microtask", async () => {
    const { ce, builder, build, c1 } = makeBoard();
    build();
    let wakes = 0;
    builder.observe(() => { wakes += 1; });
    ce.world.edit(c1).set(Position, { x: 10, y: 0 });
    ce.world.sync();
    ce.step(2000);
    await Promise.resolve();
    await Promise.resolve();
    expect(wakes).toBeGreaterThan(0);
    const f = build();
    expect(must(must(f.portals[0]).frames[0]).geometry.centre).toEqual([110, 60]);
  });

  it("a card out of sight forgets its flux; back in sight it starts from rest — and pan is the camera alone", () => {
    const { ce, build, builder, settle, a, far, step } = makeBoard();
    ce.ops.setSelection([a]);
    step();
    settle();
    expect(must(builder.motionOf(a)).reveal).toBe(1);
    const away = build({ x: 4800, y: 4800, zoom: 1 });
    expect(away.stats.cards).toBe(1);                         // only `far`
    expect(builder.geometryOf(far)).toBeDefined();
    expect(builder.motionOf(a)).toBeUndefined();               // forgotten
    build();
    expect(must(builder.motionOf(a)).reveal).toBe(1);          // selected on return: reveal pinned at its target, no re-animation
    expect(builder.motionOf(far)).toBeUndefined();
  });

  it("dispose lets the preview subscription go", () => {
    const { ce, build, builder } = makeBoard();
    build();
    expect(ce.previews.stats().activeFrames).toBe(1);
    builder.dispose();
    expect(ce.previews.stats().activeFrames).toBe(0);
    expect(build().frames).toHaveLength(0);
  });
});

describe("the frame builder · the pure parts", () => {
  it("portalAt is portalOf past the gate: the same arrival, the same record, bit for bit", () => {
    const vp = { width: 1200, height: 800 };
    const cam = { x: 13.7, y: -21.3, zoom: 1.37 };
    const K = { x: 412.5, y: 233.25, width: 329, height: 345 };
    for (const content of [{ x: -40, y: -20, width: 700, height: 300 }, { x: 3, y: 3, width: 5000, height: 20 }, null]) {
      const a = portalOf(K, 7, content, cam, vp, FIT);
      const b = portalAt(K, 7, arrivalCamera(content, vp, FIT), cam, vp);
      expect(b).toEqual(a);
    }
    // under the gate both are null; a face with no area too
    expect(portalAt(K, 7, arrivalCamera(null, vp, FIT), { x: 0, y: 0, zoom: 0.1 }, vp)).toBeNull();
    expect(portalAt({ ...K, width: 0 }, 7, arrivalCamera(null, vp, FIT), cam, vp)).toBeNull();
  });

  it("faceOfSnapshot: authored insets → the face at the card's position with the face radius; the whole body → the card's radius", () => {
    const pos = { x: 700, y: 100 };
    const size = { w: 329, h: 345 };
    const inset = faceOfSnapshot(pos, size, { portal: { x: 10, y: 10, width: 309, height: 299 } }, 22, 7);
    expect(inset).toEqual({ K: { x: 710, y: 110, width: 309, height: 299 }, r: 7 });
    const whole = faceOfSnapshot(pos, size, { portal: { x: 0, y: 0, width: 329, height: 345 } }, 22, 7);
    expect(whole).toEqual({ K: { x: 700, y: 100, width: 329, height: 345 }, r: 22 });
    expect(portalFaceOf(inset.K, inset.r)).toEqual({ cx: 864.5, cy: 259.5, hx: 154.5, hy: 149.5, r: 7 });
  });

  it("offscreen: the margin keeps a card just past the edge (its shadow and reach still land inside)", () => {
    const vp = { width: 1000, height: 600 };
    const cam = { x: 0, y: 0, zoom: 1 };
    expect(offscreen([-150, 300], [100, 50], 0, cam, vp)).toBe(true);
    expect(offscreen([-150, 300], [100, 50], 60, cam, vp)).toBe(false);
    expect(offscreen([-150, 300], [100, 50], 49, cam, vp)).toBe(true);
    expect(offscreen([500, 300], [100, 50], 0, { x: 2000, y: 0, zoom: 1 }, vp)).toBe(true);
    expect(offscreen([500, 300], [100, 50], 0, { x: 0, y: 0, zoom: 0.5 }, vp)).toBe(false);
  });

  it("heatSourceOf: the union grown by the thickness, scaled by the lift, at the revealed outer radius; empty bounds → null", () => {
    const { world, b } = makeBoard();
    expect(heatSourceOf(world, b, PRODUCT, 22, 1.05)).toBeNull();
    const rec = world.spawn({ components: [[DragBounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 }]] });
    world.setRelation(rec, DropTarget, b);
    expect(heatSourceOf(world, b, PRODUCT, 22, 1.05)).toBeNull();
    world.edit(rec).set(DragBounds, { minX: 10, minY: 20, maxX: 110, maxY: 80 });
    const T = PRODUCT.thickness;
    expect(heatSourceOf(world, b, PRODUCT, 22, 1.05)).toEqual({ x: 60, y: 50, hx: (50 + T) * 1.05, hy: (30 + T) * 1.05, r: (PRODUCT.outerR ?? 22 + T) * 1.05 });
  });

  it("sizeOf prefers a positive MeasuredSize rider", () => {
    const { world, a } = makeBoard();
    expect(sizeOf(world, a)).toEqual({ w: 200, h: 120 });
    expect(sizeOf(world, 999999 as Entity)).toBeUndefined();
  });
});
