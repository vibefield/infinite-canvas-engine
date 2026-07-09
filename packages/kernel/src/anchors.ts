/**
 * Port-anchor math (design-001 §5.3): wire geometry NEVER reads port entities —
 * anchors are pure functions over the widget rect + the port declaration, so
 * culled endpoints work by construction.
 */
import type { Rect, Vec2 } from "./shapes";

export type PortSide = "n" | "e" | "s" | "w";

export interface PortSlot {
  side: PortSide;
  /** 0-based position among the ports sharing this side. */
  index: number;
  /** Total ports on this side. */
  count: number;
}

/** World-space anchor point: ports distribute evenly along their side. */
export function portAnchor(widget: Rect, slot: PortSlot): Vec2 {
  const f = (slot.index + 1) / (slot.count + 1);
  switch (slot.side) {
    case "n":
      return { x: widget.x + widget.width * f, y: widget.y };
    case "s":
      return { x: widget.x + widget.width * f, y: widget.y + widget.height };
    case "w":
      return { x: widget.x, y: widget.y + widget.height * f };
    case "e":
      return { x: widget.x + widget.width, y: widget.y + widget.height * f };
  }
}

/** Outward unit direction of a side (wire tangent stubs, Y-down world). */
export function sideDirection(side: PortSide): Vec2 {
  switch (side) {
    case "n":
      return { x: 0, y: -1 };
    case "s":
      return { x: 0, y: 1 };
    case "w":
      return { x: -1, y: 0 };
    case "e":
      return { x: 1, y: 0 };
  }
}
