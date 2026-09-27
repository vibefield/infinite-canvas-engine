// THE NOTE'S BODY — its TEXT PART (design-015 §6.1; STICKY.md §4; design-016 §5 · K-L2, K8a): the part of a note the desk's ONE
// editor is lent to. Until K8a the editor itself was the note's (this file made the textarea, and a desk with no note kind had
// none); now the editor is the DESK's (desk/host/editor.ts) and the note LEASES it exactly as the desk calendar's day line does,
// and as a plugin kind's part would: the note declares this part with its object (`defineObject({ host: { text } })`) and the
// desk routes every TAP to it.
//
// A TAP on a note — a press and release within the drag slop, no modifier, the note not carried — puts the editor on it with the
// caret at the tap (the layout's nearest position). The note under the tap is the interaction stack's exact hit (the desk's
// `tapHit`), the writing's last-drawn notes when the pointer is already gone (a touch lifted). A pinned note (a still) is refused.
//
// The world half is `paper/typing.ts`: `begin` on the tap (the `Editing` claim), `input` on every `input` event (the live write,
// the seeds carried), `commit` after 1 s without input (the idle end of a SESSION — the focus stays), `end` when the lease ends
// (Escape, a blur, another part taking the editor, the note deleted or cut away). A write the world makes between sessions — a
// peer's edit, an undo — reaches the textarea on the next frame (the lease's `value`). The pen's wipe and the caret are the
// writing's flux, stamped on ONE clock, `performance.now()` (the rAF clock lags wall time headless).

import { Active, Camera, type Entity, Grab, type World } from "@ice/core";
import type { PaperDriver } from "../object";
import { PEN_FACES, type HandLaw, type DeskEditor, type EditorLease, type TextPart } from "@ice/desk/kit";
import type { PaperGeometry } from "../paper";
import { DEFAULT_FACE, DEFAULT_HAND_LAW, type Writing } from "../writing";

/** The note's text part's name — what the editor's lease carries while a note is being written (`DeskEditor.lease().part`). */
export const NOTE_BODY = "note.body";

export interface NoteBodyOptions {
  /** The desk's ONE editor (the desk makes it — `ObjectDomHost.editor`). */
  readonly editor: DeskEditor;
  readonly world: World;
  /** The note's driver (`PaperDriver`, D-D7-A.3): the host hands the note's own; none, no body. */
  readonly driver: PaperDriver | undefined;
  /** The builder's drawn geometry for an entity. */
  readonly geometryOf: (e: Entity) => unknown;
  /** The hand's face for the platform's own layout of the text (arrow keys by line): family and weight (the paper's default face). */
  readonly font?: { readonly family: string; readonly weight: number };
  readonly hand?: Pick<HandLaw, "size" | "lineHeight" | "pad">;
  /** The clock the writing's flux runs on (`performance.now`). */
  readonly now?: () => number;
}

/** The note's body: its text part (the desk routes taps to it) and the doors a rig and the keys use. */
export interface NoteBody extends TextPart {
  /** Put the editor on note `e`, the caret before glyph `index` (the end by default). False for a still, a non-note or a read-only document. */
  focus(e: Entity, index?: number): boolean;
  /** The note being written, or undefined (the editor lent elsewhere, or to nothing). */
  editing(): Entity | undefined;
}

export function createNoteBody(opts: NoteBodyOptions): NoteBody | undefined {
  const { editor, world } = opts;
  const paper = opts.driver;
  if (paper === undefined) return undefined;   // no note kind on this desk: no body
  const typing = paper.typing;
  const font = opts.font ?? PEN_FACES[DEFAULT_FACE] ?? { family: "Caveat", weight: 500 };
  const hand = opts.hand ?? DEFAULT_HAND_LAW;
  const clock = opts.now ?? (() => performance.now());
  const writing = (): Writing | undefined => paper.writing();
  /** The note being written and ITS lease — one lease a note, so a tap on the same note keeps it and a tap on another hands over. */
  let current: { readonly entity: Entity; readonly lease: EditorLease } | undefined;

  const leaseFor = (e: Entity): EditorLease => {
    const lease: EditorLease = {
    part: NOTE_BODY,
    label: "write on the note",
    // between sessions the world's text reaches the field (a peer, an undo); while a session is open the field is the truth
    value: () => (typing.open() ? null : (typing.ink(e)?.text ?? "")),
    input(value) {
      const r = typing.input(value);
      if (r !== null) {
        const ch = value[r.from];
        // a typed glyph is WRITTEN (the pen's wipe); a paste, a space or a newline arrives whole
        writing()?.wrote(e, r.to - r.from === 1 && ch !== undefined && ch !== " " && ch !== "\n" ? r.from : undefined, clock());
      }
      writing()?.caret(e, editor.element.selectionStart, clock());
    },
    // Escape lets the note go (the keymap's gate 1 stands down; the release is ours)
    keydown(ev) { if (ev.key !== "Escape") return false; editor.release(lease); return true; },
    caret(index) { writing()?.caret(e, index, clock()); },
    place() {
      const G = opts.geometryOf(e) as PaperGeometry | undefined;
      const cam = world.getResource(Camera);
      if (G === undefined || cam === undefined) return null;
      const z = cam.zoom;
      const w = 2 * G.half[0] * z;
      const h = 2 * G.half[1] * z;
      const s = z * G.scale;
      // the sheet's box, turned at its tilt about its centre: its font the hand's × the zoom
      return { x: (G.centre[0] - cam.x) * z - w / 2, y: (G.centre[1] - cam.y) * z - h / 2, w, h, angle: G.angle, fontPx: hand.size * s, pad: hand.pad * s, lineHeight: hand.lineHeight * hand.size * s, wrap: true, font };
    },
    idle() { typing.commit(); },
    ended() {
      // the claim is lifted only if it is still this note's (a tap on another note claimed that one first)
      if (typing.editing() === e) typing.end();
      if (current?.entity === e) { current = undefined; writing()?.caret(undefined); }
    },
    // a delete or a nav cut ends the writing
    live: () => world.isAlive(e) && world.hasTag(e, Active),
    };
    return lease;
  };

  /** The lease a note takes, the claim begun — or undefined: refused (dead, not a note, pinned, a read-only document). */
  const take = (e: Entity): EditorLease | undefined => {
    if (!world.isAlive(e) || !paper.isNote(e) || writing()?.isPinned(e) === true) return undefined;
    if (!typing.begin(e)) return undefined;
    if (current?.entity === e && editor.lease() === current.lease) return current.lease;
    current = { entity: e, lease: leaseFor(e) };
    return current.lease;
  };
  /** Where the caret goes: `index`, else the end — of the field when the lease already holds it (the editor puts a new lease's there itself). */
  const caretOf = (lease: EditorLease, index: number | undefined): number | undefined => index ?? (editor.lease() === lease ? editor.element.value.length : undefined);

  return {
    part: NOTE_BODY,
    tap({ wx, wy, found, hit }) {
      // the stack's exact hit when the pointer is known; the writing's topmost drawn note when it is gone (a touch lifted)
      const e = found ? (hit !== undefined && paper.isNote(hit) ? hit : undefined) : writing()?.noteAt(wx, wy);
      if (e === undefined || world.has(e, Grab)) return undefined;
      const lease = take(e);
      if (lease === undefined) return undefined;
      const caret = caretOf(lease, writing()?.caretIndexAt(e, wx, wy));
      return caret === undefined ? { lease } : { lease, caret };
    },
    focus(e, index) {
      const lease = take(e);
      if (lease === undefined) return false;
      editor.lend(lease, caretOf(lease, index));
      return true;
    },
    editing: () => (current !== undefined && editor.lease() === current.lease ? current.entity : undefined),
  };
}
