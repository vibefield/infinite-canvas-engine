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
} from "../src";
import { PrefabId } from "../src/schema/prefab";

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
/** A gl widget that (wrongly) asks for the DOM — the D5 refusal's subject. */
defineWidget({ type: "sb:badIsland", surface: "gl", component: null, behaviors: [alwaysDom] });

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
  engine.addSystems("derive", createWidgetEquipSystem(world));
  const behaviors = createBehaviorRuntime({
    world,
    engine,
    onFault: (behavior, hook, _entity, err) =>
      faults.push({ behavior, hook, message: err instanceof Error ? err.message : String(err) }),
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
  return {
    world,
    engine,
    behaviors,
    faults,
    step,
    spawn,
    target: (e: Entity) => world.get(e, SurfaceTarget)?.target,
    grab: (e: Entity) => world.addComponent(e, Grab, GRAB),
    release: (e: Entity) => world.removeComponent(e, Grab),
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

  it("demotes only what IT promoted", () => {
    // A host that put a card on the GPU by hand keeps it there: the behaviour
    // owns its own promotions and nothing else. (The composited rig does
    // exactly this to hold a card composited for its static probes.)
    const r = rig();
    const card = r.spawn("sb:card");
    r.step(2);
    r.world.edit(card).set(SurfaceTarget, { target: "gpu" });
    r.step(STEPS_PAST_SETTLE);
    expect(r.target(card)).toBe("gpu");
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
