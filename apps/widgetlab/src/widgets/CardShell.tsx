/**
 * iOS-style card chrome — the v3 stand-in for v1's CardFrame/CardChrome
 * (rounded clip, hairline ring, soft drop shadow, drag lift, overlap glow).
 * v1 rendered this INSIDE createCardWidget for every card; in v3 chrome is the
 * app's concern, so each widgetlab view wraps its body in <CardShell>.
 *
 * Adaptations (deliberate, reported at integration):
 *  - LIFT: v1 lifted on its drag state; v3 signal = a live `Grab` rider on the
 *    entity (present exactly while a move gesture holds the widget).
 *  - OVERLAP GLOW: v1's hot-point inner glow + rim rode a GL pass with
 *    pointer-derived hot coordinates. v3 keeps the same inset-glow CSS recipe
 *    but anchors it center-fixed off the `OverlapCandidate` tag — the CSS-var
 *    knobs (--ic-glow-*) stay live for the settings panel.
 * Both signals are chrome-grade: a ~120 ms poll, no ECS writes.
 */
import { Grab, OverlapCandidate, type Entity, type World } from "@ice/core";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

const RADIUS = 22;

export function CardShell({
  world,
  entity,
  background = "#1C1C1E",
  children,
}: {
  world: World;
  entity: Entity;
  background?: string;
  children: ReactNode;
}) {
  const [lifted, setLifted] = useState(false);
  const [overlap, setOverlap] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setLifted(world.has(entity, Grab));
      setOverlap(world.hasTag(entity, OverlapCandidate));
    }, 120);
    return () => clearInterval(id);
  }, [world, entity]);

  const baseShadow = lifted
    ? "0 30px 60px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)"
    : "0 20px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)";

  const base: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    borderRadius: `${RADIUS}px`,
    overflow: "hidden",
    background,
    boxShadow: baseShadow,
    transform: lifted ? "scale(1.05)" : "scale(1)",
    transformOrigin: "center center",
    transition: "transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 220ms ease",
  };

  const glow: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    borderRadius: "inherit",
    boxShadow: "inset 0 0 var(--ic-glow-size-c, 60px) rgba(var(--ic-glow-color, 128, 128, 128), var(--ic-glow-alpha-c, 0.25))",
    opacity: overlap ? 1 : 0,
    transition: "opacity 220ms ease",
  };

  return (
    <div style={base}>
      {children}
      <div style={glow} />
    </div>
  );
}
