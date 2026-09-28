// @vitest-environment node
// THE TRAY'S DOOR for the bar (design-018 §5–§6; R2): the desk handle's `tray.category(id?)`, `categories()`, `anchor()` and
// `subscribe(listener)`, over the real layer on the fake device (`desk-mount.ts`), stepped as the sleeping loop steps it. The chips'
// model is the lay's; a category set through the door lays only its entries; the subscription hears each frame that moved what the
// bar is placed from — the slide frame by frame, open or shut, the category, the hand — and nothing at rest, open or shut.
import { Camera, specimensOf, trayEntity } from "@ice/core";
import { afterEach, describe, expect, it } from "vitest";
import { DRAWER } from "@ice/desk";
import { deskPalette, deskTheme } from "../src";
import { type DeskMount, mountDesk } from "./desk-mount";

let desk: DeskMount | undefined;
/** The frame these mounts step by: the slide spans ≈ 21 of them on any host (a count on the wall's clock raced the load — ci at load 125). */
const FRAME_MS = 16;
afterEach(() => { desk?.dispose(); desk = undefined; });

/** Step as a live loop does for `ms` of the frame clock — a 16 ms frame a step (the mounts here keep their own clock, `frameMs`), the
 *  tray's passes landing between steps — then to sleep. */
async function run(d: DeskMount, ms = 500): Promise<void> {
  for (let i = 0; i < Math.ceil(ms / FRAME_MS); i++) { d.step(); await new Promise((r) => setTimeout(r, 8)); }
  d.toSleep();
}

describe("the tray door (design-018 §5–§6)", () => {
  it("lists the six's categories and sets one — the drawer shows only its entries — falling back to all for an id no entry names", async () => {
    desk = await mountDesk(undefined, { frameMs: FRAME_MS });
    const door = desk.handle.tray;
    desk.toSleep();
    expect(door.categories()).toEqual([{ id: "paper", label: "Paper", count: 4 }, { id: "surfaces", label: "Surfaces", count: 2 }]);
    expect(door.category()).toBe("");
    expect(door.category("surfaces")).toBe("surfaces");
    door.open();
    await run(desk);
    expect(door.state().specimens.map((q) => q.type).sort()).toEqual(["desk.board", "desk.minimat"]);
    expect(door.anchor()).toMatchObject({ open: true, held: false, entries: 6, category: "surfaces", view: { width: 1200, height: 800 } });
    door.category("nope");
    await run(desk, 200);
    expect(door.category()).toBe("");
    // all six laid again — the world's specimens: at scroll 0 the second line hangs below this 800 px view (design-018 R4 laid the
    // first line under the drawer's header), so the drawn ones are the first line's four
    const tray = trayEntity(desk.ce.world);
    expect(tray === undefined ? 0 : specimensOf(desk.ce.world, tray).length).toBe(6);
    expect(door.state().specimens.length).toBe(4);
  });

  it("tells its listeners after each frame that moved the drawer as drawn — the slide frame by frame, up to its open top — and the category; never at rest, open or shut, nor for a frame that moved nothing it says (a pan); nothing once unsubscribed", async () => {
    desk = await mountDesk(undefined, { frameMs: FRAME_MS });
    const door = desk.handle.tray;
    desk.toSleep();
    const heard: { readonly y: number | undefined; readonly open: boolean; readonly category: string }[] = [];
    const off = door.subscribe(() => { const a = door.anchor(); heard.push({ y: a.drawer?.y, open: a.open, category: a.category }); });
    for (let i = 0; i < 30; i++) desk.step();   // shut, at rest: steps the loop would sleep through tell nothing
    expect(heard).toEqual([]);
    const f0 = desk.handle.perf().frames;
    desk.ce.world.setResource(Camera, { x: 40, y: 20, zoom: 1, gesturing: false });   // the desk pans under the still drawer: frames drawn,
    await run(desk, 100);                                                              // nothing the bar reads moved — nothing told
    expect(desk.handle.perf().frames).toBeGreaterThan(f0);
    expect(heard).toEqual([]);
    door.open();
    await run(desk);
    const slide = heard.map((h) => h.y ?? Number.NaN);
    expect(slide.length).toBeGreaterThan(15);   // the 340 ms slide is ≈ 21 frames of the mount's clock — 23 heard, the flip to open among them
    for (let i = 1; i < slide.length; i++) expect(slide[i] as number, `frame ${i}`).toBeLessThan(slide[i - 1] as number);   // rising, frame by frame
    const top = door.state().frame?.y;
    expect(heard.at(-1)).toEqual({ y: top, open: true, category: "" });
    const n = heard.length;
    for (let i = 0; i < 30; i++) desk.step();   // open, at rest: nothing
    expect(heard.length).toBe(n);
    door.category("paper");
    await run(desk, 100);
    expect(heard.length).toBe(n + 1);
    expect(heard.at(-1)).toEqual({ y: top, open: true, category: "paper" });
    off();
    door.close();
    await run(desk);
    expect(heard.length).toBe(n + 1);
  });

  it("design-018 R4: names the drawer's HEADER as drawn — the clear band under the edge's inside, where the bar lays its chips — and the theme's night, heard when the theme changes", async () => {
    desk = await mountDesk(undefined, { frameMs: FRAME_MS });
    const door = desk.handle.tray;
    desk.toSleep();
    door.open();
    await run(desk);
    const f = door.state().frame;
    expect(f?.head).toBe(DRAWER.arris + DRAWER.header);   // the pose seam's word to core: nothing picked above it
    expect(door.anchor().drawer).toEqual({ x: f?.x, y: f?.y, w: f?.w, p: 1, header: { y: (f?.y ?? 0) + DRAWER.arris, h: DRAWER.header } });
    expect(door.anchor().night).toBe(0);
    const nights: number[] = [];
    const off = door.subscribe(() => { nights.push(door.anchor().night); });
    desk.handle.setTheme(deskTheme("dark"), deskPalette("dark"));
    await run(desk, 100);
    expect(door.anchor().night).toBe(1);
    expect(nights.at(-1)).toBe(1);
    off();
  });

  it("says when an object is IN HAND — the menu has the view's foot — and is heard when it comes and goes", async () => {
    desk = await mountDesk(undefined, { frameMs: FRAME_MS });
    const door = desk.handle.tray;
    const book = desk.ce.ops.spawnWidget("desk.notebook", { x: 400, y: 200, undoable: false });
    desk.toSleep();
    const held: boolean[] = [];
    const off = door.subscribe(() => { held.push(door.anchor().held); });
    expect(door.anchor().held).toBe(false);
    desk.ce.ops.open(book);
    await run(desk);
    expect(door.anchor().held).toBe(true);
    expect(held.at(-1)).toBe(true);
    desk.ce.ops.putDown();
    await run(desk, 800);
    expect(door.anchor().held).toBe(false);
    expect(held.at(-1)).toBe(false);
    off();
  });
});
