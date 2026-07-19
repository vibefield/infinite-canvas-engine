/**
 * insertByDrag — the tray-adoption op (2026-07-19, James: the widget tray).
 *
 * Called from the app's tray-tile `pointerdown` (which `stopPropagation`s the
 * native down — the sanctioned widget-content boundary, design-002 §8). Two
 * event-time moves, then the ENGINE owns everything:
 *
 *  1. DRAFT-spawn the ghost (design-001 §3; instantiate `{ draft: true }`) —
 *     a runtime instance of the widget prefab centered under the pointer,
 *     equipped + Active + top-of-frame IMMEDIATELY (the equip system runs in
 *     `derive`, AFTER this tick's pick — the down below must find the ghost
 *     indexed and topmost in the SAME tick, so the op stamps what equip
 *     would). Two capability tags are deliberately withheld:
 *     - `LongPressDrag`: a tray insert is always instant-drag — nobody holds
 *       500ms over a palette;
 *     - `SweepsContained`: a comment ghost at the tray's world point must not
 *       sweep the widgets resting under the tray into the insert.
 *     The projected twin gets the FULL tag set from the equip system.
 *
 *  2. Enqueue ONE synthetic un-flagged `down` (Law 2 — this op is an adapter
 *     here, it only enqueues; the GL router precedent). Next tick: spatialSync
 *     indexes the ghost, targeting resolves it topmost, the Drag recognizer
 *     captures it — and the ordinary L0–L4 stack runs the whole drag: lift,
 *     snap, drop targets, folder consume. moveBehavior's ghost terminals
 *     promote (one `create` tx) or fly the ghost home and reap it.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { screenToWorld, type CameraState } from "@ice/kernel";
import { Camera, ChildOf, InsertGhost, LongPressDrag, SweepsContained } from "../catalog";
import { Active } from "../catalog/camera-derived";
import { instantiate } from "../engine/instantiate";
import { NO_MODS, type InputQueue } from "../input/queue";
import { WidgetEquipped, widgets } from "../widget/define-widget";
import { widgetSpawnInits } from "../widget/spawn";
import { frameParent } from "./sibling-order";

const IDENTITY_CAM: CameraState = { x: 0, y: 0, zoom: 1 };

export interface InsertByDragOpts {
  /** The press point in canvas-container CSS px (the kernel screen space). */
  readonly screenX: number;
  readonly screenY: number;
  /** Prop overrides for the eventual create (validated by widgetSpawnInits). */
  readonly props?: Readonly<Record<string, unknown>>;
  /** Adapter pointer id of the pressing pointer (default "mouse"). */
  readonly pointerId?: string;
  readonly device?: "mouse" | "touch" | "pen";
  /** PointerEvent.buttons at the press (default 1 = primary). */
  readonly buttons?: number;
}

export function insertByDrag(
  world: World,
  queue: InputQueue,
  type: string,
  opts: InsertByDragOpts,
): Entity {
  const widget = widgets.get(type);
  if (widget === undefined) throw new Error(`ice: insertByDrag — unknown widget type "${type}".`);

  const cam = world.getResource(Camera) ?? IDENTITY_CAM;
  const wp = screenToWorld(opts.screenX, opts.screenY, cam);
  const w = widget.defaultSize.w;
  const h = widget.defaultSize.h;
  // Centered under the pointer — the Figma/FigJam palette grab point; Grab
  // latches the offset at claim so it stays centered for the whole drag.
  const { prefab, overrides } = widgetSpawnInits(type, {
    x: wp.x - w / 2,
    y: wp.y - h / 2,
    w,
    h,
    ...(opts.props !== undefined ? { props: opts.props } : {}),
  });

  const ghost = instantiate(prefab, { into: "world", world }, { draft: true, overrides });
  world.addComponent(ghost, InsertGhost, {
    type,
    props: JSON.stringify(opts.props ?? {}),
    screenX: opts.screenX,
    screenY: opts.screenY,
  });
  for (const tag of widget.capabilityTags) {
    if (tag === LongPressDrag || tag === SweepsContained) continue;
    world.addTag(ghost, tag);
  }
  world.addTag(ghost, WidgetEquipped);
  world.addTag(ghost, Active);
  const parent = frameParent(world);
  if (parent !== undefined) world.setRelation(ghost, ChildOf, parent, "last"); // topmost — the pick must hit IT

  queue.enqueue({
    kind: "down",
    pointerId: opts.pointerId ?? "mouse",
    device: opts.device ?? "mouse",
    screenX: opts.screenX,
    screenY: opts.screenY,
    buttons: opts.buttons ?? 1,
    mods: NO_MODS,
  });
  return ghost;
}
