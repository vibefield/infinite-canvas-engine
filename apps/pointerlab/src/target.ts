/**
 * The demo widgets — v2 target.ts's fixed WORLD placement, converted from
 * centre+Bounds to the engine's top-left Position+Size. Hit-testing is the
 * ENGINE's now (spatial index + disc pick with PointerSettings.radiusMousePx —
 * the v2 prototype's 45px ring reach, release dead-band and all).
 *
 * StackZ here is DELIBERATE post-petition-8 (reviewed): pointerlab is a
 * doc-less, pointer-chrome lab — no BoardRoot, no ChildOf edges, no
 * dom-widgets reflector to fight — so the engine's legacy fallback
 * (z asc, entity asc) IS its pick order, and these local runtime-only z
 * seeds are exactly how a legacy world expresses "later defs on top".
 * Never synced; do not copy this pattern into doc-attached apps.
 */
import { Position, Size, StackZ, Movable, Resizable, Selectable, type World } from "@ice/core";
import { WidgetVisual } from "./components";

/** Fixed WORLD placement (v2 defs verbatim, centre-based) — the camera navigates over them. */
const DEFS = [
  { x: 300, y: 260, w: 320, h: 220, color: "#1f6feb", label: "card A" },
  { x: 540, y: 400, w: 360, h: 240, color: "#238636", label: "card B" }, // overlaps A → topmost demo
  { x: 820, y: 300, w: 260, h: 260, color: "#8957e5", label: "square C" },
  { x: 470, y: 660, w: 560, h: 190, color: "#bb8009", label: "bar D" },
];

export function spawnTargets(world: World): void {
  DEFS.forEach((d, i) => {
    world.spawn({
      components: [
        [Position, { x: d.x - d.w / 2, y: d.y - d.h / 2 }],
        [Size, { w: d.w, h: d.h }],
        [StackZ, { z: i + 1 }], // later defs on top (v2's id-order z stand-in)
        [WidgetVisual, { color: d.color, label: d.label }],
      ],
      tags: [Selectable, Movable, Resizable],
    });
  });
}
