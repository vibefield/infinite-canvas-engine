// THE SPECIMENS ON THE BOARD (design-017 §8; K5a) — each kind hung on the tray, drawn by its OWN kind's pass (K-L3's per-slot machinery:
// no kind learns about the tray). A specimen is its object at its natural size (the widget's `defaultSize` — what its kind draws it at;
// the photo, the notebook and the calendar size themselves by their laws, never by their rect) seen through the drawer at the scale its
// hang asks: its slot's view block is the DRAWER'S CAMERA — the face's top-left, the shown scroll, the band in it — scaled about the
// specimen (zoom = hang ÷ natural), so a scroll of Δ moves it Δ on screen exactly as it moves the board. Its lamp is the board's (the
// research's HOME lamp, D-K3.4): its shadow falls on the board as the accessories' do. Its hover is the kinds' own `lift` and `hover`
// (flux — the tray's springs). A PURE module for the frames; `TraySlots` holds the GPU half — one slot per specimen, each kind's pass
// SPAWNED from the root's, a composite kind's (root only, D-D18) made from its program the first time the tray shows one.

import type { TrayAccessory } from "@ice/kernel";
import type { GridConfig } from "../mat/grid";
import type { Lamp } from "../mat/lamp";
import type { SlotKind, SlotSet } from "../ground";
import type { KindProgram } from "../kind";
import type { ObjectContext, ObjectKind } from "../kinds/world";
import type { View } from "../lattice/lod";
import type { PortalClip, Presentation } from "../nav/portal";
import type { GroundTheme } from "../theme";
import { DRAWER, type DrawerRect } from "./drawer";
import { TRAY_LOOK } from "./look";

/** A specimen as the renderer reads it — from the world (the reflector), or a still's scene (the oracle). */
export interface TraySpecimen {
  /** A stable key for the kind's persistent records (the world's entity; a still's index). */
  readonly key: number;
  readonly type: string;
  readonly kind: ObjectKind;
  /** The object's own size — the size its kind draws it at (the widget's `defaultSize`). */
  readonly natural: { readonly w: number; readonly h: number };
  /** Where it hangs, board px (x from the drawer's left edge, y down from the board's top at scroll 0): its `Position` and `Size`. */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly props: Readonly<Record<string, unknown>>;
  /** Its hang's accessory and pegs (pitches from its hang point) — the entry's. */
  readonly accessory: TrayAccessory;
  readonly pegs: readonly (readonly [number, number])[];
  readonly label: string;
}

/** One specimen this frame: its kind's record under its own view block, where it is on screen, its accessory's pegs on screen, its tag. */
export interface TraySpecimenFrame {
  readonly type: string;
  /** The kind's registry name, and the record its `record` made for this frame. */
  readonly kind: string;
  readonly record: unknown;
  readonly key: number;
  /** Its slot's camera: the drawer's, scaled about it. */
  readonly view: View & { readonly dpr: number };
  readonly grid: GridConfig;
  /** Its rect on screen, CSS px. */
  readonly screen: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  /** Its pegs' hole centres on screen, CSS px. */
  readonly pegs: readonly (readonly [number, number])[];
  readonly accessory: TrayAccessory;
  readonly label: string;
}

/** The drawer this frame, as its flux drew it: the rect and the SHOWN scroll (the band in it). */
export interface TrayDrawn {
  readonly rect: DrawerRect;
  readonly scroll: number;
}

/** What building the frames needs of the desk: the view, the theme, the root's grid, the kinds' looks, each specimen's hover lift (0 … 1). */
export interface TraySpecimenEnv {
  readonly view: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly theme: GroundTheme;
  readonly grid: GridConfig;
  readonly looks: ReadonlyMap<string, unknown>;
  readonly lift: (type: string) => number;
}

/** The FACE the specimens show through: inside the rim, its top corners rounded as the rim's inner edge, its foot past the view's. */
export function faceClip(rect: DrawerRect, vh: number): PortalClip {
  const rim = DRAWER.rim;
  const x0 = rect.x + rim;
  const x1 = rect.x + rect.w - rim;
  const y0 = rect.y + rim;
  const y1 = Math.max(vh, rect.y + rect.h) + DRAWER.radius;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, r: DRAWER.radius - rim };
}

/** The tray's grid: the root's with no gobo dapple (D-K3.6 — the drawer lies above the desk; the wind would wake it). */
export function trayGrid(grid: GridConfig): GridConfig {
  return { ...grid, mat: { ...grid.mat, gobo: { ...grid.mat.gobo, opacity: 0 } } };
}

/** How high over a specimen the board's lamp stands, in the specimen's own units per its size — far enough that its light is the lamp's direction. */
const LAMP_FAR = 40;

/** The board's lamp over a point, in the specimen's own units: along the HOME lamp's direction, far off (its light parallel, as the board's is). */
function lampOver(cx: number, cy: number, size: number): Lamp {
  const L = TRAY_LOOK.lamp;
  const h = LAMP_FAR * size;
  return { x: cx + (L[0] / L[2]) * h, y: cy + (L[1] / L[2]) * h, h };
}

/**
 * The specimens this frame: each culled where it cannot show (its rect and its reach outside the face), else resolved and recorded by
 * its OWN kind — its object at its natural size, centred on its world origin, under the drawer's camera scaled about it — with the
 * board's lamp, the tray's grid, the kind's look, its hover (the kinds' `lift`, a share of the hold's, and `hover`), no local and no
 * asset (a specimen writes nothing into a kind's state on the desk).
 */
export function specimenFrames(specimens: readonly TraySpecimen[], drawn: TrayDrawn, env: TraySpecimenEnv): TraySpecimenFrame[] {
  const out: TraySpecimenFrame[] = [];
  const P = DRAWER.pitch;
  const grid = trayGrid(env.grid);
  const { width, height, dpr } = env.view;
  const face = faceClip(drawn.rect, height);
  for (const s of specimens) {
    const x0 = drawn.rect.x + s.rect.x;
    const y0 = drawn.rect.y + s.rect.y - drawn.scroll;
    const reach = P * 2;
    if (y0 + s.rect.h + reach < face.cy - face.hy || y0 - reach > Math.min(height, face.cy + face.hy)) continue;
    const zoom = Math.min(s.rect.w / s.natural.w, s.rect.h / s.natural.h);
    const cx = x0 + s.rect.w / 2;
    const cy = y0 + s.rect.h / 2;
    const view = { camX: -cx / zoom, camY: -cy / zoom, zoom, width, height, dpr };
    const h = Math.min(Math.max(env.lift(s.type), 0), 1);
    const ctx: ObjectContext = {
      entity: s.key as ObjectContext["entity"],
      rect: { cx: 0, cy: 0, w: s.natural.w, h: s.natural.h },
      props: s.props,
      flux: { lift: TRAY_LOOK.hoverLift * h, hover: h, ring: 0, fade: 1 },
      look: env.looks.get(s.kind.name),
      theme: env.theme,
      lamp: lampOver(0, 0, Math.max(s.natural.w, s.natural.h)),
      view,
      grid,
      dt: 0,
    };
    const record = s.kind.record(s.kind.resolve(ctx), ctx);
    // the hang point: the top edge's centre, or a shelf's bottom edge's; the pegs from it
    const hx = x0 + s.rect.w / 2;
    const hy = s.accessory === "shelf" ? y0 + s.rect.h : y0;
    out.push({
      type: s.type, kind: s.kind.name, record, key: s.key, view, grid,
      screen: { x0, y0, x1: x0 + s.rect.w, y1: y0 + s.rect.h },
      pegs: s.pegs.map(([dx, dy]) => [hx + dx * P, hy + dy * P] as const),
      accessory: s.accessory, label: s.label,
    });
  }
  return out;
}

/** The accessories' numbers (theme.ts `TRAY.accessory`): the kind index the shader reads, each's standing-off in pitches. */
export const ACCESSORY_INDEX: Readonly<Record<TrayAccessory, number>> = { hook: 0, shelf: 1, clip: 2, rail: 3 };

/** One specimen's accessory record (tray.wgsl `TrayAccessory`), screen CSS px: its quad the accessory's footprint and its shadow's reach. */
export function accessoryOf(f: TraySpecimenFrame): { readonly box: number[]; readonly kind: number[]; readonly rect: number[]; readonly pegs0: number[]; readonly pegs1: number[] } {
  const P = DRAWER.pitch;
  const lift = TRAY_LOOK.accessoryHeight[f.accessory] * P;
  const L = TRAY_LOOK.lamp;
  const push = Math.hypot(L[0], L[1]) / L[2] * lift + TRAY_LOOK.lampSize * lift / L[2] + 2;
  let x0 = f.screen.x0 - 0.5 * P;
  let x1 = f.screen.x1 + 0.5 * P;
  let y0 = f.screen.y0;
  let y1 = f.screen.y1 + 0.5 * P;
  for (const [x, y] of f.pegs) { x0 = Math.min(x0, x - 0.8 * P); x1 = Math.max(x1, x + 0.8 * P); y0 = Math.min(y0, y - 0.5 * P); y1 = Math.max(y1, y + 0.9 * P); }
  const peg = (i: number): readonly [number, number] => f.pegs[i] ?? [0, 0];
  return {
    box: [x0 - push, y0 - push, x1 + push, y1 + push],
    kind: [ACCESSORY_INDEX[f.accessory], Math.min(f.pegs.length, 4), lift, 0],
    rect: [f.screen.x0, f.screen.y0, f.screen.x1, f.screen.y1],
    pegs0: [...peg(0), ...peg(1)],
    pegs1: [...peg(2), ...peg(3)],
  };
}

/** The presentation every specimen's slot is drawn through: whole, clipped to the face. */
export function facePresent(drawn: TrayDrawn, vh: number): Presentation {
  return { opacity: 1, portal: faceClip(drawn.rect, vh) };
}

/**
 * THE TRAY'S SLOTS (the GPU half): one per specimen type, each its own view block (the mat spawned from the root's — K-L3) and its kind's
 * pass: SPAWNED from the root's (its buffers on the shared pipelines), or — a composite kind, root only by D-D18 (its spawned pass draws
 * nothing) — made from the kind's program on the slot's mat, once, the first time the tray shows one (`warm`; async, so the specimen
 * shows from the frame after it is made — `onReady` asks for that frame). Freed with the ground.
 */
export class TraySlots {
  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly root: SlotSet;
  private readonly programs: ReadonlyMap<string, KindProgram>;
  private readonly slots = new Map<string, SlotSet>();
  private readonly making = new Set<string>();
  private disposed = false;

  constructor(device: GPUDevice, format: GPUTextureFormat, root: SlotSet, programs: readonly KindProgram[]) {
    this.device = device;
    this.format = format;
    this.root = root;
    this.programs = new Map(programs.map((p) => [p.name, p] as const));
  }

  /** The slot of a specimen `type` of kind `kind`: spawned at once for a kind that spawns; undefined while a composite kind's pass is made. */
  get(type: string, kind: string): SlotSet | undefined {
    const had = this.slots.get(type);
    if (had !== undefined) return had;
    const own = this.root.kinds.get(kind);
    if (own === undefined || own.composite === true) return undefined;
    const mat = this.root.mat.spawn();
    const slot: SlotSet = { mat, kinds: new Map<string, SlotKind>([[kind, { ...own, pass: own.pass.spawn(mat) }]]) };
    this.slots.set(type, slot);
    return slot;
  }

  /** Make the passes of the composite kinds among `wanted` ([type, kind]) not made yet; `onReady` when each is (a frame is due). */
  warm(wanted: readonly (readonly [string, string])[], onReady: () => void): void {
    for (const [type, kind] of wanted) {
      if (this.slots.has(type) || this.making.has(type)) continue;
      const own = this.root.kinds.get(kind);
      const program = this.programs.get(kind);
      if (own?.composite !== true || program === undefined) continue;
      this.making.add(type);
      const mat = this.root.mat.spawn();
      void program.create(this.device, this.format, mat).then((pass) => {
        this.making.delete(type);
        if (this.disposed) { pass.dispose(); mat.dispose(); return; }
        this.slots.set(type, { mat, kinds: new Map<string, SlotKind>([[kind, { ...own, pass }]]) });
        onReady();
      }, (err: unknown) => { this.making.delete(type); mat.dispose(); console.error(`desk: the tray's ${kind} pass could not be made`, err); });
    }
  }

  /** Every composite kind's pass among `wanted`, made now — a still's host (the oracle) waits for them. */
  async ready(wanted: readonly (readonly [string, string])[]): Promise<void> {
    let pending = 0;
    await new Promise<void>((resolve) => {
      this.warm(wanted, () => { pending -= 1; if (pending <= 0) resolve(); });
      pending = this.making.size;
      if (pending === 0) resolve();
    });
    for (const [type, kind] of wanted) this.get(type, kind);
  }

  /** The slots made so far (a rig's witness). */
  get size(): number { return this.slots.size; }

  dispose(): void {
    this.disposed = true;
    for (const s of this.slots.values()) { s.mat.dispose(); for (const k of s.kinds.values()) k.pass.dispose(); }
    this.slots.clear();
  }
}
