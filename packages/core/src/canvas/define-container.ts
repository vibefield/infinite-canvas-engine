/** `defineContainer` — an ordinary WidgetType with one fixed CanvasType portal. */
import type { CanvasType } from "./define-canvas-type";
import type { FrameProjection } from "./frame-projection";
import { defineWidget, type WidgetDef, type WidgetPortalInsets, type WidgetType } from "../widget/define-widget";

export interface ContainerIngressDef {
  readonly accepts?: readonly string[];
  readonly widgets?: readonly WidgetType[];
}

export type ContainerDef = Omit<WidgetDef, "container" | "provides"> & {
  readonly canvas: CanvasType;
  /** Omission inherits the CanvasType's complete compiled legal placement set. */
  readonly drop?: ContainerIngressDef;
  readonly provides?: readonly string[];
  readonly portal?: WidgetPortalInsets;
  readonly frameProjection?: FrameProjection;
};

export function defineContainer(def: ContainerDef): WidgetType {
  const { canvas, drop, provides, portal, frameProjection, ...widget } = def;
  return defineWidget({
    ...widget,
    container: {
      canvas,
      accepts: drop?.accepts ?? canvas.semantic.placement.accepts ?? [],
      widgets: drop?.widgets ?? [],
      inheritCanvasPlacement: drop === undefined,
      provides: provides ?? [],
      ...(portal === undefined ? {} : { portal }),
      ...(frameProjection === undefined ? {} : { frameProjection }),
      typed: true,
    },
  });
}
