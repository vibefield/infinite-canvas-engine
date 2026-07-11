/**
 * node-board's three DOM-surface widget types (design-005 §2 defineWidget;
 * design-001 §5.3 ports; design-004 §7 containers). All cards are small,
 * flat, grab-to-move surfaces; the connect gesture, port dots, and wires are
 * drawn by the engine (the L3 connect systems + the P0 wires reflector), so a
 * node view only needs a title, its port labels, and — for `math-node` — a
 * durable value it edits through {@link StoreContext} (the glboard spin-cube
 * commit idiom).
 *
 * PORT vs CONTAINER keys are two different vocabularies:
 *  - PORT `accepts: ["number"]` gates the connect gesture (which wire endpoints
 *    are compatible).
 *  - CONTAINER `accepts`/`provides: ["node"]` gates drag-drop-into-a-group (the
 *    drop system's contract). `provides` is only reachable through the
 *    `container` field, which also stamps the `Container` tag — harmless here:
 *    the "enter" affordance guards on the `group-node` type, so leaf nodes are
 *    never treated as frames (their membership is decided by their PARENT, so a
 *    Container-tagged leaf still partitions correctly).
 */
import { Container, type Entity, PrefabId, type World, defineWidget, p } from "@ice/core";
import { type WidgetComponentProps, useSelected, useWidgetProps } from "@ice/react";
import { type CSSProperties, type ReactElement, useCallback, useContext } from "react";
import { NavContext, StoreContext } from "./store-context";

// --- math-node: a numeric source. One "out" port (east), accepts "number". ----

type MathProps = { value: number };

function MathNodeView({ entity, world }: WidgetComponentProps): ReactElement {
  const store = useContext(StoreContext);
  const props = useWidgetProps<MathProps>(world, entity, "math-node", "props");
  const selected = useSelected(world, entity);
  const value = props?.value ?? 0;

  const bump = useCallback(
    (ev: { stopPropagation: () => void }) => {
      ev.stopPropagation(); // claim the tap so no canvas drag starts
      if (store === null) return;
      store.transaction((tx) => {
        tx.edit(entity).set(mathPropsGroup.component, { value: value + 1 } as never);
      });
    },
    [store, entity, value],
  );

  return (
    <div data-node="math" data-selected={selected ? "true" : "false"} style={cardStyle(selected, "#33507a")}>
      <div style={TITLE_STYLE}>Math</div>
      <div style={VALUE_ROW_STYLE}>
        <span data-node-value>{value}</span>
        <button data-node-bump type="button" onPointerDown={bump} style={BUMP_STYLE}>
          +1
        </button>
      </div>
      <PortLabel side="e" label="out" />
    </div>
  );
}

export const MathNode = defineWidget({
  type: "math-node",
  props: { value: p.number({ default: 1 }) },
  surface: "dom",
  component: MathNodeView,
  sizeMode: "fixed",
  defaultSize: { w: 150, h: 84 },
  minSize: { w: 120, h: 70 },
  interaction: { selectable: true, movable: true },
  ports: [{ id: "out", side: "e", accepts: ["number"] }],
  provides: ["node"],
});

const mathPropsGroup = MathNode.groups.find((g) => g.name === "props") as (typeof MathNode.groups)[number];

// --- sum-node: "in" (west) + "out" (east), both accept "number". -------------

function SumNodeView({ entity, world }: WidgetComponentProps): ReactElement {
  const selected = useSelected(world, entity);
  return (
    <div data-node="sum" data-selected={selected ? "true" : "false"} style={cardStyle(selected, "#3a5a40")}>
      <div style={TITLE_STYLE}>Sum</div>
      <div style={SUB_STYLE}>in → out</div>
      <PortLabel side="w" label="in" />
      <PortLabel side="e" label="out" />
    </div>
  );
}

export const SumNode = defineWidget({
  type: "sum-node",
  surface: "dom",
  component: SumNodeView,
  sizeMode: "fixed",
  defaultSize: { w: 150, h: 84 },
  minSize: { w: 120, h: 70 },
  interaction: { selectable: true, movable: true },
  ports: [
    { id: "in", side: "w", accepts: ["number"] },
    { id: "out", side: "e", accepts: ["number"] },
  ],
  provides: ["node"],
});

// --- group-node: a container. Accepts "node" children; double-click to enter. -

type GroupProps = { label: string };

function GroupNodeView({ entity, world }: WidgetComponentProps): ReactElement {
  const nav = useContext(NavContext);
  const props = useWidgetProps<GroupProps>(world, entity, "group-node", "props");
  const selected = useSelected(world, entity);
  const label = props?.label ?? "Group";

  const enter = useCallback(() => nav?.enter(entity), [nav, entity]);

  return (
    <div
      data-node="group"
      data-selected={selected ? "true" : "false"}
      onDoubleClick={enter}
      style={groupStyle(selected)}
    >
      <div style={TITLE_STYLE}>{label}</div>
      <div style={SUB_STYLE}>double-click to enter</div>
    </div>
  );
}

export const GroupNode = defineWidget({
  type: "group-node",
  props: { label: p.string({ default: "Group" }) },
  surface: "dom",
  component: GroupNodeView,
  sizeMode: "fixed",
  defaultSize: { w: 220, h: 150 },
  minSize: { w: 160, h: 110 },
  interaction: { selectable: true, movable: true },
  container: { accepts: ["node"] },
});

const groupPropsGroup = GroupNode.groups.find((g) => g.name === "props") as (typeof GroupNode.groups)[number];

// --- shared view helpers -----------------------------------------------------

/** A small edge label sitting where the engine draws that port's dot. */
function PortLabel({ side, label }: { side: "e" | "w"; label: string }): ReactElement {
  const style: CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "10px",
    color: "rgba(230,236,242,0.75)",
    pointerEvents: "none",
    ...(side === "e" ? { right: "6px" } : { left: "6px" }),
  };
  return <span style={style}>{side === "w" ? `▸ ${label}` : `${label} ▸`}</span>;
}

function cardStyle(selected: boolean, tint: string): CSSProperties {
  return {
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px 12px",
    borderRadius: "10px",
    background: tint,
    color: "#e6ecf2",
    fontSize: "13px",
    boxShadow: selected ? "0 0 0 2px #4a90d9, 0 4px 14px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.28)",
    overflow: "hidden",
    cursor: "grab",
    userSelect: "none",
  };
}

function groupStyle(selected: boolean): CSSProperties {
  return {
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "rgba(40,44,54,0.6)",
    border: "1.5px dashed rgba(160,172,190,0.7)",
    color: "#e6ecf2",
    fontSize: "13px",
    boxShadow: selected ? "0 0 0 2px #4a90d9" : "none",
    overflow: "hidden",
    cursor: "grab",
    userSelect: "none",
  };
}

const TITLE_STYLE: CSSProperties = { fontWeight: 600, flex: "0 0 auto" };
const SUB_STYLE: CSSProperties = { fontSize: "10px", opacity: 0.7 };
const VALUE_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: "18px",
  fontWeight: 600,
};
const BUMP_STYLE: CSSProperties = {
  font: "inherit",
  fontSize: "12px",
  padding: "1px 8px",
  background: "#2a2f3a",
  color: "#e6ecf2",
  border: "1px solid #3f4756",
  borderRadius: "4px",
  cursor: "pointer",
};

// `groupPropsGroup` is retained for parity with the math-node commit path (a
// group could rename its label the same way); referenced to keep it honest.
void groupPropsGroup;

/** True when `entity` is a container node whose frame the user can enter. */
export function isEnterableContainer(world: World, entity: Entity): boolean {
  return world.hasTag(entity, Container) && world.get(entity, PrefabId)?.id === "group-node";
}
