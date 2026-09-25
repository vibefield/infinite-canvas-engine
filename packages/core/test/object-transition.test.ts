/**
 * design-015 D2a-core, item 4: an object requires only the `ground` plane.
 *
 * `presentationPlanesOf` names the rule the facade's `prepareTransition` always
 * applied (gl → `gl`; a component or chrome → `dom`) and adds the object's: the
 * desk draws it, so `ground` and nothing else. Objects have no mount entry, so
 * the facade finds the departing frame's VISIBLE ones in the world.
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  Viewport,
  createCanvasEngine,
  defineCanvasType,
  defineContainer,
  defineWidget,
  presentationPlanesOf,
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

describe("presentationPlanesOf (design-015 §5.2)", () => {
  it("an object needs `ground` alone; the view kinds keep the facade's old rule", () => {
    expect(presentationPlanesOf({ surface: "object", component: null, chrome: undefined })).toEqual(["ground"]);
    expect(presentationPlanesOf({ surface: "object", component: undefined, chrome: undefined })).toEqual(["ground"]);
    // the pre-desk rule, unchanged: gl → gl; a component or chrome → dom
    expect(presentationPlanesOf({ surface: "gl", component: {}, chrome: {} })).toEqual(["gl", "dom"]);
    expect(presentationPlanesOf({ surface: "gl", component: null, chrome: undefined })).toEqual(["gl"]);
    expect(presentationPlanesOf({ surface: "dom", component: () => null, chrome: undefined })).toEqual(["dom"]);
    expect(presentationPlanesOf({ surface: "dom", component: null, chrome: undefined })).toEqual([]);
    expect(presentationPlanesOf({ surface: "video", component: null, chrome: {} })).toEqual(["dom"]);
  });
});

describe("prepareTransition — a visible object requires the ground plane (design-015 §5.2)", () => {
  const NOTE =
    widgets.get("otr:note") ??
    defineWidget({ type: "otr:note", surface: "object", object: { name: "paper" }, defaultSize: { w: 200, h: 200 } });
  const CARD =
    widgets.get("otr:card") ??
    defineWidget({ type: "otr:card", surface: "dom", component: () => null, defaultSize: { w: 100, h: 60 } });
  const inside = defineCanvasType({ id: "otr:inside", semanticVersion: 1, semantic: { placement: { widgets: [NOTE] } } });
  // a container with no view of its own (component null) and no ground declaration: it requires nothing
  const FOLDER = defineContainer({ type: "otr:folder", canvas: inside, component: null, defaultSize: { w: 300, h: 200 }, provides: ["widget"] });
  const ROOT: CanvasType = defineCanvasType({
    id: "otr:root",
    semanticVersion: 1,
    semantic: { placement: { widgets: [NOTE, CARD, FOLDER] } },
  });

  function rig() {
    const ce = createCanvasEngine({
      widgets: [NOTE, CARD, FOLDER],
      canvasTypes: [ROOT, inside],
      rootCanvas: ROOT,
      presentationFallback: ROOT,
      tools: [tool("select"), tool("pan")],
    });
    ce.docs.create();
    // a flight needs a real viewport (headless snaps prepare nothing — the nav's own rule)
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const prepared: string[] = [];
    ce.transitions.register({
      id: "otr:ground",
      plane: "ground",
      prepare: (d) => {
        prepared.push([...d.requiredPlanes].sort().join(","));
        return null;
      },
    });
    let now = 0;
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    };
    return { ce, prepared, step };
  }

  it("a folder alone requires nothing; add a visible object beside it and the flight requires `ground`", () => {
    const { ce, prepared, step } = rig();
    const folder = ce.ops.spawnWidget(FOLDER.type, { x: 0, y: 0, w: 300, h: 200, undoable: false });
    ce.world.sync();
    step(3);
    ce.ops.enterContainer(folder);
    step(2);
    ce.ops.exitTo(0, { transition: "none" });
    step(2);

    ce.ops.spawnWidget(NOTE.type, { x: 400, y: 0, undoable: false });
    ce.world.sync();
    step(3);
    ce.ops.enterContainer(folder);
    step(2);
    expect(prepared).toEqual(["", "ground"]);
    ce.dispose();
  });

  it("a culled object requires nothing (it presents nowhere); a view widget still asks for `dom` beside it", () => {
    const { ce, prepared, step } = rig();
    const folder = ce.ops.spawnWidget(FOLDER.type, { x: 0, y: 0, w: 300, h: 200, undoable: false });
    ce.ops.spawnWidget(NOTE.type, { x: 100_000, y: 100_000, undoable: false }); // off every view
    ce.world.sync();
    step(3);
    ce.ops.enterContainer(folder);
    step(2);
    ce.ops.exitTo(0, { transition: "none" });
    step(2);

    ce.ops.spawnWidget(CARD.type, { x: 400, y: 0, undoable: false });
    ce.ops.spawnWidget(NOTE.type, { x: 600, y: 0, undoable: false });
    ce.world.sync();
    step(3);
    ce.ops.enterContainer(folder);
    step(2);
    expect(prepared).toEqual(["", "dom,ground"]);
    ce.dispose();
  });
});
