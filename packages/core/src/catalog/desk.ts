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
 * Runtime, on the object in hand: its ACTIVE tool (design-015 §8; D3t-a — widget/held-tools.ts) — the
 * id of the held bar's `mode` in hand (the board's marker in blue, its eraser), and `prev` the one
 * before it (a `toggle` mode chosen again hands that one back). The USER's fact, never in the document.
 * Put on with `Held` by `ops.open` (the type's `heldTool` of its props, else its first mode; "" = none)
 * and taken off with it; `ops.useHeldTool` its only other writer. The kind's held behaviours read it.
 */
export const HeldTool = defineComponent("HeldTool", {
  id: field("string", { default: "" }),
  prev: field("string", { default: "" }),
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
 * `part` (D3t-a): the kind's part under it as the renderer drew it (the pose seam's `part` — the
 * board's melamine `content`, its aluminium `frame`), "" over nothing.
 */
export const HeldPointer = defineComponent("HeldPointer", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  inside: field("bool", { default: false }),
  part: field("string", { default: "" }),
});

/**
 * Runtime, on a local pointer: a press that began while an object was held — on the soft desk
 * (`desk`: released unmoved, it puts the object down; dragged with the object brought close, it
 * pans), as a pan (`pan`: a middle button or Space, the object brought close), on the object's
 * drawing surface with a mode in hand (`tool`, D3t-a: the TOOL's press — the board's stroke; never
 * a tap that puts it down), on one of the kind's named PARTS (`part`, D3t-b: the kind's own — a
 * notebook's turn, its click and its drag; never a tap that puts it down) or elsewhere on the object
 * itself (`object`: two instant taps put it down). `part`: the part it began on ("" — none); `x`/`y`
 * where it began (CSS px), the pan it began from, and whether it has moved past the slop.
 */
export const HeldPress = defineComponent("HeldPress", {
  kind: field(enumOf(["desk", "pan", "object", "tool", "part"]), { default: "desk" }),
  part: field("string", { default: "" }),
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

/**
 * Runtime, ONE per view: THE TRAY (design-016 §7, K-L6; design-017 §2 — K3) — the pegboard drawer's facts. `open`; `scroll`, CSS px
 * of board past its top, within `[0, max]` (the renderer's word on `max` rides the tray pose seam, systems/tray.ts); `stretch`, the
 * rubber band's pull past an end (raw px, signed; 0 at rest); `lip`, the mouse over the lip of a closed drawer (its one hover fact);
 * `wheelAt`, the frame clock (ms) of the last scroll input (every wheel the drawer takes while out, a drag on its board) — the band
 * lets go once it is quiet, and a drawer shut before then keeps the wheel until it is (K9). Never in the document, never synced:
 * a peer's tray is its own. Writers: the tray ops (ops/tray.ts) and `trayInput` — and `trayLay`, which clamps `scroll` when a lay
 * or the drawer's face moves its range (K9, D-K9-c.2); the renderer reads it, and owns the motion (the
 * slide, the lip's lift, the band's settle — flux). The entity is ensured at install and after every reset (a document switch
 * closes the tray); it roots the tray's runtime canvas (K5's specimens will be its children).
 */
export const Tray = defineComponent("Tray", {
  open: field("bool", { default: false }),
  scroll: field("f64", { default: 0 }),
  stretch: field("f64", { default: 0 }),
  lip: field("bool", { default: false }),
  wheelAt: field("f64", { default: 0 }),
  /** K5a: the type of the specimen under the mouse while the drawer is out ("" — none): the hover that lifts it (flux). */
  hover: field("string", { default: "" }),
  /**
   * K5b — TAKING ONE (design-017 §9): the type whose copy a pointer has lifted off the board ("" — none): pressed on its specimen and
   * moved past the slop, still inside the drawer. `takeU`/`takeV` the grab point (0 … 1 across the object as the board draws it — the
   * spot under the finger stays that spot of the object), `takeX`/`takeY` the pointer as last seen (CSS px) — the copy follows it
   * (flux). `handed` counts the takes handed to the desk: it bumps on the tick the copy leaves the drawer's open rect (the drawer slides
   * away, `TrayIntent` spawns the insert ghost after the step); a take that ends without the bump was put back.
   */
  take: field("string", { default: "" }),
  takeU: field("f64", { default: 0.5 }),
  takeV: field("f64", { default: 0.5 }),
  takeX: field("f64", { default: 0 }),
  takeY: field("f64", { default: 0 }),
  handed: field("u32", { default: 0 }),
});

/**
 * K5b — the tray's IN-TICK request to hand a taken copy to the desk (design-017 §9; `HeldIntent`'s shape): the copy left the drawer, so
 * the facade calls `ops.insertByDrag` once the step returns — the op spawns and enqueues, which no system does mid-tick. `type` the
 * object type; `x`/`y` the pointer (CSS px) and `pointerId`/`device`/`buttons` its press, which the insert ghost's synthetic down takes
 * over; `u`/`v` the grab point (the insert's `anchor` — no centre-snap); `homeX`/`homeY` the specimen's spot on screen (the insert's
 * `home`, where a cancel flies the ghost back). `epoch` bumps per request.
 */
export const TrayIntent = defineResource(
  "TrayIntent",
  {
    type: field("string", { default: "" }),
    x: field("f64", { default: 0 }),
    y: field("f64", { default: 0 }),
    pointerId: field("string", { default: "mouse" }),
    device: field(enumOf(["mouse", "touch", "pen"]), { default: "mouse" }),
    buttons: field("u32", { default: 1 }),
    u: field("f64", { default: 0.5 }),
    v: field("f64", { default: 0.5 }),
    homeX: field("f64", { default: 0 }),
    homeY: field("f64", { default: 0 }),
    epoch: field("u32", { default: 0 }),
  },
  { durable: false },
);

/**
 * Runtime, on the TRAY entity (design-017 §8; K5a): what the lattice law last laid (systems/tray.ts `createTrayLay`) — the drawer's
 * width it laid for (CSS px, the renderer's word through the pose seam), the content's foot (board px — the scroll's range is that
 * plus a pitch less the face, the renderer's to say) and how many lays so far (a renderer re-reads the specimens when it moves).
 */
export const TrayContent = defineComponent("TrayContent", {
  width: field("f64", { default: 0 }),
  bottom: field("f64", { default: 0 }),
  laid: field("u32", { default: 0 }),
});

/**
 * Runtime tag: a SPECIMEN (design-017 §8; K5a) — a kind hung on the pegboard tray: `ChildOf` the tray entity (which roots its
 * runtime canvas), `PrefabId` the kind's widget type, `Position` board px (x from the drawer's left edge, y down from the board's
 * top at scroll 0), `Size` its hang's, its entry's props over the widget's defaults. Spawned equipped (no capability tag, no
 * rider, no behaviour — nothing acts on it) and under a canvas that is no frame, so never `Active`: the desk's stack never picks,
 * selects, culls or saves one; never durable, never synced. A host that walks "the document's widgets" by `[Position, Size, PrefabId]`
 * excludes it (`Not(Specimen)`) — a durable transaction over a runtime entity is refused ("op references an entity not in this store").
 */
export const Specimen = defineTag("Specimen");

/**
 * Runtime, on a local pointer: a press the TRAY took (design-017 §4) — on the lip of a closed drawer (`lip`: a click or a drag up
 * opens it), on the open drawer (`board`: a drag scrolls it), on the dimmed desk (`desk`: released unmoved, it closes the drawer).
 * Where it began (CSS px), the scroll it began from, whether it moved past the slop. K5b (§9): on a SPECIMEN (`specimen`: past the
 * slop its copy lifts; out of the drawer it is handed to the desk) — its `type`, the grab point `u`/`v` across the object as drawn,
 * the specimen's centre on screen `homeX`/`homeY`; and, once handed, the take CARRIED (`carry`: the insert ghost's drag is this
 * pointer's — released back over the drawer as drawn, still sliding away, it is cancelled and the ghost flies home).
 */
export const TrayPress = defineComponent("TrayPress", {
  kind: field(enumOf(["lip", "board", "desk", "specimen", "carry"]), { default: "desk" }),
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  scroll0: field("f64", { default: 0 }),
  moved: field("bool", { default: false }),
  type: field("string", { default: "" }),
  u: field("f64", { default: 0.5 }),
  v: field("f64", { default: 0.5 }),
  homeX: field("f64", { default: 0 }),
  homeY: field("f64", { default: 0 }),
});
