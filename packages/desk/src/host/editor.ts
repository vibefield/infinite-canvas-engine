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
//
// THE COMPOSITION (design-019 §5, M24 LT2): a lease that declares `compose` is told the IME's preedit as it runs — at its start, and
// after each update the platform applied (the caret within it is known only then: `compositionupdate` comes before the field moves)
// — and its `commit` at the end, instead of the field's values meanwhile: a remote page's IME is driven so (a held live face).
//
// THE RANGE (petition I60 — "write first, then a drag across writing selects"): a lease that says where its writing lies
// (`indexAt`) has the editor CLAIM a primary press on it — a mouse's or a pen's, under the select tool, no ⌘/ctrl/⌥, never on DOM
// chrome, never on another object the stack hit over the part: its default is prevented here, in the capture phase, before the
// pointer adapter hears it, and the adapter's `defaultPrevented` gate lands the fact `surfaceHandled` — so no carry, marquee or pan
// starts from it, and no focus fixup takes the focus off the field. A release within the drag slop is still a TAP (the click goes
// to the parts and the caret goes where the tap put it, as ever); past the slop the press SELECTS: the textarea's own range, from
// the press's index to the moving pointer's (held to the part's box, so a drag past its edge selects to it), with its direction, the
// pointer captured. A second click takes the word, a third the laid line (`rangeAt`) — counted here, by the presses' own times, the
// platform's `detail` being 0 on a pointerdown — and a drag after one extends by its unit; Shift extends from the selection's
// anchor. The selection is never stored: it is the field's, told to the lease with the caret (`selection`). Touch is unchanged: a
// tap only.
//
// THE CLIPBOARD (petition I60): a lease that LIFTS takes the field's copy and cut — `text/plain` always, its `text/html` and its
// piece (`PIECE_FLAVOUR`) when it gives them, the platform's own copy prevented — and a cut deletes through `write`, the path an
// input takes; a lease that LAYS is handed a paste — the clipboard's piece when it holds one, else its plain words — and one that
// takes it prevents the platform's paste. Without them the platform's own, untouched. WebKit needs no `beforecopy`/`beforecut`/
// `beforepaste` gate here: the field is a focused textarea holding a real range, so the platform enables its own commands (the
// prototype's field was a focused div with no platform selection, and needed it).
//
// THE WORDS' MENU (petition I60 — "the selection bar comes to the words"): while a press the editor claimed is down (`pressing`), the
// range it makes is not settled, and the desk's anchor leaves the words out until the release; a lease that says where its words lie
// (`rangeBox`) has the desk asked for a frame at the press and at the release, so the menu over them steps away and comes back.
//
// THE HOST'S ITEMS (petition I60 — a words bar's Cut, Copy, Paste and Select all): `command` does on the lent field what the keys do.
// A copy or a cut runs the platform's own command first, so its event reaches the clipboard handler above and the bar writes the very
// flavours the keys write; where the platform refuses, the async clipboard takes the words and their HTML, and a cut deletes only once
// they are there. Every copy and cut is KEPT (the last lifted piece): a bar's paste lays it again in place of the clipboard's plain
// words when they are its words — the piece's marks come back, which the async clipboard cannot carry — and lays it alone where the
// platform lets the page read no clipboard. A RIGHT press on the lent part's writing has its default prevented and nothing else, so
// the focus — and the range — survive it for a host's right-click rows (the stack makes no gesture of a secondary press: I28).

import { ActiveTool, Camera, type Entity, GestureSettings, Grab, type World } from "@ice/core";
import { clientToScreen } from "@ice/kernel";
import { tapHit } from "../compose/tap";
import type { DeskEditor, EditorCommand, EditorCommandOptions, EditorLease, EditorLift, EditorPaste, TextPart, TextRange, TextUnit } from "../kit/editor";
import { PEN_FACES } from "../kit/text";

/** design-007's claim marker (`@ice/dom` KEYBOARD_CLAIM_ATTR — the desk may not import dom): the keymap cedes to a focused claim. */
export const KEYBOARD_CLAIM_ATTR = "data-canvas-keyboard";
/** The editor's own marker — the one element the desk puts in screen space for text. */
export const EDITOR_ATTR = "data-desk-editor";
/** The clipboard's PRIVATE flavour (petition I60): a lease's own piece — its words and marks, as its kind writes them — rides under it. */
export const PIECE_FLAVOUR = "application/x-ice-ink+json";
/** The face the editor lays text in unless a part says (the desk's hand — kit/text.ts `PEN_FACES`). */
const DEFAULT_FONT = PEN_FACES.caveat ?? { family: "Caveat", weight: 500 };
/**
 * DOM CHROME under a press (`@ice/dom`'s widget opt-out set, design-002 §8 — the desk may not import dom): a press on a native control
 * or a `[data-canvas-interactive]` island is the chrome's, never a claim on the writing under it.
 */
const CHROME = 'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], audio[controls], video[controls], [data-canvas-interactive]';

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

/** A press the editor CLAIMED (petition I60): the lease it was claimed for, where and when it began, what it selects. */
interface Press {
  readonly lease: EditorLease;
  readonly id: number;
  /** Where it began (client px) and the text index under it. */
  readonly x: number;
  readonly y: number;
  readonly index: number;
  /** The range's fixed end while it drags. */
  readonly anchor: number;
  /** A second or a third click: the drag extends by its unit from the range it took. */
  readonly unit: TextUnit | undefined;
  readonly origin: TextRange | undefined;
  /** It selects — Shift, a second or third click, or a drag past the slop: its release is no tap. */
  selecting: boolean;
  /** The pointer is captured (once it selects by dragging). */
  captured: boolean;
  /** Its button is still down (petition I60): the range it makes is not settled, so the words' menu waits for its release. */
  down: boolean;
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
  /** The running composition (M24 LT2): where in the field it began, and its text as the last update said it. */
  let compStart = 0;
  let compText = "";
  let down: { id: number; type: string; x: number; y: number } | null = null;
  /** The press the editor claimed (petition I60), until its click — null when none. */
  let press: Press | null = null;
  /** The last primary press of a mouse or a pen: where and when, and its click count (petition I60). */
  let last: { at: number; x: number; y: number; count: number } | undefined;
  /** A right press on the lent part's writing had its default prevented (petition I60): its compatibility mousedown's is too. */
  let secondary = false;
  /** The words a copy or a cut last LIFTED — the keys' or a command's (petition I60): what a bar's paste lays where the clipboard cannot say more. */
  let lastLifted: EditorPaste | undefined;
  /** A copy or a cut reached this editor's own handler with a range (a command knows its platform command was heard). */
  let heard = false;
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

  /** The lease told where the field's selection stands: its caret (the selection's start, as ever) and its range (petition I60). */
  const tell = (l: EditorLease): void => {
    l.caret(el.selectionStart);
    l.selection?.(el.selectionStart, el.selectionEnd);
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
    press = null;
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
      if (caret !== undefined) { const i = Math.min(Math.max(caret, 0), el.value.length); el.setSelectionRange(i, i); tell(lease); opts.wake(); }
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
    tell(lease);
    opts.wake();
  };

  // ---- the platform's events, the lease's while it holds the editor
  const onInput = (): void => {
    const l = lent;
    if (l === undefined) return;
    // a composition's update, applied (M24 LT2): a lease that takes the composition is told its text and the caret within it — the
    // field's selection is the preedit's only now (`compositionupdate` comes before the platform moves it) — never the field's value
    if (composing && l.compose !== undefined) {
      l.compose(compText, Math.min(Math.max(el.selectionEnd - compStart, 0), compText.length));
      arm();
      opts.wake();
      return;
    }
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
  const onCompositionStart = (): void => {
    composing = true;
    compStart = el.selectionStart;   // the composition replaces the selection: it begins where the selection did
    compText = "";
    lent?.compose?.("", 0);
  };
  const onCompositionUpdate = (ev: CompositionEvent): void => { compText = ev.data ?? ""; };
  const onCompositionEnd = (ev: CompositionEvent): void => {
    composing = false;
    lent?.commit?.(ev.data ?? "");
    arm();
    opts.wake();
  };
  const onSelection = (): void => {
    if (doc.activeElement !== el || lent === undefined) return;
    tell(lent);
    opts.wake();
  };

  // ---- writing the field as an input would (petition I60): a cut's delete, a lease's paste
  /** The platform's own editing command on the focused field — `delete` for no words, `insertText` for words; false where it refuses. */
  const platformEdit = (text: string): boolean => {
    if (typeof doc.execCommand !== "function") return false;
    try {
      return text === "" ? doc.execCommand("delete", false) : doc.execCommand("insertText", false, text);
    } catch {
      return false;
    }
  };
  /**
   * `text` over [from, to) of the field, AS AN INPUT WOULD: the platform's own editing first, so the field's history keeps the step
   * (⌘Z in it undoes the step as it undoes a typed one) and its `input` reaches the lease as any edit's does; where the platform
   * refuses (no such command, one already running, the field not focused) or writes other than asked, the value is set and the input
   * path run by hand. The caret after the text, told.
   */
  const write = (text: string, from: number, to: number): void => {
    const l = lent;
    if (l === undefined || composing) return;
    const v = el.value;
    const a = Math.min(Math.max(Math.min(from, to), 0), v.length);
    const b = Math.min(Math.max(Math.max(from, to), 0), v.length);
    if (text === "" && a === b) return;   // nothing to write
    const next = v.slice(0, a) + text + v.slice(b);
    el.setSelectionRange(a, b);
    if (!(doc.activeElement === el && platformEdit(text) && el.value === next)) {
      if (el.value !== next) el.value = next;
      el.setSelectionRange(a + text.length, a + text.length);
      onInput();
    }
    if (lent === l) tell(l);
  };

  // ---- the clipboard (petition I60): the lease's lift on a copy and a cut, its lay on a paste — without them, the platform's own
  /** A clipboard's flavour, or "" (absent, or a platform that refuses to read it). */
  const flavour = (data: DataTransfer, type: string): string => {
    try { return data.getData(type); } catch { return ""; }
  };
  /**
   * A copy or a cut the lease lifts: its flavours written, the platform's own prevented — the range it lifted, or undefined (the
   * platform's). Either way the words are KEPT (`lastLifted`: the lease's, or the field's the platform's own copy takes).
   */
  const lift = (ev: ClipboardEvent): TextRange | undefined => {
    const l = lent;
    const data = ev.clipboardData;
    if (l === undefined || data === null || composing) return undefined;
    const from = el.selectionStart;
    const to = el.selectionEnd;
    if (from === to) return undefined;   // a caret: the platform's own (it copies nothing)
    heard = true;
    const words = l.lift?.(from, to);
    lastLifted = words === undefined ? { text: el.value.slice(from, to) } : { text: words.text, ...(words.piece !== undefined ? { piece: words.piece } : {}) };
    if (words === undefined) return undefined;
    data.setData("text/plain", words.text);
    if (words.html !== undefined) data.setData("text/html", words.html);
    if (words.piece !== undefined) {
      try { data.setData(PIECE_FLAVOUR, words.piece); } catch { /* a platform that refuses a private flavour still copies the words */ }
    }
    ev.preventDefault();
    return { from, to };
  };
  const onCopy = (ev: ClipboardEvent): void => { lift(ev); };
  // the cut: the copy, then the delete through the path an input takes — ONE input, which the lease's typing records as one step
  const onCut = (ev: ClipboardEvent): void => { const r = lift(ev); if (r !== undefined) write("", r.from, r.to); };
  const onPaste = (ev: ClipboardEvent): void => {
    const l = lent;
    const data = ev.clipboardData;
    if (l?.lay === undefined || data === null || composing) return;
    const piece = flavour(data, PIECE_FLAVOUR);
    const text = flavour(data, "text/plain");
    if (piece === "" && text === "") return;   // nothing to lay (a picture alone): the platform's and the page's
    if (!l.lay(piece !== "" ? { text, piece } : { text }, el.selectionStart, el.selectionEnd)) return;
    ev.preventDefault();
    opts.wake();
  };

  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("blur", onBlur);
  el.addEventListener("compositionstart", onCompositionStart);
  el.addEventListener("compositionupdate", onCompositionUpdate);
  el.addEventListener("compositionend", onCompositionEnd);
  el.addEventListener("copy", onCopy);
  el.addEventListener("cut", onCut);
  el.addEventListener("paste", onPaste);
  doc.addEventListener("selectionchange", onSelection);

  // ---- the range (petition I60): a press on the lent part's writing claimed, its drag and its clicks turned into the field's range
  /** A text index held to the field. */
  const clampIndex = (i: number): number => Math.min(Math.max(i, 0), el.value.length);
  /** The range [a…f] on the field — anchor `a`, focus `f`, its direction the focus's side — told when it moved. */
  const select = (l: EditorLease, a: number, f: number): void => {
    const anchor = clampIndex(a);
    const focus = clampIndex(f);
    const from = Math.min(anchor, focus);
    const to = Math.max(anchor, focus);
    const direction = focus < anchor ? "backward" : "forward";
    if (el.selectionStart === from && el.selectionEnd === to && el.selectionDirection === direction) return;
    el.setSelectionRange(from, to, direction);
    tell(l);
    opts.wake();
  };
  /** The selection's fixed end: where a Shift+press extends from. */
  const anchorOf = (): number => (el.selectionDirection === "backward" ? el.selectionEnd : el.selectionStart);
  /** The unit around `index` as the lease answers it, held to the field — a caret there when it answers none. */
  const unitAt = (l: EditorLease, index: number, unit: TextUnit): TextRange => {
    const r = l.rangeAt?.(index, unit);
    if (r === undefined) return { from: index, to: index };
    return { from: clampIndex(Math.min(r.from, r.to)), to: clampIndex(Math.max(r.from, r.to)) };
  };
  /**
   * A client point in the world: the container's layout space under any transform (petition I39), then the camera — `held`: first
   * held inside the editor's box, 1 px in from its edges, so a drag past the part selects to its edge.
   */
  const worldAt = (clientX: number, clientY: number, held = false): { wx: number; wy: number } | undefined => {
    const cam = world.getResource(Camera);
    if (cam === undefined) return undefined;
    const s = clientToScreen(clientX, clientY, container.getBoundingClientRect(), container);
    let x = s.x;
    let y = s.y;
    const b = placed;
    if (held && b !== null) {
      const c = Math.cos(b.angle);
      const n = Math.sin(b.angle);
      const hx = Math.max(b.w / 2 - 1, 0);
      const hy = Math.max(b.h / 2 - 1, 0);
      const lx = Math.min(Math.max(c * (x - b.cx) + n * (y - b.cy), -hx), hx);
      const ly = Math.min(Math.max(-n * (x - b.cx) + c * (y - b.cy), -hy), hy);
      x = b.cx + c * lx - n * ly;
      y = b.cy + n * lx + c * ly;
    }
    return { wx: cam.x + x / cam.zoom, wy: cam.y + y / cam.zoom };
  };
  /** The press's target is DOM chrome inside the container (a native control, a `[data-canvas-interactive]` island). */
  const onChrome = (target: EventTarget | null): boolean => {
    const t = target as { closest?: (selector: string) => unknown } | null;
    if (typeof t?.closest !== "function") return false;
    const m = t.closest(CHROME);
    return m !== null && m !== undefined && container.contains(m as Node);
  };
  /**
   * The press's CLICK COUNT: on from the last primary press within the multi-tap window and slop, by the down events' own times — a
   * pointerdown's `detail` is 0 in the browser, so the editor counts, as the hand does (core's held.ts) — or the platform's own count
   * where its pointerdown carries one.
   */
  const countOf = (ev: PointerEvent): number => {
    const gs = world.getResource(GestureSettings);
    const windowMs = gs?.multiTapWindowMs ?? 280;
    const slopPx = gs?.multiTapSlopPx ?? 20;
    const at = Number.isFinite(ev.timeStamp) ? ev.timeStamp : 0;
    const prev = last;
    const near = prev !== undefined && at >= prev.at && at - prev.at <= windowMs && Math.hypot(ev.clientX - prev.x, ev.clientY - prev.y) <= slopPx;
    const count = Math.max(prev !== undefined && near ? prev.count + 1 : 1, Number.isFinite(ev.detail) ? ev.detail : 0);
    last = { at, x: ev.clientX, y: ev.clientY, count };
    return count;
  };
  /** Claim the press when it lands on the lent part's writing (module doc): its default prevented, the focus kept, its range begun. */
  const claim = (ev: PointerEvent, count: number): void => {
    const l = lent;
    if (l?.indexAt === undefined || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // a press under another tool is that tool's (a pan's); one on DOM chrome over the part, the chrome's
    if ((world.getResource(ActiveTool)?.id ?? "select") !== "select" || onChrome(ev.target)) return;
    const p = worldAt(ev.clientX, ev.clientY);
    if (p === undefined) return;
    // the stack's word when it knows the pointer: nothing of the desk's under it (an object in hand, the drawer out, chrome under the
    // hover) or an object carried is no claim; another object hit over the part is told, and the part answers it
    const t = tapHit(world, ev.pointerType === "pen" ? "pen" : "mouse");
    if (t.found && (t.hit === undefined || world.has(t.hit, Grab))) return;
    const at = l.indexAt(p.wx, p.wy, t.hit);
    if (at === undefined) return;
    ev.preventDefault();   // the adapter, hearing the press next, lands it `surfaceHandled`; no focus fixup moves the focus off the field
    if (doc.activeElement !== el) el.focus({ preventScroll: true });
    const index = clampIndex(at);
    const base = { lease: l, id: ev.pointerId, x: ev.clientX, y: ev.clientY, index, captured: false, down: true };
    if (ev.shiftKey) {
      const anchor = anchorOf();
      press = { ...base, anchor, unit: undefined, origin: undefined, selecting: true };
      select(l, anchor, index);
    } else if (count >= 2) {
      const unit: TextUnit = count === 2 ? "word" : "line";
      const origin = unitAt(l, index, unit);
      press = { ...base, anchor: origin.from, unit, origin, selecting: true };
      select(l, origin.from, origin.to);
    } else press = { ...base, anchor: index, unit: undefined, origin: undefined, selecting: false };
    // a lease whose words have a menu (petition I60 — `rangeBox`): the desk is asked for a frame, so the words' anchor steps away
    if (l.rangeBox !== undefined) opts.wake();
  };
  /**
   * A RIGHT press on the lent part's writing (petition I60 — a host's right-click rows act on the words selected): the claim's own
   * tests — a mouse's or a pen's, the select tool, off DOM chrome, the stack's hit the part's own or none known, `indexAt` answering —
   * and then its default prevented and NOTHING else: no range, no capture, no count. The platform's focus fixup then leaves the field
   * its focus and its range; the stack makes no gesture of a secondary press (I28), so nothing on the canvas moves for it.
   */
  const keep = (ev: PointerEvent): void => {
    const l = lent;
    if (l?.indexAt === undefined || (world.getResource(ActiveTool)?.id ?? "select") !== "select" || onChrome(ev.target)) return;
    const p = worldAt(ev.clientX, ev.clientY);
    if (p === undefined) return;
    const t = tapHit(world, ev.pointerType === "pen" ? "pen" : "mouse");
    if (t.found && (t.hit === undefined || world.has(t.hit, Grab))) return;
    if (l.indexAt(p.wx, p.wy, t.hit) === undefined) return;
    ev.preventDefault();
    secondary = true;
  };
  /** The press's button is up, or its release lost (petition I60): a lease whose words have a menu asks a frame, the anchor back. */
  const settle = (p: Press): void => {
    if (!p.down) return;
    p.down = false;
    if (p.lease.rangeBox !== undefined) opts.wake();
  };
  /** The range follows the press's pointer to (clientX, clientY) — by its unit after a second or a third click. */
  const drag = (p: Press, clientX: number, clientY: number): void => {
    const q = worldAt(clientX, clientY, true);
    const at = q === undefined ? undefined : p.lease.indexAt?.(q.wx, q.wy);
    if (at === undefined) return;   // off the part even at its edge (a rounded corner): the range stands
    const i = clampIndex(at);
    const o = p.origin;
    if (p.unit === undefined || o === undefined) { select(p.lease, p.anchor, i); return; }
    const r = unitAt(p.lease, i, p.unit);
    if (r.from < o.from) select(p.lease, o.to, r.from);
    else select(p.lease, o.from, Math.max(r.to, o.to));
  };
  const capture = (id: number): void => {
    if (typeof container.setPointerCapture !== "function") return;
    try { container.setPointerCapture(id); } catch { /* best-effort: a pointer that cannot be captured still selects inside the container */ }
  };
  const uncapture = (id: number): void => {
    if (typeof container.releasePointerCapture !== "function") return;
    try { container.releasePointerCapture(id); } catch { /* the capture is already gone */ }
  };

  // ---- the press (DOM-at-event-time): the tap's, read on the container — and the range's, claimed before the adapter hears it
  const onDown = (ev: PointerEvent): void => {
    down = ev.isPrimary && ev.button === 0 ? { id: ev.pointerId, type: ev.pointerType, x: ev.clientX, y: ev.clientY } : null;
    const was = press;
    press = null;
    secondary = false;
    if (was !== null) settle(was);   // a press whose release never came (petition I60): no longer down
    // a mouse's or a pen's primary press is counted, and claimed when it lands on the lent part's writing; touch is a tap only
    if (down !== null && ev.pointerType !== "touch") claim(ev, countOf(ev));
    // …and its right press keeps the field's focus there (petition I60), for a host's right-click rows
    else if (ev.button === 2 && ev.pointerType !== "touch") keep(ev);
  };
  // a platform that still sends a claimed press's compatibility mousedown (Pointer Events' PREVENT MOUSE EVENT flag unhonoured) would
  // move the focus off the field with its default: that default is the claim's to prevent too — and a kept right press's
  const onMouseDown = (ev: MouseEvent): void => { if ((press !== null && ev.button === 0) || (secondary && ev.button === 2)) ev.preventDefault(); };
  const onMove = (ev: PointerEvent): void => {
    const p = press;
    if (p === null || ev.pointerId !== p.id) return;
    // the lease went, or the release was lost (no primary button held): the press is over
    if (lent !== p.lease || (ev.buttons & 1) === 0) { press = null; settle(p); return; }
    if (!p.selecting) {
      const slop = world.getResource(GestureSettings)?.dragSlopPx ?? 10;
      if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) <= slop) return;
      p.selecting = true;
    }
    // a drag that leaves the container still selects
    if (!p.captured) { p.captured = true; capture(ev.pointerId); }
    drag(p, ev.clientX, ev.clientY);
  };
  const onUp = (ev: PointerEvent): void => {
    const p = press;
    if (p === null || ev.pointerId !== p.id) return;
    if (p.selecting && lent === p.lease) drag(p, ev.clientX, ev.clientY);   // a release away from the last move ends where it is
    if (p.captured) { p.captured = false; uncapture(ev.pointerId); }
    settle(p);
    // the press stays for its click: whether it was a tap
  };
  const onCancel = (ev: PointerEvent): void => {
    const p = press;
    if (p === null || ev.pointerId !== p.id) return;
    press = null;
    if (p.captured) uncapture(ev.pointerId);
    settle(p);
  };
  const onClick = (ev: MouseEvent): void => {
    const d = down;
    const p = press;
    down = null;
    press = null;
    if (p !== null) {
      // a CLAIMED press is a tap only when it selected nothing; a second or third click the editor's window missed but the platform
      // counted (its click's `detail`, by the OS's own interval) takes its word or its line here, at the release
      if (p.selecting || lent !== p.lease) return;
      if (ev.detail >= 2) {
        const r = unitAt(p.lease, p.index, ev.detail === 2 ? "word" : "line");
        select(p.lease, r.from, r.to);
        if (last !== undefined) last = { ...last, count: Math.max(last.count, ev.detail) };
        return;
      }
    }
    if (d === null || ev.button !== 0 || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const slop = world.getResource(GestureSettings)?.dragSlopPx ?? 10;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > slop) return;
    const cam = world.getResource(Camera);
    if (cam === undefined) return;
    // the tap in the container's layout space — the pointer adapter's and the viewport's, under any transform (petition I39)
    const at = clientToScreen(ev.clientX, ev.clientY, container.getBoundingClientRect(), container);
    const wx = cam.x + at.x / cam.zoom;
    const wy = cam.y + at.y / cam.zoom;
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
  container.addEventListener("mousedown", onMouseDown, { capture: true });
  container.addEventListener("pointermove", onMove, { capture: true });
  container.addEventListener("pointerup", onUp, { capture: true });
  container.addEventListener("pointercancel", onCancel, { capture: true });
  container.addEventListener("click", onClick, { capture: true });

  // ---- the host's items (petition I60): a bar's Cut, Copy, Paste and Select all, done as the keys do them
  /** The platform's async clipboard, where it has one. */
  const clipboard = (): Clipboard | undefined => (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { clipboard?: Clipboard }).clipboard);
  /**
   * The platform's OWN copy or cut on the focused field: its event reaches `lift` above (the lease's flavours, the cut's one input), so
   * true only when the platform answered AND its event was heard here; false where it refuses (no command, the field not focused).
   */
  const platformClip = (name: "copy" | "cut"): boolean => {
    if (typeof doc.execCommand !== "function" || doc.activeElement !== el) return false;
    heard = false;
    let ok = false;
    try { ok = doc.execCommand(name, false); } catch { ok = false; }
    return ok && heard;
  };
  /** The words to the async clipboard — their HTML beside them where the platform takes a clipboard item; whether they landed. */
  const writeClipboard = async (words: EditorLift): Promise<boolean> => {
    const c = clipboard();
    if (c === undefined) return false;
    if (words.html !== undefined && typeof c.write === "function" && typeof ClipboardItem === "function") {
      try {
        await c.write([new ClipboardItem({ "text/plain": new Blob([words.text], { type: "text/plain" }), "text/html": new Blob([words.html], { type: "text/html" }) })]);
        return true;
      } catch { /* a platform that refuses the item may still take the words alone */ }
    }
    if (typeof c.writeText !== "function") return false;
    try { await c.writeText(words.text); return true; } catch { return false; }
  };
  /** The system clipboard's plain words where the platform lets the page read them ("" for none) — undefined where it lets it read nothing. */
  const readClipboard = async (): Promise<string | undefined> => {
    const c = clipboard();
    try {
      if (typeof c?.readText === "function") return await c.readText();
      if (typeof c?.read === "function") {
        for (const item of await c.read()) if (item.types.includes("text/plain")) return await (await item.getType("text/plain")).text();
        return "";
      }
    } catch { /* the read refused (no permission, no gesture): the page reads nothing */ }
    return undefined;
  };
  /**
   * A bar's PASTE (`command`'s module doc): the clipboard's words — the kept piece when they are its — or, unread, the kept piece
   * itself. Words the HOST read (`given`): no clipboard read at all, the kept piece only when they are exactly its words.
   */
  const pasteFromBar = async (l: EditorLease, given?: string): Promise<boolean> => {
    const read = typeof given === "string" ? given : await readClipboard();
    if (lent !== l || composing) return false;
    const kept = lastLifted;
    const text = read?.replace(/\r\n?/g, "\n");
    const paste = text === undefined ? kept : text === "" ? undefined : kept !== undefined && kept.text === text ? kept : { text };
    if (paste === undefined || paste.text === "") return false;
    const from = el.selectionStart;
    const to = el.selectionEnd;
    if (l.lay?.(paste, from, to) === true) { opts.wake(); return true; }
    write(paste.text, from, to);   // a lease that lays nothing: the words written as the platform's paste would write them
    return true;
  };
  /** The host's ITEMS (kit/editor.ts `DeskEditor.command`). Everything up to the platform's own command runs inside the caller's gesture. */
  const command = async (name: EditorCommand, o?: EditorCommandOptions): Promise<boolean> => {
    const l = lent;
    if (l === undefined || composing) return false;
    if (name === "selectAll") {
      if (doc.activeElement !== el) el.focus({ preventScroll: true });
      select(l, 0, el.value.length);
      return true;
    }
    if (name === "paste") return pasteFromBar(l, o?.text);
    const from = el.selectionStart;
    const to = el.selectionEnd;
    if (from === to) return false;   // a caret: nothing to copy
    if (platformClip(name)) return true;
    // the platform refused its own: the lease's words (else the field's) to the async clipboard, kept — and a cut deletes once there
    const value = el.value;
    const words = l.lift?.(from, to) ?? { text: value.slice(from, to) };
    lastLifted = { text: words.text, ...(words.piece !== undefined ? { piece: words.piece } : {}) };
    if (!(await writeClipboard(words))) return false;
    if (name === "cut") {
      if (lent !== l || composing || el.value !== value) return false;   // the field moved while the clipboard was written: nothing cut
      write("", from, to);
    }
    return true;
  };

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
        if (v !== null && v !== el.value) { const i = Math.min(el.selectionStart, v.length); el.value = v; el.setSelectionRange(i, i); tell(l); }
      }
      place();
    },
    placement: () => placed,
    write,
    pressing: () => press?.down === true && press.lease === lent,
    command,
    dispose() {
      // a lease still held ends with the editor (petition I25 — a desk unmounted mid-typing, a remount among them): its `ended` is told,
      // so a typing session commits and lifts its claim, never left open with its idle commit cleared below
      end();
      if (idle !== undefined) clearTimeout(idle);
      lent = undefined;
      press = null;
      lastLifted = undefined;
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionupdate", onCompositionUpdate);
      el.removeEventListener("compositionend", onCompositionEnd);
      el.removeEventListener("copy", onCopy);
      el.removeEventListener("cut", onCut);
      el.removeEventListener("paste", onPaste);
      doc.removeEventListener("selectionchange", onSelection);
      container.removeEventListener("pointerdown", onDown, { capture: true });
      container.removeEventListener("mousedown", onMouseDown, { capture: true });
      container.removeEventListener("pointermove", onMove, { capture: true });
      container.removeEventListener("pointerup", onUp, { capture: true });
      container.removeEventListener("pointercancel", onCancel, { capture: true });
      container.removeEventListener("click", onClick, { capture: true });
      el.remove();
      sheet.remove();
    },
  };
}
