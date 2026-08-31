/** `defineContainer` — an ordinary WidgetType with one fixed CanvasType portal. */
import type { CanvasType } from "./define-canvas-type";
import type { FrameProjection } from "./frame-projection";
import {
  defineWidget,
  type WidgetDef,
  type WidgetPortalInsets,
  type WidgetSurfaceKind,
  type WidgetType,
} from "../widget/define-widget";

export interface ContainerIngressDef {
  readonly accepts?: readonly string[];
  readonly widgets?: readonly WidgetType[];
}

export type ContainerDef = Omit<WidgetDef, "surface" | "container" | "provides"> & {
  readonly surface?: WidgetSurfaceKind;
  readonly canvas: CanvasType;
  /** Omission inherits the CanvasType's complete compiled legal placement set. */
  readonly drop?: ContainerIngressDef;
  readonly provides?: readonly string[];
  readonly portal?: WidgetPortalInsets;
  readonly framePreview?: unknown;
  readonly frameProjection?: FrameProjection;
};

export function defineContainer(def: ContainerDef): WidgetType {
  const {
    canvas,
    drop,
    provides,
    portal,
    framePreview,
    frameProjection,
    surface,
    ...widget
  } = def;
  return defineWidget({
    ...widget,
    surface: surface ?? "dom",
    container: {
      canvas,
      accepts: drop?.accepts ?? canvas.semantic.placement.accepts ?? [],
      widgets: drop?.widgets ?? [],
      inheritCanvasPlacement: drop === undefined,
      provides: provides ?? [],
      ...(portal === undefined ? {} : { portal }),
      ...(framePreview === undefined ? {} : { framePreview }),
      ...(frameProjection === undefined ? {} : { frameProjection }),
      typed: true,
    },
  });
}
