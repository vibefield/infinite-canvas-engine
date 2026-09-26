// The ONE focused EDITOR (design-015 §6.1, §2.2; STICKY.md §4) — the platform's own `<textarea>`, in
// SCREEN space over the note being written, invisible: transparent text, transparent caret, no pointer
// events, a transparent `::selection`. It takes what the platform does best — the keys, key repeat,
// the IME, dictation, the caret's index and the selection — and the desk draws the rest: the writing
// from the raster, the caret from the layout, the ring. One element, one plain transform (translate ·
// rotate · translate — never a `scale(`, never a matrix): each frame the camera moves it is re-placed
// over the note's DRAWN geometry, its box the sheet's, its font the hand's × the zoom.
//
// Acquisition is DOM-at-event-time (design-007 §2 — the focus driver's own principle, and the only way
// a phone's keyboard opens): a TAP on a note — a press and release within the drag slop, no modifier,
// the note not carried — focuses it with the caret at the tap (the layout's nearest position). The note
// under the tap is the interaction stack's own exact hit (the pointer's `TouchesExact`), the writing's
// last-drawn notes when the pointer is already gone. The editor carries design-007's claim marker, so
// every keymap entry cedes while it has focus and Escape releases it. It ends on Escape, on blur (a
// press anywhere else moves the browser's focus), on a delete (the note died) and on a nav cut (the
// note left the frame).
//
// The world half is `objects/typing.ts`: `begin` on focus (the `Editing` claim), `input` on every
// `input` event (the live write, the seeds carried), `commit` after 1 s without input (the idle end of
// a SESSION — the focus stays), `end` on blur. A write the world makes between sessions — a peer's
// edit, an undo — reaches the textarea on the next frame. The pen's wipe and the caret are the
// writing's flux, stamped on ONE clock, `performance.now()` (the rAF clock lags wall time headless).

import { Active, Camera, type Entity, GestureSettings, Grab, LocalPointer, Pointer, TouchesExact, type World, defineQuery } from "@ice/core";
import type { NoteTyping } from "../objects/typing";
import type { PaperGeometry } from "../paper/paper";
import type { HandLaw } from "../paper/text";
import type { Writing } from "../paper/writing";

/** design-007's claim marker (`@ice/dom` KEYBOARD_CLAIM_ATTR — the desk may not import dom): the keymap cedes to a focused claim. */
export const KEYBOARD_CLAIM_ATTR = "data-canvas-keyboard";
/** The editor's own marker — the one element the desk puts in screen space for text. */
export const EDITOR_ATTR = "data-desk-editor";

export interface NoteEditorOptions {
  /** The host's container (screen space): the editor goes in it, the taps are read on it. */
  readonly container: HTMLElement;
  readonly world: World;
  readonly typing: NoteTyping;
  /** The paper kind's writing on this desk (its caret, its wipe, its layouts). */
  readonly writing: () => Writing | undefined;
  /** The builder's drawn geometry for an entity. */
  readonly geometryOf: (e: Entity) => unknown;
  /** Is this entity a note (an object of the paper kind)? */
  readonly isNote: (e: Entity) => boolean;
  /** The hand's face for the platform's own layout of the text (arrow keys by line): family and weight. */
  readonly font: { readonly family: string; readonly weight: number };
  readonly hand: Pick<HandLaw, "size" | "lineHeight" | "pad">;
  /** A session ends after this long without input, ms (1000). */
  readonly idleMs?: number;
  /** Ask the desk for a frame. */
  readonly wake: () => void;
  /** The clock the writing's flux runs on (`performance.now`). */
  readonly now?: () => number;
}

export interface NoteEditor {
  readonly element: HTMLTextAreaElement;
  /** Put the editor on note `e`, the caret before glyph `index` (the end by default). False for a still or a non-note. */
  focus(e: Entity, index?: number): boolean;
  /** End the writing: the session committed, the claim lifted, the editor hidden. */
  blur(): void;
  editing(): Entity | undefined;
  /** After each draw: follow the camera; notice a delete, a nav cut, a write from elsewhere. */
  follow(): void;
  /** Where the editor's box stands on screen (container px): its centre, size and turn — null while hidden. */
  placement(): { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number; readonly angle: number } | null;
  dispose(): void;
}

const pointersQ = defineQuery([Pointer, LocalPointer]);

export function createNoteEditor(opts: NoteEditorOptions): NoteEditor {
  const { container, world, typing } = opts;
  const doc = container.ownerDocument;
  const clock = opts.now ?? (() => performance.now());
  const idleMs = opts.idleMs ?? 1000;
  const el = doc.createElement("textarea");
  el.hidden = true;
  el.setAttribute(EDITOR_ATTR, "");
  el.setAttribute(KEYBOARD_CLAIM_ATTR, "");
  el.setAttribute("autocapitalize", "off");
  el.setAttribute("autocorrect", "off");
  el.setAttribute("aria-label", "write on the note");
  el.spellcheck = false;
  el.wrap = "soft";
  const st = el.style;
  st.position = "absolute";
  st.left = "0";
  st.top = "0";
  st.transformOrigin = "0 0";
  st.margin = "0";
  st.border = "0";
  st.outline = "0";
  st.resize = "none";
  st.overflow = "hidden";
  st.background = "transparent";
  st.color = "transparent";
  st.caretColor = "transparent";
  st.pointerEvents = "none";
  st.boxSizing = "border-box";
  st.whiteSpace = "pre-wrap";
  st.overflowWrap = "anywhere";
  st.zIndex = "2";
  const sheet = doc.createElement("style");
  sheet.textContent = `textarea[${EDITOR_ATTR}]::selection { background: transparent; } textarea[${EDITOR_ATTR}][hidden] { display: none; }`;
  container.appendChild(sheet);
  container.appendChild(el);

  let current: Entity | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let down: { id: number; type: string; x: number; y: number } | null = null;
  let lastTransform = "";
  let lastScale = -1;
  let placed: { cx: number; cy: number; w: number; h: number; angle: number } | null = null;

  const writing = (): Writing | undefined => opts.writing();
  const caretToSelection = (): void => { if (current !== undefined) writing()?.caret(current, el.selectionStart, clock()); };
  const arm = (): void => {
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout(() => {
      idle = undefined;
      if (composing) { arm(); return; }   // an IME candidate being chosen is not a pause
      if (typing.commit()) opts.wake();
    }, idleMs);
  };

  const place = (): void => {
    const e = current;
    const G = e === undefined ? undefined : (opts.geometryOf(e) as PaperGeometry | undefined);
    const cam = world.getResource(Camera);
    if (G === undefined || cam === undefined) return;
    const z = cam.zoom;
    const cx = (G.centre[0] - cam.x) * z;
    const cy = (G.centre[1] - cam.y) * z;
    const w = 2 * G.half[0] * z;
    const h = 2 * G.half[1] * z;
    placed = { cx, cy, w, h, angle: G.angle };
    const transform = `translate(${cx}px, ${cy}px) rotate(${G.angle}rad) translate(${-w / 2}px, ${-h / 2}px)`;
    if (transform !== lastTransform) { st.transform = transform; lastTransform = transform; }
    const s = z * G.scale;
    if (s !== lastScale) {
      lastScale = s;
      st.width = `${w}px`;
      st.height = `${h}px`;
      st.padding = `${opts.hand.pad * s}px`;
      st.font = `${opts.font.weight} ${opts.hand.size * s}px "${opts.font.family}"`;
      st.lineHeight = `${opts.hand.lineHeight * opts.hand.size * s}px`;
    }
  };

  const end = (): void => {
    if (current === undefined) return;
    current = undefined;
    if (idle !== undefined) { clearTimeout(idle); idle = undefined; }
    composing = false;
    typing.end();
    writing()?.caret(undefined);
    placed = null;
    el.hidden = true;
    if (doc.activeElement === el) el.blur();
    opts.wake();
  };

  const focus = (e: Entity, index?: number): boolean => {
    if (!world.isAlive(e) || !opts.isNote(e) || writing()?.isPinned(e) === true) return false;
    if (!typing.begin(e)) return false;
    if (current !== e) {
      current = e;
      el.value = typing.ink(e)?.text ?? "";
      lastTransform = "";
      lastScale = -1;
    }
    el.hidden = false;
    place();
    el.focus({ preventScroll: true });
    const i = Math.min(Math.max(index ?? el.value.length, 0), el.value.length);
    el.setSelectionRange(i, i);
    caretToSelection();
    opts.wake();
    return true;
  };

  // ---- the platform's events
  const onInput = (): void => {
    const e = current;
    if (e === undefined) return;
    const r = typing.input(el.value);
    if (r !== null) {
      const ch = el.value[r.from];
      // a typed glyph is WRITTEN (the pen's wipe); a paste, a space or a newline arrives whole
      writing()?.wrote(e, r.to - r.from === 1 && ch !== undefined && ch !== " " && ch !== "\n" ? r.from : undefined, clock());
      arm();
    }
    caretToSelection();
    opts.wake();
  };
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape" || ev.isComposing) return;
    ev.preventDefault();   // the keymap's gate 1 stands down; the release is ours
    end();
  };
  const onBlur = (): void => end();
  const onCompositionStart = (): void => { composing = true; };
  const onCompositionEnd = (): void => { composing = false; arm(); };
  const onSelection = (): void => { if (current !== undefined && doc.activeElement === el) { caretToSelection(); opts.wake(); } };
  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("blur", onBlur);
  el.addEventListener("compositionstart", onCompositionStart);
  el.addEventListener("compositionend", onCompositionEnd);
  doc.addEventListener("selectionchange", onSelection);

  // ---- the tap (DOM-at-event-time): a press and release within the slop on a note, no modifier, the note not carried
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const cam = world.getResource(Camera);
    if (cam === undefined) return null;
    const r = container.getBoundingClientRect();
    return { x: cam.x + (clientX - r.left) / cam.zoom, y: cam.y + (clientY - r.top) / cam.zoom };
  };
  /** The note the tap landed on: the stack's exact hit for this pointer; the writing's topmost drawn note when the pointer is gone. */
  const noteUnder = (type: string, id: number, w: { x: number; y: number }): Entity | undefined => {
    const pid = type === "touch" ? `touch:${id}` : "mouse";
    let found = false;
    let hit: Entity | undefined;
    world.query(pointersQ).each((b) => {
      for (const r of b) {
        const p = b.entity(r);
        if (world.read(p, Pointer).id !== pid) continue;
        found = true;
        hit = world.getRelation(p, TouchesExact);
      }
    });
    if (found) return hit !== undefined && opts.isNote(hit) ? hit : undefined;
    return writing()?.noteAt(w.x, w.y);
  };
  const onDown = (ev: PointerEvent): void => {
    down = ev.isPrimary && ev.button === 0 ? { id: ev.pointerId, type: ev.pointerType, x: ev.clientX, y: ev.clientY } : null;
  };
  const onClick = (ev: MouseEvent): void => {
    const d = down;
    down = null;
    if (d === null || ev.button !== 0 || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const slop = world.getResource(GestureSettings)?.dragSlopPx ?? 10;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > slop) return;
    const w = toWorld(ev.clientX, ev.clientY);
    if (w === null) return;
    const e = noteUnder(d.type, d.id, w);
    if (e === undefined || world.has(e, Grab)) return;
    focus(e, writing()?.caretIndexAt(e, w.x, w.y));
  };
  container.addEventListener("pointerdown", onDown, { capture: true });
  container.addEventListener("click", onClick, { capture: true });

  return {
    element: el,
    focus,
    blur: end,
    editing: () => current,
    follow() {
      const e = current;
      if (e === undefined) return;
      // a delete or a nav cut ends the writing — outside the frame: reflectors never write the world
      if (!world.isAlive(e) || !world.hasTag(e, Active)) { queueMicrotask(end); return; }
      // a write the world made between sessions (a peer's edit, an undo) reaches the platform's field
      if (!typing.open() && !composing) {
        const t = typing.ink(e)?.text ?? "";
        if (t !== el.value) {
          const i = Math.min(el.selectionStart, t.length);
          el.value = t;
          el.setSelectionRange(i, i);
          caretToSelection();
        }
      }
      place();
    },
    placement: () => placed,
    dispose() {
      if (idle !== undefined) clearTimeout(idle);
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
      doc.removeEventListener("selectionchange", onSelection);
      container.removeEventListener("pointerdown", onDown, { capture: true });
      container.removeEventListener("click", onClick, { capture: true });
      current = undefined;
      el.remove();
      sheet.remove();
    },
  };
}
