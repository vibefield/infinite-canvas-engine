/**
 * M9 presence layer (design-005 §6.5, design-001 §5.6): two worlds each with a
 * presence session over a pumped byte-channel pair. Outbound rides the binding's
 * own throttle/keepalive timers (Loro's LWW/TTL live in the wasm wall clock, not
 * JS we can fake — the strata attach.test.ts rule), so cross-peer sequencing uses
 * REAL short waits + deadline-polling `converge`, exactly as the ephemeral layer's
 * own tests do.
 *
 * Coverage: presence round-trip (remote peer + cursor coords + selection summary);
 * selection-empties removes the facet; leave() despawns the peer; the remote-cursor
 * derive system grows/reaps a CursorVisual "remote" entity following the peer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EphemeralStore as LoroEphemeralStore } from "loro-crdt";
import type { Entity } from "@vibecook/strata-ecs";
import {
  CursorVisual,
  Follows,
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
  attachPresence,
  createEngine,
  createPresencePublish,
  createRemoteCursorsSystem,
  createWorld,
  defineQuery,
  type PresenceSession,
} from "../src";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Narrow-or-throw (the repo forbids `!`): assert a lookup found something. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`missing ${what}`);
  return v;
}

const remotePeersQ = defineQuery([PresencePeer, Not(Local)]);
const remoteCursorVisualQ = defineQuery([CursorVisual, Position]);

interface Peer {
  readonly world: ReturnType<typeof createWorld>;
  readonly session: PresenceSession;
  readonly outbound: Uint8Array[];
}

const sessions: PresenceSession[] = [];

function makePeer(name: string, color: string): Peer {
  const world = createWorld();
  const session = attachPresence(world, { name, color });
  const outbound: Uint8Array[] = [];
  session.onOutbound((b) => outbound.push(b));
  sessions.push(session);
  return { world, session, outbound };
}

/** Forward every buffer `from` broadcast into `to`'s wire, syncing until `pred` holds (or the deadline). */
async function converge(from: Peer, to: Peer, pred: () => boolean, deadlineMs = 2000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    for (const b of from.outbound.splice(0)) to.session.wire.apply(b);
    to.world.sync();
    if (pred() || Date.now() - t0 > deadlineMs) return;
    await sleep(5);
  }
}

function firstRemotePeer(peer: Peer): Entity | undefined {
  return peer.world.firstOf(remotePeersQ);
}

afterEach(() => {
  for (const s of sessions.splice(0)) {
    try {
      s.detach();
    } catch {
      /* already detached in-test */
    }
  }
});

describe("presence round-trip (§15.3/§15.4)", () => {
  it("A's cursor + 2-widget selection project onto B; clearing selection drops the facet; leave despawns the peer", async () => {
    const A = makePeer("Alice", "#f00");
    const B = makePeer("Bob", "#00f");

    // A local mouse pointer (the presence cursor source) at a world position.
    A.world.spawn({
      components: [
        [Pointer, { id: "m", device: "mouse" }],
        [PointerWorld, { x: 10, y: 20 }],
      ],
      tags: [LocalPointer],
    });

    // Two selected widgets with durable-ish keys (injected keyOf).
    const w1 = A.world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]] });
    const w2 = A.world.spawn({ components: [[Position, { x: 100, y: 0 }], [Size, { w: 10, h: 10 }]] });
    A.world.addTag(w1, Selected);
    A.world.addTag(w2, Selected);
    const keys = new Map<Entity, string>([[w1, "k1"], [w2, "k2"]]);
    const publishA = createPresencePublish(A.world, A.session, { keyOf: (e) => keys.get(e) });

    publishA(A.world); // stage cursor + selection-summary facets on A's local peer
    await converge(A, B, () => {
      const p = firstRemotePeer(B);
      return p !== undefined && B.world.has(p, PresenceCursor) && B.world.has(p, SelectionSummary);
    });

    const peer = must(firstRemotePeer(B), "remote peer");
    expect(B.world.hasTag(peer, Local)).toBe(false); // remote projection carries no Local
    expect(B.world.get(peer, PresenceCursor)).toEqual({ x: 10, y: 20, device: "mouse" });
    const summary = must(B.world.get(peer, SelectionSummary), "selection summary");
    expect(summary.count).toBe(2);
    expect(summary).toMatchObject({ x: 0, y: 0, w: 110, h: 10 }); // union bbox of the two widgets
    expect(JSON.parse(summary.keys ?? "[]")).toEqual(["k1", "k2"]);

    // Clearing the selection REMOVES the facet (present only while non-empty).
    A.world.removeTag(w1, Selected);
    A.world.removeTag(w2, Selected);
    publishA(A.world);
    await converge(A, B, () => {
      const p = firstRemotePeer(B);
      return p !== undefined && !B.world.has(p, SelectionSummary);
    });
    const peerAfterClear = must(firstRemotePeer(B), "remote peer");
    expect(B.world.has(peerAfterClear, SelectionSummary)).toBe(false);
    expect(B.world.has(peerAfterClear, PresenceCursor)).toBe(true); // cursor survives

    // leave() (via detach) ships tombstones → B despawns the peer promptly.
    await sleep(5); // the tombstone must out-timestamp the last set (M0 finding 5)
    A.session.detach();
    await converge(A, B, () => firstRemotePeer(B) === undefined);
    expect(firstRemotePeer(B)).toBeUndefined();
  });
});

describe("remote-cursor derive system", () => {
  it("grows a CursorVisual 'remote' entity following the peer, and reaps it on peer death", async () => {
    const A = makePeer("Alice", "#f00");
    const B = makePeer("Bob", "#00f");

    // B runs the remote-cursor derive system on a minimal engine.
    const engineB = createEngine(B.world);
    engineB.addSystems("derive", createRemoteCursorsSystem(B.world));

    A.world.spawn({
      components: [
        [Pointer, { id: "m", device: "mouse" }],
        [PointerWorld, { x: 42, y: 7 }],
      ],
      tags: [LocalPointer],
    });
    const publishA = createPresencePublish(A.world, A.session, {});
    publishA(A.world);

    // Project A's peer onto B, then step B's engine so the derive system spawns the cursor.
    await converge(A, B, () => {
      const p = firstRemotePeer(B);
      return p !== undefined && B.world.has(p, PresenceCursor);
    });
    const peer = must(firstRemotePeer(B), "remote peer");
    engineB.step(1);

    const cursor = must(B.world.firstOf(remoteCursorVisualQ), "remote cursor entity");
    expect(B.world.get(cursor, CursorVisual)).toEqual({ kind: "remote", pressed: false });
    expect(B.world.read(cursor, Position)).toEqual({ x: 42, y: 7 });
    expect(B.world.getRelation(cursor, Follows)).toBe(peer); // cursor Follows → the peer

    // A leaves → B despawns the peer, and the derive system reaps its cursor.
    await sleep(5);
    A.session.detach();
    await converge(A, B, () => firstRemotePeer(B) === undefined);
    engineB.step(2);
    expect(B.world.firstOf(remoteCursorVisualQ)).toBeUndefined();
  });
});

describe("outbound fan-out fault isolation (0.8.0 review finding 1)", () => {
  it("a throwing subscriber is contained and LATER subscribers still receive the bytes", async () => {
    // The canonical subscriber is ws.send, which throws on a closing socket.
    // Without per-subscriber isolation the throw kills the fan-out loop
    // (starving every later subscriber) and rides the binding's own TIMER
    // callbacks — and, during a leave flush, the whole teardown path.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const A = makePeer("Alice", "#f00");
      A.session.onOutbound(() => {
        throw new Error("socket closed");
      });
      const got: Uint8Array[] = [];
      A.session.onOutbound((b) => got.push(b));
      A.session.eph.addComponent(A.session.localPeer, PresenceCursor, { x: 1, y: 2, device: "mouse" });
      const t0 = Date.now();
      while (got.length === 0 && Date.now() - t0 < 2000) await sleep(5);
      expect(got.length).toBeGreaterThan(0); // the subscriber AFTER the thrower still fed
      expect(errors).toHaveBeenCalled(); // contained loudly, not swallowed silently
    } finally {
      errors.mockRestore();
    }
  });

  it("PresenceOpts.onFault routes the fault to the host and silences the console default", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const world = createWorld();
      const faults: string[] = [];
      const session = attachPresence(world, {
        name: "routed",
        color: "#0ff",
        onFault: (where) => faults.push(where),
      });
      sessions.push(session);
      session.onOutbound(() => {
        throw new Error("socket closed");
      });
      session.eph.addComponent(session.localPeer, PresenceCursor, { x: 3, y: 4, device: "mouse" });
      const t0 = Date.now();
      while (faults.length === 0 && Date.now() - t0 < 2000) await sleep(5);
      expect(faults).toContain("outbound");
      expect(errors).not.toHaveBeenCalled(); // routed means ROUTED — no console default
    } finally {
      errors.mockRestore();
    }
  });
});

// --- world.reset self-heal (2026-07-13 review: internal re-bootstrap) --------------------------------

describe("presence survives world.reset (doc close / internal re-bootstrap)", () => {
  it("re-mints the local peer, re-projects remotes, and keeps the mutator usable", async () => {
    const a = makePeer("A", "#f00");
    const b = makePeer("B", "#0f0");

    // Round-trip first: B sees A.
    a.session.eph.addComponent(a.session.localPeer, PresenceCursor, { x: 1, y: 2, device: "mouse" });
    await converge(a, b, () => firstRemotePeer(b) !== undefined);
    expect(firstRemotePeer(b)).toBeDefined();
    const oldLocal = b.session.localPeer;

    // The doc layer resets B's world (close / re-bootstrap): every presence
    // entity dies while the loro store + binding + timers survive.
    b.world.reset();
    await sleep(0); // the heal is deferred one microtask past the reset emit

    // Local identity re-minted on a LIVE entity (the session getter tracks it).
    expect(b.session.localPeer).not.toBe(oldLocal);
    b.world.sync();
    expect(b.world.isAlive(b.session.localPeer)).toBe(true);
    expect(b.world.hasTag(b.session.localPeer, PresencePeer)).toBe(true);

    // Remotes re-project from A's ongoing traffic — the fresh binding has an
    // empty blob-diff cache, so even a same-value refresh recreates the entity.
    a.session.eph.edit(a.session.localPeer).set(PresenceCursor, { x: 3, y: 4, device: "mouse" });
    await converge(a, b, () => firstRemotePeer(b) !== undefined);
    expect(firstRemotePeer(b)).toBeDefined();

    // The local mutator still works post-heal (the publish path's writes).
    b.session.eph.addComponent(b.session.localPeer, PresenceCursor, { x: 9, y: 9, device: "mouse" });
    b.world.sync();
    expect(b.world.has(b.session.localPeer, PresenceCursor)).toBe(true);
  });
});

// --- I43: onRemote fires only for an event that carries keys ------------------------------------------

describe("onRemote — a store event that carries no keys is no one's (I43)", () => {
  it("an empty TTL sweep fires nothing; one import fires once; the peer's key aging out fires once", async () => {
    // TTL 400 ms: Loro sweeps every 200 ms while the store holds a key — A's own keepalive (≈ ttl/3) keeps one there.
    const TTL = 400;
    let remote = 0;
    const a = attachPresence(createWorld(), { name: "a", color: "#f00", ttlMs: TTL, onRemote: () => { remote += 1; } });
    sessions.push(a);
    const b = attachPresence(createWorld(), { name: "b", color: "#00f", ttlMs: TTL });
    sessions.push(b);
    const fromB: Uint8Array[] = [];
    b.onOutbound((bytes) => fromB.push(bytes));

    // The control: a bare store at the same TTL, its one key refreshed as a keepalive would — at this loro version a sweep that
    // removes nothing still EMITS (`timeout`, every array empty), so the silence asserted below is the fix's, not Loro's.
    const control = new LoroEphemeralStore(TTL);
    const sweeps: number[] = [];
    const stopControl = control.subscribe((ev) => {
      if (ev.by === "timeout" && ev.added.length + ev.updated.length + ev.removed.length === 0) sweeps.push(Date.now());
    });
    control.set("k", 1);
    const refresh = setInterval(() => control.set("k", 1), TTL / 3);
    try {
      await sleep(900); // ≥ 4 sweeps of A's own store, every one empty
      expect(sweeps.length).toBeGreaterThan(1);
      expect(remote).toBe(0);
    } finally {
      clearInterval(refresh);
      stopControl();
      control.destroy();
    }

    // An import from a remote: ONE fresh buffer of B's (its keepalive; its peer's key added) — one fire. (A buffer older than
    // the TTL imports nothing: Loro drops an expired key on arrival, every array empty.)
    fromB.splice(0);
    const t0 = Date.now();
    while (fromB.length === 0 && Date.now() - t0 < 2000) await sleep(5);
    const first = must(fromB[0], "B's next outbound buffer");
    a.wire.apply(first);
    expect(remote).toBe(1);
    // The same buffer again changes nothing in A's store (every array empty) — no fire.
    a.wire.apply(first);
    expect(remote).toBe(1);

    // B's bytes stop reaching A: past the TTL a sweep REMOVES B's key — one fire — and the empty sweeps after it fire nothing.
    const t1 = Date.now();
    while (remote < 2 && Date.now() - t1 < 3000) await sleep(10);
    expect(remote).toBe(2);
    await sleep(500);
    expect(remote).toBe(2);
  });
});
