/**
 * DebugResizable — v3 port of the v1 resize regression surface. A bare DOM
 * widget with freeform resize enabled, no props, no card preset: pure resize
 * surface so each handle position can be exercised and the reported size is
 * visible. v1 read `Transform2D.{width,height}`; v3 reads the `Size` component
 * ({w,h}) via `useWorldComponent`.
 *
 * no preset — spawned freeform at defaultSize (260×180); interaction.resizable.
 */
import { defineWidget, Size } from "@ice/core";
import { useWorldComponent, type WidgetComponentProps } from "@ice/react";
import type { ReactElement } from "react";
import { CardShell } from "./CardShell";

function DebugResizableView({ entity, world }: WidgetComponentProps): ReactElement {
  const size = useWorldComponent(world, entity, Size);
  return (
    <CardShell world={world} entity={entity}>
    <div
      className="relative h-full w-full select-none"
      style={{
        background:
          "repeating-linear-gradient(45deg, #2a2a3a 0, #2a2a3a 10px, #1f1f2a 10px, #1f1f2a 20px)",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 12,
        border: "1px solid #4a4a6a",
        boxSizing: "border-box",
        // Clip our own gradient + border to CardShell's radius: a bordered,
        // backgrounded child isn't reliably clipped by the parent's
        // border-radius + overflow:hidden (CardShell also has a transform), so
        // the square corners poked out. `inherit` = CardShell's 22px.
        borderRadius: "inherit",
      }}
    >
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="rounded px-2 py-1 tabular-nums" style={{ background: "#000a", border: "1px solid #556" }}>
          {size ? `${Math.round(size.w)} × ${Math.round(size.h)}` : "resizable"}
        </div>
      </div>
    </div>
    </CardShell>
  );
}

export const DebugResizable = defineWidget({
  type: "debug-resizable",
  surface: "dom",
  component: DebugResizableView,
  provides: ["widget"],
  defaultSize: { w: 260, h: 180 },
  interaction: { resizable: true },
});
