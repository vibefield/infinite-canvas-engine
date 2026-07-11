/**
 * Port-slot resolution: a widget's port DECLARATIONS (from the widget registry,
 * design-005 §2) → kernel `PortSlot`s (side + even-distribution index/count).
 *
 * The single source of a port's world anchor is the kernel's pure
 * `portAnchor(widgetRect, slot)` — geometry NEVER reads a port ENTITY (design-001
 * §5.3), so wires, the connect preview, and materialized-port anchors all agree
 * by construction and culled endpoints resolve for free. Ports sharing a side are
 * numbered by their declared `index` when given, else by declaration order; the
 * side's `count` drives the even spacing.
 */
import type { PortSide, PortSlot } from "@ice/kernel";
import type { WidgetPortDecl } from "../widget/define-widget";

/** Map every declared port id → its `PortSlot` (side/index/count for even spacing). */
export function portSlots(decls: readonly WidgetPortDecl[]): Map<string, PortSlot> {
  const bySide = new Map<PortSide, WidgetPortDecl[]>();
  for (const d of decls) {
    let list = bySide.get(d.side);
    if (list === undefined) {
      list = [];
      bySide.set(d.side, list);
    }
    list.push(d);
  }
  const out = new Map<string, PortSlot>();
  for (const [side, list] of bySide) {
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d === undefined) continue;
      out.set(d.id, { side, index: d.index ?? i, count: list.length });
    }
  }
  return out;
}

/** The `PortSlot` for one port id (undefined if the widget declares no such port). */
export function portSlotOf(decls: readonly WidgetPortDecl[], portId: string): PortSlot | undefined {
  return portSlots(decls).get(portId);
}
