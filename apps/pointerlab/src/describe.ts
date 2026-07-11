/**
 * Identity-off-composition labeling for strata's observer (`attachObserver`'s
 * `describe` seam) — v2's entity labels + timeline color language on the v3
 * vocabulary. This is the ONE place identity is read off composition: the
 * entities list AND the timeline both render from it (strata single-sources
 * them through the DescribeFn).
 */
import {
  CanvasSurface,
  CursorVisual,
  Drag,
  GesturePhases,
  HandleSpec,
  LongPress,
  Pinch,
  Pointer,
  SelectionBox,
  Tap,
  WheelPan,
  WheelZoom,
} from "@ice/core";
import type { DescribeFn } from "@vibecook/strata-ecs/tools";
import { Cur, RemoteId, RemoteInfo, WidgetVisual, WorldPos } from "./components";

/** v2's GitHub-dark kind swatches — the timeline's color language. */
const COLOR = {
  pointerLocal: "#58a6ff",
  cursorLocal: "#79c0ff",
  pointerRemote: "#d2a8ff",
  cursorRemote: "#f778ba",
  tap: "#3fb950",
  longpress: "#e3b341",
  drag: "#db6d28",
  pinch: "#db61a2",
  wheelpan: "#388bfd",
  wheelzoom: "#a371f7",
  widget: "#56d4dd",
  canvas: "#484f58",
  chrome: "#6b7e9c",
  entity: "#768390",
} as const;

export const describeEntity: DescribeFn = (world, e) => {
  const phase = (): string | null => GesturePhases.current(world, e) ?? null;
  if (world.has(e, Pointer)) {
    return { label: `pointer (${world.read(e, Pointer).device})`, color: COLOR.pointerLocal, phase: null };
  }
  if (world.has(e, Tap)) return { label: "⊙ tap", color: COLOR.tap, phase: phase() };
  if (world.has(e, LongPress)) return { label: "⊙ long-press", color: COLOR.longpress, phase: phase() };
  if (world.has(e, Drag)) return { label: "⊙ drag", color: COLOR.drag, phase: phase() };
  if (world.has(e, Pinch)) return { label: "⊙ pinch", color: COLOR.pinch, phase: phase() };
  if (world.has(e, WheelPan)) return { label: "⊙ wheel-pan", color: COLOR.wheelpan, phase: phase() };
  if (world.has(e, WheelZoom)) return { label: "⊙ wheel-zoom", color: COLOR.wheelzoom, phase: phase() };
  if (world.has(e, Cur)) {
    const kind = world.has(e, CursorVisual) ? world.read(e, CursorVisual).kind : "local";
    if (kind === "remote") {
      const info = world.has(e, RemoteInfo) ? world.read(e, RemoteInfo) : undefined;
      return { label: `cursor·${info?.label ?? "remote"}`, color: COLOR.cursorRemote, phase: null };
    }
    return { label: "cursor·local", color: COLOR.cursorLocal, phase: null };
  }
  if (world.has(e, WorldPos) && world.has(e, RemoteId)) {
    return { label: `remote user-${world.read(e, RemoteId).n}`, color: COLOR.pointerRemote, phase: null };
  }
  if (world.has(e, WidgetVisual)) {
    return { label: world.read(e, WidgetVisual).label ?? "widget", color: COLOR.widget, phase: null };
  }
  if (world.has(e, HandleSpec)) {
    return { label: `▫ handle·${world.read(e, HandleSpec).anchor}`, color: COLOR.chrome, phase: null };
  }
  if (world.has(e, SelectionBox)) return { label: "▭ sel-box", color: COLOR.chrome, phase: null };
  if (world.hasTag(e, CanvasSurface)) return { label: "canvas", color: COLOR.canvas, phase: null };
  return { label: "entity", color: COLOR.entity, phase: null };
};
