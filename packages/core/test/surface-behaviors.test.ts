/**
 * THE DOOR (design-013 §0, D6, D7; plan §2 A1b) — the three standard surface
 * behaviours, and the schedule that makes their writes reach infra in the same
 * frame.
 *
 * These cases are `dom/test/presentation-policy.test.ts` transcribed onto the
 * new mechanism, case for case, because the asymmetry they grade is the design
 * and it did not change: promotion is instant because it happens under a
 * gesture that masks its cost, demotion waits a settle window because a drop is
 * not the end of motion. A behaviour that demoted on the release edge would
 * still pass every naive test while thrashing a slot free and a re-copy through
 * every re-grab.
 *
 * What DID change is where the answer lives, and the cases that could not exist
 * before are the ones about that: the window expires on `FrameInfo.clock`
 * rather than `performance.now()`; the pin cases become "which behaviour is
 * attached", because `defineWidget({ presentation })` is retired; and the last
 * case grades D1 — a pack registered AFTER the infra still reaches the clamp in
 * the frame it writes.
 *
 * ── Why this rig and not `behavior/harness.ts` ────────────────────────────
 * The harness spawns bare durable nodes and registers ONE behaviour, and these
 * behaviours are attached by `defineWidget` and stamped by `widgetEquip` onto
 * entities that equip also gives the six presentation components to. Hand-
 * stamping both would test the hooks while skipping the path that actually
 * runs them, and the D1 case needs a real `present:infra` group. So: a real
 * engine, the real equip system, the real behaviour runtime.
 */
import { createWorld, type Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  Culled,
  Grab,
  NO_ENTITY,
  Position,
  RequestedDemand,
  Size,
  SurfaceBand,
  SurfaceDemand,
  SurfaceKind,
  SurfaceTarget,
  Viewport,
  Visible,
  alwaysDom,
  alwaysGpu,
  createBehaviorRuntime,
  createEngine,
  createWidgetEquipSystem,
  defineBehavior,
  defineWidget,
  demandIntervalMs,
  domAtRest,
  installSurfaceInfra,
  registerStandardSurfaceBehaviors,
  setDevGuards,
} from "../src";
import { PrefabId } from "../src/schema/prefab";
import { ChromeSettings } from "../src/catalog/settings-resources";
import { Selected } from "../src/catalog/selection-presence";

const GRAB = { x: 0, y: 0, w: 10, h: 10, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 };
/** The behaviour's own default, and the number the cases below step against. */
const SETTLE = 250;
/** `FrameInfo.clock` advances by the step's dt; 16 ms a frame is the rig's. */
const STEP_MS = 16;
const STEPS_PAST_SETTLE = Math.ceil(SETTLE / STEP_MS) + 1;

// Module scope: the widget registry and strata's schema registry are
// process-global and throw on a duplicate name. File-unique types, one per
// shape the cases have to tell apart.
defineWidget({ type: "sb:card", surface: "dom", component: null });
defineWidget({ type: "sb:island", surface: "gl", component: null });
defineWidget({ type: "sb:pinnedDom", surface: "dom", component: null, behaviors: [alwaysDom] });
defineWidget({ type: "sb:picture", surface: "dom", component: null, behaviors: [alwaysGpu.with({ paused: true })] });
/** The one-card promotion of before the gesture set (2026-09-09): only the grabbed card moves. */
defineWidget({ type: "sb:solo", surface: "dom", component: null, behaviors: [domAtRest.with({ promoteBoard: false })] });
/** A card that stays LIVE at its bucket while it is carried — no still. */
defineWidget({ type: "sb:liveHeld", surface: "dom", component: null, behaviors: [domAtRest.with({ stillWhileGrabbed: false })] });
/** A gl widget that (wrongly) asks for the DOM — the D5 refusal's subject. */
defineWidget({ type: "sb:badIsland", surface: "gl", component: null, behaviors: [alwaysDom] });
/**
 * The OTHER way to ask a texture for the DOM: `domAtRest` demotes to `dom`
 * after the settle, so on a gl kind it is the same refusal one gesture later.
 */
defineWidget({ type: "sb:glAtRest", surface: "gl", component: null, behaviors: [domAtRest] });

/**
 * A PACK's own kind behaviour (design-013 §0) — DEFINED here, REGISTERED late
 * by the D1 case below. Defining it is process-global and costs nothing;
 * registering it is what appends its system to the `present` group, and that
 * is the ordering the case grades.
 */
const LatePack = defineBehavior("sbpack:surface.kiosk", {
  store: "runtime",
  phase: "present",
  reads: [Grab],
  writes: [SurfaceTarget],
  on: {
    changed(ctx) {
      for (const e of ctx.entities()) {
        ctx.set(e, SurfaceTarget, { target: ctx.world.has(e, Grab) ? "gpu" : "dom" });
      }
    },
  },
});
// Its type names it, so `defineWidget` appends no standard behaviour: LatePack
// is the sole writer of this card's target.
defineWidget({ type: "sb:kiosk", surface: "dom", component: null, behaviors: [LatePack] });

interface Fault {
  readonly behavior: string;
  readonly hook: string;
  readonly message: string;
}

/**
 * The real path: equip in `derive`, the standard behaviours at `present`, Band
 * and Demand in `present:infra`.
 */
function rig() {
  const world = createWorld();
  const engine = createEngine(world);
  const faults: Fault[] = [];
  /** What a behaviour said through `ctx.log` — the production half of D5. */
  const logs: string[] = [];
  engine.addSystems("derive", createWidgetEquipSystem(world));
  const behaviors = createBehaviorRuntime({
    world,
    engine,
    onFault: (behavior, hook, _entity, err) =>
      faults.push({ behavior, hook, message: err instanceof Error ? err.message : String(err) }),
    onLog: (_behavior, message) => logs.push(message),
  });
  registerStandardSurfaceBehaviors(behaviors);
  installSurfaceInfra(engine);
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });

  let now = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += STEP_MS;
      engine.step(now);
    }
  };
  const spawn = (type: string): Entity => {
    const e = world.spawn({
      components: [
        [Position, { x: 0, y: 0 }],
        [Size, { w: 100, h: 60 }],
        [PrefabId, { id: type }],
      ],
    });
    world.addTag(e, Visible);
    return e;
  };
  const target = (e: Entity): string | undefined => world.get(e, SurfaceTarget)?.target;
  return {
    world,
    engine,
    behaviors,
    faults,
    logs,
    step,
    spawn,
    target,
    grab: (e: Entity) => world.addComponent(e, Grab, GRAB),
    release: (e: Entity) => world.removeComponent(e, Grab),
    /** Step `n` frames, sampling the target after each — end states hide thrash. */
    sample: (e: Entity, n: number): (string | undefined)[] => {
      const seen: (string | undefined)[] = [];
      for (let i = 0; i < n; i++) {
        step();
        seen.push(target(e));
      }
      return seen;
    },
  };
}

describe("promotion", () => {
  it("leaves a resting card on the native text path", () => {
    // The whole point of the dom default: native caret, selection and threaded
    // scroll while the user reads and types.
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    expect(r.target(card)).toBe("dom");
  });

  it("promotes on GRAB, in the SAME step — no waiting under a gesture", () => {
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    r.grab(card);
    r.step();
    expect(r.target(card)).toBe("gpu");
  });

  it("projects the kind's requested demand at init, and the clamp follows it", () => {
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    // The REQUEST is the behaviour's (60 fps, the schema default); the CLAMP
    // is the Demand system's, and it is live because cull says Visible.
    expect(r.world.get(card, RequestedDemand)).toMatchObject({ mode: "live", fpsBucket: 60 });
    expect(r.world.get(card, SurfaceDemand)).toMatchObject({ mode: "live", fpsBucket: 60 });
  });
});

describe("demotion", () => {
  it("does NOT demote on the release edge", () => {
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    r.grab(card);
    r.step();
    r.release(card);
    r.step();
    // Still on the GPU: the window has not expired, and a drop is not the end
    // of motion.
    expect(r.target(card)).toBe("gpu");
  });

  it("demotes once the settle window expires", () => {
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    r.grab(card);
    r.step();
    r.release(card);
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(card)).toBe("dom");
  });

  it("a RE-GRAB inside the window cancels the demotion entirely", () => {
    // The case the debounce exists for: one user gesture with a momentary
    // release must not cost a demote/promote pair, because each transition
    // frees a slot and buys a re-copy.
    //
    // Sampled EVERY frame, not just at the end: a behaviour that forgot to
    // cancel the pending settle would demote at the original due time and
    // re-promote on the very next frame (the card is still grabbed), so the
    // end state is `gpu` either way and an end-state assertion grades nothing.
    // The mutation probe that dropped the cancel proved exactly that.
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    const seen: (string | undefined)[] = [];
    const sample = (n: number): void => {
      for (let i = 0; i < n; i++) {
        r.step();
        seen.push(r.target(card));
      }
    };
    r.grab(card);
    sample(1);
    r.release(card);
    sample(Math.floor(STEPS_PAST_SETTLE / 2));
    r.grab(card);
    sample(STEPS_PAST_SETTLE);
    expect(r.target(card)).toBe("gpu");
    expect(seen.filter((t) => t !== "gpu")).toEqual([]); // never once demoted
  });

  it("expires on the CLOCK, with no other write in the world", () => {
    // Nothing writes ECS when 250 ms pass. The old policy was a reflector with
    // `always: true` for exactly this reason; the behaviour gets it from the
    // `FrameInfo` poll in its reads, and the case is here because a `changed`
    // hook gated only on component churn would leave a dropped card on the GPU
    // until the user happened to touch something else.
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    r.grab(card);
    r.step();
    r.release(card);
    // From here: only time. No component is added, removed or written.
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(card)).toBe("dom");
  });

  it("demotes only what IT promoted — a hand-held gpu card survives a DRAG", () => {
    // A host that put a card on the GPU by hand keeps it there: the behaviour
    // owns its own promotions and nothing else. (The composited rig does
    // exactly this to hold a card composited for its static probes.)
    //
    // THE GRAB IS THE CASE. Without one this grades only "the behaviour does
    // not demote a card it never saw", which was true of the broken code too:
    // the promote loop took ownership of every grabbed instance whether or not
    // it changed anything, so the hand-held card came back from its first drag
    // and 250 ms later was silently demoted to `dom` — for good, since nothing
    // re-promotes a card that is not being dragged. The old policy's rule was
    // "own what `set()` actually changed", and this is that rule.
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    r.world.edit(card).set(SurfaceTarget, { target: "gpu" });
    r.step();
    expect(r.target(card)).toBe("gpu");

    r.grab(card);
    r.step();
    r.release(card);
    // Sampled every frame: a behaviour that owned it would demote exactly once,
    // at the due time, and an end-state assertion taken too early would miss it.
    const seen = r.sample(card, STEPS_PAST_SETTLE);
    expect(seen.filter((t) => t !== "gpu")).toEqual([]);
    expect(r.target(card)).toBe("gpu");
  });

  it("still demotes the card it DID promote, in the same rig", () => {
    // The other half of the pair, so "owns nothing" cannot pass by doing
    // nothing at all.
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    expect(r.target(card)).toBe("dom");
    r.grab(card);
    r.step();
    expect(r.target(card)).toBe("gpu");
    r.release(card);
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(card)).toBe("dom");
  });

  it("writes nothing for a card that despawned mid-settle", () => {
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    r.grab(card);
    r.step();
    r.release(card);
    r.step();
    r.world.destroy(card);
    // A write to a dead handle throws in strata, so "nothing happens" is a
    // real property here and not a tautology.
    expect(() => r.step(STEPS_PAST_SETTLE)).not.toThrow();
    expect(r.faults).toEqual([]);
  });
});

describe("the gesture set (2026-09-09)", () => {
  it("a grab promotes EVERY dom card of the behaviour in the same step, and pauses each of them", () => {
    // The lifted card is drawn by the ground; a resting card the DOM still paints sits
    // ABOVE the canvas (design-012 §6.3's artifact). Under a drag that is the wrong
    // stacking for the whole gesture, so the board goes to the GPU together — and as
    // STILLS: one picture each at promotion, held until the demotion.
    const r = rig();
    const a = r.spawn("sb:card");
    const b = r.spawn("sb:card");
    const c = r.spawn("sb:card");
    r.step(2);
    r.grab(a);
    r.step();
    expect([r.target(a), r.target(b), r.target(c)]).toEqual(["gpu", "gpu", "gpu"]);
    for (const e of [a, b, c]) {
      expect(r.world.get(e, RequestedDemand)).toMatchObject({ mode: "paused" });
      // The clamp keeps a paused ask paused, grabbed or not: interaction outranks a low
      // bucket, never a pause.
      expect(r.world.get(e, SurfaceDemand)).toMatchObject({ mode: "paused" });
    }
  });

  it("the set comes back together one settle window after the release, every card's own cadence restored", () => {
    const r = rig();
    const a = r.spawn("sb:card");
    const b = r.spawn("sb:card");
    r.step(2);
    r.grab(a);
    r.step();
    r.release(a);
    r.step();
    // The release edge demotes nothing, for either card.
    expect([r.target(a), r.target(b)]).toEqual(["gpu", "gpu"]);
    r.step(STEPS_PAST_SETTLE);
    expect([r.target(a), r.target(b)]).toEqual(["dom", "dom"]);
    for (const e of [a, b]) expect(r.world.get(e, RequestedDemand)).toMatchObject({ mode: "live", fpsBucket: 60, interactive: false });
  });

  it("a card another writer put on the GPU is neither paused by the set nor demoted with it", () => {
    const r = rig();
    const a = r.spawn("sb:card");
    const held = r.spawn("sb:card");
    r.step(2);
    r.world.edit(held).set(SurfaceTarget, { target: "gpu" });
    r.step();
    r.grab(a);
    r.step();
    expect(r.world.get(held, RequestedDemand)).toMatchObject({ mode: "live" });
    r.release(a);
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(a)).toBe("dom");
    expect(r.target(held)).toBe("gpu");
  });

  it("a grab of a DIFFERENT card inside the window keeps the whole set on the GPU", () => {
    // One window for the set: it opens at the last release and any grab cancels it.
    const r = rig();
    const a = r.spawn("sb:card");
    const b = r.spawn("sb:card");
    r.step(2);
    const seen: string[] = [];
    const sample = (n: number): void => {
      for (let i = 0; i < n; i++) {
        r.step();
        seen.push(`${r.target(a)}/${r.target(b)}`);
      }
    };
    r.grab(a);
    sample(1);
    r.release(a);
    sample(Math.floor(STEPS_PAST_SETTLE / 2));
    r.grab(b);
    sample(STEPS_PAST_SETTLE);
    expect(seen.filter((t) => t !== "gpu/gpu")).toEqual([]);
  });

  it("`promoteBoard: false` keeps the one-card promotion", () => {
    const r = rig();
    const a = r.spawn("sb:solo");
    const b = r.spawn("sb:solo");
    r.step(2);
    r.grab(a);
    r.step();
    expect([r.target(a), r.target(b)]).toEqual(["gpu", "dom"]);
    // …and the grabbed card is still a still.
    expect(r.world.get(a, RequestedDemand)).toMatchObject({ mode: "paused" });
    expect(r.world.get(b, RequestedDemand)).toMatchObject({ mode: "live" });
  });

  it("`stillWhileGrabbed: false` keeps the carried card live at its bucket, interactive", () => {
    const r = rig();
    const a = r.spawn("sb:liveHeld");
    r.step(2);
    r.grab(a);
    r.step();
    expect(r.target(a)).toBe("gpu");
    expect(r.world.get(a, RequestedDemand)).toMatchObject({ mode: "live", fpsBucket: 60 });
    expect(r.world.get(a, SurfaceDemand)).toMatchObject({ mode: "live", fpsBucket: 60, interactive: true });
  });
});

describe("which behaviour a widget type gets", () => {
  it("never touches a card whose type chose alwaysDom — it has no domAtRest instance", () => {
    // The old pin cases become this: a type that named its own behaviour is
    // not a card `domAtRest` has an opinion about, because `domAtRest` was
    // never attached to it.
    const r = rig();
    const pinned = r.spawn("sb:pinnedDom");
    r.step(2);
    expect(r.world.has(pinned, domAtRest.component)).toBe(false);
    expect(r.world.has(pinned, alwaysDom.component)).toBe(true);
    r.grab(pinned);
    r.step(2);
    expect(r.target(pinned)).toBe("dom");
    r.release(pinned);
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(pinned)).toBe("dom");
  });

  it("a gl widget gets alwaysGpu and never writes dom, grabbed or not", () => {
    // Not merely pointless. A gl island IS a texture; a `dom` target on one is
    // the D5 refusal's subject, and the Band system dev-throws on it.
    const r = rig();
    const island = r.spawn("sb:island");
    r.step(2);
    expect(r.world.has(island, alwaysGpu.component)).toBe(true);
    expect(r.world.has(island, domAtRest.component)).toBe(false);
    expect(r.target(island)).toBe("gpu");
    r.grab(island);
    r.step();
    r.release(island);
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(island)).toBe("gpu");
  });

  it("gives an entity with no widget type no behaviour and none of the six", () => {
    const r = rig();
    const bare = r.world.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    r.step(2);
    expect(r.world.has(bare, SurfaceKind)).toBe(false);
    expect(r.world.has(bare, SurfaceTarget)).toBe(false);
    expect(r.world.has(bare, domAtRest.component)).toBe(false);
    // And a grab on it is not this behaviour's business either.
    r.grab(bare);
    expect(() => r.step(2)).not.toThrow();
    expect(r.faults).toEqual([]);
  });

  it("alwaysGpu.with({ paused: true }) IS the old picture — gpu, clamped to paused", () => {
    // `picture` was never a third place for pixels to come from (§5). The
    // target is `gpu` and the demand is paused, so the last good picture stays
    // and nothing re-uploads — which is the whole of what the mode meant.
    const r = rig();
    const picture = r.spawn("sb:picture");
    r.step(2);
    expect(r.target(picture)).toBe("gpu");
    expect(r.world.get(picture, RequestedDemand)?.mode).toBe("paused");
    // After the clamp, not merely as requested: the Demand system is what a
    // consumer reads.
    expect(r.world.get(picture, SurfaceDemand)?.mode).toBe("paused");
    // And the BUCKET survives the pause, deliberately. `foldDemand` is kept
    // verbatim (D3) and it folds a bucket to 0 only for an INVISIBLE card;
    // a paused-but-visible one keeps the rate it would want if it were live,
    // which is the request the kind actually made. Nothing uploads either way
    // — `demandIntervalMs` answers Infinity on `mode === "paused"` before it
    // ever looks at the bucket — so this is vocabulary, not a leak.
    expect(r.world.get(picture, SurfaceDemand)?.fpsBucket).toBe(60);
    expect(demandIntervalMs(r.world.get(picture, SurfaceDemand) as never)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("REFUSES domAtRest on a gl kind at init, naming the widget type", () => {
    // The same D5 refusal as `alwaysDom`'s, and for the same reason one
    // gesture later: `domAtRest` writes `dom` at DEMOTION. Before this, the
    // behaviour declared `SurfaceKind` in its reads and never looked at it —
    // so a gl widget that named it was accepted, presented correctly, and then
    // 250 ms after its first drop wrote `dom` on a texture. What a developer
    // saw was the Band system's dev throw a frame later, naming an entity id
    // and no cause.
    const r = rig();
    const island = r.spawn("sb:glAtRest");
    r.step(2);
    expect(r.faults).toHaveLength(1);
    expect(r.faults[0]?.behavior).toBe(domAtRest.name);
    expect(r.faults[0]?.hook).toBe("init");
    expect(r.faults[0]?.message).toContain("sb:glAtRest");
    expect(r.faults[0]?.message).toContain("no live-DOM mode");
    expect(r.target(island)).toBe("gpu");
  });

  it("in PRODUCTION, domAtRest on a gl kind logs and writes nothing across a whole drag", () => {
    // Dev guards off is where a user is: the throw becomes a log, and the
    // behaviour must then hold the line by itself. Sampled every frame through
    // grab, release and the settle window — the broken code's only visible
    // moment was the demotion, one full window after the drop.
    setDevGuards(false);
    try {
      const r = rig();
      const island = r.spawn("sb:glAtRest");
      r.step(2);
      expect(r.faults).toEqual([]);
      expect(r.logs.filter((m) => m.includes("sb:glAtRest"))).toHaveLength(1);

      r.grab(island);
      const held = r.sample(island, 2);
      r.release(island);
      const after = r.sample(island, STEPS_PAST_SETTLE);
      expect([...held, ...after].filter((t) => t !== "gpu")).toEqual([]);
    } finally {
      setDevGuards(true);
    }
  });

  it("does not LAUNDER a gl card another writer left on dom — it writes neither value", () => {
    // The property, stated whole: `domAtRest` never writes the target of a kind
    // it is not for. A `dom` cell on a gl card is already illegal — every read
    // goes through `effectiveTarget`, which answers `gpu` regardless, and the
    // Band system's dev guard is what reports the real writer. Promoting it to
    // `gpu` on the grab would repair the symptom and hide that writer, and the
    // demotion 250 ms later would put it straight back.
    setDevGuards(false);
    try {
      const r = rig();
      const island = r.spawn("sb:glAtRest");
      r.step(2);
      r.world.edit(island).set(SurfaceTarget, { target: "dom" });
      r.step();
      r.grab(island);
      const seen = r.sample(island, 2);
      expect(seen.filter((t) => t !== "dom")).toEqual([]);
    } finally {
      setDevGuards(true);
    }
  });

  it("REFUSES alwaysDom on a gl kind at init, naming the widget type", () => {
    // A dev throw, contained by the framework's fault ladder: the instance is
    // marked failed rather than the frame being lost. Production coerces
    // instead (`effectiveTarget`), so this is loud where a developer can see
    // it and harmless where a user is.
    const r = rig();
    const bad = r.spawn("sb:badIsland");
    r.step(2);
    expect(r.faults).toHaveLength(1);
    expect(r.faults[0]?.behavior).toBe("ice:surface.alwaysDom");
    expect(r.faults[0]?.hook).toBe("init");
    expect(r.faults[0]?.message).toContain("sb:badIsland");
    expect(r.faults[0]?.message).toContain("no live-DOM mode");
    // It left the target alone: `gpu` is the only one a gl surface has.
    expect(r.target(bad)).toBe("gpu");
  });
});

describe("the clamp sees the choice in the SAME step (design-013 D1)", () => {
  it("a behaviour registered AFTER installSurfaceInfra still reaches Band and Demand this frame", () => {
    // D1's whole reason. The behaviour runtime appends a behaviour's systems to
    // its phase group WHEN THE BEHAVIOUR REGISTERS, so a pack loaded after boot
    // would run after an infra trio registered in `present` — its
    // `SurfaceTarget = gpu` would reach the clamp one frame late and the card
    // would draw plate-only for a frame, silently. `present:infra` is a real
    // strata phase boundary AFTER `present`, so registration order inside
    // `present` cannot matter.
    //
    // The card's type names LatePack, so `defineWidget` appends no standard
    // behaviour and LatePack is the ONLY writer of its target. That is
    // load-bearing: with `domAtRest` also attached, its promote (registered at
    // rig creation, ahead of the infra either way) would satisfy Band whatever
    // the late pack did, and the case would pass with the phase group moved
    // back into `present` — the mutation probe proved it.
    const r = rig();
    // Infra is already installed by `rig()`. NOW a late pack REGISTERS.
    r.behaviors.register(LatePack);

    const card = r.spawn("sb:kiosk");
    r.step(2);
    expect(r.world.has(card, domAtRest.component)).toBe(false); // LatePack alone
    expect(r.world.get(card, SurfaceBand)?.band).toBe(0); // dom target: never banded

    r.grab(card);
    r.step();
    // The late pack wrote `gpu` this frame, and BOTH infra systems already
    // acted on it — the band is chosen and the clamp says interactive.
    expect(r.target(card)).toBe("gpu");
    expect(r.world.get(card, SurfaceBand)?.band).toBe(1);
    expect(r.world.get(card, SurfaceDemand)?.interactive).toBe(true);
  });

  it("folds an off-screen card to paused at the source, whatever its kind asked for", () => {
    // The clamp is `foldDemand`, verbatim: visibility folds to paused AT THE
    // SOURCE, which is what makes an off-screen animating card genuinely free
    // rather than merely cheap.
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    expect(r.world.get(card, SurfaceDemand)?.mode).toBe("live");
    r.world.removeTag(card, Visible);
    r.world.addTag(card, Culled);
    r.step();
    expect(r.world.get(card, SurfaceDemand)).toMatchObject({ mode: "paused", fpsBucket: 0 });
    // The REQUEST survives being off-screen — that is why demand is two
    // components (§5): coming back must not have to reconstruct the wish.
    expect(r.world.get(card, RequestedDemand)?.mode).toBe("live");
  });
});


describe("S4 (2026-09-23): any grab lifts the board, and a selected card's chrome shields what it covers", () => {
  /** A card at a place: the rig's spawn puts everything at the origin, and the shield is about rects. */
  const at = (r: ReturnType<typeof rig>, type: string, x: number, y: number): Entity => {
    const e = r.spawn(type);
    r.world.edit(e).set(Position, { x, y });
    return e;
  };

  it("a grab on an ISLAND promotes the gesture set: every dom card goes to the GPU in the same step, as a still, and comes back one settle window after the release", () => {
    const r = rig();
    const a = r.spawn("sb:card");
    const b = r.spawn("sb:card");
    const island = r.spawn("sb:island");
    r.step();
    expect(r.target(a)).toBe("dom");
    expect(r.target(island)).toBe("gpu");
    r.grab(island);
    r.step();
    expect(r.target(a)).toBe("gpu");
    expect(r.target(b)).toBe("gpu");
    expect(r.world.get(a, RequestedDemand)?.mode).toBe("paused");
    r.release(island);
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(a)).toBe("dom");
    expect(r.target(b)).toBe("dom");
    expect(r.world.get(a, RequestedDemand)?.mode).toBe("live");
    expect(r.target(island)).toBe("gpu");
    expect(r.faults).toEqual([]);
  });

  it("the shield: with a selection reach, a selected card lifts the dom cards its chrome overlaps — live, not stills — and leaves the rest and itself alone", () => {
    const r = rig();
    r.world.setResource(ChromeSettings, { liftScale: 1, selectionReach: 44 });
    const s = at(r, "sb:card", 0, 0);         // 100×60
    const near = at(r, "sb:card", 130, 0);    // 30 px gap: inside the 44 px reach
    const far = at(r, "sb:card", 300, 0);     // 200 px away
    const below = at(r, "sb:card", 0, 90);    // 30 px under: inside the reach
    r.step();
    r.world.addTag(s, Selected);
    r.step();
    expect(r.target(near)).toBe("gpu");
    expect(r.target(below)).toBe("gpu");
    expect(r.target(far)).toBe("dom");
    expect(r.target(s)).toBe("dom");          // the selected card sits inside its own chrome, on top of it
    expect(r.world.get(near, RequestedDemand)?.mode).toBe("live");
    // held while the selection lasts
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(near)).toBe("gpu");
    // and back one settle window after it ends — not on the edge
    r.world.removeTag(s, Selected);
    r.step();
    expect(r.target(near)).toBe("gpu");
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(near)).toBe("dom");
    expect(r.target(below)).toBe("dom");
    expect(r.faults).toEqual([]);
  });

  it("a reach of 0 — the default — shields nothing", () => {
    const r = rig();
    const s = at(r, "sb:card", 0, 0);
    const near = at(r, "sb:card", 110, 0);
    r.step();
    r.world.addTag(s, Selected);
    r.step(3);
    expect(r.target(near)).toBe("dom");
  });

  it("a selection moving across the board re-aims the shield: the card no longer covered comes back after the settle, the newly covered one lifts at once", () => {
    const r = rig();
    r.world.setResource(ChromeSettings, { liftScale: 1, selectionReach: 44 });
    const s = at(r, "sb:card", 0, 0);
    const near = at(r, "sb:card", 130, 0);
    const other = at(r, "sb:card", 600, 0);
    const otherNear = at(r, "sb:card", 730, 0);
    r.step();
    r.world.addTag(s, Selected);
    r.step();
    expect(r.target(near)).toBe("gpu");
    expect(r.target(otherNear)).toBe("dom");
    r.world.removeTag(s, Selected);
    r.world.addTag(other, Selected);
    r.step();
    expect(r.target(otherNear)).toBe("gpu");
    expect(r.target(near)).toBe("gpu");      // its window is open
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(near)).toBe("dom");
    expect(r.target(otherNear)).toBe("gpu");
  });

  it("a shield survives a gesture: grabbed and released with the selection held, the covered neighbour stays on the GPU through the gesture's settle — no drop to the DOM for a frame", () => {
    const r = rig();
    r.world.setResource(ChromeSettings, { liftScale: 1, selectionReach: 44 });
    const s = at(r, "sb:card", 0, 0);
    const near = at(r, "sb:card", 130, 0);
    const far = at(r, "sb:card", 500, 0);
    r.step();
    r.world.addTag(s, Selected);
    r.step();
    expect(r.target(near)).toBe("gpu");
    r.grab(s);
    r.step();
    expect(r.target(far)).toBe("gpu");       // the gesture set lifts the board
    expect(r.world.get(near, RequestedDemand)?.mode).toBe("live");   // the shield's card stays live, never a still
    r.release(s);
    const seen = r.sample(near, STEPS_PAST_SETTLE + 2);
    expect(seen.every((t) => t === "gpu")).toBe(true);
    expect(r.target(far)).toBe("dom");       // the gesture's own card came back
    r.world.removeTag(s, Selected);
    r.step(STEPS_PAST_SETTLE + 1);
    expect(r.target(near)).toBe("dom");
    expect(r.faults).toEqual([]);
  });
});
