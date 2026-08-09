/**
 * M6 spine: defineWidget compile → spawnWidget → projection → equip →
 * cull/LRU/mount store, end to end on the real engine loop.
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  Container,
  KeyboardExclusive,
  Movable,
  Opacity,
  Position,
  Resizable,
  Selectable,
  Size,
  SnapTarget,
  Viewport,
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
  surface: "dom",
  component: null,
  sizeMode: "auto-height",
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
      defineWidget({ type: "wt:card", surface: "dom", component: null }),
    ).toThrow(/already defined/);
    expect(() =>
      defineWidget({
        type: "wt:dupGroups",
        props: { a: p.string({ default: "" }) },
        groups: { g1: ["a"], g2: ["a"] },
        surface: "dom",
        component: null,
      }),
    ).toThrow(/two groups/);
  });
});

describe("spawnWidget → equip → mount store", () => {
  it("spawns durably, equips capability tags at projection, and mounts when visible", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const session = createDocSession(world);
    const runtime = installWidgetRuntime(engine);
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

    step(2); // equip tags land, then cull+mount see them
    expect(world.hasTag(e, Selectable)).toBe(true);
    expect(world.hasTag(e, Movable)).toBe(true);
    const snap = runtime.store.getSnapshot();
    expect(snap.some((m) => m.entity === e && !m.hidden)).toBe(true);
  });

  it("hides off-viewport widgets but keeps them mounted; LRU evicts past the budget", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const session = createDocSession(world);
    const runtime = installWidgetRuntime(engine, { keepMounted: 4 });
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w: 500, h: 500, dpr: 1 });

    // 3 in view, 6 far away (off-view from the start — never mounted).
    const inView = [0, 1, 2].map((i) =>
      spawnWidget(session.store, world, "wt:card", { x: 10 + i * 50, y: 10 }),
    );
    // Clustered tight so ALL SIX fit the 500px viewport at the far camera —
    // the hidden budget must hit max(0, 4 - 6) = 0 for full eviction.
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
    const snap1 = runtime.store.getSnapshot();
    expect(snap1.filter((m) => !m.hidden)).toHaveLength(3);
    expect(snap1.some((m) => farAway.includes(m.entity))).toBe(false); // never visible ⇒ never mounted

    // Pan away: the 3 go hidden-but-mounted (within budget 4).
    world.setResource(Camera, { x: 50_000, y: 50_000, zoom: 1, gesturing: false });
    step(2);
    const snap2 = runtime.store.getSnapshot();
    expect(snap2).toHaveLength(3);
    expect(snap2.every((m) => m.hidden)).toBe(true);

    // Visit the far cluster: 6 become visible; hidden budget (4 - 6 visible = 0)
    // evicts all 3 old hidden ones.
    world.setResource(Camera, { x: 9_900, y: 9_900, zoom: 1, gesturing: false });
    step(2);
    const snap3 = runtime.store.getSnapshot();
    expect(snap3.filter((m) => !m.hidden).length).toBeGreaterThanOrEqual(1);
    for (const e of inView) {
      expect(snap3.some((m) => m.entity === e)).toBe(false); // LRU-evicted
    }
  });
});

describe("keyboard claim declaration (design-007 §3.1)", () => {
  it("keyboard:'exclusive' stamps KeyboardExclusive and rides the registry", () => {
    const Term = defineWidget({
      type: "wt:terminal",
      surface: "dom",
      component: null,
      interaction: { keyboard: "exclusive", keyboardEscape: "widget" },
    });
    expect(Term.capabilityTags).toContain(KeyboardExclusive);
    expect(Term.keyboard).toBe("exclusive");
    expect(Term.keyboardEscape).toBe("widget");

    const Plain = defineWidget({ type: "wt:plain-card", surface: "dom", component: null });
    expect(Plain.capabilityTags).not.toContain(KeyboardExclusive);
    expect(Plain.keyboard).toBe("shared"); // the default — undeclared widgets unchanged
    expect(Plain.keyboardEscape).toBe("release");
  });
});
