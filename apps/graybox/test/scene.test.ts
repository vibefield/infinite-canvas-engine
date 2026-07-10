/**
 * Boot-path regression: spawnSceneDurable → world.sync() → equipSceneBoxes is
 * exactly what main.ts runs. equipSceneBoxes once mutated tags INSIDE the query
 * walk — strata throws on mid-iteration structural writes, so the demo crashed
 * at boot while every test happily passed around it. Never again.
 */
import {
  Movable,
  Position,
  Selectable,
  Size,
  createDocSession,
  createWorld,
  defineQuery,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { equipSceneBoxes, spawnSceneDurable } from "../src/scene";

describe("scene boot path", () => {
  it("equips every projected durable box with capability tags, idempotently", () => {
    const world = createWorld();
    const session = createDocSession(world);
    const count = spawnSceneDurable(session, { count: 25 });
    world.sync(); // durable structure projects at the frame boundary

    expect(equipSceneBoxes(world)).toBe(count); // first pass equips all
    expect(equipSceneBoxes(world)).toBe(0); // idempotent

    let tagged = 0;
    // Count via a fresh walk — reads only.
    world.query(defineQuery([Position, Size])).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        if (world.hasTag(e, Selectable) && world.hasTag(e, Movable)) tagged += 1;
      }
    });
    expect(tagged).toBe(count);
  });
});
