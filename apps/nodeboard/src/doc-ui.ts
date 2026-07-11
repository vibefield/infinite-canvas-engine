/**
 * The node-board HUD: a tool toggle (select / connect) + nested-canvas nav
 * (Enter / Exit) + undo/redo + an autosave/status panel, plus the keyboard
 * handlers. An `always: true` reflector that only READS (Law 10). Tool switches
 * write the `ActiveTool` runtime resource through the paved-road
 * `writeRuntimeResource`; Enter/Exit call the nested-canvas ops; Delete/Backspace
 * cascade-destroys the selection (a wired node takes its wires with it);
 * Cmd/Ctrl-Z undo/redo; Escape exits the current container frame. Adapted from
 * gl-board's doc-ui.
 */
import type { CanvasHost } from "@ice/dom";
import {
  ActiveTool,
  type Autosave,
  type DocSession,
  type Entity,
  type NestedCanvas,
  type ReflectorDef,
  Selected,
  type World,
  cascadeDestroy,
  defineQuery,
  writeRuntimeResource,
} from "@ice/core";
import { isEnterableContainer } from "./nodes";

export interface DocUiDeps {
  host: CanvasHost;
  world: World;
  session: DocSession;
  nav: NestedCanvas;
  autosave: Autosave;
  widgetCount: number;
  quarantineReason?: string;
}

const selectedQ = defineQuery([Selected]);

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
  minWidth: "230px",
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

function selectedEntities(world: World): Entity[] {
  const out: Entity[] = [];
  world.query(selectedQ).each((b) => {
    for (const r of b) out.push(b.entity(r));
  });
  return out;
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

  const tools = doc.createElement("div");
  tools.style.marginBottom = "4px";
  const selectBtn = doc.createElement("button");
  selectBtn.textContent = "Select";
  Object.assign(selectBtn.style, BTN_STYLE);
  const connectBtn = doc.createElement("button");
  connectBtn.textContent = "Connect";
  Object.assign(connectBtn.style, BTN_STYLE);
  tools.append(selectBtn, connectBtn);

  const navRow = doc.createElement("div");
  navRow.style.marginBottom = "4px";
  const enterBtn = doc.createElement("button");
  enterBtn.textContent = "Enter ▾";
  Object.assign(enterBtn.style, BTN_STYLE);
  const exitBtn = doc.createElement("button");
  exitBtn.textContent = "Exit ▴";
  Object.assign(exitBtn.style, BTN_STYLE);
  navRow.append(enterBtn, exitBtn);

  const controls = doc.createElement("div");
  const undoBtn = doc.createElement("button");
  undoBtn.textContent = "↶ Undo";
  Object.assign(undoBtn.style, BTN_STYLE);
  const redoBtn = doc.createElement("button");
  redoBtn.textContent = "Redo ↷";
  Object.assign(redoBtn.style, BTN_STYLE);
  controls.append(undoBtn, redoBtn);

  panel.append(status, tools, navRow, controls);
  deps.host.container.appendChild(panel);

  const setTool = (id: string): void => writeRuntimeResource(deps.world, ActiveTool, { id });
  const doUndo = (): void => {
    deps.session.store.undo();
  };
  const doRedo = (): void => {
    deps.session.store.redo();
  };
  const doExit = (): void => deps.nav.exitContainer();
  const doEnter = (): void => {
    for (const e of selectedEntities(deps.world)) {
      if (isEnterableContainer(deps.world, e)) {
        deps.nav.enterContainer(e);
        return;
      }
    }
  };
  const doDelete = (): void => {
    const sel = selectedEntities(deps.world);
    if (sel.length === 0) return;
    deps.session.store.transaction((tx) => {
      for (const e of sel) cascadeDestroy(tx, deps.world, e);
    });
  };

  selectBtn.addEventListener("click", () => setTool("select"));
  connectBtn.addEventListener("click", () => setTool("connect"));
  enterBtn.addEventListener("click", doEnter);
  exitBtn.addEventListener("click", doExit);
  undoBtn.addEventListener("click", doUndo);
  redoBtn.addEventListener("click", doRedo);

  const isTextTarget = (t: EventTarget | null): boolean =>
    t instanceof HTMLElement && t.closest("input, textarea, [contenteditable='true']") !== null;

  const onKey = (e: KeyboardEvent): void => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if (e.key === "Escape") {
      doExit();
    } else if ((e.key === "Delete" || e.key === "Backspace") && !isTextTarget(e.target)) {
      if (selectedEntities(deps.world).length === 0) return;
      e.preventDefault();
      doDelete();
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

  const highlight = (btn: HTMLButtonElement, on: boolean): void => {
    btn.style.background = on ? "#4a90d9" : "#2a2f3a";
    btn.style.borderColor = on ? "#4a90d9" : "#3f4756";
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

      const tool = deps.world.getResource(ActiveTool)?.id ?? "select";
      highlight(selectBtn, tool === "select");
      highlight(connectBtn, tool === "connect");

      const depth = deps.nav.depth();
      exitBtn.disabled = depth === 0;
      exitBtn.style.opacity = depth === 0 ? "0.4" : "1";

      const lines = [
        `node-board · ${deps.widgetCount} widgets${deps.session.readOnly ? " [READ-ONLY]" : ""}`,
        `tool: ${tool}${depth > 0 ? ` · inside group (depth ${depth})` : ""}`,
        "connect: drag port→port · dbl-click group to enter",
        `autosave: ${savedLabel()}`,
      ];
      if (deps.quarantineReason !== undefined) lines.push("quarantined prior save:", deps.quarantineReason);
      lines.push("Del delete · ⌘Z undo · ⇧⌘Z redo · Esc exit");
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
