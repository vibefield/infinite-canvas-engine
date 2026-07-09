/**
 * The demo scene: N gray-box entities scattered over a large world area via the
 * deterministic LCG. Each is a full interaction citizen — `Selectable` +
 * `Movable` (tap selects, drag moves; select-on-grab) with a `StackZ` so the
 * moveClaim elevate has something to raise. Spawned outside any tick (plain
 * `world.spawn`, immediate on the runtime store) — app setup, not a gesture write.
 */
import {
  type Entity,
  Movable,
  Position,
  Selectable,
  Size,
  StackZ,
  type World,
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
        [StackZ, { z: i }],
      ],
      tags: [Selectable, Movable],
    });
  }
  return { entities };
}
