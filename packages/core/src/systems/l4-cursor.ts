/**
 * L4 — cursor projection (design-003 §7; `derive` phase).
 *
 * Memoryless: resolved fresh every run from live world state, priority order
 * (1) any LOCAL pointer with a live `ClaimedBy` — Drag+RoutedMove or a
 * LongPress in Recognized → "grabbing"; RoutedResize → directional resize by
 * the captured handle's `HandleSpec.anchor`; RoutedPan → "grabbing";
 * (2) `ActiveTool` override — pan tool → "grab"; (3) else the mouse pointer's
 * `Targets` kind — a `HandleSpec` → directional resize, an entity with
 * `Position` (widget) → "default", `CanvasSurface`/none → "default".
 *
 * Scheduled on the `CanvasSurface` anchor query (exactly one such entity,
 * guaranteed by install — the same idiom `pointerIngest` uses in l0-input.ts)
 * so the body runs every frame even on tool switches with no pointer motion;
 * `world.query(...)` inside then does the actual local-pointer scan (mirrors
 * `oneTickClear`'s marker sweep in cleanup.ts).
 *
 * The resolved string is closure state; `readCursor()` exposes it — the DOM
 * cursor reflector is the only consumer (core never touches DOM).
 */
import type { Entity, System, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import {
  ActiveTool,
  CanvasSurface,
  Captures,
  ClaimedBy,
  Drag,
  GesturePhases,
  HandleSpec,
  LocalPointer,
  LongPress,
  Pointer,
  Position,
  RoutedMove,
  RoutedPan,
  RoutedResize,
  Targets,
} from "../catalog";

const P = GesturePhases;

const anchorQ = defineQuery([CanvasSurface]);
const localPointerQ = defineQuery([Pointer, LocalPointer]);

/** `HandleSpec.anchor` → CSS directional-resize cursor (design-003 §7). */
function resizeCursorForAnchor(anchor: string): string {
  switch (anchor) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    default: // "e" | "w"
      return "ew-resize";
  }
}

export function createCursorSync(world: World): System & { readCursor(): string } {
  let cursor = "default";

  const system = defineSystem(
    anchorQ,
    (_b, ctx) => {
      let resolved: string | undefined;
      let mouseTargets: Entity | undefined;

      world.query(localPointerQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          if (ctx.read(p, Pointer).device === "mouse") {
            mouseTargets = ctx.getRelation(p, Targets);
          }
          if (resolved !== undefined) continue;
          const rec = ctx.getRelation(p, ClaimedBy);
          if (rec === undefined) continue;

          if (ctx.has(rec, Drag) && ctx.hasTag(rec, RoutedMove)) {
            resolved = "grabbing";
          } else if (ctx.has(rec, LongPress) && ctx.hasTag(rec, P.tags.Recognized)) {
            resolved = "grabbing";
          } else if (ctx.hasTag(rec, RoutedResize)) {
            const handle = ctx.getRelation(rec, Captures);
            if (handle !== undefined && ctx.has(handle, HandleSpec)) {
              resolved = resizeCursorForAnchor(ctx.read(handle, HandleSpec).anchor);
            }
          } else if (ctx.hasTag(rec, RoutedPan)) {
            resolved = "grabbing";
          }
        }
      });

      if (resolved === undefined) {
        const tool = ctx.getResource(ActiveTool);
        if (tool?.id === "pan") resolved = "grab";
      }

      if (resolved === undefined && mouseTargets !== undefined) {
        if (ctx.has(mouseTargets, HandleSpec)) {
          resolved = resizeCursorForAnchor(ctx.read(mouseTargets, HandleSpec).anchor);
        } else if (ctx.has(mouseTargets, Position)) {
          resolved = "default";
        }
      }

      cursor = resolved ?? "default";
    },
    { name: "cursorSync" },
  );

  return Object.assign(system, { readCursor: () => cursor });
}
