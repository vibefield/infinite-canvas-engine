// @vitest-environment node
// The flight's second slot (design-013 §8 B7): from the `NavTransition` resource the builder
// draws the DEPARTED frame beside the arriving one — its cards at rest under `departedCameraOf`
// (the pre-cut camera itself at the cut), with their content, the entered container a hole the
// arriving slot draws through (one tree, `at`) on enter, the departed inside OVER the parent on
// exit. Pinned on ICE's own data: the flight's c0 IS the live portal's camera the builder drew
// the frame before (`portalAt` on the preview's arrival — bit for bit), the arriving frame's
// clip IS the portal's clip, the departed frame's records carry their textures.
import { describe, expect, it } from "vitest";
import {
  Camera,
  NavTransition,
  Retained,
  TextureRef,
  Viewport,
  alwaysGpu,
  createCanvasEngine,
  createResidencyStore,
  defineCanvasType,
  defineContainer,
  defineWidget,
  installSurfaceInfra,
  tools,
  widgets,
} from "@ice/core";
import { SHELL_RADIUS } from "../../src/card/geometry";
import { createFrameBuilder, faceOfSnapshot, navFrameOf } from "../../src/compose/frame-inputs";
import { createContentResidency } from "../../src/compose/residency";
import { DEFAULT_FIELD_CONFIG } from "../../src/field/layout";
import { FIT, flightOpacity } from "../../src/nav/flight";
import { clipOf, FOLDER_FACE, PORTAL_GATE, portalAt } from "../../src/nav/portal";
import { THEMES } from "../../oracle/fixtures/vf-theme";
import { must } from "./must";

// One widget type per FILE (global registry; no test reset).
const CARD = widgets.get("fl:card") ?? defineWidget({ type: "fl:card", surface: "dom", component: null, defaultSize: { w: 200, h: 120 } });
const PAGE = widgets.get("fl:page") ?? defineWidget({ type: "fl:page", surface: "dom", component: null, defaultSize: { w: 200, h: 120 }, behaviors: [alwaysGpu] });
const INSIDE = defineCanvasType({
  id: "fl:inside",
  semanticVersion: 1,
  semantic: { placement: { widgets: [CARD] } },
  presentation: { camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom } },
});
const FOLDER = widgets.get("fl:folder") ?? defineContainer({
  type: "fl:folder", canvas: INSIDE, component: null, defaultSize: { w: 329, h: 345 },
  portal: { top: FOLDER_FACE.top, right: FOLDER_FACE.right, bottom: FOLDER_FACE.bottom, left: FOLDER_FACE.left }, provides: ["widget"],
});
const ROOT = defineCanvasType({
  id: "fl:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [CARD, PAGE, FOLDER] } },
  presentation: { camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom } },
});
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];
const VP = { width: 1600, height: 900, dpr: 1 };
const CAM = { x: 0, y: 0, zoom: 1 };
const FOLDER_AT = { x: 700, y: 100, w: 329, h: 345 };

function fakeTexture(name: string): GPUTexture {
  return { format: "rgba8unorm", createView: () => ({ label: name }) as unknown as GPUTextureView, destroy() {} } as unknown as GPUTexture;
}

function makeBoard() {
  const ce = createCanvasEngine({ widgets: [CARD, PAGE, FOLDER], canvasTypes: [ROOT, INSIDE], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: 1 });
  ce.world.setResource(Camera, { ...CAM, gesturing: false });
  const store = createResidencyStore({});
  installSurfaceInfra(ce.engine, { residency: { table: store.table, allocator: store.allocator } });
  const a = ce.ops.spawnWidget("fl:card", { x: 100, y: 100, w: 200, h: 120, undoable: false });
  const page = ce.ops.spawnWidget("fl:page", { x: 400, y: 100, w: 200, h: 120, undoable: false });
  const folder = ce.ops.spawnWidget("fl:folder", { ...FOLDER_AT, undoable: false });
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  ce.world.sync();
  step();
  const c1 = ce.ops.spawnWidget("fl:card", { x: 0, y: 0, w: 200, h: 120, parent: folder, undoable: false });
  const c2 = ce.ops.spawnWidget("fl:card", { x: 300, y: 200, w: 200, h: 120, parent: folder, undoable: false });
  ce.world.sync();
  step(5);
  const residency = createContentResidency(ce.world);
  residency.attach(store.table);
  const builder = createFrameBuilder(ce.world, { previews: ce.previews, residency });
  const cam = () => { const c = ce.world.getResource(Camera); if (c === undefined) throw new Error("no camera"); return { x: c.x, y: c.y, zoom: c.zoom }; };
  const build = () => builder.build(cam(), VP, 1 / 60, THEMES.dark, DEFAULT_FIELD_CONFIG);
  const flight = () => builder.flight(cam(), VP, THEMES.dark, DEFAULT_FIELD_CONFIG);
  const nav = () => must(ce.world.getResource(NavTransition), "NavTransition");
  const settle = (): number => { let n = 0; while (nav().active && n < 600) { step(); n += 1; } return n; };
  const face = () => faceOfSnapshot({ x: FOLDER_AT.x, y: FOLDER_AT.y }, { w: FOLDER_AT.w, h: FOLDER_AT.h }, ce.previews.snapshot(folder), SHELL_RADIUS, FOLDER_FACE.radius);
  return { ce, world: ce.world, step, store, residency, builder, build, flight, cam, nav, settle, face, a, page, folder, c1, c2 };
}

describe("the flight's second slot (design-013 §8 B7)", () => {
  it("at rest there is no flight", () => {
    const { flight } = makeBoard();
    expect(flight()).toBeNull();
  });

  it("an enter's cut frame: the flight starts at the live portal's exact camera; the departed frame draws under the pre-cut camera with the container a hole — one tree through it — and its records carry their textures", () => {
    const b = makeBoard();
    // the departed frame carries a promoted card with a written page: its texture rides into the flight (§10.5)
    b.residency.realize(b.store.table.pages(), fakeTexture("pages"));
    b.residency.wrote(b.page);
    const camPre = b.cam();
    const rest = b.build();
    expect(rest.portals).toHaveLength(1);                                   // the folder's live portal, past the gate
    const face = b.face();
    const lp = must(portalAt(face.K, face.r, b.ce.previews.snapshot(b.folder).resolvedView, camPre, VP, PORTAL_GATE), "the live portal");
    b.ce.ops.enterContainer(b.folder);
    // THE cut: core's c0 is the portal's camera, bit for bit (portalAt on the preview's arrival ≡ outgoingCamera(M, camPre))
    const c0 = b.cam();
    expect(c0).toEqual(lp.cam);
    const t = b.nav();
    expect(t.active).toBe(true);
    expect(t.p).toBe(0);
    // the first tick holds at p = 0: the cut frame the product draws
    b.step();
    expect(b.nav().p).toBe(0);
    expect(b.cam()).toEqual(c0);
    const f = must(b.flight(), "the flight");
    expect(f.kind).toBe("enter");
    expect(f.frozen).toBe(false);
    // the departed frame renders under the pre-cut camera ITSELF
    expect([f.outgoing.view.camX, f.outgoing.view.camY, f.outgoing.view.zoom]).toEqual([camPre.x, camPre.y, camPre.zoom]);
    expect(f.outgoing.lodZoom).toBe(camPre.zoom);
    expect(f.outgoing.order).toBe("under");
    // the arriving frame is seen through the portal's own clip, dressed for its landing
    expect(f.present.portal).toEqual(lp.clip);
    expect(f.present.opacity).toBe(1);
    expect(f.lodZoom).toBe(t.c1z);
    // the departed frame's cards in paint order: a, page, folder — the folder a hole at `at`
    expect(f.outgoing.frames).toHaveLength(3);
    expect(f.outgoing.at).toBe(2);
    expect(f.outgoing.frames[2]?.content?.mode).toBe("portal");
    expect(f.outgoing.frames[0]?.content?.mode).toBe("plate");
    expect(f.outgoing.frames[1]?.content?.mode).toBe("page");               // the departed slot's records carry their textures
    expect(f.outgoing.sources).toHaveLength(3);
    expect(f.outgoing.portals).toBeUndefined();                              // its only container is the one entered
    // the arriving frame is the inside: Active flipped on the cut tick
    expect(b.build().stats.cards).toBe(2);
    expect(navFrameOf(b.world, b.a)).toBeUndefined();
    expect(navFrameOf(b.world, b.c1)).toBe(b.folder);
    // the departed frame is Retained (core) and its page ref survives the flight
    expect(b.world.hasTag(b.page, Retained)).toBe(true);
    const ref0 = must(b.world.get(b.page, TextureRef), "ref");
    b.step(3);
    const mid = must(b.flight(), "the flight mid-way");
    expect(mid.p).toBeGreaterThan(0);
    expect(mid.present.opacity).toBe(flightOpacity("enter", mid.p, false).incoming);
    expect(must(mid.outgoing.present, "the departed presentation").opacity).toBe(flightOpacity("enter", mid.p, false).outgoing);
    expect(must(b.world.get(b.page, TextureRef), "ref")).toEqual(ref0);
    // the landing: one slot again, nothing retained, the camera exactly on the arrival
    b.settle();
    expect(b.flight()).toBeNull();
    expect(b.world.hasTag(b.page, Retained)).toBe(false);
    const t1 = b.nav();
    expect(b.cam()).toEqual({ x: t1.c1x, y: t1.c1y, zoom: t1.c1z });
  });

  it("an exit draws the departed inside OVER the parent, clipped by the face under the arriving camera, and hands back to one slot at the landing", () => {
    const b = makeBoard();
    b.ce.ops.enterContainer(b.folder);
    b.settle();
    expect(b.flight()).toBeNull();
    const innerCam = b.cam();
    b.ce.ops.exitContainer();
    b.step();                                                                  // the cut frame
    const f = must(b.flight(), "the exit flight");
    expect(f.kind).toBe("exit");
    expect(f.outgoing.order).toBe("over");
    expect(f.outgoing.at).toBeUndefined();
    // the departed inside under its own pre-cut camera
    expect([f.outgoing.view.camX, f.outgoing.view.camY, f.outgoing.view.zoom]).toEqual([innerCam.x, innerCam.y, innerCam.zoom]);
    expect(f.outgoing.frames).toHaveLength(2);                                 // c1, c2
    expect(f.outgoing.frames.every((fr) => fr.content?.mode === "plate")).toBe(true);
    // the inside is seen through the container's face under the ARRIVING camera; the arriving frame is whole
    const face = b.face();
    expect(must(f.outgoing.present, "the departed presentation").portal).toEqual(clipOf(face.K, face.r, b.cam()));
    expect(f.present.portal).toBeUndefined();
    expect(b.world.hasTag(b.c1, Retained)).toBe(true);
    expect(b.world.hasTag(b.c2, Retained)).toBe(true);
    // the arriving frame is the root again — at the cut its camera is deep in the folder (the face fills the view), so the
    // parent's other cards are off screen; at the landing all three are back
    expect(b.build().stats.active).toBe(3);
    b.settle();
    expect(b.build().stats.cards).toBe(3);
    expect(b.flight()).toBeNull();
    expect(b.world.hasTag(b.c1, Retained)).toBe(false);
    const t1 = b.nav();
    expect(b.cam()).toEqual({ x: t1.c1x, y: t1.c1y, zoom: t1.c1z });
  });
});
