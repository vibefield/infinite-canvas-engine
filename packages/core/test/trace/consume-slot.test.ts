/**
 * Consume free-slot placement (2026-07-17, James: cards dropped into a folder
 * "just pile up on each other"). The consume branch used to write the RAW
 * drop point converted to container-local — everyone aims at the folder's
 * center, so every child landed on the same spot. Now the newcomer takes the
 * nearest free slot (kernel insertSlot); incumbents never move.
 *
 * Pinned here:
 *  - empty container → the raw drop point survives verbatim (hint wins when
 *    free — deliberate placement is user intent);
 *  - occupied drop point → nearest edge-aligned free slot, gutter respected,
 *    and the intent carries NO write for the incumbent.
 */
import { describe, expect, it } from "vitest";
import { ChildOf, Position } from "../../src";
import { createFullRig } from "./rig-full";

function dropCardAt395x180(rig: ReturnType<typeof createFullRig>) {
  const card = rig.spawnBox({ x: 100, y: 100, w: 60, h: 60, provides: ["card"] });
  rig.down("mouse", 130, 130);
  rig.step();
  rig.move("mouse", 145, 130); // slop exit → Active
  rig.step();
  rig.move("mouse", 395, 180); // card at world (350,150), inside the container
  rig.step();
  rig.up("mouse", 395, 180);
  rig.step(); // Ended → consume intent
  return card;
}

describe("trace: consume places newcomers in a free slot", () => {
  it("empty container → the raw drop point, container-local, verbatim", () => {
    const rig = createFullRig();
    const container = rig.spawnBox({
      x: 300,
      y: 100,
      w: 200,
      h: 200,
      container: true,
      accepts: ["card"],
      selectable: false,
      movable: false,
    });
    const card = dropCardAt395x180(rig);
    expect(rig.sink.intents).toHaveLength(1);
    const intent = rig.sink.intents[0];
    expect(intent?.kind).toBe("consume");
    expect(intent?.reparents).toContainEqual({ entity: card, container });
    const write = intent?.writes.find((w) => w.entity === card && w.component === Position);
    expect(write?.value).toEqual({ x: 50, y: 50 }); // (350,150) − container (300,100)
  });

  it("incumbent under the drop point → nearest free slot; incumbent untouched", () => {
    const rig = createFullRig();
    const container = rig.spawnBox({
      x: 300,
      y: 100,
      w: 200,
      h: 200,
      container: true,
      accepts: ["card"],
      selectable: false,
      movable: false,
    });
    // Incumbent child at container-local (30,30) 60×60 — the raw drop point
    // (50,50) crowds it (16px gutter). Seeded off the drag path world-wise.
    const incumbent = rig.spawnBox({ x: 30, y: 30, w: 60, h: 60, selectable: false, movable: false });
    rig.world.setRelation(incumbent, ChildOf, container);

    const card = dropCardAt395x180(rig);
    expect(rig.sink.intents).toHaveLength(1);
    const intent = rig.sink.intents[0];
    expect(intent?.kind).toBe("consume");
    const write = intent?.writes.find((w) => w.entity === card && w.component === Position);
    // Nearest edge-aligned candidate to (50,50): flush right of the
    // incumbent, top-aligned → (30+60+16, 30).
    expect(write?.value).toEqual({ x: 106, y: 30 });
    // Incumbents never move: no write may target the incumbent.
    expect(intent?.writes.some((w) => w.entity === incumbent)).toBe(false);
  });
});
