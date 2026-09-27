// `defineObject` and the kinds' WORLD halves (design-015 §5.2; D2a-world): an object compiles
// through core's `defineWidget` as `surface: "object"` with its kind bound and its stratum the
// kind's; the reference Note and MiniMat are such objects (the mini mat a container whose face is
// its border's inset); `objectKindOf` finds the kind again off the widget type. And each kind's
// world half on the prototype's own laws — the same numbers the oracle's scene builder computes
// for the same object (frame.mjs `noteGeometry` / `matGeometry`, byte for byte): resolve, record,
// hit, reach, theme.
import { createWorld, type Entity, STRATUM_BANDS, widgets } from "@ice/core";
import { describe, expect, it } from "vitest";
import { FLUX_REST, isObjectKind, type ObjectContext, rectOf, DEFAULT_GRID, FIT, PORTAL_GATE, defineObject, driversOf, hostOf, objectKindOf, NO_DOCS, type KindDriverHost, MAT_GRID } from "@ice/desk";
import { minimatKind, miniMatReach } from "../src/minimat/kind";
import { paperKind, paperReach } from "../src/paper/kind";
import { DEFAULT_MINIMAT_LAW, faceOf, pickMiniMat, resolveMiniMat } from "../src/minimat/minimat";
import { insideView, miniMatInstance } from "../src/minimat/inside";
import { Board, Calendar, DESK_OBJECTS, MiniMat, MINIMAT_TYPE, Note, Notebook, NOTE_TYPE, Photo } from "../src";
import { DEFAULT_PAPER_LAW, lampOf, pickPaper, resolvePaper, tiltOf } from "../src/paper/paper";
import { MINIMAT } from "../src/minimat/theme";
import { PAPER } from "../src/paper/theme";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS, pen, surface, vinyl } from "../../desk/oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

const VIEW = { camX: 13.7, camY: -21.3, zoom: 1, width: 1200, height: 800, dpr: 2 };
const lamp = lampOf(MAT_GRID.plane);
/** The product's palette with the note's and the mini mat's colours projected — what apps/desk hands the layer. */
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS };
const ctxOf = (over: Partial<ObjectContext> & { rect: ObjectContext["rect"] }): ObjectContext => ({
  entity: 7 as ObjectContext["entity"], props: {}, flux: FLUX_REST, look: undefined, theme: THEMES.light, lamp, view: VIEW, grid: DEFAULT_GRID, dt: 1 / 60, ...over,
});

describe("defineObject (design-015 §5.2, D-D16)", () => {
  it("compiles through defineWidget: the kind as the binding, the kind's stratum, the size as defaultSize; objectKindOf finds it again", () => {
    const kind = paperKind();
    const Thing = defineObject({ type: "t:thing", kind, size: { w: 120, h: 80 }, props: { seed: { kind: "number" } as never } });
    expect(Thing.object).toBe(kind);
    expect(Thing.stratum).toBe("things");
    expect(Thing.defaultSize).toEqual({ w: 120, h: 80 });
    expect(objectKindOf(Thing)).toBe(kind);
    expect(widgets.get("t:thing")).toBe(Thing);
    // a sheet's stratum rides through: a kind in `sheets` makes a sheets object
    const Sheet = defineObject({ type: "t:sheet", kind: minimatKind() });
    expect(Sheet.stratum).toBe("sheets");
    expect(STRATUM_BANDS[must(Sheet.stratum)]).toBe(1);
  });

  it("refuses a binding that is not a kind, and objectKindOf answers undefined for a view widget or a foreign binding", () => {
    expect(() => defineObject({ type: "t:bad", kind: { name: "x", stratum: "things" } as never })).toThrow(/not a desk kind/);
    expect(objectKindOf(undefined)).toBeUndefined();
    expect(isObjectKind({ ...paperKind(), hit: undefined })).toBe(false);
    expect(isObjectKind(paperKind())).toBe(true);
  });

  it("Note: desk.note — text · seeds (one `ink` cell, D2c) · pen · paper · seed, 200², things, snapping both ways, offered to a mini mat", () => {
    expect(Note.type).toBe(NOTE_TYPE);
    expect(Note.stratum).toBe("things");
    expect(Note.defaultSize).toEqual({ w: PAPER.size, h: PAPER.size });
    expect(Object.keys(Note.propToGroup).sort()).toEqual(["paper", "pen", "seed", "seeds", "text"]);
    // the writing is ONE conflict group: its text and its hand's seeds are one cell, written in one transaction (D-D13)
    expect(Note.propToGroup.text).toBe("ink");
    expect(Note.propToGroup.seeds).toBe("ink");
    expect(Note.propToGroup.pen).toBe("props");
    expect(Note.provides).toEqual([NOTE_TYPE]);
    expect(Note.container).toBeUndefined();
    expect(must(objectKindOf(Note)).name).toBe("paper");
  });

  it("MiniMat: desk.minimat — name · vinyl, 640×480, sheets, a container accepting notes and mini mats, its portal the border's inset (faceOf's rect)", () => {
    expect(MiniMat.type).toBe(MINIMAT_TYPE);
    expect(MiniMat.stratum).toBe("sheets");
    expect(MiniMat.defaultSize).toEqual({ w: MINIMAT.size.w, h: MINIMAT.size.h });
    const c = must(MiniMat.container);
    expect([...c.accepts].sort()).toEqual([MINIMAT_TYPE, NOTE_TYPE]);
    expect(c.portal).toEqual({ top: MINIMAT.margin, right: MINIMAT.margin, bottom: MINIMAT.margin, left: MINIMAT.margin });
    // the portal insets cut exactly the FACE the kind's law cuts at rest
    const G = resolveMiniMat({ cx: 380, cy: 330, w: 640, h: 480 }, { held: 0, hover: 0, ring: 0, fade: 1 }, DEFAULT_MINIMAT_LAW, lamp);
    const F = faceOf(G);
    expect([F.x, F.y, F.width, F.height]).toEqual([380 - 320 + c.portal.left, 330 - 240 + c.portal.top, 640 - c.portal.left - c.portal.right, 480 - c.portal.top - c.portal.bottom]);
    expect(DESK_OBJECTS).toEqual([Note, MiniMat, Board, Photo, Notebook, Calendar]);   // D3w's kinds follow the note and the mini mat
  });
});

describe("the note's world half (kinds/paper.ts paperKind)", () => {
  const kind = paperKind();
  const look = must(kind.theme)(palette, "light");

  it("rectOf converts ICE's top-left Position + Size to the centred rect the laws read — the one conversion", () => {
    expect(rectOf({ x: 200, y: 150 }, { w: 200, h: 200 })).toEqual({ cx: 300, cy: 250, w: 200, h: 200 });
  });

  it("resolve = resolvePaper on the rect at the seed's tilt with the flux as the motion — the oracle's noteGeometry, number for number", () => {
    const ctx = ctxOf({ rect: rectOf({ x: 200, y: 150 }, { w: 200, h: 200 }), props: { seed: 7 }, flux: { lift: 1, hover: 0, ring: 1, fade: 1 } });
    const G = kind.resolve(ctx);
    expect(G).toEqual(resolvePaper({ cx: 300, cy: 250, w: 200, h: 200, angle: tiltOf(7, DEFAULT_PAPER_LAW.tilt) }, { held: 1, ring: 1, fade: 1 }, DEFAULT_PAPER_LAW, lamp));
    // a ghost's fade is the alpha; the rest is the sheet at rest
    expect(kind.resolve({ ...ctx, flux: { lift: 0, hover: 0, ring: 0, fade: 0.25 } }).alpha).toBe(0.25);
  });

  it("record = the pass's instance: the geometry, the sheet by the `paper` prop and the ink by the `pen` prop from the look, the pinned raster when the host pinned one", () => {
    const ctx = ctxOf({ rect: rectOf({ x: 200, y: 150 }, { w: 200, h: 200 }), props: { seed: 7, paper: "yellow", pen: "ball" }, look });
    const G = kind.resolve(ctx);
    const R = kind.record(G, ctx);
    expect(R.geometry).toBe(G);
    expect(R.paper).toEqual(surface("note"));
    expect(R.ink).toEqual(pen("ball"));
    expect(R.raster).toBeUndefined();
    const uv = { u0: 0, v0: 0, u1: 400 / 2048, v1: 400 / 2048 };
    expect(kind.record(G, { ...ctx, asset: { layer: 0, uv } }).raster).toEqual({ layer: 0, uv });
    // an unknown pen or paper name falls back to the look's first — never a blank; no look at all is the host's mistake, said so
    expect(kind.record(G, { ...ctx, props: { pen: "chalk", paper: "vellum" } }).ink).toEqual(pen("felt"));
    expect(() => kind.record(G, { ...ctx, look: undefined })).toThrow(/papers.*pens/);
  });

  it("record takes the WRITING's ink (D2c): the live raster, the pen's wipe and the caret from the desk's `local`, which wins over a builder pin", () => {
    const ctx = ctxOf({ rect: rectOf({ x: 200, y: 150 }, { w: 200, h: 200 }), props: { seed: 7, paper: "yellow", pen: "ball", text: "hi" }, look });
    const G = kind.resolve(ctx);
    const live = { layer: 2, uv: { u0: 0.5, v0: 0, u1: 0.7, v1: 0.2 } };
    const wipe = { x0: 1, y0: 2, x1: 3, y1: 4, t: 0.5 };
    const caret = { x: 5, y: 6, above: 7, below: 8, on: true };
    const handed: unknown[] = [];
    const local = { draw: (...args: unknown[]) => { handed.push(args); return { raster: live, wipe, caret }; } };
    const R = kind.record(G, { ...ctx, local, asset: { layer: 0, uv: { u0: 0, v0: 0, u1: 1, v1: 1 } } });
    expect(R.raster).toEqual(live);
    expect(R.wipe).toEqual(wipe);
    expect(R.caret).toEqual(caret);
    // the writing was handed the entity, its props, its rect, the slot's view and the geometry just resolved
    expect(handed).toEqual([[ctx.entity, ctx.props, ctx.rect, ctx.view, G, false]]);
    // a delete ghost (fade < 1) is handed as FADING: the writing draws only what it holds
    kind.record(G, { ...ctx, local, flux: { lift: 0, hover: 0, ring: 0, fade: 0.5 } });
    expect((handed[1] as unknown[])[5]).toBe(true);
    // a writing with nothing for the note leaves the builder's pin as the fallback, and no marks
    const bare = kind.record(G, { ...ctx, local: { draw: () => ({}) }, asset: { layer: 1, uv: live.uv } });
    expect([bare.raster, bare.wipe, bare.caret]).toEqual([{ layer: 1, uv: live.uv }, undefined, undefined]);
    // and the kind makes its desk's writing itself (`local`), over the root pass the host names
    expect(typeof must(kind.local)({ pass: () => undefined }).tick).toBe("function");
  });

  it("hit: content inside the sheet, null outside — pickPaper on the same geometry; reach covers the shadow, the tilt and the held scale", () => {
    const ctx = ctxOf({ rect: rectOf({ x: 200, y: 150 }, { w: 200, h: 200 }), props: { seed: 7 } });
    const G = kind.resolve(ctx);
    expect(kind.hit(G, 300, 250)).toBe("content");
    expect(pickPaper(G, 300, 250)).toBe("paper");
    expect(kind.hit(G, 300 + 140, 250)).toBeNull();
    expect(kind.reach).toBe(paperReach(DEFAULT_PAPER_LAW));
    expect(kind.reach).toBeGreaterThan(DEFAULT_PAPER_LAW.lift.height * DEFAULT_PAPER_LAW.shadow.slopeMax);
    expect(kind.name).toBe("paper");
    expect(kind.stratum).toBe("things");
  });

  it("theme parses the palette's papers and pens; a palette without them gives an empty look", () => {
    expect(look.papers.yellow).toEqual(surface("note"));
    expect(Object.keys(look.pens).sort()).toEqual(["ball", "felt", "fountain", "red"]);
    expect(must(kind.theme)(PALETTE.dark, "dark")).toEqual({ papers: {}, pens: {} });
  });
});

describe("the mini mat's world half (kinds/minimat.ts minimatKind)", () => {
  const kind = minimatKind();
  const look = must(kind.theme)(palette, "light");

  it("resolve = resolveMiniMat on the rect with the flux — hover included: a mini mat rises under the pointer (Q-j)", () => {
    const ctx = ctxOf({ rect: rectOf({ x: 60, y: 90 }, { w: 640, h: 480 }), flux: { lift: 0, hover: 1, ring: 0, fade: 1 } });
    const G = kind.resolve(ctx);
    expect(G).toEqual(resolveMiniMat({ cx: 380, cy: 330, w: 640, h: 480 }, { held: 0, hover: 1, ring: 0, fade: 1 }, DEFAULT_MINIMAT_LAW, lamp));
    expect(G.lift).toBeCloseTo(DEFAULT_MINIMAT_LAW.lift.height * DEFAULT_MINIMAT_LAW.hover, 12);
  });

  it("record = miniMatInstance over an EMPTY inside — the oracle's matGeometry + insideView(null) + miniMatInstance with no chips, live −1, the name printed, the vinyl by the prop", () => {
    const rect = rectOf({ x: 60, y: 90 }, { w: 640, h: 480 });
    const ctx = ctxOf({ rect, props: { name: "Studio notes", vinyl: "slate" }, look });
    const G = kind.resolve(ctx);
    const R = kind.record(G, ctx);
    const view = must(insideView(G, null, { x: VIEW.camX, y: VIEW.camY, zoom: VIEW.zoom }, { width: VIEW.width, height: VIEW.height }, FIT, PORTAL_GATE));
    const grid = { fadeIn: DEFAULT_GRID.fadeIn, mat: { ...DEFAULT_GRID.mat, ground: vinyl("slate", DEFAULT_GRID.mat.ground), ruler: { ...DEFAULT_GRID.mat.ruler, on: false } } };
    expect(R).toEqual({ ...miniMatInstance(G, view, grid, [], "Studio notes", true, DEFAULT_MINIMAT_LAW), live: -1 });
    expect(R.chips).toEqual([]);
    expect(R.name).toBe("Studio notes");
    expect(R.ground).toEqual(vinyl("slate", DEFAULT_GRID.mat.ground));
    // sage is the desk's own ground, whatever the palette says; a nameless mat prints nothing
    const plain = kind.record(G, { ...ctx, props: { name: "", vinyl: "sage" } });
    expect(plain.ground).toEqual(DEFAULT_GRID.mat.ground);
    expect(plain.name).toBeUndefined();
  });

  it("hit: the face is content, the border frame, outside null — pickMiniMat on the same geometry; reach covers the slab's shadow", () => {
    const ctx = ctxOf({ rect: rectOf({ x: 60, y: 90 }, { w: 640, h: 480 }) });
    const G = kind.resolve(ctx);
    expect(kind.hit(G, 380, 330)).toBe("content");
    expect(pickMiniMat(G, 380, 330)).toBe("face");
    expect(kind.hit(G, 380 - 320 + 10, 330)).toBe("frame");
    expect(pickMiniMat(G, 380 - 320 + 10, 330)).toBe("border");
    expect(kind.hit(G, 380 - 400, 330)).toBeNull();
    expect(kind.reach).toBe(miniMatReach(DEFAULT_MINIMAT_LAW));
    expect(kind.name).toBe("minimat");
    expect(kind.stratum).toBe("sheets");
  });

  it("theme parses the palette's vinyls", () => {
    expect(look.vinyls.slate).toEqual(vinyl("slate", DEFAULT_GRID.mat.ground));
    expect(look.vinyls.charcoal).toEqual(vinyl("charcoal", DEFAULT_GRID.mat.ground));
    expect(must(kind.theme)(PALETTE.dark, "dark")).toEqual({ vinyls: {} });
  });
});

describe("the kinds' drivers are DECLARED, never wired by name (D7 #5, D-D7-A.3)", () => {
  it("every reference object that is worked in declares its driver; `driversOf` answers it, and nothing for a kind without one", () => {
    for (const t of [Note, Board, Notebook, Photo, Calendar]) expect(driversOf(t), t.type).toBeDefined();
    expect(driversOf(MiniMat)).toBeUndefined();
    expect(driversOf(undefined)).toBeUndefined();
  });

  it("…and so are their DOM halves (K4b): the note declares the ONE editor, the calendar its print raster and its days and pen; the rest none", () => {
    expect(hostOf(Note)?.editor).toBeTypeOf("function");
    expect(hostOf(Note)?.mount).toBeUndefined();
    expect(hostOf(Calendar)?.lend).toBeTypeOf("function");
    expect(hostOf(Calendar)?.mount).toBeTypeOf("function");
    expect(hostOf(Calendar)?.editor).toBeUndefined();
    for (const t of [MiniMat, Board, Notebook, Photo]) expect(hostOf(t), t.type).toBeUndefined();
    expect(hostOf(undefined)).toBeUndefined();
  });

  it("a third-party kind declares a driver in `defineObject` and the desk finds it by the OBJECT: a host makes it from what it lends and ticks it", () => {
    const made: string[] = [];
    const Third =
      widgets.get("d7:third") ??
      defineObject({
        type: "d7:third",
        kind: paperKind(),
        drivers: (h) => ({ follow: (now) => { made.push(`follow ${now} ${h.isKind(7 as Entity)}`); }, idle: () => made.length > 0 }),
      });
    const make = driversOf(Third);
    expect(make).toBeDefined();
    const host: KindDriverHost = {
      world: createWorld(), docs: NO_DOCS, local: undefined, look: () => undefined, isKind: (e) => e === 7, kind: () => undefined,
      geometryOf: () => undefined, heldToWorld: () => undefined, hand: () => undefined, refused: () => {}, wake: () => {},
    };
    const d = make?.(host);
    expect(d?.idle?.()).toBe(false);
    d?.follow(16);
    expect(made).toEqual(["follow 16 true"]);
    expect(d?.idle?.()).toBe(true);
  });
});
