// The desk's ENGINE (design-015 §9, D2a-core's settings; D2a-world): `createCanvasEngine` with the
// desk's objects, infinite zoom, the prototype's wheel (a plain wheel zooms about the pointer by
// exp(−Δ · 0.0016)), and the desk's SELECT tool — a drag on the bare mat PANS, shift draws the
// marquee (D-D11) — as the root canvas type's default. Core registers no desk tool or settings; the
// app does (the brief's pinned detail).

import { type CanvasEngine, createCanvasEngine, defineCanvasType, defineTool, type Tool, tools } from "@ice/core";
import { MiniMat, Note } from "@ice/desk/objects";

function builtin(id: string): Tool {
  const tool = tools.get(id);
  if (tool === undefined) throw new Error(`desk: missing built-in tool ${id}`);
  return tool;
}

/** The desk's select tool: the bare mat pans, shift-drag draws the vellum marquee; a drag on an object moves it. */
export const deskSelect: Tool = defineTool({ id: "desk.select", route: { canvasDrag: "pan", canvasDragShift: "marquee" } });

/** The tools the engine compiles — a typed engine must name `select` even when no canvas allows it. */
export const DESK_TOOLS: readonly Tool[] = [builtin("select"), deskSelect, builtin("pan")];

/** The desk as a canvas type: its objects, its two tools, the natural arrival band (FIT: pad 80, zoom ½–1). */
export const DeskCanvas = defineCanvasType({
  id: "desk.desk",
  semanticVersion: 1,
  semantic: { placement: { widgets: [Note, MiniMat] } },
  presentation: {
    tools: { allowed: [deskSelect, builtin("pan")], default: deskSelect },
    camera: { arrival: "fit", padding: 80, minZoom: 0.5, maxZoom: 1 },
  },
});

/** design-015 §9: the mat's lattice is scale-free — the zoom is infinite in both directions. */
export const ZOOM_MIN = 1e-8;
export const ZOOM_MAX = 1e8;

/** A desk engine with a fresh document, the desk's tool in hand. */
export function createDeskEngine(): CanvasEngine {
  const engine = createCanvasEngine({
    widgets: [Note, MiniMat],
    tools: DESK_TOOLS,
    canvasTypes: [DeskCanvas],
    rootCanvas: DeskCanvas,
    presentationFallback: DeskCanvas,
    settings: { zoom: { min: ZOOM_MIN, max: ZOOM_MAX }, gestures: { wheel: "zoom" } },
  });
  engine.docs.create();
  engine.ops.setTool(deskSelect.id);
  return engine;
}
