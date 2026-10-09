/**
 * M6 spine: defineWidget compile → spawnWidget → projection → equip → the cull,
 * end to end on the real engine loop (the LRU/mount store left at design-015 D5b).
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  Container,
  Culled,
  Movable,
  Opacity,
  Position,
  Resizable,
  Selectable,
  Size,
  SnapTarget,
  Viewport,
  Visible,
  createDocSession,
  createEngine,
  createWorld,
  defineWidget,
  installWidgetRuntime,
  p,
  spawnWidget,
  widgets,
} from "../src";

// Module-scope (schema registry is process-global; file-unique names).
const Card = defineWidget({
  type: "wt:card",
  version: 1,
  props: {
    title: p.string({ default: "Untitled" }),
    dense: p.boolean({ default: false }),
    color: p.enum(["gray", "blue"], { default: "gray" }),
    items: p.json(p.array(p.object({ text: p.string(), done: p.boolean() }))),
  },
  groups: { content: ["title", "items"], style: ["dense", "color"] },
  defaultSize: { w: 280, h: 200 },
  interaction: { selectable: true, movable: true, resizable: true, snap: "target" },
  container: { accepts: ["wt:chip"], provides: ["wt:card"] },
});

describe("defineWidget compile", () => {
  it("generates one component per group with DSL-typed fields and registers the prefab", () => {
    expect(widgets.get("wt:card")).toBe(Card);
    expect(Card.groups.map((g) => g.name).sort()).toEqual(["content", "style"]);
    expect(Card.propToGroup.title).toBe("content");
    expect(Card.propToGroup.dense).toBe("style");
    expect(Card.prefab.id).toBe("wt:card");
    expect(Card.prefab.version).toBe(1);
    // Capability recipe: selectable+movable+resizable, snap target, container.
    expect(Card.capabilityTags).toContain(Selectable);
    expect(Card.capabilityTags).toContain(Movable);
    expect(Card.capabilityTags).toContain(Resizable);
    expect(Card.capabilityTags).toContain(SnapTarget);
    expect(Card.capabilityTags).toContain(Container);
    // Opacity is optional-eligible on EVERY widget prefab (design-004 §3:
    // `{opacity}` is the whole per-widget composite fact) — a durable tx may
    // attach/write it without a per-widget declaration.
    expect(Card.prefab.eligible.has(Opacity)).toBe(true);
  });

  it("rejects duplicate types and overlapping groups", () => {
    expect(() =>
      defineWidget({ type: "wt:card" }),
    ).toThrow(/already defined/);
    expect(() =>
      defineWidget({
        type: "wt:dupGroups",
        props: { a: p.string({ default: "" }) },
        groups: { g1: ["a"], g2: ["a"] },
      }),
    ).toThrow(/two groups/);
  });
});

describe("spawnWidget → equip → mount store", () => {
  it("spawns durably, equips capability tags at projection, and mounts when visible", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const session = createDocSession(world);
    installWidgetRuntime(engine);
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w: 1000, h: 800, dpr: 1 });

    const e = spawnWidget(session.store, world, "wt:card", {
      x: 100,
      y: 100,
      props: { title: "Hello", color: "blue" },
    });

    let now = 0;
    const step = (n = 1) => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    };
    step(); // projection
    expect(world.read(e, Position)).toEqual({ x: 100, y: 100 });
    expect(world.read(e, Size)).toEqual({ w: 280, h: 200 });
    const content = Card.groups.find((g) => g.name === "content")?.component;
    expect(content).toBeDefined();
    if (content === undefined) return;
    expect((world.read(e, content) as { title: string }).title).toBe("Hello");

    step(2); // equip tags land, then the cull sees them
    expect(world.hasTag(e, Selectable)).toBe(true);
    expect(world.hasTag(e, Movable)).toBe(true);
    expect(world.hasTag(e, Visible)).toBe(true);
  });

  it("culls off-viewport widgets and flips them back as the camera moves (no mount store since design-015 D5b)", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const session = createDocSession(world);
    installWidgetRuntime(engine);
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w: 500, h: 500, dpr: 1 });

    // 3 in view, 6 far away (off-view from the start).
    const inView = [0, 1, 2].map((i) =>
      spawnWidget(session.store, world, "wt:card", { x: 10 + i * 50, y: 10 }),
    );
    const farAway = [0, 1, 2, 3, 4, 5].map((i) =>
      spawnWidget(session.store, world, "wt:card", { x: 10_000 + i * 60, y: 10_000 }),
    );

    let now = 0;
    const step = (n = 1) => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    };
    step(3);
    for (const e of inView) expect(world.hasTag(e, Visible)).toBe(true);
    for (const e of farAway) expect(world.hasTag(e, Culled)).toBe(true);

    // Pan away: the 3 are Culled.
    world.setResource(Camera, { x: 50_000, y: 50_000, zoom: 1, gesturing: false });
    step(2);
    for (const e of inView) expect(world.hasTag(e, Culled)).toBe(true);

    // Visit the far cluster: the 6 become Visible, the 3 stay Culled.
    world.setResource(Camera, { x: 9_900, y: 9_900, zoom: 1, gesturing: false });
    step(2);
    for (const e of farAway) expect(world.hasTag(e, Visible)).toBe(true);
    for (const e of inView) expect(world.hasTag(e, Culled)).toBe(true);
  });
});

describe("the keyboard claim declaration is RETIRED (design-019 §5, M24 LT2)", () => {
  it("interaction.keyboard / keyboardEscape are refused at definition, naming the lease and open.escape; a plain widget is unchanged", () => {
    expect(() => defineWidget({ type: "wt:terminal", interaction: { keyboard: "exclusive" } as never })).toThrow(
      /declares interaction\.keyboard — the keyboard claim is retired \(design-019 §5, M24 LT2\).*`EditorLease`.*open\.escape: "kind".*Drop it\./,
    );
    expect(() => defineWidget({ type: "wt:terminal-2", interaction: { keyboard: "shared", keyboardEscape: "widget" } as never })).toThrow(
      /interaction\.keyboard and interaction\.keyboardEscape — .*Drop them\./,
    );
    expect(widgets.get("wt:terminal")).toBeUndefined();   // refused before it was registered
    const Plain = defineWidget({ type: "wt:plain-card" });
    expect(Object.keys(Plain)).not.toContain("keyboard");
    expect(Object.keys(Plain)).not.toContain("keyboardEscape");
  });
});

describe("the wheel's and Escape's owners in hand (design-019 §5, M24 LT2)", () => {
  it("default to the hand's and the desk's; an object that opens may give them to its kind; refused on anything that does not open, and an unknown word refused", () => {
    const Plain = widgets.get("wt:plain-card") ?? defineWidget({ type: "wt:plain-card" });
    expect([Plain.heldWheel, Plain.heldEscape]).toEqual(["hand", "desk"]);
    const Page = defineWidget({ type: "wt:page", object: { name: "page" }, openable: true, heldWheel: "kind", heldEscape: "kind" });
    expect([Page.heldWheel, Page.heldEscape]).toEqual(["kind", "kind"]);
    const Book = defineWidget({ type: "wt:held-book", object: { name: "book" }, openable: true });
    expect([Book.heldWheel, Book.heldEscape]).toEqual(["hand", "desk"]);
    expect(() => defineWidget({ type: "wt:shut", object: { name: "shut" }, heldWheel: "kind" })).toThrow(/declares heldWheel or heldEscape but does not open/);
    expect(() => defineWidget({ type: "wt:faceless", heldEscape: "kind" })).toThrow(/does not open/);
    expect(() => defineWidget({ type: "wt:bad-wheel", object: { name: "b" }, openable: true, heldWheel: "page" as never })).toThrow(/heldWheel "page" — the wheel in hand is "hand" or "kind"/);
    expect(() => defineWidget({ type: "wt:bad-esc", object: { name: "b" }, openable: true, heldEscape: "release" as never })).toThrow(/heldEscape "release" — Escape in hand is "desk" or "kind"/);
  });
});
