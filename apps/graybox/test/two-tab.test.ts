/**
 * The "two-tab" exit criterion, headless (M5): two full interaction stacks, each
 * on its own world with its own durable doc session, wired together by the M5
 * dumb snapshot relay over an injected synchronous channel pair. A drag on tab A
 * commits one move; the relay ships the snapshot; tab B converges to the same
 * box position — the real-browser two-tab demo, minus the DOM.
 */
import {
  ActiveTool,
  Camera,
  type CommitSink,
  type DocSession,
  type Entity,
  Movable,
  NO_MODS,
  Position,
  type RelayChannel,
  Selectable,
  Size,
  type World,
  attachBroadcastRelay,
  createDocSession,
  createEngine,
  createRecordingCommitSink,
  createWorld,
  defineQuery,
  installInteractionStack,
} from "@ice/core";
import { describe, expect, it } from "vitest";

/** Two endpoints on one bus; a post delivers to the OTHER only, synchronously. */
function channelPair(): { a: RelayChannel; b: RelayChannel } {
  const la = new Set<(ev: { data: unknown }) => void>();
  const lb = new Set<(ev: { data: unknown }) => void>();
  const make = (
    own: Set<(ev: { data: unknown }) => void>,
    peer: Set<(ev: { data: unknown }) => void>,
  ): RelayChannel => ({
    postMessage: (m) => {
      for (const l of [...peer]) l({ data: m });
    },
    addEventListener: (_t, l) => own.add(l),
    removeEventListener: (_t, l) => own.delete(l),
    close: () => own.clear(),
  });
  return { a: make(la, lb), b: make(lb, la) };
}

const boxQ = defineQuery([Position, Size]);

function findBoxX(world: World, x: number): Entity | undefined {
  world.sync();
  let found: Entity | undefined;
  world.query(boxQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (world.read(e, Position).x === x) {
        found = e;
        return;
      }
    }
  });
  return found;
}

interface Tab {
  world: World;
  session: DocSession;
  sink: ReturnType<typeof createRecordingCommitSink>;
  step(n?: number): void;
  enq(kind: "down" | "move" | "up", x: number, y: number, buttons: number): void;
}

function makeTab(): Tab {
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  const engine = createEngine(world);
  const recording = createRecordingCommitSink();
  const sinkRef: { target?: CommitSink } = {};
  const tee: CommitSink = {
    commit(i) {
      recording.commit(i);
      sinkRef.target?.commit(i);
    },
  };
  const stack = installInteractionStack(engine, { sink: tee });
  world.setResource(ActiveTool, { id: "select" });
  const session = createDocSession(world);
  sinkRef.target = session.sink;

  let now = 1000;
  return {
    world,
    session,
    sink: recording,
    step(n = 1) {
      for (let i = 0; i < n; i += 1) {
        now += 16;
        engine.step(now);
      }
    },
    enq(kind, x, y, buttons) {
      stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
    },
  };
}

describe("two-tab convergence (headless): drag on A lands on B", () => {
  it("ships a committed move across the relay so both tabs agree", () => {
    const chan = channelPair();
    const a = makeTab();
    const b = makeTab();
    attachBroadcastRelay(a.session, { channelName: "ice-graybox", channel: chan.a });
    attachBroadcastRelay(b.session, { channelName: "ice-graybox", channel: chan.b });

    // Durable box on A at world (300,300); the spawn commit relays to B.
    a.session.store.transaction((tx) => {
      tx.spawn({ components: [[Position, { x: 300, y: 300 }], [Size, { w: 80, h: 60 }]] });
    });
    a.step(); // project on A
    const onA = findBoxX(a.world, 300);
    if (onA === undefined) throw new Error("box missing on A");
    a.world.addTag(onA, Selectable); // runtime capability riders (durable.test pattern)
    a.world.addTag(onA, Movable);
    a.step(); // index the box for picking

    const onB = findBoxX(b.world, 300);
    expect(onB).not.toBeUndefined(); // the spawn already synced to B

    // Drag the box on A: down on it, past the dead-zone, then release → one move commit.
    a.enq("down", 310, 320, 1);
    a.step();
    a.enq("move", 330, 320, 1); // 20px > slop → Active, RoutedMove, Grab
    a.step();
    a.enq("move", 380, 320, 1); // integrate the drag
    a.step();
    a.enq("up", 380, 320, 0);
    a.step(2); // Ended → commit frame + reap

    expect(a.sink.intents.at(-1)?.kind).toBe("move");
    const movedX = a.world.read(onA as Entity, Position).x;
    expect(movedX).toBeGreaterThan(300); // A moved

    // The commit relayed to B synchronously; project it.
    b.step();
    expect(b.world.read(onB as Entity, Position).x).toBe(movedX); // B converged
  });
});
