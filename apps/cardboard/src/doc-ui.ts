/**
 * The card-board document HUD: undo/redo + autosave status panel, plus the
 * keyboard handlers. An `always: true` reflector that only READS (Law 10).
 * Undo/redo are APP HANDLERS between frames (Cmd/Ctrl-Z, Shift for redo);
 * `store.undo()`/`redo()` self-commit and land at the next `world.sync()`.
 * Escape cancels any active gesture (design-003 §8). Simplified from graybox's.
 */
import type { CanvasHost } from "@ice/dom";
import {
  type Autosave,
  type DocSession,
  type ReflectorDef,
  type World,
  cancelActiveGestures,
} from "@ice/core";

export interface DocUiDeps {
  host: CanvasHost;
  world: World;
  session: DocSession;
  autosave: Autosave;
  cardCount: number;
  quarantineReason?: string;
}

const PANEL_STYLE: Readonly<Record<string, string>> = {
  position: "absolute",
  top: "10px",
  right: "10px",
  padding: "9px 11px",
  background: "rgba(20,22,26,0.72)",
  color: "#e6ecf2",
  font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  borderRadius: "6px",
  zIndex: "10",
  pointerEvents: "auto",
  textAlign: "right",
  minWidth: "190px",
};

const BTN_STYLE: Readonly<Record<string, string>> = {
  font: "inherit",
  margin: "0 0 0 6px",
  padding: "2px 8px",
  background: "#2a2f3a",
  color: "#e6ecf2",
  border: "1px solid #3f4756",
  borderRadius: "4px",
  cursor: "pointer",
};

export interface DocUi {
  reflector: ReflectorDef;
  detach(): void;
}

export function createDocUi(deps: DocUiDeps): DocUi {
  const doc = deps.host.container.ownerDocument;
  const panel = doc.createElement("div");
  Object.assign(panel.style, PANEL_STYLE);
  // Panel clicks are chrome, not canvas gestures.
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());

  const status = doc.createElement("div");
  status.style.whiteSpace = "pre";
  status.style.marginBottom = "6px";

  const controls = doc.createElement("div");
  const undoBtn = doc.createElement("button");
  undoBtn.textContent = "↶ Undo";
  Object.assign(undoBtn.style, BTN_STYLE);
  const redoBtn = doc.createElement("button");
  redoBtn.textContent = "Redo ↷";
  Object.assign(redoBtn.style, BTN_STYLE);
  controls.append(undoBtn, redoBtn);
  panel.append(status, controls);
  deps.host.container.appendChild(panel);

  const doUndo = (): void => {
    deps.session.store.undo();
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
        `card-board · ${deps.cardCount} cards${deps.session.readOnly ? " [READ-ONLY]" : ""}`,
        `autosave: ${savedLabel()}`,
      ];
      if (deps.quarantineReason !== undefined) lines.push("quarantined prior save:", deps.quarantineReason);
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
