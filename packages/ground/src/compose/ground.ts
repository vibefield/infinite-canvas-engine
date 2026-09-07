// The ground: one device, one canvas, the passes, one render per call.
//
// There is no frame LOOP here on purpose. A host decides when a frame is due —
// the lab's rAF + dirty flags, ICE's reflector, the oracle's single call — and
// asks for exactly one. That is the shape ICE's layer already has (`always:
// true` with a private dirty union; an idle scene renders zero frames), so
// this drops in under it without owning a clock.
//
// One command buffer per frame:  [bake]  →  glyphs + frames in ONE render pass.
//
// A frame is a TREE of slots (PORTAL.md §2.2). The root slot is the frame the
// camera is in; a container whose face passes the gate carries a NESTED slot —
// its inside, under `outgoingCamera(M, cam)`, clipped to the face and drawn
// between the parent's cards below it and the cards above it, the container
// itself a hole (`mode: portal`). During a nav flight the arriving and the
// departed frames are the same tree: on enter the child is the arriving frame
// through the departed one's container, on exit the departed frame through
// the arriving one's — and since the child's camera at the cut IS the live
// portal's, nothing inside the face changes when the flight starts (§2.4). A
// frozen (depth-capped) flight has no portal and is two whole slots, the
// departed under on enter and over on exit (design-006's z-rule), fading.
//
// A nested slot is visible only where its face lies inside every face above
// it — the CHAIN (`Presentation.within`, PORTAL.md §10): the ground builds it
// from the tree, scissors to its bounding box and hands it to every pass. And
// a slot drawn beneath a HOLE fills its face grown by a device px, so the
// container's plate outside the face and the inside within it partition the
// edge pixel between them and nothing under the container ever shows.
//
// Slots beyond the root come from a POOL spawned on first use — no compile,
// no clock — and cost nothing while no portal is on screen and no flight is on.
//
// A slot also carries OVERLAYS (design-013 C1, D-C1.1): passes an app
// registers, each drawn either between the field and the frames (`under`:
// wires) or after them (`over`: guides). They are the ground's third draw
// layer and the only optional one — with none registered a slot allocates
// nothing for them and `drawSlot` calls nothing extra, so every scene renders
// byte for byte as it did before the seam existed (`compose/overlay.ts`).

import { surface, type Surface } from "../engine/device";
import { beginPass } from "../engine/target";
import { Field, type FieldShaders, type FieldStats } from "../field/field";
import type { FieldConfig, FieldFrame, FieldSource } from "../field/layout";
import type { GlyphProgram } from "../field/program";
import { FramePass, type FrameInstance, type FrameShaders } from "../card/frame-pass";
import type { ShellGeometry } from "../card/geometry";
import { type CardProgram, shellProgram } from "../card/program";
import { FillPass, type FillShaders } from "../nav/fill-pass";
import { boxOfPortal, chainOf, intersectBox, PORTAL_CHAIN, scissorOf, type Presentation } from "../nav/portal";
import { boxOf } from "../lattice/lod";
import type { OverlayInputs, OverlayPass, OverlayProgram, OverlayStage } from "./overlay";
import type { GroundTheme, RGB } from "../theme";

export interface GroundOptions {
  /**
   * The device the HOST owns — ICE's `acquireCompositorDevice()` at the fold (three adopts
   * it for islands), `gpu/device.ts` `acquire()` in a lab or the oracle. The ground never
   * makes one: every texture the compose pass samples must live on the same device.
   */
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly field: FieldShaders;
  readonly frames: FrameShaders;
  /** The portal fill (nav/fill-pass.ts). */
  readonly fill: FillShaders;
  /** The card program (design-014): the engine's shell unless an app registers its own (`vfFrame()`). */
  readonly card?: CardProgram<ShellGeometry>;
  /** Grid programs beyond the engine's dot (`needleGlyph`, `cuttingMat`). */
  readonly grids?: readonly GlyphProgram[];
  /**
   * Overlay passes (design-013 C1): the wires and the guides, or an app's own.
   * Each is created once and spawned per slot; each slot's data rides
   * `SlotInputs.overlays` under the overlay's name. None = the ground has no
   * overlay stage at all.
   */
  readonly overlays?: readonly OverlayProgram[];
}

/** One frame's ground: its camera, grid, sources, cards and presentation — the root's, a departed frame's, or a container's inside. */
export interface SlotInputs extends FieldFrame {
  /** The grid; the root may leave it unset and set `ground.fieldConfig` instead — every other slot names its own. */
  readonly config?: FieldConfig;
  readonly sources: readonly FieldSource[];
  readonly frames: readonly FrameInstance[];
  /** The live portals among THIS frame's containers (PORTAL.md): each drawn before the container it belongs to. */
  readonly portals?: readonly PortalInputs[];
  /**
   * This slot's overlay data by name (design-013 C1): the wires' and the guides'
   * `TriSoup`s for the root, nothing for a nested portal slot or a flight's
   * departed slot (D-C1.3 — they cut at the switch). A name the ground has no
   * registered overlay for is ignored; an overlay with no entry draws nothing.
   */
  readonly overlays?: OverlayInputs;
}

/**
 * A container's inside through its face (PORTAL.md §2.1): `present` carries
 * the presence (its opacity) and the face (its clip); `view` may leave `box`
 * unset — the ground sizes the slot's box from the clip. `plate` is the
 * container's surface: the fill crosses from it to the inside's canvas as the
 * presence rises, so under the gate a fading portal lands on the plate.
 */
export interface PortalInputs extends SlotInputs {
  readonly config: FieldConfig;
  /** The container's index in the parent's `frames` (paint order): the slot draws just before it; the container wears `mode: portal`. */
  readonly at: number;
  readonly plate: RGB;
}

/** The departed frame's ground for one flight frame: its own camera, config, content and presentation. */
export interface OutgoingInputs extends SlotInputs {
  readonly config: FieldConfig;
  /** design-006's z-rule for a FROZEN flight: under on enter, over on exit. */
  readonly order: "under" | "over";
  /**
   * ENTER through a live portal (PORTAL.md §2.4): the container's index in the
   * DEPARTED frame's `frames` — the two frames draw as one tree, the arriving
   * one through the container, so the cards over the container stay over the
   * inside and fade with their frame (a live portal of the departed frame at
   * the same index is neither prepared nor drawn: the arriving frame is that
   * face). Absent = two whole slots, `order` decides: a frozen flight, and
   * every EXIT — the departed inside draws OVER the whole parent (whose own
   * live portal shows the same pixels under it) and fades onto them at the
   * landing, the cards over the container appearing through that fade instead
   * of popping in at the cut.
   */
  readonly at?: number;
}

export interface GroundFrameInputs extends SlotInputs {
  /** The theme in force (`theme.ts`): the clear colour, every frame colour and the mat's light (the Sun or the Moon) come from it. */
  readonly theme: GroundTheme;
  /** Present only while a nav flight is on. */
  readonly outgoing?: OutgoingInputs;
}

export interface GroundStats extends FieldStats {
  readonly frames: number;
  /** The departed slot's stats while a flight is on. */
  readonly outgoing: (FieldStats & { readonly frames: number }) | null;
  /** Live portals drawn this frame, the root's and the departed frame's together. */
  readonly portals: number;
}

/** One slot's passes for `drawFrame` — the ground's own, or the oracle's. A portal-clipped slot carries the fill prepared for it; a parent carries its nested slots. */
export interface DrawSlot {
  readonly field: Field;
  readonly frames: FramePass;
  readonly present?: Presentation | undefined;
  readonly fill?: FillPass | undefined;
  /** Nested slots, each drawn before the parent's card `at` (PORTAL.md §2.2). */
  readonly children?: readonly { readonly at: number; readonly slot: DrawSlot }[] | undefined;
  /** The overlays this slot prepared something for, by stage (D-C1.1). Absent = none registered, or none with data this frame. */
  readonly overlays?: SlotOverlays | undefined;
}

/** One slot's prepared overlays, split by stage so the draw is two loops and no test. */
export interface SlotOverlays {
  readonly under: readonly OverlayPass[];
  readonly over: readonly OverlayPass[];
}

/** A slot at opacity 0 draws nothing: "source over" with alpha 0 leaves every pixel as it was, in both blend modes. */
export const visible = (p: Presentation | undefined): boolean => (p?.opacity ?? 1) > 0;

/** An overlay INSTANCE in a slot: the program's identity, this slot's pass. */
export interface SlotOverlay { readonly name: string; readonly stage: OverlayStage; readonly pass: OverlayPass }

/** The passes one slot owns. The root's are the ground's; the pool spawns the rest on the same pipelines. */
export interface SlotSet {
  readonly field: Field;
  readonly frames: FramePass;
  readonly fill: FillPass;
  /** The registered overlays, one instance per slot; absent (or empty) = none. */
  readonly overlays?: readonly SlotOverlay[];
}

/** Slots beyond the root, spawned on first use and reused every frame: `reset()` then `acquire()` per slot the frame needs. */
export class SlotPool {
  private readonly slots: SlotSet[] = [];
  private used = 0;
  private readonly root: SlotSet;
  constructor(root: SlotSet) { this.root = root; }
  reset(): void { this.used = 0; }
  acquire(): SlotSet {
    if (this.used === this.slots.length) {
      const overlays = this.root.overlays ?? [];
      this.slots.push({
        field: this.root.field.spawn(), frames: this.root.frames.spawn(), fill: this.root.fill.spawn(),
        ...(overlays.length ? { overlays: overlays.map((o) => ({ name: o.name, stage: o.stage, pass: o.pass.spawn() })) } : {}),
      });
    }
    return this.slots[this.used++] as SlotSet;
  }
  /** Slots spawned so far — the churn instrument. */
  get size(): number { return this.slots.length; }
  dispose(): void { for (const s of this.slots) { s.field.dispose(); s.frames.dispose(); s.fill.dispose(); for (const o of s.overlays ?? []) o.pass.dispose(); } this.slots.length = 0; this.used = 0; }
}

/**
 * Draw one slot into an open render pass: scissored to its portal (nothing
 * outside it is shaded), opaque through it (its `fill`), skipped outright at
 * opacity 0, its frames drawn in paint order around its nested slots, each
 * of which restores the parent's scissor after itself, and its overlays at
 * their two stages — `under` between the field and the frames, `over` after
 * the last of them (the parent's scissor is back in force by then). Returns
 * whether it drew.
 */
export function drawSlot(pass: GPURenderPassEncoder, size: { readonly w: number; readonly h: number }, dpr: number, slot: DrawSlot): boolean {
  if (!visible(slot.present)) return false;
  const [x, y, w, h] = scissorOf(slot.present, dpr, size);
  if (w === 0 || h === 0) return false;   // the portal is off screen: nothing to shade
  pass.setScissorRect(x, y, w, h);
  if (slot.present?.portal) slot.fill?.draw(pass);
  slot.field.draw(pass);
  for (const o of slot.overlays?.under ?? []) o.draw(pass);
  let from = 0;
  const kids = slot.children ? [...slot.children].sort((a, b) => a.at - b.at) : [];
  for (const k of kids) {
    slot.frames.drawRange(pass, from, k.at);
    from = k.at;
    if (drawSlot(pass, size, dpr, k.slot)) pass.setScissorRect(x, y, w, h);
  }
  slot.frames.drawRange(pass, from, Number.MAX_SAFE_INTEGER);
  for (const o of slot.overlays?.over ?? []) o.draw(pass);
  return true;
}

/**
 * Record one frame into an open render pass: the root slot with its nested
 * slots, and — while a flight is on — the departed slot: through the
 * container as one tree (`outgoing.at`), or whole, under or over, when the
 * flight is frozen. Shared with the Node oracle so both hosts draw a frame
 * through the same code. Returns each slot's field stats (null = not drawn).
 */
export function drawFrame(pass: GPURenderPassEncoder, size: { readonly w: number; readonly h: number }, dpr: number, incoming: DrawSlot, outgoing?: (DrawSlot & { readonly order: "under" | "over"; readonly at?: number | undefined }) | null): { incoming: FieldStats; outgoing: FieldStats | null } {
  let drewOut = false;
  let drewIn = false;
  if (outgoing && outgoing.at !== undefined) {
    // A portal flight: one tree. Enter = the arriving frame through the departed one's container; exit = the departed frame through the arriving one's.
    const enter = outgoing.order === "under";
    const parent = enter ? outgoing : incoming;
    const child = enter ? incoming : outgoing;
    const at = outgoing.at;
    const tree: DrawSlot = { ...parent, children: [...(parent.children ?? []).filter((k) => k.at !== at), { at, slot: child }] };
    const drewParent = drawSlot(pass, size, dpr, tree);
    // the child drew iff the parent did and the child is visible with a portal on screen
    const drewChild = drewParent && visible(child.present) && scissorOf(child.present, dpr, size)[2] > 0 && scissorOf(child.present, dpr, size)[3] > 0;
    drewIn = enter ? drewChild : drewParent; drewOut = enter ? drewParent : drewChild;
  } else {
    if (outgoing?.order === "under") drewOut = drawSlot(pass, size, dpr, outgoing);
    drewIn = drawSlot(pass, size, dpr, incoming);
    if (outgoing?.order === "over") drewOut = drawSlot(pass, size, dpr, outgoing);
  }
  pass.setScissorRect(0, 0, size.w, size.h);
  return { incoming: incoming.field.stats, outgoing: outgoing && drewOut ? outgoing.field.stats : null };
}

/** What `prepareFrame` hands the draw: the two slots and the counts the stats report. */
export interface PreparedFrame {
  readonly incoming: DrawSlot;
  readonly outgoing: (DrawSlot & { readonly order: "under" | "over"; readonly at?: number | undefined }) | null;
  readonly frames: number;
  readonly outFrames: number;
  readonly portals: number;
}

/** The tuning every slot copies from the root's frame pass each frame. */
const tuneFrom = (from: FramePass, to: FramePass): void => { to.exact = from.exact; to.lines = from.lines; };

/**
 * Upload one frame's records into its slots — the root's, each live portal's
 * (from the pool), the departed frame's — bake what changed, prepare the fills,
 * and return the draw tree. Shared by the ground and the Node oracle.
 */
export function prepareFrame(encoder: GPUCommandEncoder, root: SlotSet, pool: SlotPool, inputs: GroundFrameInputs): PreparedFrame {
  pool.reset();
  const theme = inputs.theme;
  const bg = theme.canvasBg;
  let portals = 0;
  // exact at both ends: a full presence fills with the canvas colour ITSELF, the number the flight's fill uses (§2.4's bit-for-bit)
  const mix = (a: RGB, b: RGB, t: number): RGB => (t >= 1 ? b : t <= 0 ? a : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  const attach = { width: inputs.view.width, height: inputs.view.height };
  // `grow`: device px the slot's own face is grown by in its fill — 1 for a slot drawn beneath a hole (§10); `skipAt`: a portal of this slot not to prepare.
  const prepare = (s: SlotSet, inp: SlotInputs, fillColour: RGB, fillPresent: Presentation | undefined, grow: number, skipAt?: number): { n: number; slot: DrawSlot } => {
    if (inp.config) s.field.config = inp.config;
    tuneFrom(root.frames, s.frames);
    s.field.prepare(encoder, inp, inp.sources, theme);
    const n = s.frames.prepare(inp.view, theme, inp.frames, inp.present);
    // The overlays this slot has DATA for (D-C1.1). An overlay with no entry under its name — every
    // nested portal slot and the flight's departed slot, by D-C1.3 — is not prepared and not drawn.
    const under: OverlayPass[] = [];
    const over: OverlayPass[] = [];
    for (const o of s.overlays ?? []) {
      const data = inp.overlays?.[o.name];
      if (data === undefined || !o.pass.prepare(encoder, inp, data, theme)) continue;
      (o.stage === "under" ? under : over).push(o.pass);
    }
    const overlays: SlotOverlays | undefined = under.length || over.length ? { under, over } : undefined;
    let fill: FillPass | undefined;
    if (fillPresent?.portal && visible(fillPresent)) { s.fill.prepare(inp.view, fillColour, fillPresent, grow); fill = s.fill; }
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
      const pres = p.present.opacity;
      // The fill is opaque and crosses from the container's plate to the inside's canvas as the presence rises (PORTAL.md §2.5);
      // the inside's grid and cards ride the presence itself.
      const present: Presentation = { opacity: pres, portal: p.present.portal, within };
      const child = prepare(pool.acquire(), { ...p, view: { ...p.view, box }, present }, mix(p.plate, bg, pres), { opacity: 1, portal: p.present.portal, within }, 1);
      children.push({ at: p.at, slot: child.slot });
      portals += 1;
    }
    return { n, slot: { field: s.field, frames: s.frames, present: inp.present, fill, ...(children.length ? { children } : {}), ...(overlays ? { overlays } : {}) } };
  };
  // ENTER through a live portal: the arriving frame is drawn beneath the departed frame's hole, so its fill grows like any nested slot's.
  const enterTree = inputs.outgoing !== undefined && inputs.outgoing.at !== undefined && inputs.outgoing.order === "under";
  const inc = prepare(root, inputs, bg, inputs.present, enterTree ? 1 : 0);
  let outgoing: PreparedFrame["outgoing"] = null;
  let outFrames = 0;
  // A departed slot at opacity 0 (the last quarter of an enter, the tail of a frozen dissolve) is neither prepared nor drawn.
  if (inputs.outgoing && visible(inputs.outgoing.present)) {
    const o = inputs.outgoing;
    // on enter the departed frame's own portal at the container is the arriving frame's face — never prepared twice
    const out = prepare(pool.acquire(), o, bg, o.present, 0, enterTree ? o.at : undefined);
    outFrames = out.n;
    outgoing = { ...out.slot, order: o.order, at: o.at };
  }
  return { incoming: inc.slot, outgoing, frames: inc.n, outFrames, portals };
}

export class Ground {
  readonly device: GPUDevice;
  readonly surface: Surface;
  readonly field: Field;
  readonly frames: FramePass;
  readonly fill: FillPass;
  /** The root slot's overlay instances, in registration order (design-013 C1); empty = none registered. */
  readonly overlays: readonly SlotOverlay[];
  /** Slots beyond the root — the departed frame's, the live portals' — spawned on first use. */
  readonly pool: SlotPool;

  private constructor(device: GPUDevice, surface: Surface, field: Field, frames: FramePass, fill: FillPass, overlays: readonly SlotOverlay[]) {
    this.device = device; this.surface = surface; this.field = field; this.frames = frames; this.fill = fill; this.overlays = overlays;
    this.pool = new SlotPool({ field, frames, fill, ...(overlays.length ? { overlays } : {}) });
  }

  static async create(opts: GroundOptions): Promise<Ground> {
    const surf = surface(opts.device, opts.canvas);
    const programs = opts.overlays ?? [];
    const [field, frames, fill, ...passes] = await Promise.all([
      Field.create(opts.device, surf.format, { ...opts.field, glyphs: [...opts.field.glyphs, ...(opts.grids ?? [])] }),
      FramePass.create(opts.device, surf.format, opts.frames, opts.card ?? shellProgram),
      FillPass.create(opts.device, surf.format, opts.fill),
      ...programs.map((o) => o.create(opts.device, surf.format)),
    ]);
    const overlays = programs.map((o, i) => ({ name: o.name, stage: o.stage, pass: passes[i] as OverlayPass }));
    return new Ground(opts.device, surf, field, frames, fill, overlays);
  }

  /** The card program the frames draw through. */
  get card(): CardProgram<ShellGeometry> { return this.frames.program; }

  set fieldConfig(cfg: FieldConfig) { this.field.config = cfg; }
  get fieldConfig(): FieldConfig { return this.field.config; }
  /** The page array every `page` card samples (design-013 §10.4), shared by every slot; `null` = none. A slot rebinds at its next prepare. */
  setPages(view: GPUTextureView | null): void { this.frames.setPages(view); }

  /** Size the canvas to its CSS box; returns the CSS size and dpr the frame should use. (A host may size the canvas itself instead.) */
  fit(maxDpr = 2) { return this.surface.fit(maxDpr); }

  /** Render one frame now. Synchronous submit; the caller owns the cadence. */
  render(inputs: GroundFrameInputs): GroundStats {
    const encoder = this.device.createCommandEncoder({ label: "ground" });
    const prepared = prepareFrame(encoder, { field: this.field, frames: this.frames, fill: this.fill, ...(this.overlays.length ? { overlays: this.overlays } : {}) }, this.pool, inputs);
    const bg = inputs.theme.canvasBg;
    const pass = beginPass(encoder, this.surface.view(), [bg[0], bg[1], bg[2], 1], "ground");
    const drawn = drawFrame(pass, this.surface.size(), inputs.view.dpr, prepared.incoming, prepared.outgoing);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return { ...drawn.incoming, frames: prepared.frames, outgoing: drawn.outgoing ? { ...drawn.outgoing, frames: prepared.outFrames } : null, portals: prepared.portals };
  }

  dispose(): void { this.pool.dispose(); this.fill.dispose(); this.field.dispose(); this.frames.dispose(); for (const o of this.overlays) o.pass.dispose(); }
}
