// The ground: one device, one canvas, the passes, one render per call.
//
// There is no frame LOOP here on purpose. A host decides when a frame is due —
// the lab's rAF + dirty flags, ICE's reflector, the oracle's single call — and
// asks for exactly one. That is the shape ICE's layer already has (`always:
// true` with a private dirty union; an idle scene renders zero frames), so
// this drops in under it without owning a clock.
//
// One command buffer per frame: [the mat's wind] → the desk in ONE render pass.
// The grid is the cutting mat (the dot and the needle, the card frame and its
// portal fill retired on 2026-09-25 — MINIMAT.md §1); on it, in paint order: the
// layers a host laid on the mat (the calendar), the MINI MATS, the whiteboards,
// the notes, the notebooks.
//
// A frame is a TREE of slots (PORTAL.md §2.2). The root slot is the desk the
// camera is on; a mini mat whose face passes the gate carries a NESTED slot —
// its inside, under `outgoingCamera(M, cam)`, clipped to its face and drawn
// right after the mini mat, over its face (MINIMAT.md §3). During a nav flight
// the arriving and the departed desks are the same tree: on enter the child is
// the arriving desk through the departed one's mini mat, on exit the departed
// desk through the arriving one's — and since the child's camera at the cut IS
// the live portal's, nothing inside the face changes when the flight starts
// (§2.4). A frozen (depth-capped) flight has no portal and is two whole slots,
// the departed under on enter and over on exit (design-006's z-rule), fading.
//
// A nested slot is visible only where its face lies inside every face above
// it — the CHAIN (`Presentation.within`, PORTAL.md §10): the ground builds it
// from the tree, scissors to its bounding box and hands it to every pass. The
// mini mat's own body lies opaque under its face, so an inside fading in lands
// on it and nothing under the mini mat ever shows through its edge.
//
// And a nested slot is LIT by its host (MINIMAT.md §4): the ground hands each
// child its parent's light, so a mini mat's inside takes the dapple of the desk
// the mini mat lies on; the root is lit by its own lamp unless the host says.
//
// Slots beyond the root come from a POOL spawned on first use — no compile,
// no clock — and cost nothing while no portal is on screen and no flight is on.

import { surface, type Surface } from "./engine/device";
import { beginPass } from "./engine/target";
import { boxOf } from "./lattice/lod";
import { DEFAULT_GRID, dressGrid, type GridConfig, type GridStats, gridStats, type SlotFrame } from "./mat/grid";
import { type SlotLight, STILL_MAT_FRAME } from "./mat/layout";
import { MatPass } from "./mat/mat-pass";
import type { MatShaders } from "./mat/shaders";
import { MiniMatPass } from "./minimat/pass";
import type { MiniMatInstance } from "./minimat/layout";
import type { MiniMatShaders } from "./minimat/shaders";
import { PaperPass } from "./paper/paper-pass";
import type { PaperInstance } from "./paper/layout";
import type { PaperShaders } from "./paper/shaders";
import { BoardPass } from "./board/board-pass";
import type { BoardInstance } from "./board/layout";
import type { BoardShaders } from "./board/shaders";
import { boxOfPortal, chainOf, intersectBox, PORTAL_CHAIN, scissorOf, type Presentation } from "./nav/portal";
import type { GroundTheme } from "./theme";

export interface GroundOptions {
  /**
   * The device the HOST owns — ICE's `acquireCompositorDevice()` at the fold (three adopts
   * it for islands), `gpu/device.ts` `acquire()` in a lab or the oracle. The ground never
   * makes one: every texture the compose pass samples must live on the same device.
   */
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  /** The cutting mat (mat/mat-pass.ts). */
  readonly mat: MatShaders;
  /** The paper — the sticky notes (paper/paper-pass.ts, STICKY.md). */
  readonly papers: PaperShaders;
  /** The mini mats — the desk's containers (minimat/pass.ts, MINIMAT.md). */
  readonly minimats: MiniMatShaders;
  /** The whiteboards (board/board-pass.ts, BOARD.md); absent = no board pass. */
  readonly boards?: BoardShaders;
}

/** A layer a host rendered first, laid on the mat inside the ground's pass (it sets its own scissor; the ground restores the slot's). */
export interface Underlay { draw(pass: GPURenderPassEncoder): void }

/** One desk's ground: its camera, grid, objects and presentation — the root's, a departed desk's, or a mini mat's inside. */
export interface SlotInputs extends SlotFrame {
  /** The grid; the root may leave it unset and set `ground.grid` instead — every other slot names its own. */
  readonly grid?: GridConfig;
  /**
   * Things drawn ON THE MAT by passes of their own, beneath everything else on the desk
   * (CALENDAR.md: the desk calendar — the host renders its layer first, the ground lays it here).
   */
  readonly underlays?: readonly Underlay[];
  /** The mini mats on this desk (MINIMAT.md), in paint order, lowest first: flat on the mat, beneath every board, note and notebook. */
  readonly minimats?: readonly MiniMatInstance[];
  /** The whiteboards on this desk (BOARD.md): above the mini mats, beneath every note and notebook — a note can sit on a board. */
  readonly boards?: readonly BoardInstance[];
  /** The sticky notes on this desk (STICKY.md), in paint order: above every mini mat and board. */
  readonly papers?: readonly PaperInstance[];
  /** The live insides of this desk's mini mats (MINIMAT.md §3): each drawn right after the mini mat `at` names. */
  readonly portals?: readonly PortalInputs[];
}

/**
 * A mini mat's inside through its face (PORTAL.md §2.1, MINIMAT.md §3): `present` carries
 * the presence (its opacity — the gate's answer) and the face (its clip); `view` may leave
 * `box` unset — the ground sizes the slot's box from the clip.
 */
export interface PortalInputs extends SlotInputs {
  readonly grid: GridConfig;
  /** The mini mat's index in the parent's `minimats` (paint order): the slot draws just AFTER it, over its face. */
  readonly at: number;
}

/** The departed desk's ground for one flight frame: its own camera, grid, objects and presentation. */
export interface OutgoingInputs extends SlotInputs {
  readonly grid: GridConfig;
  /** design-006's z-rule for a FROZEN flight: under on enter, over on exit. */
  readonly order: "under" | "over";
  /**
   * ENTER through a live portal (PORTAL.md §2.4): the mini mat's index in the DEPARTED desk's
   * `minimats` — the two desks draw as one tree, the arriving one through the mini mat's face,
   * so the objects over the mini mat stay over the inside and fade with their desk (a live
   * portal of the departed desk at the same index is neither prepared nor drawn: the arriving
   * desk is that face). Absent = two whole slots, `order` decides: a frozen flight, and every
   * EXIT — the departed inside draws OVER the whole parent (whose own live portal shows the
   * same pixels under it) and fades onto them at the landing.
   */
  readonly at?: number;
}

export interface GroundFrameInputs extends SlotInputs {
  /** The theme in force (`theme.ts`): the clear colour, the selection's colour and the mat's light (the Sun or the Moon) come from it. */
  readonly theme: GroundTheme;
  /** Present only while a nav flight is on. */
  readonly outgoing?: OutgoingInputs;
}

export interface GroundStats extends GridStats {
  /** The root's notes, mini mats and whiteboards drawn this frame. */
  readonly papers: number;
  readonly minimats: number;
  readonly boards: number;
  /** The departed slot's grid while a flight is on. */
  readonly outgoing: GridStats | null;
  /** Live portals drawn this frame, the root's and the departed desk's together. */
  readonly portals: number;
}

/** One slot's passes for `drawFrame` — the ground's own, or the oracle's. A parent carries its nested slots. */
export interface DrawSlot {
  readonly mat: MatPass;
  readonly present?: Presentation | undefined;
  /** Layers laid on the mat before everything (the calendar's). */
  readonly underlays?: readonly Underlay[] | undefined;
  /** The slot's mini mats, prepared: drawn on the mat, each followed by its live inside. */
  readonly minimats?: MiniMatPass | undefined;
  /** The slot's whiteboards, prepared: above the mini mats. */
  readonly boards?: BoardPass | undefined;
  /** The slot's notes, prepared: above the whiteboards. */
  readonly papers?: PaperPass | undefined;
  /** Nested slots, each drawn right after the parent's mini mat `at` (MINIMAT.md §3). */
  readonly children?: readonly { readonly at: number; readonly slot: DrawSlot }[] | undefined;
  /** What the slot's grid did this frame. */
  readonly stats: GridStats;
}

/** A slot at opacity 0 draws nothing: "source over" with alpha 0 leaves every pixel as it was. */
export const visible = (p: Presentation | undefined): boolean => (p?.opacity ?? 1) > 0;

/** The passes one slot owns. The root's are the ground's; the pool spawns the rest on the same pipelines. */
export interface SlotSet { readonly mat: MatPass; readonly papers?: PaperPass; readonly minimats?: MiniMatPass; readonly boards?: BoardPass }

/** Slots beyond the root, spawned on first use and reused every frame: `reset()` then `acquire()` per slot the frame needs. */
export class SlotPool {
  private readonly slots: SlotSet[] = [];
  private used = 0;
  private readonly root: SlotSet;
  constructor(root: SlotSet) { this.root = root; }
  reset(): void { this.used = 0; }
  acquire(): SlotSet {
    if (this.used === this.slots.length) {
      const r = this.root;
      const mat = r.mat.spawn();
      this.slots.push({ mat, ...(r.papers ? { papers: r.papers.spawn(mat) } : {}), ...(r.minimats ? { minimats: r.minimats.spawn(mat) } : {}), ...(r.boards ? { boards: r.boards.spawn(mat) } : {}) });
    }
    return this.slots[this.used++] as SlotSet;
  }
  /** Slots spawned so far — the churn instrument. */
  get size(): number { return this.slots.length; }
  dispose(): void { for (const s of this.slots) { s.mat.dispose(); s.papers?.dispose(); s.minimats?.dispose(); s.boards?.dispose(); } this.slots.length = 0; this.used = 0; }
}

/**
 * Draw one slot into an open render pass: scissored to its portal (nothing
 * outside it is shaded), skipped outright at opacity 0 — the mat, the layers on
 * it, then the mini mats in paint order with each one's live inside drawn right
 * after it (restoring this slot's scissor), then the whiteboards and the notes.
 * Returns whether it drew.
 */
export function drawSlot(pass: GPURenderPassEncoder, size: { readonly w: number; readonly h: number }, dpr: number, slot: DrawSlot): boolean {
  if (!visible(slot.present)) return false;
  const [x, y, w, h] = scissorOf(slot.present, dpr, size);
  if (w === 0 || h === 0) return false;   // the portal is off screen: nothing to shade
  pass.setScissorRect(x, y, w, h);
  slot.mat.draw(pass);
  // the layers a host laid on the mat (the desk calendar, CALENDAR.md), each setting its own scissor
  if (slot.underlays?.length) { for (const u of slot.underlays) u.draw(pass); pass.setScissorRect(x, y, w, h); }
  // the mini mats in paint order: at a mini mat with a live inside, the mats up to and including it, then its inside over
  // its face, then its chips over that while they fade out (MINIMAT.md §5) — before the mats above it
  const kids = slot.children ? [...slot.children].sort((a, b) => a.at - b.at) : [];
  let from = 0;
  for (const k of kids) {
    slot.minimats?.drawRange(pass, from, k.at + 1);
    from = Math.max(from, k.at + 1);
    if (drawSlot(pass, size, dpr, k.slot)) pass.setScissorRect(x, y, w, h);
    slot.minimats?.drawChips(pass, k.at);
  }
  slot.minimats?.drawRange(pass, from, Number.MAX_SAFE_INTEGER);
  // the whiteboards and the notes, above every mini mat (BOARD.md, STICKY.md)
  slot.boards?.draw(pass);
  slot.papers?.draw(pass);
  return true;
}

/**
 * Record one frame into an open render pass: the root slot with its nested
 * slots, and — while a flight is on — the departed slot: through the mini mat
 * as one tree (`outgoing.at`), or whole, under or over, when the flight is
 * frozen. Shared with the Node oracle so both hosts draw a frame through the
 * same code. Returns each slot's grid stats (null = not drawn).
 */
export function drawFrame(pass: GPURenderPassEncoder, size: { readonly w: number; readonly h: number }, dpr: number, incoming: DrawSlot, outgoing?: (DrawSlot & { readonly order: "under" | "over"; readonly at?: number | undefined }) | null): { incoming: GridStats; outgoing: GridStats | null } {
  let drewOut = false;
  if (outgoing && outgoing.at !== undefined) {
    // A portal flight: one tree. Enter = the arriving desk through the departed one's mini mat; exit = the departed desk through the arriving one's.
    const enter = outgoing.order === "under";
    const parent = enter ? outgoing : incoming;
    const child = enter ? incoming : outgoing;
    const at = outgoing.at;
    const tree: DrawSlot = { ...parent, children: [...(parent.children ?? []).filter((k) => k.at !== at), { at, slot: child }] };
    const drewParent = drawSlot(pass, size, dpr, tree);
    // the child drew iff the parent did and the child is visible with a portal on screen
    const drewChild = drewParent && visible(child.present) && scissorOf(child.present, dpr, size)[2] > 0 && scissorOf(child.present, dpr, size)[3] > 0;
    drewOut = enter ? drewParent : drewChild;
  } else {
    if (outgoing?.order === "under") drewOut = drawSlot(pass, size, dpr, outgoing);
    drawSlot(pass, size, dpr, incoming);
    if (outgoing?.order === "over") drewOut = drawSlot(pass, size, dpr, outgoing);
  }
  pass.setScissorRect(0, 0, size.w, size.h);
  return { incoming: incoming.stats, outgoing: outgoing && drewOut ? outgoing.stats : null };
}

/** What `prepareFrame` hands the draw: the two slots and the counts the stats report. */
export interface PreparedFrame {
  readonly incoming: DrawSlot;
  readonly outgoing: (DrawSlot & { readonly order: "under" | "over"; readonly at?: number | undefined }) | null;
  readonly portals: number;
  /** The root's notes, mini mats and whiteboards drawn. */
  readonly papers: number;
  readonly minimats: number;
  readonly boards: number;
}

/** The light a slot is lit by when nothing says otherwise: its own camera. */
const ownLight = (s: SlotFrame): SlotLight => ({ a: { x: s.view.camX, y: s.view.camY, zoom: s.view.zoom } });
/** What a slot's OBJECTS are presented with: its opacity times their own presence (the mat takes the opacity alone). */
const objectsOf = (p: Presentation | undefined): Presentation | undefined => (p?.objects === undefined ? p : { ...p, opacity: p.opacity * p.objects });
/** A live inside's presence over its mini mat's face: what the face's own drawing gives way to. */
const liveOf = (p: Presentation | undefined): number => (p ? p.opacity * (p.objects ?? 1) : 1);

/**
 * Upload one frame's records into its slots — the root's, each live portal's
 * (from the pool), the departed desk's — run the mat's wind where its clock
 * moved, and return the draw tree. Shared by the ground and the Node oracle.
 * `grid` is the root's when its inputs name none.
 */
export function prepareFrame(encoder: GPUCommandEncoder, root: SlotSet, pool: SlotPool, inputs: GroundFrameInputs, grid: GridConfig = DEFAULT_GRID): PreparedFrame {
  pool.reset();
  const theme = inputs.theme;
  let portals = 0;
  const attach = { width: inputs.view.width, height: inputs.view.height };
  // `host`: the light of the slot this one is nested in — a mini mat's inside is lit by the desk it lies on; `skipAt`: a portal of this
  // slot not to prepare — on an enter, the arriving desk IS that face, and `treeLive` is its presence over the mini mat there.
  const prepare = (s: SlotSet, inp: SlotInputs, fallback: GridConfig, host: SlotLight | undefined, skipAt?: number, treeLive?: number): DrawSlot => {
    const g = inp.grid ?? fallback;
    const light = inp.light ?? host ?? ownLight(inp);
    const lit = inp.light ?? host;   // undefined = the slot's own lamp, exactly (the root at rest)
    const cfg = dressGrid(g, inp.view.zoom, inp.lodZoom);
    const wind = s.mat.prepare(encoder, inp.view, cfg.fadeIn, cfg.mat, inp.mat ?? STILL_MAT_FRAME, inp.present, theme.matLight, lit);
    const children: { at: number; slot: DrawSlot }[] = [];
    const live = new Map<number, number>();
    if (skipAt !== undefined && treeLive !== undefined) live.set(skipAt, treeLive);
    // A child is seen through its own face AND every face this slot is seen through — the chain (PORTAL.md §10) — and its box is its face's inside this slot's.
    const within = chainOf(inp.present);
    let parentBox = boxOf(inp.view);
    for (const c of within) parentBox = intersectBox(parentBox, boxOfPortal(c, attach));
    for (const p of inp.portals ?? []) {
      if (!visible(p.present) || !p.present?.portal || p.at === skipAt) continue;
      if (within.length >= PORTAL_CHAIN) continue;   // the belt: a face beyond the chain shows nothing (a host's depth belt stops first)
      const box = intersectBox(p.view.box ?? boxOfPortal(p.present.portal, attach), parentBox);
      if (box.w <= 0 || box.h <= 0) continue;
      // the inside comes in over the mini mat's own face — its mat whole, its objects by their presence; it is lit by this desk's lamp
      const present: Presentation = { opacity: p.present.opacity, ...(p.present.objects !== undefined ? { objects: p.present.objects } : {}), portal: p.present.portal, within };
      children.push({ at: p.at, slot: prepare(pool.acquire(), { ...p, view: { ...p.view, box }, present }, p.grid, light) });
      live.set(p.at, liveOf(present));
      portals += 1;
    }
    // the objects, lit by this slot's mat — its light, its lamp's gobo (MINIMAT.md §4) — at their presence; each mini mat told
    // whether a live inside covers its face this frame (the face's far LOD gives way to it)
    const objects = objectsOf(inp.present);
    if (s.papers) { if (root.papers && s.papers !== root.papers) s.papers.tune(root.papers); s.papers.prepare(inp.view, g.fadeIn, g.mat, inp.mat, inp.papers ?? [], objects, theme.matLight, theme.select, lit); }
    if (s.minimats) { if (root.minimats && s.minimats !== root.minimats) s.minimats.tune(root.minimats); s.minimats.prepare(inp.view, g.fadeIn, g.mat, inp.mat, inp.minimats ?? [], objects, theme.matLight, theme.select, lit, (i) => live.get(i) ?? -1); }
    if (s.boards) { if (root.boards && s.boards !== root.boards) s.boards.copy(root.boards); s.boards.prepare(inp.view, g.fadeIn, g.mat, inp.mat, inp.boards ?? [], objects, theme.matLight, theme); }
    return {
      mat: s.mat, present: inp.present, stats: gridStats(inp.view, wind),
      ...(inp.underlays?.length ? { underlays: inp.underlays } : {}),
      ...(s.minimats ? { minimats: s.minimats } : {}), ...(s.boards ? { boards: s.boards } : {}), ...(s.papers ? { papers: s.papers } : {}),
      ...(children.length ? { children } : {}),
    };
  };
  const incoming = prepare(root, inputs, grid, undefined);
  let outgoing: PreparedFrame["outgoing"] = null;
  // A departed slot at opacity 0 (the last quarter of an enter, the tail of a frozen dissolve) is neither prepared nor drawn.
  if (inputs.outgoing && visible(inputs.outgoing.present)) {
    const o = inputs.outgoing;
    const enterTree = o.at !== undefined && o.order === "under";
    // on enter the departed desk's own portal at the mini mat is the arriving desk's face — never prepared twice — and the arriving
    // desk's presence there is what the mini mat's far LOD gives way to
    const out = prepare(pool.acquire(), o, o.grid, undefined, enterTree ? o.at : undefined, enterTree ? liveOf(inputs.present) : undefined);
    outgoing = { ...out, order: o.order, at: o.at };
  }
  return { incoming, outgoing, portals, papers: root.papers?.drawn ?? 0, minimats: root.minimats?.drawn ?? 0, boards: root.boards?.drawn ?? 0 };
}

export class Ground {
  readonly device: GPUDevice;
  readonly surface: Surface;
  /** The cutting mat — the root slot's; its plates, noise and glyph atlas are every slot's. */
  readonly mat: MatPass;
  /** The sticky notes (STICKY.md). */
  readonly papers: PaperPass;
  /** The mini mats (MINIMAT.md). */
  readonly minimats: MiniMatPass;
  /** The whiteboards (BOARD.md); undefined when the host handed no board shaders. */
  readonly boards: BoardPass | undefined;
  /** Slots beyond the root — the departed desk's, the live insides of mini mats — spawned on first use. */
  readonly pool: SlotPool;
  /** The root's grid when a frame names none. */
  grid: GridConfig = DEFAULT_GRID;

  private constructor(device: GPUDevice, surface: Surface, mat: MatPass, papers: PaperPass, minimats: MiniMatPass, boards: BoardPass | undefined) {
    this.device = device; this.surface = surface; this.mat = mat; this.papers = papers; this.minimats = minimats; this.boards = boards;
    this.pool = new SlotPool(this.slotSet());
  }

  private slotSet(): SlotSet { return { mat: this.mat, papers: this.papers, minimats: this.minimats, ...(this.boards ? { boards: this.boards } : {}) }; }

  static async create(opts: GroundOptions): Promise<Ground> {
    const surf = surface(opts.device, opts.canvas);
    const mat = await MatPass.create(opts.device, surf.format, opts.mat);
    const [papers, minimats, boards] = await Promise.all([
      PaperPass.create(opts.device, surf.format, opts.papers, mat),
      MiniMatPass.create(opts.device, surf.format, opts.minimats, mat),
      opts.boards ? BoardPass.create(opts.device, surf.format, opts.boards, mat) : Promise.resolve(undefined),
    ]);
    return new Ground(opts.device, surf, mat, papers, minimats, boards);
  }

  /** Size the canvas to its CSS box; returns the CSS size and dpr the frame should use. (A host may size the canvas itself instead.) */
  fit(maxDpr = 2) { return this.surface.fit(maxDpr); }

  /** Render one frame now. Synchronous submit; the caller owns the cadence. */
  render(inputs: GroundFrameInputs): GroundStats {
    const encoder = this.device.createCommandEncoder({ label: "ground" });
    const prepared = prepareFrame(encoder, this.slotSet(), this.pool, inputs, this.grid);
    const bg = inputs.theme.canvasBg;
    const pass = beginPass(encoder, this.surface.view(), [bg[0], bg[1], bg[2], 1], "ground");
    const drawn = drawFrame(pass, this.surface.size(), inputs.view.dpr, prepared.incoming, prepared.outgoing);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return { ...drawn.incoming, papers: prepared.papers, minimats: prepared.minimats, boards: prepared.boards, outgoing: drawn.outgoing, portals: prepared.portals };
  }

  dispose(): void { this.pool.dispose(); this.boards?.dispose(); this.minimats.dispose(); this.papers.dispose(); this.mat.dispose(); }
}
