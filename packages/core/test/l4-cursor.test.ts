/**
 * L4 cursor resolution (design-003 §7). Worlds are hand-built directly on
 * `World` (spawn/addTag/setRelation, outside any tick) — memoryless
 * resolution means each test only needs the world state the priority tree
 * reads, then a single `derive` tick to observe `readCursor()`.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { createWorld, phase } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
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
} from "../src/catalog";
import { createCursorSync } from "../src/systems/l4-cursor";

const P = GesturePhases;

function setup() {
  const world = createWorld();
  world.spawn({ tags: [CanvasSurface] }); // the anchor createCursorSync schedules on
  const sync = createCursorSync(world);
  const run = () => world.tick([phase("derive", [sync])]);
  return { world, sync, run };
}

function spawnMouse(world: World): Entity {
  return world.spawn({
    components: [[Pointer, { id: "mouse-1", device: "mouse" }]],
    tags: [LocalPointer],
  });
}

describe("createCursorSync — priority 1: live ClaimedBy claim", () => {
  it("Drag + RoutedMove → grabbing", () => {
    const { world, sync, run } = setup();
    const pointer = spawnMouse(world);
    const rec = world.spawn({ components: [[Drag, {}]] });
    world.addTag(rec, RoutedMove);
    world.setRelation(pointer, ClaimedBy, rec);

    run();
    expect(sync.readCursor()).toBe("grabbing");
  });

  it("LongPress in Recognized → grabbing", () => {
    const { world, sync, run } = setup();
    const pointer = spawnMouse(world);
    const rec = world.spawn({ components: [[LongPress, {}]] });
    P.set(world, rec, "Recognized");
    world.setRelation(pointer, ClaimedBy, rec);

    run();
    expect(sync.readCursor()).toBe("grabbing");
  });

  it("a LongPress claim NOT in Recognized does not resolve to grabbing (falls through to default)", () => {
    const { world, sync, run } = setup();
    const pointer = spawnMouse(world);
    const rec = world.spawn({ components: [[LongPress, {}]] });
    P.set(world, rec, "Possible");
    world.setRelation(pointer, ClaimedBy, rec);

    run();
    expect(sync.readCursor()).toBe("default");
  });

  it.each([
    ["nw", "nwse-resize"],
    ["se", "nwse-resize"],
    ["ne", "nesw-resize"],
    ["sw", "nesw-resize"],
    ["n", "ns-resize"],
    ["s", "ns-resize"],
    ["e", "ew-resize"],
    ["w", "ew-resize"],
  ] as const)("RoutedResize claim on handle anchor %s → %s", (anchor, expected) => {
    const { world, sync, run } = setup();
    const pointer = spawnMouse(world);
    const handle = world.spawn({ components: [[HandleSpec, { anchor }]] });
    const rec = world.spawn({ components: [[Drag, {}]] });
    world.addTag(rec, RoutedResize);
    world.setRelation(rec, Captures, handle);
    world.setRelation(pointer, ClaimedBy, rec);

    run();
    expect(sync.readCursor()).toBe(expected);
  });

  it("RoutedPan → grabbing", () => {
    const { world, sync, run } = setup();
    const pointer = spawnMouse(world);
    const rec = world.spawn({ components: [[Drag, {}]] });
    world.addTag(rec, RoutedPan);
    world.setRelation(pointer, ClaimedBy, rec);

    run();
    expect(sync.readCursor()).toBe("grabbing");
  });

  it("beats the ActiveTool override (claim wins over a pan-tool setting)", () => {
    const { world, sync, run } = setup();
    world.setResource(ActiveTool, { id: "pan" });
    const pointer = spawnMouse(world);
    const rec = world.spawn({ components: [[Drag, {}]] });
    world.addTag(rec, RoutedMove);
    world.setRelation(pointer, ClaimedBy, rec);

    run();
    expect(sync.readCursor()).toBe("grabbing");
  });

  it("is memoryless: clearing the claim reverts the cursor on the very next run", () => {
    const { world, sync, run } = setup();
    const pointer = spawnMouse(world);
    const rec = world.spawn({ components: [[Drag, {}]] });
    world.addTag(rec, RoutedMove);
    world.setRelation(pointer, ClaimedBy, rec);
    run();
    expect(sync.readCursor()).toBe("grabbing");

    world.destroy(rec); // ClaimedBy auto-clears with the target
    run();
    expect(sync.readCursor()).toBe("default");
  });
});

describe("createCursorSync — priority 2: ActiveTool override", () => {
  it("pan tool with no claim → grab", () => {
    const { world, sync, run } = setup();
    world.setResource(ActiveTool, { id: "pan" });

    run();
    expect(sync.readCursor()).toBe("grab");
  });

  it("select tool with no claim does not override (falls through to default)", () => {
    const { world, sync, run } = setup();
    world.setResource(ActiveTool, { id: "select" });

    run();
    expect(sync.readCursor()).toBe("default");
  });

  it("beats the mouse pointer's Targets fallback", () => {
    const { world, sync, run } = setup();
    world.setResource(ActiveTool, { id: "pan" });
    const pointer = spawnMouse(world);
    const widget = world.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    world.setRelation(pointer, Targets, widget);

    run();
    expect(sync.readCursor()).toBe("grab");
  });
});

describe("createCursorSync — priority 3: mouse pointer Targets kind", () => {
  it("targets a HandleSpec → directional resize by anchor", () => {
    const { world, sync, run } = setup();
    const pointer = spawnMouse(world);
    const handle = world.spawn({ components: [[HandleSpec, { anchor: "e" }]] });
    world.setRelation(pointer, Targets, handle);

    run();
    expect(sync.readCursor()).toBe("ew-resize");
  });

  it("targets a widget (entity with Position) → default", () => {
    const { world, sync, run } = setup();
    const pointer = spawnMouse(world);
    const widget = world.spawn({ components: [[Position, { x: 5, y: 5 }]] });
    world.setRelation(pointer, Targets, widget);

    run();
    expect(sync.readCursor()).toBe("default");
  });

  it("targets the CanvasSurface → default", () => {
    const { world, sync, run } = setup();
    const pointer = spawnMouse(world);
    const surface = world.spawn({ tags: [CanvasSurface] });
    world.setRelation(pointer, Targets, surface);

    run();
    expect(sync.readCursor()).toBe("default");
  });

  it("no Targets at all → default", () => {
    const { world, sync, run } = setup();
    spawnMouse(world);

    run();
    expect(sync.readCursor()).toBe("default");
  });
});

describe("createCursorSync — no pointers at all", () => {
  it("defaults to \"default\" with an empty world (still runs on the CanvasSurface anchor)", () => {
    const { sync, run } = setup();
    run();
    expect(sync.readCursor()).toBe("default");
  });
});
