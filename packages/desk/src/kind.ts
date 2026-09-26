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

import type { RecordStoreStats } from "./engine/records";
import type { FadeIn, View } from "./lattice/lod";
import type { MatConfig, MatFrame, SlotLight } from "./mat/layout";
import type { MatPass } from "./mat/mat-pass";
import type { MatLight } from "./mat/night";
import type { Presentation } from "./nav/portal";
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
export interface SlotContext {
  /** The slot's camera and box (CSS px) and the device pixel ratio. */
  readonly view: View & { readonly dpr: number };
  /** The slot's grid's fade-in window AS ITS GRID NAMES IT — `dressGrid` dresses the mat's lattice alone, never the objects. */
  readonly fadeIn: FadeIn;
  /** The slot's mat config (its gobo, its rulers, its vinyl) — what a pass's copy of the mat's block is filled from. */
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
  /** A sheet's marks over its live inside, drawn right after the inside (the mini mat's chips while the inside's objects come in). */
  drawOver?(pass: GPURenderPassEncoder, index: number): void;
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
  create(device: GPUDevice, format: GPUTextureFormat, mat: MatPass): Promise<KindPass<R>>;
}
