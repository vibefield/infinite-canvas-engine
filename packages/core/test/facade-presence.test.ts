/**
 * Petition I18 — `docs.attachPresence`: facade presence for hosts that own
 * their document lifecycle (create/open + their own transport) and never call
 * `docs.join({presence})`. The petition's evidence pinned the gap: standalone
 * `attachPresence(world, …)` creates a real session the facade seam never
 * sees, so `docs.presence()` stays undefined and every registered ephemeral
 * behavior stays dormant. The acceptance suite below is the petition's list,
 * plus the one trap found past it: detaching presence on a STILL-OPEN document
 * must reap the remote-cursor derive pool (the join path never saw the strand
 * because `docs.close()` follows presence teardown with a world reset).
 *
 * Timers are real (Loro's TTL/throttle live in the wasm wall clock — the
 * presence.test.ts rule), so cross-peer sequencing uses deadline-polling.
 * Names are file-unique ("i18:*").
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Entity } from "@vibecook/strata-ecs";
import {
  Camera,
  CursorVisual,
  Position,
  PresenceCursor,
  Viewport,
  attachPresence,
  createCanvasEngine,
  createWorld,
  defineQuery,
  type CanvasEngine,
  type PresenceSession,
} from "../src";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import type { AnyBehaviorDef } from "../src/behavior/types";
import { p } from "../src/widget/props";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Narrow-or-throw (the repo forbids `!`): assert a lookup found something. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`missing ${what}`);
  return v;
}

const engines: CanvasEngine[] = [];
const rawSessions: PresenceSession[] = [];

function makeRig(behaviors: readonly AnyBehaviorDef[] = []) {
  const ce = createCanvasEngine({
    behaviors,
    onGuestFault: () => {},
    onGuestNotice: () => {},
    onBehaviorFault: () => {},
    onBehaviorLog: () => {},
  });
  ce.engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  engines.push(ce);
  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  return { ce, step };
}

afterEach(() => {
  for (const ce of engines.splice(0)) ce.dispose();
  for (const s of rawSessions.splice(0)) {
    try {
      s.detach();
    } catch {
      /* already detached in-test */
    }
  }
  __resetBehaviorsForTests();
});

const OPTS = { name: "me", color: "#f00" } as const;

describe("docs.attachPresence — gates", () => {
  it("refuses without a live document; a failed attach leaves no residue and a later attach works", () => {
    const { ce } = makeRig();
    expect(() => ce.docs.attachPresence(OPTS)).toThrow(/needs a live document/);
    expect(ce.docs.presence()).toBeUndefined();

    ce.docs.create();
    const off = ce.docs.attachPresence(OPTS);
    expect(ce.docs.presence()).toBeDefined();
    off();
    expect(ce.docs.presence()).toBeUndefined();

    // After close the gate is back — the seam's lifetime is the document's.
    ce.docs.close();
    expect(() => ce.docs.attachPresence(OPTS)).toThrow(/needs a live document/);
  });

  it("attaches after create() AND after open(); a second live attach refuses", () => {
    const scratch = makeRig();
    scratch.ce.docs.create();
    const bytes = must(scratch.ce.docs.current(), "scratch session").exportEnvelope();
    scratch.ce.docs.close();

    const { ce } = makeRig();
    ce.docs.create();
    ce.docs.attachPresence(OPTS);
    expect(ce.docs.presence()?.peerId).toBeDefined();
    expect(() => ce.docs.attachPresence({ name: "b", color: "#0f0" })).toThrow(/already live/);
    ce.docs.close(); // releases the live attachment with the doc

    const opened = ce.docs.open(bytes);
    expect(opened.ok).toBe(true);
    ce.docs.attachPresence(OPTS);
    expect(ce.docs.presence()).toBeDefined();
  });
});

describe("docs.attachPresence — the ephemeral behavior door (the petition's headline)", () => {
  it("a registered ephemeral behavior leaves dormancy on the next publish step: one facet, init once", () => {
    const inits: Entity[] = [];
    const B = defineBehavior("i18:activate", {
      store: "ephemeral",
      schema: { n: p.number({ default: 7 }) },
      on: { init: (e) => inits.push(e) },
    });
    const { ce, step } = makeRig([B]);
    ce.docs.create();
    step(2);
    expect(inits).toEqual([]); // dormant: registered, doc live, no presence
    expect(ce.behaviors.list()[0]?.instances).toBe(0);

    ce.docs.attachPresence(OPTS);
    step();
    const peer = must(ce.docs.presence(), "presence").localPeer;
    expect(inits).toEqual([peer]);
    expect(ce.world.get(peer, B.component)).toEqual({ n: 7 });
    expect(ce.behaviors.list()[0]?.instances).toBe(1);
  });

  it("reattach remints a fresh peer and behavior DEFAULTS once — a stale value does not survive detach", () => {
    const log: string[] = [];
    const B = defineBehavior("i18:remint", {
      store: "ephemeral",
      schema: { n: p.number({ default: 1 }) },
      on: { init: () => log.push("init"), dispose: () => log.push("dispose") },
    });
    const { ce, step } = makeRig([B]);
    ce.docs.create();
    const off1 = ce.docs.attachPresence(OPTS);
    step();
    const s1 = must(ce.docs.presence(), "first session");
    const peer1 = s1.localPeer;
    expect(log).toEqual(["init"]);

    // Publish a non-default value through the presence writer (ctx.write's door).
    s1.eph.edit(peer1).set(B.component, { n: 42 });
    step();
    expect(ce.world.get(peer1, B.component)).toEqual({ n: 42 });

    off1();
    step(); // the departed instance disposes; the node goes dormant
    expect(log).toEqual(["init", "dispose"]);
    expect(ce.world.isAlive(peer1)).toBe(false);

    ce.docs.attachPresence(OPTS);
    step();
    const peer2 = must(ce.docs.presence(), "second session").localPeer;
    expect(peer2).not.toBe(peer1);
    expect(ce.world.get(peer2, B.component)).toEqual({ n: 1 }); // defaults, not 42
    expect(log).toEqual(["init", "dispose", "init"]); // once per attachment
  });
});

describe("docs.attachPresence — the inverse", () => {
  it("is idempotent and identity-bound: a stale inverse cannot detach a replacement attachment", () => {
    const { ce } = makeRig();
    ce.docs.create();
    const offA = ce.docs.attachPresence(OPTS);
    ce.docs.close(); // auto-teardown released A; offA was never called

    ce.docs.create();
    const offB = ce.docs.attachPresence({ name: "b", color: "#0f0" });
    const b = must(ce.docs.presence(), "replacement session");
    offA(); // stale — bound to A's identity, must not touch B
    expect(ce.docs.presence()).toBe(b);

    offB();
    expect(ce.docs.presence()).toBeUndefined();
    offB(); // second call: quiet no-op
    expect(ce.docs.presence()).toBeUndefined();
  });

  it("ships leave tombstones through STILL-SUBSCRIBED outbound before wiring tears down; close() likewise", async () => {
    const { ce, step } = makeRig();
    ce.docs.create();
    const off = ce.docs.attachPresence(OPTS);
    const out: Uint8Array[] = [];
    const unsub = must(ce.docs.presence(), "presence").onOutbound((bts) => out.push(bts));
    step();
    await sleep(5); // the tombstone must out-timestamp the last set (M0 finding 5)
    out.length = 0;
    off();
    expect(out.length).toBeGreaterThan(0); // leave flushed while the caller could still forward it
    expect(ce.docs.presence()).toBeUndefined();
    unsub();

    // Same contract through docs.close().
    ce.docs.attachPresence(OPTS);
    const out2: Uint8Array[] = [];
    must(ce.docs.presence(), "second attach").onOutbound((bts) => out2.push(bts));
    step();
    await sleep(5);
    out2.length = 0;
    ce.docs.close();
    expect(out2.length).toBeGreaterThan(0);
    expect(ce.docs.presence()).toBeUndefined();
  });

  it("engine disposal tears facade presence down with the doc; the stale inverse stays quiet", async () => {
    const { ce, step } = makeRig();
    ce.docs.create();
    const off = ce.docs.attachPresence(OPTS);
    const out: Uint8Array[] = [];
    must(ce.docs.presence(), "presence").onOutbound((bts) => out.push(bts));
    step();
    await sleep(5);
    out.length = 0;
    engines.splice(engines.indexOf(ce), 1); // afterEach must not double-dispose
    ce.dispose();
    expect(out.length).toBeGreaterThan(0); // leave flushed on the way down
    expect(ce.docs.presence()).toBeUndefined();
    off(); // stale after dispose — quiet no-op
  });
});

describe("docs.attachPresence — derived residue on a still-open document", () => {
  const cursorQ = defineQuery([CursorVisual, Position]);

  function remoteCursorOf(ce: CanvasEngine): Entity | undefined {
    let found: Entity | undefined;
    ce.world.query(cursorQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        if (ce.world.get(e, CursorVisual)?.kind === "remote") found = e;
      }
    });
    return found;
  }

  it("the inverse reaps pooled remote cursors — no ghost frozen on the open canvas", async () => {
    const { ce, step } = makeRig();
    ce.docs.create();
    const off = ce.docs.attachPresence(OPTS);
    const wire = must(ce.docs.presence(), "presence").wire;

    // A remote peer over a hand-pumped byte channel (presence.test.ts recipe).
    const otherWorld = createWorld();
    const other = attachPresence(otherWorld, { name: "bob", color: "#00f" });
    rawSessions.push(other);
    const buf: Uint8Array[] = [];
    other.onOutbound((bts) => buf.push(bts));
    other.eph.addComponent(other.localPeer, PresenceCursor, { x: 5, y: 6, device: "mouse" });

    const t0 = Date.now();
    let cursor: Entity | undefined;
    for (;;) {
      for (const bts of buf.splice(0)) wire.apply(bts);
      step();
      cursor = remoteCursorOf(ce);
      if (cursor !== undefined || Date.now() - t0 > 2000) break;
      await sleep(5);
    }
    const found = must(cursor, "projected remote cursor");

    off(); // detach on a STILL-OPEN doc — the document keeps running
    expect(ce.world.isAlive(found)).toBe(false); // reaped with the uninstall, not stranded
    expect(ce.docs.presence()).toBeUndefined();
    expect(ce.docs.current()).toBeDefined(); // the doc really did stay open
    step(); // and the engine keeps stepping cleanly without the presence systems
  });
});
