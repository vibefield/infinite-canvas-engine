/**
 * Full-stack frame-trace rig for the L1 + remaining-L3 systems (M4 Opus-1).
 *
 * Unlike `rig.ts` (which fakes L1 with a declared pointerId→entity map), this
 * harness installs the REAL `createPickingSystems` into the react slot and the
 * remaining L3 systems in the design-003 §5 in-phase order
 * (select → snap → move → drop → resize → marquee). It mirrors rig.ts's spine
 * wiring but keeps full control of ctl:behave ordering, which installInteractionCore
 * fixes at [select, move] — snap must precede move and drop must follow it.
 *
 * Default camera is identity (zoom 1), so world coordinates equal screen px:
 * position a pointer at a box's world rect to hit it.
 */
import type { Component, Entity, World } from "@vibecook/strata-ecs";
import {
  Accepts,
  Camera,
  Container,
  HandleSpec,
  Movable,
  Pointer,
  Position,
  Provides,
  Resizable,
  Selectable,
  Selected,
  Size,
  SnapConfig,
  SnapSource,
  SnapTarget,
  StackZ,
  createEngine,
  createInputQueue,
  createRecordingCommitSink,
  createWorld,
  defineQuery,
  ensureCanvasSurface,
  type Engine,
  type InputMods,
  type InputQueue,
} from "../../src";
import { NO_MODS, type InputEvent } from "../../src/input/queue";
import { createCleanupSystems } from "../../src/systems/cleanup";
import { createL0Systems } from "../../src/systems/l0-input";
import { createArbitrationSystems } from "../../src/systems/l2-arbitrate";
import { createL2Systems } from "../../src/systems/l2-recognize";
import { createClaimSystems } from "../../src/systems/l3-claim";
import { createSelectMoveBehaviors } from "../../src/systems/l3-behave";
import { createDropSystem } from "../../src/systems/l3-drop";
import { createMarqueeBehavior, type MarqueeBuffer } from "../../src/systems/l3-marquee";
import { createPickingSystems } from "../../src/systems/l1-pick";
import { createResizeBehavior } from "../../src/systems/l3-resize";
import { createSnapSystem } from "../../src/systems/l3-snap";

const pointerQ = defineQuery([Pointer]);

export interface BoxOpts {
  x: number;
  y: number;
  w?: number;
  h?: number;
  z?: number;
  movable?: boolean;
  selectable?: boolean;
  resizable?: boolean;
  snapSource?: boolean;
  snapTarget?: boolean;
  container?: boolean;
  accepts?: string[];
  provides?: string[];
  selected?: boolean;
}

export interface HandleOpts {
  anchor: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface FullRig {
  world: World;
  engine: Engine;
  queue: InputQueue;
  sink: ReturnType<typeof createRecordingCommitSink>;
  canvasSurface: Entity;
  marqueeBuffer: MarqueeBuffer;
  step(n?: number): void;
  down(id: string, x: number, y: number, opts?: { button?: number; mods?: Partial<InputMods> }): void;
  move(id: string, x: number, y: number, opts?: { mods?: Partial<InputMods> }): void;
  up(id: string, x: number, y: number, opts?: { mods?: Partial<InputMods> }): void;
  cancel(id: string, x: number, y: number): void;
  spawnBox(opts: BoxOpts): Entity;
  spawnHandle(opts: HandleOpts): Entity;
  pointerEntity(id: string): Entity | undefined;
}

function deviceOf(id: string): InputEvent["device"] {
  if (id.startsWith("touch")) return "touch";
  if (id === "pen") return "pen";
  return "mouse";
}

export function createFullRig(): FullRig {
  const world = createWorld();
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const queue = createInputQueue();
  const canvasSurface = ensureCanvasSurface(world);

  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(SnapConfig, { enabled: true, thresholdPx: 5 });

  const l0 = createL0Systems(world, queue);
  const l2 = createL2Systems({ world });
  const arb = createArbitrationSystems();
  const claims = createClaimSystems(world);
  const behaviors = createSelectMoveBehaviors(world, sink);
  const cleanup = createCleanupSystems(world);

  const picking = createPickingSystems(world);
  const snap = createSnapSystem(world, picking.index);
  const drop = createDropSystem(world, picking.index);
  const resize = createResizeBehavior(world, sink);
  const marquee = createMarqueeBehavior(world, picking.index);

  engine.addSystems("input", l0.pointerLifecycle, l0.pointerIngest, l0.pointerWorldSync);
  engine.addSystems("react", picking.spatialSync, picking.picking); // REAL L1
  engine.addSystems("ctl:spawn", l2.cancelSweep, l2.recognizerSpawn, l2.wheelSpawn, l2.recognizerIntegrity);
  engine.addSystems("ctl:recognize", l2.tapSystem, l2.longPressSystem, l2.dragSystem, l2.pinchSystem, l2.wheelSystem);
  engine.addSystems("ctl:arbitrate", arb.arbitration, arb.dragRoute);
  engine.addSystems("ctl:claim", claims.moveClaim, claims.resizeClaim);
  // design-003 §5 in-phase order.
  engine.addSystems("ctl:behave", behaviors.selectBehavior, snap, behaviors.moveBehavior, drop, resize, marquee);
  engine.addSystems("cleanup", cleanup.recognizerReap, cleanup.oneTickClear);

  let now = 1000;
  const heldButtons = new Map<string, number>();

  const enqueue = (
    kind: InputEvent["kind"],
    id: string,
    x: number,
    y: number,
    buttons: number,
    mods?: Partial<InputMods>,
  ): void => {
    queue.enqueue({
      kind,
      pointerId: id,
      device: deviceOf(id),
      screenX: x,
      screenY: y,
      buttons,
      mods: { ...NO_MODS, ...mods },
    });
  };

  return {
    world,
    engine,
    queue,
    sink,
    canvasSurface,
    marqueeBuffer: marquee.buffer,

    step(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    },

    down(id, x, y, opts) {
      const button = opts?.button ?? 1;
      const buttons = (heldButtons.get(id) ?? 0) | button;
      heldButtons.set(id, buttons);
      enqueue("down", id, x, y, buttons, opts?.mods);
    },
    move(id, x, y, opts) {
      enqueue("move", id, x, y, heldButtons.get(id) ?? 0, opts?.mods);
    },
    up(id, x, y, opts) {
      heldButtons.set(id, 0);
      enqueue("up", id, x, y, 0, opts?.mods);
    },
    cancel(id, x, y) {
      heldButtons.set(id, 0);
      enqueue("cancel", id, x, y, 0);
    },

    spawnBox(opts) {
      const tags = [
        ...(opts.selectable !== false ? [Selectable] : []),
        ...(opts.movable !== false ? [Movable] : []),
        ...(opts.resizable === true ? [Resizable] : []),
        ...(opts.snapSource === true ? [SnapSource] : []),
        ...(opts.snapTarget === true ? [SnapTarget] : []),
        ...(opts.container === true ? [Container] : []),
        ...(opts.selected === true ? [Selected] : []),
      ];
      const components: [Component, Record<string, unknown>][] = [
        [Position, { x: opts.x, y: opts.y }],
        [Size, { w: opts.w ?? 80, h: opts.h ?? 60 }],
        [StackZ, { z: opts.z ?? 0 }],
      ];
      if (opts.accepts !== undefined) components.push([Accepts, { list: JSON.stringify(opts.accepts) }]);
      if (opts.provides !== undefined) components.push([Provides, { list: JSON.stringify(opts.provides) }]);
      // biome-ignore lint/suspicious/noExplicitAny: heterogeneous spawn component list
      return world.spawn({ components: components as any, tags });
    },

    spawnHandle(opts) {
      return world.spawn({
        components: [
          [Position, { x: opts.x, y: opts.y }],
          [Size, { w: opts.w ?? 10, h: opts.h ?? 10 }],
          [HandleSpec, { anchor: opts.anchor }],
        ],
      });
    },

    pointerEntity(id) {
      let found: Entity | undefined;
      world.query(pointerQ as never).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          if (world.read(e, Pointer).id === id) {
            found = e;
            return;
          }
        }
      });
      return found;
    },
  };
}
