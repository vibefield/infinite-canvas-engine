// THE ONE EDITOR's face, its LEASE and a kind's TEXT PARTS (design-015 §6.1, D3t-c; design-016 §5 · K-L2, K8a): the desk has
// one focused editor — the platform's textarea in screen space (desk/host/editor.ts, the DESK's since K8a: it needs no kind) —
// and every kind whose objects take text LEASES it: the note's body, the desk calendar's day line, a plugin's part, alike. A
// kind declares its text parts with its object (`defineObject({ host: { text } })`): a part the desk routes a TAP to (the note's
// body — a tap on the sheet), or a part its own DOM half leases at event time (the calendar's day line — a day selected). The
// kit's since K4a, so a borrower names no other kind's folder. Types only: the DOM stays in desk/host.

import type { Entity } from "@ice/core";

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
  /** The platform's value after an input event. */
  input(value: string): void;
  /** A key the lease takes: true — handled (the editor prevents its default, so the keymap stands down). */
  keydown(ev: KeyboardEvent): boolean;
  /** The caret moved (a selection change, a tap, a value the world moved): its index. */
  caret(index: number): void;
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
