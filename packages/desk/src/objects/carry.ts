// THE PRINT'S CARRY (PHOTO.md §3; design-015 §6's photo behaviours; D3w) — the hand half of the photo kind's
// physics, the note's typing's sibling: it READS the world (the local pointers, what each press captured, where
// each finger is) and drives the photo kind's bodies (kinds/photo.ts `Prints`), and it WRITES exactly one thing,
// once per carry: the print's rest.
//
// A print is not core-movable (a press on it claims the pointer and drives no core behaviour — core's own
// grammar for a widget that is not `Movable`). While a pointer is down and its press captured a print, the
// print is HELD: its grab point is a kinematic pin on the finger (`hold` at the press, `move` every frame — a
// pan or a zoom under a held print moves it too), it rises to the hand's height, tips toward the fingers and
// droops away from them; the swing about the grab point stays OFF (ruled: "do not make them rotate"). Let go
// (`drop`), it leaves with the finger's velocity over the last 70 ms, capped at 4200 u/s — a finger that
// stopped throws nothing — and glides: 0.9/s of air in the air, the cutting mat's Coulomb grip on it (2400 u/s²
// + 5/s), stepped at 240 Hz. All of it is FLUX: the document does not move while the print is in the hand or
// in the air. When the body comes to rest where its facts are not, the carry commits ONE transaction — the
// print's Position at the rest, and the raise (the top of its siblings, the prototype's `toTop`) — so one carry
// is one undo step, whatever the glide did. The commit is DEFERRED out of the frame (`defer`, a microtask by
// default): the carry runs in the desk's reflector, and a reflector never writes (D-D2c.5's rule).
// A press that never moved the print commits nothing. A taped print (`Locked`) is not carried: a press on it that
// becomes a drag meets the tape, and the carry says so (`refused`, once a gesture) — the desk's marks answer it with the
// tape's GIVE, as a core drag that meets a taped note makes it give (D4a).

import { ChildOf, defineQuery, Drag, type Entity, GestureActive, guardedTransaction, LocalPointer, Locked, Pointer, PointerButtons, PointerWorld, Position, Size, Captures, Watches, type World } from "@ice/core";
import type { Prints } from "../kinds/photo";
import type { TypingDocs } from "./typing";

export interface PhotoCarryOptions {
  readonly world: World;
  /** The document a rest commits into — the facade's `engine.docs`. */
  readonly docs: TypingDocs;
  /** The photo kind's state on this desk (undefined before it is made). */
  readonly prints: () => Prints | undefined;
  /** Is this entity a print (the desk's builder knows each entity's kind). */
  readonly isPrint: (e: Entity) => boolean;
  /** Where a rest's transaction runs: out of the frame (a microtask) unless a test says. */
  readonly defer?: (fn: () => void) => void;
  /** A press on a TAPED print became a drag (the recognizer Active): not carried — told once a gesture, so the desk's marks give it (D4a). */
  readonly refused?: (e: Entity) => void;
}

export interface PhotoCarry {
  /** Once a frame, before the kinds' clocks: the hands onto the bodies, and last frame's rests into their transactions. */
  follow(now: number): void;
  /** The prints in a hand now. */
  held(): readonly Entity[];
  /** Transactions committed since creation (a rig's witness). */
  commits(): number;
}

const pointersQ = defineQuery([Pointer, LocalPointer, PointerWorld, PointerButtons]);

export function createPhotoCarry(opts: PhotoCarryOptions): PhotoCarry {
  const { world, docs } = opts;
  const defer = opts.defer ?? ((fn: () => void) => queueMicrotask(fn));
  const held = new Set<Entity>();
  /** The drags on taped prints already told of (their recognizers), so each gesture gives once. */
  const refusing = new Set<Entity>();
  let commits = 0;

  /** ONE transaction: the print where it came to rest, raised to the top of its siblings. False when it could not. */
  const commit = (e: Entity, x: number, y: number): boolean => {
    const session = docs.current();
    const size = world.get(e, Size);
    if (session === undefined || size === undefined || !world.isAlive(e)) return false;
    try {
      guardedTransaction(session.store, world, (tx) => {
        tx.edit(e).set(Position, { x: x - size.w / 2, y: y - size.h / 2 });
        if (world.getRelation(e, ChildOf) !== undefined) tx.moveRelation(e, ChildOf, "last");
      });
    } catch {
      return false;
    }
    commits += 1;
    return true;
  };

  return {
    follow(now) {
      const prints = opts.prints();
      if (prints === undefined) return;
      // last frame's rests: each its one transaction, out of the frame
      for (const r of prints.rests()) defer(() => prints.settle(r.entity, commit(r.entity, r.x, r.y)));
      // the hands: a pointer down whose press captured a print holds it at the finger's world point
      const t = now / 1000;
      const hands = new Map<Entity, { readonly x: number; readonly y: number }>();
      const taped = new Set<Entity>();
      world.query(pointersQ).each((b) => {
        for (const row of b) {
          const p = b.entity(row);
          if ((world.read(p, PointerButtons).buttons & 1) === 0) continue;
          for (const rec of world.getReverse(p, Watches)) {
            const e = world.getRelation(rec, Captures);
            if (e === undefined || hands.has(e) || !world.isAlive(e) || !opts.isPrint(e)) continue;
            if (world.hasTag(e, Locked)) {
              // taped: never carried — a press that has become a drag meets the tape (once a gesture)
              if (world.has(rec, Drag) && world.hasTag(rec, GestureActive)) { taped.add(rec); if (!refusing.has(rec)) opts.refused?.(e); }
              continue;
            }
            const at = world.read(p, PointerWorld);
            hands.set(e, { x: at.x, y: at.y });
          }
        }
      });
      refusing.clear();
      for (const rec of taped) refusing.add(rec);
      for (const [e, at] of hands) {
        if (held.has(e)) prints.move(e, at.x, at.y, t);
        else { prints.hold(e, at.x, at.y, t); held.add(e); }
      }
      for (const e of [...held]) if (!hands.has(e)) { prints.drop(e, t); held.delete(e); }
    },
    held: () => [...held],
    commits: () => commits,
  };
}
