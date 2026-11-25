// THE ONE EDITOR's face, its LEASE and a kind's TEXT PARTS (design-015 §6.1, D3t-c; design-016 §5 · K-L2, K8a): the desk has
// one focused editor — the platform's textarea in screen space (desk/host/editor.ts, the DESK's since K8a: it needs no kind) —
// and every kind whose objects take text LEASES it: the note's body, the desk calendar's day line, a plugin's part, alike. A
// kind declares its text parts with its object (`defineObject({ host: { text } })`): a part the desk routes a TAP to (the note's
// body — a tap on the sheet), or a part its own DOM half leases at event time (the calendar's day line — a day selected). The
// kit's since K4a, so a borrower names no other kind's folder. Types only: the DOM stays in desk/host.
//
// THE RANGE AND THE CLIPBOARD (petition I60): a lease may say where its writing lies (`indexAt`, `rangeAt`) — the editor then claims a
// press on it and turns a drag, a double or a third click and Shift into the textarea's own range, told to the lease with the caret
// (`selection`; never stored, never synced) — and may lift and lay its words (`lift`, `lay`) for the field's copy, cut and paste. A
// lease that declares none of them behaves exactly as before.
//
// WHERE A RANGE LIES (petition I60 — "the selection bar comes to the words"): a lease may say where a range of its words is in the
// world (`rangeBox`) — the desk then places the selection menu's anchor over the words selected (`SelectionAnchor.words`), with the
// object's words acts. A lease that declares none has no words' menu.

import type { Entity } from "@ice/core";

/** What a double click takes (a WORD around an index) and a third (the LINE as laid) — petition I60. */
export type TextUnit = "word" | "line";

/** A range of the lent text: `from` ≤ `to`, text indices — `from` = `to` is a caret. */
export interface TextRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Where a range of the lent text LIES (petition I60): a WORLD box, axis-aligned — `x`, `y` its top-left, `w`, `h` its size, world units
 * — the union of the range's glyph boxes as the part lays them; on a turned part, the box of their turned corners.
 */
export interface RangeBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What a COPY or a CUT takes to the clipboard (petition I60): the words, and what the lease adds to them. */
export interface EditorLift {
  /** The words as plain text — the clipboard's `text/plain`, always written. */
  readonly text: string;
  /** The words for other apps (`text/html`), as the kind draws them. */
  readonly html?: string;
  /** The kind's own PIECE — its words and marks as the kind writes them (JSON text), under `application/x-ice-ink+json`; handed back to a paste as written, never read by the editor. */
  readonly piece?: string;
}

/** What a PASTE hands the lease (petition I60): the clipboard's plain words, and the kind's piece when a copy put one there. */
export interface EditorPaste {
  readonly text: string;
  readonly piece?: string;
}

/**
 * Where the textarea stands while lent (container px): its box's top-left and size BEFORE any turn, the size its text is laid
 * at, and — for a turned part (a note stuck at its tilt) — the turn about the box's centre, the padding, the line height and
 * whether lines wrap. Absent: unturned, no padding, one line the box's height, no wrap (a day's line).
 */
export interface EditorPlace {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fontPx: number;
  /** The turn about the box's centre, radians — the editor is placed translate · rotate · translate (never a scale, never a matrix). */
  readonly angle?: number;
  /** The text's inset from the box's edges, px. */
  readonly pad?: number;
  /** The line height, px (default: the box's height — one line). */
  readonly lineHeight?: number;
  /** Lines wrap (a note's body) or run on (a day's line — default). */
  readonly wrap?: boolean;
  /** The face the platform lays the text in (the caret's arrows by line): the editor's own (the desk's hand) unless the part says. */
  readonly font?: { readonly family: string; readonly weight: number };
}

/**
 * A LEASE on the ONE editor (D3t-c; K8a — any kind's): while lent, the textarea's value, keys, caret and blur are the lease's, and
 * it says where the textarea stands; another lease, a blur, `release`, `live()` answering false or the editor's `dispose` (the desk
 * unmounted — petition I25) ends it (`ended`).
 */
export interface EditorLease {
  /** The TEXT PART this lease writes — its kind's declared `TextPart.part` ("note.body", "calendar.line"): what `lease()` names. */
  readonly part?: string;
  /** The textarea's accessible name while lent ("write on the note"). */
  readonly label?: string;
  /**
   * The value the textarea holds — asked when the lease begins and each frame after, so a write the world made between sessions
   * (a peer's, an undo) reaches the platform's field; `null`: keep the field's own (a session is open — the field is the truth).
   */
  value(): string | null;
  /** The platform's value after an input event (while a composition runs, only for a lease that declares no `compose`). */
  input(value: string): void;
  /**
   * The IME's COMPOSITION as it runs (design-019 §5, M24 LT2 — the preedit a remote page's IME is driven by): told once as it starts
   * (`""`, 0) and after each update the platform applies — the composition's text and the caret within it. A lease that declares it is
   * told the composition INSTEAD of `input` values while one runs; absent, it sees the field's values as ever (the preedit inside them).
   */
  compose?(text: string, caret: number): void;
  /** The composition COMMITTED (`compositionend`'s data, M24 LT2) — the text it ended with ("" when it was cancelled). */
  commit?(text: string): void;
  /** A key the lease takes: true — handled (the editor prevents its default, so the keymap stands down). */
  keydown(ev: KeyboardEvent): boolean;
  /** The caret moved (a selection change, a tap, a value the world moved): its index. */
  caret(index: number): void;
  /**
   * The SELECTION (petition I60): told with `caret`, on every selection change — the range the textarea holds, `from` ≤ `to` (`from` =
   * `to` is a caret). The platform's field holds it, as it holds the caret: never stored, never synced; a kind draws its wash from it.
   */
  selection?(from: number, to: number): void;
  /**
   * The text index nearest world point (wx, wy) ON the lent part — undefined off it (petition I60). A lease that declares it has the
   * editor CLAIM a primary press there (mouse or pen, the select tool, no ⌘/ctrl/⌥ — no carry, marquee or pan starts from it) and turn
   * a drag, a double and a third click and a Shift+click into the textarea's range; a release within the drag slop is still a tap.
   * `hit` is the interaction stack's exact hit under a PRESS when the stack knows the pointer — a press on another object lying over
   * the part is that object's (answer undefined); absent for a drag's moving point, which the part answers from its geometry alone.
   */
  indexAt?(wx: number, wy: number, hit?: Entity): number | undefined;
  /** The word or the laid line around text index `index` (a double click, a third) — undefined: the editor puts a caret there. */
  rangeAt?(index: number, unit: TextUnit): TextRange | undefined;
  /**
   * Where the words [from, to) LIE, in the world (petition I60 — `RangeBox`: the union of their glyph boxes, turned parts included as
   * the box of the turned corners) — undefined when the part cannot say (an empty range, a part not drawn yet). A lease that declares it
   * has the selection menu come to the words selected while it is lent (`SelectionAnchor.words`), asked each time the anchor is
   * recomposed: it reads what the part last drew, and writes nothing.
   */
  rangeBox?(from: number, to: number): RangeBox | undefined;
  /** A COPY or a CUT of [from, to) (petition I60): what goes on the clipboard — undefined leaves the platform's own copy. */
  lift?(from: number, to: number): EditorLift | undefined;
  /**
   * A PASTE over [from, to) (petition I60): the clipboard's piece when it holds one, else its plain words. True — the lease laid it (the
   * editor prevents the platform's own paste; `DeskEditor.write` is the field's path); false leaves the platform's paste alone.
   */
  lay?(paste: EditorPaste, from: number, to: number): boolean;
  /** Where the textarea stands — null keeps it where it was. */
  place(): EditorPlace | null;
  /** 1 s without input (never mid-IME): a session's end; the focus stays. */
  idle(): void;
  /** The lease is over (a blur, another lease, `release`, `live()` false). */
  ended(): void;
  /** Asked each frame while lent, before the value: false lets the lease go (its object was deleted, or left the frame by a nav cut). */
  live?(): boolean;
}

/** THE ONE EDITOR (the desk's service since K8a — `DeskLayerHandle.editor()`, `ObjectDomHost.editor`): lent, never owned by a kind. */
export interface DeskEditor {
  readonly element: HTMLTextAreaElement;
  /** Lend the editor (D3t-c): a lease holding it ends first; the textarea takes focus, its value the lease's, the caret at `caret` (the end by default). */
  lend(lease: EditorLease, caret?: number): void;
  /** End the lease (only `lease`'s, when named). */
  release(lease?: EditorLease): void;
  /** The lease holding the editor, if any. */
  lease(): EditorLease | undefined;
  /** End whatever lease holds it (the editor hidden, the focus given back). */
  blur(): void;
  /** After each draw: the lease's `live` and value asked, the textarea placed where the lease says. */
  follow(): void;
  /** Where the editor's box stands on screen (container px): its centre, size and turn — null while hidden. */
  placement(): { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number; readonly angle: number } | null;
  /**
   * Write `text` over [from, to) of the field AS AN INPUT WOULD (petition I60 — a cut's delete, a lease's paste): through the platform's
   * own editing where it allows, so the field's history keeps the step (⌘Z in the field undoes it, as it undoes a typed edit), else the
   * value set and the input path run as for a key — either way the lease is told `input` with the new value (its typing records it as
   * one step), the idle re-armed, the caret after the text. Nothing while the editor is lent to nothing or an IME composition runs.
   */
  write(text: string, from: number, to: number): void;
  /**
   * A press the editor CLAIMED on the lent part's writing is down (petition I60): the range it makes is not settled — its release may
   * leave a caret (a tap) or a new range (a drag, a second or a third click) — so the selection menu's words wait for the release.
   */
  pressing(): boolean;
  /** The editor goes with its desk: a lease still held ends first (`ended` — a typing session commits), then the textarea leaves. */
  dispose(): void;
}

/**
 * A TAP the desk read on its container (DOM-at-event-time, design-007 §2 — a press and release within the drag slop, the primary
 * button, no modifier): its world point and the object the pointer EXACTLY hit — the interaction stack's own answer. `found`
 * false: the pointer is gone (a touch lifted before the click) and a part may look for itself; `hit` undefined with `found`: the
 * pointer hit nothing, or an object is in hand (a tap in hand is the hand's).
 */
export interface TextTap {
  readonly wx: number;
  readonly wy: number;
  readonly found: boolean;
  readonly hit: Entity | undefined;
}

/**
 * A kind's TEXT PART (K8a — declared with its object, `defineObject({ host: { text } })`): a part of its objects that takes the
 * ONE editor. `part` names it ("note.body"); a part with `tap` is routed every TAP by the desk — it answers the lease the tap
 * takes (the editor is lent to it, the caret where the tap put it) or undefined (not its object; refused). A part without `tap`
 * is leased by its kind's own DOM half at event time (the desk calendar's day line: a day selected).
 */
export interface TextPart {
  readonly part: string;
  tap?(t: TextTap): { readonly lease: EditorLease; readonly caret?: number } | undefined;
}
