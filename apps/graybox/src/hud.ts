/**
 * The telemetry + interaction HUD — an `always: true` reflector (design-002 §5
 * cheap-overlay style). It writes ONE overlay div per frame from READ-ONLY
 * sources (Law 10: reads no layout, writes no ECS): engine frame telemetry, the
 * frame clock, the two geometry reflectors' write counters, and — new for M4 —
 * a live snapshot of the interaction world: every recognizer's kind + phase, the
 * claimed-pointer count, the selection count, and the running commit-intent tally
 * from the recording sink.
 */
import type { CanvasHost } from "@ice/dom";
import {
  Any,
  ClaimedBy,
  type CommitIntent,
  Drag,
  type Entity,
  FrameInfo,
  GesturePhases,
  LongPress,
  Pinch,
  Pointer,
  type ReflectorDef,
  RoutedConnect,
  RoutedMarquee,
  RoutedMove,
  RoutedPan,
  RoutedResize,
  Selected,
  Tap,
  WheelPan,
  WheelZoom,
  type World,
  defineQuery,
  type Engine,
} from "@ice/core";

export interface HudDeps {
  engine: Engine;
  host: CanvasHost;
  plane: { transformWrites(): number };
  graybox: { styleWrites(): number; nodeCount(): number };
  /** The recording commit sink — its intents length is the gesture-commit tally. */
  sink: { readonly intents: readonly CommitIntent[] };
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

const recognizerQ = defineQuery([Any(Tap, LongPress, Drag, Pinch, WheelPan, WheelZoom)]);
const pointerQ = defineQuery([Pointer]);
const selectedQ = defineQuery([Selected]);

const P = GesturePhases;

function kindOf(world: World, e: Entity): string {
  if (world.has(e, Tap)) return "tap";
  if (world.has(e, LongPress)) return "longPress";
  if (world.has(e, Drag)) return "drag";
  if (world.has(e, Pinch)) return "pinch";
  if (world.has(e, WheelPan)) return "wheelPan";
  if (world.has(e, WheelZoom)) return "wheelZoom";
  return "?";
}

function routeOf(world: World, e: Entity): string {
  if (world.hasTag(e, RoutedMove)) return " move";
  if (world.hasTag(e, RoutedResize)) return " resize";
  if (world.hasTag(e, RoutedPan)) return " pan";
  if (world.hasTag(e, RoutedMarquee)) return " marquee";
  if (world.hasTag(e, RoutedConnect)) return " connect";
  return "";
}

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

      // --- interaction snapshot ---
      const recognizers: string[] = [];
      world.query(recognizerQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          recognizers.push(`${kindOf(world, e)}:${P.current(world, e) ?? "-"}${routeOf(world, e)}`);
        }
      });
      let claims = 0;
      world.query(pointerQ).each((b) => {
        for (const r of b) {
          if (world.getRelation(b.entity(r), ClaimedBy) !== undefined) claims++;
        }
      });
      let selection = 0;
      world.query(selectedQ).each((b) => {
        selection += b.count;
      });

      const frame = deps.engine.lastFrame();
      const lines = [
        `fps ${ema.toFixed(0).padStart(3)}   tick ${frame ? `${frame.totalMicros}µs` : "—"}`,
        `nodes ${deps.graybox.nodeCount()}   selected ${selection}`,
        `transform writes/frame ${dTransform}   graybox writes/frame ${dStyle}`,
        `claims ${claims}   commits ${deps.sink.intents.length}`,
        `recognizers (${recognizers.length}): ${recognizers.slice(0, 6).join("  ") || "—"}`,
      ];
      lines.push("", "pan: drag empty canvas · space/middle-drag · wheel = zoom", "tap = select · drag a box = move");
      el.textContent = lines.join("\n");
    },
  };
}
