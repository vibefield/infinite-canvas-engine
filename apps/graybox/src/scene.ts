/**
 * The demo scene: N gray-box entities (Position + Size) scattered over a large
 * world area via the deterministic LCG. Spawned outside any tick (plain
 * `world.spawn`, immediate on the runtime store) — this is app setup, not a
 * gesture write, so no sovereignty/claim machinery is involved.
 */
import { type Entity, Position, Size, type World } from "@ice/core";
import { inRange, makePrng } from "./prng";

export interface SceneOpts {
  /** Entity count (M3 budget target: 10k). */
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
    entities[i] = world.spawn({ components: [[Position, { x, y }], [Size, { w, h }]] });
  }
  return { entities };
}
