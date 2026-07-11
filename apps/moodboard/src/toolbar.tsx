/**
 * The floating toolbar — pure facade hooks, no engine plumbing:
 *   - `useTool` / `useToolState` drive the tool buttons (select/pan/connect +
 *     the custom draw-sticky), each routed through `ops.setTool`.
 *   - `useUndoStatus` + `useCanvasEngine().docs` power undo/redo (disabled when
 *     the stack is empty).
 *   - `useOps` gives zoom-to-fit and an "add swatch" spawn.
 *
 * Rendered as a child of `<InfiniteCanvas>`, so it sits under the EngineProvider
 * the canvas mounts — no context of its own.
 */
import { useCanvasEngine, useOps, useTool, useToolState, useUndoStatus } from "@ice/react";
import { DRAW_STICKY } from "./engine";
import type { CSSProperties, ReactElement } from "react";

export function Toolbar(): ReactElement {
  const [, setTool] = useTool();
  const ops = useOps();
  const engine = useCanvasEngine();
  const { canUndo, canRedo } = useUndoStatus();

  const addSwatch = (): void => {
    const hue = Math.floor(Math.random() * 360);
    ops.spawnWidget("swatch", { x: 0, y: 0, props: { color: `hsl(${hue} 70% 60%)` } });
  };

  return (
    <div data-toolbar style={BAR_STYLE}>
      <div style={GROUP_STYLE}>
        <ToolButton id="select" label="Select" onPick={setTool} />
        <ToolButton id="pan" label="Pan" onPick={setTool} />
        <ToolButton id="connect" label="Connect" onPick={setTool} />
        <ToolButton id={DRAW_STICKY.id} label="Sticky" onPick={setTool} />
      </div>

      <div style={SEP_STYLE} />

      <div style={GROUP_STYLE}>
        <button type="button" data-action="add-swatch" onClick={addSwatch} style={BTN_STYLE}>
          + Swatch
        </button>
        <button type="button" data-action="zoom-fit" onClick={() => ops.zoomToFit()} style={BTN_STYLE}>
          Fit
        </button>
      </div>

      <div style={SEP_STYLE} />

      <div style={GROUP_STYLE}>
        <button
          type="button"
          data-action="undo"
          disabled={!canUndo}
          onClick={() => engine.docs.undo()}
          style={btnStyle(!canUndo)}
        >
          Undo
        </button>
        <button
          type="button"
          data-action="redo"
          disabled={!canRedo}
          onClick={() => engine.docs.redo()}
          style={btnStyle(!canRedo)}
        >
          Redo
        </button>
      </div>
    </div>
  );
}

function ToolButton({
  id,
  label,
  onPick,
}: {
  id: string;
  label: string;
  onPick: (id: string) => void;
}): ReactElement {
  const active = useToolState(id);
  return (
    <button
      type="button"
      data-tool={id}
      aria-pressed={active}
      onClick={() => onPick(id)}
      style={toolBtnStyle(active)}
    >
      {label}
    </button>
  );
}

// --- styles ------------------------------------------------------------------

const BAR_STYLE: CSSProperties = {
  position: "absolute",
  top: "12px",
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 8px",
  borderRadius: "10px",
  background: "rgba(28,29,33,0.92)",
  boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
  zIndex: 10,
  fontSize: "12px",
  color: "#e8e8ea",
};
const GROUP_STYLE: CSSProperties = { display: "flex", gap: "4px" };
const SEP_STYLE: CSSProperties = { width: "1px", alignSelf: "stretch", background: "rgba(255,255,255,0.14)" };

const BTN_STYLE: CSSProperties = {
  font: "inherit",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "transparent",
  color: "inherit",
  borderRadius: "6px",
  padding: "5px 10px",
  cursor: "pointer",
};

function btnStyle(disabled: boolean): CSSProperties {
  return { ...BTN_STYLE, opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" };
}

function toolBtnStyle(active: boolean): CSSProperties {
  return {
    ...BTN_STYLE,
    background: active ? "#4a90d9" : "transparent",
    borderColor: active ? "#4a90d9" : "rgba(255,255,255,0.14)",
    color: active ? "#fff" : "#e8e8ea",
  };
}
