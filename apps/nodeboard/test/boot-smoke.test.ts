/**
 * M8 exit (node-board): `boot()` runs end to end under happy-dom without
 * throwing and seeds the node graph into the durable doc — 6 nodes + 1 container
 * group + 1 wire. Headless mode (`mount: false`) exercises the whole
 * engine/session/seed/nav path, skipping only the browser-only pieces (grid, rAF,
 * relay, autosave, ResizeObserver, React mount).
 */
import { PrefabId, Wire, defineQuery } from "@ice/core";
import { afterEach, describe, expect, it } from "vitest";
import { boot } from "../src/app";
import type { NodeboardStorage } from "../src/storage";

/** In-memory autosave sink — a fresh (empty) store, so boot seeds. */
function memStorage(): NodeboardStorage {
  let bytes: Uint8Array | undefined;
  return {
    get: () => bytes,
    put: (b) => {
      bytes = b;
    },
    stashQuarantine: () => {},
    clear: () => {
      bytes = undefined;
    },
  };
}

const wireQ = defineQuery([Wire]);
const prefabQ = defineQuery([PrefabId]);

function countByPrefab(world: import("@ice/core").World, id: string): number {
  let n = 0;
  world.query(prefabQ).each((b) => {
    for (const r of b) if (world.read(b.entity(r), PrefabId).id === id) n++;
  });
  return n;
}

function countWires(world: import("@ice/core").World): number {
  let n = 0;
  world.query(wireQ).each((b) => {
    n += b.count;
  });
  return n;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("node-board M8 exit: boot smoke (headless)", () => {
  it("boots without throwing and seeds 6 nodes + 1 group + 1 wire", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const handle = await boot({ container, storage: memStorage(), mount: false });

    // 4 root nodes + 1 group + 2 inner nodes = 7 geometry-bearing widgets.
    expect(handle.widgetCount).toBe(7);
    expect(handle.session.readOnly).toBe(false);
    expect(handle.nav.depth()).toBe(0);

    // Seed composition: 3 math + 3 sum = 6 nodes, 1 group, 1 wire.
    expect(countByPrefab(handle.world, "math-node") + countByPrefab(handle.world, "sum-node")).toBe(6);
    expect(countByPrefab(handle.world, "group-node")).toBe(1);
    expect(countWires(handle.world)).toBe(1);

    handle.dispose();
  });
});
