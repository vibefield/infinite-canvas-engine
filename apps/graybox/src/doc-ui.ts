/**
 * The M5 document HUD: undo/redo controls + autosave/readOnly status, an
 * `always: true` reflector (reads only — Law 10). Undo/redo are APP HANDLERS
 * that run BETWEEN frames (button click / keydown): `store.undo()`/`redo()`
 * self-commit and the revert reaches the runtime at the next `world.sync()`
 * (durable-store.ts). Keyboard: Cmd/Ctrl-Z undo, Shift-Cmd/Ctrl-Z redo, Escape
 * cancels any active gesture (design-003 §8 one-tick CancelRequest).
 */
import type { CanvasHost } from "@ice/dom";
import {
  type Autosave,
  type DocSession,
  type Engine,
  type ReflectorDef,
  type World,
  cancelActiveGestures,
} from "@ice/core";

export interface DocUiDeps {
  engine: Engine;
  host: CanvasHost;
  world: World;
  session: DocSession;
  autosave: Autosave;
  /** Durable box count seeded/restored (shown in the panel). */
  boxCount: number;
  /** If the boot restore quarantined a corrupt save, the reason to surface. */
  quarantineReason?: string;
}

const PANEL_STYLE: Readonly<Record<string, string>> = {
  position: "absolute",
  top: "8px",
  right: "8px",
  padding: "8px 10px",
  background: "rgba(0, 0, 0, 0.62)",
  color: "#d8f0d8",
  font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  borderRadius: "4px",
  zIndex: "10",
  pointerEvents: "auto",
  textAlign: "right",
  minWidth: "180px",
};

const BTN_STYLE: Readonly<Record<string, string>> = {
  font: "inherit",
  margin: "0 0 0 6px",
  padding: "2px 8px",
  background: "#223022",
  color: "#d8f0d8",
  border: "1px solid #3c5c3c",
  borderRadius: "3px",
  cursor: "pointer",
};

function styleButton(btn: HTMLButtonElement): void {
  Object.assign(btn.style, BTN_STYLE);
}

export interface DocUi {
  reflector: ReflectorDef;
  detach(): void;
}

export function createDocUi(deps: DocUiDeps): DocUi {
  const doc = deps.host.container.ownerDocument;
  const panel = doc.createElement("div");
  Object.assign(panel.style, PANEL_STYLE);
  // Clicks on the panel must not reach the canvas pointer adapter as a gesture.
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());

  const status = doc.createElement("div");
  status.style.whiteSpace = "pre";
  status.style.marginBottom = "6px";

  const controls = doc.createElement("div");
  const undoBtn = doc.createElement("button");
  undoBtn.textContent = "↶ Undo";
  styleButton(undoBtn);
  const redoBtn = doc.createElement("button");
  redoBtn.textContent = "Redo ↷";
  styleButton(redoBtn);
  controls.append(undoBtn, redoBtn);

  panel.append(status, controls);
  deps.host.container.appendChild(panel);

  const doUndo = (): void => {
    deps.session.store.undo(); // lands at next sync; the rAF loop reflects it
  };
  const doRedo = (): void => {
    deps.session.store.redo();
  };
  undoBtn.addEventListener("click", doUndo);
  redoBtn.addEventListener("click", doRedo);

  const onKey = (e: KeyboardEvent): void => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if (e.key === "Escape") {
      cancelActiveGestures(deps.world);
    }
  };
  doc.addEventListener("keydown", onKey);

  const savedLabel = (): string => {
    const s = deps.autosave.state();
    switch (s.status) {
      case "saving":
        return "saving…";
      case "deferred":
        return "deferred (gesture)";
      case "pending":
        return "pending…";
      case "error":
        return "save failed";
      case "saved": {
        const ago = s.lastSavedAt !== undefined ? Math.max(0, Math.round((Date.now() - s.lastSavedAt) / 1000)) : 0;
        return `saved ${ago}s ago`;
      }
      default:
        return "idle";
    }
  };

  const reflector: ReflectorDef = {
    name: "doc-ui",
    always: true,
    flush() {
      const store = deps.session.store;
      const canUndo = store.canUndo();
      const canRedo = store.canRedo();
      undoBtn.disabled = !canUndo;
      redoBtn.disabled = !canRedo;
      undoBtn.style.opacity = canUndo ? "1" : "0.4";
      redoBtn.style.opacity = canRedo ? "1" : "0.4";

      const lines = [
        `doc ${deps.session.readOnly ? "[READ-ONLY]" : "durable"} · ${deps.boxCount} boxes`,
        `autosave: ${savedLabel()}`,
      ];
      if (deps.quarantineReason !== undefined) {
        lines.push("quarantined prior save:", deps.quarantineReason);
      }
      lines.push("⌘Z undo · ⇧⌘Z redo · Esc cancel");
      status.textContent = lines.join("\n");
    },
  };

  return {
    reflector,
    detach() {
      doc.removeEventListener("keydown", onKey);
      panel.remove();
    },
  };
}
