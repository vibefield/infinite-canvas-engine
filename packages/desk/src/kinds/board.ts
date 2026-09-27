// The WHITEBOARD (BOARD.md) as a kind (kind.ts): the board pass behind the registry's door — a
// thin adapter, the pass and its WGSL as they were. Stratum `things`: a board lies among the
// desk's other things in the desk's own order (a note can sit on a board). Its `prepare` still
// sends the queued stamps and the drying in submits of its own BEFORE the frame's (BOARD.md), and
// takes no lamp — as the ground always called it. A spawned slot's pass copies the root's look
// every frame (`tune` → the pass's `copy`).
//
// And its WORLD half (kinds/world.ts; D3w): `boardKind` — an entity of the board's widget type becomes a
// `BoardInstance` through the prototype's own laws: `resolveBoard` on the rect and the flux (lift ← `Grab`,
// the 12-unit rise and ×1.03 of BOARD.md; ring ← `Selected`; fade ← a ghost — a board never rises under the
// pointer: BOARD.md's hover is the cursor's), the capped marker lying where a hand put it down (the bench's
// `poseOf` at rest), `pickBoard` the mirror (the melamine `content`, the aluminium `frame`). Its INK is a
// cache of its data children (board/data.ts — strokes and wipes as entities `ChildOf` the board, D-D5): the
// kind's own state on each desk (`local()` → `BoardInk`) holds each board's raster on the root pass and
// REPLAYS the children into it when the board is first met, when the children's stamp turns over (a stroke
// laid, undone, redone, a remote peer's) or when the look changes. The materials and the markers' inks are
// the product's (the theme gate): `theme()` takes them from the palette.

import { BoardPass } from "../board/board-pass";
import { type BoardGeometry, type BoardLaw, DEFAULT_BOARD_LAW, pickBoard, quadOf, resolveBoard, surfaceSize } from "../board/board";
import { addStroke, BoardStroke, boardOps, feedStroke, MARKERS, type MarkerInk, strokePen, type StrokeRow, strokeSeed, type StrokeSpec } from "../board/data";
import type { BoardInstance } from "../board/layout";
import { followHand, penAtRest, penPose, type PenState, stepPen } from "../board/pen";
import { BOARD_SHADER_FILES, boardShaders } from "../board/shaders";
import { type StrokeBuilder, TIP_NAMES, type TipName } from "../board/stroke";
import type { KindExtra, KindPass, KindProgram, SlotContext } from "../kind";
import type { MarkFrame } from "../marks/layout";
import type { MatPass } from "../kit/view";
import { type ShaderText, shaderText } from "../shaders";
import { type Palette, type RGB, rgb, type ThemeName, type TokenRef } from "../theme";
import { BOARD } from "../board/theme";
import { ChildOf, defineQuery, type Entity, HeldPress, type HeldToolDef, LocalPointer, Pointer, type World } from "@ice/core";
import { type KindHost, type KindLocal, type ObjectContext, type ObjectHit, type ObjectKind, stringProp } from "./world";

/** The whiteboard's kind name — its key in the registry and in every slot's `objects`. */
export const BOARD_KIND = "board";

export class BoardKind implements KindPass<BoardInstance> {
  /** The board pass itself: a host's door to the rasters (`ensure`, `lay`, `commit`, `replay`, `dry`) and the look (`look`, `chain`). */
  readonly pass: BoardPass;
  constructor(pass: BoardPass) { this.pass = pass; }

  spawn(mat: MatPass): BoardKind { return new BoardKind(this.pass.spawn(mat)); }

  tune(root: KindPass<BoardInstance>): void { if (root instanceof BoardKind) this.pass.copy(root.pass); }

  /** The pass's own `prepare`, argument for argument: the slot's camera, grid, clocks, the objects' presence, the light and the theme (its ring's colour) — and the records' keys (D6). */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly BoardInstance[], extra?: KindExtra): number {
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.theme, extra?.keys);
  }

  dropped(): number { return this.pass.dropped; }

  /** Records [first, end) — a board whose raster is missing draws nothing (the pass counts in the list it was handed). */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }
  records() { return this.pass.records; }

  dispose(): void { this.pass.dispose(); }
}

/** The whiteboard's program for a host's shader text: its passes made on the root's mat. */
export function boardProgram(text: ShaderText): KindProgram<BoardInstance> {
  return {
    name: BOARD_KIND,
    stratum: "things",
    create: async (device, format, mat) => new BoardKind(await BoardPass.create(device, format, boardShaders(text(BOARD_SHADER_FILES)), mat)),
  };
}

/** The whiteboard's silhouette for the desk's marks (D4a): its aluminium frame's outside as drawn, square to the mat. */
export function boardFrame(G: BoardGeometry): MarkFrame {
  return { cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: 0, r: G.radius };
}

// ---------------------------------------------------------------- the world half (D3w)

/**
 * What the board's kind takes from the host's palette: its materials (BOARD.md — the melamine, the anodised frame, the
 * marker's barrel, the eraser's felt and wooden back) and the dry-erase markers by name, each an ink and the coverage one
 * pass lays. The product's (the theme gate), never the engine's.
 */
export interface BoardPalette extends Palette {
  readonly board?: { readonly surface: TokenRef; readonly frame: TokenRef; readonly barrel: TokenRef; readonly felt: TokenRef; readonly wood: TokenRef };
  readonly markers?: Readonly<Record<string, TokenRef & { readonly opacity: number }>>;
}

/** The board's look for a theme, parsed: the melamine and the frame a record takes, the pen's materials the pass takes, the markers' inks the replay takes, and each marker's CSS the held bar's swatch shows (by tool id). */
export interface BoardObjectLook {
  readonly surface: RGB;
  readonly metal: RGB;
  readonly pen: { readonly barrel: RGB; readonly felt: RGB; readonly wood: RGB };
  readonly markers: Readonly<Record<string, MarkerInk>>;
  readonly swatches: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------- the tools in hand (design-015 §8; D3t-a)

/** A marker's tool id in the held bar ("marker:blue"); the eraser's is `ERASER_TOOL_ID`. */
export const markerToolId = (ink: string): string => `marker:${ink}`;
export const ERASER_TOOL_ID = "eraser";
/** The ink a tool id names, or undefined (the eraser, anything else). */
export const inkOfTool = (id: string): string | undefined => (id.startsWith("marker:") ? id.slice(7) : undefined);

const heldPressesQ = defineQuery([Pointer, LocalPointer, HeldPress]);
/** A stroke is in hand (a local pointer's press is the tool's): the history waits for it to land (BOARD.md §5 — the bench's `!this.open?.stroke`). */
export function inking(world: World): boolean {
  let yes = false;
  world.query(heldPressesQ).each((b) => { for (const r of b) if (world.read(b.entity(r), HeldPress).kind === "tool") yes = true; });
  return yes;
}

/** Is there ink on board `e` — a stroke (the eraser's too: it may leave a ghost) after its last wipe? */
export function boardInked(world: World, e: Entity): boolean {
  let inked = false;
  for (const k of world.getReverse(e, ChildOf)) {
    const s = world.get(k, BoardStroke);
    if (s === undefined) continue;
    inked = s.tool !== "wipe";
  }
  return inked;
}

const title = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/**
 * The whiteboard's tools in hand (BOARD.md §5, *Marks on the Mat*'s contract: "four markers, eraser, undo, redo"; the tray merged
 * into the held bar, Q-o): the four markers (`1`–`4`) and the eraser (`e`, a toggle — chosen again, the marker it took over from
 * comes back) are MODES — core's `HeldTool`, the user's fact — whose cursor is none over the melamine (the pen draws itself);
 * undo and redo are the DOCUMENT's history (a stroke is one transaction, D-D5) and wait for a stroke in hand to land; on keys
 * alone, the tip (`t`: fine → bullet → chisel, the capped marker's durable `tip`) and the wipe (⌘⌫, one transaction — itself
 * undoable, as the bench's was). The pen's own state is written off the undo stack: ⌘Z undoes ink, never a pick of the pen.
 */
export const BOARD_TOOLS: readonly HeldToolDef[] = [
  ...MARKERS.map((ink, i): HeldToolDef => ({ id: markerToolId(ink), label: `${title(ink)} marker`, kind: "mode", keys: [String(i + 1)], hint: String(i + 1), glyph: "pen", cursor: "none" })),
  { id: ERASER_TOOL_ID, label: "Eraser", kind: "mode", keys: ["e"], hint: "E", glyph: "eraser", toggle: true, cursor: "none" },
  { id: "undo", label: "Undo", kind: "action", keys: ["mod+z"], hint: "⌘Z", glyph: "undo", run: (api) => { if (!inking(api.world)) api.undo(); } },
  { id: "redo", label: "Redo", kind: "action", keys: ["mod+shift+z", "mod+y"], hint: "⇧⌘Z", glyph: "redo", run: (api) => { if (!inking(api.world)) api.redo(); } },
  {
    id: "tip", label: "Tip", kind: "action", keys: ["t"], hint: "T", bar: false,
    run: (api) => {
      const cur = stringProp(api.props(), "tip", "bullet") as TipName;
      api.setProps({ tip: TIP_NAMES[(Math.max(TIP_NAMES.indexOf(cur), 0) + 1) % TIP_NAMES.length] }, { undoable: false });
    },
  },
  {
    id: "wipe", label: "Wipe the board", kind: "action", keys: ["mod+Backspace", "mod+Delete"], hint: "⌘⌫", bar: false,
    run: (api) => { if (!inking(api.world) && boardInked(api.world, api.entity)) api.transact((tx) => { addStroke(tx, api.entity, { tool: "wipe" }); }); },
  },
];

/**
 * A board at rest as the bench draws it (`BoardDesk.instances` + `poseOf` with no board open), all but its raster: THE
 * marker lying where a hand put it down — the pen's flux at rest (board/pen.ts: every hand term at e = 0, kept as the bench
 * computes them) —, the world rect the fragment may paint (the board, its shadow, the pen's box), the eye straight over it
 * (the parallax at rest).
 */
export function boardRest(G: BoardGeometry, w: number, h: number, tip: TipName, capInk: RGB, look: BoardObjectLook, law: BoardLaw = DEFAULT_BOARD_LAW): Omit<BoardInstance, "id"> {
  return boardPose(G, w, h, tip, capInk, look, penAtRest(), null, law);
}

/**
 * A board as drawn with its pen in whatever pose its flux has reached (D3t-a — board/pen.ts `penPose`): lying, taken up, in the
 * hand at `at` (a desk point), the eraser rubbing there; the quad grown to take in both. At rest it is `boardRest`, byte for byte.
 */
export function boardPose(G: BoardGeometry, w: number, h: number, tip: TipName, ink: RGB, look: BoardObjectLook, pen: PenState, at: readonly [number, number] | null, law: BoardLaw = DEFAULT_BOARD_LAW): Omit<BoardInstance, "id"> {
  const pose = penPose(G, w, h, tip, ink, pen, at);
  const par = [0, 0] as const;
  const k = BOARD.surface.parallax;
  return {
    geometry: G, surface: look.surface, metal: look.metal, quad: quadOf(G, pose.box, law), sheen: [par[0] * k * 5, -par[1] * k * 5], pen: pose.pen,
    ...(pose.eraser !== undefined ? { eraser: pose.eraser } : {}),
  };
}

/**
 * How far a board's drawing reaches past its rect, world units: the slab's shadow at full lift, or the resting pen's box
 * (it lies near the bottom edge and its box is wide), whichever is further; the held scale.
 */
export function boardReach(law: BoardLaw = DEFAULT_BOARD_LAW): number {
  const P = BOARD.pen;
  const top = law.lift.height + law.spec.thick;
  const shadow = law.shadow.slopeMax * top + 2.5 * (law.shadow.penumbra.sigma0 + law.shadow.penumbra.sigmaPerHeight * top);
  const pen = P.length * 1.3 + 60 + law.shadow.slopeMax * (P.radius + P.length * P.rise + 12);
  const held = (Math.max(law.spec.width, law.spec.height) * (law.lift.scale - 1)) / 2;
  return Math.max(shadow, pen) + held;
}

/** What the hand is doing over a board in hand this frame, as the pen driver (objects/pen.ts) reads the world: where (a desk point), over the melamine or not, laying a stroke or not, with which tool and ink, and the pointer on screen (its velocity leans the pen). */
export interface PenHand {
  readonly at: readonly [number, number] | null;
  readonly over: boolean;
  readonly pressing: boolean;
  readonly erasing: boolean;
  /** The ink in hand (the marker's, or the one it lies down in while the eraser rubs); absent = the capped marker's. */
  readonly ink?: string;
  /** The pointer on screen, CSS px, and the clock (ms) it was read at. */
  readonly screen?: readonly [number, number];
  readonly t?: number;
}

/** A still's pen (a pinned hand): its desk point, pressed or hovering, the eraser or the marker, the ink. */
export interface PenPin {
  readonly x: number;
  readonly y: number;
  readonly press?: boolean;
  readonly erase?: boolean;
  readonly ink?: string;
}

/**
 * The board's own state on one desk: each board's raster on the root pass, a cache of its strokes — and (D3t-a) what the hand
 * does to it in hand: the stroke laid LIVE into its stroke layer, committed WET and drying, its entity adopted when it lands
 * rather than replayed; the pen's flux and the hand it follows.
 */
export interface BoardInk extends KindLocal {
  /**
   * The raster board `e` draws with (its id on the pass): made the first time, its children REPLAYED into it whenever
   * their stamp turned over or the look changed — unless the turnover is the stroke the hand just committed (adopted: the
   * raster holds it already, wet) —; a stroke in hand is laid again over a replay; a fading ghost keeps what it had. 0 before
   * the pass is here.
   */
  raster(e: Entity, G: BoardGeometry, look: BoardObjectLook, ghost: boolean): number;
  /** How many replays since the desk was made (a rig's witness). */
  replays(): number;
  /** Board `e`'s raster on the pass (`BoardPass.readInk` reads it — a rig's witness); undefined before it is met. */
  rasterOf(e: Entity): number | undefined;
  /** The stroke in hand on `e`: the builder's stamps since the last call into the stroke layer (sent at the next prepare). */
  lay(e: Entity, builder: StrokeBuilder): void;
  /** The lift: the stroke in hand laid into the ink and marked WET; its entity (its cell's `points`) is adopted when it lands. */
  commit(e: Entity, points: string): void;
  /** A stroke in hand abandoned (or its transaction refused): its stamps dropped, the raster replayed from the children. */
  cancel(e: Entity): void;
  /** The stroke being laid on `e` — its ink (LINEAR) and whether it erases — for the record; undefined when none. */
  laying(e: Entity): { readonly color: RGB; readonly erase: boolean } | undefined;
  /** The hand over board `e` this frame (the pen driver's word). */
  hand(e: Entity, h: PenHand): void;
  /** Pin the hand for a still (`undefined` unpins): the pen sits where the pin says, its springs snapped. */
  pinPen(e: Entity, pin: PenPin | undefined): void;
  /** The pen's flux of board `e` (a rig's witness). */
  penOf(e: Entity): PenState | undefined;
  /** The world half's: the hand over `e` as the record reads it (the pin's, else the driver's), and the pen's flux. */
  handFor(e: Entity): { readonly hand: PenHand | undefined; readonly pen: PenState; readonly pinned: boolean };
  /** A pen still moving (the record says so): the next tick asks a frame. */
  moving(e: Entity): void;
  /**
   * A STILL's ink on board `e` (a rig's door — the oracle's `wet`/`live` board, D3t-a): after its children replayed, `wet` laid
   * LIVE and committed wet, then `live` mid-draw — its first `upto` samples in the stroke layer, the pen never lifted — each at the
   * seed of the op it would be. False before the board's raster is here.
   */
  sketch(e: Entity, s: { readonly wet?: StrokeSpec; readonly live?: StrokeSpec & { readonly upto: number } }): boolean;
  /** Hold the ink still (a still): no drying, no frame asked for a stroke in hand. */
  pinStill(on: boolean): void;
}

interface BoardState {
  readonly id: number;
  stamp: number;
  look: BoardObjectLook | null;
  /** The stroke in hand: its tool and builder (laid again over a replay). */
  live: { readonly builder: StrokeBuilder } | null;
  /** The committed stroke's `points` whose landing is adopted, not replayed. */
  adopt: string | null;
  pen: PenState;
  hand: PenHand | undefined;
  pin: PenPin | undefined;
}

/** The board's `local()`: rasters by entity, released when the builder forgets a board. */
export function createBoardInk(host: KindHost): BoardInk {
  const boards = new Map<Entity, BoardState>();
  let next = 1;
  let replays = 0;
  let last = -1;
  let penMoving = false;
  let still = false;
  const passOf = (): BoardPass | undefined => { const k = host.pass(); return k instanceof BoardKind ? k.pass : undefined; };
  const stampOf = (e: Entity): number => host.children?.stamp(e) ?? 0;
  const drawn = host.drawn;
  // THE BUDGET (D6): a board's raster is a cache of its strokes — charged when made (its ink with its mips, its stroke and wet layers),
  // let go when the ledger evicts it (it replays from its children when next drawn: `stamp` −1), kept while the board is on screen
  const budget = host.budget;
  const entityOf = new Map<string, Entity>();
  /** What has LANDED on each object, counted (D7 — `KindLocal.landed`): the held desk copy is made again when a desk object's moves. */
  const landedOf = new Map<Entity, number>();
  const land = (e: Entity): void => { landedOf.set(e, (landedOf.get(e) ?? 0) + 1); };
  const rasterBytes = (size: readonly [number, number]): number => Math.round(size[0] * size[1] * (4 * (4 / 3) + 1 + 1));
  const state = (e: Entity): BoardState => {
    let st = boards.get(e);
    if (st === undefined) { st = { id: next++, stamp: -1, look: null, live: null, adopt: null, pen: penAtRest(), hand: undefined, pin: undefined }; boards.set(e, st); }
    return st;
  };
  return {
    raster(e, G, look, ghost) {
      const pass = passOf();
      if (pass === undefined) return 0;
      const st = state(e);
      if (pass.look !== look.pen) pass.look = look.pen;   // the pen's materials: the product's, set on the root (a spawned slot copies them)
      if (ghost) return st.id;   // a board fading out keeps its ink: its children died with it
      const stamp = stampOf(e);
      const made = pass.ensure(st.id, surfaceSize(G));
      if (made && budget !== undefined) {
        const key = String(st.id);
        entityOf.set(key, e);
        const size = pass.sizeOf(st.id);
        budget.charge("board", key, size === null ? 0 : rasterBytes(size), () => { passOf()?.release(st.id); st.stamp = -1; entityOf.delete(key); });
      } else budget?.touch("board", String(st.id));
      if (made || stamp !== st.stamp || look !== st.look) {
        const rows: readonly StrokeRow[] = host.children?.rows(e, BoardStroke) ?? [];
        // the stroke the hand just committed has landed as its entity: the raster holds it already — WET — so it is adopted
        const landed = !made && look === st.look && st.adopt !== null && rows[rows.length - 1]?.points === st.adopt;
        st.adopt = null;
        if (!landed) {
          pass.replay(st.id, boardOps(rows, look.markers));
          land(e);
          replays += 1;
          if (st.live !== null) pass.lay(st.id, st.live.builder.tool, st.live.builder.stamps());   // the stroke in hand, laid again over the replay
        }
        st.stamp = stamp;
        st.look = look;
      }
      return st.id;
    },
    lay(e, builder) {
      const st = state(e);
      st.live = { builder };
      const stamps = builder.pending();
      if (stamps.length > 0) passOf()?.lay(st.id, builder.tool, stamps);
    },
    commit(e, points) {
      const st = state(e);
      const live = st.live;
      st.live = null;
      if (live === null) return;
      const pass = passOf();
      const stamps = live.builder.pending();
      if (stamps.length > 0) pass?.lay(st.id, live.builder.tool, stamps);
      pass?.commit(st.id, live.builder.tool);
      st.adopt = points;
    },
    cancel(e) {
      const st = boards.get(e);
      if (st === undefined) return;
      st.live = null;
      st.adopt = null;
      passOf()?.cancel(st.id);
      st.stamp = -1;   // replayed from the children at the next record
    },
    laying(e) {
      const b = boards.get(e)?.live?.builder;
      return b === undefined ? undefined : { color: b.tool.color, erase: b.tool.mode === "erase" };
    },
    hand(e, h) {
      const st = state(e);
      const prev = st.hand;
      if (prev?.screen !== undefined && h.screen !== undefined && prev.t !== undefined && h.t !== undefined) followHand(st.pen, h.screen[0] - prev.screen[0], h.screen[1] - prev.screen[1], (h.t - prev.t) / 1000);
      st.hand = h;
    },
    pinPen(e, pin) { state(e).pin = pin; penMoving = true; },
    penOf: (e) => boards.get(e)?.pen,
    handFor(e) {
      const st = state(e);
      const p = st.pin;
      if (p === undefined) return { hand: st.hand, pen: st.pen, pinned: false };
      const ink = p.ink ?? st.hand?.ink;
      return { hand: { at: [p.x, p.y], over: true, pressing: p.press === true, erasing: p.erase === true, ...(ink !== undefined ? { ink } : {}) }, pen: st.pen, pinned: true };
    },
    sketch(e, s) {
      const pass = passOf();
      const st = boards.get(e);
      const look = st?.look;
      if (pass === undefined || st === undefined || look === null || look === undefined || st.stamp === -1) return false;
      let n = host.children?.rows(e, BoardStroke).length ?? 0;
      const lay = (spec: StrokeSpec, upto?: number): StrokeBuilder | undefined => {
        const b = strokePen(spec, look.markers, spec.seed !== undefined && spec.seed >= 0 ? spec.seed : strokeSeed(n));   // the row's own seed (v4), else the position's
        if (b === undefined) return undefined;
        const points = spec.points ?? [];
        feedStroke(b, points, spec.times !== undefined && spec.times.length === points.length ? spec.times : null, spec.speed ?? 400, upto);
        pass.lay(st.id, b.tool, b.pending());
        n += 1;
        return b;
      };
      if (s.wet !== undefined) { const b = lay(s.wet); if (b !== undefined) pass.commit(st.id, b.tool); }
      if (s.live !== undefined) { const b = lay(s.live, s.live.upto); if (b !== undefined) st.live = { builder: b }; }
      return true;
    },
    pinStill(on) { still = on; },
    moving() { penMoving = true; },
    landed: (e) => landedOf.get(e) ?? 0,
    tick(now) {
      const dt = last < 0 ? 0 : Math.min(Math.max((now - last) / 1000, 0), 0.25);
      last = now;
      const pass = passOf();
      if (!still) pass?.dry(dt);   // fresh ink dries (the wet layer fades) on the frame's clock — a still holds it
      let want = penMoving || (!still && pass?.wetting === true);
      penMoving = false;
      for (const [e, st] of boards) {
        if (st.live !== null && !still) want = true;   // a stroke in hand: its stamps (a resting pen's bleed) go out every frame
        // a stroke laid or undone: a frame to replay in — for a board that is DRAWN (D6; the builder's word when it gives one): a
        // board off screen replays when it comes back (its record is made afresh then) and its stale stamp keeps nothing awake
        // (D-D3t-b.11's latent keep-awake)
        else if (st.stamp !== -1 && (drawn === undefined || drawn(e) !== undefined) && stampOf(e) !== st.stamp) want = true;
      }
      return want;
    },
    /** The budget's ask (D6): a board's raster is kept while the board is drawn — the builder's word, else while it is met at all. */
    keeps(key) {
      const e = entityOf.get(key);
      if (e === undefined) return false;
      return drawn === undefined ? boards.has(e) : drawn(e) !== undefined;
    },
    forget(e) {
      const st = boards.get(e);
      if (st === undefined) return;
      passOf()?.release(st.id);
      budget?.release("board", String(st.id));
      entityOf.delete(String(st.id));
      landedOf.delete(e);
      boards.delete(e);
    },
    dispose() {
      const pass = passOf();
      for (const st of boards.values()) { pass?.release(st.id); budget?.release("board", String(st.id)); }
      boards.clear();
      entityOf.clear();
    },
    replays: () => replays,
    rasterOf: (e) => boards.get(e)?.id,
  };
}

export interface BoardKindOptions {
  /** The host's shader text; the generated module unless a host says. */
  readonly text?: ShaderText;
  /** The board's numbers (theme.ts `BOARD`) — the engine's unless a host tweaks them. */
  readonly law?: BoardLaw;
}

/** The whiteboard's kind, whole (kinds/world.ts `ObjectKind`): the program, and the world half on the bench's laws. */
export function boardKind(opts: BoardKindOptions = {}): ObjectKind<BoardGeometry, BoardInstance, BoardObjectLook> {
  const law = opts.law ?? DEFAULT_BOARD_LAW;
  const program = boardProgram(opts.text ?? shaderText);
  const parse = (t: TokenRef | undefined): RGB | undefined => (t === undefined ? undefined : rgb(t.css));
  return {
    ...program,
    reach: boardReach(law),
    local: (host: KindHost): BoardInk => createBoardInk(host),
    // THE OPENING (design-015 §8, D4b): the board's face comes to the hand whole, flat under the pose's camera; its tools (D3t-a,
    // `BOARD_TOOLS` — the tray merged into the bar, Q-o) with the marker in the ink it lies in taken into the hand
    open: {
      extent: (c) => c.rect,
      tools: BOARD_TOOLS,
      tool: (props) => markerToolId(stringProp(props, "cap", "black")),
      swatches: (look) => (look as BoardObjectLook).swatches,
    },
    resolve(ctx: ObjectContext): BoardGeometry {
      const r = ctx.rect;
      return resolveBoard({ cx: r.cx, cy: r.cy, w: r.w, h: r.h }, { held: ctx.flux.lift, ring: ctx.flux.ring, fade: ctx.flux.fade }, ctx.lamp, law);
    },
    record(G: BoardGeometry, ctx: ObjectContext): BoardInstance {
      const look = ctx.look as BoardObjectLook | undefined;
      if (look === undefined) throw new Error("desk/board: the board's materials are the host's — the palette names no `board` (kinds/board.ts `BoardPalette`)");
      const tipName = stringProp(ctx.props, "tip", "bullet") as TipName;
      const tip = TIP_NAMES.includes(tipName) ? tipName : "bullet";
      const capName = stringProp(ctx.props, "cap", "black");
      const colourOf = (name: string): RGB => (look.markers[name] ?? Object.values(look.markers)[0])?.color ?? look.metal;
      const ink = ctx.local as BoardInk | undefined;
      const id = ink?.raster(ctx.entity, G, look, ctx.flux.fade < 1) ?? 0;
      // on the desk the marker lies capped in the ink it was put down in (`cap`); IN HAND (D3t-a) it follows the hand — taken up
      // as the board opens, at the pointer over the melamine, pressed while a stroke is laid, laid down again flying home
      if (ink === undefined || ctx.held === undefined) {
        if (ink !== undefined) Object.assign(ink.handFor(ctx.entity).pen, penAtRest());
        return { id, ...boardRest(G, ctx.rect.w, ctx.rect.h, tip, colourOf(capName), look, law) };
      }
      const { hand, pen, pinned } = ink.handFor(ctx.entity);
      const input = { held: ctx.held.open, erasing: hand?.erasing === true, over: hand?.over === true, pressing: hand?.pressing === true };
      if (stepPen(pen, input, ctx.dt, ctx.held.snap || pinned)) ink.moving(ctx.entity);
      const pose = boardPose(G, ctx.rect.w, ctx.rect.h, tip, colourOf(hand?.ink ?? capName), look, pen, hand?.at ?? null, law);
      const laying = ink.laying(ctx.entity);
      return { id, ...pose, ...(laying !== undefined ? { stroke: laying } : {}) };
    },
    hit(G: BoardGeometry, wx: number, wy: number): ObjectHit | null {
      const h = pickBoard(G, wx, wy);
      return h === "surface" ? "content" : h === "frame" ? "frame" : null;
    },
    frame: boardFrame,
    theme(palette: Palette, _name: ThemeName): BoardObjectLook {
      const p = palette as BoardPalette;
      const b = p.board;
      const surface = parse(b?.surface);
      const metal = parse(b?.frame);
      if (surface === undefined || metal === undefined) throw new Error("desk/board: the board's materials are the host's — the palette names no `board` (kinds/board.ts `BoardPalette`)");
      const black: RGB = [0, 0, 0];
      return {
        surface, metal,
        pen: { barrel: parse(b?.barrel) ?? black, felt: parse(b?.felt) ?? black, wood: parse(b?.wood) ?? black },
        markers: Object.fromEntries(Object.entries(p.markers ?? {}).map(([name, m]) => [name, { color: rgb(m.css), opacity: m.opacity }])),
        swatches: Object.fromEntries(Object.entries(p.markers ?? {}).map(([name, m]) => [markerToolId(name), m.css])),
      };
    },
  };
}
