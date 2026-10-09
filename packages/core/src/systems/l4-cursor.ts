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
 * The pegboard tray (design-017 §4, K3): a specimen on its board a thing to take, "grab", its copy lifted "grabbing" (K9), over
 * everything but the hand's. (design-018 §5: the lip's "pointer" retired with its handle — the drawer's handle is the app's DOM bar.)
 * Above all of them (design-015 §8, D3t-a): with an object IN HAND, the mode in hand's own
 * `cursor` (its `HeldToolDef.cursor` — "none" where the tool draws itself: the board's marker) while
 * the mouse is over the object's drawing surface (`HeldPointer.part` "content") or presses the tool —
 * and (design-019 §5, M24 LT2) over one of the kind's NAMED parts, the KIND's cursor when it names one:
 * the pose seam's `cursor` (its `open.cursor` — a link's `pointer`, a text field's `text`), asked each
 * run while the mouse is over such a part; undefined there falls to the rest, as ever.
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
import { resolveToolFor, widgetTypeFor } from "../canvas/engine-catalog";
import type { HeldPoseSlot } from "./held";
import {
  ActiveTool,
  CanvasSurface,
  Captures,
  ClaimedBy,
  Drag,
  GesturePhases,
  HandleSpec,
  Held,
  Tray,
  TrayPress,
  HeldPointer,
  HeldPress,
  HeldTool,
  LocalPointer,
  LongPress,
  Pointer,
  Position,
  RoutedMove,
  RoutedPan,
  RoutedResize,
  Targets,
} from "../catalog";
import { PrefabId } from "../schema/prefab";

const P = GesturePhases;

const anchorQ = defineQuery([CanvasSurface]);
const localPointerQ = defineQuery([Pointer, LocalPointer]);
const heldQ = defineQuery([Held]);
const trayQ = defineQuery([Tray]);

/** The mode in hand's cursor while a local mouse is over the held object's drawing surface or presses its tool (D3t-a); undefined otherwise. */
function heldToolCursor(world: World): string | undefined {
  const held = world.firstOf(heldQ);
  if (held === undefined) return undefined;
  const id = world.get(held, HeldTool)?.id ?? "";
  const typeId = world.get(held, PrefabId)?.id;
  if (id === "" || typeof typeId !== "string") return undefined;
  const cursor = widgetTypeFor(world, typeId)?.heldTools.find((t) => t.id === id)?.cursor;
  if (cursor === undefined) return undefined;
  let over = false;
  world.query(localPointerQ).each((b) => {
    for (const r of b) {
      const p = b.entity(r);
      if (world.read(p, Pointer).device !== "mouse") continue;
      if (world.get(p, HeldPointer)?.part === "content" || world.get(p, HeldPress)?.kind === "tool") over = true;
    }
  });
  return over ? cursor : undefined;
}

/**
 * The KIND's cursor in hand (design-019 §5, M24 LT2): the mouse over one of the held object's NAMED parts (any but `content` and
 * `frame` — `HeldPointer.part`) asks the pose seam (`HeldPoseSource.cursor` — the kind's `open.cursor`); undefined — the kind names
 * none there, no seam, nothing held.
 */
function heldKindCursor(world: World, pose: HeldPoseSlot | undefined): string | undefined {
  const source = pose?.current;
  if (source?.cursor === undefined) return undefined;
  const held = world.firstOf(heldQ);
  if (held === undefined) return undefined;
  let part = "";
  world.query(localPointerQ).each((b) => {
    for (const r of b) {
      const p = b.entity(r);
      if (world.read(p, Pointer).device === "mouse") part = world.get(p, HeldPointer)?.part ?? "";
    }
  });
  if (part === "" || part === "content" || part === "frame") return undefined;
  const c = source.cursor(held, part);
  return typeof c === "string" && c !== "" ? c : undefined;
}

/**
 * The pegboard tray under the mouse (design-017 §4, K3 — the tray input's facts): K9 (S12):
 * a specimen a thing to take (`Tray.hover`, the open hand), its copy lifted off the board (`Tray.take`) and, handed to the desk, carried
 * to its drop (the mouse's `TrayPress carry` — the ticks before the ghost's own drag is recognized included): the closed one.
 */
function trayCursor(world: World): string | undefined {
  const tray = world.firstOf(trayQ);
  const t = tray === undefined ? undefined : world.get(tray, Tray);
  if (t === undefined) return undefined;
  if ((t.take ?? "") !== "") return "grabbing";
  let carried = false;
  world.query(localPointerQ).each((b) => {
    for (const r of b) {
      const p = b.entity(r);
      if (world.read(p, Pointer).device === "mouse" && world.get(p, TrayPress)?.kind === "carry") carried = true;
    }
  });
  if (carried) return "grabbing";
  return (t.hover ?? "") !== "" ? "grab" : undefined;
}

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

/** `pose`: the stack's held pose slot (`installInteractionStack`'s `heldPose`) — the kind's cursor in hand rides it (M24 LT2). */
export function createCursorSync(world: World, opts: { readonly pose?: HeldPoseSlot } = {}): System & { readCursor(): string } {
  let cursor = "default";

  const system = defineSystem(
    anchorQ,
    (_b, ctx) => {
      let resolved: string | undefined = heldKindCursor(world, opts.pose) ?? heldToolCursor(world) ?? trayCursor(world);
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
        // Tool cursor override from the registry (design-005 §3) — the pan
        // tool's "grab" now lives on its ToolDef; unknown ids have none.
        const toolCursor = resolveToolFor(world, ctx.getResource(ActiveTool)?.id ?? "select").cursor;
        if (toolCursor !== undefined) resolved = toolCursor;
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
