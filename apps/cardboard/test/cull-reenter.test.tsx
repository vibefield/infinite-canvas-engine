/**
 * M6 exit criterion (c): cull ≠ unmount, with the REAL @ice/dom host reflector
 * (not the fake in the react spine test). Pan away → the card culls to a hidden
 * host but stays mounted; a doc edit WHILE hidden does NOT reach the frozen tree
 * (the card still shows the pre-hide title); pan back → a refresh render shows
 * the latest title AND the card's local UI state (collapsed) survived.
 */
import { Camera, type Component, type Entity, spawnWidget, widgets } from "@ice/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeRig, type Rig } from "./rig";
import "../src/todo-card";

const contentComponent = widgets.get("todo-card")?.groups.find((g) => g.name === "content")?.component as Component;

/** Write the whole content group directly to the doc (a background edit, not via the input). */
function editTitle(store: Rig["session"]["store"], e: Entity, title: string): void {
  store.transaction((tx) => {
    tx.edit(e).set(contentComponent, { title, items: "[]" } as never);
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("card-board M6 exit (c): cull freezes; re-enter refreshes; local state survives", () => {
  it("frozen while hidden, refreshed on re-enter, collapse state preserved", () => {
    const rig = makeRig();
    const e = spawnWidget(rig.session.store, rig.world, "todo-card", { x: 100, y: 100, props: { title: "T0" } });
    rig.step(4);
    rig.render();
    rig.step();
    expect(rig.title()?.value).toBe("T0");
    expect(rig.runtime.store.getSnapshot().length).toBe(1);

    // Visible edit → shown.
    editTitle(rig.session.store, e,"T1");
    rig.step();
    expect(rig.title()?.value).toBe("T1");

    // Local UI state: collapse the card.
    const collapseBtn = rig.container.querySelector("[data-collapse]") as HTMLButtonElement;
    rig.fireReact(collapseBtn, "click");
    expect(rig.card()?.getAttribute("data-collapsed")).toBe("true");

    // Pan far away → culled → hidden host, STILL mounted.
    rig.world.setResource(Camera, { x: 100_000, y: 100_000, zoom: 1, gesturing: false });
    rig.step(2);
    expect(rig.runtime.store.getSnapshot().length).toBe(1); // kept mounted
    expect(rig.runtime.store.getSnapshot()[0]?.hidden).toBe(true);
    expect(rig.card()).not.toBeNull();

    // Edit WHILE hidden → the frozen tree must not update.
    editTitle(rig.session.store, e,"T2");
    rig.step(2);
    expect(rig.title()?.value).toBe("T1"); // FROZEN — not T2
    expect(rig.card()?.getAttribute("data-collapsed")).toBe("true"); // local state intact

    // Pan back → refresh render shows the latest; collapse still set.
    rig.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    rig.step(2);
    expect(rig.title()?.value).toBe("T2"); // refreshed on re-enter
    expect(rig.card()?.getAttribute("data-collapsed")).toBe("true"); // preserved local state
  });
});
