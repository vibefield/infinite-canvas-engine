// The ground: one device, one swap chain, the mat and the registered KINDS, one render per call.
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
// layers a host laid on the mat (the calendar), then the desk's OBJECTS stratum by
// stratum — pads, sheets (the mini mats), things (the whiteboards, the notes, every
// other kind) — and within a stratum in the desk's own paint order, one draw per
// RUN of one kind (design-015 §4.2). The ground names no kind (design-015 §5.2):
// each registers a PROGRAM (kind.ts) — its name, its stratum, its pass made on the
// root's mat — and the ground hands each slot's pass of that kind the kind's
// records and draws them in ranges. A new kind is added without touching this file.
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

import type { Surface } from "./engine/device";
import { beginPass } from "./engine/target";
import { HoldPass } from "./hold/focus";
import type { HoldShaders } from "./hold/shaders";
import { type KindPass, type KindProgram, type SlotContext, STRATA, type StratumName } from "./kind";
import { boxOf, type View } from "./lattice/lod";
import type { MatLight } from "./mat/night";
import { DEFAULT_GRID, dressGrid, type GridConfig, type GridStats, gridStats, type SlotFrame } from "./mat/grid";
import { type SlotLight, STILL_MAT_FRAME } from "./mat/layout";
import { MatPass } from "./mat/mat-pass";
import type { MatShaders } from "./mat/shaders";
import type { MarksInput } from "./marks/layout";
import { MarksPass } from "./marks/pass";
import type { MarksShaders } from "./marks/shaders";
import { boxOfPortal, chainOf, intersectBox, PORTAL_CHAIN, scissorOf, type Presentation } from "./nav/portal";
import type { GroundTheme } from "./theme";

export type { KindExtra, KindPass, KindProgram, SlotContext, StratumName } from "./kind";
export { STRATA } from "./kind";
export type { MarkBar, MarkBox, MarkFrame, MarkGuide, MarkMarquee, MarkObject, MarkRuler, MarksInput, MarkTape, MarkUnion } from "./marks/layout";
export { MARKS_SHADER_FILES, marksShaders } from "./marks/shaders";

export interface GroundOptions {
  /**
   * The device the HOST owns — ICE's `acquireCompositorDevice()` at the fold (three adopts
   * it for islands), `gpu/device.ts` `acquire()` in a lab or the oracle. The ground never
   * makes one: every texture the compose pass samples must live on the same device.
   */
  readonly device: GPUDevice;
  /**
   * The swap chain the frames go into — the HOST makes it (`surface(device, canvas)` from
   * `@ice/desk/host`, the one module that names a canvas; a test's fake), so this composition
   * root never touches the DOM (design-015 §3 `desk-dom-free`, D2a-world).
   */
  readonly surface: Surface;
  /** The cutting mat (mat/mat-pass.ts) — the ground's own: every slot draws it first. */
  readonly mat: MatShaders;
  /**
   * The kinds this ground draws — its REGISTRY (kind.ts; the desk's own are `DESK_KINDS`, `@ice/desk/kinds`).
   * Names are unique. Each kind's pass is made on the root's mat; the kinds prepare in this order and draw
   * stratum by stratum, then in each slot's paint order.
   */
  readonly kinds: readonly KindProgram[];
  /**
   * The desk's chrome (marks/pass.ts; design-015 §7, D4a): the marks pass, drawn in the ROOT's pass after every
   * stratum — the selection's brackets, the vellum, the laser, the tape — when a frame names its `marks`. Absent =
   * a ground that draws no chrome.
   */
  readonly marks?: MarksShaders;
  /**
   * The hand (hold/focus.ts; design-015 §8, D4b): the focus behind an object in hand and the object over it, when a
   * frame names its `held`. Absent = a ground that never picks anything up (a frame's `held` is then ignored).
   */
  readonly hold?: HoldShaders;
}

/** A layer a host rendered first, laid on the mat inside the ground's pass (it sets its own scissor; the ground restores the slot's). */
export interface Underlay { draw(pass: GPURenderPassEncoder): void }

/** One object on a desk as the ground takes it: its kind's name (a registered one) and the record that kind's pass draws. */
export interface SlotObject {
  readonly kind: string;
  readonly record: unknown;
}

/** One desk's ground: its camera, grid, objects and presentation — the root's, a departed desk's, or a mini mat's inside. */
export interface SlotInputs extends SlotFrame {
  /** The grid; the root may leave it unset and set `ground.grid` instead — every other slot names its own. */
  readonly grid?: GridConfig;
  /**
   * Things drawn ON THE MAT by passes of their own, beneath everything else on the desk
   * (CALENDAR.md: the desk calendar — the host renders its layer first, the ground lays it here).
   */
  readonly underlays?: readonly Underlay[];
  /**
   * The objects on this desk in PAINT ORDER, lowest first — the caller sorts: strata first (the ground draws
   * stratum by stratum whatever the list says), then its own order within each. A kind's records are its
   * objects, in this order; every kind named must be registered.
   */
  readonly objects?: readonly SlotObject[];
  /** The live insides of this desk's sheets (MINIMAT.md §3): each drawn right after the object `at` names. */
  readonly portals?: readonly PortalInputs[];
}

/**
 * A mini mat's inside through its face (PORTAL.md §2.1, MINIMAT.md §3): `present` carries
 * the presence (its opacity — the gate's answer) and the face (its clip); `view` may leave
 * `box` unset — the ground sizes the slot's box from the clip.
 */
export interface PortalInputs extends SlotInputs {
  readonly grid: GridConfig;
  /** The mini mat's index in the parent's `objects` (paint order): the slot draws just AFTER it, over its face. */
  readonly at: number;
}

/** The departed desk's ground for one flight frame: its own camera, grid, objects and presentation. */
export interface OutgoingInputs extends SlotInputs {
  readonly grid: GridConfig;
  /** design-006's z-rule for a FROZEN flight: under on enter, over on exit. */
  readonly order: "under" | "over";
  /**
   * ENTER through a live portal (PORTAL.md §2.4): the mini mat's index in the DEPARTED desk's
   * `objects` — the two desks draw as one tree, the arriving one through the mini mat's face,
   * so the objects over the mini mat stay over the inside and fade with their desk (a live
   * portal of the departed desk at the same index is neither prepared nor drawn: the arriving
   * desk is that face). Absent = two whole slots, `order` decides: a frozen flight, and every
   * EXIT — the departed inside draws OVER the whole parent (whose own live portal shows the
   * same pixels under it) and fades onto them at the landing.
   */
  readonly at?: number;
}

/**
 * THE HAND for one frame (design-015 §8; D4b — the builder makes it, the ground draws it): the one object in hand as a slot
 * of its own — its record, the pose's CAMERA (`view`) and its grid (no dapple in hand) — drawn by its kind's own pass over the
 * desk out of focus. `e` is the carry amount (the focus follows it); `blur` the radius the ONE blur is made at (CSS px: 14, a
 * phone's 10); `dim` the desk's dim behind (already by the carry); `filter` the reading light on the hand (1, 1 by day);
 * `light` the hand's own light (the day's mixed in by night); `stamp` the desk copy's identity — while it stands, the blurred
 * desk is reused (rendered ONCE per settled state, the held object alone redrawing).
 */
export interface HeldFrameInputs {
  readonly object: SlotObject;
  readonly view: View & { readonly dpr: number };
  readonly grid: GridConfig;
  readonly e: number;
  readonly blur: number;
  readonly dim: number;
  readonly filter: { readonly saturate: number; readonly brightness: number };
  readonly light: MatLight;
  readonly stamp: string;
}

export interface GroundFrameInputs extends SlotInputs {
  /** The theme in force (`theme.ts`): the clear colour, the selection's colour and the mat's light (the Sun or the Moon) come from it. */
  readonly theme: GroundTheme;
  /** Present only while a nav flight is on. */
  readonly outgoing?: OutgoingInputs;
  /** The desk's marks this frame, in screen px (marks/layout.ts) — stratum 5, over everything; absent = none. */
  readonly marks?: MarksInput;
  /** The object in hand (design-015 §8, D4b) while one is held or flying home; absent = the desk as it is. At `e` 0 the frame is the rest frame, byte for byte. */
  readonly held?: HeldFrameInputs;
}

export interface GroundStats extends GridStats {
  /** The root's records drawn this frame, by kind name — every registered kind, 0 where it had none. */
  readonly kinds: Readonly<Record<string, number>>;
  /** The departed slot's grid while a flight is on. */
  readonly outgoing: GridStats | null;
  /** Live portals drawn this frame, the root's and the departed desk's together. */
  readonly portals: number;
}

/** One registered kind as a slot holds it: the registry's name and stratum, and the slot's own pass (and whether it lays a composite — `KindProgram.composite`). */
export interface SlotKind {
  readonly name: string;
  readonly stratum: StratumName;
  readonly pass: KindPass;
  readonly composite?: boolean;
}

/** The passes one slot owns: the mat's, and every registered kind's by name, in registration order. The root's are the ground's; the pool spawns the rest on the same pipelines. */
export interface SlotSet {
  readonly mat: MatPass;
  readonly kinds: ReadonlyMap<string, SlotKind>;
}

/** One slot's passes for `drawFrame` — the ground's own, or the oracle's. A parent carries its nested slots. */
export interface DrawSlot {
  readonly mat: MatPass;
  readonly present?: Presentation | undefined;
  /** BARE: no mat is drawn — the hand's slot (D4b) lays its one object over a frame that is already there. */
  readonly bare?: boolean | undefined;
  /** Layers laid on the mat before everything (the calendar's). */
  readonly underlays?: readonly Underlay[] | undefined;
  /** The slot's kinds, prepared (its `SlotSet.kinds`): an object's kind names its stratum and its pass. */
  readonly kinds: ReadonlyMap<string, SlotKind>;
  /** The slot's objects in paint order — only their kinds matter to the draw: each kind's records are counted along them. */
  readonly objects?: readonly { readonly kind: string }[] | undefined;
  /** Nested slots, each drawn right after the object `at` names (MINIMAT.md §3) — one that names no object here draws over them all. */
  readonly children?: readonly { readonly at: number; readonly slot: DrawSlot }[] | undefined;
  /** What the slot's grid did this frame. */
  readonly stats: GridStats;
}

/** A slot at opacity 0 draws nothing: "source over" with alpha 0 leaves every pixel as it was. */
export const visible = (p: Presentation | undefined): boolean => (p?.opacity ?? 1) > 0;

/**
 * The root slot's passes: the mat's (made first — every kind's pass is made on it) and every registered
 * kind's, made in parallel on the root's mat, in registration order. Names must be unique and strata known.
 * Shared by the ground and the Node oracle.
 */
export async function createSlotSet(device: GPUDevice, format: GPUTextureFormat, mat: MatPass, programs: readonly KindProgram[]): Promise<SlotSet> {
  const names = new Set<string>();
  for (const p of programs) {
    if (!p.name) throw new Error("ground: a kind needs a name — it is the kind's key in every slot");
    if (names.has(p.name)) throw new Error(`ground: two kinds are named "${p.name}" — a kind's name is its key in every slot`);
    if (!STRATA.includes(p.stratum)) throw new Error(`ground: kind "${p.name}" lies in no stratum the ground draws ("${p.stratum}"; ${STRATA.join(", ")})`);
    names.add(p.name);
  }
  const passes = await Promise.all(programs.map((p) => p.create(device, format, mat)));
  const kinds = new Map<string, SlotKind>();
  for (let i = 0; i < programs.length; i++) {
    const p = programs[i] as KindProgram;
    kinds.set(p.name, { name: p.name, stratum: p.stratum, pass: passes[i] as KindPass, ...(p.composite ? { composite: true } : {}) });
  }
  return { mat, kinds };
}

/** Slots beyond the root, spawned on first use and reused every frame: `reset()` then `acquire()` per slot the frame needs. */
export class SlotPool {
  private readonly slots: SlotSet[] = [];
  private used = 0;
  private readonly root: SlotSet;
  constructor(root: SlotSet) { this.root = root; }
  reset(): void { this.used = 0; }
  /** The next slot: on first use its mat spawned from the root's, then every registered kind's pass on that mat, in registration order. */
  acquire(): SlotSet {
    if (this.used === this.slots.length) {
      const mat = this.root.mat.spawn();
      const kinds = new Map<string, SlotKind>();
      for (const k of this.root.kinds.values()) kinds.set(k.name, { name: k.name, stratum: k.stratum, pass: k.pass.spawn(mat), ...(k.composite ? { composite: true } : {}) });
      this.slots.push({ mat, kinds });
    }
    return this.slots[this.used++] as SlotSet;
  }
  /** Slots spawned so far — the churn instrument. */
  get size(): number { return this.slots.length; }
  dispose(): void { for (const s of this.slots) { s.mat.dispose(); for (const k of s.kinds.values()) k.pass.dispose(); } this.slots.length = 0; this.used = 0; }
}

/**
 * Draw one slot into an open render pass: scissored to its portal (nothing
 * outside it is shaded), skipped outright at opacity 0 — the mat, the layers on
 * it, then the objects stratum by stratum: within a stratum in paint order, one
 * `drawRange` per RUN of one kind (each kind counting its own records), the run
 * cut after an object with a live inside — the inside over its face (restoring
 * this slot's scissor), then that object's marks over the inside. Returns
 * whether it drew.
 */
export function drawSlot(pass: GPURenderPassEncoder, size: { readonly w: number; readonly h: number }, dpr: number, slot: DrawSlot): boolean {
  if (!visible(slot.present)) return false;
  const [x, y, w, h] = scissorOf(slot.present, dpr, size);
  if (w === 0 || h === 0) return false;   // the portal is off screen: nothing to shade
  pass.setScissorRect(x, y, w, h);
  if (slot.bare !== true) slot.mat.draw(pass);
  // the layers a host laid on the mat (the desk calendar, CALENDAR.md), each setting its own scissor
  if (slot.underlays?.length) { for (const u of slot.underlays) u.draw(pass); pass.setScissorRect(x, y, w, h); }
  // the live insides by the object each lies in (two on one object draw in the order they came)
  const objects = slot.objects ?? [];
  const insides = new Map<number, DrawSlot[]>();
  for (const c of slot.children ?? []) { const listed = insides.get(c.at); if (listed) listed.push(c.slot); else insides.set(c.at, [c.slot]); }
  const inside = (child: DrawSlot) => { if (drawSlot(pass, size, dpr, child)) pass.setScissorRect(x, y, w, h); };
  // the objects, stratum by stratum; within one, in paint order, a run of one kind at a time — cut after an object with a live
  // inside: the run through it, its inside over its face, then its marks over that (the mini mat's chips while the inside's
  // objects fade in — MINIMAT.md §5) — before the objects above it
  const next = new Map<string, number>();   // each kind's next record
  for (const stratum of STRATA) {
    let run: SlotKind | undefined;
    let first = 0;
    let end = 0;
    for (let i = 0; i < objects.length; i++) {
      const k = slot.kinds.get((objects[i] as { readonly kind: string }).kind);
      if (!k || k.stratum !== stratum) continue;
      const index = next.get(k.name) ?? 0;
      next.set(k.name, index + 1);
      if (k.composite) continue;   // laid once, after the stratum's runs (below)
      if (k !== run) { run?.pass.drawRange(pass, first, end); run = k; first = index; }
      end = index + 1;
      const children = insides.get(i);
      if (!children) continue;
      k.pass.drawRange(pass, first, end);
      run = undefined;
      for (const child of children) { inside(child); k.pass.drawOver?.(pass, index); }
      insides.delete(i);
    }
    run?.pass.drawRange(pass, first, end);
    // a kind that lays a composite of its own target (the notebook, the calendar): ONE run over all its records, after every other
    // run of the stratum — one draw lays every one of its objects, so they cannot interleave with another kind's (KindProgram.composite)
    for (const k of slot.kinds.values()) {
      const count = k.composite && k.stratum === stratum ? (next.get(k.name) ?? 0) : 0;
      if (count > 0) k.pass.drawRange(pass, 0, count);
    }
  }
  // an inside whose `at` names no object this slot draws has nothing to lie in: it draws over them all
  for (const children of insides.values()) for (const child of children) inside(child);
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
  /** The root's records that will draw, by kind name — every registered kind. */
  readonly kinds: Readonly<Record<string, number>>;
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
 * moved, and return the draw tree. Per slot, every registered kind prepares its
 * own records (the slot's objects of that kind, in paint order), told which of
 * them carries a live inside. Shared by the ground and the Node oracle. `grid`
 * is the root's when its inputs name none.
 */
export function prepareFrame(encoder: GPUCommandEncoder, root: SlotSet, pool: SlotPool, inputs: GroundFrameInputs, grid: GridConfig = DEFAULT_GRID): PreparedFrame {
  pool.reset();
  const theme = inputs.theme;
  let portals = 0;
  let rootDrawn: readonly (readonly [string, number])[] = [];
  const attach = { width: inputs.view.width, height: inputs.view.height };
  // `host`: the light of the slot this one is nested in — a mini mat's inside is lit by the desk it lies on; `skipAt`: a portal of this
  // slot not to prepare — on an enter, the arriving desk IS that face, and `treeLive` is its presence over the mini mat there.
  const prepare = (s: SlotSet, inp: SlotInputs, fallback: GridConfig, host: SlotLight | undefined, skipAt?: number, treeLive?: number): DrawSlot => {
    const g = inp.grid ?? fallback;
    const light = inp.light ?? host ?? ownLight(inp);
    const lit = inp.light ?? host;   // undefined = the slot's own lamp, exactly (the root at rest)
    const cfg = dressGrid(g, inp.view.zoom, inp.lodZoom);
    const wind = s.mat.prepare(encoder, inp.view, cfg.fadeIn, cfg.mat, inp.mat ?? STILL_MAT_FRAME, inp.present, theme.matLight, lit);
    // the objects by kind — each kind's records in paint order, and each object's index among its kind's
    const objects = inp.objects ?? [];
    const records = new Map<string, unknown[]>();
    for (const name of s.kinds.keys()) records.set(name, []);
    const indexOf: number[] = [];
    for (const o of objects) {
      const list = records.get(o.kind);
      if (!list) throw new Error(`ground: no kind "${o.kind}" is registered (${[...s.kinds.keys()].join(", ") || "none"})`);
      indexOf.push(list.length);
      list.push(o.record);
    }
    // each object's live inside, by its kind's own record index: what the face's own drawing gives way to
    const live = new Map<string, Map<number, number>>();
    const tell = (at: number, presence: number): void => {
      const o = objects[at];
      if (!o) return;   // no object there: nothing to tell (its inside, if any, draws over the slot's objects)
      const told = live.get(o.kind) ?? new Map<number, number>();
      told.set(indexOf[at] as number, presence);
      live.set(o.kind, told);
    };
    if (skipAt !== undefined && treeLive !== undefined) tell(skipAt, treeLive);
    const children: { at: number; slot: DrawSlot }[] = [];
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
      tell(p.at, liveOf(present));
      portals += 1;
    }
    // the kinds, in registration order: each lit by this slot's mat — its light, its lamp's gobo (MINIMAT.md §4) — at the objects'
    // presence, a spawned slot's pass first taking the root's laws, each told which of its records carries a live inside this frame
    const slot: SlotContext = { view: inp.view, fadeIn: g.fadeIn, cfg: g.mat, frame: inp.mat, present: objectsOf(inp.present), light: theme.matLight, lit, select: theme.select, theme };
    const drawn: [string, number][] = [];
    for (const k of s.kinds.values()) {
      const own = root.kinds.get(k.name);
      if (own && k.pass !== own.pass) k.pass.tune?.(own.pass);
      const told = live.get(k.name);
      drawn.push([k.name, k.pass.prepare(encoder, slot, records.get(k.name) ?? [], { live: (i) => told?.get(i) ?? -1 })]);
    }
    if (s === root) rootDrawn = drawn;
    return {
      mat: s.mat, present: inp.present, stats: gridStats(inp.view, wind), kinds: s.kinds,
      ...(inp.underlays?.length ? { underlays: inp.underlays } : {}),
      ...(objects.length ? { objects } : {}),
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
  return { incoming, outgoing, portals, kinds: Object.fromEntries(rootDrawn) };
}

export class Ground {
  readonly device: GPUDevice;
  readonly surface: Surface;
  /** The cutting mat — the root slot's; its plates, noise and glyph atlas are every slot's. */
  readonly mat: MatPass;
  /** The root slot's passes: the mat's and every registered kind's, by name (the registry, in registration order). */
  readonly root: SlotSet;
  /** Slots beyond the root — the departed desk's, the live insides of mini mats — spawned on first use. */
  readonly pool: SlotPool;
  /** The root's grid when a frame names none. */
  grid: GridConfig = DEFAULT_GRID;
  /** The desk's chrome — stratum 5 (D4a); null when the options named no marks shaders. */
  readonly marks: MarksPass | null;
  /** The hand — the focus behind an object in hand and the object over it (D4b); null when the options named no hold shaders. */
  readonly hold: HoldPass | null;
  /** The desk copy's cache (D4b): the stamp it was made for and the stats of that frame. */
  private readonly heldCache: HeldCache = { stamp: null, stats: null };

  private constructor(device: GPUDevice, surface: Surface, root: SlotSet, marks: MarksPass | null, hold: HoldPass | null) {
    this.device = device; this.surface = surface; this.mat = root.mat; this.root = root; this.marks = marks; this.hold = hold;
    this.pool = new SlotPool(root);
  }

  static async create(opts: GroundOptions): Promise<Ground> {
    const surf = opts.surface;
    const mat = await MatPass.create(opts.device, surf.format, opts.mat);
    const root = await createSlotSet(opts.device, surf.format, mat, opts.kinds);
    const [marks, hold] = await Promise.all([
      opts.marks === undefined ? null : MarksPass.create(opts.device, surf.format, opts.marks, mat),
      opts.hold === undefined ? null : HoldPass.create(opts.device, surf.format, opts.hold),
    ]);
    return new Ground(opts.device, surf, root, marks, hold);
  }

  /** The root's pass of the kind registered as `name` (undefined if none) — a host reaches its kind's own API through it: the note's ink pages, the whiteboard's rasters. */
  pass(name: string): KindPass | undefined { return this.root.kinds.get(name)?.pass; }

  /** Size the canvas to its CSS box; returns the CSS size and dpr the frame should use. (A host may size the canvas itself instead.) */
  fit(maxDpr = 2) { return this.surface.fit(maxDpr); }

  /** Render one frame now. Synchronous submit; the caller owns the cadence. */
  render(inputs: GroundFrameInputs): GroundStats {
    // the hand (D4b): at a carry above 0 the frame is the desk out of focus with the held object over it; at 0 it is the rest frame
    const held = inputs.held;
    if (held !== undefined && held.e > 0 && this.hold !== null) return renderHeldFrame(this.device, this.hold, this.root, this.pool, this.grid, this.surface, inputs, held, this.heldCache);
    const encoder = this.device.createCommandEncoder({ label: "ground" });
    const prepared = prepareFrame(encoder, this.root, this.pool, inputs, this.grid);
    const marked = inputs.marks !== undefined && this.marks !== null ? this.marks.prepare(inputs.marks) : 0;
    const bg = inputs.theme.canvasBg;
    const pass = beginPass(encoder, this.surface.view(), [bg[0], bg[1], bg[2], 1], "ground");
    const drawn = drawFrame(pass, this.surface.size(), inputs.view.dpr, prepared.incoming, prepared.outgoing);
    // stratum 5: the marks, over every slot and every stratum (drawFrame left the scissor on the whole view)
    if (marked > 0) this.marks?.draw(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return { ...drawn.incoming, kinds: prepared.kinds, outgoing: drawn.outgoing, portals: prepared.portals };
  }

  /** The pool's slots, then the root's kinds in reverse registration order, then the mat. */
  dispose(): void { this.pool.dispose(); for (const k of [...this.root.kinds.values()].reverse()) k.pass.dispose(); this.marks?.dispose(); this.hold?.dispose(); this.mat.dispose(); }
}

/** The desk copy's cache between held frames (D4b): the `stamp` it was made for (null: none yet) and the stats of that frame. */
export interface HeldCache { stamp: string | null; stats: GroundStats | null }

/** Where a held frame goes: the swap chain's view and size (the ground's surface, or the oracle's target dressed as one). */
export interface HeldInto { view(): GPUTextureView; size(): { readonly w: number; readonly h: number } }

/**
 * A HELD FRAME (design-015 §8; D4b) — shared by `Ground.render` and the Node oracle so both hosts draw it through one code path:
 *  1. the DESK COPY, only when its `stamp` moved: the frame WITHOUT the held object (the builder left it out), no marks, prepared
 *     and drawn at half the dpr into the hold pass's half-size target, then blurred — its own encoder, SUBMITTED FIRST: the root's
 *     passes are about to be prepared again for the hand, and a queue write lands before every later submit, never an earlier one;
 *  2. the HAND: the one object under the pose's camera, its kind's own pass into a transparent full-size target (no mat — a bare
 *     slot), the hand's light (the day's by night, as the carry rises);
 *  3. the FRAME: the desk out of focus (the sharp copy mixed toward the blurred one by the carry, dimmed), then the hand over it
 *     through the reading light. Two fullscreen draws; the marks stay quiet (the builder hands none).
 * Returns the desk copy's stats (the frame's objects behind the hand).
 */
export function renderHeldFrame(device: GPUDevice, hold: HoldPass, root: SlotSet, pool: SlotPool, grid: GridConfig, into: HeldInto, inputs: GroundFrameInputs, held: HeldFrameInputs, cache: HeldCache): GroundStats {
  const size = into.size();
  const dpr = inputs.view.dpr;
  const bg = inputs.theme.canvasBg;
  const remade = hold.fit(size.w, size.h);
  if (remade || cache.stamp !== held.stamp) {
    cache.stamp = held.stamp;
    const encoder = device.createCommandEncoder({ label: "hold/copy" });
    const { held: _held, marks: _marks, ...rest } = inputs;
    const copy: GroundFrameInputs = { ...rest, view: { ...inputs.view, dpr: dpr / 2 } };
    const prepared = prepareFrame(encoder, root, pool, copy, grid);
    const pass = beginPass(encoder, hold.desk.view, [bg[0], bg[1], bg[2], 1], "hold/copy");
    const drawn = drawFrame(pass, { w: hold.desk.width, h: hold.desk.height }, dpr / 2, prepared.incoming, prepared.outgoing);
    pass.end();
    hold.blur(encoder, (held.blur * dpr) / 2);
    device.queue.submit([encoder.finish()]);
    cache.stats = { ...drawn.incoming, kinds: prepared.kinds, outgoing: drawn.outgoing, portals: prepared.portals };
  }
  const encoder = device.createCommandEncoder({ label: "hold" });
  const handInputs: GroundFrameInputs = { view: held.view, grid: held.grid, objects: [held.object], theme: { ...inputs.theme, matLight: held.light } };
  const hand = prepareFrame(encoder, root, pool, handInputs, held.grid);
  const handPass = beginPass(encoder, hold.hand.view, [0, 0, 0, 0], "hold/hand");
  drawSlot(handPass, size, dpr, { ...hand.incoming, bare: true });
  handPass.end();
  const pass = beginPass(encoder, into.view(), [bg[0], bg[1], bg[2], 1], "hold");
  hold.composite(pass, { e: held.e, dim: held.dim, saturate: held.filter.saturate, brightness: held.filter.brightness });
  pass.end();
  device.queue.submit([encoder.finish()]);
  return cache.stats ?? { k0: 0, fade: 0, wind: false, kinds: hand.kinds, outgoing: null, portals: 0 };
}
