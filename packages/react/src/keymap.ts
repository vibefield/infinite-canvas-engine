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
 *   Esc             → ops.cancelActiveGestures
 *   Arrows          → nudge the selection ±1px (⇧ = ±10px) — ONE tx per press
 *   tool shortcuts  → ops.setTool (v/h/c + any registered tool's shortcut)
 *
 * Space-hold pan is ALREADY owned by the pointer adapter (design-003 §2) — it is
 * NOT rebound here. `mod` = ⌘ on macOS, Ctrl elsewhere (metaKey || ctrlKey).
 *
 * The widget input contract (design-007, petition I1) — three gates, in order:
 *  1. `event.defaultPrevented` → the widget's own handler consumed the key
 *     ("preventDefault = handled by content"); the engine never competes.
 *  2. Editable target (input/textarea/select/contentEditable — the shared
 *     4-class predicate from @ice/dom) → ignored, so typing never triggers a
 *     shortcut. Kept narrow so UNDECLARED widgets behave exactly as before.
 *  3. The `data-canvas-keyboard` claim marker on the event-target chain (the
 *     keydown target IS `document.activeElement` — browser focus is the one
 *     page-global truth, so two engines on one page stand down together) →
 *     EVERY entry cedes except Escape, the engine-reserved release gesture:
 *     Escape blurs the claim (the NEXT press, with focus gone, falls through
 *     to cancelActiveGestures). A widget that declared `keyboardEscape:
 *     "widget"` receives even Escape — release is click-away or blurFocus().
 *
 * Overrides replace a default by its key-signature `key|mod|shift`; a signature
 * with no default is added. A matched entry `preventDefault()`s (the target was
 * already filtered to non-editable, so no typing is swallowed).
 */
import { Position, guardedTransaction, selectedEntities, tools, type CanvasEngine } from "@ice/core";
import { isEditableTarget, keyboardClaimOf } from "@ice/dom";

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

/** One nudge = one gesture-equivalent transaction (absolute Position writes). */
function nudgeSelection(engine: CanvasEngine, dx: number, dy: number): void {
  const session = engine.docs.current();
  if (session === undefined) return;
  const selection = selectedEntities(engine.world).filter((e) => session.store.keyOf(e) !== undefined);
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

/** The locked defaults + tool shortcuts (read from the registry at attach time). */
function defaultEntries(): KeymapEntry[] {
  const entries: KeymapEntry[] = [
    { key: "Backspace", run: (e) => e.ops.deleteSelection() },
    { key: "Delete", run: (e) => e.ops.deleteSelection() },
    { key: "z", mod: true, run: (e) => e.docs.undo() },
    { key: "z", mod: true, shift: true, run: (e) => e.docs.redo() },
    { key: "d", mod: true, run: (e) => e.ops.duplicateSelection() },
    { key: "a", mod: true, run: (e) => e.ops.selectAll() },
    { key: "Escape", run: (e) => e.ops.cancelActiveGestures() },
  ];
  for (const [key, dx, dy] of ARROWS) {
    entries.push({ key, run: (e) => nudgeSelection(e, dx, dy) });
    entries.push({ key, shift: true, run: (e) => nudgeSelection(e, dx * 10, dy * 10) });
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
  for (const entry of overrides) map.set(signature(entry.key, entry.mod, entry.shift), entry);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return; // gate 1 — handled by content
    if (isEditableTarget(event.target)) return; // gate 2 — typing
    const claim = keyboardClaimOf(event.target);
    if (claim.claimed) {
      // Gate 3 — exclusive standdown. Escape stays engine-reserved as the
      // release gesture (blur, no gesture-cancel THIS press) unless the widget
      // owns it. Everything else flows to the widget, un-preventDefaulted.
      if (event.key === "Escape" && !claim.ownsEscape) {
        event.preventDefault();
        if (event.target instanceof HTMLElement) event.target.blur();
      }
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const entry = map.get(signature(event.key, mod, event.shiftKey));
    if (entry === undefined) return;
    event.preventDefault();
    entry.run(engine);
  };

  el.addEventListener("keydown", onKeyDown as EventListener);
  return () => el.removeEventListener("keydown", onKeyDown as EventListener);
}
