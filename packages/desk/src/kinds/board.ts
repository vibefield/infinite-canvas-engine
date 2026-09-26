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
import { addStroke, BoardStroke, boardOps, MARKERS, type MarkerInk, type StrokeRow } from "../board/data";
import type { BoardInstance, BoardPen } from "../board/layout";
import { BOARD_SHADER_FILES, boardShaders } from "../board/shaders";
import { TIP_NAMES, type TipName, TIPS } from "../board/stroke";
import type { KindPass, KindProgram, SlotContext } from "../kind";
import type { MarkFrame } from "../marks/layout";
import type { MatPass } from "../mat/mat-pass";
import { type ShaderText, shaderText } from "../shaders";
import { BOARD, type Palette, type RGB, rgb, type ThemeName, type TokenRef } from "../theme";
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

  /** The pass's own `prepare`, argument for argument: the slot's camera, grid, clocks, the objects' presence, the light and the theme (its ring's colour). */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly BoardInstance[]): number {
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.theme);
  }

  /** Records [first, end) — a board whose raster is missing draws nothing (the pass counts in the list it was handed). */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }

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

/** A right hand holds a marker with its barrel rising away to the upper right (lab/board.ts). */
const HAND_ANGLE = Math.atan2(-0.8, 0.6);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * A board at rest as the bench draws it (`BoardDesk.instances` + `poseOf` with no board open), all but its raster: THE
 * marker lying where a hand put it down — every hand term at e = 0, kept as the bench computes them —, the world rect the
 * fragment may paint (the board, its shadow, the pen's box), the eye straight over it (the parallax at rest).
 */
export function boardRest(G: BoardGeometry, w: number, h: number, tip: TipName, capInk: RGB, look: BoardObjectLook, law: BoardLaw = DEFAULT_BOARD_LAW): Omit<BoardInstance, "id"> {
  const P = BOARD.pen;
  const R = P.radius;
  const L = P.length;
  const e = 0;
  const rest = { x: w * 0.16, y: h * 0.5 - BOARD.spec.frame - BOARD.pen.radius - 13, angle: -0.07 };
  const ar = rest.angle;
  const mid = [G.centre[0] + rest.x * G.scale, G.centre[1] + rest.y * G.scale];
  const at = [(mid[0] as number) - Math.cos(ar) * L * 0.5, (mid[1] as number) - Math.sin(ar) * L * 0.5] as const;
  const hand = at;
  let da = HAND_ANGLE - ar;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  const gap = P.hover;
  const pen: BoardPen = {
    x: at[0] + (hand[0] - at[0]) * e, y: at[1] + (hand[1] - at[1]) * e, angle: ar + da * e,
    height: R + (gap - R) * e + 34 * Math.sin(Math.PI * e), rise: P.rise * e,
    cap: smooth(0.3, 0.85, e), nib: TIPS[tip].half[1],
    presence: 1 + (0 - 1) * smooth(0.85, 1, e),
    ink: capInk,
  };
  const slope = Math.hypot(G.slope[0], G.slope[1]);
  const r = L * 1.3 + 60 + slope * (pen.height + L * pen.rise + 12);
  const box = { x0: pen.x - r, y0: pen.y - r, x1: pen.x + r, y1: pen.y + r };
  const par = [0, 0] as const;
  const k = BOARD.surface.parallax;
  return { geometry: G, surface: look.surface, metal: look.metal, quad: quadOf(G, box, law), sheen: [par[0] * k * 5, -par[1] * k * 5], pen };
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

/** The board's own state on one desk: each board's raster on the root pass, a cache of its strokes. */
export interface BoardInk extends KindLocal {
  /**
   * The raster board `e` draws with (its id on the pass): made the first time, its children REPLAYED into it whenever
   * their stamp turned over or the look changed; a fading ghost keeps what it had. 0 before the pass is here.
   */
  raster(e: Entity, G: BoardGeometry, look: BoardObjectLook, ghost: boolean): number;
  /** How many replays since the desk was made (a rig's witness). */
  replays(): number;
}

/** The board's `local()`: rasters by entity, released when the builder forgets a board. */
export function createBoardInk(host: KindHost): BoardInk {
  const boards = new Map<Entity, { readonly id: number; stamp: number; look: BoardObjectLook | null }>();
  let next = 1;
  let replays = 0;
  const passOf = (): BoardPass | undefined => { const k = host.pass(); return k instanceof BoardKind ? k.pass : undefined; };
  const stampOf = (e: Entity): number => host.children?.stamp(e) ?? 0;
  return {
    raster(e, G, look, ghost) {
      const pass = passOf();
      if (pass === undefined) return 0;
      let st = boards.get(e);
      if (st === undefined) { st = { id: next++, stamp: -1, look: null }; boards.set(e, st); }
      if (pass.look !== look.pen) pass.look = look.pen;   // the pen's materials: the product's, set on the root (a spawned slot copies them)
      if (ghost) return st.id;   // a board fading out keeps its ink: its children died with it
      const stamp = stampOf(e);
      const made = pass.ensure(st.id, surfaceSize(G));
      if (made || stamp !== st.stamp || look !== st.look) {
        const rows: readonly StrokeRow[] = host.children?.rows(e, BoardStroke) ?? [];
        pass.replay(st.id, boardOps(rows, look.markers));
        st.stamp = stamp;
        st.look = look;
        replays += 1;
      }
      return st.id;
    },
    tick() {
      for (const [e, st] of boards) if (st.stamp !== -1 && stampOf(e) !== st.stamp) return true;   // a stroke laid or undone: a frame to replay in
      return false;
    },
    forget(e) {
      const st = boards.get(e);
      if (st === undefined) return;
      passOf()?.release(st.id);
      boards.delete(e);
    },
    dispose() {
      const pass = passOf();
      for (const st of boards.values()) pass?.release(st.id);
      boards.clear();
    },
    replays: () => replays,
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
      const cap = look.markers[stringProp(ctx.props, "cap", "black")] ?? Object.values(look.markers)[0];
      const pose = boardRest(G, ctx.rect.w, ctx.rect.h, tip, cap?.color ?? look.metal, look, law);
      const ink = ctx.local as BoardInk | undefined;
      return { id: ink?.raster(ctx.entity, G, look, ctx.flux.fade < 1) ?? 0, ...pose };
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
