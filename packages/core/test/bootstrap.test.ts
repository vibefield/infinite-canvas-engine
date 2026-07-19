/**
 * M9 transport/bootstrap kit (design-005 §6.5). The doc handshake is driven by an
 * in-memory `Bus` (a BroadcastChannel-shaped double: never delivers to the sender;
 * `deliverAll()` snapshots the queue so frames queued DURING delivery wait for the
 * next pump) + an injectable fake clock for the hello-timeout — fully
 * deterministic, no real timers. Presence bytes (which ride real ephemeral timers)
 * are staged synchronously via the source encoder where a test needs them.
 *
 * Coverage: (a) lone joiner times out → seeder + seed() ran; (b) a second joiner
 * gets the snapshot and concurrent edits converge; (c) an update arriving mid-
 * handshake is buffered then drained after the base imports; (d) a non-ok gate ⇒
 * read-only joiner, commits dropped, presence still flows. Plus the two channel
 * adapters (BroadcastChannel double + a delayed-open WebSocket fake).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity, World } from "@vibecook/strata-ecs";
import {
  Position,
  PresenceCursor,
  PresencePeer,
  Size,
  attachPresence,
  broadcastChannelByteChannel,
  createCanvasEngine,
  createDocSession,
  createWorld,
  defineQuery,
  joinDoc,
  webSocketByteChannel,
  type BootstrapClock,
  type ByteChannel,
  type JoinResult,
  type PresenceSession,
  type WebSocketLike,
} from "../src";

// --- frame protocol (mirrors bootstrap.ts: 1-byte kind ++ payload) ---------------------------------
const K = { HELLO: 1, SNAPSHOT_OFFER: 2, SNAPSHOT: 3, UPDATE: 4, PRESENCE: 5 } as const;
function frame(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length);
  out[0] = kind;
  out.set(payload, 1);
  return out;
}

/** Narrow-or-throw (the repo forbids `!`): assert a lookup found something. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`missing ${what}`);
  return v;
}

// --- in-memory bus (BroadcastChannel semantics) ----------------------------------------------------
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
        if (ep.id === msg.from) continue; // never deliver to the sender
        for (const fn of [...ep.listeners]) fn(msg.bytes);
      }
    }
  }
}

// --- fake clock ------------------------------------------------------------------------------------
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

// --- helpers ---------------------------------------------------------------------------------------
const positionsQ = defineQuery([Position]);
const remotePeersQ = defineQuery([PresencePeer]);

function countPositions(world: World): number {
  let n = 0;
  world.query(positionsQ).each((b) => {
    n += [...b].length;
  });
  return n;
}

function findAt(world: World, x: number, y: number): Entity | undefined {
  let found: Entity | undefined;
  world.query(positionsQ).each((b) => {
    for (const r of b) {
      const p = world.read(b.entity(r), Position);
      if (p.x === x && p.y === y) found = b.entity(r);
    }
  });
  return found;
}

function spawnBox(session: JoinResult["session"], x: number, y: number): void {
  session.store.transaction((tx) =>
    tx.spawn({ components: [[Position, { x, y }], [Size, { w: 5, h: 5 }]] }),
  );
}

const cleanups: Array<() => void> = [];
const sessions: PresenceSession[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c();
    } catch {
      /* already torn down */
    }
  }
  for (const s of sessions.splice(0)) {
    try {
      s.detach();
    } catch {
      /* already detached */
    }
  }
  vi.restoreAllMocks();
});

/** Stand up a seeder on `bus` (a lone joiner that times out). Returns its result + its world. */
async function makeSeeder(
  bus: Bus,
  clock: BootstrapClock,
  advance: (ms: number) => void,
): Promise<{ res: JoinResult; world: World }> {
  const world = createWorld();
  const p = joinDoc(world, bus.endpoint(), { clock });
  bus.deliverAll();
  advance(800);
  const res = await p;
  cleanups.push(() => res.leave());
  return { res, world };
}

// --- (a) lone joiner → seeder ----------------------------------------------------------------------
describe("bootstrap: lone joiner (§6.5)", () => {
  it("times out on silence and becomes the seeder; seed() runs", async () => {
    const bus = new Bus();
    const { clock, advance } = makeClock();
    const world = createWorld();
    let seeded = false;
    const p = joinDoc(world, bus.endpoint(), { clock, seed: () => { seeded = true; } });
    bus.deliverAll(); // hello reaches nobody
    advance(800); // silence window elapses
    const res = await p;
    cleanups.push(() => res.leave());
    expect(res.role).toBe("seeder");
    expect(seeded).toBe(true);
  });
});

// --- (b) second joiner + convergence ---------------------------------------------------------------
describe("bootstrap: second joiner (§6.5)", () => {
  it("receives the seeder's snapshot and concurrent edits converge on both worlds", async () => {
    const bus = new Bus();
    const { clock, advance } = makeClock();
    const { res: seeder, world: worldA } = await makeSeeder(bus, clock, advance);

    const worldB = createWorld();
    const pB = joinDoc(worldB, bus.endpoint(), { clock });
    bus.deliverAll(); // B.hello → seeder; seeder answers an addressed snapshot (queued)
    bus.deliverAll(); // snapshot → B; B imports the base
    const resB = await pB;
    cleanups.push(() => resB.leave());
    expect(resB.role).toBe("joiner");

    // Concurrent edits to disjoint entities.
    spawnBox(seeder.session, 1, 1);
    spawnBox(resB.session, 2, 2);
    bus.deliverAll(); // relay both updates both ways (+ B's re-broadcast offer)
    bus.deliverAll();
    worldA.sync();
    worldB.sync();

    // Both worlds converge on BOTH boxes.
    expect(countPositions(worldA)).toBe(2);
    expect(countPositions(worldB)).toBe(2);
    expect(findAt(worldA, 2, 2)).toBeDefined(); // seeder learned B's box
    expect(findAt(worldB, 1, 1)).toBeDefined(); // joiner learned the seeder's box
  });
});

// --- (c) buffered-then-drained updates -------------------------------------------------------------
describe("bootstrap: mid-handshake buffering (§6.5)", () => {
  it("buffers an update that arrives during the handshake, then drains it after the base imports", async () => {
    // Author a base (W1 @ 0,0) and a later move update NOT contained in that base.
    const authWorld = createWorld();
    const auth = createDocSession(authWorld);
    cleanups.push(() => auth.close());
    let w1: Entity | undefined;
    auth.store.transaction((tx) => {
      w1 = tx.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]] });
    });
    authWorld.sync();
    const w1e = must(w1, "authored w1");
    const base = auth.exportEnvelope(); // snapshot frames carry envelopes (the joiner OPENS this)
    const updates: Uint8Array[] = [];
    const unsub = auth.store.subscribeOutbound((b) => updates.push(b));
    auth.store.transaction((tx) => tx.edit(w1e).set(Position, { x: 50, y: 0 }));
    authWorld.sync();
    unsub();
    const moveUpdate = must(updates.at(-1), "move update");

    // B joins; a "server" endpoint injects the UPDATE (while B buffers) then the base offer.
    const bus = new Bus();
    const { clock } = makeClock();
    const worldB = createWorld();
    const chanB = bus.endpoint();
    const server = bus.endpoint();
    const pB = joinDoc(worldB, chanB, { clock });
    bus.deliverAll(); // B.hello → server (our manual server ignores it)

    server.send(frame(K.UPDATE, moveUpdate)); // arrives while B is still buffering (raw loro increment)
    bus.deliverAll(); // B buffers it (no base yet)
    server.send(frame(K.SNAPSHOT_OFFER, base)); // the causal base
    bus.deliverAll(); // B imports base + drains the buffered update

    const resB = await pB;
    cleanups.push(() => resB.leave());
    expect(resB.role).toBe("joiner");
    worldB.sync();

    // The buffered move applied AFTER the base import: W1 is at its moved position.
    expect(findAt(worldB, 50, 0)).toBeDefined();
    expect(findAt(worldB, 0, 0)).toBeUndefined();
  });
});

// --- (d) read-only gate + presence -----------------------------------------------------------------
describe("bootstrap: read-only gate + presence (§6.5)", () => {
  it("a non-ok gate ⇒ read-only joiner; commits are dropped; presence still flows", async () => {
    const bus = new Bus();
    const { clock, advance } = makeClock();
    await makeSeeder(bus, clock, advance);

    const worldB = createWorld();
    const presWorldB = createWorld();
    const presenceB = attachPresence(presWorldB, { name: "B", color: "#0f0" });
    sessions.push(presenceB);

    // Force the stable read-only verdict (a "migrate" verdict would upgrade in
    // place and flip writable — M9 §6.4; "readOnly" stays read-only).
    const pB = joinDoc(worldB, bus.endpoint(), { clock, onGate: () => "readOnly", presence: presenceB });
    bus.deliverAll(); // B.hello → seeder answers snapshot
    bus.deliverAll(); // snapshot → B imports (read-only per the gate)
    const resB = await pB;
    cleanups.push(() => resB.leave());
    expect(resB.session.readOnly).toBe(true);

    // Edits dropped: the read-only sink warns and commits nothing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gesture = worldB.spawn({});
    resB.session.sink.commit({ kind: "move", gesture, writes: [] });
    expect(warn.mock.calls.some((c) => /read-only/i.test(String(c[0])))).toBe(true);

    // Presence still flows: inject a PRESENCE frame from the other side of B's channel.
    const presWorldA = createWorld();
    const presA = attachPresence(presWorldA, { name: "A", color: "#f00", peerId: "peerA" });
    sessions.push(presA);
    presA.eph.addComponent(presA.localPeer, PresenceCursor, { x: 7, y: 8, device: "mouse" });
    const presBytes = must(presA.wire.encodeChanged(), "presence bytes"); // synchronous → deterministic

    const injector = bus.endpoint();
    injector.send(frame(K.PRESENCE, presBytes));
    bus.deliverAll(); // PRESENCE → B's joinDoc → presenceB.wire.apply
    presWorldB.sync();
    expect(presWorldB.firstOf(remotePeersQ)).toBeDefined(); // A's peer projected despite the read-only doc
  });
});

// --- lifecycle hygiene (2026-07-13 review findings 1–4) ---------------------------------------------
/** Wrap a channel so tests can assert the room was actually LEFT (subs back to 0). */
function counting(ch: ByteChannel): { ch: ByteChannel; subs(): number } {
  let n = 0;
  return {
    subs: () => n,
    ch: {
      send: (b) => ch.send(b),
      subscribe: (fn) => {
        n++;
        const unsub = ch.subscribe(fn);
        return () => {
          n--;
          unsub();
        };
      },
    },
  };
}

/**
 * Author a doc with two SEQUENTIAL updates; delivering only the second to a
 * peer leaves a causal gap → strata throws PendingImportError → re-bootstrap.
 */
function makeGappedDoc(): {
  base: Uint8Array;
  update1: Uint8Array;
  update2: Uint8Array;
  full: () => Uint8Array;
  close: () => void;
} {
  const authWorld = createWorld();
  const auth = createDocSession(authWorld);
  let w1: Entity | undefined;
  auth.store.transaction((tx) => {
    w1 = tx.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 5, h: 5 }]] });
  });
  authWorld.sync();
  const w1e = must(w1, "authored w1");
  const base = auth.exportEnvelope();
  const updates: Uint8Array[] = [];
  const unsub = auth.store.subscribeOutbound((b) => updates.push(b));
  auth.store.transaction((tx) => tx.edit(w1e).set(Position, { x: 10, y: 0 }));
  authWorld.sync();
  auth.store.transaction((tx) => tx.edit(w1e).set(Position, { x: 20, y: 0 }));
  authWorld.sync();
  unsub();
  return {
    base,
    update1: must(updates[0], "update1"),
    update2: must(updates.at(-1), "update2"),
    full: () => auth.exportEnvelope(),
    close: () => auth.close(),
  };
}

describe("bootstrap: lifecycle hygiene (review 2026-07-13)", () => {
  it("a throwing seed() rejects the join instead of hanging, and the room is left", async () => {
    const bus = new Bus();
    const { clock, advance } = makeClock();
    const counted = counting(bus.endpoint());
    const p = joinDoc(createWorld(), counted.ch, {
      clock,
      seed: () => {
        throw new Error("seed boom");
      },
    });
    const rejection = expect(p).rejects.toThrow(/seed boom/);
    bus.deliverAll(); // hello reaches nobody
    advance(800); // the timer path — where the old code let the throw escape
    await rejection;
    expect(counted.subs()).toBe(0);
  });

  it("an incompatible base rejects AND unsubscribes the channel", async () => {
    const bus = new Bus();
    const { clock } = makeClock();
    const counted = counting(bus.endpoint());
    const server = bus.endpoint();
    const p = joinDoc(createWorld(), counted.ch, { clock });
    const rejection = expect(p).rejects.toThrow(/base import failed/);
    bus.deliverAll(); // hello
    server.send(frame(K.SNAPSHOT_OFFER, new Uint8Array([9, 9, 9]))); // garbage envelope
    bus.deliverAll();
    await rejection;
    expect(counted.subs()).toBe(0);
  });

  it("abort pre-resolve rejects with the reason; abort post-resolve just leaves (no onError)", async () => {
    const busA = new Bus();
    const { clock: clockA } = makeClock();
    const countedA = counting(busA.endpoint());
    const acA = new AbortController();
    const pA = joinDoc(createWorld(), countedA.ch, { clock: clockA, signal: acA.signal });
    const rejection = expect(pA).rejects.toThrow(/nope/);
    acA.abort(new Error("nope"));
    await rejection;
    expect(countedA.subs()).toBe(0);

    const busB = new Bus();
    const { clock: clockB, advance: advanceB } = makeClock();
    const countedB = counting(busB.endpoint());
    const acB = new AbortController();
    const errors: unknown[] = [];
    const pB = joinDoc(createWorld(), countedB.ch, {
      clock: clockB,
      signal: acB.signal,
      onError: (e) => errors.push(e),
    });
    busB.deliverAll();
    advanceB(800);
    const res = await pB;
    expect(res.role).toBe("seeder");
    expect(countedB.subs()).toBe(1);
    acB.abort(); // caller closing a live join — leave() semantics
    expect(countedB.subs()).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("a PendingImportError re-bootstraps: the session getter + onSession track the swap", async () => {
    const doc = makeGappedDoc();
    cleanups.push(doc.close);
    const bus = new Bus();
    const { clock } = makeClock();
    const worldB = createWorld();
    const server = bus.endpoint();
    const transitions: ("session" | undefined)[] = [];
    const pB = joinDoc(worldB, bus.endpoint(), {
      clock,
      onSession: (s) => transitions.push(s === undefined ? undefined : "session"),
    });
    bus.deliverAll(); // hello → our manual server ignores it
    server.send(frame(K.SNAPSHOT_OFFER, doc.base));
    bus.deliverAll(); // B imports the base, goes active
    const resB = await pB;
    cleanups.push(() => resB.leave());
    const first = resB.session;

    server.send(frame(K.UPDATE, doc.update2)); // causal gap: update1 never delivered
    bus.deliverAll(); // PendingImportError → quarantine + re-hello
    server.send(frame(K.SNAPSHOT_OFFER, doc.full())); // the full state answers the re-hello
    bus.deliverAll();

    expect(resB.session).not.toBe(first); // the getter tracks the replacement
    worldB.sync();
    expect(findAt(worldB, 20, 0)).toBeDefined(); // recovered content, gap included
    expect(transitions[0]).toBe("session"); // initial activation
    expect(transitions).toContain(undefined); // quarantine window
    expect(transitions.at(-1)).toBe("session"); // replacement adopted
  });

  it("facade: docs.close() after a join LEAVES the room (channel fully unsubscribed)", async () => {
    const bus = new Bus();
    const { clock, advance } = makeClock();
    const ce = createCanvasEngine();
    cleanups.push(() => ce.dispose());
    const counted = counting(bus.endpoint());
    const p = ce.docs.join(counted.ch, { clock });
    bus.deliverAll();
    advance(800);
    const res = await p;
    expect(res.role).toBe("seeder");
    expect(counted.subs()).toBe(1);
    ce.docs.close();
    expect(counted.subs()).toBe(0); // finding 1: closeDoc used to strand the room wiring
    expect(ce.docs.current()).toBeUndefined();
  });

  it("facade: docs.create() during a pending join kills the join (no resurrection)", async () => {
    const bus = new Bus();
    const { clock, advance } = makeClock();
    const ce = createCanvasEngine();
    cleanups.push(() => ce.dispose());
    const counted = counting(bus.endpoint());
    const p = ce.docs.join(counted.ch, { clock });
    const rejection = expect(p).rejects.toThrow(/superseded/);
    const created = ce.docs.create(); // supersedes mid-handshake
    await rejection;
    expect(ce.docs.current()).toBe(created);
    expect(counted.subs()).toBe(0);
    advance(800); // the stale join's hello-timeout must NOT seed over the created doc
    expect(ce.docs.current()).toBe(created);
  });

  it("facade: an internal re-bootstrap re-targets docs.current()", async () => {
    const doc = makeGappedDoc();
    cleanups.push(doc.close);
    const bus = new Bus();
    const { clock } = makeClock();
    const ce = createCanvasEngine();
    cleanups.push(() => ce.dispose());
    const server = bus.endpoint();
    const p = ce.docs.join(bus.endpoint(), { clock });
    bus.deliverAll();
    server.send(frame(K.SNAPSHOT_OFFER, doc.base));
    bus.deliverAll();
    const res = await p;
    const first = must(ce.docs.current(), "adopted session");

    server.send(frame(K.UPDATE, doc.update2)); // causal gap → internal re-bootstrap
    bus.deliverAll();
    server.send(frame(K.SNAPSHOT_OFFER, doc.full()));
    bus.deliverAll();

    const swapped = must(ce.docs.current(), "re-adopted session");
    expect(swapped).not.toBe(first); // finding 3: the facade used to stay on the quarantined session
    expect(swapped).toBe(res.session); // facade and result getter agree
  });
});

// --- transport contract (2026-07-13 review) ---------------------------------------------------------
describe("bootstrap: transport contract (2026-07-13 review)", () => {
  it("a ready()-reporting channel gates the hello + silence window — no offline seed", async () => {
    const bus = new Bus();
    const { clock, advance } = makeClock();
    const ep = bus.endpoint();
    let readyResolve: (() => void) | undefined;
    const gated: ByteChannel = {
      send: (b) => ep.send(b),
      subscribe: (fn) => ep.subscribe(fn),
      ready: () =>
        new Promise<void>((res) => {
          readyResolve = res;
        }),
    };
    let settled = false;
    const p = joinDoc(createWorld(), gated, { clock });
    p.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    advance(800); // the un-gated code seeded HERE, while the socket still connected
    await Promise.resolve();
    expect(settled).toBe(false); // window not armed yet — no divergent offline seed
    must(readyResolve, "ready resolver")();
    await Promise.resolve(); // begin(): hello out, window armed
    await Promise.resolve();
    bus.deliverAll(); // hello reaches nobody
    advance(800); // NOW the silence window elapses
    const res = await p;
    cleanups.push(() => res.leave());
    expect(res.role).toBe("seeder");
  });

  it("a channel that can never open rejects the join and leaves the room", async () => {
    const bus = new Bus();
    const { clock } = makeClock();
    const counted = counting(bus.endpoint());
    const dead: ByteChannel = {
      send: (b) => counted.ch.send(b),
      subscribe: (fn) => counted.ch.subscribe(fn),
      ready: () => Promise.reject(new Error("connect failed")),
    };
    const p = joinDoc(createWorld(), dead, { clock });
    const rejection = expect(p).rejects.toThrow(/connect failed/);
    await rejection;
    expect(counted.subs()).toBe(0);
  });

  it("a throwing channel.send fails the join instead of stranding it half-attached", async () => {
    const { clock } = makeClock();
    const boom: ByteChannel = {
      send: () => {
        throw new Error("socket died");
      },
      subscribe: () => () => {},
    };
    await expect(joinDoc(createWorld(), boom, { clock })).rejects.toThrow(/socket died/);
  });

  it("a mid-drain PendingImportError preserves the undrained frames for the replacement", async () => {
    const doc = makeGappedDoc();
    cleanups.push(doc.close);
    const bus = new Bus();
    const { clock } = makeClock();
    const worldB = createWorld();
    const server = bus.endpoint();
    const pB = joinDoc(worldB, bus.endpoint(), { clock });
    bus.deliverAll(); // hello → our manual server ignores it
    // Buffer order [gapped, clean]: the gapped frame poisons the drain FIRST;
    // the clean one must survive into the replacement's buffer, not be applied
    // to the just-closed session.
    server.send(frame(K.UPDATE, doc.update2));
    server.send(frame(K.UPDATE, doc.update1));
    bus.deliverAll();
    server.send(frame(K.SNAPSHOT_OFFER, doc.base));
    bus.deliverAll(); // base imports; drain hits the gap → internal re-bootstrap
    server.send(frame(K.SNAPSHOT_OFFER, doc.full())); // answers the re-hello
    bus.deliverAll(); // replacement active; the preserved frame drains (dedup no-op)
    const resB = await pB;
    cleanups.push(() => resB.leave());
    worldB.sync();
    expect(findAt(worldB, 20, 0)).toBeDefined(); // full state recovered, no crash
  });
});

// --- channel adapters ------------------------------------------------------------------------------
describe("channel adapters (§6.5)", () => {
  it("broadcastChannelByteChannel relays bytes to other tabs, never to itself", async () => {
    const a = broadcastChannelByteChannel("ice-test-room");
    const b = broadcastChannelByteChannel("ice-test-room");
    cleanups.push(() => a.close(), () => b.close());

    const gotA: Uint8Array[] = [];
    const gotB: Uint8Array[] = [];
    a.subscribe((x) => gotA.push(x));
    b.subscribe((x) => gotB.push(x));

    a.send(new Uint8Array([1, 2, 3]));
    await new Promise((r) => setTimeout(r, 20)); // BroadcastChannel delivery is async

    expect(gotB).toHaveLength(1);
    expect([...must(gotB[0], "gotB[0]")]).toEqual([1, 2, 3]);
    expect(gotA).toHaveLength(0); // never delivered to the sender
  });

  it("webSocketByteChannel queues frames until open, then flushes; inbound arraybuffers decode", () => {
    const fake = new FakeWebSocket();
    const ch = webSocketByteChannel(fake);
    expect(fake.binaryType).toBe("arraybuffer");

    ch.send(new Uint8Array([9])); // socket still CONNECTING → queued
    expect(fake.sent).toHaveLength(0);

    fake.open(); // flush the queue
    expect(fake.sent).toHaveLength(1);
    expect([...must(fake.sent[0], "sent[0]")]).toEqual([9]);

    ch.send(new Uint8Array([7])); // now OPEN → straight through
    expect(fake.sent).toHaveLength(2);

    const got: Uint8Array[] = [];
    ch.subscribe((b) => got.push(b));
    fake.fire("message", { data: new Uint8Array([5]).buffer });
    expect(got).toHaveLength(1);
    expect([...must(got[0], "got[0]")]).toEqual([5]);
  });
});

/** A structural WebSocket fake with delayed open (WebSocketLike). */
class FakeWebSocket implements WebSocketLike {
  binaryType = "blob";
  readyState = 0; // CONNECTING
  readonly sent: Uint8Array[] = [];
  private readonly listeners = new Map<string, Set<(ev: { data: unknown }) => void>>();

  send(data: ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(data as Uint8Array);
  }
  addEventListener(type: string, fn: (ev: { data: unknown }) => void): void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: (ev: { data: unknown }) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string, ev: { data: unknown }): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }
  open(): void {
    this.readyState = 1; // OPEN
    this.fire("open", { data: undefined });
  }
}
