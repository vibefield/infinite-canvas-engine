/**
 * The frame-trace rig (implementation-plan M4 exit: "scripted synthetic
 * pointers assert tick-by-tick outcomes").
 *
 * Drives the REAL engine loop (`engine.step`) with synthetic input through the
 * real queue — nothing is mocked below the adapter line. Targeting (L1) is the
 * one synthetic piece pre-picking: a react-phase test system applies a
 * test-declared pointerId → entity map as `Targets`/`TouchesExact` edges, in
 * exactly the phase slot real picking occupies — L2+ cannot tell the
 * difference, and picking's own suite covers L1.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { createWorld, defineQuery, defineSystem } from "@vibecook/strata-ecs";
import {
  Movable,
  Pointer,
  Position,
  Resizable,
  Selectable,
  Size,
  SnapSource,
  StackZ,
  Targets,
  TouchesExact,
  createEngine,
  createRecordingCommitSink,
  installInteractionCore,
  type Engine,
  type InputMods,
  type InteractionCore,
} from "../../src";
import { NO_MODS, type InputEvent } from "../../src/input/queue";

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
}

export interface TraceRig {
  world: World;
  engine: Engine;
  core: InteractionCore;
  sink: ReturnType<typeof createRecordingCommitSink>;
  /** Advance n frames (16ms each). */
  step(n?: number): void;
  /** Declare what the pointer is over (synthetic L1). undefined = canvas fallback. */
  target(pointerId: string, entity: Entity | undefined): void;
  down(pointerId: string, x: number, y: number, opts?: { button?: number; mods?: Partial<InputMods> }): void;
  move(pointerId: string, x: number, y: number, opts?: { mods?: Partial<InputMods> }): void;
  up(pointerId: string, x: number, y: number, opts?: { mods?: Partial<InputMods> }): void;
  cancel(pointerId: string, x: number, y: number): void;
  wheel(x: number, y: number, dx: number, dy: number, pinch?: number): void;
  key(mods: Partial<InputMods>): void;
  spawnBox(opts: BoxOpts): Entity;
  /** The pointer entity for an id (undefined before its first event lands). */
  pointerEntity(pointerId: string): Entity | undefined;
}

function deviceOf(pointerId: string): InputEvent["device"] {
  if (pointerId.startsWith("touch")) return "touch";
  if (pointerId === "pen") return "pen";
  return "mouse";
}

export function createTraceRig(): TraceRig {
  const world = createWorld();
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const core = installInteractionCore(engine, { sink });

  // Synthetic L1: the declared map, applied every frame in the react slot.
  const targetsOf = new Map<string, Entity | undefined>();
  engine.addSystems(
    "react",
    defineSystem(
      pointerQ,
      (b, ctx) => {
        for (const r of b) {
          const p = b.entity(r);
          const id = ctx.read(p, Pointer).id ?? ""; // bare string fields type as string | null
          const declared = targetsOf.has(id) ? targetsOf.get(id) : undefined;
          const wanted = declared !== undefined && ctx.isAlive(declared) ? declared : core.canvasSurface;
          if (ctx.getRelation(p, TouchesExact) !== wanted) ctx.setRelation(p, TouchesExact, wanted);
          if (ctx.getRelation(p, Targets) !== wanted) ctx.setRelation(p, Targets, wanted);
        }
      },
      { name: "testPicking" },
    ),
  );

  let now = 1000;
  const heldButtons = new Map<string, number>();

  const enqueue = (
    kind: InputEvent["kind"],
    pointerId: string,
    x: number,
    y: number,
    buttons: number,
    mods?: Partial<InputMods>,
    wheel?: { dx: number; dy: number; pinch: number },
  ): void => {
    core.queue.enqueue({
      kind,
      pointerId,
      device: deviceOf(pointerId),
      screenX: x,
      screenY: y,
      buttons,
      mods: { ...NO_MODS, ...mods },
      ...(wheel !== undefined ? { wheel } : {}),
    });
  };

  return {
    world,
    engine,
    core,
    sink,

    step(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    },

    target(pointerId, entity) {
      targetsOf.set(pointerId, entity);
    },

    down(pointerId, x, y, opts) {
      const button = opts?.button ?? 1;
      const buttons = (heldButtons.get(pointerId) ?? 0) | button;
      heldButtons.set(pointerId, buttons);
      enqueue("down", pointerId, x, y, buttons, opts?.mods);
    },

    move(pointerId, x, y, opts) {
      enqueue("move", pointerId, x, y, heldButtons.get(pointerId) ?? 0, opts?.mods);
    },

    up(pointerId, x, y, opts) {
      heldButtons.set(pointerId, 0);
      enqueue("up", pointerId, x, y, 0, opts?.mods);
    },

    cancel(pointerId, x, y) {
      heldButtons.set(pointerId, 0);
      enqueue("cancel", pointerId, x, y, 0);
    },

    wheel(x, y, dx, dy, pinch = 0) {
      enqueue("wheel", "mouse", x, y, heldButtons.get("mouse") ?? 0, undefined, { dx, dy, pinch });
    },

    key(mods) {
      enqueue("key", "", 0, 0, 0, mods);
    },

    spawnBox(opts) {
      const tags = [
        ...(opts.selectable !== false ? [Selectable] : []),
        ...(opts.movable !== false ? [Movable] : []),
        ...(opts.resizable === true ? [Resizable] : []),
        ...(opts.snapSource === true ? [SnapSource] : []),
      ];
      return world.spawn({
        components: [
          [Position, { x: opts.x, y: opts.y }],
          [Size, { w: opts.w ?? 80, h: opts.h ?? 60 }],
          [StackZ, { z: opts.z ?? 0 }],
        ],
        tags,
      });
    },

    pointerEntity(pointerId) {
      let found: Entity | undefined;
      world.query(pointerQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          if (world.read(e, Pointer).id === pointerId) {
            found = e;
            return;
          }
        }
      });
      return found;
    },
  };
}
