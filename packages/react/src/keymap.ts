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
 * NOT rebound here. A keystroke is IGNORED when the event target is editable
 * (input/textarea/select/contenteditable) so typing into widget fields never
 * triggers a shortcut. `mod` = ⌘ on macOS, Ctrl elsewhere (metaKey || ctrlKey).
 *
 * Overrides replace a default by its key-signature `key|mod|shift`; a signature
 * with no default is added. A matched entry `preventDefault()`s (the target was
 * already filtered to non-editable, so no typing is swallowed).
 */
import { Position, guardedTransaction, selectedEntities, tools, type CanvasEngine } from "@ice/core";

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

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
    if (isEditableTarget(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    const entry = map.get(signature(event.key, mod, event.shiftKey));
    if (entry === undefined) return;
    event.preventDefault();
    entry.run(engine);
  };

  el.addEventListener("keydown", onKeyDown as EventListener);
  return () => el.removeEventListener("keydown", onKeyDown as EventListener);
}
