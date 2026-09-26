// The desk's ENGINE (design-015 §9, D2a-core's settings; D2a-world): `createCanvasEngine` with the
// desk's objects, infinite zoom, the prototype's wheel (a plain wheel zooms about the pointer by
// exp(−Δ · 0.0016)), and the desk's SELECT tool — a drag on the bare mat PANS, shift draws the
// marquee (D-D11) — as the root canvas type's default. Core registers no desk tool or settings; the
// app does (the brief's pinned detail).

import { broadcastChannelByteChannel, type CanvasEngine, createCanvasEngine, defineCanvasType, defineTool, type Tool, tools } from "@ice/core";
import { DESK_OBJECTS } from "@ice/desk/objects";

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
  semantic: { placement: { widgets: [...DESK_OBJECTS] } },
  presentation: {
    tools: { allowed: [deskSelect, builtin("pan")], default: deskSelect },
    camera: { arrival: "fit", padding: 80, minZoom: 0.5, maxZoom: 1 },
  },
});

/** design-015 §9: the mat's lattice is scale-free — the zoom is infinite in both directions. */
export const ZOOM_MIN = 1e-8;
export const ZOOM_MAX = 1e8;

/** `?room=<name>`: the desk joins that room's document (D2c's two-tab witness); absent, a fresh document. */
export const deskRoom = (): string | undefined => (typeof location === "undefined" ? undefined : new URLSearchParams(location.search).get("room") ?? undefined);

/**
 * The desk's document in a ROOM (design-015 D-D10's `?room=`, over a same-origin BroadcastChannel —
 * two tabs, no server): joined through core's bootstrap, the desk's tool in hand once it attaches.
 * Resolves at once for a desk with no room (its fresh document was made with the engine).
 */
export async function joinDeskRoom(engine: CanvasEngine): Promise<void> {
  const room = deskRoom();
  if (room === undefined) return;
  await engine.docs.join(broadcastChannelByteChannel(`ice-desk:${room}`));
  engine.ops.setTool(deskSelect.id);
}

/** A desk engine with a fresh document (none yet in a room: `joinDeskRoom`), the desk's tool in hand. */
export function createDeskEngine(): CanvasEngine {
  const engine = createCanvasEngine({
    widgets: [...DESK_OBJECTS],
    tools: DESK_TOOLS,
    canvasTypes: [DeskCanvas],
    rootCanvas: DeskCanvas,
    presentationFallback: DeskCanvas,
    // design-015 §9: the zoom-through is ON for the desk (a wheel that leaves a face covering the view cuts into it)
    settings: { zoom: { min: ZOOM_MIN, max: ZOOM_MAX }, gestures: { wheel: "zoom" }, nav: { zoomThrough: { enabled: true } } },
  });
  if (deskRoom() !== undefined) return engine;
  engine.docs.create();
  engine.ops.setTool(deskSelect.id);
  return engine;
}
