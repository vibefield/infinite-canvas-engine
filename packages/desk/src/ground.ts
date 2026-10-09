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
import { CardPass, type CardShared, createCardShared } from "./card/card";
import { faultText, type KindFault } from "./faults";
import { MISSING_KIND } from "./missing/object";
import { type MissingFaces, missingFaces } from "./missing/pass";
import { spawnInside, swapToMissing } from "./missing/slots";
import { beginPass, Target } from "./engine/target";
import { HoldPass } from "./hold/focus";
import type { HoldShaders } from "./hold/shaders";
import { type KindExtra, type KindPass, type KindProgram, type RenderTarget, type SlotContext, STRATA, type StratumName } from "./kind";
import { boxOf, type View } from "./lattice/lod";
import type { MatLight } from "./mat/night";
import { DEFAULT_GRID, dressGrid, type GridConfig, type GridStats, gridStats, type SlotFrame } from "./mat/grid";
import { type SlotLight, STILL_MAT_FRAME } from "./mat/layout";
import { CuttingMat } from "./mat/mat-pass";
import type { MatShaders } from "./mat/shaders";
import { type MarksInput, unselectedMarks } from "./marks/layout";
import { MarksPass } from "./marks/pass";
import type { MarksShaders } from "./marks/shaders";
import { type TrayFrameInputs, TrayPass } from "./tray/pass";
import type { TrayShaders } from "./tray/shaders";
import { facePresent, type TrayCarriedFrame, TraySlots } from "./tray/specimens";
import { DRAWER, drawerRect } from "./tray/drawer";
import { boxOfPortal, chainOf, intersectBox, PORTAL_CHAIN, scissorOf, type Presentation } from "./nav/portal";
import type { GroundTheme } from "./theme";

export type { CardBinding, CardMaterial, KindExtra, KindPass, KindProgram, RenderTarget, SlotContext, StratumName } from "./kind";
export { STRATA } from "./kind";
export type { MarkBar, MarkBox, MarkFrame, MarkGuide, MarkMarquee, MarkObject, MarkRuler, MarksInput, MarkTape, MarkUnion } from "./marks/layout";
export { MARKS_SHADER_FILES, marksShaders } from "./marks/shaders";
export type { TrayFrameInputs } from "./tray/pass";
export { TRAY_SHADER_FILES, trayShaders } from "./tray/shaders";

export interface GroundOptions {
  /**
   * The device the HOST owns — the engine's (`acquireCompositorDevice()`, handed to the layer through its
   * context) or the layer's own (`engine/device.ts` `acquire()`, as the oracle's is). The ground never
   * makes one: every texture the compose pass samples must live on the same device.
   */
  readonly device: GPUDevice;
  /**
   * The swap chain the frames go into — the HOST makes it (`surface(device, canvas)` from
   * `@ice/desk`'s src/host/, the one module that names a canvas; a test's fake), so this composition
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
  /**
   * The pegboard tray (tray/pass.ts; design-017, K3): the drawer, drawn in the ROOT's pass after the marks when a frame names its
   * `tray`. Absent = a ground with no tray.
   */
  readonly tray?: TrayShaders;
  /**
   * A GPU error the kinds' creation window caught that no kind raises alone (petition I24, `createKindPasses`): not a kind's — told
   * here as the device would have told its uncaptured-error handler (the layer's `onError`: `degraded`). Absent: it is said on the console.
   */
  readonly onError?: (error: GPUError) => void;
  /**
   * THE KIND BOUNDARY IN THE RENDER HALF (design-019 §8, M24 LT3 — `RenderBoundary`): a kind's pass that throws in a frame is handed
   * here and the frame goes on without it. Absent (a unit's ground): a throw leaves the frame, as before.
   */
  readonly boundary?: RenderBoundary;
}

/**
 * THE KIND BOUNDARY IN THE RENDER HALF (design-019 §8, M24 LT3 — petition I24's strikes, extended past the world half): what a kind's
 * PASS is asked in a frame — `spawn` (a slot's own), `tune`, `prepare`, `dropped`, `cardSlot`, `drawRange`, `drawOver`, `endHold`, the
 * tray's `idle` and `idleAt` — is asked inside it, in every slot alike (the root, a mini mat's inside, a departed desk, the hand, a
 * capture, a tray specimen): a throw is handed to `threw` and that SLOT draws nothing more of the kind this frame (a `prepare` that
 * threw left its buffers half-written; a `drawRange` that threw may have drawn part of its run), while every other kind draws. The
 * render pass stays usable: a JS throw between two commands records nothing, every run sets its own pipeline and bind groups, and the
 * slot's scissor is set again (a kind may have narrowed it). The HOST counts each throw as a strike against the kind AFTER the frame —
 * the third quarantines it, and a quarantine swaps the very passes a frame is encoded with (`Ground.quarantine`), so it may not happen
 * inside one. `watch`: each kind's `prepare` also runs in a GPU `validation` error scope of its own on `device`, and an error raised
 * there — a write past a buffer, a resource the kind made wrong — is the kind's (`gpu`), never the device's uncaptured handler's.
 * What a kind records into the frame's encoder or draws into its pass is validated later, at the pass's end or the submit, and stays
 * unattributed (the layer's `degraded`). The desk's own passes (the mat, the marks, the hand's composite, the card, the missing face)
 * are not a kind's: a throw from them leaves the frame, as before.
 */
export interface RenderBoundary {
  /** `kind`'s pass threw `err` in `call` (this frame, or a capture's): the host strikes it once the frame is done. */
  threw(kind: string, call: string, err: unknown): void;
  /** Watch each kind's `prepare` in a GPU error scope of its own — a few µs a kind a slot a frame (rig:live states it); false: unwatched. */
  watch: boolean;
  /** The device the scopes are pushed on (the ground's). */
  readonly device: GPUDevice;
  /** A GPU error raised inside `kind`'s `prepare` (its scope; told later, when the device answers): the host strikes it. */
  gpu(kind: string, error: GPUError): void;
}

/** A layer a host rendered first, laid on the mat inside the ground's pass (it sets its own scissor; the ground restores the slot's). */
export interface Underlay { draw(pass: GPURenderPassEncoder): void }

/**
 * One object on a desk as the ground takes it: its kind's name (a registered one) and the record that kind's pass draws — and
 * its KEY (D6, design-015 §4.3): stable across frames (the builder's entity; a ghost's negated), so the kind's persistent records
 * keep the object's slot and write it only when the record object changed. Absent: the record is packed afresh every frame.
 */
export interface SlotObject {
  readonly kind: string;
  readonly record: unknown;
  readonly key?: number | undefined;
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
  /** What rides with it (D3t-c — a calendar's stuck notes): drawn in the hand's slot after it, under the same camera. */
  readonly riders?: readonly SlotObject[];
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
  /** The pegboard drawer this frame (design-017 — the renderer's flux: its slide, its shown scroll), over the marks; absent = none. Never drawn over the hand. */
  readonly tray?: TrayFrameInputs;
}

export interface GroundStats extends GridStats {
  /** The root's records drawn this frame, by kind name — every registered kind, 0 where it had none. */
  readonly kinds: Readonly<Record<string, number>>;
  /** The departed slot's grid while a flight is on. */
  readonly outgoing: GridStats | null;
  /** Live portals drawn this frame, the root's and the departed desk's together. */
  readonly portals: number;
  /** The records the kinds' CAPS turned away this frame, by kind name, every slot's (absent: none) — resolved and NOT drawn (D7). */
  readonly dropped?: Readonly<Record<string, number>>;
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
  readonly mat: CuttingMat;
  /**
   * Every registered kind's entry — a MISSING kind's (petition I24) drawn by a spawn of the slot's missing face under the kind's own
   * name and stratum — and, made on the first object that names it, `MISSING_KIND`'s (an object whose type has no kind). The ground
   * swaps an entry when a kind goes missing (`Ground.quarantine`); nothing else writes the map.
   */
  readonly kinds: ReadonlyMap<string, SlotKind>;
  /** The slot's FLAT-CARD pass (K7b, card/card.ts) over its kinds — absent when no registered kind declares a card material. */
  readonly card?: CardPass;
  /**
   * The desk's MISSING FACES (petition I24, missing/ — the root's alone): what draws an object nothing can draw, spawned on a slot's
   * mat into a kind's entry when the kind goes missing; nothing of them is made until the first is asked for. Absent on a slot set
   * made by hand (a unit's): such an object is then refused as an unregistered kind is.
   */
  readonly missing?: MissingFaces;
  /** The kinds REFUSED at create (the root's alone; petition I24): each its name and why — their entries draw the missing face from the start. */
  readonly faults?: readonly KindFault[];
  /** The kind boundary in the render half (the root's alone; M24 LT3 — `RenderBoundary`): absent, a kind's throw leaves the frame. */
  readonly boundary?: RenderBoundary;
}

/** One slot's passes for `drawFrame` — the ground's own, or the oracle's. A parent carries its nested slots. */
export interface DrawSlot {
  readonly mat: CuttingMat;
  readonly present?: Presentation | undefined;
  /** BARE: no mat is drawn — the hand's slot (D4b) lays its one object over a frame that is already there. */
  readonly bare?: boolean | undefined;
  /** Layers laid on the mat before everything (the calendar's). */
  readonly underlays?: readonly Underlay[] | undefined;
  /** The slot's kinds, prepared (its `SlotSet.kinds`): an object's kind names its stratum and its pass. */
  readonly kinds: ReadonlyMap<string, SlotKind>;
  /** The slot's objects in paint order — only their kinds matter to the draw: each kind's records are counted along them. */
  readonly objects?: readonly { readonly kind: string }[] | undefined;
  /**
   * The FLAT CARDS (K7b): each object's card in the card pass's list this frame (`route[i]`, −1 = its kind draws it) — a run of cards
   * is one draw whatever kinds it interleaves. Absent: every object is its kind's.
   */
  readonly card?: { readonly pass: CardPass; readonly route: Int32Array } | undefined;
  /** Nested slots, each drawn right after the object `at` names (MINIMAT.md §3) — one that names no object here draws over them all. */
  readonly children?: readonly { readonly at: number; readonly slot: DrawSlot }[] | undefined;
  /** What the slot's grid did this frame. */
  readonly stats: GridStats;
  /** The kind boundary (M24 LT3 — the root's `RenderBoundary`, handed down): absent, a kind's throw leaves the frame. */
  readonly boundary?: RenderBoundary | undefined;
  /** The kinds this slot draws nothing more of this frame (M24 LT3): their `prepare` threw, or a `drawRange` did — the draw adds to it. */
  readonly skip?: Set<string> | undefined;
}

/** What draws a run: a kind's pass, or the card's. */
type RunPass = { drawRange(pass: GPURenderPassEncoder, first: number, end: number): void };

/** A kind's GPU error scope closed (M24 LT3 — `RenderBoundary.watch`): an error raised inside it is `kind`'s, told when the device answers. */
function closeScope(b: RenderBoundary, kind: string): void {
  b.device.popErrorScope().then((e) => { if (e !== null) b.gpu(kind, e); }, () => {});
}

/** A slot at opacity 0 draws nothing: "source over" with alpha 0 leaves every pixel as it was. */
export const visible = (p: Presentation | undefined): boolean => (p?.opacity ?? 1) > 0;

/** A registry the ground can draw: names unique and not the desk's own `MISSING_KIND`, strata known — a host's error, thrown at create. */
function checkPrograms(programs: readonly KindProgram[]): void {
  const names = new Set<string>();
  for (const p of programs) {
    if (!p.name) throw new Error("ground: a kind needs a name — it is the kind's key in every slot");
    if (p.name === MISSING_KIND) throw new Error(`ground: the kind name "${MISSING_KIND}" is the desk's own — the missing face's (petition I24)`);
    if (names.has(p.name)) throw new Error(`ground: two kinds are named "${p.name}" — a kind's name is its key in every slot`);
    if (!STRATA.includes(p.stratum)) throw new Error(`ground: kind "${p.name}" lies in no stratum the ground draws ("${p.stratum}"; ${STRATA.join(", ")})`);
    names.add(p.name);
  }
}

/** The error filters a kind's create is watched under (the oracle's probe's three). */
const SCOPES: readonly GPUErrorFilter[] = ["validation", "out-of-memory", "internal"];
/** A device with error scopes — every WebGPU device; a unit's stub may have none (it is not watched: a rejection still refuses). */
const watched = (device: GPUDevice): boolean => typeof (device as { pushErrorScope?: unknown }).pushErrorScope === "function";
const pushScopes = (device: GPUDevice): void => { if (watched(device)) for (const f of SCOPES) device.pushErrorScope(f); };
/** The three scopes popped, all at once (no await between them — another task's scope is never taken for ours): the first error any held. */
function popScopes(device: GPUDevice): Promise<GPUError | null> {
  if (!watched(device)) return Promise.resolve(null);
  const popped = SCOPES.map(() => device.popErrorScope());
  return Promise.all(popped).then((errors) => errors.find((e) => e !== null) ?? null);
}
/** A promise's outcome, never a rejection. */
const settle = <T>(p: () => Promise<T>): Promise<{ readonly value: T } | { readonly error: unknown }> => {
  try { return Promise.resolve(p()).then((value) => ({ value }), (error: unknown) => ({ error })); } catch (error) { return Promise.resolve({ error }); }
};
/** A kind's pass let go — its own code, so a throw there is said and never stops the rest. */
function letGo(name: string, pass: KindPass): void {
  try { pass.dispose(); } catch (err) { console.error(`desk: the kind "${name}"'s pass threw in its dispose`, err); }
}

/** What `createKindPasses` made: each program's root pass in registration order (undefined: refused), and the refusals. */
export interface KindPasses {
  readonly passes: readonly (KindPass | undefined)[];
  readonly faults: readonly KindFault[];
}

/**
 * EVERY KIND'S PASS, EACH IN ITS OWN ERROR SCOPE (petition I24 — one kind's create is that kind's): made in parallel on the root's mat,
 * as before, each settled alone — a create that rejects (a WGSL that does not compile — the engine's `compile` throws — a pipeline the
 * device refused) or whose own scope caught an error is REFUSED, and the rest stand. A kind's scope is pushed before its `create` is
 * called and popped as it returns, so it holds what the kind does before its first await (its layouts, its shader modules — where a
 * compile error is raised); a WINDOW scope around them all holds whatever any kind does after (a pipeline made synchronously after an
 * await). When the window caught something, whose it was is found by making each kind that stood ALONE again, wholly in a scope of its
 * own, one after another (its first pass let go) — a fault's cost; a desk with none pays three scopes a kind. An error the window
 * caught that no kind raises alone is not a kind's: `onError` hears it (the device's handler would have — the layer's `degraded`).
 * Nothing else may run on the device while the window is open: the card, the missing face and the chrome are made after it.
 */
export async function createKindPasses(device: GPUDevice, format: GPUTextureFormat, mat: CuttingMat, programs: readonly KindProgram[], onError?: (error: GPUError) => void): Promise<KindPasses> {
  pushScopes(device);   // THE WINDOW
  const made = programs.map((p) => {
    pushScopes(device);   // the kind's own: what it does before its first await
    const created = settle(() => p.create(device, format, mat));
    return { created, own: popScopes(device) };
  });
  const first = await Promise.all(made.map(async (m) => ({ created: await m.created, own: await m.own })));
  const window = await popScopes(device);
  const passes: (KindPass | undefined)[] = [];
  const faults: KindFault[] = [];
  const refuse = (p: KindProgram, why: string): void => { faults.push({ kind: p.name, reason: why }); };
  const threw = (err: unknown): string => `refused at create — ${faultText(err)}`;
  const raised = (err: GPUError): string => `refused at create — a GPU error while its pass was made: ${faultText(err)}`;
  first.forEach(({ created, own }, i) => {
    const p = programs[i] as KindProgram;
    if ("error" in created) { passes.push(undefined); refuse(p, threw(created.error)); return; }
    if (own !== null) { passes.push(undefined); letGo(p.name, created.value); refuse(p, raised(own)); return; }
    passes.push(created.value);
  });
  if (window !== null) {
    let found = false;
    for (let i = 0; i < programs.length; i++) {
      const p = programs[i] as KindProgram;
      const had = passes[i];
      if (had === undefined) continue;
      letGo(p.name, had);
      pushScopes(device);
      const again = await settle(() => p.create(device, format, mat));
      const own = await popScopes(device);
      if ("error" in again) { passes[i] = undefined; found = true; refuse(p, threw(again.error)); continue; }
      if (own !== null) { passes[i] = undefined; found = true; letGo(p.name, again.value); refuse(p, raised(own)); continue; }
      passes[i] = again.value;
    }
    if (!found) onError?.(window);
  }
  // in registration order, as the kinds are
  faults.sort((a, b) => programs.findIndex((p) => p.name === a.kind) - programs.findIndex((p) => p.name === b.kind));
  return { passes, faults };
}

/**
 * The root slot from what was made: each kind's entry — a refused kind's drawn by the desk's missing faces under its name and stratum
 * (petition I24: their pipeline made now, as the first is asked for) — and the card over the kinds that stood (K7b: their materials
 * composed into ONE pipeline, their objects interleaving in one run).
 */
function slotSetOf(device: GPUDevice, mat: CuttingMat, programs: readonly KindProgram[], made: KindPasses, missing: MissingFaces, cards: CardShared | null): SlotSet {
  const kinds = new Map<string, SlotKind>();
  for (let i = 0; i < programs.length; i++) {
    const p = programs[i] as KindProgram;
    const pass = made.passes[i];
    kinds.set(p.name, pass === undefined ? { name: p.name, stratum: p.stratum, pass: missing.spawn(mat) } : { name: p.name, stratum: p.stratum, pass, ...(p.composite ? { composite: true } : {}) });
  }
  const card = cards === null ? undefined : new CardPass(device, cards, mat, kinds);
  return { mat, kinds, missing, ...(card !== undefined ? { card } : {}), ...(made.faults.length > 0 ? { faults: made.faults } : {}) };
}

/** The kinds that stood (their passes made): what the card composes. */
const standing = (programs: readonly KindProgram[], made: KindPasses): KindProgram[] => programs.filter((_, i) => made.passes[i] !== undefined);
/** A GPU error the kinds' window caught that no kind raises alone, with no host to tell: said on the console, never swallowed. */
const unattributed = (e: GPUError): void => { console.error("desk: a GPU error while the kinds were made, no kind's alone —", e.message); };

/**
 * The root slot's passes: the mat's (made first — every kind's pass is made on it), every registered kind's — made in parallel on the
 * root's mat, in registration order, each in its own error scope (`createKindPasses`: a kind refused there is MISSING, petition I24) —
 * then the card over the kinds that stood, and the desk's missing faces (made only if a kind was refused). Names must be unique and
 * strata known. Shared by the ground and the Node oracle (whose `onError` is its probe's: it watches the creation in scopes of its own).
 */
export async function createSlotSet(device: GPUDevice, format: GPUTextureFormat, mat: CuttingMat, programs: readonly KindProgram[], onError: (error: GPUError) => void = unattributed): Promise<SlotSet> {
  checkPrograms(programs);
  const made = await createKindPasses(device, format, mat, programs, onError);
  const cards = await createCardShared(device, format, standing(programs, made));
  return slotSetOf(device, mat, programs, made, missingFaces(device, format, mat), cards);
}


/** Slots beyond the root, spawned on first use and reused every frame: `reset()` then `acquire()` per slot the frame needs. */
export class SlotPool {
  private readonly slots: SlotSet[] = [];
  private used = 0;
  private readonly root: SlotSet;
  /** False once a kind the card composes went missing (petition I24 — `Ground.quarantine`): every slot's card, spawned or yet to be, is off. */
  cardOn = true;
  constructor(root: SlotSet) { this.root = root; }
  reset(): void { this.used = 0; }
  /** The next slot: on first use its mat spawned from the root's, then every registered kind's pass on that mat, in registration order. */
  acquire(): SlotSet {
    if (this.used === this.slots.length) {
      const mat = this.root.mat.spawn();
      const kinds = new Map<string, SlotKind>();
      for (const k of this.root.kinds.values()) kinds.set(k.name, { name: k.name, stratum: k.stratum, pass: spawnInside(this.root, k, mat), ...(k.composite ? { composite: true } : {}) });
      const card = this.root.card?.spawn(mat, kinds);
      if (card !== undefined && !this.cardOn) card.on = false;
      this.slots.push(card === undefined ? { mat, kinds } : { mat, kinds, card });
    }
    return this.slots[this.used++] as SlotSet;
  }
  /** Every slot spawned so far (a quarantine walks them). */
  each(fn: (s: SlotSet) => void): void { for (const s of this.slots) fn(s); }
  /** Slots spawned so far — the churn instrument. */
  get size(): number { return this.slots.length; }
  dispose(): void { for (const s of this.slots) { s.mat.dispose(); s.card?.dispose(); for (const k of s.kinds.values()) k.pass.dispose(); } this.slots.length = 0; this.used = 0; }
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
  // THE KIND BOUNDARY (M24 LT3 — `RenderBoundary`): a run of a kind's records — the card's runs and the missing face's are the desk's —
  // drawn inside it; a throw is the kind's, the slot draws nothing more of it this frame, and the slot's scissor is set again
  const boundary = slot.boundary;
  const skip = slot.skip;
  const draw = (p: RunPass, kind: string | undefined, first: number, end: number): void => {
    if (boundary === undefined || skip === undefined || kind === undefined || kind === MISSING_KIND) { p.drawRange(pass, first, end); return; }
    try { p.drawRange(pass, first, end); } catch (err) { boundary.threw(kind, "drawRange", err); skip.add(kind); pass.setScissorRect(x, y, w, h); }
  };
  const over = (k: SlotKind, index: number): void => {
    if (k.pass.drawOver === undefined || skip?.has(k.name) === true) return;
    if (boundary === undefined || skip === undefined || k.name === MISSING_KIND) { k.pass.drawOver(pass, index); return; }
    try { k.pass.drawOver(pass, index); } catch (err) { boundary.threw(k.name, "drawOver", err); skip.add(k.name); pass.setScissorRect(x, y, w, h); }
  };
  // the objects, stratum by stratum; within one, in paint order, a run of one kind at a time — cut after an object with a live
  // inside: the run through it, its inside over its face, then its marks over that (the mini mat's chips while the inside's
  // objects fade in — MINIMAT.md §5) — before the objects above it
  const next = new Map<string, number>();   // each kind's next record
  // K7b: an object the card draws runs with the CARDS — one run however the kinds interleave — at its index in the card's list
  const card = slot.card;
  for (const stratum of STRATA) {
    let run: RunPass | undefined;
    /** The run's kind — undefined for the card's (the desk's own pass). */
    let runKind: string | undefined;
    let first = 0;
    let end = 0;
    for (let i = 0; i < objects.length; i++) {
      const k = slot.kinds.get((objects[i] as { readonly kind: string }).kind);
      if (!k || k.stratum !== stratum) continue;
      const index = next.get(k.name) ?? 0;
      next.set(k.name, index + 1);
      if (k.composite) continue;   // laid once, after the stratum's runs (below)
      if (skip?.has(k.name) === true) {
        // a kind this slot draws nothing more of this frame (M24 LT3): its object left out — an inside it holds still drawn where it lies
        const children = insides.get(i);
        if (!children) continue;
        if (run !== undefined) draw(run, runKind, first, end);
        run = undefined;
        for (const child of children) inside(child);
        insides.delete(i);
        continue;
      }
      const c = card === undefined ? -1 : (card.route[i] as number);
      const p = c >= 0 ? (card as { readonly pass: CardPass }).pass : k.pass;
      const at = c >= 0 ? c : index;
      if (p !== run) { if (run !== undefined) draw(run, runKind, first, end); run = p; runKind = c >= 0 ? undefined : k.name; first = at; }
      end = at + 1;
      const children = insides.get(i);
      if (!children) continue;
      draw(p, runKind, first, end);
      run = undefined;
      for (const child of children) { inside(child); over(k, index); }
      insides.delete(i);
    }
    if (run !== undefined) draw(run, runKind, first, end);
    // a kind that lays a composite of its own target (the notebook, the calendar): ONE run over all its records, after every other
    // run of the stratum — one draw lays every one of its objects, so they cannot interleave with another kind's (KindProgram.composite)
    for (const k of slot.kinds.values()) {
      const count = k.composite && k.stratum === stratum && skip?.has(k.name) !== true ? (next.get(k.name) ?? 0) : 0;
      if (count > 0) draw(k.pass, k.name, 0, count);
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
  /** What the kinds' caps turned away, by kind name, every slot's (absent: nothing) — `GroundStats.dropped` (D7). */
  readonly dropped?: Readonly<Record<string, number>>;
  /** K5a: the tray's specimens, one slot each, prepared — drawn over the board, inside its edge (`drawTray`); absent = none. */
  readonly tray?: readonly DrawSlot[];
  /** K5b: what the tray carries, one slot each, prepared — drawn over the drawer, whole (`drawTray`); absent = none. */
  readonly carried?: readonly DrawSlot[];
}

/** Where `prepareFrame` finds a specimen's slot (tray/specimens.ts `TraySlots`): undefined while its kind's pass is being made. */
export interface TraySlotSource { get(type: string, kind: string): SlotSet | undefined }

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
export function prepareFrame(encoder: GPUCommandEncoder, root: SlotSet, pool: SlotPool, inputs: GroundFrameInputs, grid: GridConfig = DEFAULT_GRID, target?: RenderTarget, traySlots?: TraySlotSource): PreparedFrame {
  pool.reset();
  root.mat.newFrame();   // a wind key drawn in an earlier frame may be drawn over; one drawn in this one is every slot's (K4a)
  const theme = inputs.theme;
  let portals = 0;
  let rootDrawn: readonly (readonly [string, number])[] = [];
  const dropped: Record<string, number> = {};
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
    // …and their keys (D6): a kind's list of keys is handed on only when EVERY one of its objects carries one
    const keys = new Map<string, number[] | null>();
    for (const name of s.kinds.keys()) { records.set(name, []); keys.set(name, []); }
    const indexOf: number[] = [];
    for (const o of objects) {
      let list = records.get(o.kind);
      if (!list && o.kind === MISSING_KIND && root.missing !== undefined) {
        // an object whose type has no kind (petition I24): the desk's missing faces under the desk's own name, made on the slot's first
        (s.kinds as Map<string, SlotKind>).set(MISSING_KIND, { name: MISSING_KIND, stratum: "things", pass: root.missing.spawn(s.mat) });
        list = [];
        records.set(MISSING_KIND, list);
        keys.set(MISSING_KIND, []);
      }
      if (!list) throw new Error(`ground: no kind "${o.kind}" is registered (${[...s.kinds.keys()].join(", ") || "none"})`);
      indexOf.push(list.length);
      list.push(o.record);
      const ks = keys.get(o.kind);
      if (ks !== null && ks !== undefined) { if (o.key === undefined) keys.set(o.kind, null); else ks.push(o.key); }
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
    // presence, a spawned slot's pass first taking the root's laws, each told which of its records carries a live inside this frame.
    // A kind with no objects in the slot is not prepared at all (K4a, design-016 K-L3: it costs the slot nothing) — the slot's view
    // block is the mat's, written above, so no kind has a copy to keep fresh, and no run of it is drawn (`drawSlot` walks the objects)
    const slot: SlotContext = { view: inp.view, fadeIn: g.fadeIn, cfg: g.mat, frame: inp.mat, present: objectsOf(inp.present), light: theme.matLight, lit, select: theme.select, theme, ...(target !== undefined ? { target } : {}) };
    const drawn: [string, number][] = [];
    /** One kind's prepare in this slot: the root's laws taken, its records uploaded — and what its cap turned away said, never silent (D7). */
    const ask = (k: SlotKind, list: readonly unknown[], extra: KindExtra): number => {
      const own = root.kinds.get(k.name);
      if (own && k.pass !== own.pass) k.pass.tune?.(own.pass);
      const n = k.pass.prepare(encoder, slot, list, extra);
      const turned = k.pass.dropped?.() ?? 0;
      if (turned > 0) dropped[k.name] = (dropped[k.name] ?? 0) + turned;
      return n;
    };
    // THE KIND BOUNDARY (M24 LT3 — `RenderBoundary`): a kind whose prepare throws is drawn by nothing in this slot this frame — the kinds
    // after it prepare as ever — and, watched, each kind's prepare is a GPU error scope of its own (the desk's missing face is no kind's)
    const boundary = root.boundary;
    const skip = new Set<string>();
    for (const k of s.kinds.values()) {
      const list = records.get(k.name) ?? [];
      // (the missing face's own entry is no registered kind: it is counted where it drew, never as a 0 — petition I24)
      if (list.length === 0) { if (k.name !== MISSING_KIND) drawn.push([k.name, 0]); continue; }
      const told = live.get(k.name);
      const ks = keys.get(k.name);
      const extra: KindExtra = { live: (i) => told?.get(i) ?? -1, ...(ks !== null && ks !== undefined ? { keys: ks } : {}) };
      if (boundary === undefined || k.name === MISSING_KIND) { drawn.push([k.name, ask(k, list, extra)]); continue; }
      const scoped = boundary.watch && watched(boundary.device);
      if (scoped) boundary.device.pushErrorScope("validation");
      try { drawn.push([k.name, ask(k, list, extra)]); }
      catch (err) { boundary.threw(k.name, "prepare", err); skip.add(k.name); drawn.push([k.name, 0]); }
      finally { if (scoped) closeScope(boundary, k.name); }
    }
    if (s === root) rootDrawn = drawn;
    // THE CARDS (K7b, card/card.ts): every object of a material kind whose pass lets it go (`cardSlot`) — never one with a live
    // inside (its inside goes right after it) — pushed in the order drawSlot walks them, stratum by stratum, then paint order, so a
    // run of cards is a contiguous range of the card's list
    let card: DrawSlot["card"];
    if (s.card?.on === true && objects.length > 0) {
      const route = s.card.begin(objects.length);
      for (const stratum of STRATA) {
        for (let i = 0; i < objects.length; i++) {
          const o = objects[i] as SlotObject;
          const k = s.kinds.get(o.kind);
          if (k === undefined || k.stratum !== stratum || k.composite === true) continue;
          const m = s.card.materialOf(o.kind);
          if (m === undefined) continue;
          const at = indexOf[i] as number;
          if (live.get(o.kind)?.has(at) === true || skip.has(o.kind)) continue;
          let cs = -1;
          if (boundary === undefined) cs = k.pass.cardSlot?.(at) ?? -1;
          else try { cs = k.pass.cardSlot?.(at) ?? -1; } catch (err) { boundary.threw(o.kind, "cardSlot", err); skip.add(o.kind); continue; }
          if (cs >= 0) route[i] = s.card.push(m, cs);
        }
      }
      if (s.card.prepare(slot) > 0) card = { pass: s.card, route };
    }
    return {
      mat: s.mat, present: inp.present, stats: gridStats(inp.view, wind), kinds: s.kinds,
      ...(boundary !== undefined ? { boundary, skip } : {}),
      ...(card !== undefined ? { card } : {}),
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
  // the tray's specimens (K5a): each in its own slot — its view block the drawer's camera scaled about it (K-L3), its kind's own pass,
  // through the drawer's face; a specimen whose slot is not made yet (a composite kind's pass, being made) waits a frame
  const tray: DrawSlot[] = [];
  const specimens = inputs.tray?.specimens;
  if (specimens !== undefined && specimens.length > 0 && traySlots !== undefined && inputs.tray !== undefined) {
    const present = facePresent({ rect: trayRectOf(inputs), scroll: inputs.tray.scroll, ...(inputs.tray.foot !== undefined ? { foot: inputs.tray.foot } : {}) }, inputs.view.height);
    for (const f of specimens) {
      const slot = traySlots.get(f.type, f.kind);
      if (slot === undefined) continue;
      tray.push(prepare(slot, { view: f.view, grid: f.grid, objects: [{ kind: f.kind, record: f.record, key: f.key }], present }, f.grid, undefined));
    }
  }
  // …and what it carries (K5b): each in its own slot — the copy lifted off the board, a ghost growing out of it or shrinking home — whole,
  // never through the face (it is off the board); one slot per type, apart from its specimen's
  const carried: DrawSlot[] = [];
  const carriedIn = inputs.tray?.carried;
  if (carriedIn !== undefined && carriedIn.length > 0 && traySlots !== undefined) {
    const byType = new Map<string, TrayCarriedFrame[]>();
    for (const f of carriedIn) byType.set(f.slot, [...(byType.get(f.slot) ?? []), f]);
    for (const [key, list] of byType) {
      const first = list[0] as TrayCarriedFrame;
      const slot = traySlots.get(key, first.kind);
      if (slot === undefined) continue;
      carried.push(prepare(slot, { view: first.view, grid: first.grid, objects: list.map((f) => ({ kind: f.kind, record: f.record, key: f.key })) }, first.grid, undefined));
    }
  }
  return {
    incoming, outgoing, portals, kinds: Object.fromEntries(rootDrawn), ...(Object.keys(dropped).length > 0 ? { dropped } : {}), ...(tray.length > 0 ? { tray } : {}),
    ...(carried.length > 0 ? { carried } : {}),
  };
}

/** The drawer as its frame inputs lay it (tray/drawer.ts `drawerRect` at the flux's slide). */
function trayRectOf(inputs: GroundFrameInputs): ReturnType<typeof drawerRect> {
  const t = inputs.tray as TrayFrameInputs;
  return drawerRect(inputs.view.width, inputs.view.height, Math.min(Math.max(t.p, 0), 1));
}

/**
 * THE TRAY, drawn (design-017 §5, §8; K5a) — shared by `Ground.render` and the Node oracle: the drawer UNDER its specimens (the dim, its
 * shadows, the board to its edge, the accessories), each specimen by its own kind through the drawer's face (inside the edge — the rim
 * laid over them all retired, design-018 §2), their name tags (the marks' pills), then the VEIL over them all at the top (design-018
 * rev 5: the plain board, whole in the header and fading out over its ramp — what hangs there fades into the board, never see-through
 * over a hole); then what the tray carries, whole. Shut (p 0) the drawer draws nothing (its pass laid no quad) and only a carried copy
 * is drawn. Leaves the scissor on the whole view.
 */
export function drawTray(pass: GPURenderPassEncoder, size: { readonly w: number; readonly h: number }, dpr: number, tray: TrayPass, slots: readonly DrawSlot[] | undefined, marks: MarksPass | null, carried?: readonly DrawSlot[]): void {
  tray.draw(pass);
  const rect = tray.laid?.rect;
  if (rect !== undefined) {
    // each specimen through the drawer's face, once (design-018 §2: the finger notch — and its three scissors — retired)
    for (const s of slots ?? []) drawSlot(pass, size, dpr, { ...s, bare: true });
    if (marks !== null && marks.tagCount > 0) {
      const [x, y, w, h] = scissorOf({ opacity: 1, portal: faceBox(rect, size.h / dpr, tray.laid?.foot ?? 0) }, dpr, size);
      if (w > 0 && h > 0) {
        pass.setScissorRect(x, y, w, h);
        marks.drawTags(pass);
      }
    }
  }
  pass.setScissorRect(0, 0, size.w, size.h);
  tray.drawVeil(pass);
  // what the tray carries (K5b): over the drawer and the dim, whole — it is off the board
  if (carried !== undefined && carried.length > 0) {
    for (const s of carried) drawSlot(pass, size, dpr, { ...s, bare: true });
    pass.setScissorRect(0, 0, size.w, size.h);
  }
}

/** The drawer's face inside its edge, under its header (design-018 R4) and above a host's foot (I21) as a clip box (CSS px), square — the tags' scissor. */
function faceBox(rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, vh: number, foot: number): { cx: number; cy: number; hx: number; hy: number; r: number } {
  const x0 = rect.x + DRAWER.arris;
  const x1 = rect.x + rect.w - DRAWER.arris;
  const y0 = rect.y + DRAWER.arris + DRAWER.header;
  const y1 = foot > 0 ? rect.y + rect.h - foot : Math.max(vh, rect.y + rect.h);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, r: 0 };
}

/**
 * The passes one frame draws with — a `Ground`'s own (it IS one), or the Node oracle's: the root slot and the pool, the root's
 * grid, and the three chrome passes (null where a host made none). What `encodeFrame` and `captureFrame` take, so the swap chain's
 * frame, a capture's still and the oracle's render go through ONE encoding of a frame (petition I23: the capture is the frame path
 * drawn once more into another target — never a second copy of it).
 */
export interface FramePasses {
  readonly root: SlotSet;
  readonly pool: SlotPool;
  readonly grid: GridConfig;
  readonly marks: MarksPass | null;
  readonly hold: HoldPass | null;
  readonly tray: TrayPass | null;
  readonly traySlots: TraySlotSource | null;
}

/** What `encodeFrame` recorded: the frame's stats (`Ground.render`'s answer), the prepared tree, and the marks it laid (0: none). */
export interface EncodedFrame {
  readonly stats: GroundStats;
  readonly prepared: PreparedFrame;
  readonly marked: number;
}

/**
 * Record one REST frame (no object in hand — the held frame is `renderHeldFrame`'s) into `encoder`, drawn into `into` — the swap
 * chain (`Ground.render`), a capture's readable still (`captureFrame`), the oracle's target: the drawer's prepare (shut, p 0, it
 * lays no quad; what the tray carries draws whatever the slide — a ghost grows, or flies home, past it), the slot tree, the marks,
 * then ONE render pass — the frame stratum by stratum, the marks over every slot and stratum (stratum 5; `drawFrame` left the
 * scissor on the whole view), the pegboard drawer over them (design-017: the dim, its shadow, the board, the specimens — K5a).
 * The caller submits. `target` marks what the slots are prepared for (D7, `RenderTarget`); absent, the frame's.
 */
export function encodeFrame(encoder: GPUCommandEncoder, passes: FramePasses, inputs: GroundFrameInputs, into: HeldInto, target?: RenderTarget): EncodedFrame {
  const { root, pool, grid, marks, tray, traySlots } = passes;
  const trayed = inputs.tray !== undefined && tray !== null ? tray.prepare(inputs.view, inputs.theme, inputs.grid ?? grid, inputs.mat, inputs.tray) : 0;
  const prepared = prepareFrame(encoder, root, pool, inputs, grid, target, inputs.tray !== undefined ? (traySlots ?? undefined) : undefined);
  const marked = marks !== null ? marks.prepare(inputs.marks, trayed > 0 && tray !== null ? { view: inputs.view, tags: tagsOf(inputs.tray), night: inputs.theme.matLight.night } : undefined) : 0;
  const bg = inputs.theme.canvasBg;
  const size = into.size();
  const pass = beginPass(encoder, into.view(), [bg[0], bg[1], bg[2], 1], "ground");
  const drawn = drawFrame(pass, size, inputs.view.dpr, prepared.incoming, prepared.outgoing);
  if (marked > 0) marks?.draw(pass);
  if ((trayed > 0 || prepared.carried !== undefined) && tray !== null) drawTray(pass, size, inputs.view.dpr, tray, prepared.tray, marks, prepared.carried);
  pass.end();
  return { stats: { ...drawn.incoming, kinds: prepared.kinds, outgoing: drawn.outgoing, portals: prepared.portals, ...(prepared.dropped ? { dropped: prepared.dropped } : {}) }, prepared, marked };
}



export class Ground {
  readonly device: GPUDevice;
  readonly surface: Surface;
  /** The cutting mat — the root slot's; its plates, noise and glyph atlas are every slot's. */
  readonly mat: CuttingMat;
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
  /** The pegboard drawer (design-017, K3); null when the options named no tray shaders. */
  readonly tray: TrayPass | null;
  /** The tray's specimens' slots (K5a) — one per specimen, made as the tray first shows each; null with no tray. */
  readonly traySlots: TraySlots | null;
  /** The desk copy's cache (D4b): the stamp it was made for and the stats of that frame. */
  private readonly heldCache: HeldCache = { stamp: null, stats: null, copies: 0 };
  /** How many desk copies the hand has made so far (D4b) — a rig's witness that the blurred desk is made once per settled state. */
  heldCopies(): number { return this.heldCache.copies; }
  /** The drops last said, by kind (D7). */
  private readonly dropSaid = new Map<string, number>();
  /** The kinds MISSING on this ground (petition I24): refused at create, or quarantined since — their entries draw the missing face. */
  private readonly missing = new Set<string>();

  private constructor(device: GPUDevice, surface: Surface, root: SlotSet, marks: MarksPass | null, hold: HoldPass | null, tray: TrayPass | null, programs: readonly KindProgram[]) {
    this.device = device; this.surface = surface; this.mat = root.mat; this.root = root; this.marks = marks; this.hold = hold; this.tray = tray;
    this.pool = new SlotPool(root);
    this.traySlots = tray === null ? null : new TraySlots(device, surface.format, root, programs);
    for (const f of root.faults ?? []) this.missing.add(f.kind);
  }

  /**
   * The mat first (every kind's pass is made on it), then every kind's pass in its own error scope (`createKindPasses` — a kind refused
   * there is MISSING from the start: `faults()`, petition I24), then — once the kinds' window has closed, so nothing of theirs is taken
   * for a kind's — the card over the kinds that stood, the marks, the hand and the tray, together. The missing faces are made only when
   * one is asked for (a kind refused here, a quarantine, an object with no kind).
   */
  static async create(opts: GroundOptions): Promise<Ground> {
    const surf = opts.surface;
    const mat = await CuttingMat.create(opts.device, surf.format, opts.mat);
    checkPrograms(opts.kinds);
    const made = await createKindPasses(opts.device, surf.format, mat, opts.kinds, opts.onError ?? unattributed);
    const [cards, marks, hold, tray] = await Promise.all([
      createCardShared(opts.device, surf.format, standing(opts.kinds, made)),
      opts.marks === undefined ? null : MarksPass.create(opts.device, surf.format, opts.marks, mat),
      opts.hold === undefined ? null : HoldPass.create(opts.device, surf.format, opts.hold),
      opts.tray === undefined ? null : TrayPass.create(opts.device, surf.format, opts.tray, mat),
    ]);
    const root = slotSetOf(opts.device, mat, opts.kinds, made, missingFaces(opts.device, surf.format, mat), cards);
    return new Ground(opts.device, surf, opts.boundary !== undefined ? { ...root, boundary: opts.boundary } : root, marks, hold, tray, opts.kinds);
  }

  /**
   * The root's pass of the kind registered as `name` (undefined if none, or MISSING — petition I24: nothing of a missing kind is reached
   * again) — a host reaches its kind's own API through it: the note's ink pages, the whiteboard's rasters.
   */
  pass(name: string): KindPass | undefined { return this.missing.has(name) ? undefined : this.root.kinds.get(name)?.pass; }

  /** The kinds REFUSED when this ground was made (petition I24): each its name and why. Quarantines since are the layer's word. */
  faults(): readonly KindFault[] { return this.root.faults ?? []; }

  /**
   * THE QUARANTINE (petition I24): kind `name` is MISSING from now on — its entry in every slot this ground holds (the root, the pool's,
   * the tray's) becomes a spawn of that slot's missing face, under its name and in its stratum, and the passes it had are disposed (the
   * pool's and the tray's first; the root's — whose shared resources go with it — last; a dispose that throws is said and passed). A
   * kind the flat card composes turns the card off in every slot, for good (K7b's own A/B door: each material kind then draws its own
   * runs — the card's pixels, more draws): its resources leave the card's bind group, and no draw may reach them. The next frame draws
   * the kind's objects in the missing face (the builder makes their records so); one already made for its own pass is drawn as nothing.
   * A kind already missing, or none of that name: nothing.
   */
  quarantine(name: string): void {
    if (this.missing.has(name) || !this.root.kinds.has(name)) return;
    this.missing.add(name);
    if (this.root.card?.materialOf(name) !== undefined) {
      this.root.card.on = false;
      this.pool.cardOn = false;
      this.pool.each((s) => { if (s.card !== undefined) s.card.on = false; });
    }
    const faces = this.root.missing;
    const gone: KindPass[] = [];
    this.pool.each((s) => { const p = swapToMissing(s, name, faces); if (p !== undefined) gone.push(p); });
    gone.push(...(this.traySlots?.quarantine(name, faces) ?? []));
    const root = swapToMissing(this.root, name, faces);
    if (root !== undefined) gone.push(root);
    for (const p of gone) letGo(name, p);
    // the desk copy behind a hand drew the kind's own pixels: the next held frame makes it again (a stamp no frame carries)
    if (this.heldCache.stamp !== null) this.heldCache.stamp = "";
  }

  /** Size the canvas to its CSS box; returns the CSS size and dpr the frame should use. (A host may size the canvas itself instead.) */
  fit(maxDpr = 2) { return this.surface.fit(maxDpr); }

  /** Render one frame now. Synchronous submit; the caller owns the cadence. */
  render(inputs: GroundFrameInputs): GroundStats {
    // the hand (D4b): at a carry above 0 the frame is the desk out of focus with the held object over it; at 0 it is the rest frame
    const held = inputs.held;
    if (held !== undefined && held.e > 0 && this.hold !== null) return this.said(renderHeldFrame(this.device, this.hold, this.root, this.pool, this.grid, this.surface, inputs, held, this.heldCache));
    // the hold is over: the passes give the desk copy's own state back, once — the next pick-up makes its copy afresh (D7)
    if (this.heldCache.stamp !== null) {
      this.heldCache.stamp = null;
      const b = this.root.boundary;
      for (const k of this.root.kinds.values()) {
        if (b === undefined) { k.pass.endHold?.(); continue; }
        try { k.pass.endHold?.(); } catch (err) { b.threw(k.name, "endHold", err); }   // the kind's (M24 LT3): the frame goes on
      }
    }
    const encoder = this.device.createCommandEncoder({ label: "ground" });
    const { stats } = encodeFrame(encoder, this, inputs, this.surface);
    this.device.queue.submit([encoder.finish()]);
    return this.said(stats);
  }

  /**
   * THE CAPTURE DOOR's GPU half (petition I23; `captureFrame`): `inputs` — the last frame's, as `render` took them — drawn once
   * more into a readable texture at the view's dpr × `scale`, `rect` (CSS px of the view) read back. The swap chain is not touched,
   * no frame is drawn, nothing is kept: the still and its readback buffer are made for the call and destroyed after it. Undefined
   * when the device is lost mid-copy, or the rect lies off the view.
   */
  capture(inputs: GroundFrameInputs, opts: CaptureOptions = {}): Promise<CaptureBytes | undefined> {
    return captureFrame(this.device, this, this.surface.format, inputs, this.heldCache, opts);
  }

  /** A kind whose cap turns objects away is an ERROR on the host's console (D7): said when the drop begins and again if it grows. */
  private said(stats: GroundStats): GroundStats {
    const now = stats.dropped ?? {};
    for (const [kind, n] of Object.entries(now)) {
      if (n > (this.dropSaid.get(kind) ?? 0)) console.error(`desk: ${n} ${kind} object${n === 1 ? "" : "s"} not drawn — past the kind's cap (GroundStats.dropped)`);
      this.dropSaid.set(kind, n);
    }
    for (const kind of [...this.dropSaid.keys()]) if (!(kind in now)) this.dropSaid.delete(kind);
    return stats;
  }

  /** The pool's slots, then the root's kinds in reverse registration order (a missing kind's face among them), its missing face, then the mat. */
  dispose(): void { this.pool.dispose(); this.traySlots?.dispose(); this.root.card?.dispose(); for (const k of [...this.root.kinds.values()].reverse()) k.pass.dispose(); this.root.missing?.dispose(); this.marks?.dispose(); this.hold?.dispose(); this.tray?.dispose(); this.mat.dispose(); }

  /** Make the passes the tray's composite specimens need (K5a — `TraySlots.warm`); `onReady` asks for the frame that shows them. */
  warmTray(wanted: readonly (readonly [string, string])[], onReady: () => void): void { this.traySlots?.warm(wanted, onReady); }

  /** The tray's slots let go of what they make again at their next draw once undrawn a while (D-K6a.3; `TraySlots.idle`) — every tick. */
  idleTray(): void { this.traySlots?.idle(); }
  /** When `idleTray` next lets a tray layer go (K7a — a time the host registers; ∞ — nothing to let go). */
  trayIdleAt(): number { return this.traySlots?.idleAt() ?? Number.POSITIVE_INFINITY; }
}


/** The specimens' name tags this frame (K5a): each label centred under its specimen — below a shelf's plank — in screen px. */
export function tagsOf(tray: TrayFrameInputs | undefined): { readonly label: string; readonly x: number; readonly y: number }[] {
  const P = DRAWER.pitch;
  return (tray?.specimens ?? []).map((f) => ({ label: f.label, x: (f.screen.x0 + f.screen.x1) / 2, y: f.screen.y1 + (f.accessory === "shelf" ? 0.24 * P : 0) + 0.45 * P }));
}

/** The desk copy's cache between held frames (D4b): the `stamp` it was made for (null: none yet), the stats of that frame, and how many copies were ever made (the "once per settled state" witness). */
export interface HeldCache { stamp: string | null; stats: GroundStats | null; copies: number }

/** Where a frame goes: the swap chain's view and size (the ground's surface), the oracle's target dressed as one, or a capture's still. */
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
 * Returns the desk copy's stats (the frame's objects behind the hand). `label` names the encoders (`hold`; a capture's
 * `capture` — the pass instrument closes a profiler frame at the `hold` encoder's submit, and a capture is not a frame).
 */
export function renderHeldFrame(device: GPUDevice, hold: HoldPass, root: SlotSet, pool: SlotPool, grid: GridConfig, into: HeldInto, inputs: GroundFrameInputs, held: HeldFrameInputs, cache: HeldCache, label = "hold"): GroundStats {
  const size = into.size();
  const dpr = inputs.view.dpr;
  const bg = inputs.theme.canvasBg;
  const remade = hold.fit(size.w, size.h);
  if (remade || cache.stamp !== held.stamp) {
    cache.stamp = held.stamp;
    cache.copies += 1;
    const encoder = device.createCommandEncoder({ label: `${label}/copy` });
    const { held: _held, marks: _marks, ...rest } = inputs;
    const copy: GroundFrameInputs = { ...rest, view: { ...inputs.view, dpr: dpr / 2 } };
    const prepared = prepareFrame(encoder, root, pool, copy, grid, "copy");   // the copy's own state in the passes that keep one (D7)
    const pass = beginPass(encoder, hold.desk.view, [bg[0], bg[1], bg[2], 1], `${label}/copy`);
    const drawn = drawFrame(pass, { w: hold.desk.width, h: hold.desk.height }, dpr / 2, prepared.incoming, prepared.outgoing);
    pass.end();
    hold.blur(encoder, (held.blur * dpr) / 2);
    device.queue.submit([encoder.finish()]);
    cache.stats = { ...drawn.incoming, kinds: prepared.kinds, outgoing: drawn.outgoing, portals: prepared.portals, ...(prepared.dropped ? { dropped: prepared.dropped } : {}) };
  }
  const encoder = device.createCommandEncoder({ label });
  const handInputs: GroundFrameInputs = { view: held.view, grid: held.grid, objects: [held.object, ...(held.riders ?? [])], theme: { ...inputs.theme, matLight: held.light } };
  const hand = prepareFrame(encoder, root, pool, handInputs, held.grid, "hand");   // (K9 R4: the passes re-ask what the copy has bound)
  const handPass = beginPass(encoder, hold.hand.view, [0, 0, 0, 0], `${label}/hand`);
  drawSlot(handPass, size, dpr, { ...hand.incoming, bare: true });
  handPass.end();
  const pass = beginPass(encoder, into.view(), [bg[0], bg[1], bg[2], 1], label);
  hold.composite(pass, { e: held.e, dim: held.dim, saturate: held.filter.saturate, brightness: held.filter.brightness });
  pass.end();
  device.queue.submit([encoder.finish()]);
  return cache.stats ?? { k0: 0, fade: 0, wind: false, kinds: hand.kinds, outgoing: null, portals: 0 };
}

// ---------------------------------------------------------------- the capture door (petition I23)

/** A rect of the view, CSS px: `x`, `y` its top-left, `width` × `height` its size. */
export interface CaptureRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface CaptureOptions {
  /** The part of the view to return, CSS px (the whole view when absent); what lies off the view is cut off. */
  readonly rect?: CaptureRect;
  /** A multiplier on the view's dpr (1 — the still at device pixels; a thumbnail asks 0.25). */
  readonly scale?: number;
  /**
   * The selection's marks drawn (`true`, the default — the frame as presented) or not (`false`, petition I40 — "Send to…"'s still
   * of the objects): `false` draws THIS capture with `unselectedMarks` (marks/layout.ts) — no brackets, knobs, union, vellum,
   * guides or rulers' extent; a taped object's tape and the tray's tags stay — so a selected object's still is the unselected
   * object's, byte for byte. The selection, the world and the presented frame are not touched.
   */
  readonly marks?: boolean;
}

/**
 * A captured still's bytes: `width` × `height` device px, rows tightly packed, four bytes a pixel in `format`'s own channel
 * order and alpha AS DRAWN (`bgra8unorm` on most swap chains; `rgba8unorm` the oracle's) — the texture's texels, exactly:
 * the host turns them into an `ImageBitmap` (host/layer.ts), the oracle hashes them beside its own render.
 */
export interface CaptureBytes {
  readonly width: number;
  readonly height: number;
  readonly format: GPUTextureFormat;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** A capture's option as the door validates it: a finite number; `> 0` where it must be. */
const captureNumber = (what: string, v: number, positive: boolean): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || (positive && v <= 0)) throw new Error(`capture: ${what} must be a ${positive ? "positive " : ""}finite number (got ${String(v)})`);
  return v;
};

/** A malformed capture option is a THROW at the call (a programming error, never an honest undefined): the scale positive and finite, the rect's four numbers finite, `marks` a boolean. */
export function checkCapture(opts: CaptureOptions): void {
  captureNumber("scale", opts.scale ?? 1, true);
  if (opts.marks !== undefined && typeof opts.marks !== "boolean") throw new Error(`capture: marks must be a boolean (got ${String(opts.marks)})`);
  const r = opts.rect;
  if (r === undefined) return;
  captureNumber("rect.x", r.x, false);
  captureNumber("rect.y", r.y, false);
  captureNumber("rect.width", r.width, false);
  captureNumber("rect.height", r.height, false);
}

/**
 * The frame's inputs with EVERY view's dpr × `scale` — the root's, each live inside's (recursively: a nested slot carries a view of
 * its own, and its mat prepares its lattice against it), the departed desk's and its insides', the hand's, the marks' (their
 * hairlines are 1/dpr), the tray's specimens' and carried copies' — so every slot names the capture's attachment (kit/layer.ts
 * `attachmentOf`), exactly as the reflector's inputs would at that dpr. At scale 1, the inputs themselves.
 */
export function scaledInputs(inputs: GroundFrameInputs, scale: number): GroundFrameInputs {
  if (scale === 1) return inputs;
  const dprOf = <V extends { readonly dpr: number }>(v: V): V => ({ ...v, dpr: v.dpr * scale });
  const slotOf = <S extends SlotInputs>(s: S): S => ({ ...s, view: dprOf(s.view), ...(s.portals !== undefined ? { portals: s.portals.map(slotOf) } : {}) });
  const { outgoing, held, marks, tray } = inputs;
  return {
    ...slotOf(inputs),
    ...(outgoing !== undefined ? { outgoing: slotOf(outgoing) } : {}),
    ...(held !== undefined ? { held: { ...held, view: dprOf(held.view) } } : {}),
    ...(marks !== undefined ? { marks: { ...marks, view: dprOf(marks.view) } } : {}),
    ...(tray !== undefined
      ? { tray: { ...tray, ...(tray.specimens !== undefined ? { specimens: tray.specimens.map((f) => ({ ...f, view: dprOf(f.view) })) } : {}), ...(tray.carried !== undefined ? { carried: tray.carried.map((f) => ({ ...f, view: dprOf(f.view) })) } : {}) } }
      : {}),
  };
}

/**
 * THE CAPTURE (petition I23 — the covers' still, the thumbnails, "Send to…"): `inputs` — the last PRESENTED frame's, as
 * `Ground.render` took them (the same camera, theme, marks, hand and tray) — drawn ONCE MORE, outside any frame, into a readable
 * texture at the view's size × its dpr × `scale`, through the same encoding the swap chain's frame went through (`encodeFrame`;
 * the held frame through `renderHeldFrame` — at the view's own size the standing desk copy is reused, the hand alone redrawn);
 * then `rect` (CSS px of the view; the whole view when absent), in device px of the still, copied to a buffer and MAPPED — with
 * `marks: false` (petition I40) the frame's marks less the selection's (`unselectedMarks`), for this capture alone. The
 * slots are prepared for the `capture` target (D7, `RenderTarget`: a kind re-asks the residency the frame holds, as under the
 * hand — a thumbnail's coarser asks evict nothing). The per-frame path gains nothing: no copy of any frame is kept, the swap chain
 * is not touched, and the still and the readback buffer — `capture/still`, `capture/readback`, the ledger's own `capture` line
 * while they live — are destroyed before the promise settles. Undefined, never a throw, when the device is lost before the bytes
 * are mapped (the map rejects) or the rect lies wholly off the view; a malformed option throws at the call.
 */
export async function captureFrame(device: GPUDevice, passes: FramePasses, format: GPUTextureFormat, inputs: GroundFrameInputs, cache: HeldCache, opts: CaptureOptions = {}): Promise<CaptureBytes | undefined> {
  checkCapture(opts);
  // `marks: false` (I40): this capture's inputs carry the frame's marks less the selection's — a copy; the presented inputs are not touched
  const marked = opts.marks === false && inputs.marks !== undefined ? { ...inputs, marks: unselectedMarks(inputs.marks) } : inputs;
  const frame = scaledInputs(marked, opts.scale ?? 1);
  const dpr = frame.view.dpr;
  // the still's size: the attachment a view of this dpr names (kit/layer.ts `attachmentOf` — `surface().fit`'s rule, the reflector's)
  const size = { w: Math.max(1, Math.round(frame.view.width * dpr)), h: Math.max(1, Math.round(frame.view.height * dpr)) };
  // the rect in the still's device px, clipped to it
  let box = { x: 0, y: 0, w: size.w, h: size.h };
  const r = opts.rect;
  if (r !== undefined) {
    const x0 = Math.max(0, Math.round(r.x * dpr));
    const y0 = Math.max(0, Math.round(r.y * dpr));
    const x1 = Math.min(size.w, Math.round((r.x + r.width) * dpr));
    const y1 = Math.min(size.h, Math.round((r.y + r.height) * dpr));
    box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (box.w <= 0 || box.h <= 0) return undefined;
  }
  const still = new Target(device, { format, label: "capture/still", readable: true }, size.w, size.h);
  const into: HeldInto = { view: () => still.view, size: () => size };
  const rowBytes = Math.ceil((box.w * 4) / 256) * 256;
  const readback = device.createBuffer({ label: "capture/readback", size: rowBytes * box.h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const copy = (encoder: GPUCommandEncoder): void => { encoder.copyTextureToBuffer({ texture: still.texture, origin: [box.x, box.y] }, { buffer: readback, bytesPerRow: rowBytes }, [box.w, box.h]); };
    if (frame.held !== undefined && frame.held.e > 0 && passes.hold !== null) {
      // the hand (D4b): the held frame's own path — its encoders submitted inside it, named for the capture — then the copy out
      renderHeldFrame(device, passes.hold, passes.root, passes.pool, passes.grid, into, frame, frame.held, cache, "capture");
      const encoder = device.createCommandEncoder({ label: "capture/read" });
      copy(encoder);
      device.queue.submit([encoder.finish()]);
    } else {
      const encoder = device.createCommandEncoder({ label: "capture" });
      encodeFrame(encoder, passes, frame, into, "capture");
      copy(encoder);
      device.queue.submit([encoder.finish()]);
    }
    // the device lost before the bytes land: the map rejects, and the answer is honest — nothing, never a throw
    try { await readback.mapAsync(GPUMapMode.READ); } catch { return undefined; }
    const padded = new Uint8Array(readback.getMappedRange());
    const bytes = new Uint8Array(new ArrayBuffer(box.w * box.h * 4));
    for (let y = 0; y < box.h; y++) bytes.set(padded.subarray(y * rowBytes, y * rowBytes + box.w * 4), y * box.w * 4);
    readback.unmap();
    return { width: box.w, height: box.h, format, bytes };
  } finally {
    readback.destroy();
    still.dispose();
  }
}
