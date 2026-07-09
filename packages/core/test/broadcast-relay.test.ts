/**
 * Dumb snapshot relay (design-005 §6.5, M5 stopgap): two durable sessions on two
 * worlds converge over an injected channel pair. Covers the live-change path
 * (local commit on A lands on B) and the hello/answer late-joiner seed.
 *
 * The fake channel pair delivers SYNCHRONOUSLY and never echoes to the sender
 * (BroadcastChannel semantics), so the tests are deterministic without pumping a
 * real event loop. The feedback-loop guard is exercised implicitly: applying a
 * peer's snapshot is a remote-origin change and never rebroadcasts, so these
 * synchronous round-trips terminate rather than recurse.
 */
import { createWorld } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Position,
  Size,
  StackZ,
  attachBroadcastRelay,
  createDocSession,
  defineQuery,
  type RelayChannel,
} from "../src";

/** Two endpoints on one bus; a post on one delivers to the OTHER only, synchronously. */
function channelPair(): { a: RelayChannel; b: RelayChannel } {
  const listenersA = new Set<(ev: { data: unknown }) => void>();
  const listenersB = new Set<(ev: { data: unknown }) => void>();
  const endpoint = (
    own: Set<(ev: { data: unknown }) => void>,
    peer: Set<(ev: { data: unknown }) => void>,
  ): RelayChannel => ({
    postMessage: (message: unknown): void => {
      for (const l of [...peer]) l({ data: message });
    },
    addEventListener: (_type, listener): void => {
      own.add(listener);
    },
    removeEventListener: (_type, listener): void => {
      own.delete(listener);
    },
    close: (): void => {
      own.clear();
    },
  });
  return { a: endpoint(listenersA, listenersB), b: endpoint(listenersB, listenersA) };
}

const posQ = defineQuery([Position]);

function spawnBox(session: ReturnType<typeof createDocSession>, x: number): void {
  session.store.transaction((tx) => {
    tx.spawn({ components: [[Position, { x, y: 0 }], [Size, { w: 20, h: 20 }], [StackZ, { z: 0 }]] });
  });
}

function findBoxX(world: World, x: number): Entity | undefined {
  world.sync();
  let found: Entity | undefined;
  world.query(posQ).each((b) => {
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

describe("broadcast relay: live convergence", () => {
  it("ships a local commit on A to B after one snapshot round-trip", () => {
    const chan = channelPair();
    const wA = createWorld();
    const wB = createWorld();
    const sA = createDocSession(wA);
    const sB = createDocSession(wB);
    const relA = attachBroadcastRelay(sA, { channelName: "test", channel: chan.a });
    const relB = attachBroadcastRelay(sB, { channelName: "test", channel: chan.b });

    spawnBox(sA, 100); // local commit → relay posts snapshot → B applyRemote (synchronous)

    expect(findBoxX(wB, 100)).not.toBeUndefined();
    expect(findBoxX(wA, 100)).not.toBeUndefined();

    relA.stop();
    relB.stop();
  });

  it("does not rebroadcast a remote-applied change (no feedback loop)", () => {
    const chan = channelPair();
    const sA = createDocSession(createWorld());
    const wB = createWorld();
    const sB = createDocSession(wB);
    attachBroadcastRelay(sA, { channelName: "test", channel: chan.a });
    attachBroadcastRelay(sB, { channelName: "test", channel: chan.b });

    // Count how many snapshots B posts after A commits: exactly one origin (A's),
    // and B must post NONE in response (its applyRemote is remote-origin).
    let bPosts = 0;
    const bPost = chan.b.postMessage;
    chan.b.postMessage = (m: unknown): void => {
      bPosts += 1;
      bPost.call(chan.b, m);
    };

    spawnBox(sA, 42);
    expect(findBoxX(wB, 42)).not.toBeUndefined();
    expect(bPosts).toBe(0); // B applied A's snapshot and stayed quiet
  });
});

describe("broadcast relay: late-joiner seed", () => {
  it("seeds a peer that joins after the document already has content (hello/answer)", () => {
    const chan = channelPair();
    const wA = createWorld();
    const sA = createDocSession(wA);
    spawnBox(sA, 7); // content exists BEFORE any relay

    attachBroadcastRelay(sA, { channelName: "test", channel: chan.a });

    // B joins late: its attach posts a hello; A answers with a snapshot carrying the box.
    const wB = createWorld();
    const sB = createDocSession(wB);
    attachBroadcastRelay(sB, { channelName: "test", channel: chan.b });

    expect(findBoxX(wB, 7)).not.toBeUndefined();
  });
});
