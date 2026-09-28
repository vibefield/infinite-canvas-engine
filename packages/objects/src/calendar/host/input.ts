// THE DAYS AND THE PEN — the calendar's DOM half (CALENDAR.md §5; D3t-c), leasing the desk's ONE editor for its day line (K8a). A day
// is chosen, and a line begun, at EVENT TIME — the focus that makes typing write must be taken in the event (design-007 §2; a
// phone's keyboard opens only so, D-D2c.6) — so the clicks on a pad's paper are read here, on the container, at rest and in hand:
//
// - a CLICK on a day selects it (⇧ stretches the selection over a run) and lends the ONE editor to the calendar, so the keys are
//   the days' (the keymap cedes to the editor's claim): ⏎ or just typing writes a line on it, the arrows walk the days (over a
//   month's edge the pad follows), t goes home, PageUp/PageDown/[/] turn the month, Esc lets go; a click on a LINE selects it (⌫
//   takes it off — one transaction; ⏎ writes into it); ⌘Z/⇧⌘Z are the document's;
// - a DOUBLE-CLICK on a day writes a line on it (on the run, if the day is in the one selected), on a line writes into it with the
//   caret where it was pointed; a day under 150 px on screen is PICKED UP first (*Marks on the Mat*: picking it up replaces the
//   prototype's lean-in to the week) — the pen begins at once and the editor rides the pad into the hand;
// - writing: ⏎ keeps the line, Esc takes it back ("esc takes it back"), a blur keeps it, 1 s without input ends a session.
//
// At rest a pad's paper is a MISS for the interaction stack (a drag there pans the desk — D-D3w.7), so a click there is the days'
// only when nothing above it was hit (the pointer's exact hit is empty); in hand the point is mapped through the pose the renderer
// drew (the builder's `heldToWorld`, as core maps `HeldPointer`). The world half is objects/calendar-writing.ts (the sessions) and
// the `PadSelection` fact this writes; objects/calendar-hand.ts marks it on the pad each frame.

import { Active, Camera, CanvasSurface, defineQuery, type Entity, GestureSettings, guardedTransaction, HeldIntent, heldEntity, LocalPointer, Pointer, Position, PrefabId, setWidgetProps, Size, TouchesExact, trayOpen, type WidgetType, type World } from "@ice/core";
import { dayOr, monthKeyOf, PadSelection } from "../data";
import { isSpan } from "../events";
import { CALENDAR, type CalendarLaw } from "../law";
import { inMonth, keyOf, monthGrid, monthOfDay } from "../month";
import type { EventLine } from "../print";
import { dayBox, sheetOf } from "../sheet";
import { type CalendarGeometry, type CalendarObjectLook, type CalendarPart, DRAFT_ID, partAt, sheetOnScreen } from "../kind";
import type { CalendarDriver } from "../object";
import { type TypingDocs, writable } from "@ice/desk";
import type { DeskEditor, EditorLease } from "@ice/desk/kit";

/** The desk calendar's text part's name (K8a) — a day's line: what the editor's lease carries while the calendar holds it. */
export const CALENDAR_LINE = "calendar.line";

export interface CalendarInputOptions {
  readonly container: HTMLElement;
  readonly world: World;
  /** The builder's word on a pad: its geometry as drawn, the hand's frame, the held pose (host/layer.ts hands the builder). */
  readonly geometryOf: (e: Entity) => unknown;
  readonly hand: () => { readonly entity: Entity; readonly landing: boolean; readonly frame: { readonly cx: number; readonly cy: number; readonly s: number } } | undefined;
  readonly heldToWorld: (e: Entity, x: number, y: number) => readonly [number, number] | undefined;
  readonly editor: DeskEditor;
  /** The calendar's driver (`CalendarDriver`, D-D7-A.3): this is the CALENDAR's DOM half, which the calendar declares (K4b) — the host hands it the calendar's own and it joins it; none, no input. */
  readonly driver: CalendarDriver | undefined;
  /** The calendar object (its compiled widget type — its first group is a pad's props: its month, its week start). */
  readonly object: WidgetType;
  readonly docs: TypingDocs;
  /** The calendar's look as the desk composed it (the highlighters a band is drawn in). */
  readonly look: () => unknown;
  readonly law?: CalendarLaw;
  /** The hand's clock (the caret's blink, the wipe): `performance.now` unless a test says. */
  readonly now?: () => number;
  readonly wake: () => void;
}

export interface CalendarInput {
  /** The caret on the line being written — its index, its blink's restart, the newest glyph's wipe — for the hand's marks. */
  caret(): { readonly index: number; readonly t0: number; readonly wipe: { readonly index: number; readonly t0: number } | null } | null;
  /** Select days on a pad (a rig's door, the keys' own path): a run from `anchor` to `focus`; lends the editor. */
  selectDays(pad: Entity, anchor: number, focus: number): void;
  /** Select an entry on a pad; lends the editor. */
  selectEntry(pad: Entity, entry: Entity): void;
  /** Let go of the selection (and the editor). */
  clear(): void;
  /** Begin writing a new line on the selected days (the ⏎'s path); true when it began. */
  write(): boolean;
  /** Write into an entry, the caret at `index` (the end by default). */
  edit(pad: Entity, entry: Entity, index?: number): boolean;
  /** What a client point lands on — the pad and its part — as a click would read it (a rig's door). */
  partAtClient(clientX: number, clientY: number): { readonly pad: Entity; readonly part: CalendarPart } | null;
  dispose(): void;
}

const padsQ = defineQuery([PrefabId, Position, Size, Active]);
const pointersQ = defineQuery([Pointer, LocalPointer]);

/** The caret index nearest a sheet point on a line — where a tap puts the pen (the prototype's `caretIndexAt`). */
export function caretIndexAt(line: EventLine, sx: number, sy: number): number {
  const L = line.layout;
  const t = line.event.text;
  const n = L.positions.length / 2 - 1;
  const off = t.length - n;   // a timed line's layout starts after its time
  let best = t.length;
  let score = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= n; i++) {
    const px = line.ox + (L.positions[2 * i] as number);
    const py = line.oy + (L.positions[2 * i + 1] as number);
    const s = Math.abs(py - L.ascent * 0.4 - sy) * 3 + Math.abs(px - sx);
    if (s < score) { score = s; best = i + off; }
  }
  return Math.max(0, Math.min(best, t.length));
}

export function createCalendarInput(opts: CalendarInputOptions): CalendarInput | undefined {
  const cal = opts.driver;
  if (cal === undefined) return undefined;   // no calendar kind on this desk: no days, no pen
  const { container, world, editor } = opts;
  const { writing, pads, isPad } = cal;
  const look = (): CalendarObjectLook | undefined => opts.look() as CalendarObjectLook | undefined;
  /** The pad's props as the world holds them (its pen, its month, its week start). */
  const propsOf = (e: Entity): Readonly<Record<string, unknown>> => (world.isAlive(e) ? ((world.get(e, opts.object.groups[0]?.component as never) as Record<string, unknown> | undefined) ?? {}) : {});
  /** Write a pad's props (its month) — ONE transaction, off the undo stack: a roll is not an edit (D-D3t-c.5). */
  const setProps = (e: Entity, props: Readonly<Record<string, unknown>>): void => {
    const session = writable(opts.docs);
    if (session === undefined || !world.isAlive(e)) return;
    try { setWidgetProps(session.store, world, e, props, { undoable: false }); } catch { /* refused (the prop's schema, the guard): the month stays */ }
  };
  const law = opts.law ?? CALENDAR;
  const clock = opts.now ?? (() => performance.now());
  /** The pad the editor is lent for (its days, its line), or null. */
  let pad: Entity | null = null;
  let caretIndex = 0;
  let caretT0 = 0;
  let wipe: { index: number; t0: number } | null = null;
  /** The press in flight: where it began, and the run lent when it did (the press's blur lets the days go before its click). */
  let down: { id: number; type: string; x: number; y: number; lent: { readonly pad: Entity; readonly anchor: string } | null } | null = null;

  const G = (e: Entity): CalendarGeometry | undefined => opts.geometryOf(e) as CalendarGeometry | undefined;
  const selOf = (e: Entity) => (world.isAlive(e) ? world.get(e, PadSelection) : undefined);
  const setSel = (e: Entity, sel: { anchor?: string; focus?: string; entry?: Entity }): void => {
    const cur = world.get(e, PadSelection);
    const next = { anchor: sel.anchor ?? "", focus: sel.focus ?? "", entry: sel.entry ?? (0 as Entity), home: cur?.home ?? 0 };
    if (cur === undefined) world.addComponent(e, PadSelection, next);
    else if (cur.anchor !== next.anchor || cur.focus !== next.focus || cur.entry !== next.entry) world.edit(e).set(PadSelection, next);
    opts.wake();
  };
  const dropSel = (e: Entity): void => { if (world.isAlive(e) && world.has(e, PadSelection)) world.removeComponent(e, PadSelection); opts.wake(); };
  const printLines = (e: Entity): readonly EventLine[] => { const g = G(e); return g === undefined ? [] : (pads()?.printOf(e, g.shown)?.lines ?? []); };
  const runOf = (e: Entity): readonly [number, number] | null => {
    const s = selOf(e);
    const a = dayOr(s?.anchor ?? "");
    const f = dayOr(s?.focus ?? "");
    return a === undefined || f === undefined ? null : [Math.min(a, f), Math.max(a, f)];
  };
  const monthOfPad = (e: Entity): number | undefined => G(e)?.shown;
  /** Turn a pad to a month: its durable month, one transaction off the undo stack (the local rolls it there). */
  const turnTo = (e: Entity, month: number): void => { if (monthOfPad(e) !== month) setProps(e, { month: monthKeyOf(month) }); };

  // ---- the lease: the ONE editor's keys and value while the calendar holds it
  const lease: EditorLease = {
    part: CALENDAR_LINE,
    label: "write on the calendar",
    value: () => (writing.current() !== null ? writing.text() : ""),
    input(value) {
      const e = pad;
      if (e === null) return;
      if (writing.current() === null) {
        // just typing on a selected day writes a line on it — the key already in the field (a space alone writes nothing)
        if (value.trim().length === 0) { editor.element.value = ""; return; }
        if (!beginOnRun(e)) { editor.element.value = ""; return; }
      }
      const r = writing.input(value);
      caretIndex = editor.element.selectionStart;
      caretT0 = clock();
      if (r !== null) {
        const ch = value[r.from];
        wipe = r.to - r.from === 1 && ch !== undefined && ch !== " " ? { index: r.from, t0: clock() } : null;
      }
    },
    keydown(ev) {
      const e = pad;
      if (e === null) return false;
      const k = ev.key;
      const mod = ev.metaKey || ev.ctrlKey;
      const w = writing.current();
      if (w !== null) {
        if (k === "Enter") { finishWriting(true); return true; }
        if (k === "Escape") { finishWriting(false); return true; }
        return false;   // the line's own keys: the platform's (its caret, its undo while focused — D-D2c.9)
      }
      // the document's history through the facade's doors (historyStep: the tween retarget, the read-only posture — D7 #9)
      if (mod && (k === "z" || k === "Z")) { if (ev.shiftKey) opts.docs.redo?.(); else opts.docs.undo?.(); return true; }
      if (mod || ev.altKey) return false;
      if (k === "Escape") { clear(); return true; }
      if (k === "t" || k === "T") { goToday(e); return true; }
      if (k === "PageDown" || k === "]") { const m = monthOfPad(e); if (m !== undefined) turnTo(e, m + 1); return true; }
      if (k === "PageUp" || k === "[") { const m = monthOfPad(e); if (m !== undefined) turnTo(e, m - 1); return true; }
      const s = selOf(e);
      const entry = s !== undefined && s.entry !== (0 as Entity) && world.isAlive(s.entry) ? s.entry : null;
      if (entry !== null) {
        if (k === "Backspace" || k === "Delete") { removeEntry(e, entry); return true; }
        if (k === "Enter") { edit(e, entry); return true; }
        return k.length !== 1;   // a printable key on a selected line writes nothing (the prototype's), and is swallowed by `input`
      }
      const run = runOf(e);
      if (run !== null) {
        const move = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : k === "ArrowDown" ? 7 : k === "ArrowUp" ? -7 : 0;
        if (move !== 0) {
          const f = (dayOr(s?.focus ?? "") ?? run[1]) + move;
          if (ev.shiftKey) setSel(e, { anchor: s?.anchor ?? keyOf(f), focus: keyOf(f) });
          else setSel(e, { anchor: keyOf(f), focus: keyOf(f) });
          // over a month's edge the pad follows
          turnTo(e, monthOfDay(f));
          return true;
        }
        if (k === "Enter") { write(); return true; }
        if (k === "Backspace" || k === "Delete") return true;
      }
      return false;
    },
    caret(index) { caretIndex = index; caretT0 = clock(); },
    place() {
      const e = pad;
      const g = e === null ? undefined : G(e);
      if (e === null || g === undefined) return null;
      const w = writing.current();
      let box: { x: number; y: number; w: number; h: number } | null = null;
      if (w !== null) {
        const id = w.draft !== null ? DRAFT_ID : (w.entry as number | null) ?? DRAFT_ID;
        const l = printLines(e).find((q) => q.event.id === id);
        if (l !== undefined) box = { x: l.box.x, y: l.box.y, w: l.box.w, h: law.hand.pitch };
      }
      if (box === null) {
        const run = runOf(e);
        const b = run === null ? null : dayBox(sheetOf(monthGrid(g.shown, g.weekStart), law), run[0]);
        box = b === null ? null : { x: b.x + law.hand.pad, y: b.y + law.hand.top, w: b.w - 2 * law.hand.pad, h: law.hand.pitch };
      }
      if (box === null) return null;
      const [x0, y0] = sheetOnScreen(g, box.x, box.y, undefined, law);
      const [x1, y1] = sheetOnScreen(g, box.x + box.w, box.y + box.h, undefined, law);
      const h = Math.max(1, y1 - y0);
      return { x: x0, y: y0, w: Math.max(1, x1 - x0), h, fontPx: law.hand.size * (h / box.h) };
    },
    idle() { writing.commit(); },
    ended() {
      // a blur (a press anywhere else) keeps the line being written and lets go of the days: the keys go back to the desk
      const e = pad;
      if (writing.current() !== null) writing.end();
      pad = null;
      wipe = null;
      if (e !== null) dropSel(e);
    },
  };

  const lendFor = (e: Entity): void => {
    if (pad !== null && pad !== e) editor.release(lease);   // another pad's days let go (the lease's end drops them)
    pad = e;
    editor.lend(lease);
    caretT0 = clock();
  };
  /** A new line on the selected run (a band across several days, in the next highlighter; a line in the pad's pen). */
  const beginOnRun = (e: Entity): boolean => {
    const run = runOf(e);
    if (run === null) return false;
    const [a, b] = run;
    const g = G(e);
    if (g !== undefined && a === b && !inMonth(monthGrid(g.shown, g.weekStart), a)) { turnTo(e, monthOfDay(a)); return false; }
    let ink: string;
    if (b > a) {
      const names = Object.keys(look()?.print?.highlighters ?? {});
      const spans = (pads()?.entries(e) ?? []).filter((ev) => ev.id !== DRAFT_ID && isSpan(ev)).length;
      ink = names.length > 0 ? (names[spans % names.length] as string) : "yellow";
    } else ink = String(propsOf(e).pen ?? "felt");
    if (!writing.beginNew(e, a, b, ink)) return false;
    setSel(e, {});
    // too small to write on: the pad comes to the hand first (the editor rides it)
    pickUpIfSmall(e);
    return true;
  };
  const pickUpIfSmall = (e: Entity): void => {
    if (heldEntity(world) === e) return;
    const cam = world.getResource(Camera);
    if (cam === undefined || law.grid.cw * cam.zoom >= 150) return;
    const prev = world.getResource(HeldIntent);
    world.setResource(HeldIntent, { kind: "open", target: e, epoch: (prev?.epoch ?? 0) + 1 });
  };
  const finishWriting = (keep: boolean): void => {
    const w = writing.current();
    if (w === null) return;
    if (keep) writing.commit();
    const entry = writing.current()?.entry ?? null;
    if (keep) writing.end();
    else writing.cancel();
    wipe = null;
    // kept: the line is selected; taken back: the day it was on
    if (keep && entry !== null && world.isAlive(entry)) setSel(w.pad, { entry });
    else if (w.draft !== null) setSel(w.pad, { anchor: keyOf(w.draft.start), focus: keyOf(w.draft.end) });
    else if (w.entry !== null && world.isAlive(w.entry)) setSel(w.pad, { entry: w.entry });
    editor.element.value = "";
  };
  const removeEntry = (e: Entity, entry: Entity): void => {
    const s = writable(opts.docs);
    if (s === undefined) return;
    try { guardedTransaction(s.store, opts.world, (tx) => { tx.destroy(entry); }); } catch { return; }
    setSel(e, {});
    opts.wake();
  };
  const goToday = (e: Entity): void => {
    const today = pads()?.today();
    if (today === undefined) return;
    setSel(e, { anchor: keyOf(today), focus: keyOf(today) });
    turnTo(e, monthOfDay(today));
  };
  const clear = (): void => {
    const e = pad;
    if (writing.current() !== null) writing.end();
    editor.release(lease);
    if (e !== null) dropSel(e);
    pad = null;
  };
  const write = (): boolean => {
    const e = pad;
    if (e === null) return false;
    if (!beginOnRun(e)) return false;
    editor.element.value = "";
    caretIndex = 0;
    caretT0 = clock();
    opts.wake();
    return true;
  };
  const edit = (e: Entity, entry: Entity, index?: number): boolean => {
    lendFor(e);
    if (!writing.beginEntry(e, entry)) return false;
    setSel(e, { entry });
    const v = writing.text();
    editor.element.value = v;
    const i = Math.max(0, Math.min(index ?? v.length, v.length));
    editor.element.setSelectionRange(i, i);
    caretIndex = i;
    caretT0 = clock();
    pickUpIfSmall(e);
    opts.wake();
    return true;
  };

  // ---- where a client point lands
  const partAtClient = (clientX: number, clientY: number): { pad: Entity; part: CalendarPart } | null => {
    const r = container.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const held = heldEntity(world);
    if (held !== undefined) {
      // in hand: through the pose the last frame drew — the pad in hand, or nothing (the desk behind is soft)
      const h = opts.hand();
      if (h === undefined || h.entity !== held || h.landing || !isPad(held)) return null;
      const at = opts.heldToWorld(held, (px - h.frame.cx) / h.frame.s, (py - h.frame.cy) / h.frame.s);
      const g = G(held);
      if (at === undefined || g === undefined) return null;
      const part = partAt(g, at[0], at[1], printLines(held), law);
      return part === null ? null : { pad: held, part };
    }
    const cam = world.getResource(Camera);
    if (cam === undefined) return null;
    const wx = cam.x + px / cam.zoom;
    const wy = cam.y + py / cam.zoom;
    let best: { pad: Entity; part: CalendarPart } | null = null;
    world.query(padsQ).each((b) => {
      for (const row of b) {
        const e = b.entity(row);
        if (!isPad(e)) continue;
        const g = G(e);
        if (g === undefined) continue;
        const part = partAt(g, wx, wy, printLines(e), law);
        if (part !== null) best = { pad: e, part };
      }
    });
    return best;
  };
  /** Whether the interaction stack's exact hit for this pointer is empty (nothing above the paper took the click). */
  const bareUnder = (type: string, id: number): boolean => {
    const pid = type === "touch" ? `touch:${id}` : "mouse";
    let bare = true;
    world.query(pointersQ).each((b) => {
      for (const r of b) {
        const p = b.entity(r);
        if (world.read(p, Pointer).id !== pid) continue;
        const hit = world.getRelation(p, TouchesExact);
        if (hit !== undefined && !world.hasTag(hit, CanvasSurface)) bare = false;   // the bare mat is the canvas surface
      }
    });
    return bare;
  };

  const onDown = (ev: PointerEvent): void => {
    const anchor = pad === null || runOf(pad) === null ? null : (selOf(pad)?.anchor ?? null);
    const lent = pad !== null && anchor !== null ? { pad, anchor } : null;
    down = ev.isPrimary && ev.button === 0 ? { id: ev.pointerId, type: ev.pointerType, x: ev.clientX, y: ev.clientY, lent } : null;
  };
  const tapOn = (ev: MouseEvent): { pad: Entity; part: CalendarPart } | null => {
    const d = down;
    if (d === null || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.altKey) return null;
    const slop = world.getResource(GestureSettings)?.dragSlopPx ?? 10;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > slop) return null;
    // the pegboard drawer out: the desk is inert (design-017 §4) — `bareUnder` calls the canvas bare, so it cannot be the guard here;
    // a click on a specimen over a pad under the drawer selects no day and begins no writing (K9 law #1)
    if (trayOpen(world)) return null;
    const held = heldEntity(world);
    if (held === undefined && !bareUnder(d.type, d.id)) return null;
    return partAtClient(ev.clientX, ev.clientY);
  };
  const onClick = (ev: MouseEvent): void => {
    // the run lent when the press began: the press moved the focus off the editor, and that blur (`ended`) let the days go
    const lent = down?.lent ?? null;
    const hit = tapOn(ev);
    down = ev.detail >= 2 ? down : null;
    if (hit === null) return;
    const { pad: e, part } = hit;
    if (part.part === "day" && part.day !== undefined) {
      if (ev.shiftKey && lent !== null && lent.pad === e) setSel(e, { anchor: lent.anchor, focus: keyOf(part.day) });
      else setSel(e, { anchor: keyOf(part.day), focus: keyOf(part.day) });
      lendFor(e);
      return;
    }
    if (part.part === "entry" && part.line !== undefined) {
      if (writing.current()?.entry === (part.line.event.id as Entity)) return;   // a click inside the line being written: the platform moves the caret
      if (part.line.event.id === DRAFT_ID) return;
      setSel(e, { entry: part.line.event.id as Entity });
      lendFor(e);
      return;
    }
    if (part.part === "sheet" && pad === e) clear();
  };
  const onDbl = (ev: MouseEvent): void => {
    const hit = tapOn(ev);
    down = null;
    if (hit === null) return;
    const { pad: e, part } = hit;
    if (part.part === "entry" && part.line !== undefined && part.line.event.id !== DRAFT_ID) {
      edit(e, part.line.event.id as Entity, caretIndexAt(part.line, part.sx, part.sy));
      return;
    }
    if (part.part === "day" && part.day !== undefined) {
      const run = runOf(e);
      const inRun = run !== null && part.day >= run[0] && part.day <= run[1];
      if (!inRun) setSel(e, { anchor: keyOf(part.day), focus: keyOf(part.day) });
      lendFor(e);
      write();
    }
  };
  container.addEventListener("pointerdown", onDown, { capture: true });
  container.addEventListener("click", onClick, { capture: true });
  container.addEventListener("dblclick", onDbl, { capture: true });

  const input: CalendarInput = {
    caret: () => (writing.current() === null ? null : { index: caretIndex, t0: caretT0, wipe }),
    selectDays(e, anchor, focus) { setSel(e, { anchor: keyOf(anchor), focus: keyOf(focus) }); lendFor(e); },
    selectEntry(e, entry) { setSel(e, { entry }); lendFor(e); },
    clear,
    write,
    edit,
    partAtClient,
    dispose() {
      container.removeEventListener("pointerdown", onDown, { capture: true });
      container.removeEventListener("click", onClick, { capture: true });
      container.removeEventListener("dblclick", onDbl, { capture: true });
      editor.release(lease);
      if (cal.input === input) cal.input = undefined;
    },
  };
  cal.input = input;   // the driver's hand reads this half's caret; the driver disposes it
  return input;
}
