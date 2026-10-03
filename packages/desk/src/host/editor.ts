// THE ONE FOCUSED EDITOR (design-015 §6.1, §2.2; design-016 §5 · K-L2, K8a) — the DESK's, not a kind's: the platform's own
// `<textarea>`, in SCREEN space over the part being written, invisible: transparent text, transparent caret, no pointer events, a
// transparent `::selection`. It takes what the platform does best — the keys, key repeat, the IME, dictation, the caret's index
// and the selection — and the desk draws the rest from the world. One element, one plain transform (translate · rotate ·
// translate — never a `scale(`, never a matrix): each frame it is re-placed where the lease says, its box and font the part's.
//
// Until K8a this was the NOTE's DOM half (objects/paper/host/editor.ts, made by the note's `host.editor`), and a desk with no note
// kind had no editor — the calendar borrowed the note's, and no plugin kind could take text. Now the desk makes it at the mount and
// every kind LEASES it the same way (kit/editor.ts): a kind declares its TEXT PARTS (`defineObject({ host: { text } })`) — a part
// the desk routes a TAP to (the note's body) or one its own DOM half leases at event time (the calendar's day line).
//
// The TAP (DOM-at-event-time, design-007 §2 — the focus that makes typing write must be taken in the event; a phone's keyboard opens
// only so): a press and release within the drag slop, the primary button, no modifier, on the container. The object under it is
// the interaction stack's own exact hit for that pointer (`tapHit` — none while an object is in hand); each declared part with a
// `tap` is asked in registration order and the first lease is lent, the caret where the part put it. The editor carries
// design-007's claim marker, so every keymap entry cedes while it has focus. A lease ends on a blur (a press anywhere else moves
// the browser's focus), on another lease, on `release`, and when its `live()` says its object is gone (a delete, a nav cut).

import { Camera, type Entity, GestureSettings, Grab, type World } from "@ice/core";
import { tapHit } from "../compose/tap";
import type { DeskEditor, EditorLease, TextPart } from "../kit/editor";
import { PEN_FACES } from "../kit/text";

/** design-007's claim marker (`@ice/dom` KEYBOARD_CLAIM_ATTR — the desk may not import dom): the keymap cedes to a focused claim. */
export const KEYBOARD_CLAIM_ATTR = "data-canvas-keyboard";
/** The editor's own marker — the one element the desk puts in screen space for text. */
export const EDITOR_ATTR = "data-desk-editor";
/** The face the editor lays text in unless a part says (the desk's hand — kit/text.ts `PEN_FACES`). */
const DEFAULT_FONT = PEN_FACES.caveat ?? { family: "Caveat", weight: 500 };

export interface DeskEditorOptions {
  /** The host's container (screen space): the editor goes in it, the taps are read on it. */
  readonly container: HTMLElement;
  readonly world: World;
  /** The text parts the registered objects declared, in registration order (asked at each tap — the layer fills them after the drivers). */
  readonly parts: () => readonly TextPart[];
  /** A session ends after this long without input, ms (1000). */
  readonly idleMs?: number;
  /** Ask the desk for a frame. */
  readonly wake: () => void;
}

export function createDeskEditor(opts: DeskEditorOptions): DeskEditor {
  const { container, world } = opts;
  const doc = container.ownerDocument;
  const idleMs = opts.idleMs ?? 1000;
  const el = doc.createElement("textarea");
  el.hidden = true;
  el.setAttribute(EDITOR_ATTR, "");
  el.setAttribute(KEYBOARD_CLAIM_ATTR, "");
  el.setAttribute("autocapitalize", "off");
  el.setAttribute("autocorrect", "off");
  el.setAttribute("aria-label", "write");
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

  /** The lease holding the editor, or undefined. */
  let lent: EditorLease | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let down: { id: number; type: string; x: number; y: number } | null = null;
  let lastTransform = "";
  let lastBox = "";
  let placed: { cx: number; cy: number; w: number; h: number; angle: number } | null = null;

  const arm = (): void => {
    if (idle !== undefined) clearTimeout(idle);
    idle = setTimeout(() => {
      idle = undefined;
      if (composing) { arm(); return; }   // an IME candidate being chosen is not a pause
      lent?.idle();
      opts.wake();
    }, idleMs);
  };

  /** The textarea where the lease says: one plain transform, its box and its text's size and flow only when they change. */
  const place = (): void => {
    const p = lent?.place();
    if (p === undefined || p === null) return;
    const angle = p.angle;
    placed = { cx: p.x + p.w / 2, cy: p.y + p.h / 2, w: p.w, h: p.h, angle: angle ?? 0 };
    const transform = angle === undefined ? `translate(${p.x}px, ${p.y}px)` : `translate(${p.x + p.w / 2}px, ${p.y + p.h / 2}px) rotate(${angle}rad) translate(${-p.w / 2}px, ${-p.h / 2}px)`;
    if (transform !== lastTransform) { st.transform = transform; lastTransform = transform; }
    const font = p.font ?? DEFAULT_FONT;
    const box = `${p.w}|${p.h}|${p.pad ?? 0}|${p.fontPx}|${p.lineHeight ?? p.h}|${font.family}|${font.weight}|${p.wrap === true}`;
    if (box !== lastBox) {
      lastBox = box;
      st.width = `${p.w}px`;
      st.height = `${p.h}px`;
      st.padding = p.pad === undefined ? "0" : `${p.pad}px`;
      st.font = `${font.weight} ${p.fontPx}px "${font.family}"`;
      st.lineHeight = `${p.lineHeight ?? p.h}px`;
      st.whiteSpace = p.wrap === true ? "pre-wrap" : "pre";
    }
  };

  /**
   * The lease is over: its holder told, the textarea hidden and blurred (a blur that ended it has already moved the focus) — unless
   * another lease takes the editor at once (`handover`): then the focus stays where it is, so a phone's keyboard never drops between
   * two parts (a tap on the next note).
   */
  const end = (handover = false): void => {
    const l = lent;
    if (l === undefined) return;
    lent = undefined;
    if (idle !== undefined) { clearTimeout(idle); idle = undefined; }
    composing = false;
    placed = null;
    lastTransform = "";
    lastBox = "";
    if (!handover) {
      el.hidden = true;
      el.setAttribute("aria-label", "write");
      if (doc.activeElement === el) el.blur();
    }
    l.ended();
    opts.wake();
  };

  const lend = (lease: EditorLease, caret?: number): void => {
    if (lent === lease) {
      if (doc.activeElement !== el) el.focus({ preventScroll: true });
      if (caret !== undefined) { const i = Math.min(Math.max(caret, 0), el.value.length); el.setSelectionRange(i, i); lease.caret(i); opts.wake(); }
      return;
    }
    end(true);
    lent = lease;
    lastTransform = "";
    lastBox = "";
    el.setAttribute("aria-label", lease.label ?? "write");
    el.value = lease.value() ?? "";
    el.hidden = false;
    place();
    el.focus({ preventScroll: true });
    const i = Math.min(Math.max(caret ?? el.value.length, 0), el.value.length);
    el.setSelectionRange(i, i);
    lease.caret(i);
    opts.wake();
  };

  // ---- the platform's events, the lease's while it holds the editor
  const onInput = (): void => {
    const l = lent;
    if (l === undefined) return;
    l.input(el.value);
    arm();
    opts.wake();
  };
  const onKeyDown = (ev: KeyboardEvent): void => {
    const l = lent;
    if (l === undefined || ev.isComposing) return;
    if (l.keydown(ev)) { ev.preventDefault(); opts.wake(); }   // the keymap's gate 1 stands down; the key was the lease's
    // a Tab the lease declines goes NOWHERE (K9 S4): the platform would move focus down the page's order — to the selection menu's first
    // button — which ends the lease, and the next letters would be the desk's shortcuts; while a lease holds the editor, Tab is typing's
    else if (ev.key === "Tab") ev.preventDefault();
  };
  const onBlur = (): void => { end(); };   // a press anywhere else: the lease ends (its holder keeps what it wrote)
  const onCompositionStart = (): void => { composing = true; };
  const onCompositionEnd = (): void => { composing = false; arm(); };
  const onSelection = (): void => {
    if (doc.activeElement !== el || lent === undefined) return;
    lent.caret(el.selectionStart);
    opts.wake();
  };
  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("blur", onBlur);
  el.addEventListener("compositionstart", onCompositionStart);
  el.addEventListener("compositionend", onCompositionEnd);
  doc.addEventListener("selectionchange", onSelection);

  // ---- the tap (DOM-at-event-time): a press and release within the slop, the primary button, no modifier — routed to the parts
  const onDown = (ev: PointerEvent): void => {
    down = ev.isPrimary && ev.button === 0 ? { id: ev.pointerId, type: ev.pointerType, x: ev.clientX, y: ev.clientY } : null;
  };
  const onClick = (ev: MouseEvent): void => {
    const d = down;
    down = null;
    if (d === null || ev.button !== 0 || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const slop = world.getResource(GestureSettings)?.dragSlopPx ?? 10;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > slop) return;
    const cam = world.getResource(Camera);
    if (cam === undefined) return;
    const r = container.getBoundingClientRect();
    const wx = cam.x + (ev.clientX - r.left) / cam.zoom;
    const wy = cam.y + (ev.clientY - r.top) / cam.zoom;
    const t = tapHit(world, d.type === "touch" ? `touch:${d.id}` : "mouse");
    // a carried object takes no text (the tap ends a carry); a part asked with the pointer gone looks for itself
    const hit: Entity | undefined = t.hit !== undefined && world.has(t.hit, Grab) ? undefined : t.hit;
    if (t.found && t.hit !== undefined && hit === undefined) return;
    for (const part of opts.parts()) {
      const taken = part.tap?.({ wx, wy, found: t.found, hit });
      if (taken !== undefined) { lend(taken.lease, taken.caret); return; }
    }
  };
  container.addEventListener("pointerdown", onDown, { capture: true });
  container.addEventListener("click", onClick, { capture: true });

  return {
    element: el,
    lend,
    release(lease) { if (lent !== undefined && (lease === undefined || lease === lent)) end(); },
    lease: () => lent,
    blur: () => { end(); },
    follow() {
      const l = lent;
      if (l === undefined) return;
      // a delete or a nav cut ends the lease — outside the frame: reflectors never write the world
      if (l.live?.() === false) { queueMicrotask(() => { if (lent === l) end(); }); return; }
      // a value the world moved between sessions (a peer, an undo) reaches the platform's field; then the textarea follows the part
      if (!composing) {
        const v = l.value();
        if (v !== null && v !== el.value) { const i = Math.min(el.selectionStart, v.length); el.value = v; el.setSelectionRange(i, i); l.caret(i); }
      }
      place();
    },
    placement: () => placed,
    dispose() {
      // a lease still held ends with the editor (petition I25 — a desk unmounted mid-typing, a remount among them): its `ended` is told,
      // so a typing session commits and lifts its claim, never left open with its idle commit cleared below
      end();
      if (idle !== undefined) clearTimeout(idle);
      lent = undefined;
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
      doc.removeEventListener("selectionchange", onSelection);
      container.removeEventListener("pointerdown", onDown, { capture: true });
      container.removeEventListener("click", onClick, { capture: true });
      el.remove();
      sheet.remove();
    },
  };
}
