// THE TAP'S OBJECT (D7 #4; generic since design-016 K8a — it was the note's `tapNote`): the object a tap by the local pointer `pid`
// lands on — the interaction stack's exact hit for that pointer — or none. NONE while any object is in hand: a tap in hand is the
// hand's (a put-down, a held tool), and the pointer's hit is frozen at the pick-up anyway (l1-pick skips `HandledByWidget` pointers,
// which the hold stamps every tick), so it would name whatever the pointer touched then. `found` says whether the pointer is known
// at all (a touch that has lifted is gone: a text part may look for itself — the note asks the notes it drew).
import { defineQuery, type Entity, heldEntity, LocalPointer, Pointer, TouchesExact, type World } from "@ice/core";

const tapPointersQ = defineQuery([Pointer, LocalPointer]);

export function tapHit(world: World, pid: string): { readonly found: boolean; readonly hit: Entity | undefined } {
  if (heldEntity(world) !== undefined) return { found: true, hit: undefined };
  let found = false;
  let hit: Entity | undefined;
  world.query(tapPointersQ).each((b) => {
    for (const r of b) {
      const p = b.entity(r);
      if (world.read(p, Pointer).id !== pid) continue;
      found = true;
      hit = world.getRelation(p, TouchesExact);
    }
  });
  return { found, hit: found ? hit : undefined };
}
