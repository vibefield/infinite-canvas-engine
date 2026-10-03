// @vitest-environment node
// THE REFERENCE KINDS' WORDS IN HAND (petition I22 — MC-D9's readouts), over the real layer on the fake device (`desk-mount.ts`), stepped
// as the sleeping loop steps it: a notebook picked up says "Page 1"; turned through its held tool (the bar's ›) it says "Page 2" no later
// than the frame the document's spread says 1 — whoever listens to the selection never hears a word behind the fact; the desk calendar
// says its month's name, and stepped by its bar's › the next month's in the first frame after the act commits.
import { afterEach, describe, expect, it } from "vitest";
import { type Entity, widgets } from "@ice/core";
import { type DeskMount, mountDesk } from "./desk-mount";

let desk: DeskMount | undefined;
afterEach(() => { desk?.dispose(); desk = undefined; });

/** An object's props as the world holds them now (its type's groups, flat). */
function propsOf(d: DeskMount, e: Entity, type: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const g of widgets.get(type)?.groups ?? []) Object.assign(props, (d.ce.world.get(e, g.component) as Record<string, unknown> | undefined) ?? {});
  return props;
}

describe("the reference kinds' words in hand (petition I22)", () => {
  it("a notebook says the page it is open at: Page 1 at the pickup, Page 2 once its › turns — heard no later than the frame the document's spread says it", async () => {
    desk = await mountDesk(undefined, { frameMs: 16 });
    const d = desk;
    const book = d.ce.ops.spawnWidget("desk.notebook", { x: 400, y: 200, undoable: false });
    d.toSleep();
    d.ce.ops.open(book);
    d.toSleep();
    expect(d.handle.selection.anchor().held?.readout).toBe("Page 1");
    let heard = d.handle.selection.anchor().held?.readout;
    const off = d.handle.selection.subscribe(() => { heard = d.handle.selection.anchor().held?.readout; });
    expect(d.ce.ops.useHeldTool("turn:1")).toBe(true);
    let landed = -1;
    for (let i = 0; i < 120 && landed < 0; i++) {
      d.step();
      await Promise.resolve();   // the turn's transaction is deferred out of the frame (a microtask): it lands here
      if (propsOf(d, book, "desk.notebook").spread === 1) { landed = i; expect(heard, `frame ${i}`).toBe("Page 2"); }
    }
    expect(landed).toBeGreaterThanOrEqual(0);
    d.toSleep();
    expect(heard).toBe("Page 2");
    expect(d.handle.selection.anchor().held?.readout).toBe("Page 2");
    off();
  });

  it("a desk calendar says its month by name; its › steps it — the next month's name heard in the first frame after the act commits", async () => {
    desk = await mountDesk(undefined, { frameMs: 16 });
    const d = desk;
    const pad = d.ce.ops.spawnWidget("desk.calendar", { x: 400, y: 200, props: { month: "2026-09" }, undoable: false });
    d.toSleep();
    d.ce.ops.open(pad);
    d.toSleep();
    expect(d.handle.selection.anchor().held?.readout).toBe("September");
    const heard: (string | undefined)[] = [];
    const off = d.handle.selection.subscribe(() => { heard.push(d.handle.selection.anchor().held?.readout); });
    expect(d.ce.ops.useHeldTool("month:1")).toBe(true);
    expect(propsOf(d, pad, "desk.calendar").month).toBe("2026-10");   // the act committed in the op
    d.step();
    expect(heard).toEqual(["October"]);
    off();
  });
});
