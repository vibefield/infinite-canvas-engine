/**
 * M9 collab wiring for node-board (design-005 §6.5). Three headless checks over
 * the SAME in-memory doubles the core bootstrap/presence suites use — no real
 * sockets, no real timers on the doc path:
 *
 *  1. Two worlds join over a linked byte-channel pair (a BroadcastChannel-shaped
 *     `Bus`): A seeds the node graph (fake-clock timeout ⇒ seeder), B joins and
 *     sees the same node count, then A's new node converges onto B.
 *  2. Presence across a peer pair: A's cursor + a 1-node selection project onto
 *     B (a PresencePeer with a SelectionSummary), and B's remote-cursor derive
 *     system grows a CursorVisual "remote" entity. Presence forwarding uses the
 *     direct-wire `converge` pattern (Loro's throttle/TTL run on the wasm clock,
 *     not fakeable) — the presence.test.ts rule.
 *  3. Boot smoke: `boot({ mount:false, room, channel })` runs, reports its role,
 *     and NEVER touches storage (the room is authoritative).
 */
import {
  type BootstrapClock,
  type ByteChannel,
  CursorVisual,
  Local,
  LocalPointer,
  Not,
  Pointer,
  PointerWorld,
  Position,
  PresenceCursor,
  PresencePeer,
  Selected,
  SelectionSummary,
  Size,
  StackZ,
  type World,
  attachPresence,
  createDocSession,
  createEngine,
  createPresencePublish,
  createRemoteCursorsSystem,
  createWorld,
  defineQuery,
  joinDoc,
} from "@ice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boot, seedScene, spawnMathNode } from "../src/app";
import type { NodeboardStorage } from "../src/storage";

/** Narrow-or-throw (the repo forbids `!`): assert a lookup found something. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`missing ${what}`);
  return v;
}

const widgetQ = defineQuery([Position, Size, StackZ]);
const remotePeersQ = defineQuery([PresencePeer, Not(Local)]);
const remoteCursorQ = defineQuery([CursorVisual, Position]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function countWidgets(world: World): number {
  let n = 0;
  world.query(widgetQ).each((b) => {
    n += b.count;
  });
  return n;
}

// --- in-memory bus (BroadcastChannel semantics: never delivers to the sender) ---
class Bus {
  private readonly eps: { id: number; listeners: Set<(b: Uint8Array) => void> }[] = [];
  private queue: { from: number; bytes: Uint8Array }[] = [];

  endpoint(): ByteChannel {
    const id = this.eps.length;
    const ep = { id, listeners: new Set<(b: Uint8Array) => void>() };
    this.eps.push(ep);
    return {
      send: (bytes) => {
        this.queue.push({ from: id, bytes });
      },
      subscribe: (fn) => {
        ep.listeners.add(fn);
        return () => ep.listeners.delete(fn);
      },
    };
  }

  /** Deliver every frame queued AT CALL TIME (frames queued during delivery wait for the next pump). */
  deliverAll(): void {
    const batch = this.queue;
    this.queue = [];
    for (const msg of batch) {
      for (const ep of this.eps) {
        if (ep.id === msg.from) continue;
        for (const fn of [...ep.listeners]) fn(msg.bytes);
      }
    }
  }
}

// --- fake clock for the hello-timeout (deterministic, no real timers) ---
function makeClock(): { clock: BootstrapClock; advance(ms: number): void } {
  const timers: { fn: () => void; at: number; id: number; live: boolean }[] = [];
  let now = 0;
  let seq = 0;
  return {
    clock: {
      setTimeout: (fn, ms) => {
        const id = seq++;
        timers.push({ fn, at: now + ms, id, live: true });
        return id;
      },
      clearTimeout: (h) => {
        const t = timers.find((t) => t.id === h);
        if (t !== undefined) t.live = false;
      },
    },
    advance(ms) {
      now += ms;
      for (const t of timers) {
        if (t.live && t.at <= now) {
          t.live = false;
          t.fn();
        }
      }
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// --- 1. doc handshake + convergence over a channel pair ------------------------
describe("node-board collab: doc handshake + convergence", () => {
  it("A seeds the graph, B joins and sees it, and A's new node converges onto B", async () => {
    const bus = new Bus();
    const { clock, advance } = makeClock();

    // A: a lone joiner times out → becomes the seeder and seeds the node graph.
    const worldA = createWorld();
    const pA = joinDoc(worldA, bus.endpoint(), { clock, seed: (s) => void seedScene(s, worldA) });
    bus.deliverAll(); // A.hello reaches nobody
    advance(800); // silence window elapses
    const A = await pA;
    expect(A.role).toBe("seeder");
    worldA.sync();
    const seeded = countWidgets(worldA);
    expect(seeded).toBe(7); // 6 nodes + 1 group (the wire has no geometry)

    // B: joins and imports A's snapshot as its causal base.
    const worldB = createWorld();
    const pB = joinDoc(worldB, bus.endpoint(), { clock });
    bus.deliverAll(); // B.hello → A answers an addressed snapshot (queued)
    bus.deliverAll(); // snapshot → B imports the base
    const B = await pB;
    expect(B.role).toBe("joiner");
    worldB.sync();
    expect(countWidgets(worldB)).toBe(seeded); // B sees the same scene

    // A spawns a node → the update relays to B.
    spawnMathNode(A.session.store, worldA, 500, 500, 9);
    bus.deliverAll(); // A's UPDATE → B (+ B's re-broadcast offer back)
    bus.deliverAll();
    worldA.sync();
    worldB.sync();
    expect(countWidgets(worldB)).toBe(seeded + 1); // B converged on A's new node

    A.leave();
    B.leave();
  });
});

// --- 2. presence across a peer pair --------------------------------------------
describe("node-board collab: presence", () => {
  it("A's cursor + 1-node selection project onto B, and B grows a remote CursorVisual", async () => {
    const worldA = createWorld();
    const presA = attachPresence(worldA, { name: "Alice", color: "#e5484d" });
    const worldB = createWorld();
    const presB = attachPresence(worldB, { name: "Bob", color: "#0090ff" });

    // A durable node, selected, so the selection summary carries a real key.
    const sessionA = createDocSession(worldA);
    const math = spawnMathNode(sessionA.store, worldA, 40, 40, 5);
    worldA.sync();
    worldA.addTag(math, Selected);

    // A local mouse pointer is the presence-cursor source.
    worldA.spawn({
      components: [
        [Pointer, { id: "m", device: "mouse" }],
        [PointerWorld, { x: 12, y: 34 }],
      ],
      tags: [LocalPointer],
    });

    // B runs the remote-cursor derive system (projects peers → CursorVisual).
    const engineB = createEngine(worldB);
    engineB.addSystems("derive", createRemoteCursorsSystem(worldB));

    // Forward A's presence outbound into B's wire until B sees the facets.
    const outboundA: Uint8Array[] = [];
    presA.onOutbound((b) => outboundA.push(b));
    const publishA = createPresencePublish(worldA, presA, { keyOf: (e) => sessionA.store.keyOf(e) });
    publishA(worldA); // stage cursor + selection-summary facets on A's local peer

    const t0 = Date.now();
    for (;;) {
      for (const b of outboundA.splice(0)) presB.wire.apply(b);
      worldB.sync();
      const p = worldB.firstOf(remotePeersQ);
      if ((p !== undefined && worldB.has(p, PresenceCursor) && worldB.has(p, SelectionSummary)) || Date.now() - t0 > 2000)
        break;
      await sleep(5);
    }

    const peer = must(worldB.firstOf(remotePeersQ), "remote peer");
    expect(worldB.hasTag(peer, Local)).toBe(false); // remote projection carries no Local
    expect(worldB.get(peer, PresenceCursor)).toEqual({ x: 12, y: 34, device: "mouse" });
    const summary = must(worldB.get(peer, SelectionSummary), "selection summary");
    expect(summary.count).toBe(1);

    // The derive system grows a remote CursorVisual following the peer.
    engineB.step(1);
    const cursor = must(worldB.firstOf(remoteCursorQ), "remote cursor entity");
    expect(worldB.get(cursor, CursorVisual)).toMatchObject({ kind: "remote" });
    expect(worldB.read(cursor, Position)).toEqual({ x: 12, y: 34 });

    presA.detach();
    presB.detach();
    sessionA.close();
  });
});

// --- 3. boot smoke in collab mode ----------------------------------------------
describe("node-board collab: boot smoke", () => {
  it("boots over an injected channel, reports a role, and never touches storage", async () => {
    // A sync-firing clock ⇒ the lone seeder resolves without real timers.
    const syncClock: BootstrapClock = {
      setTimeout: (fn) => {
        fn();
        return 0;
      },
      clearTimeout: () => {},
    };
    // A stub channel (no peers) — the seeder path never needs delivery.
    const channel: ByteChannel = { send: () => {}, subscribe: () => () => {} };

    // A storage spy: collab mode must not read or write it (the room is the truth).
    const storage = {
      get: vi.fn((): Uint8Array | undefined => undefined),
      put: vi.fn((_b: Uint8Array): void => {}),
      stashQuarantine: vi.fn((_b: Uint8Array): void => {}),
      clear: vi.fn((): void => {}),
    } satisfies NodeboardStorage;

    const container = document.createElement("div");
    document.body.appendChild(container);

    const handle = await boot({ container, mount: false, room: "t", channel, clock: syncClock, storage });

    expect(handle.role).toBe("seeder");
    expect(handle.widgetCount).toBe(7); // the seeder seeded the graph
    expect(storage.get).not.toHaveBeenCalled(); // no restore
    expect(storage.put).not.toHaveBeenCalled(); // no autosave

    handle.dispose();
  });
});
