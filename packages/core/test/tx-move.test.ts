/**
 * `tx.move` + the two retarget CHOKEPOINTS (petition I15, M12).
 *
 * The bug this closes, traced end to end: a glide holds the runtime cell away
 * from the document (the tween IS the divergence grant). If the durable value
 * then changes by any path OTHER than the move — an undo, another op's write —
 * the tween keeps easing toward its old target and lands there. strata's
 * `(own, value)` branch advances the baseline alone and banks NOTHING, so the
 * cell is left diverged with an empty held-cell ledger: it never reconciles,
 * and every later remote value for it drops-and-banks against a sweep that can
 * never fire. Not a window — permanent.
 *
 * The fix is two sweeps: post-seal inside `guardedTransaction`, and after each
 * history step in the facade (undo does not pass through the tx path at all).
 *
 * Schema names are file-unique ("mv:*") — strata has no public schema reset.
 */
import { describe, expect, it } from "vitest";
import {
  Position,
  TransformTween,
  createCanvasEngine,
  defineWidget,
  widgets,
  type CanvasEngine,
  type Entity,
} from "../src";

const BOX =
  widgets.get("mv:box") ??
  defineWidget({
    type: "mv:box",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 100 },
  });

async function makeBoard(): Promise<{ ce: CanvasEngine; a: Entity }> {
  const ce = createCanvasEngine({ widgets: [BOX] });
  await ce.docs.create();
  const a = ce.ops.spawnWidget("mv:box", { x: 0, y: 0, w: 100, h: 100, undoable: false });
  ce.world.sync(); // the tx spawn projects at the next sync
  return { ce, a };
}

/** The live glide's current durable target. */
function target(ce: CanvasEngine, e: Entity): { x: number; y: number } | undefined {
  const tw = ce.world.get(e, TransformTween);
  return tw === undefined ? undefined : { x: tw.toX, y: tw.toY };
}

function docPos(ce: CanvasEngine, e: Entity): { x: number; y: number } {
  const v = ce.docs.current()?.store.getComponent(e, Position) as { x: number; y: number };
  return { x: v.x, y: v.y };
}

describe("tx.move — one commit owns capture, final, and glide", () => {
  it("writes the durable final in THIS transaction and glides from the captured origin", async () => {
    const { ce, a } = await makeBoard();

    const session = ce.docs.current();
    if (session === undefined) throw new Error("session expected");
    const { guardedTransaction } = await import("../src/guards/guarded-tx");

    guardedTransaction(
      session.store,
      ce.world,
      (tx) => tx.move(a, { x: 300, y: 200 }, { animateMs: 240 }),
      { live: session.liveWriter },
    );

    // Document: already at the target. Runtime: rewound to the origin, gliding.
    expect(docPos(ce, a)).toEqual({ x: 300, y: 200 });
    expect(ce.world.get(a, Position)).toEqual({ x: 0, y: 0 });
    expect(target(ce, a)).toEqual({ x: 300, y: 200 });
    ce.dispose();
  });

  it("refuses without a live writer rather than writing around the guard", async () => {
    const { ce, a } = await makeBoard();
    const session = ce.docs.current();
    if (session === undefined) throw new Error("session expected");
    const { guardedTransaction } = await import("../src/guards/guarded-tx");

    expect(() =>
      guardedTransaction(session.store, ce.world, (tx) => tx.move(a, { x: 1, y: 1 })),
    ).toThrow(/live writer/);
    ce.dispose();
  });

  it("skips a Grab-held entity — the gesture owns its divergence", async () => {
    const { ce, a } = await makeBoard();
    const session = ce.docs.current();
    if (session === undefined) throw new Error("session expected");
    const { Grab } = await import("../src/catalog");
    const { guardedTransaction } = await import("../src/guards/guarded-tx");

    ce.world.addComponent(a, Grab, { x: 0, y: 0, w: 100, h: 100, parent: 0, prev: 0, ord: 0 });
    guardedTransaction(
      session.store,
      ce.world,
      (tx) => tx.move(a, { x: 300, y: 200 }, { animateMs: 240 }),
      { live: session.liveWriter },
    );

    expect(ce.world.get(a, TransformTween)).toBeUndefined();
    expect(docPos(ce, a)).toEqual({ x: 0, y: 0 }); // not even the durable half
    ce.dispose();
  });
});

describe("the post-seal chokepoint — a non-move Position write retargets the glide", () => {
  it("retargets a live tween when another write in the SAME tx moves the entity", async () => {
    const { ce, a } = await makeBoard();
    const session = ce.docs.current();
    if (session === undefined) throw new Error("session expected");
    const { guardedTransaction } = await import("../src/guards/guarded-tx");

    guardedTransaction(
      session.store,
      ce.world,
      (tx) => tx.move(a, { x: 300, y: 200 }, { animateMs: 240 }),
      { live: session.liveWriter },
    );
    expect(target(ce, a)).toEqual({ x: 300, y: 200 });

    // A later, ordinary durable write — no `move` in sight.
    guardedTransaction(session.store, ce.world, (tx) => tx.edit(a).set(Position, { x: 50, y: 60 }), {
      live: session.liveWriter,
    });

    // Without the sweep the glide would still be aiming at (300,200) and would
    // LAND there, permanently contradicting the document.
    expect(target(ce, a)).toEqual({ x: 50, y: 60 });
    expect(docPos(ce, a)).toEqual({ x: 50, y: 60 });
    ce.dispose();
  });
});

describe("the history chokepoint — undo mid-glide converges", () => {
  it("retargets the glide onto the undone value; landing reconverges the cell", async () => {
    const { ce, a } = await makeBoard();
    const session = ce.docs.current();
    if (session === undefined) throw new Error("session expected");
    const { guardedTransaction } = await import("../src/guards/guarded-tx");

    guardedTransaction(
      session.store,
      ce.world,
      (tx) => tx.move(a, { x: 300, y: 200 }, { animateMs: 240 }),
      { live: session.liveWriter },
    );
    expect(target(ce, a)).toEqual({ x: 300, y: 200 });

    // ⌘Z lands mid-glide. Before I15 the tween kept its (300,200) target and
    // landed there, stranding the cell against a document that said (0,0).
    expect(ce.docs.undo()).toBe(true);
    expect(docPos(ce, a)).toEqual({ x: 0, y: 0 });
    expect(target(ce, a)).toEqual({ x: 0, y: 0 });

    // Run the glide to completion: the tween lands ON the document's value and
    // reaps itself, so runtime == baseline — nothing diverged, nothing stranded.
    for (let i = 0; i < 40; i++) ce.step(i * 16);

    expect(ce.world.get(a, TransformTween)).toBeUndefined();
    expect(ce.world.get(a, Position)).toEqual({ x: 0, y: 0 });
    expect(docPos(ce, a)).toEqual({ x: 0, y: 0 });
    ce.dispose();
  });

  it("redo retargets too (the same divergence, mirrored)", async () => {
    const { ce, a } = await makeBoard();
    const session = ce.docs.current();
    if (session === undefined) throw new Error("session expected");
    const { guardedTransaction } = await import("../src/guards/guarded-tx");

    guardedTransaction(
      session.store,
      ce.world,
      (tx) => tx.move(a, { x: 300, y: 200 }, { animateMs: 240 }),
      { live: session.liveWriter },
    );
    ce.docs.undo();
    expect(ce.docs.redo()).toBe(true);

    expect(docPos(ce, a)).toEqual({ x: 300, y: 200 });
    expect(target(ce, a)).toEqual({ x: 300, y: 200 });
    ce.dispose();
  });

  it("a read-only session refuses history without touching live glides", async () => {
    const { ce, a } = await makeBoard();
    const session = ce.docs.current();
    if (session === undefined) throw new Error("session expected");
    const { guardedTransaction } = await import("../src/guards/guarded-tx");

    guardedTransaction(
      session.store,
      ce.world,
      (tx) => tx.move(a, { x: 300, y: 200 }, { animateMs: 240 }),
      { live: session.liveWriter },
    );
    const before = target(ce, a);
    (session as { readOnly: boolean }).readOnly = true;

    expect(ce.docs.undo()).toBe(false);
    expect(target(ce, a)).toEqual(before);
    ce.dispose();
  });
});

describe("undo semantics", () => {
  it("one move = ONE undo entry; undoable:false leaves history untouched", async () => {
    const { ce, a } = await makeBoard();
    const session = ce.docs.current();
    if (session === undefined) throw new Error("session expected");
    const { guardedTransaction } = await import("../src/guards/guarded-tx");

    guardedTransaction(
      session.store,
      ce.world,
      (tx) => {
        tx.move(a, { x: 10, y: 10 }, { animateMs: 0 });
        tx.move(a, { x: 20, y: 20 }, { animateMs: 0 });
      },
      { live: session.liveWriter },
    );
    expect(docPos(ce, a)).toEqual({ x: 20, y: 20 });

    // Two moves, ONE transaction ⇒ one undo step back to the spawn position.
    expect(ce.docs.undo()).toBe(true);
    expect(docPos(ce, a)).toEqual({ x: 0, y: 0 });

    // The undo above emptied the stack (the spawn was undoable:false too), so
    // a derived move landing now must leave it empty — that is the property:
    // ⌘Z can never un-derive.
    guardedTransaction(session.store, ce.world, (tx) => tx.move(a, { x: 99, y: 99 }), {
      live: session.liveWriter,
      undoable: false,
    });
    expect(docPos(ce, a)).toEqual({ x: 99, y: 99 });
    expect(ce.docs.undo()).toBe(false); // nothing was pushed
    expect(docPos(ce, a)).toEqual({ x: 99, y: 99 }); // and nothing was reverted
    ce.dispose();
  });
});
