/**
 * Petition I42 — presence's cursor says when the pointer is AWAY and which CANVAS it is in. Two facade engines on ONE document
 * (B opens A's envelope, so a container has the same durable key in both), each with `docs.attachPresence`, A's presence bytes
 * pumped into B. The pins: a `leave` fact (the dom adapter's, when the mouse leaves the host with nowhere to go) ⇒ A's facet reads
 * away within ONE publish, and the pointer's next fact ⇒ not; `setAway(reason)` ⇒ away while the mouse is over the host —
 * published between frames, so even under a parked freeze; entering a container ⇒ `canvas` is its durable key, the root ⇒ "";
 * every write change-only; and B's hands (core's remote cursors — what `@ice/dom` draws) hide an away peer and a peer in another
 * canvas. The wire stays tolerant: an older peer's blob (neither field) reads as present on the root, and a field a receiver does
 * not know is ignored (strata's `tryCanon` walks the RECEIVER's fields — how an older ICE reads this one's).
 *
 * Timers are real (Loro's TTL/throttle live in the wasm wall clock — the presence.test.ts rule): deadline-polling `converge`.
 *
 * Petition I45 — the first cursor a peer publishes after its mouse pointer spawns is the pointer's own point: ingest spawns it at
 * screen × camera (before, `PointerWorld` held (0, 0) for that frame — the world-point sync cannot see a pointer spawned in its
 * phase — and the first publish read the world's origin).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EphemeralStore as LoroEphemeralStore } from "loro-crdt";
import type { Entity } from "@vibecook/strata-ecs";
import {
  Camera,
  CursorVisual,
  Follows,
  Local,
  NO_MODS,
  Not,
  PointerOutside,
  Position,
  PresenceCursor,
  PresencePeer,
  Viewport,
  createCanvasEngine,
  defineQuery,
  defineWidget,
  widgets,
  type CanvasEngine,
  type InputEvent,
  type PresenceSession,
} from "../src";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Narrow-or-throw (the repo forbids `!`). */
function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`missing ${what}`);
  return v;
}

const FOLDER =
  widgets.get("i42:folder") ?? defineWidget({ type: "i42:folder", defaultSize: { w: 300, h: 200 }, container: { accepts: ["widget"] } });

const remotePeersQ = defineQuery([PresencePeer, Not(Local)]);
const handsQ = defineQuery([CursorVisual, Position]);

interface Rig {
  readonly ce: CanvasEngine;
  readonly presence: PresenceSession;
  readonly out: Uint8Array[];
  step(n?: number): void;
  /** A mouse fact at a screen point (the adapter's move) or the adapter's `leave`. */
  input(kind: InputEvent["kind"], x?: number, y?: number): void;
  /** This engine's own cursor facet, as its eph store holds it (written at once — no round trip). */
  facet(): { x: number; y: number; device: string; away: boolean; canvas: string | null } | undefined;
}

const engines: CanvasEngine[] = [];
afterEach(() => {
  for (const ce of engines.splice(0)) ce.dispose();
});

function rig(name: string, envelope?: Uint8Array): Rig {
  const ce = createCanvasEngine({ widgets: [FOLDER] });
  engines.push(ce);
  if (envelope === undefined) ce.docs.create();
  else expect(ce.docs.open(envelope).ok).toBe(true);
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  ce.docs.attachPresence({ name, color: name === "a" ? "#f00" : "#00f" });
  const presence = must(ce.docs.presence(), "presence");
  const out: Uint8Array[] = [];
  presence.onOutbound((b) => out.push(b));
  let now = 1000;
  return {
    ce, presence, out,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    },
    input(kind, x = 0, y = 0) {
      ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 0, mods: NO_MODS });
    },
    facet() {
      const v = ce.world.get(presence.localPeer, PresenceCursor);
      return v === undefined ? undefined : { ...v };
    },
  };
}

/** Pump `from`'s outbound presence bytes into `to` until `pred` holds (or the deadline), stepping `to` so it projects. */
async function converge(from: Rig, to: Rig, pred: () => boolean, deadlineMs = 2500): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    for (const b of from.out.splice(0)) to.presence.wire.apply(b);
    to.step();
    if (pred()) return true;
    if (Date.now() - t0 > deadlineMs) return false;
    await sleep(5);
  }
}

/** `of`'s view of the one remote peer: its cursor facet, and the hand core derived for it (null: none). */
function remoteOf(of: Rig): { cursor: ReturnType<Rig["facet"]>; hand: Entity | null } {
  const w = of.ce.world;
  const peer = w.firstOf(remotePeersQ);
  if (peer === undefined) return { cursor: undefined, hand: null };
  let hand: Entity | null = null;
  w.query(handsQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (w.get(e, CursorVisual)?.kind === "remote" && w.getRelation(e, Follows) === peer) hand = e;
    }
  });
  const c = w.get(peer, PresenceCursor);
  return { cursor: c === undefined ? undefined : { ...c }, hand };
}

/** Two engines on one document — a folder at (100, 100) — A's presence pumped into B, A's mouse at (400, 300). */
async function pair() {
  const a = rig("a");
  const folder = a.ce.ops.spawnWidget(FOLDER.type, { x: 100, y: 100, undoable: false });
  a.step(2);
  const key = must(a.ce.docs.current()?.store.keyOf(folder), "the folder's key");
  const b = rig("b", must(a.ce.docs.current(), "A's session").exportEnvelope());
  b.step(2);
  const folderB = must(b.ce.docs.current()?.store.resolve(key as never), "B's folder");
  a.input("move", 400, 300);
  a.step(2); // the pointer spawned at its world point (petition I45), and a tick after
  expect(await converge(a, b, () => remoteOf(b).hand !== null)).toBe(true);
  return { a, b, folder, folderB, key };
}

describe("the cursor's away (petition I42)", () => {
  it("a `leave` ⇒ the facet reads away within ONE publish and B's hand hides; the pointer's next fact ⇒ back, the hand again", async () => {
    const { a, b } = await pair();
    expect(a.facet()).toEqual({ x: 400, y: 300, device: "mouse", away: false, canvas: "" });
    a.input("leave", 400, 300);
    a.step(); // ONE step: ingest tags the pointer, the same step's publish writes the facet
    const mouse = must(a.ce.world.firstOf(defineQuery([PointerOutside])), "the mouse, out of the host");
    expect(a.ce.world.hasTag(mouse, PointerOutside)).toBe(true);
    expect(a.facet()).toMatchObject({ x: 400, y: 300, away: true });
    expect(await converge(a, b, () => remoteOf(b).cursor?.away === true && remoteOf(b).hand === null)).toBe(true);
    expect(remoteOf(b).cursor).toMatchObject({ x: 400, y: 300, away: true, canvas: "" }); // the peer stays; its hand is gone

    a.input("move", 410, 300); // back over the host
    a.step();
    expect(a.ce.world.hasTag(mouse, PointerOutside)).toBe(false);
    expect(a.facet()).toMatchObject({ x: 410, y: 300, away: false });
    expect(await converge(a, b, () => remoteOf(b).hand !== null)).toBe(true);
    expect(remoteOf(b).cursor).toMatchObject({ x: 410, away: false });
  });

  it("`setAway(reason)` ⇒ away while the mouse is over the host — written between frames, so even under a PARKED freeze; `setAway(null)` ⇒ back", async () => {
    const { a, b } = await pair();
    const thaw = a.ce.frame.freeze("cover");
    for (let i = 0; i < 10 && a.ce.frame.claimStep(); i++) a.step();
    expect(a.ce.frame.isParked()).toBe(true);
    a.presence.setAway("cover");
    expect(a.presence.away()).toBe("cover");
    await Promise.resolve(); // the publish runs a microtask after the call — no step taken (the loop is parked)
    expect(a.facet()).toMatchObject({ x: 400, y: 300, away: true });
    expect(await converge(a, b, () => remoteOf(b).cursor?.away === true && remoteOf(b).hand === null)).toBe(true);

    a.presence.setAway(null);
    await Promise.resolve();
    expect(a.facet()).toMatchObject({ away: false });
    expect(await converge(a, b, () => remoteOf(b).hand !== null)).toBe(true);
    thaw();
    // the pointer out AND a reason: away until BOTH are gone
    a.presence.setAway("history");
    a.input("leave", 400, 300);
    a.step();
    a.presence.setAway(null);
    await Promise.resolve();
    expect(a.facet()?.away).toBe(true); // the pointer is still out
    a.input("move", 400, 300);
    a.step();
    expect(a.facet()?.away).toBe(false);
  });

  it("writes change-only: no eph write for a frame that changes nothing, nor for an unchanged `setAway`", async () => {
    const { a } = await pair();
    const eph = a.presence.eph;
    const edit = vi.spyOn(eph, "edit");
    const add = vi.spyOn(eph, "addComponent");
    a.step(5);
    a.input("move", 400, 300); // the same point
    a.step(2);
    expect(edit).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    a.presence.setAway("cover");
    await Promise.resolve();
    expect(edit).toHaveBeenCalledTimes(1);
    a.presence.setAway("cover"); // unchanged
    a.presence.setAway("history"); // another reason: still away — the facet does not move
    await Promise.resolve();
    a.step(3);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(() => a.presence.setAway(3 as unknown as string)).toThrow(/a string or null/);
  });
});

describe("the cursor's canvas (petition I42)", () => {
  it("entering a container ⇒ its durable key, the root ⇒ \"\"; B draws A only in B's own canvas", async () => {
    const { a, b, folder, folderB, key } = await pair();
    a.ce.ops.enterContainer(folder, { transition: "none" });
    a.step(3);
    expect(a.facet()?.canvas).toBe(key);
    expect(await converge(a, b, () => remoteOf(b).cursor?.canvas === key)).toBe(true);
    expect(remoteOf(b).hand).toBeNull(); // B is on the root: A's coordinates are the folder's
    b.ce.ops.enterContainer(folderB, { transition: "none" });
    b.step(3);
    expect(remoteOf(b).hand).not.toBeNull(); // B in the same folder: A's hand, in its coordinates
    a.ce.ops.exitContainer({ transition: "none" });
    a.step(3);
    expect(a.facet()?.canvas).toBe("");
    expect(await converge(a, b, () => remoteOf(b).cursor?.canvas === "")).toBe(true);
    expect(remoteOf(b).hand).toBeNull(); // A on the root, B in the folder
    b.ce.ops.exitContainer({ transition: "none" });
    b.step(3);
    expect(remoteOf(b).hand).not.toBeNull();
  });
});

describe("the wire, tolerant both ways (petition I42)", () => {
  it("an older peer's cursor (no `away`, no `canvas`) reads as present on the root and has a hand; a field B does not know is ignored", () => {
    const b = rig("b");
    b.step();
    const old = new LoroEphemeralStore(5000);
    try {
      old.set("oldpeer-0", {
        components: { PresenceInfo: { name: "old", color: "#123456" }, PresenceCursor: { x: 5, y: 6, device: "mouse" } },
        tags: ["PresencePeer"],
      });
      old.set("newerpeer-0", {
        components: {
          PresenceInfo: { name: "newer", color: "#654321" },
          PresenceCursor: { x: 7, y: 8, device: "mouse", away: false, canvas: "", mood: "a field from a later ICE" },
        },
        tags: ["PresencePeer"],
      });
      b.presence.wire.apply(old.encodeAll());
    } finally {
      old.destroy();
    }
    b.step(2);
    const seen: Record<string, { cursor: unknown; hand: boolean }> = {};
    const w = b.ce.world;
    w.query(remotePeersQ).each((bt) => {
      for (const r of bt) {
        const e = bt.entity(r);
        let hand = false;
        w.query(handsQ).each((h) => { for (const hr of h) if (w.getRelation(h.entity(hr), Follows) === e) hand = true; });
        seen[String(w.get(e, PresenceCursor)?.x ?? -1)] = { cursor: w.get(e, PresenceCursor), hand };
      }
    });
    expect(seen["5"]).toEqual({ cursor: { x: 5, y: 6, device: "mouse", away: false, canvas: "" }, hand: true });
    expect(seen["7"]).toEqual({ cursor: { x: 7, y: 8, device: "mouse", away: false, canvas: "" }, hand: true });
  });
});

describe("a spawned pointer's first world point (petition I45)", () => {
  it("the mouse's FIRST fact, then ONE step: the local cursor reads that fact's world point — never the world's origin", () => {
    const a = rig("a");
    a.ce.world.setResource(Camera, { x: -300, y: 120, zoom: 2, gesturing: false });
    a.step(2);
    expect(a.facet()).toBeUndefined(); // no mouse yet: nothing published
    a.input("move", 400, 300);
    a.step(); // ONE step: ingest spawns the pointer (the world-point sync cannot see it this frame), the same step's publish writes
    expect(a.facet()).toEqual({ x: -100, y: 270, device: "mouse", away: false, canvas: "" }); // 400 / 2 − 300, 300 / 2 + 120
    a.step();
    expect(a.facet()).toEqual({ x: -100, y: 270, device: "mouse", away: false, canvas: "" }); // the sync's own write, a frame later: the same
  });
});
