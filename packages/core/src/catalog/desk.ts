/**
 * The desk's vocabulary (design-015 §4.2, §5.1 — D2a-core, 2026-09-25).
 *
 * ADDITIVE: nothing in the DOM/GL paths reads or writes these, and a board of
 * pre-desk widgets carries none of them, so every existing order and every
 * existing gesture is what it was.
 *
 * - `Stratum` — which stratum of the desk an object lies in. A runtime rider
 *   exactly like the capability tags: derivable from the widget TYPE (its
 *   declared `stratum`, an `object` defaulting to `things`), so equip stamps it
 *   at projection on every peer and nothing syncs it (design-013 D4's argument
 *   for `SurfaceKind`, applied to the one presentation fact that survives the
 *   desk). `compareStackOrder` reads it FIRST, so pick order is paint order
 *   across kinds (design-015 §4.2's table, D-D4).
 * - `Locked` — the tape (*Marks on the Mat* Q-e): a taped widget is never
 *   moved or resized by a gesture (moveClaim and resizeClaim give it no rider)
 *   and the marquee passes over it (Q-g), yet it stays selectable, pickable and
 *   openable. A DURABLE TAG — document truth that syncs and undoes — with one
 *   writer, `ops.setLocked` (one transaction). A tag rather than a zero-field
 *   component because a marker IS strata's tag ("a zero-sized marker", its own
 *   `defineTag` doc) and *Marks on the Mat* named it one; the document holds one
 *   `tag:Locked` register per entity. Tags are not prefab-eligibility-checked
 *   (guards/guarded-tx.ts header — "optional-tag modeling is future work"), so
 *   any durable widget carries it with no prefab declaration.
 */
import { enumOf, field, type Entity } from "@vibecook/strata-ecs";
import { defineComponent, defineResource, defineTag } from "../schema/meta";

/** A desk stratum an object can declare (design-015 §4.2). The mat, the held set and the marks are the renderer's, never declared. */
export type DeskStratum = "pads" | "sheets" | "things";

/**
 * `Stratum.band` per declared stratum — ascending = paint order: pads lie under
 * everything on a desk (the calendar pad), sheets lie flat on the mat and hold a
 * desk (the mini mats), things are every other object.
 */
export const STRATUM_BANDS: Readonly<Record<DeskStratum, number>> = Object.freeze({
  pads: 0,
  sheets: 1,
  things: 2,
});

/**
 * The band an entity WITHOUT a `Stratum` sorts in: things. Every pre-desk widget
 * is one, so an all-dom board stays in one band and its order is exactly its
 * sibling order, as before (design-015 §4.2: "things … every future kind").
 */
export const DEFAULT_STRATUM_BAND = STRATUM_BANDS.things;

/** Runtime: the object's desk stratum (equip, from the type's `stratum`). Read by `compareStackOrder`. */
export const Stratum = defineComponent("Stratum", {
  band: field("u8", { default: DEFAULT_STRATUM_BAND }),
});

/** Durable: taped down (design-015 §5.1, Q-e). One writer: `ops.setLocked`. */
export const Locked = defineTag("Locked");

/**
 * Runtime: the ONE focused editor is on this object (design-015 §5.1, §6.1 — D2c): a note being
 * written. One writer, the desk's typing session (`@ice/desk` objects/typing.ts); a runtime rider,
 * never in the document (a peer's editor is its own). While present it is a GESTURE CLAIM on the
 * object's cells — `makeDefaultMayDiverge` grants the divergence — so the session writes the note's
 * text LIVE through the guarded live writer and commits it ONCE when the session ends (design-001
 * §3's gesture protocol with the keyboard as the gesture: ⌘Z undoes a typing session, never a key).
 */
export const Editing = defineTag("Editing");

// ---------------------------------------------------------------- the opening (design-015 §8; D4b)

/**
 * Runtime: this object is IN HAND (design-015 §8 — "`Held` is the fact"). ONE writer, the open
 * op: `ops.open(entity)` adds it (with a fresh `HeldView`) and `ops.putDown()` removes it; at most
 * one object on a desk carries it. The pickup's clock, the flight home, the blur amount and the
 * cover spring are the renderer's FLUX, never facts — the tag says only "in hand"; an object whose
 * tag just left is flying home in the renderer alone. While an object is held every pointer is
 * the held object's and the desk behind is inert (systems/held.ts). Never in the document.
 */
export const Held = defineTag("Held");

/**
 * Runtime: the user's facts about the object in hand — how close it was brought (`zoom`, 1 = the
 * reading size, 0.72 … 3) and where it was moved under the eye (`panX`/`panY`, CSS px from the
 * reading pose's centre). Written by the held input system from the wheel, a pinch and a pan; put
 * on with `Held` at the open and taken off with it. The renderer reads it to pose the object.
 */
export const HeldView = defineComponent("HeldView", {
  zoom: field("f64", { default: 1 }),
  panX: field("f64", { default: 0 }),
  panY: field("f64", { default: 0 }),
});

/**
 * A system's IN-TICK request to pick an object up or put it down (D2b's `NavIntent`, applied the
 * same way): the double-tap on an openable object asks to `open`; the ways back that are
 * gestures — a click on the soft desk, a pinch or ⌘-wheel in past 0.72×, a double-tap on the
 * held object's case — ask to `putDown`. The ops are structural (a tag and a component come and
 * go) and run outside the tick: the facade applies the request once `engine.step` returns.
 * `epoch` bumps per request; `target` is the object to open (unused on a put-down).
 */
export const HeldIntent = defineResource(
  "HeldIntent",
  {
    kind: field(enumOf(["open", "putDown"]), { default: "open" }),
    target: field("eid", { default: 0 as Entity }),
    epoch: field("u32", { default: 0 }),
  },
  { durable: false },
);

/**
 * A zoom-out put the object down and the REST OF THAT GESTURE is muted (design-015 §8 — "the v2
 * lesson"): until `until` (the frame clock, ms) every wheel fact is swallowed before the camera
 * can read it, and each swallowed event pushes the mute 250 ms further. One writer: the held
 * input system.
 */
export const HeldMute = defineResource("HeldMute", { until: field("f64", { default: 0 }) }, { durable: false });

/**
 * Runtime, on a LOCAL pointer while an object is held: where the pointer is in the held object's
 * OWN frame — its open extent's units, centred, mapped through the same pose the renderer drew
 * (`HeldPoseSource`) — and whether it is over the object at all. Change-only. What a kind's held
 * behaviours (its parts, its pen — D3t) read; absent when nothing is held or before the first frame.
 */
export const HeldPointer = defineComponent("HeldPointer", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  inside: field("bool", { default: false }),
});

/**
 * Runtime, on a local pointer: a press that began while an object was held — on the soft desk
 * (`desk`: released unmoved, it puts the object down; dragged with the object brought close, it
 * pans), as a pan (`pan`: a middle button or Space, the object brought close) or on the object
 * itself (`object`: the kind's — D3t; two instant taps put it down). `x`/`y` where it began (CSS
 * px), the pan it began from, and whether it has moved past the slop.
 */
export const HeldPress = defineComponent("HeldPress", {
  kind: field(enumOf(["desk", "pan", "object"]), { default: "desk" }),
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  panX0: field("f64", { default: 0 }),
  panY0: field("f64", { default: 0 }),
  moved: field("bool", { default: false }),
});

/** The last instant tap on the held object: where and when — a second within the window puts it down (the notebook's case, generalised). */
export const HeldTapMemo = defineResource(
  "HeldTapMemo",
  { x: field("f64", { default: 0 }), y: field("f64", { default: 0 }), at: field("f64", { default: 0 }), seq: field("u32", { default: 0 }) },
  { durable: false },
);
