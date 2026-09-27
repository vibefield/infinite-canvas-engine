// @vitest-environment node
// THE BUILDER AND AN INSERT GHOST (K5b; design-017 §9 — compose/builder.ts): a ghost core's `insertByDrag` spawned is in a hand from
// birth — BORN LIFTED and held lifted until it lands; while another presenter draws it (the tray's carry, `presented`) it is none of the
// root's rows yet its springs run; it leaves with NO delete fade (promoted, its twin takes its place; flown home, it has shrunk to
// nothing), and the twin a promotion projects in the same flush LANDS with its lift — a drop settles as any release does. Each with its
// control (a note spawned at rest; a deleted note, which fades).
import { createCanvasEngine, NO_MODS, Viewport, type Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder, DEFAULT_GRID } from "@ice/desk";
import { MiniMat, Note } from "../src";
import { PALETTE, PENS, SURFACES, THEMES, VINYLS } from "../oracle/fixtures/vf-theme";
import { paperKind } from "../src/paper/kind";
import { minimatKind } from "../src/minimat/kind";
import { must } from "../../desk/test/must";

const VP = { width: 1200, height: 800, dpr: 2 };
const CAM = { x: 0, y: 0, zoom: 1 };
const DT = 1 / 60;
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS };
const LOOKS = new Map<string, unknown>([["paper", must(paperKind().theme)(palette, "light")], ["minimat", must(minimatKind().theme)(palette, "light")]]);

function makeDesk() {
  const ce = createCanvasEngine({ widgets: [Note, MiniMat] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
  let now = 0;
  const builder = createDeskBuilder(ce.world, { objects: [Note, MiniMat] });
  let presented = new Set<Entity>();
  const build = () => { builder.changed(); return builder.build(CAM, VP, DT, THEMES.light, DEFAULT_GRID, LOOKS, presented.size > 0 ? { presented } : {}); };
  // a tick and the frame it paints, as the reflector does
  const step = (n = 1) => { let b = build(); for (let i = 0; i < n; i++) { now += 16; ce.step(now); b = build(); } return b; };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number) => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
    return step();
  };
  const keys = (b: ReturnType<typeof build>) => b.objects.map((o) => o.key);
  return { ce, world: ce.world, builder, build, step, mouse, keys, present: (s: Set<Entity>) => { presented = s; } };
}

describe("the desk builder · an insert ghost (K5b)", () => {
  it("is born lifted and held lifted until it lands (control: a note spawned at rest lies at 0)", () => {
    const d = makeDesk();
    const still = d.ce.ops.spawnWidget("desk.note", { x: 700, y: 300, props: { seed: 3 }, undoable: false });
    d.step(3);
    const ghost = d.ce.ops.insertByDrag("desk.note", { screenX: 300, screenY: 300 });
    d.step();   // no Grab yet (the claim is a move away) — lifted all the same
    expect(d.builder.fluxOf(ghost)?.lift).toBe(1);
    expect(d.builder.fluxOf(still)?.lift).toBe(0);
    d.mouse("move", 320, 300, 1);
    d.mouse("move", 340, 300, 1);
    expect(d.builder.fluxOf(ghost)?.lift).toBe(1);
  });

  it("while presented elsewhere it is none of the root's rows, its springs run on, and it rejoins at the lift it has", () => {
    const d = makeDesk();
    d.step(2);
    const ghost = d.ce.ops.insertByDrag("desk.note", { screenX: 300, screenY: 300 });
    let b = d.step();
    expect(d.keys(b)).toContain(ghost as number);
    d.present(new Set([ghost]));
    b = d.step();
    expect(d.keys(b)).not.toContain(ghost as number);
    expect(d.builder.geometryOf(ghost)).toBeUndefined();   // no marks, no pick
    d.present(new Set());
    b = d.step();
    expect(d.keys(b)).toContain(ghost as number);
    expect(d.builder.fluxOf(ghost)?.lift).toBe(1);
  });

  it("promoted, it leaves with no delete fade and its twin LANDS with its lift, then settles (control: a deleted note fades)", () => {
    const d = makeDesk();
    d.step(2);
    const ghost = d.ce.ops.insertByDrag("desk.note", { screenX: 300, screenY: 300 });
    d.step();
    d.mouse("move", 320, 300, 1);
    d.mouse("move", 360, 320, 1);
    d.mouse("move", 400, 340, 1);
    d.mouse("up", 400, 340, 0);
    let b = d.step(2);   // the commit tick, then the swap tick: the twin projected, the ghost reaped
    expect(d.world.isAlive(ghost)).toBe(false);
    expect(b.stats.ghosts).toBe(0);   // no delete fade of the ghost
    const twin = b.objects.find((o) => o.kind === "paper")?.key as Entity;
    expect(twin).toBeDefined();
    const lift = d.builder.fluxOf(twin)?.lift ?? 0;
    expect(lift).toBeGreaterThan(0.5);   // it lands from the hand's height (a few frames into its settle — a twin met cold would be 0)…
    for (let i = 0; i < 120 && d.builder.live(); i++) b = d.step();
    expect(d.builder.fluxOf(twin)?.lift).toBe(0);   // …and settles
    // control: a note deleted fades where it was
    d.ce.ops.setSelection([twin]);
    d.ce.ops.deleteSelection();
    b = d.step();
    expect(d.world.isAlive(twin)).toBe(false);
    expect(b.stats.ghosts).toBe(1);
  });

  it("flown home, it leaves with no delete fade (it has shrunk to nothing)", () => {
    const d = makeDesk();
    d.step(2);
    const ghost = d.ce.ops.insertByDrag("desk.note", { screenX: 300, screenY: 300, home: { x: 600, y: 700 } });
    d.step();
    d.mouse("move", 320, 300, 1);
    d.mouse("move", 360, 320, 1);
    d.ce.ops.cancelActiveGestures();
    let b = d.step();
    let fades = 0;
    for (let i = 0; i < 60 && d.world.isAlive(ghost); i++) { b = d.step(); fades = Math.max(fades, b.stats.ghosts); }
    expect(d.world.isAlive(ghost)).toBe(false);
    b = d.step();
    expect(Math.max(fades, b.stats.ghosts)).toBe(0);
  });
});
