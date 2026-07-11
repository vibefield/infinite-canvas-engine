// A small zoom-level indicator + controls — the prototype's zoom pill, reading the
// v3 Camera resource. Click % = reset to 100%, double-click = fit. 1:1 port of v2
// ZoomPill.tsx (inline styles verbatim; camera helpers are ./camera's v3 versions).
import { Camera, type World } from "@ice/core";
import { type CSSProperties, useEffect, useState } from "react";
import { setZoomAtCenter, zoomByCenter, zoomToFit } from "./camera";
import { startFrameLoop } from "./loop";

const wrap: CSSProperties = {
  position: "fixed",
  bottom: 16,
  right: 16,
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  height: 34,
  borderRadius: 999,
  overflow: "hidden",
  background: "rgba(22, 27, 34, .96)",
  border: "1px solid #30363d",
  boxShadow: "0 6px 20px rgba(0,0,0,.35)",
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  userSelect: "none",
};
const btn: CSSProperties = {
  width: 34,
  height: 34,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  color: "#9da7b3",
  fontSize: 16,
  cursor: "pointer",
};
const label: CSSProperties = {
  minWidth: 52,
  textAlign: "center",
  color: "#e6edf3",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

export function ZoomPill({ world }: { world: World }) {
  const [zoom, setZoom] = useState(() => world.getResource(Camera)?.zoom ?? 1);

  // Mirror the camera's zoom each frame (cheap; only re-renders React on change).
  useEffect(() => {
    return startFrameLoop(() => {
      const z = world.getResource(Camera)?.zoom ?? 1;
      setZoom((prev) => (Math.abs(prev - z) > 1e-4 ? z : prev));
    });
  }, [world]);

  // No dirty() to raise — the loop ticks every frame (F1), so a resource write lands next tick.
  return (
    <div style={wrap}>
      <button type="button" style={btn} title="Zoom out" onClick={() => zoomByCenter(world, 0.8)}>
        −
      </button>
      <button
        type="button"
        style={{ ...btn, ...label }}
        title="Click: reset to 100% · Double-click: zoom to fit"
        onClick={() => setZoomAtCenter(world, 1)}
        onDoubleClick={() => zoomToFit(world)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" style={btn} title="Zoom in" onClick={() => zoomByCenter(world, 1.25)}>
        +
      </button>
    </div>
  );
}
