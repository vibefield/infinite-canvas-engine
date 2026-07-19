/**
 * The demo scene: N gray-box entities scattered over a large world area via the
 * deterministic LCG. Each is a full interaction citizen — `Selectable` +
 * `Movable` (tap selects, drag moves; select-on-grab). Spawned outside any tick
 * (plain `world.spawn`, immediate on the runtime store) — app setup, not a
 * gesture write.
 *
 * Stacking (petition 8): the DURABLE seed hangs every box on the board root's
 * ordered `ChildOf` sequence — spawn order IS the sibling order. The RUNTIME
 * seed has no board root (doc-less world) and stays edge-less: the engine's
 * legacy fallback orders it (z absent ⇒ entity asc = spawn order), and the
 * drag elevate is a structural no-op there — graybox's own renderer never
 * sorted by z anyway.
 */
import {
  BoardRoot,
  ChildOf,
  type DocSession,
  type Entity,
  Movable,
  Position,
  Selectable,
  Size,
  type World,
  defineQuery,
} from "@ice/core";
import { inRange, makePrng } from "./prng";

export interface SceneOpts {
  /** Entity count. */
  count?: number;
  /** LCG seed — same seed ⇒ same layout. */
  seed?: number;
  /** Square world extent the boxes scatter across (centered on the origin). */
  spread?: number;
  minSize?: number;
  maxSize?: number;
}

export interface Scene {
  /** All spawned entities, in spawn order (stable — used to pick a drag target). */
  entities: Entity[];
}

export function spawnScene(world: World, opts: SceneOpts = {}): Scene {
  const count = opts.count ?? 10_000;
  const spread = opts.spread ?? 8_000;
  const minSize = opts.minSize ?? 40;
  const maxSize = opts.maxSize ?? 140;
  const rand = makePrng(opts.seed ?? 0x1234_5678);

  const half = spread / 2;
  const entities: Entity[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const x = inRange(rand, -half, half);
    const y = inRange(rand, -half, half);
    const w = inRange(rand, minSize, maxSize);
    const h = inRange(rand, minSize, maxSize);
    entities[i] = world.spawn({
      components: [
        [Position, { x, y }],
        [Size, { w, h }],
      ],
      tags: [Selectable, Movable],
    });
  }
  return { entities };
}

const sceneBoxQ = defineQuery([Position, Size]);

/**
 * Seed the scene as DURABLE document content — one `store.transaction` spawning
 * every box, so moves commit and sync across tabs (M5). The spawn is
 * `undoable: false`: the initial document existing is not a user edit, so the
 * first Cmd-Z should not wipe the canvas (design.md §12 janitorial transforms).
 * Only the durable CELLS (Position/Size) plus the board-root `ChildOf` edge are
 * written here — bare `tx.spawn`s carry no prefab edge, so without the explicit
 * setRelation the boxes would be UNORDERED (petition 8). The runtime capability
 * tags are added post-projection by {@link equipSceneBoxes} — the durable.test
 * pattern (capability tags are runtime riders on durable entities).
 */
export function spawnSceneDurable(session: DocSession, world: World, opts: SceneOpts = {}): number {
  const count = opts.count ?? 500;
  const spread = opts.spread ?? 3_000;
  const minSize = opts.minSize ?? 40;
  const maxSize = opts.maxSize ?? 140;
  const rand = makePrng(opts.seed ?? 0x1234_5678);
  const half = spread / 2;

  // Named by doc-kit at create/open — a session always has one on this path.
  const root = world.getResource(BoardRoot)?.root;
  session.store.transaction((tx) => {
    for (let i = 0; i < count; i++) {
      const x = inRange(rand, -half, half);
      const y = inRange(rand, -half, half);
      const w = inRange(rand, minSize, maxSize);
      const h = inRange(rand, minSize, maxSize);
      const e = tx.spawn({
        components: [
          [Position, { x, y }],
          [Size, { w, h }],
        ],
      });
      if (root !== undefined) tx.setRelation(e, ChildOf, root, "last");
    }
  }, { undoable: false });
  return count;
}

/**
 * Add the runtime `Selectable`/`Movable` capability tags to every projected scene
 * box (runs on BOTH the fresh-spawn and restore paths — a restored document
 * carries only the durable cells, never the runtime tags). Idempotent. Call
 * after a `world.sync()` so the durable entities have projected. Returns the
 * count equipped.
 */
export function equipSceneBoxes(world: World): number {
  // Collect during the walk, mutate after: `world.addTag` is structural and
  // THROWS mid-iteration (a tag flip can reorder archetype rows under the
  // walk). Outside a system there is no ctx to defer through, so two passes.
  const bare: Entity[] = [];
  world.query(sceneBoxQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (!world.hasTag(e, Selectable)) bare.push(e);
    }
  });
  for (const e of bare) {
    world.addTag(e, Selectable);
    world.addTag(e, Movable);
  }
  return bare.length;
}
