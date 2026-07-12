/**
 * CardContainer — the v1 folder (RFC-004 Phase 5) on v3 container semantics.
 * `container.accepts: ["widget"]` arms the engine's drop-to-consume + nested
 * canvas; every card advertises `provides: ["widget"]`. Double-click (or
 * Enter/Space) descends via ops.enterContainer — v1 used the widget body's own
 * DOM dblclick, and so do we (no gesture machinery needed). Child count reads
 * the `ChildOf` containment edge (chrome-grade 250 ms poll).
 *
 * size: large (329×345).
 */
import { ChildOf, defineWidget, p, type Entity, type World } from "@ice/core";
import { useOps, useWidgetProps } from "@ice/react";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { CardShell } from "./CardShell";

export const CARD_CONTAINER_SIZE = { w: 329, h: 345 };

function CardContainerView({ entity, world }: { entity: Entity; world: World }) {
  const props = useWidgetProps<{ title: string; accent: string }>(world, entity, "card-container");
  const ops = useOps();
  const [count, setCount] = useState(() => world.getReverse(entity, ChildOf).length);
  useEffect(() => {
    const id = setInterval(() => setCount(world.getReverse(entity, ChildOf).length), 250);
    return () => clearInterval(id);
  }, [world, entity]);

  const title = props?.title ?? "Folder";
  const accent = props?.accent ?? "#6366F1";
  const enterFolder = () => ops.enterContainer(entity);
  const onDoubleClick = (event: ReactMouseEvent) => {
    event.stopPropagation();
    enterFolder();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      enterFolder();
    }
  };

  // v1 note kept: a <div role="button"> rather than <button> — a real button
  // would be treated as a widget-internal control and make the whole surface
  // non-draggable; role + tabIndex + onKeyDown keep keyboard a11y.
  return (
    <CardShell world={world} entity={entity} background="#1f1f2a">
      {/* biome-ignore lint/a11y/useSemanticElements: drag-surface; see comment above */}
      <div
        role="button"
        tabIndex={0}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: "space-between",
          height: "100%",
          width: "100%",
          padding: 14,
          background: `linear-gradient(155deg, ${accent} 0%, #1f1f2a 85%)`,
          color: "#fff",
          fontFamily: "-apple-system, system-ui, sans-serif",
          textAlign: "left",
        }}
        title={`Double-click to open ${title}`}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.82 }}>
            Folder
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 26,
              height: 20,
              padding: "0 7px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.35)",
              fontSize: 11,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count}
          </span>
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
            {count === 0 ? "Empty — drop cards in" : "Double-click to open"}
          </div>
        </div>
      </div>
    </CardShell>
  );
}

export const CardContainer = defineWidget({
  type: "card-container",
  surface: "dom",
  props: {
    title: p.string({ default: "Folder" }),
    accent: p.string({ default: "#6366F1" }),
  },
  component: CardContainerView,
  sizeMode: "fixed",
  defaultSize: { w: CARD_CONTAINER_SIZE.w, h: CARD_CONTAINER_SIZE.h },
  interaction: { selectable: true, movable: true, resizable: false, snap: "both", dragOn: "longPress" },
  container: { accepts: ["widget"] },
});
