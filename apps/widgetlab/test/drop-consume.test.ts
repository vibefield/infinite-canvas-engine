/**
 * Drop-to-consume (v1 RFC-004): dragging a card onto a folder and releasing
 * must adopt it (ChildOf) — the whole real pipeline: queue → picking →
 * recognizers → dragRoute → drop candidate → moveBehavior consume commit.
 */
import { ChildOf, NO_MODS, OverlapCandidate, OverlapRejected, Position, PrefabId, Viewport, defineQuery, type Entity, type InputEvent } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDemoEngine } from "../src/App";

const idQ = defineQuery([Position, PrefabId]);

function findByType(world: ReturnType<typeof createDemoEngine>["world"], type: string): Entity[] {
  const out: Entity[] = [];
  world.query(idQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (world.get(e, PrefabId)?.id === type) out.push(e);
    }
  });
  return out;
}

function ev(kind: InputEvent["kind"], x: number, y: number, buttons: number): InputEvent {
  return { kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS };
}

describe("widgetlab drop-to-consume", () => {
  it("drag clock-card onto the Widgets folder → adopted (ChildOf)", () => {
    const ce = createDemoEngine();
    ce.world.setResource(Viewport, { w: 1900, h: 1100, dpr: 1 });
    let now = 0;
    const step = (n = 1) => {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    };
    step(3); // index warm-up

    const clock = findByType(ce.world, "clock-card")[0] as Entity;
    const folder = findByType(ce.world, "card-container")[0] as Entity; // "Widgets" at (1153, 270)
    expect(clock).toBeDefined();
    expect(folder).toBeDefined();

    // clock center (127,127) → folder center (1317, 442); identity camera.
    ce.stack.queue.enqueue(ev("down", 127, 127, 1));
    step();
    ce.stack.queue.enqueue(ev("move", 160, 160, 1)); // past the dead zone → drag activates
    step();
    ce.stack.queue.enqueue(ev("move", 1317, 442, 1)); // over the folder
    step(2); // drop system marks candidate
    ce.stack.queue.enqueue(ev("up", 1317, 442, 0));
    step(3); // consume commit + doc round-trip

    expect(ce.world.getRelation(clock, ChildOf)).toBe(folder);
  });
});

describe("widgetlab card-on-card reject (v1 iOS contract)", () => {
  it("drop clock-card onto battery-card → OverlapRejected hover, then fly-back home", () => {
    const ce = createDemoEngine();
    ce.world.setResource(Viewport, { w: 1900, h: 1100, dpr: 1 });
    let now = 0;
    const step = (n = 1) => {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    };
    step(3);

    const clock = findByType(ce.world, "clock-card")[0] as Entity;
    const battery = findByType(ce.world, "battery-card")[0] as Entity;
    const home = { ...ce.world.read(clock, Position) };

    // clock center (127,127) → battery center (301,127).
    ce.stack.queue.enqueue(ev("down", 127, 127, 1));
    step();
    ce.stack.queue.enqueue(ev("move", 160, 140, 1)); // activate
    step();
    ce.stack.queue.enqueue(ev("move", 301, 127, 1)); // over battery (Solid, no Accepts)
    step(2);
    expect(ce.world.hasTag(battery, OverlapRejected)).toBe(true); // the weak "won't take it" glow signal
    expect(ce.world.hasTag(battery, OverlapCandidate)).toBe(false);

    ce.stack.queue.enqueue(ev("up", 301, 127, 0));
    step(2); // rejected drop → fly-back tween attached, no commit
    expect(ce.world.hasTag(battery, OverlapRejected)).toBe(false); // terminal cleanup
    step(30); // ~480ms — tween eases home and reaps itself
    const back = ce.world.read(clock, Position);
    expect(back.x).toBeCloseTo(home.x, 0);
    expect(back.y).toBeCloseTo(home.y, 0);
  });
});
