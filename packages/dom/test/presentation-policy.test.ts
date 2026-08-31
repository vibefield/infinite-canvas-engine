/**
 * THE Q5 DEFAULT (design-012 §6.3, §11 Q5): live-dom at rest, composited on
 * drag.
 *
 * The asymmetry is the design — promotion is instant because it happens under
 * a gesture that masks its cost, demotion waits a settle window because a drop
 * is not the end of motion. These tests grade that asymmetry rather than just
 * "does it switch", because a policy that demoted on the release edge would
 * still pass every naive test while thrashing a slot free and a re-copy through
 * every re-grab.
 */
import {
  Grab,
  NO_ENTITY,
  Position,
  PrefabId,
  Size,
  createEngine,
  createWorld,
  defineWidget,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { createPresentationRegistry } from "../src/presentation-mode";
import { createPresentationPolicy } from "../src/presentation-policy";

const GRAB = { x: 0, y: 0, w: 10, h: 10, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 };
const SETTLE = 250;

// Module scope: the widget registry is process-global and these names are
// file-unique. The three declarations policy has to tell apart.
defineWidget({ type: "pp:free", surface: "dom", component: null });
defineWidget({ type: "pp:pinned-live", surface: "dom", component: null, presentation: { pin: "live-dom" } });
defineWidget({
  type: "pp:pinned-composited",
  surface: "dom",
  component: null,
  presentation: { pin: "composited" },
});
defineWidget({ type: "pp:island", surface: "gl", component: null });

function setup(options: { pinned?: (e: number) => boolean; type?: string } = {}) {
  const world = createWorld();
  const engine = createEngine(world);
  const presentation = createPresentationRegistry();
  let clock = 0;
  const policy = createPresentationPolicy(world, presentation, {
    settleMs: SETTLE,
    now: () => clock,
    ...(options.pinned !== undefined
      ? { pinned: (e: unknown) => (options.pinned as (x: unknown) => boolean)(e) }
      : {}),
  });
  engine.registerReflector(policy);
  const entity = world.spawn({
    components: [
      [Position, { x: 0, y: 0 }],
      [Size, { w: 100, h: 60 }],
      ...(options.type !== undefined ? [[PrefabId, { id: options.type }] as const] : []),
    ],
  });
  let frame = 0;
  return {
    world,
    presentation,
    policy,
    entity,
    step(ms = 0) {
      clock += ms;
      engine.step(frame++);
    },
    grab: () => world.addComponent(entity, Grab, GRAB),
    release: () => world.removeComponent(entity, Grab),
  };
}

describe("promotion", () => {
  it("leaves a resting card on the native text path", () => {
    // The whole point of the Q5 default: native caret, selection and threaded
    // scroll while the user reads and types.
    const { presentation, entity, step } = setup();
    step();
    expect(presentation.get(entity)).toBe("live-dom");
  });

  it("promotes on GRAB, in the same flush — no waiting under a gesture", () => {
    const { presentation, entity, step, grab, policy } = setup();
    step();
    grab();
    step();
    expect(presentation.get(entity)).toBe("composited");
    expect(policy.promotions()).toBe(1);
  });
});

describe("demotion", () => {
  it("does NOT demote on the release edge", () => {
    const { presentation, entity, step, grab, release } = setup();
    grab();
    step();
    release();
    step();
    // Still composited: the window has not expired, and a drop is not the end
    // of motion.
    expect(presentation.get(entity)).toBe("composited");
  });

  it("demotes once the settle window expires", () => {
    const { presentation, entity, step, grab, release, policy } = setup();
    grab();
    step();
    release();
    step();
    step(SETTLE + 1);
    expect(presentation.get(entity)).toBe("live-dom");
    expect(policy.demotions()).toBe(1);
  });

  it("a RE-GRAB inside the window cancels the demotion entirely", () => {
    // The case the debounce exists for: one user gesture with a momentary
    // release must not cost a demote/promote pair, because each transition
    // frees a slot and buys a re-copy.
    const { presentation, entity, step, grab, release, policy } = setup();
    grab();
    step();
    release();
    step(SETTLE / 2);
    grab();
    step();
    step(SETTLE + 1);
    expect(presentation.get(entity)).toBe("composited");
    expect(policy.demotions()).toBe(0);
    expect(policy.promotions()).toBe(1); // still the ONE promotion
    expect(policy.settling()).toBe(0);
  });

  it("expires on the CLOCK, not on a stamp", () => {
    // Nothing writes ECS when 250 ms pass. A policy gated purely on observed
    // dirt would leave a dropped card composited until the user happened to
    // touch something else.
    const { presentation, entity, step, grab, release } = setup();
    grab();
    step();
    release();
    step();
    // No further ECS writes at all — only time.
    step(SETTLE + 1);
    expect(presentation.get(entity)).toBe("live-dom");
  });
});

describe("what the policy must not touch", () => {
  it("never overrides a widget that PINNED its presentation", () => {
    const { world, presentation, entity, step, grab } = setup({ pinned: () => true });
    presentation.set(entity, "picture");
    grab();
    step();
    step(SETTLE + 1);
    expect(presentation.get(entity)).toBe("picture");
    void world;
  });

  it("reads a TYPE's pin itself — an app cannot forget to wire one", () => {
    // The pin lives in `defineWidget({presentation:{pin}})`, and policy asks
    // the registry rather than being handed a predicate. An app that never
    // passed `pinned` still gets the declaration honoured.
    const { presentation, entity, step, grab, release, policy } = setup({ type: "pp:pinned-live" });
    step();
    grab();
    step();
    // A pinned live-dom card keeps its native caret THROUGH the drag — the
    // whole reason a text-heavy widget declares one.
    expect(presentation.get(entity)).toBe("live-dom");
    expect(policy.promotions()).toBe(0);
    release();
    step(SETTLE + 1);
    expect(presentation.get(entity)).toBe("live-dom");
    expect(policy.demotions()).toBe(0);
  });

  it("takes no ownership of a pinned type, even when the registry disagrees", () => {
    // The pinned-composited direction, and the version of it that can actually
    // fail. Seeding the declared mode is domWidgets' job (it happens where the
    // host's parent is chosen), so policy meets this card BEFORE anything
    // agrees with its pin. Without the pin it would promote on the grab, take
    // ownership, and demote it to LIVE-DOM one settle window later — a
    // pinned-composited card parked in the one mode it is pinned out of.
    const { presentation, entity, step, grab, release, policy } = setup({
      type: "pp:pinned-composited",
    });
    step();
    grab();
    step();
    expect(policy.promotions()).toBe(0);
    release();
    step(SETTLE + 1);
    expect(policy.demotions()).toBe(0);
    expect(presentation.get(entity)).toBe("live-dom"); // untouched, not "corrected"
  });

  it("never promotes a GL widget — a promotion would EVICT its island source", () => {
    // Not merely pointless. Island sources are registered by entity
    // (r3f/webgpu-sources.ts) and a promotion moves the widget's chrome host
    // under the L1 canvas, where domWidgets registers a `dom` source for the
    // same entity — `register` replaces, so the island would be overwritten by
    // its own card body.
    const { presentation, entity, step, grab, policy } = setup({ type: "pp:island" });
    step();
    grab();
    step();
    expect(presentation.get(entity)).toBe("live-dom"); // untouched: policy never wrote
    expect(policy.promotions()).toBe(0);
  });

  it("still promotes an entity with no widget type at all", () => {
    // The guard refuses only what is KNOWN to have no live-dom mode. A
    // typeless entity has no island source to protect, so it keeps the
    // behaviour it always had.
    const { presentation, entity, step, grab } = setup();
    grab();
    step();
    expect(presentation.get(entity)).toBe("composited");
  });

  it("demotes only what IT promoted", () => {
    // An app that pinned a card composited by hand keeps it composited: the
    // policy owns its own promotions and nothing else.
    const { presentation, entity, step, policy } = setup();
    presentation.set(entity, "composited");
    step();
    step(SETTLE + 1);
    expect(presentation.get(entity)).toBe("composited");
    expect(policy.demotions()).toBe(0);
  });

  it("forgets a card that despawned mid-settle instead of writing to it", () => {
    const { world, presentation, entity, step, grab, release } = setup();
    grab();
    step();
    release();
    step();
    world.destroy(entity);
    step(SETTLE + 1);
    // Cleared, not set: domWidgets already dropped the host and the
    // registration when it left the store.
    expect([...presentation.entries()]).toHaveLength(0);
  });
});
