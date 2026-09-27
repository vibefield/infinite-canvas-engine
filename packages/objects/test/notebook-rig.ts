// A NOTEBOOK IN HAND for the units (D3t-b): a real engine with the Notebook, its case centred at the desk's origin, its spread's
// centre (−90, 0) at the middle of the screen, one CSS px a unit (the pose seam's frame), the desk's camera over it (the eye the
// book is drawn and picked with). Each frame the hand follows the LAST build's geometry, then the build resolves and records the
// book — in hand while it is held (snapped open: a still of the pickup's end), on the desk once put down — as the layer runs them.
import { ChildOf, createCanvasEngine, defineQuery, type Entity, heldEntity, HeldPointer, LocalPointer, NO_MODS, Pointer, Viewport } from "@ice/core";
import { worldChildren } from "../../desk/src/compose/children";
import { type Books, type NotebookGeometry, NotebookKind, notebookKind, type NotebookObjectLook } from "../src/notebook/kind";
import { FLUX_REST, type ObjectContext, rectOf, DEFAULT_GRID, MAT_GRID } from "@ice/desk";
import { NOTEBOOK } from "../src/notebook/law";
import type { NotebookPass } from "../src/notebook/pass";
import { BoardStroke, createNotebookHand, Notebook } from "../src";
import { lampOf } from "../src/paper/paper";
import { NOTEBOOK_LOOK, notebookRuleInk, PALETTE, PENS, THEMES } from "../oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

const lamp = lampOf(MAT_GRID.plane);
const palette = { ...PALETTE.light, notebooks: { ...NOTEBOOK_LOOK, rule: notebookRuleInk()[3] }, pens: PENS };
export const kind = notebookKind();
export const look = must(kind.theme)(palette, "light") as NotebookObjectLook;
const W = NOTEBOOK.cover.width;
const H = NOTEBOOK.cover.height;
const pointerQ = defineQuery([Pointer, LocalPointer]);

export function bookRig(props: Record<string, unknown> = {}, vp: { readonly w: number; readonly h: number } = { w: 1200, h: 800 }, defer?: (fn: () => void) => void) {
  const ce = createCanvasEngine({ widgets: [Notebook] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: vp.w, h: vp.h, dpr: 1 });
  const book = ce.ops.spawnWidget("desk.notebook", { x: -W / 2, y: -H / 2, props: { seed: 7, ...props }, undoable: false });
  ce.world.sync();
  const sent: number[] = [];
  const pass = new NotebookKind({ uploadInk: (layer: number) => { sent.push(layer); } } as unknown as NotebookPass);
  const books = must(kind.local)({ pass: () => pass, children: worldChildren(ce.world) }) as Books;
  const spread = () => (ce.world.get(book, Notebook.groups[0]?.component as never) as { spread: number }).spread;
  const cx = vp.w / 2;
  const cy = vp.h / 2;
  const ctx = (inHand: boolean): ObjectContext => ({
    entity: book, rect: rectOf({ x: -W / 2, y: -H / 2 }, { w: W, h: H }), props: { title: "", cover: "orbit", ruling: "dots", seed: 7, spread: spread(), angle: 0 },
    flux: FLUX_REST, look, theme: THEMES.light, lamp, view: { camX: -90 - cx, camY: -cy, zoom: 1, width: vp.w, height: vp.h, dpr: 1 }, grid: DEFAULT_GRID, dt: 1 / 60,
    local: books, ...(inHand ? { held: { e: 1, open: true, grow: 1, snap: true } } : {}),
  });
  let G: NotebookGeometry | undefined;
  const build = (): void => { const c = ctx(heldEntity(ce.world) === book); G = kind.resolve(c); kind.record(G, c); };
  ce.stack.heldPose.current = {
    frame: (e) => (e === book ? { cx, cy, hx: 180, hy: 126, s: 1, settled: true } : undefined),
    part: (e, x, y) => (e === book && G !== undefined ? kind.hit(G, -90 + x, y) : null),
  };
  const hand = createNotebookHand({
    world: ce.world, docs: ce.docs, books: () => books, isBook: (e) => e === book, props: Notebook.groups[0]?.component,
    heldToWorld: (e, x, y) => (e === book ? [-90 + x, y] : undefined), geometryOf: (e) => (e === book ? G : undefined),
    ...(defer !== undefined ? { defer } : {}),
  });
  let now = 1000;
  /** A frame as the layer runs it: the tick, the hand, then the build; `settle` lets the hand's transactions land (microtasks). */
  const frame = (dt = 16): void => { now += dt; ce.step(now); hand.follow(now); build(); };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  /** A desk point → the screen (the spread's centre (−90, 0) is the screen's middle). */
  const screen = (x: number, y: number): readonly [number, number] => [cx + x + 90, cy + y];
  const strokes = () => ce.world.getReverse(book, ChildOf).map((k) => ce.world.get(k, BoardStroke)).filter((s) => s !== undefined);
  const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); ce.world.sync(); };
  const open = (): void => { frame(); ce.ops.open(book); build(); frame(); frame(); };
  const partUnder = () => ce.world.get(ce.world.firstOf(pointerQ) as Entity, HeldPointer)?.part;
  return { ce, book, books, hand, frame, mouse, screen, strokes, settle, open, sent, partUnder, geometry: () => must(G), spread };
}
