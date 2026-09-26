/**
 * The ground DECLARATION on a canvas type (design-013 §8 C2, D-C2.4; a bare marker since design-015 D7): what
 * `presentation.ground` is after its fields left — `{}`, frozen; the refusal BY NAME of every key it used to carry —
 * `program` (C2) and, at D7, `glyph`, `grid`, `wires`, `guides`, validated and never read since D5b (`guides: false`
 * stopped hiding the snap guides the desk's marks draw); the preview's two dead tokens refused the same way; and the one
 * thing the engine itself reads off the declaration: a type that declares a ground requires the `ground` presentation
 * plane to prepare before a flight into or out of it.
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  Viewport,
  createCanvasEngine,
  defineCanvasType,
  defineContainer,
  defineWidget,
  tools,
  widgets,
  type CanvasType,
  type Tool,
} from "../src/index";

function tool(id: string): Tool {
  const t = tools.get(id);
  if (t === undefined) throw new Error(`missing built-in tool ${id}`);
  return t;
}

describe("presentation.ground — the declaration (D-C2.4, a marker since D7)", () => {
  it("is a bare marker, frozen", () => {
    const bare = defineCanvasType({ id: "gd:bare", semanticVersion: 1, semantic: { placement: {} }, presentation: { ground: {} } });
    expect(bare.presentation?.ground).toEqual({});
    expect(Object.isFrozen(bare.presentation?.ground)).toBe(true);
  });

  it("refuses every key it used to carry BY NAME at definition time (the fields are deleted, not ignored)", () => {
    const define = (id: string, ground: object) => () =>
      defineCanvasType({ id, semanticVersion: 1, semantic: { placement: {} }, presentation: { ground: ground as Record<string, never> } });
    expect(define("gd:program", { program: "widgetlab.board.magnet" })).toThrow(/presentation\.ground\.program is gone \(design-013 C2\)/);
    expect(define("gd:glyph", { glyph: "line" })).toThrow(/presentation\.ground\.glyph is gone \(design-015 D7\)/);
    expect(define("gd:grid", { grid: { dotAlpha: 0.5 } })).toThrow(/presentation\.ground\.grid is gone \(design-015 D7\)/);
    expect(define("gd:wires", { wires: false })).toThrow(/presentation\.ground\.wires is gone/);
    // `guides: false` is the one that CHANGED behaviour at D5b without a word: it used to hide the snap guides
    expect(define("gd:guides", { guides: false })).toThrow(/presentation\.ground\.guides is gone \(design-015 D7\).*`guides: false` no longer hid them/);
  });

  it("refuses the preview's two dead tokens by name; the projection stays", () => {
    const define = (id: string, preview: object) => () =>
      defineCanvasType({ id, semanticVersion: 1, semantic: { placement: {} }, presentation: { preview: preview as never } });
    expect(define("gd:bg", { background: "#fff" })).toThrow(/presentation\.preview\.background is gone \(design-015 D7\)/);
    expect(define("gd:renderer", { renderer: {} })).toThrow(/presentation\.preview\.renderer is gone/);
    expect(define("gd:none", {})).not.toThrow();
  });

  it("a type that declares a ground requires the `ground` plane to prepare for a flight; one that declares none does not", () => {
    const CARD = widgets.get("gd:card") ?? defineWidget({ type: "gd:card", defaultSize: { w: 100, h: 60 } });
    const groundedInside = defineCanvasType({
      id: "gd:inside-grounded",
      semanticVersion: 1,
      semantic: { placement: { widgets: [CARD] } },
      presentation: { ground: {} },
    });
    const plainInside = defineCanvasType({
      id: "gd:inside-plain",
      semanticVersion: 1,
      semantic: { placement: { widgets: [CARD] } },
    });
    const GROUNDED = defineContainer({ type: "gd:folder-grounded", canvas: groundedInside, defaultSize: { w: 300, h: 200 }, provides: ["widget"] });
    const PLAIN = defineContainer({ type: "gd:folder-plain", canvas: plainInside, defaultSize: { w: 300, h: 200 }, provides: ["widget"] });
    const ROOT: CanvasType = defineCanvasType({
      id: "gd:root",
      semanticVersion: 1,
      semantic: { placement: { widgets: [CARD, GROUNDED, PLAIN] } },
      // the root itself declares none: only the inside's declaration can require the plane
    });
    const ce = createCanvasEngine({
      widgets: [CARD, GROUNDED, PLAIN],
      canvasTypes: [ROOT, groundedInside, plainInside],
      rootCanvas: ROOT,
      presentationFallback: ROOT,
      tools: [tool("select"), tool("pan")],
    });
    ce.docs.create();
    // a flight needs a real viewport (headless snaps prepare nothing — the nav's own rule)
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    // The coordinator asks EVERY registered adapter to prepare; what the declaration decides is the
    // descriptor's REQUIRED planes — the set a flight is gated on. Record that.
    const prepared: string[] = [];
    ce.transitions.register({ id: "gd:ground", plane: "ground", prepare: (d) => { prepared.push(`${d.kind}:${d.toTypeId}:[${[...d.requiredPlanes].join(",")}]`); return null; } });
    const grounded = ce.ops.spawnWidget(GROUNDED.type, { x: 0, y: 0, w: 300, h: 200, undoable: false });
    const plain = ce.ops.spawnWidget(PLAIN.type, { x: 400, y: 0, w: 300, h: 200, undoable: false });
    ce.world.sync();
    let now = 0;
    const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
    step(2);

    ce.ops.enterContainer(plain);
    step(2);
    // neither side declares a ground: the plane is asked, but not REQUIRED
    expect(prepared).toEqual([`enter:${plainInside.id}:[]`]);
    ce.ops.exitTo(0, { transition: "none" });
    step(2);

    ce.ops.enterContainer(grounded);
    step(2);
    expect(prepared).toEqual([`enter:${plainInside.id}:[]`, `enter:${groundedInside.id}:[ground]`]);
    ce.dispose();
  });
});
