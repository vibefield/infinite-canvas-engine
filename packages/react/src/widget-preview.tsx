/**
 * `<WidgetPreview>` — the framework answer to "give me the preview for type
 * X" (design-005 §2 amendment, 2026-07-19). Palettes/trays stay app chrome
 * (design-004); THIS is the seam they consume, owning the whole fallback
 * chain so every app and every `defineWidget` author gets the same behavior:
 *
 *   1. the def's DECLARED preview (engine-free by contract — no world, no
 *      entity, no ops; authored at `defaultSize`, scaled here);
 *   2. dom surfaces with no declaration: the REAL component with default (or
 *      `preview.props`-curated) props, mounted against the framework's
 *      internal preview sandbox — truthful by construction;
 *   3. the `fallback` prop (the app's silhouette), else a neutral placeholder.
 *
 * Every branch renders INERT (`inert` + pointer-events none) inside an error
 * boundary — a broken preview degrades to the fallback, it never kills the
 * palette. GL surfaces without a declared preview go straight to fallback in
 * P1 (the r3f snapshot pipeline is P2; a DOM mockup declaration is the
 * sanctioned escape hatch meanwhile).
 *
 * The sandbox: one lazy module-level engine (own in-memory doc, no adapters,
 * never stepped past two settle ticks) spawning ONE entity per previewed
 * type ON DEMAND. Preview entities never receive Selected/Grab/overlap tags,
 * so chrome renders permanently at rest — "static" is a property of the
 * sandbox, not a discipline widget authors must follow.
 */
import {
  createCanvasEngine,
  widgets,
  type CanvasEngine,
  type Entity,
  type WidgetType,
  type World,
} from "@ice/core";
import { Component, type ComponentType, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { EngineProvider } from "./engine-context";

// --- the preview sandbox -----------------------------------------------------

interface PreviewSandbox {
  readonly ce: CanvasEngine;
  readonly entities: Map<string, Entity>;
}

let sandbox: PreviewSandbox | null = null;

function ensurePreviewEntity(def: WidgetType): Entity | undefined {
  if (sandbox === null) {
    const ce = createCanvasEngine();
    ce.docs.create();
    ce.world.sync();
    ce.step(16);
    sandbox = { ce, entities: new Map() };
  }
  const existing = sandbox.entities.get(def.type);
  if (existing !== undefined) return existing;
  try {
    const e = sandbox.ce.ops.spawnWidget(def.type, {
      x: 0,
      y: 0,
      undoable: false,
      ...(def.previewProps !== undefined ? { props: def.previewProps } : {}),
    });
    sandbox.ce.world.sync();
    sandbox.ce.step(32); // settle tick: equip stamps land before first render
    sandbox.entities.set(def.type, e);
    return e;
  } catch (err) {
    console.warn(`ice: WidgetPreview("${def.type}") sandbox spawn failed — falling back.`, err);
    return undefined;
  }
}

/** TEST-ONLY sandbox wipe (mirrors __resetWidgetsForTests; not on the barrel). */
export function __resetPreviewSandboxForTests(): void {
  sandbox?.ce.dispose();
  sandbox = null;
}

// --- error containment ---------------------------------------------------------

class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    console.warn("ice: a widget preview threw while rendering — showing the fallback.", error);
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// --- the host ------------------------------------------------------------------

export interface WidgetPreviewProps {
  readonly type: string;
  /** The available box; the preview renders aspect-FITTED inside it. */
  readonly width: number;
  readonly height: number;
  /** App silhouette shown when no preview path applies (or one throws). */
  readonly fallback?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

function defaultPlaceholder(label: string): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 12,
        background: "rgba(127, 127, 127, 0.12)",
        boxShadow: "inset 0 0 0 1px rgba(127, 127, 127, 0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        color: "rgba(127, 127, 127, 0.8)",
        overflow: "hidden",
      }}
    >
      {label}
    </div>
  );
}

export function WidgetPreview({ type, width, height, fallback, className, style }: WidgetPreviewProps): ReactElement {
  const def = widgets.get(type);
  const safeFallback = fallback ?? defaultPlaceholder(type);
  if (def === undefined || def.defaultSize.w <= 0 || def.defaultSize.h <= 0) {
    return (
      <div className={className} style={{ width, height, ...style }}>
        {safeFallback}
      </div>
    );
  }

  const s = Math.min(width / def.defaultSize.w, height / def.defaultSize.h);
  const fitW = def.defaultSize.w * s;
  const fitH = def.defaultSize.h * s;

  // The inert, natural-size stage every preview branch renders on: authors
  // (and the real component) write at defaultSize; the host scales.
  const stage = (content: ReactNode): ReactElement => (
    <div className={className} style={{ width: fitW, height: fitH, overflow: "hidden", ...style }}>
      <div
        inert
        style={{
          width: def.defaultSize.w,
          height: def.defaultSize.h,
          transform: `scale(${s})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <PreviewBoundary fallback={safeFallback}>{content}</PreviewBoundary>
      </div>
    </div>
  );

  // 1. Author-declared preview: engine-free by contract — rendered bare.
  if (def.previewComponent !== null && def.previewComponent !== undefined) {
    const Declared = def.previewComponent as ComponentType;
    return stage(<Declared />);
  }

  // 2. dom surface: the real component + default/curated props in the sandbox.
  if (def.surface === "dom" && def.component !== null && def.component !== undefined) {
    const entity = ensurePreviewEntity(def);
    if (entity !== undefined && sandbox !== null) {
      const View = def.component as ComponentType<{ entity: Entity; world: World }>;
      return stage(
        <EngineProvider engine={sandbox.ce}>
          <View entity={entity} world={sandbox.ce.world} />
        </EngineProvider>,
      );
    }
  }

  // 3. No path (gl without a declaration, broken spawn): the fallback.
  return (
    <div className={className} style={{ width: fitW, height: fitH, ...style }}>
      {safeFallback}
    </div>
  );
}
