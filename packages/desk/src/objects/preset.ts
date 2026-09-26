// The desk's ENGINE PRESET (design-015 §9, D2a-core's settings; SHIPPED at D7, D-D7-C.1): what
// `createCanvasEngine` needs for the desk the README describes — the reference objects, infinite
// zoom, the prototype's wheel (a plain wheel zooms about the pointer by exp(−Δ · 0.0016)), the
// zoom-through, and the desk's SELECT tool — a drag on the bare mat PANS, shift draws the marquee
// (D-D11) — as the root canvas type's default. Core registers no desk tool or settings (its
// defaults are the plain canvas's: a wheel that pans, a bare drag that marquees, zoom 0.1–5); until
// D7 this lived in apps/desk only, so the published quickstart could not do what it said.
// Importing this module DEFINES the tool and the canvas type (core's registries are process-global).

import { type CanvasEngineOpts, defineCanvasType, defineTool, type Tool, tools } from "@ice/core";
import { ZOOM_MAX, ZOOM_MIN } from "../lattice/lod";
import { Board } from "./board";
import { Calendar } from "./calendar";
import { MiniMat } from "./minimat";
import { Note } from "./note";
import { Notebook } from "./notebook";
import { Photo } from "./photo";

/** The desk's reference objects, in the order an app registers them. */
export const DESK_OBJECTS = [Note, MiniMat, Board, Photo, Notebook, Calendar] as const;

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

/**
 * THE PRESET — `createCanvasEngine(DESK_ENGINE)` is the desk the README describes: the six reference objects, the desk's
 * tools with `desk.select` in hand, the desk canvas as the root, the scale-free zoom (design-015 §9: `ZOOM_MIN`–`ZOOM_MAX`),
 * the plain wheel zooming about the pointer, and the zoom-through ON (a wheel that leaves a face covering the view cuts into it).
 * Spread it to add to it: `createCanvasEngine({ ...DESK_ENGINE, widgets: [...DESK_OBJECTS, Mine] })`.
 */
export const DESK_ENGINE = {
  widgets: [...DESK_OBJECTS],
  tools: DESK_TOOLS,
  canvasTypes: [DeskCanvas],
  rootCanvas: DeskCanvas,
  presentationFallback: DeskCanvas,
  settings: { zoom: { min: ZOOM_MIN, max: ZOOM_MAX }, gestures: { wheel: "zoom" }, nav: { zoomThrough: { enabled: true } } },
} as const satisfies CanvasEngineOpts;
