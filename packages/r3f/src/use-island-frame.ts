/**
 * The island animation contract (design-004 §3, rev 2 corrected).
 *
 * Plain `useFrame` CANNOT drive island repaints: R3F portals share the
 * root's single commingled `internal.subscribers` array, so a subscription
 * cannot be attributed to an island without probing R3F internals (banned).
 * `useIslandFrame` is the engine's wrapper: it registers the callback WITH
 * the island (bridge-side), which (a) holds the island's animation signal
 * while subscribed — the island turns Hot and repaints every visible frame —
 * and (b) fires the callback exactly when its island paints, so content
 * mutation and texture refresh can never desynchronize.
 *
 * The callback runs INSIDE the render pass: it may mutate three objects in
 * the island scene freely, but any ECS write throws under the DEV render
 * write trap (M7 exit). Engine state changes belong in systems or ops.
 */
import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { Entity } from "@ice/core";
import type { GLBridge, IslandFrameCallback } from "./bridge";

export interface IslandContextValue {
  readonly bridge: GLBridge;
  readonly entity: Entity;
}

/** Provided per-island by `<Island>`; null outside island content. */
export const IslandContext = createContext<IslandContextValue | null>(null);

export function useIslandContext(): IslandContextValue {
  const ctx = useContext(IslandContext);
  if (ctx === null) {
    throw new Error("ice: useIslandFrame/useIslandInvalidate must run inside a GL widget's island.");
  }
  return ctx;
}

/** Per-frame tick while mounted (island goes Hot). `cb(dtMs)` on paint. */
export function useIslandFrame(cb: IslandFrameCallback): void {
  const { bridge, entity } = useIslandContext();
  const ref = useRef(cb);
  ref.current = cb; // latest closure runs without re-subscribing
  useEffect(() => bridge.addFrameCallback(entity, (dt) => ref.current(dt)), [bridge, entity]);
}

/**
 * One-shot repaint scheduler for content that changes outside React's render
 * cycle (imperative subscriptions, sockets). Bumps the island's paint
 * generation + wakes the demand loop.
 */
export function useIslandInvalidate(): () => void {
  const { bridge, entity } = useIslandContext();
  return useCallback(() => bridge.bumpPaint(entity), [bridge, entity]);
}

/**
 * Composite-quad lift: scales the CARD on the canvas (texture + rounded alpha
 * corners together) and pops it over neighbors while ≠1. Scaling scene content
 * instead crops the corners at the card-sized frustum — the 2026-07-12
 * hard-corner field report. Resets to 1 on unmount.
 *
 * The scale EASES to each new value (default 180ms, the DOM card-lift
 * spring — GL has no CSS transitions, so the compositor runs the curve;
 * 2026-07-13 field report: "GL lift snaps while DOM lifts smooth").
 * `durationMs: 0` snaps.
 */
export function useIslandLift(scale: number, durationMs?: number): void {
  const { bridge, entity } = useIslandContext();
  useEffect(() => {
    bridge.setCompositeScale(entity, scale, durationMs);
  }, [bridge, entity, scale, durationMs]);
  useEffect(() => () => bridge.setCompositeScale(entity, 1), [bridge, entity]);
}

/**
 * Composite-quad fade — the lift's opacity twin (e.g. the drag-lift 75 %
 * fade): eases the quad's drawn opacity to `opacity` (default 180ms; 0
 * snaps) and MULTIPLIES the widget's durable `Opacity` cell, so a transient
 * fade stacks over a doc-level opacity instead of fighting it. The DOM
 * chrome runs its own CSS `opacity … ease` transition — same duration/curve
 * family, so card body and GL content fade in lockstep. Resets to 1 on
 * unmount.
 */
export function useIslandOpacity(opacity: number, durationMs?: number): void {
  const { bridge, entity } = useIslandContext();
  useEffect(() => {
    bridge.setCompositeOpacity(entity, opacity, durationMs);
  }, [bridge, entity, opacity, durationMs]);
  useEffect(() => () => bridge.setCompositeOpacity(entity, 1), [bridge, entity]);
}
