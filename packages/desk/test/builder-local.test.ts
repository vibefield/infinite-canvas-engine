// @vitest-environment node
// The builder threads a KIND'S OWN STATE (kinds/world.ts `KindLocal`, D2c): every context of the kind
// carries its desk's `local`, ghosts included, and the local is told when an entity is FORGOTTEN — its
// delete ghost faded, it died unseen, it left the frame — so what it held (a raster's rect) goes back.
// This is the fix for the page-slot leak D2a-world left: a note deleted and undone N times leaks nothing.
import { Active, createCanvasEngine, type Entity, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder } from "../src/compose/builder";
import { minimatKind, paperKind } from "../src/kinds";
import type { KindLocal } from "../src/kinds/world";
import { DEFAULT_GRID } from "../src/mat/grid";
import { MiniMat, Note } from "../src/objects";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { must } from "./must";

const VP = { width: 1200, height: 800, dpr: 2 };
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS };
const LOOKS = new Map<string, unknown>([["paper", must(paperKind().theme)(palette, "light")], ["minimat", must(minimatKind().theme)(palette, "light")]]);

/** A paper kind's local that records what it is handed and what it is told. */
function spyLocal() {
  const seen: Entity[] = [];
  const forgot: Entity[] = [];
  const local: KindLocal & { draw(e: Entity): object } = {
    draw(e) { seen.push(e); return {}; },
    forget(e) { forgot.push(e); },
  };
  return { local, seen, forgot };
}

function makeDesk() {
  const ce = createCanvasEngine({ widgets: [Note, MiniMat] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const spy = spyLocal();
  const builder = createDeskBuilder(ce.world, { objects: [Note, MiniMat], locals: new Map([["paper", spy.local]]) });
  const build = (cam = { x: 0, y: 0, zoom: 1 }, dt = 1 / 60) => { builder.changed(); return builder.build(cam, VP, dt, THEMES.light, DEFAULT_GRID, LOOKS); };
  const note = (cx: number, cy: number) => ce.ops.spawnWidget("desk.note", { x: cx - 100, y: cy - 100, props: { seed: 7 } });
  return { ce, world: ce.world, step, builder, build, note, spy };
}

describe("the desk builder · a kind's own state (D2c)", () => {
  it("every context of the kind carries its desk's local — the delete ghost's too — and a kind without one gets none", () => {
    const { step, build, note, spy, ce } = makeDesk();
    const a = note(300, 250);
    ce.ops.spawnWidget("desk.minimat", { x: 400, y: 300, w: 640, h: 480, props: { name: "Inbox" } });
    step(2);
    build();
    expect(spy.seen).toEqual([a]);   // the mini mat's kind has no local: nothing of it reaches the note's
    ce.ops.setSelection([a], "replace");
    ce.ops.deleteSelection();
    step();
    build();
    expect(spy.seen.at(-1)).toBe(a);   // the ghost fades through the same local
  });

  it("a deleted note is forgotten when its ghost has faded — not before; one that died unseen at once; one that left the frame at once", () => {
    const { world, step, build, note, spy, ce } = makeDesk();
    const a = note(300, 250);
    step(2);
    build();
    ce.ops.setSelection([a], "replace");
    ce.ops.deleteSelection();
    step();
    build(undefined, 0.1);
    expect(spy.forgot).toEqual([]);          // fading
    build(undefined, 0.2);                   // 300 ms > 220: gone
    expect(spy.forgot).toEqual([a]);
    // met but never drawn (culled far off the view): no ghost to wait for — forgotten on the journal's word
    const b = note(5000, 5000);
    step(2);
    build();
    ce.ops.setSelection([b], "replace");
    ce.ops.deleteSelection();
    step();
    build();
    expect(spy.forgot).toEqual([a, b]);
    // alive but gone from the frame (a nav cut's shape: no longer Active) — forgotten at once, never ghosted
    const c = note(900, 250);
    step(2);
    build();
    world.removeTag(c, Active);
    const f = build();
    expect(spy.forgot).toEqual([a, b, c]);
    expect(f.stats.ghosts).toBe(0);
  });
});
