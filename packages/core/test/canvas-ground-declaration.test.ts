/**
 * The ground DECLARATION on a canvas type (design-013 §8 C2, D-C2.4): what
 * `presentation.ground` is after the program contract left — a glyph name, a
 * grid partial, the two overlay gates — frozen like the rest of the type; the
 * refusal of the old `program` key at definition time; the catalog's refusal
 * of an empty glyph; and the one thing the engine itself reads off it: a type
 * that declares a ground requires the `ground` presentation plane to prepare
 * before a flight into or out of it.
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

describe("presentation.ground — the field declaration (D-C2.4)", () => {
  it("carries a glyph, a grid partial and the two gates, frozen through the grid's magnet block", () => {
    const type = defineCanvasType({
      id: "gd:declared",
      semanticVersion: 1,
      semantic: { placement: {} },
      presentation: {
        ground: { glyph: "line", grid: { dotAlpha: 0.5, magnet: { reach: 90 } }, wires: false, guides: true },
      },
    });
    const ground = type.presentation?.ground;
    expect(ground).toEqual({ glyph: "line", grid: { dotAlpha: 0.5, magnet: { reach: 90 } }, wires: false, guides: true });
    expect(Object.isFrozen(ground)).toBe(true);
    expect(Object.isFrozen(ground?.grid)).toBe(true);
    expect(Object.isFrozen(ground?.grid?.magnet)).toBe(true);
    // every field is optional: a bare declaration is a legal one (the host resolves its defaults)
    const bare = defineCanvasType({ id: "gd:bare", semanticVersion: 1, semantic: { placement: {} }, presentation: { ground: {} } });
    expect(bare.presentation?.ground).toEqual({});
  });

  it("refuses the old `program` key by name at definition time (the contract is deleted, not ignored)", () => {
    const stale = { glyph: "dot", program: "widgetlab.board.magnet" } as unknown as { glyph: string };
    expect(() =>
      defineCanvasType({ id: "gd:stale", semanticVersion: 1, semantic: { placement: {} }, presentation: { ground: stale } }),
    ).toThrow(/presentation\.ground\.program is gone \(design-013 C2\)/);
    // and an empty glyph name is refused where an empty program id used to be
    expect(() =>
      defineCanvasType({ id: "gd:empty", semanticVersion: 1, semantic: { placement: {} }, presentation: { ground: { glyph: "" } } }),
    ).toThrow(/glyph must be a non-empty/);
  });

  it("a type that declares a ground requires the `ground` plane to prepare for a flight; one that declares none does not", () => {
    const CARD = widgets.get("gd:card") ?? defineWidget({ type: "gd:card", defaultSize: { w: 100, h: 60 } });
    const groundedInside = defineCanvasType({
      id: "gd:inside-grounded",
      semanticVersion: 1,
      semantic: { placement: { widgets: [CARD] } },
      presentation: { ground: { glyph: "line" } },
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
