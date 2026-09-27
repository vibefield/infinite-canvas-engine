/**
 * The default keymap (design-005 §4 "Keymap"; design-003 §2 — NO system-side
 * keyboard logic, every entry resolves to an `ops.*`/`docs.*` call).
 *
 * Locked defaults:
 *   ⌫/Delete        → ops.deleteSelection
 *   ⌘Z / Ctrl-Z     → docs.undo
 *   ⇧⌘Z / ⇧Ctrl-Z   → docs.redo
 *   ⌘D              → ops.duplicateSelection
 *   ⌘A              → ops.selectAll
 *   Esc             → closes the pegboard tray first (design-017 §4), else ops.cancelActiveGestures
 *   Arrows          → nudge the selection ±1px (⇧ = ±10px) — ONE tx per press; a TAPED widget
 *                     never moves (design-015 §5.1 — `Locked`, D4a), its untaped companions do
 *   ⇧⌘L / ⇧Ctrl-L   → tape the selection down, or lift the tape when all of it is taped
 *                     (*Marks on the Mat*'s keys, D4a) — `ops.setLocked`, one transaction
 *   tool shortcuts  → ops.setTool (v/h/c + any registered tool's shortcut)
 *   in hand         → the held object's own tools first (design-015 §8, D3t-a): its type's
 *                     `heldTools` keys → ops.useHeldTool — and only while it is held
 *
 * Space-hold pan is ALREADY owned by the pointer adapter (design-003 §2) — it is
 * NOT rebound here. `mod` = ⌘ on macOS, Ctrl elsewhere (metaKey || ctrlKey).
 *
 * The widget input contract (design-007, petition I1) — three gates, in order:
 *  1. `event.defaultPrevented` → the widget's own handler consumed the key
 *     ("preventDefault = handled by content"); the engine never competes.
 *  2. The `data-canvas-keyboard` claim marker on the event-target chain (the
 *     keydown target IS `document.activeElement` — browser focus is the one
 *     page-global truth, so two engines on one page stand down together) →
 *     EVERY entry cedes except Escape, the engine-reserved release gesture:
 *     Escape blurs the claim (the NEXT press, with focus gone, falls through
 *     to cancelActiveGestures). A widget that declared `keyboardEscape:
 *     "widget"` receives even Escape — release is click-away or blurFocus().
 *     This gate runs BEFORE the editable gate on purpose (2026-08-09 review):
 *     a claim whose focus node is an editable proxy (the Ghosttea-style
 *     hidden textarea, design-007 §6) must still get the Escape release —
 *     editable-first would shadow it and silently turn every such widget
 *     into `keyboardEscape: "widget"`.
 *  3. Editable target (input/textarea/select/contentEditable — the shared
 *     4-class predicate from @ice/dom) → ignored, so typing never triggers a
 *     shortcut. Kept narrow so UNDECLARED widgets behave exactly as before.
 *
 * Overrides replace a default by its key-signature `key|mod|shift`; a signature
 * with no default is added. A matched entry `preventDefault()`s (the target was
 * already filtered to non-editable, so no typing is swallowed). An override on
 * Space warns at attach: the pointer adapter owns Space (the pan modifier,
 * design-003 §4.4) and preventDefaults it before gate 1 can let it through.
 */
import { Container, GestureActive, Locked, Position, PrefabId, closeTray, currentNavEntry, defineQuery, guardedTransaction, heldEntity, matchHeldTool, selectedEntities, tools, trayOpen, type CanvasEngine } from "@ice/core";
import { isEditableTarget, keyboardClaimOf } from "@ice/dom";

const gestureActiveQ = defineQuery([GestureActive]);

/**
 * ⏎ (design-015 §8 · §9): exactly one selected widget — an object whose kind OPENS is picked up into the hand (D4b); a
 * container the catalog can enter is flown into. Nothing while something is already held.
 */
function openOrEnterSelected(engine: CanvasEngine): void {
  const { world } = engine;
  if (heldEntity(world) !== undefined || trayOpen(world)) return;
  const selected = selectedEntities(world);
  if (selected.length !== 1) return;
  const target = selected[0];
  if (target === undefined || !world.isAlive(target)) return;
  const typeId = world.get(target, PrefabId)?.id;
  if (typeof typeId === "string" && engine.catalog.widget(typeId)?.openable === true) { engine.ops.open(target); return; }
  if (!world.hasTag(target, Container)) return;
  engine.ops.enterContainer(target);
}

/**
 * Esc (design-007 §3.3, design-015 §8 · §9, design-017 §4): the pegboard tray is closed first (K3 — the drawer is the nearest
 * thing to let go of); an object in hand is put down next (D4b — the object lands, still selected, so ⏎ opens it again); else a
 * live gesture is cancelled, as ever; with none to cancel, the current frame is left.
 */
function escapeOrExit(engine: CanvasEngine): void {
  const { world } = engine;
  if (trayOpen(world)) { closeTray(world); return; }
  if (heldEntity(world) !== undefined) { engine.ops.putDown(); return; }
  const gestureLive = world.firstOf(gestureActiveQ) !== undefined;
  if (!gestureLive && currentNavEntry(world) !== undefined) {
    engine.ops.exitContainer();
    return;
  }
  engine.ops.cancelActiveGestures();
}

/**
 * The desk's keys go quiet while it is inert — an object in hand (D4b) or the pegboard tray open (design-017 §4): what would delete,
 * copy, nudge or gather on the inert desk does nothing.
 */
const unlessInert = (run: (engine: CanvasEngine) => void) => (engine: CanvasEngine): void => { if (heldEntity(engine.world) === undefined && !trayOpen(engine.world)) run(engine); };

/**
 * The held bar's keys (design-015 §8; D3t-a): with an object in hand, its type's tools (`heldTools` — the kind's `open.tools`)
 * take their keys before any entry here, and only then — `1`–`4` are the board's markers in hand and nothing on the desk. The
 * tool is used through `ops.useHeldTool` (a mode becomes the tool in hand, an action runs its op). True when a tool took it.
 */
function heldToolKey(engine: CanvasEngine, event: KeyboardEvent): boolean {
  const held = heldEntity(engine.world);
  if (held === undefined) return false;
  const typeId = engine.world.get(held, PrefabId)?.id;
  const tools = typeof typeId === "string" ? (engine.catalog.widget(typeId)?.heldTools ?? []) : [];
  const tool = matchHeldTool(tools, { key: event.key, mod: event.metaKey || event.ctrlKey, shift: event.shiftKey, alt: event.altKey });
  if (tool === undefined) return false;
  engine.ops.useHeldTool(tool.id);
  return true;
}

export interface KeymapEntry {
  /** `event.key` to match (case-insensitive; e.g. "z", "Backspace", "ArrowUp"). */
  readonly key: string;
  /** Require ⌘/Ctrl (default false → must NOT be held). */
  readonly mod?: boolean;
  /** Require ⇧ (default false → must NOT be held). */
  readonly shift?: boolean;
  /** Resolve to an engine write path — no keyboard logic beyond dispatch. */
  run(engine: CanvasEngine): void;
}

type KeyTarget = Pick<Window, "addEventListener" | "removeEventListener">;

const signature = (key: string, mod?: boolean, shift?: boolean): string =>
  `${key.toLowerCase()}|${mod ? 1 : 0}|${shift ? 1 : 0}`;

/**
 * One nudge = one gesture-equivalent transaction (absolute Position writes). A taped widget (`Locked`) is passed
 * over — the tape holds it as it holds against a drag (design-015 §5.1, D4a). Exported so an app can bind its own
 * step (the desk's ⇧ nudge is one lattice cell, 20).
 */
export function nudgeSelection(engine: CanvasEngine, dx: number, dy: number): void {
  const session = engine.docs.current();
  if (session === undefined) return;
  const selection = selectedEntities(engine.world).filter((e) => session.store.keyOf(e) !== undefined && !engine.world.hasTag(e, Locked));
  if (selection.length === 0) return;
  guardedTransaction(session.store, engine.world, (tx) => {
    for (const e of selection) {
      const p = engine.world.get(e, Position);
      if (p === undefined) continue;
      tx.edit(e).set(Position, { x: p.x + dx, y: p.y + dy });
    }
  });
}

const ARROWS: readonly [key: string, dx: number, dy: number][] = [
  ["ArrowLeft", -1, 0],
  ["ArrowRight", 1, 0],
  ["ArrowUp", 0, -1],
  ["ArrowDown", 0, 1],
];

/** ⇧⌘L: tape the selection down — or, when every selected widget is taped, lift the tape (one transaction). */
export function toggleTape(engine: CanvasEngine): void {
  const selection = selectedEntities(engine.world);
  if (selection.length === 0) return;
  engine.ops.setLocked(selection, !selection.every((e) => engine.world.hasTag(e, Locked)));
}

/** The locked defaults + tool shortcuts (read from the registry at attach time). */
function defaultEntries(): KeymapEntry[] {
  const entries: KeymapEntry[] = [
    { key: "Backspace", run: unlessInert((e) => e.ops.deleteSelection()) },
    { key: "Delete", run: unlessInert((e) => e.ops.deleteSelection()) },
    { key: "z", mod: true, run: (e) => e.docs.undo() },
    { key: "z", mod: true, shift: true, run: (e) => e.docs.redo() },
    { key: "d", mod: true, run: unlessInert((e) => e.ops.duplicateSelection()) },
    { key: "a", mod: true, run: unlessInert((e) => e.ops.selectAll()) },
    // design-015 §8 · §9 (D2b, D4b): ⏎ with ONE selected picks an openable object up, or flies into a container; Esc puts
    // the held object down, else cancels a live gesture as ever, and with none to cancel flies back out of the current frame.
    { key: "Enter", run: (e) => openOrEnterSelected(e) },
    { key: "Escape", run: (e) => escapeOrExit(e) },
    { key: "l", mod: true, shift: true, run: unlessInert(toggleTape) },
  ];
  for (const [key, dx, dy] of ARROWS) {
    entries.push({ key, run: unlessInert((e) => nudgeSelection(e, dx, dy)) });
    entries.push({ key, shift: true, run: unlessInert((e) => nudgeSelection(e, dx * 10, dy * 10)) });
  }
  for (const tool of tools.all()) {
    if (tool.shortcut !== undefined) {
      const id = tool.id;
      entries.push({ key: tool.shortcut, run: (e) => e.ops.setTool(id) });
    }
  }
  return entries;
}

function resolveTarget(target?: KeyTarget): KeyTarget | undefined {
  if (target !== undefined) return target;
  return typeof window !== "undefined" ? window : undefined;
}

/**
 * Attach the default keymap (plus `overrides`) to `target` (default: `window`).
 * Returns a detach function. No-op (returns a no-op detach) when there is no
 * target — e.g. a headless environment with no `window`.
 */
export function attachKeymap(
  engine: CanvasEngine,
  target?: KeyTarget,
  overrides: readonly KeymapEntry[] = [],
): () => void {
  const el = resolveTarget(target);
  if (el === undefined) return () => {};

  const map = new Map<string, KeymapEntry>();
  for (const entry of defaultEntries()) map.set(signature(entry.key, entry.mod, entry.shift), entry);
  for (const entry of overrides) {
    if (entry.key === " ") {
      // Fail loud at attach, not silently at runtime: the adapter's window
      // listener registers first and preventDefaults Space (pan modifier),
      // so gate 1 makes this entry unreachable by construction.
      console.warn(
        "ice: attachKeymap — an override on Space can never fire: the pointer adapter owns Space as the pan modifier (design-003 §4.4) and preventDefaults it before the keymap's handled-by-content gate.",
      );
    }
    map.set(signature(entry.key, entry.mod, entry.shift), entry);
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return; // gate 1 — handled by content
    const claim = keyboardClaimOf(event.target);
    if (claim.claimed) {
      // Gate 2 — exclusive standdown (BEFORE the editable gate, so editable
      // focus proxies keep the release gesture — header note). Escape stays
      // engine-reserved (blur, no gesture-cancel THIS press) unless the
      // widget owns it. Everything else flows to the widget,
      // un-preventDefaulted.
      if (event.key === "Escape" && !claim.ownsEscape) {
        event.preventDefault();
        // SVG nodes are focusable too (tabindex) and are not HTMLElement —
        // the release must never eat Escape without actually blurring.
        const t = event.target;
        if (t instanceof HTMLElement || t instanceof SVGElement) t.blur();
      }
      return;
    }
    if (isEditableTarget(event.target)) return; // gate 3 — typing
    if (heldToolKey(engine, event)) { event.preventDefault(); return; } // the object in hand's tools first (D3t-a)
    const mod = event.metaKey || event.ctrlKey;
    const entry = map.get(signature(event.key, mod, event.shiftKey));
    if (entry === undefined) return;
    event.preventDefault();
    entry.run(engine);
  };

  el.addEventListener("keydown", onKeyDown as EventListener);
  return () => el.removeEventListener("keydown", onKeyDown as EventListener);
}
