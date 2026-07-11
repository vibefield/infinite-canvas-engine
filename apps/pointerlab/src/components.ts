/**
 * pointerlab's app vocabulary — the pieces of v2's prototype components.ts that
 * are APP concerns in v3 (everything else — pointers, gestures, camera,
 * selection, chrome — is the engine catalog now).
 *
 * Cursor entities carry `Cur` (kinematics) and NEVER Position/Size, so the
 * spatial index / picking never sees them. Fake remote pointers carry
 * `WorldPos` (a remote user's pointer is a position on the SHARED canvas, not
 * on my screen — the stage projects it through MY camera).
 */
import { defineComponent, defineResource, defineTag, field } from "@ice/core";

/** Colored label box (v2 WidgetVisual) — presentation value on the demo widgets. */
export const WidgetVisual = defineComponent("WidgetVisual", {
  color: field("string", { default: "#888888" }),
  label: field("string", { default: "" }),
});

/** Cursor kinematics: eased position + morph scale + follow time constant (v2 Transform+Follower.tau). */
export const Cur = defineComponent("Cur", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  scale: field("f32", { default: 0 }),
  tau: field("f32", { default: 55 }),
});

/** Remote cursor identity (v2 RemoteCursorVisual color/label — lives on the CURSOR entity). */
export const RemoteInfo = defineComponent("RemoteInfo", {
  color: field("string", { default: "#ffffff" }),
  label: field("string", { default: "" }),
});

/** A fake remote user's pointer position, WORLD coordinates (v2 remote Transform). */
export const WorldPos = defineComponent("WorldPos", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
});

/** Wander goal for a fake remote pointer (v2 RemoteGoal). */
export const RemoteGoal = defineComponent("RemoteGoal", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  nextMs: field("f64", { default: 0 }),
});

/** Stable identity of a fake remote user (drives palette/name pick). */
export const RemoteId = defineComponent("RemoteId", { n: field("u32", { default: 0 }) });

/** Marks a fake remote pointer entity. */
export const RemotePointer = defineTag("RemotePointer");

/** Presence-churn simulation state (v2 RemoteSim). */
export const RemoteSim = defineResource("RemoteSim", {
  nextUserId: field("u32", { default: 0 }),
  nextChurnMs: field("f64", { default: 0 }),
});

/** The ring cursor's radius, screen px — also seeds the pick disc (PointerSettings.radiusMousePx). */
export const RING_RADIUS_PX = 45;

/** Cursor collapses to a small dot over a content widget (v2 DOT_SCALE). */
export const DOT_SCALE = 0.2;

/** Framerate-independent exponential easing — v2's one easing primitive, verbatim. */
export const expEase = (cur: number, goal: number, dt: number, tau = 70): number =>
  cur + (goal - cur) * (1 - Math.exp(-dt / tau));

/**
 * Ease toward goal, returning `null` once settled (within eps) so the caller can
 * SKIP the write entirely — change-only discipline (v2 easeSettle, verbatim).
 */
export function easeSettle(
  cur: number,
  goal: number,
  dt: number,
  tau = 70,
  eps = 0.01,
): number | null {
  if (cur === goal) return null;
  const next = expEase(cur, goal, dt, tau);
  return Math.abs(next - goal) < eps ? goal : next;
}
