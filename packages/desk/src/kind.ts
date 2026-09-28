// The KIND contract — the render half of design-015 §5.2's `ObjectKind`. The ground
// (ground.ts, the composition root) draws a desk's objects without naming one of them:
// every kind registers a PROGRAM (its name, its stratum, how its pass is made on the
// root's mat), and the ground asks each slot's PASS of that kind to prepare the kind's
// records and draw them in ranges. The world half — resolve, record, hit, reach, the
// reads the builder pulls — is D2a-world's; nothing here knows the world.
//
// Paint order (design-015 §4.2, D-D4): the mat is the ground's own; then the STRATA in
// order — pads, sheets, things — and within a stratum the objects in the caller's paint
// order, cut into RUNS of one kind: one `drawRange` per run, each kind counting its own
// records. A sheet that holds a desk (the mini mat) splits its run where its live inside
// goes: the inside draws right after it, then the sheet's marks over the inside
// (`drawOver` — the mini mat's chips while the inside's objects come in).

import type { BindKind } from "./engine/pipeline";
import type { RecordStoreStats } from "./engine/records";
import type { ComposeOptions } from "./engine/shader";
import type { MatLight } from "./kit/light";
import type { Presentation } from "./kit/nav";
import type { FadeIn, MatConfig, MatFrame, MatPass, SlotLight, View } from "./kit/view";
import type { GroundTheme, RGB } from "./theme";

/** The strata of the desk a kind can lie in (design-015 §4.2): beneath everything, flat on the mat holding a desk, every other thing. */
export type StratumName = "pads" | "sheets" | "things";

/**
 * The strata in paint order. The mat (stratum 0) is the ground's own and draws first; the held set and the
 * marks (strata 4 and 5) are D4's. A kind's place in the registry never moves it out of its stratum.
 */
export const STRATA: readonly StratumName[] = ["pads", "sheets", "things"];

/**
 * Everything a kind's pass is prepared with for one slot, one frame — what each object pass's `prepare`
 * took as arguments before the registry, in one record. The ground fills it; a kind reads what it needs.
 */
/**
 * What a slot is prepared FOR (D7): `frame` — the canvas (and the hand's own slot over it); `copy` — the held desk copy behind the
 * hand, the desk at half the dpr (design-015 §8). A held frame prepares the root twice, once for each, so a pass that keeps state
 * between its prepares keeps the copy's apart.
 */
/**
 * The render a slot is prepared for (D7): the FRAME (the desk as it is), the COPY (the desk behind a carried object, made once
 * per stamp and blurred), or the HAND (K9 R4 — the carried object alone, prepared EVERY frame of the carry while the copy
 * stands). A pass that keeps state per render keeps the copy's apart; a pass whose residency asks are per prepare (the
 * pictures' details, the boards' pool) re-asks what it has bound under the hand, else the tick's step — seeing only the hand's
 * asks — would free every other detail on the desk behind it, a softness pop at every put-down.
 */
export type RenderTarget = "frame" | "copy" | "hand";

export interface SlotContext {
  /** The slot's camera and box (CSS px) and the device pixel ratio. */
  readonly view: View & { readonly dpr: number };
  /** The slot's grid's fade-in window AS ITS GRID NAMES IT — `dressGrid` dresses the mat's lattice alone, never the objects. */
  readonly fadeIn: FadeIn;
  /** The slot's mat config (its gobo, its rulers, its vinyl). The block a pass draws with is the slot's (`MatPass.view`, K4a): read, never copied. */
  readonly cfg: MatConfig;
  /** The mat's clocks and tilt this frame; undefined = a still (a pass fills `STILL_MAT_FRAME`). */
  readonly frame: MatFrame | undefined;
  /** The OBJECTS' presentation: the slot's opacity times their own presence (`Presentation.objects`), and the slot's chain. */
  readonly present: Presentation | undefined;
  /** The Sun or the Moon (the theme's `matLight`). */
  readonly light: MatLight;
  /** The lamp the slot is lit by: undefined = its own camera's, exactly (the root at rest); else its host's (MINIMAT.md §4). */
  readonly lit: SlotLight | undefined;
  /** The selection ring's colour (the theme's `select`). */
  readonly select: RGB;
  /** The theme in force. */
  readonly theme: GroundTheme;
  /** The render this slot is prepared for; absent = the frame's (D7). */
  readonly target?: RenderTarget;
}

/**
 * What the ground knows of a kind's records beyond the slot, this frame. `live(i)`: record `i`'s live inside —
 * its objects' presence over the record's face (0..1), or −1 where none is drawn — which the ground computes from
 * the slot's portals, by the kind's OWN record index. A sheet that holds a desk lets its face's far LOD give way
 * to it (the mini mat); every other kind ignores it.
 */
export interface KindExtra {
  readonly live: (index: number) => number;
  /**
   * The records' KEYS, one per record in the same order (design-015 §4.3; D6) — the builder's entity (a ghost's negated), stable
   * across frames, so a pass with persistent records keeps a record's slot and writes it only when the record object changed.
   * Absent (the oracle, a bare host): every record is packed afresh this frame.
   */
  readonly keys?: readonly number[];
}

/**
 * One slot's pass of one kind. The root's is made by the kind's program on the root's mat; every other slot's is
 * `spawn`ed from it — its own buffers on the shared pipelines, reading its own mat's wind and light.
 */
export interface KindPass<R = unknown> {
  /** A slot's own buffers on the shared pipelines, reading `mat`'s silhouette — a live inside's, a flight's departed desk's. */
  spawn(mat: MatPass): KindPass<R>;
  /** Take the root's laws (the prototype's `tune()` / `copy()`): a spawned slot's pass does, every frame, before it prepares. */
  tune?(root: KindPass<R>): void;
  /** Draw with a host's LIVE law (D5a — `handle.tuneLaw`): the root's pass takes it, and its slots follow through `tune`. */
  setLaw?(law: unknown): void;
  /**
   * Upload this frame's records — the kind's objects in this slot, in paint order — for `slot`'s camera and light.
   * `encoder` is the frame's: work that must precede the frame's pass may be recorded into it (or a pass may submit
   * its own before the frame's, as the whiteboard's stamps and drying do). Returns the count that will draw.
   */
  prepare(encoder: GPUCommandEncoder, slot: SlotContext, records: readonly R[], extra?: KindExtra): number;
  /** Draw records [first, end) — indices into this frame's `records` — in their order, into the open pass. */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void;
  /**
   * The kind's persistent record store's counters (design-015 §4.3; D6) — records packed and uploaded, draw lists rewritten — a
   * rig's witness that a camera move writes no standing record. Absent for a kind that keeps none (the composites' layers).
   */
  records?(): RecordStoreStats;
  /**
   * The records this slot's last `prepare` turned away at the pass's CAP (its buffers' ceiling — the layered kinds' fixed tables,
   * the record stores' most) — objects the builder resolved that will NOT draw. Never silent (D7): the ground sums them into the
   * frame's `GroundStats.dropped` and the host says so.
   */
  dropped?(): number;
  /** The hold is over (D7): a pass that kept the held desk copy's state apart (`SlotContext.target`) gives it back. */
  endHold?(): void;
  /**
   * Let go of the device targets this slot's pass makes again at its next draw, when none of its objects was drawn within `ms`
   * (K6a's D-K6a.3 — a layered kind's layer): asked each tick of the slots a host keeps beyond the root (the tray's, K5a).
   */
  idle?(ms: number): void;
  /**
   * When `idle(ms)` next lets something go (K7a): the host registers it as a TIME wake, so a desk asleep since the drawer shut
   * still wakes to give the layer back. ∞, or absent: nothing to let go (a pass that says no time is let go at a tick taken anyway).
   */
  idleAt?(ms: number): number;
  /** A sheet's marks over its live inside, drawn right after the inside (the mini mat's chips while the inside's objects come in). */
  drawOver?(pass: GPURenderPassEncoder, index: number): void;
  /**
   * K7b: this slot's resources for the kind's CARD MATERIAL (`KindProgram.card`), in its `bindings` order, and a number that moves
   * whenever one of them is replaced (a record store grown, a texture array grown) — the card's bind group is made again then.
   */
  cardResources?(): { readonly version: number; readonly resources: readonly (GPUBuffer | GPUTextureView | GPUSampler)[] };
  /**
   * K7b: record `index` of the last `prepare` drawn by the desk's FLAT-CARD pipeline — its slot in the kind's records, which the
   * material's functions read — or −1: this pass draws it itself (a print with its detail bound, a board with its raster).
   */
  cardSlot?(index: number): number;
  /** This slot's buffers (the shared resources go with the last slot standing). */
  dispose(): void;
}

/**
 * A kind as the ground registers it: its name (unique in a ground), its stratum, and how its root pass is made on
 * the root's mat — once per device; every other slot's pass is `spawn`ed from that one.
 */
export interface KindProgram<R = unknown> {
  readonly name: string;
  readonly stratum: StratumName;
  /**
   * A kind that lays a COMPOSITE (design-015 §4.2): its pass renders every one of its objects into a target of its own in `prepare`
   * (depth, MSAA, shadow maps — the notebook's layer, the calendar's) and `drawRange` lays that target over the frame in one draw.
   * The ground draws such a kind as ONE run, [0, count), after every other run of its stratum — its objects cannot interleave with
   * another kind's without a target per run (D-D4's exception: a note laid on a notebook draws under it). Absent: the kind's objects
   * are cut into runs in the slot's paint order.
   */
  readonly composite?: boolean;
  /**
   * K7b: the kind's CARD MATERIAL — its records drawn by the desk's ONE flat-card pipeline (card/card.ts), interleaved with every
   * other material kind's objects in one run. Absent: the kind draws every record itself, a run of its own.
   */
  readonly card?: CardMaterial;
  create(device: GPUDevice, format: GPUTextureFormat, mat: MatPass): Promise<KindPass<R>>;
}

/** A binding of a CARD MATERIAL (K7b): the WGSL the card declares after `@group(0) @binding(n)`, and its layout (the stages, what it is). */
export interface CardBinding {
  /** Whole, after the attribute: `var<uniform> paper_k: PaperUniforms` — its name UNIQUE across every kind's material (a kind prefixes its own). */
  readonly wgsl: string;
  readonly entry: BindKind;
}

/**
 * A kind's CARD MATERIAL (K7b, design-016 §6 K7 — the run question). In mixed sibling order a run of one kind ends at the next
 * object of another (rig:scale: draws ≈ 0.3 × the objects drawn, at every zoom); the kinds that declare a material are composed
 * into ONE pipeline, so interleaved objects of every such kind are one run, one draw. Each object is drawn there by its OWN kind's
 * functions over its own kind's records, uniforms and textures — the pixels its own pipeline makes. The card's module is the
 * kit's pieces and every material's structs and modules (deduplicated by name and label), then its bindings, its `only`, its
 * card functions (`shaders.entry` — the same text its own pass composes) and a dispatch on the card's material.
 */
export interface CardMaterial {
  /**
   * The kind's program as its own pass composes it — the kit's pieces, its structs, its pure modules — its `entry` the CARD FUNCTIONS
   * over its bindings; asked when the card is composed (a host's text read then, as a pass reads it when it is made).
   */
  shaders(): ComposeOptions;
  /** WGSL the card composes that the kind's own entry defines otherwise (a texel read from its thumbnails alone — the card binds no pool). */
  readonly only?: string;
  /** Its bindings beyond the slot's view block and mat (`u`, `gobo_tex`, `noise_tex` — the card's), in its pass's `cardResources` order. */
  readonly bindings: readonly CardBinding[];
  /** `fn <quad>(slot: u32, vid: u32) -> vec4f`: corner `vid`'s clip position; (2, 2, 2, 1) — the degenerate — collapses a culled one. */
  readonly quad: string;
  /** `fn <frag>(slot: u32, clip: vec4f) -> vec4f`: the fragment's premultiplied colour through the slot's presentation; alpha < 0 = discard. */
  readonly frag?: string;
  /**
   * The fragment WRITTEN OUT instead of `frag`'s call: WGSL statements over `slot` and `in.clip` that set `c` (or discard) — the
   * kind's own entry's fragment, statement for statement. For a kind whose shade reached through one more function compiles to
   * other bits (the board's: one LSB on a pixel a scene — measured, K7b): the card then runs the very code its entry runs.
   */
  readonly fragInline?: string;
}
