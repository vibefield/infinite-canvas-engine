/**
 * iOS-style card chrome — the v3 stand-in for v1's CardFrame/CardChrome
 * (rounded clip, hairline ring, soft drop shadow, drag lift, overlap glow).
 * v1 rendered this INSIDE createCardWidget for every card; in v3 chrome is the
 * app's concern, so each widgetlab view wraps its body in <CardShell>.
 *
 * Adaptations (deliberate, reported at integration):
 *  - LIFT: v1 lifted on its drag state; v3 signal = a live `Grab` rider on the
 *    entity (present exactly while a move gesture holds the widget).
 *  - OVERLAP GLOW + RIM: v1's hot-point inner glow AND the edge-rim glow
 *    (CardChrome.tsx rim — radial gradient at the hot point, masked to the
 *    border ring), both restored 2026-07-13 (James: "add the same hover card
 *    edge glow effect like v1"). The hot point is v1's derivation verbatim
 *    (interaction.ts:423): the CENTROID of dragged-rect ∩ this card,
 *    normalized to card-local [0,1] — derived here in the poll from the live
 *    `Grab`bed widget's rect (no new ECS state). CSS-var knobs (--ic-glow-*,
 *    --ic-rim-*) stay live for the settings panel.
 * All signals are chrome-grade: a ~60 ms poll, no ECS writes.
 */
import {
  Captures,
  Drag,
  GesturePhases,
  Grab,
  HadSequence,
  OverlapCandidate,
  OverlapRejected,
  Position,
  Size,
  defineQuery,
  type Entity,
  type World,
} from "@ice/core";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

const RADIUS = 22;

const grabQuery = defineQuery([Grab]);

/**
 * v1's hot point: the centroid of the dragged widget's rect ∩ this card's
 * rect, in card-local [0,1] (clamped). Falls back to center when no grabbed
 * widget exists (e.g. the tag lingers a frame past release).
 */
function hotPoint(world: World, entity: Entity): { x: number; y: number } {
  let dragged: Entity | undefined;
  world.query(grabQuery).each((b) => {
    for (const r of b) {
      dragged = b.entity(r);
      return;
    }
  });
  if (dragged === undefined) return { x: 0.5, y: 0.5 };
  const dp = world.get(dragged, Position);
  const ds = world.get(dragged, Size);
  const cp = world.get(entity, Position);
  const cs = world.get(entity, Size);
  if (dp === undefined || ds === undefined || cp === undefined || cs === undefined) return { x: 0.5, y: 0.5 };
  const ix = (Math.max(dp.x, cp.x) + Math.min(dp.x + ds.w, cp.x + cs.w)) / 2;
  const iy = (Math.max(dp.y, cp.y) + Math.min(dp.y + ds.h, cp.y + cs.h)) / 2;
  const hx = cs.w > 0 ? (ix - cp.x) / cs.w : 0.5;
  const hy = cs.h > 0 ? (iy - cp.y) / cs.h : 0.5;
  return {
    x: Math.round(Math.min(1, Math.max(0, hx)) * 1000) / 1000,
    y: Math.round(Math.min(1, Math.max(0, hy)) * 1000) / 1000,
  };
}

export function CardShell({
  world,
  entity,
  background = "#1C1C1E",
  children,
}: {
  world: World;
  entity: Entity;
  background?: string;
  /** Omitted for GL cards — their content floats in the island above (GlCardChrome). */
  children?: ReactNode;
}) {
  const [lifted, setLifted] = useState(false);
  // v1's two glow tiers: "target" (accepting container — strong, -t vars) and
  // "candidate" (rejecting overlap hover — weak, -c vars).
  const [overlap, setOverlap] = useState<"none" | "accept" | "reject">("none");
  const [hot, setHot] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });

  useEffect(() => {
    // Lift feedback fires at the LONG-PRESS (iOS: the hold IS the "you can
    // drag now" signal, before any movement — field report 2026-07-12): after
    // the Sequence hand-off, this widget's captured Drag sits un-parked
    // (HadSequence, Possible/Active) with no Grab yet — that armed state
    // lifts; Grab (live move) keeps it lifted through the drag.
    const armedByHold = (): boolean => {
      for (const rec of world.getReverse(entity, Captures)) {
        if (!world.has(rec, Drag) || !world.hasTag(rec, HadSequence)) continue;
        if (
          world.hasTag(rec, GesturePhases.tags.Possible) ||
          world.hasTag(rec, GesturePhases.tags.Active)
        ) {
          return true;
        }
      }
      return false;
    };
    const id = setInterval(() => {
      setLifted(world.has(entity, Grab) || armedByHold());
      const tier = world.hasTag(entity, OverlapCandidate)
        ? "accept"
        : world.hasTag(entity, OverlapRejected)
          ? "reject"
          : "none";
      setOverlap(tier);
      // Hot point only matters while glowing; the state object is value-stable
      // (rounded) so React skips re-renders when the dragged card is still.
      if (tier !== "none") {
        const h = hotPoint(world, entity);
        setHot((prev) => (prev.x === h.x && prev.y === h.y ? prev : h));
      }
    }, 60); // snappy — the lift must read as an immediate response to the hold
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

  const tier = overlap === "accept" ? "t" : "c";
  // v1 CardChrome verbatim: the inset glow's offset puts the bright spot on
  // the hot-point side (−(hot−0.5)·16 → ±8px), and the rim is a radial
  // gradient anchored AT the hot point, masked to the border ring.
  const offsetX = -(hot.x - 0.5) * 16;
  const offsetY = -(hot.y - 0.5) * 16;
  const glow: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    borderRadius: "inherit",
    boxShadow: `inset ${offsetX}px ${offsetY}px var(--ic-glow-size-${tier}, 60px) rgba(var(--ic-glow-color, 128, 128, 128), var(--ic-glow-alpha-${tier}, 0.25))`,
    opacity: overlap !== "none" ? 1 : 0,
    transition: "opacity 220ms ease, box-shadow 220ms ease",
  };

  const rimColor = `rgba(var(--ic-rim-color, 128, 128, 128), var(--ic-rim-alpha-${tier}, ${tier === "t" ? 0.85 : 0.55}))`;
  const rim: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    borderRadius: "inherit",
    padding: "var(--ic-rim-width, 1.5px)",
    background: `radial-gradient(var(--ic-rim-radius, 600px) circle at ${hot.x * 100}% ${hot.y * 100}%, ${rimColor}, transparent 40%)`,
    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    WebkitMaskComposite: "xor",
    mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    maskComposite: "exclude",
    opacity: overlap !== "none" ? 1 : 0,
    transition: "opacity 220ms ease, background 220ms ease",
  };

  return (
    <div style={base}>
      {children}
      <div style={glow} />
      <div style={rim} />
    </div>
  );
}
