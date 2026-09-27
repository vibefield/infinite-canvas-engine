/**
 * THE M9 exit test `collab`, on the desk (nodeboard's, ported BY NAME at D5a — design-015 §11.6). Three headless
 * checks around two DESK engines booted as the app boots them (`createDeskEngine` + `joinDeskRoom`, presence on
 * the room's own channel), over the SAME in-memory doubles nodeboard's test and core's bootstrap/presence suites
 * use — no sockets, no real timers on the document's path:
 *
 *  1. Two desks join over linked byte channels (a BroadcastChannel-shaped `Bus`): A's hello times out on the fake
 *     clock (⇒ the seeder) and A lays its desk — notes, and a mini mat with a note INSIDE it; B joins and has the
 *     same desk key for key (the inside's note inside B's mini mat); then a new object crosses.
 *  2. Presence: A's cursor (through A's real input queue) and a one-object selection project onto B — B's peer
 *     carries A's name and colour, the cursor, a summary whose one key resolves to B's own copy of the note — and
 *     B's derive grows the `CursorVisual "remote"` entity following that peer (what `@ice/dom`'s remote-cursors
 *     reflector shows, rig:collab). Loro's presence throttle runs on the wasm clock, which no fake reaches, so presence converges by
 *     the presence suite's rule — REAL short waits, deadline-polled (`converge`) — over the room's own channel.
 *  3. The boot with a room never touches storage: the room is the truth (Web Storage and IndexedDB spied).
 */
import {
  type BootstrapClock,
  type ByteChannel,
  Camera,
  type CanvasEngine,
  ChildOf,
  CursorVisual,
  type Entity,
  Follows,
  Local,
  NO_MODS,
  Not,
  Position,
  PrefabId,
  PresenceCursor,
  PresenceInfo,
  PresencePeer,
  SelectionSummary,
  Size,
  defineQuery,
  writeRuntimeResource,
} from "@ice/core";
import { MINIMAT_TYPE, NOTE_TYPE } from "@ice/objects";
import { afterEach, describe, expect, it } from "vitest";
import { createDeskEngine, type DeskIdentity, joinDeskRoom } from "../src/desk";

/** Narrow-or-throw (the repo forbids `!`): assert a lookup found something. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`missing ${what}`);
  return v;
}

const objectsQ = defineQuery([Position, Size, PrefabId]);
const remotePeersQ = defineQuery([PresencePeer, Not(Local)]);
const remoteCursorQ = defineQuery([CursorVisual, Position]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ALICE: DeskIdentity = { name: "Alice", color: "#e5484d" };
const BOB: DeskIdentity = { name: "Bob", color: "#8e4ec6" };

// --- in-memory bus (BroadcastChannel semantics: never delivers to the sender) — nodeboard's ---
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

// --- fake clock for the hello-timeout (deterministic, no real timers) — nodeboard's ---
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

/** The desk as its document states it, by durable KEY (the tabs' entity ids differ): each object's type, rect and parent's key. */
function deskOf(engine: CanvasEngine): Map<string, { type: string; x: number; y: number; w: number; h: number; parent: string | null }> {
  const store = must(engine.docs.current(), "document").store;
  const out = new Map<string, { type: string; x: number; y: number; w: number; h: number; parent: string | null }>();
  engine.world.query(objectsQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      const p = engine.world.read(e, Position);
      const s = engine.world.read(e, Size);
      const parent = engine.world.getRelation(e, ChildOf);
      out.set(must(store.keyOf(e), "key"), { type: engine.world.read(e, PrefabId).id ?? "", x: p.x, y: p.y, w: s.w, h: s.h, parent: parent === undefined ? null : (store.keyOf(parent) ?? null) });
    }
  });
  return out;
}

/** Two desks in one room over a Bus: A the seeder (its hello times out on the fake clock), B the joiner. */
async function pair(seed: (a: CanvasEngine) => void = () => {}): Promise<{ bus: Bus; A: CanvasEngine; B: CanvasEngine }> {
  const bus = new Bus();
  const { clock, advance } = makeClock();
  const A = createDeskEngine("t");
  const pA = joinDeskRoom(A, { room: "t", channel: bus.endpoint(), clock, identity: ALICE });
  bus.deliverAll(); // A.hello reaches nobody
  advance(800); // the silence window elapses
  expect((await pA)?.role).toBe("seeder");
  seed(A);
  A.world.sync();
  const B = createDeskEngine("t");
  const pB = joinDeskRoom(B, { room: "t", channel: bus.endpoint(), clock, identity: BOB });
  bus.deliverAll(); // B.hello → A answers an addressed snapshot (queued)
  bus.deliverAll(); // the snapshot → B imports the base
  expect((await pB)?.role).toBe("joiner");
  B.world.sync();
  engines.push(A, B);
  return { bus, A, B };
}

const engines: CanvasEngine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
});

// --- 1. the document: the seeder's desk converges, a new object crosses ---------------------------------------
describe("desk collab: the handshake and the convergence", () => {
  it("the seeder's desk — notes and a mini mat with an inside — converges on the joiner, and a new object crosses", async () => {
    let mm: Entity | undefined;
    const { bus, A, B } = await pair((a) => {
      a.ops.spawnWidget(NOTE_TYPE, { x: 100, y: 100, props: { seed: 5 } });
      a.ops.spawnWidget(NOTE_TYPE, { x: 400, y: 120, props: { seed: 9 } });
      mm = a.ops.spawnWidget(MINIMAT_TYPE, { x: 700, y: 300, props: { name: "INBOX" } });
      a.engine.step(1000); // equip: the mini mat becomes a container a spawn may go into
      a.ops.spawnWidget(NOTE_TYPE, { x: 40, y: 40, parent: mm, props: { seed: 3 } });
    });
    const seeded = deskOf(A);
    expect(seeded.size).toBe(4); // two notes, the mini mat, the note inside it
    const mmKey = must(A.docs.current()?.store.keyOf(must(mm, "mini mat")), "mini mat's key");
    expect([...seeded.values()].filter((o) => o.parent === mmKey)).toHaveLength(1); // the inside's note
    expect(deskOf(B)).toEqual(seeded); // B has the same desk, key for key — the inside's note inside B's mini mat

    A.ops.spawnWidget(NOTE_TYPE, { x: 900, y: 600, props: { seed: 13 } });
    bus.deliverAll(); // A's UPDATE → B
    bus.deliverAll();
    A.world.sync();
    B.world.sync();
    expect(deskOf(B).size).toBe(5);
    expect(deskOf(B)).toEqual(deskOf(A)); // the new note crossed
  });
});

// --- 2. presence: A's hand and A's selection on B ---------------------------------------------------------------
describe("desk collab: presence", () => {
  it("A's cursor and a one-object selection project onto B, and B's derive grows a CursorVisual 'remote'", async () => {
    let note: Entity | undefined;
    const { bus, A, B } = await pair((a) => {
      note = a.ops.spawnWidget(NOTE_TYPE, { x: 40, y: 40, props: { seed: 5 } });
    });
    const n = must(note, "note");
    const nKey = must(A.docs.current()?.store.keyOf(n), "note's key");
    for (const e of [A, B]) writeRuntimeResource(e.world, Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world

    // A's mouse through A's own input queue (the pointer adapter's door), and A selects the note
    A.stack.queue.enqueue({ kind: "move", pointerId: "mouse", device: "mouse", screenX: 12, screenY: 34, buttons: 0, mods: NO_MODS });
    A.ops.setSelection([n], "replace");

    // converge: A's frame publishes its cursor + selection summary, the bus carries the PRESENCE frames, B syncs
    let now = 1000;
    const t0 = Date.now();
    for (;;) {
      now += 16;
      A.engine.step(now);
      bus.deliverAll();
      B.world.sync();
      const p = B.world.firstOf(remotePeersQ);
      const c = p === undefined ? undefined : B.world.get(p, PresenceCursor);
      if ((c?.x === 12 && c.y === 34 && p !== undefined && B.world.has(p, SelectionSummary)) || Date.now() - t0 > 2000) break;
      await sleep(5);
    }

    const peer = must(B.world.firstOf(remotePeersQ), "remote peer");
    expect(B.world.hasTag(peer, Local)).toBe(false); // a remote projection carries no Local
    expect(B.world.get(peer, PresenceInfo)).toEqual({ name: "Alice", color: "#e5484d" }); // whose hand, in whose colour
    expect(B.world.get(peer, PresenceCursor)).toEqual({ x: 12, y: 34, device: "mouse" });
    const summary = must(B.world.get(peer, SelectionSummary), "selection summary");
    expect(summary.count).toBe(1);
    const keys = JSON.parse(summary.keys ?? "[]") as string[];
    expect(keys).toEqual([nKey]);
    const mine = B.docs.current()?.store.resolve(keys[0] as never);
    expect(mine !== undefined && B.world.isAlive(mine) && B.world.read(mine, PrefabId).id === NOTE_TYPE).toBe(true); // B's own copy of the note

    // B's frame derives the remote hand: a pooled CursorVisual "remote" at A's cursor, following A's peer
    now += 16;
    B.engine.step(now);
    const cursor = must(B.world.firstOf(remoteCursorQ), "remote cursor entity");
    expect(B.world.get(cursor, CursorVisual)).toMatchObject({ kind: "remote" });
    expect(B.world.read(cursor, Position)).toEqual({ x: 12, y: 34 });
    expect(B.world.getRelation(cursor, Follows)).toBe(peer);
  });
});

// --- 3. the boot with a room never touches storage ------------------------------------------------------------
describe("desk collab: the boot in a room", () => {
  it("joins over an injected channel, reports its role, and never touches storage — the room is the truth", async () => {
    const touched: string[] = [];
    const STORES = ["localStorage", "sessionStorage", "indexedDB"] as const;
    const saved = STORES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    for (const name of STORES) {
      const spy = new Proxy({}, { get: (_t, key) => { touched.push(`${name}.${String(key)}`); return () => undefined; } });
      Object.defineProperty(globalThis, name, { configurable: true, get: () => { touched.push(name); return spy; } });
    }
    try {
      // a sync-firing clock ⇒ the lone seeder resolves without real timers; a stub channel (no peers)
      const syncClock: BootstrapClock = { setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {} };
      const channel: ByteChannel = { send: () => {}, subscribe: () => () => {} };
      const engine = createDeskEngine("t");
      engines.push(engine);
      expect(engine.docs.current()).toBeUndefined(); // in a room, no fresh local document is made
      const joined = await joinDeskRoom(engine, { room: "t", channel, clock: syncClock, identity: ALICE });
      expect(joined?.role).toBe("seeder");
      engine.ops.spawnWidget(NOTE_TYPE, { x: 0, y: 0, props: { seed: 1 } }); // a commit
      for (let i = 0; i < 3; i++) engine.engine.step(1000 + i * 16); // frames publish
      expect(touched).toEqual([]); // no restore, no autosave, no stash — nothing read or written
    } finally {
      for (const [name, d] of saved) {
        if (d === undefined) Reflect.deleteProperty(globalThis, name);
        else Object.defineProperty(globalThis, name, d);
      }
    }
  });
});
