// The NOTEBOOK from the world (design-015 §5–6; D3w): the Notebook object through `defineObject`; its world half
// = the Node oracle's own book (`notebookDraw`, its ring retired as a desk draws it — D4a) for every book scene (closed,
// open at a spread, held and tilted and selected, by night, over a note) and a selected closed book — PARITY BY
// CONSTRUCTION, the mesh to the last float; a still's pose a FLUX pin
// on the kind's state; the hit through the SAME desk eye the pass draws with; the ring's rule; the tilt into the
// carry's motion; the instant delete (a ghost's record never reaches the pass); the ruling's ink on the root pass; and (D3t-b)
// its pages' INK — the record's table and every page's raster the oracle's own for the same strokes, byte for byte.
import type { Entity } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BookPose, type Books, NotebookKind, notebookKind } from "../src/notebook/kind";
import { FLUX_REST, type ObjectContext, rectOf, type SlotContext, DEFAULT_GRID, objectKindOf, MAT_GRID, type DataChildren } from "@ice/desk";
import { NOTEBOOK } from "../src/notebook/law";
import type { NotebookDraw, NotebookPass } from "../src/notebook/pass";
import { Notebook, NOTEBOOK_TYPE } from "../src";
import { lampOf } from "../src/paper/paper";
import { BoardStroke, strokeRow } from "../src";
import { NOTEBOOK_LOOK, notebookRuleInk, PALETTE, PENS, THEMES } from "../../desk/oracle/fixtures/vf-theme";
import { notebookDraw } from "../../desk/oracle/frame.mjs";
import { BOOK_INK } from "../../desk/oracle/scenes.mjs";
import { fakeOracle, type OracleInternals, sceneOf } from "./oracle-fake";
import { must } from "../../desk/test/must";

const lamp = lampOf(MAT_GRID.plane);
const palette = { ...PALETTE.light, notebooks: { ...NOTEBOOK_LOOK, rule: notebookRuleInk()[3] }, pens: PENS };
const kind = notebookKind();
const look = must(kind.theme)(palette, "light");
const W = NOTEBOOK.cover.width;
const H = NOTEBOOK.cover.height;
type Book = { x: number; y: number; angle?: number; cover?: string; seed?: number; open?: boolean | number; left?: number; held?: boolean; tilt?: [number, number]; selected?: boolean; ruling?: string };
type Scene = { camX: number; camY: number; zoom: number; books?: Book[]; things?: (Book & { kind: string })[] };
const viewOf = (s: Scene) => ({ camX: s.camX, camY: s.camY, zoom: s.zoom, width: 1200, height: 800, dpr: 2 });
/** A book's context as the builder hands it — ring 0 selected or not: the kinds' own ring is retired, a selection is the desk's marks (D4a). */
const ctxOf = (b: Book, s: Scene, over: Partial<ObjectContext> = {}): ObjectContext => ({
  entity: 21 as Entity, rect: rectOf({ x: b.x - W / 2, y: b.y - H / 2 }, { w: W, h: H }),
  props: { title: "", cover: b.cover ?? "orbit", ruling: b.ruling ?? "dots", seed: b.seed ?? 7, spread: b.left ?? 0, angle: b.angle ?? 0 },
  flux: { ...FLUX_REST, lift: b.held ? 1 : 0, ring: 0 }, look, theme: THEMES.light, lamp, view: viewOf(s), grid: DEFAULT_GRID, dt: 1 / 60, ...over,
});
/** The still's pose a scene's book states, as a pin. */
const poseOf = (b: Book): BookPose | undefined => (b.open !== undefined || b.tilt !== undefined ? { ...(b.open !== undefined ? { open: b.open } : {}), ...(b.tilt !== undefined ? { tilt: b.tilt } : {}) } : undefined);
const booksOf = () => must(kind.local)({ pass: () => undefined }) as Books;

let oracle: OracleInternals;
let undoGpu: () => void;
beforeAll(async () => { const o = await fakeOracle(); oracle = o.desk; undoGpu = o.undo; });
afterAll(() => undoGpu());

describe("the Notebook object (design-015 §6)", () => {
  it("desk.notebook — title · cover · ruling · seed · spread · angle; the closed case 180 × 252; things, movable, selectable", () => {
    expect(Notebook.type).toBe(NOTEBOOK_TYPE);
    expect(objectKindOf(Notebook)?.name).toBe("notebook");
    expect(Notebook.defaultSize).toEqual({ w: 180, h: 252 });
    expect(Notebook.stratum).toBe("things");
    expect(Object.keys(Notebook.propToGroup).sort()).toEqual(["angle", "cover", "ruling", "seed", "spread", "title"]);
  });
});

describe("the notebook's world half = the oracle's `notebookDraw` (parity by construction)", () => {
  it("every book scene — closed, open at 30, held + tilted + selected, by night open at 10 in ink, over a note — and a selected closed book: the whole record as a desk draws it, the mesh to the last float", () => {
    const cases: { name: string; book: Book; scene: Scene }[] = [];
    for (const name of ["book-closed-z2.2", "book-open-z2.2", "book-held-z1.8", "book-night-z2.2"]) { const scene = sceneOf<Scene>(name); cases.push({ name, book: must(must(scene.books)[0]), scene }); }
    const over = sceneOf<Scene>("book-over-note-z1.6");
    cases.push({ name: "book-over-note-z1.6", book: must(must(over.things).find((t) => t.kind === "book")), scene: over });
    // selected and lying closed: the lab's own ring would be up (the prototype drew it) — the desk's is retired, on both sides
    const chosen: Book = { x: 0, y: 0, angle: 0, cover: "orbit", seed: 7, selected: true };
    expect((notebookDraw(chosen) as NotebookDraw).ring).toBe(1);
    cases.push({ name: "a selected closed book", book: chosen, scene: sceneOf<Scene>("book-closed-z2.2") });
    for (const { name, book, scene } of cases) {
      const books = booksOf();
      const pose = poseOf(book);
      if (pose !== undefined) books.pin(21 as Entity, pose);
      const ctx = ctxOf(book, scene, { local: books });
      const { id, mesh, ...mine } = kind.record(kind.resolve(ctx), ctx);
      const { id: theirs, mesh: oMesh, ...drawn } = oracle.bookOf(book) as NotebookDraw;
      expect(id, name).toBeGreaterThan(0);
      expect(theirs, name).toBeGreaterThan(0);
      expect(mine, name).toEqual(drawn);
      // the mesh, byte for byte over what was built (a deep equality over its typed arrays is slow under load)
      expect([mesh.vcount, mesh.icount, mesh.min, mesh.max], name).toEqual([oMesh.vcount, oMesh.icount, oMesh.min, oMesh.max]);
      const bytes = (a: Float32Array | Uint32Array, n: number) => Buffer.from(a.buffer, a.byteOffset, n * a.BYTES_PER_ELEMENT);
      expect(Buffer.compare(bytes(mesh.vertices, mesh.vcount * 16), bytes(oMesh.vertices, oMesh.vcount * 16)), name).toBe(0);
      expect(Buffer.compare(bytes(mesh.indices, mesh.icount), bytes(oMesh.indices, oMesh.icount)), name).toBe(0);
    }
  }, 30_000);

  it("the pose is a FLUX pin on the kind's state (never a Grab): pinned open it lies open; unpinned it closes on its spread", () => {
    const books = booksOf();
    const s = sceneOf<Scene>("book-open-z2.2");
    const b = must(must(s.books)[0]);
    books.pin(21 as Entity, { open: true });
    const open = kind.resolve(ctxOf(b, s, { local: books }));
    const openVerts = Array.from(open.mesh.vertices.subarray(0, open.mesh.vcount * 16));   // the writer is the book's, reused (the lab's): copy what it built
    expect(open.theta).toBe(Math.PI);
    expect(kind.resolve(ctxOf(b, s, { local: books })).version).toBe(open.version);   // the same pose: the mesh is kept
    books.pin(21 as Entity, undefined);
    const closed = kind.resolve(ctxOf(b, s, { local: books }));
    expect(closed.theta).toBe(0);
    expect(closed.pose.left).toBe(30);   // the spread is durable: 30 sheets lie on the left, under the closed cover
    expect(closed.version).toBe(open.version + 1);   // a new pose: one rebuild
    expect(Array.from(closed.mesh.vertices.subarray(0, closed.mesh.vcount * 16))).not.toEqual(openVerts);
  });

  it("hovered, a closed book rises the law's 3.5 (NOTEBOOK.md; Q-j: a hover is a rise); an open one does not", () => {
    const s = sceneOf<Scene>("book-closed-z2.2");
    const b = must(must(s.books)[0]);
    const rest = kind.resolve(ctxOf(b, s));
    const hovered = kind.resolve(ctxOf(b, s, { flux: { ...FLUX_REST, hover: 1 } }));
    expect((hovered.rigid.t[2] ?? 0) - (rest.rigid.t[2] ?? 0)).toBeCloseTo(NOTEBOOK.lift.hover, 12);
    const books = booksOf();
    books.pin(21 as Entity, { open: true });
    const a = kind.resolve(ctxOf(b, s, { local: books }));
    const c = kind.resolve(ctxOf(b, s, { local: books, flux: { ...FLUX_REST, hover: 1 } }));
    expect(c.rigid.t[2]).toBe(a.rigid.t[2]);
  });
});

describe("the notebook's mirror, ring, tilt, delete and ink", () => {
  const scene: Scene = { camX: -600, camY: -400, zoom: 1 };
  it("hit goes through the DESK EYE: a book lifted near the view's edge is picked where it is DRAWN, past its footprint", () => {
    const b: Book = { x: 450, y: 0 };
    const rest = kind.resolve(ctxOf(b, scene));
    const held = kind.resolve(ctxOf(b, scene, { flux: { ...FLUX_REST, lift: 1 } }));
    expect(kind.hit(rest, 450, 0)).toBe("content");
    // the eye stands over the view's centre (here the world origin), 1.15 view-diagonals up: the case's top face (17 up)
    // already reads ~5.6 units past its right edge lying down, and ~16 lifted 30 — so 10 past the edge is the lift's alone
    expect(kind.hit(rest, 450 + W / 2 + 4, 0)).toBe("content");
    expect(kind.hit(rest, 450 + W / 2 + 10, 0)).toBeNull();
    expect(kind.hit(held, 450 + W / 2 + 10, 0)).toBe("content");
    expect(kind.hit(rest, 450 + 400, 0)).toBeNull();
  });

  it("the ring: a selected book lying closed wears it; lifted or open, never", () => {
    const b: Book = { x: 0, y: 0 };
    const sel = { ...FLUX_REST, ring: 1 };
    expect(kind.resolve(ctxOf(b, scene, { flux: sel })).ring).toBe(1);
    expect(kind.resolve(ctxOf(b, scene, { flux: { ...sel, lift: 1 } })).ring).toBe(0);
    const books = booksOf();
    books.pin(21 as Entity, { open: true });
    expect(kind.resolve(ctxOf(b, scene, { flux: sel, local: books })).ring).toBe(0);
  });

  it("carried, it tilts into the motion — the leading edge dips (NOTEBOOK.md: per 0.00011, capped 0.11) — and levels when it stops", () => {
    const books = booksOf();
    const held = { ...FLUX_REST, lift: 1 };
    let x = 0;
    let G = kind.resolve(ctxOf({ x, y: 0 }, scene, { flux: held, local: books }));
    for (let i = 0; i < 20; i++) { x += 12; G = kind.resolve(ctxOf({ x, y: 0 }, scene, { flux: held, local: books })); }   // 720 u/s to the right
    const tilted = G.rigid;
    expect(tilted.r[2]).not.toBe(0);
    for (let i = 0; i < 120; i++) G = kind.resolve(ctxOf({ x, y: 0 }, scene, { flux: held, local: books }));
    expect(Math.abs(G.rigid.r[2] ?? 1)).toBeLessThan(1e-9);
  });

  it("a deleted book is gone at once (NOTEBOOK.md): its ghost's record never reaches the pass, and nothing is picked on it", () => {
    const seen: number[] = [];
    const stub = { prepare: (..._a: unknown[]) => { const records = _a[_a.length - 1] as NotebookDraw[]; seen.push(records.length); return 0; } };
    const k = new NotebookKind(stub as unknown as NotebookPass);
    k.ruleInk = [0, 0, 0, 0.5];
    const live = kind.record(kind.resolve(ctxOf({ x: 0, y: 0 }, scene)), ctxOf({ x: 0, y: 0 }, scene));
    const ghostCtx = ctxOf({ x: 300, y: 0 }, scene, { flux: { ...FLUX_REST, fade: 0.8 } });
    const ghostG = kind.resolve(ghostCtx);
    const ghost = kind.record(ghostG, ghostCtx);
    const slot = { view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 }, fadeIn: DEFAULT_GRID.fadeIn, cfg: DEFAULT_GRID.mat, frame: undefined, light: undefined, select: [0, 0, 1], present: undefined } as unknown as SlotContext;
    k.prepare({} as GPUCommandEncoder, slot, [ghost, live]);
    expect(seen).toEqual([1]);
    expect(kind.hit(ghostG, 300, 0)).toBeNull();
  });

  it("its pages' INK (D3t-b): a book open at spread 1 written on both faces, and one with a sheet mid-turn — the record's table and every page's raster = the oracle's (the kind's cache over the scene's strokes as the codec keeps them), byte for byte", () => {
    const rows = BOOK_INK.map((q) => strokeRow({ tool: "pen", ink: q.pen, page: q.page, points: q.points, times: q.times }));
    const children = { stamp: () => 1, rows: (_e: Entity, c: unknown) => (c === BoardStroke ? rows : []) } as unknown as DataChildren;
    const turn = { dir: 1 as const, phi: 0.8, psi: 1.35, twist: 0.12 };
    for (const pin of [{ open: true }, { open: true, turn }] as BookPose[]) {
      const pass = new NotebookKind({ uploadInk: () => {} } as unknown as NotebookPass);
      const books = must(kind.local)({ pass: () => pass, children }) as Books;
      books.pin(21 as Entity, pin);
      const b: Book = { x: 0, y: 0, angle: 0.08, left: 1 };
      const ctx = ctxOf(b, scene, { local: books });
      const mine = kind.record(kind.resolve(ctx), ctx);
      const theirs = oracle.bookOf({ x: 0, y: 0, angle: 0.08, cover: "orbit", seed: 7, left: 1, open: true, ink: BOOK_INK, ...(pin.turn !== undefined ? { turn } : {}) }) as NotebookDraw;
      // a fresh cache on both sides hands out the same layers; the oracle's is the scene's, so its second book here takes the LRU's next
      if (pin.turn === undefined) expect(mine.ink).toEqual(theirs.ink);
      else expect(mine.ink.pages).toEqual(theirs.ink.pages);
      // the spread's two faces (sheet 0's verso, sheet 1's recto); mid-turn, the sheet's two faces and the page it uncovers too
      expect([...mine.ink.pages].sort()).toEqual(pin.turn !== undefined ? [2, 3, 4, 5] : [2, 3]);
      for (const page of mine.ink.pages) {
        const a = must(books.pages.rasterOf(books.state(21 as Entity).id, page));
        const o = must(oracle.pages().rasterOf(theirs.id, page));
        expect(Buffer.compare(Buffer.from(a.bytes), Buffer.from(o.bytes)), `page ${page}`).toBe(0);
        expect(a.bytes.some((v, i) => i % 4 === 3 && v > 200), `page ${page} has ink`).toBe(true);
      }
    }
  });

  it("the ruling's ink is the product's: the palette's ink at its presence, set on the root pass by the kind's local; no palette, the host's mistake said", () => {
    const pass = new NotebookKind(null);
    const books = must(kind.local)({ pass: () => pass }) as Books;
    const ctx = ctxOf({ x: 0, y: 0 }, scene, { local: books });
    kind.record(kind.resolve(ctx), ctx);
    expect(pass.ruleInk).toEqual(notebookRuleInk());
    expect(look.covers.label?.paperCover).toBe(true);
    expect(() => kind.record(kind.resolve(ctxOf({ x: 0, y: 0 }, scene)), ctxOf({ x: 0, y: 0 }, scene, { look: must(kind.theme)(PALETTE.light, "light") }))).toThrow(/notebooks/);
  });
});
