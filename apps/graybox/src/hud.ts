/**
 * The telemetry HUD — an `always: true` reflector (design-002 §5 cheap-overlay
 * style; dogfoods the "flush every frame regardless of dirt" path). It writes
 * ONE overlay div per frame from read-only sources: engine frame telemetry
 * (`engine.lastFrame()`), the frame clock (FrameInfo), and the two reflectors'
 * write counters. Law 10 holds — it reads no layout and writes no ECS.
 *
 * Shows: rolling fps, ECS tick µs (telemetry totalMicros), per-frame deltas of
 * transform writes and gray-box style writes (the O(1)-pan / churn instruments),
 * the live node count, which reflectors flushed, and the per-system ran/skip + µs
 * table (empty until a scripted run registers the drag system).
 */
import type { CanvasHost } from "@ice/dom";
import { type Engine, FrameInfo, type ReflectorDef } from "@ice/core";

export interface HudDeps {
  engine: Engine;
  host: CanvasHost;
  plane: { transformWrites(): number };
  graybox: { styleWrites(): number; nodeCount(): number };
}

const HUD_STYLE: Readonly<Record<string, string>> = {
  position: "absolute",
  top: "8px",
  left: "8px",
  padding: "8px 10px",
  background: "rgba(0, 0, 0, 0.62)",
  color: "#d8f0d8",
  font: "11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "pre",
  pointerEvents: "none",
  borderRadius: "4px",
  zIndex: "10",
};

export function createHudReflector(deps: HudDeps): ReflectorDef {
  const el = deps.host.container.ownerDocument.createElement("div");
  Object.assign(el.style, HUD_STYLE);
  deps.host.container.appendChild(el);

  let ema = 0;
  let prevTransform = deps.plane.transformWrites();
  let prevStyle = deps.graybox.styleWrites();

  return {
    name: "hud",
    always: true,
    flush(world) {
      const dt = world.getResource(FrameInfo)?.dt ?? 0;
      if (dt > 0) {
        const inst = 1000 / dt;
        ema = ema === 0 ? inst : ema * 0.9 + inst * 0.1;
      }

      const transform = deps.plane.transformWrites();
      const style = deps.graybox.styleWrites();
      const dTransform = transform - prevTransform;
      const dStyle = style - prevStyle;
      prevTransform = transform;
      prevStyle = style;

      const frame = deps.engine.lastFrame();
      const lines = [
        `fps ${ema.toFixed(0).padStart(3)}   tick ${frame ? `${frame.totalMicros}µs` : "—"}`,
        `nodes ${deps.graybox.nodeCount()}`,
        `transform writes/frame ${dTransform}`,
        `graybox style writes/frame ${dStyle}`,
        `reflectors ${frame ? frame.reflectorsFlushed.join(", ") : "—"}`,
      ];
      if (frame && frame.systems.length > 0) {
        lines.push("systems:");
        for (const s of frame.systems) {
          lines.push(`  ${s.phase}/${s.system} ${s.ran ? "ran " : "skip"} ${s.micros}µs`);
        }
      }
      lines.push("", "[p] scripted pan   [d] scripted drag");
      el.textContent = lines.join("\n");
    },
  };
}
